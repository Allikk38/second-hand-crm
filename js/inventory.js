// ========================================
// FILE: js/inventory.js
// ========================================

/**
 * Inventory Page Module - MPA Edition
 * 
 * Логика страницы управления складом. Загружает и отображает список товаров
 * в виде таблицы с возможностью поиска, фильтрации и CRUD-операций.
 * 
 * Архитектурные решения:
 * - Прямое использование глобального клиента window.supabase через getSupabase из core/auth.js.
 * - Полная независимость от других страниц (MPA).
 * - Кэширование данных в sessionStorage.
 * - Оптимистичные операции с очередью синхронизации для офлайн-режима.
 * - Использование централизованных UI-утилит из utils/ui.js.
 * - Поддержка офлайн-режима при отсутствии сети.
 * 
 * @module inventory
 * @version 3.8.0
 * @changes
 * - Добавлена очередь отложенных операций (pendingOperations).
 * - Реализовано оптимистичное удаление в офлайн-режиме.
 * - Автоматическая синхронизация при восстановлении сети.
 * - Улучшена обработка ошибок синхронизации.
 */

import { requireAuth, logout, isOnline, getSupabase } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText, getCategoryName, debounce } from '../utils/formatters.js';
import { showNotification, showConfirmDialog } from '../utils/ui.js';
import { openProductFormModal } from '../utils/product-form.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_CACHE_KEY = 'sh_inventory_products';
const PENDING_OPS_KEY = 'sh_inventory_pending_ops';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// ========== СОСТОЯНИЕ ==========

const state = {
    user: null,
    isOffline: false,
    products: [],
    filteredProducts: [],
    isLoading: false,
    isDeleting: false,
    isSyncing: false,
    searchQuery: '',
    selectedStatus: '',
    selectedCategory: '',
    sortBy: 'created_at-desc',
    categories: [],
    initComplete: false,
    pendingOperations: [] // Очередь операций для синхронизации
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    tableBody: null,
    statsBar: null,
    errorBanner: null,
    errorMessage: null,
    searchInput: null,
    statusFilter: null,
    categoryFilter: null,
    sortSelect: null,
    addProductBtn: null,
    refreshBtn: null,
    logoutBtn: null,
    userEmail: null,
    offlineBanner: null,
    offlineRetryBtn: null,
    moduleLoading: null,
    syncIndicator: null
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'block';
    }
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'none';
    }
}

function showError(message, type = 'error') {
    if (DOM.errorBanner && DOM.errorMessage) {
        DOM.errorMessage.textContent = message;
        DOM.errorBanner.style.display = 'flex';
        DOM.errorBanner.className = `error-banner error-banner-${type}`;
        
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                DOM.errorBanner.style.display = 'none';
            }, 3000);
        }
    } else {
        showNotification(message, type);
    }
}

function hideError() {
    if (DOM.errorBanner) {
        DOM.errorBanner.style.display = 'none';
    }
}

function markModuleLoaded() {
    if (!state.initComplete) {
        state.initComplete = true;
        if (DOM.moduleLoading) {
            DOM.moduleLoading.style.display = 'none';
        }
        if (window.markInventoryModuleLoaded) {
            window.markInventoryModuleLoaded();
        }
        console.log('[Inventory] Module marked as loaded');
    }
}

// ========== УПРАВЛЕНИЕ ОЧЕРЕДЬЮ ОПЕРАЦИЙ ==========

/**
 * Загружает отложенные операции из localStorage
 */
function loadPendingOperations() {
    try {
        const stored = localStorage.getItem(PENDING_OPS_KEY);
        if (stored) {
            state.pendingOperations = JSON.parse(stored);
            console.log('[Inventory] Loaded pending operations:', state.pendingOperations.length);
        }
    } catch (e) {
        console.warn('[Inventory] Failed to load pending operations:', e);
        state.pendingOperations = [];
    }
}

/**
 * Сохраняет отложенные операции в localStorage
 */
function savePendingOperations() {
    try {
        localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(state.pendingOperations));
    } catch (e) {
        console.warn('[Inventory] Failed to save pending operations:', e);
    }
}

/**
 * Добавляет операцию в очередь
 * @param {Object} operation - Операция { type, productId, product, timestamp }
 */
function addPendingOperation(operation) {
    state.pendingOperations.push({
        ...operation,
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now()
    });
    savePendingOperations();
    updateSyncIndicator();
    console.log('[Inventory] Added pending operation:', operation);
}

/**
 * Удаляет операцию из очереди
 * @param {string} operationId - ID операции
 */
function removePendingOperation(operationId) {
    state.pendingOperations = state.pendingOperations.filter(op => op.id !== operationId);
    savePendingOperations();
    updateSyncIndicator();
}

/**
 * Обновляет индикатор синхронизации
 */
function updateSyncIndicator() {
    const pendingCount = state.pendingOperations.length;
    
    if (pendingCount > 0) {
        showNotification(`Ожидает синхронизации: ${pendingCount} операций`, 'info');
    }
    
    // Можно добавить визуальный индикатор в UI
    const syncBadge = document.getElementById('syncBadge');
    if (syncBadge) {
        if (pendingCount > 0) {
            syncBadge.textContent = pendingCount;
            syncBadge.style.display = 'inline-block';
        } else {
            syncBadge.style.display = 'none';
        }
    }
}

/**
 * Синхронизирует все отложенные операции с сервером
 */
async function syncPendingOperations() {
    if (state.isSyncing) return;
    if (!isOnline()) return;
    if (state.pendingOperations.length === 0) return;
    
    state.isSyncing = true;
    console.log('[Inventory] Starting sync of', state.pendingOperations.length, 'operations');
    
    const operations = [...state.pendingOperations];
    const failedOps = [];
    
    for (const op of operations) {
        try {
            if (op.type === 'delete') {
                await syncDeleteOperation(op);
            } else if (op.type === 'create') {
                // TODO: синхронизация создания
            } else if (op.type === 'update') {
                // TODO: синхронизация обновления
            }
            
            // Успешно — удаляем из очереди
            removePendingOperation(op.id);
            
        } catch (error) {
            console.error('[Inventory] Failed to sync operation:', op, error);
            failedOps.push(op);
        }
    }
    
    state.isSyncing = false;
    
    if (failedOps.length > 0) {
        showNotification(`Не удалось синхронизировать ${failedOps.length} операций`, 'warning');
    } else if (operations.length > 0) {
        showNotification('Синхронизация завершена', 'success');
        // Обновляем данные с сервера
        await loadProducts(true);
    }
    
    updateSyncIndicator();
}

/**
 * Синхронизирует операцию удаления
 */
async function syncDeleteOperation(operation) {
    const { productId, productName } = operation;
    
    console.log('[Inventory] Syncing delete:', productId);
    
    const supabase = await getSupabase();
    
    // Проверяем, существует ли товар
    const { data: existing, error: checkError } = await supabase
        .from('products')
        .select('id, photo_url')
        .eq('id', productId)
        .maybeSingle();
    
    if (checkError) {
        // Если товар не найден — считаем что операция выполнена
        if (checkError.code === 'PGRST116') {
            console.log('[Inventory] Product already deleted:', productId);
            return;
        }
        throw checkError;
    }
    
    // Удаляем фото если есть
    if (existing?.photo_url) {
        try {
            const photoPath = existing.photo_url.split('/').pop();
            if (photoPath) {
                await supabase.storage
                    .from('product-photos')
                    .remove([photoPath]);
            }
        } catch (photoError) {
            console.warn('[Inventory] Photo deletion error during sync:', photoError);
        }
    }
    
    // Удаляем товар
    const { error: deleteError } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);
    
    if (deleteError) throw deleteError;
    
    console.log('[Inventory] Synced delete:', productId);
}

// ========== КЭШИРОВАНИЕ ==========

function saveProductsToCache(products) {
    if (!products) return;
    
    try {
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            data: products,
            timestamp: Date.now()
        }));
        console.log('[Inventory] Cache saved:', products.length, 'products');
    } catch (e) {
        console.warn('[Inventory] Failed to cache products:', e);
    }
}

function loadProductsFromCache() {
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) {
                console.log('[Inventory] Loaded from cache:', data.length, 'products');
                return data;
            }
            sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
        }
    } catch (e) {
        console.warn('[Inventory] Failed to load cached products:', e);
    }
    return null;
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function isSupabaseAvailable() {
    if (!isOnline()) return false;
    
    try {
        const supabase = await getSupabase();
        const { error } = await supabase.from('products').select('id', { count: 'exact', head: true });
        return !error;
    } catch {
        return false;
    }
}

async function loadProducts(forceRefresh = false) {
    if (state.isLoading) return;
    
    const cached = loadProductsFromCache();
    
    if (!isOnline()) {
        state.isOffline = true;
        showOfflineBanner();
        
        if (cached) {
            state.products = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
        } else {
            showError('Нет подключения к интернету и нет кэшированных данных', 'warning');
        }
        
        markModuleLoaded();
        render();
        return;
    }
    
    state.isLoading = true;
    render();
    
    try {
        const supabaseAvailable = await isSupabaseAvailable();
        
        if (!supabaseAvailable) {
            state.isOffline = true;
            showOfflineBanner();
            
            if (cached) {
                state.products = cached;
                updateCategoryFilter();
                applyFilters();
                updateStats();
                showNotification('Сервер недоступен. Работа с кэшированными данными.', 'warning');
            } else {
                showError('Сервер недоступен и нет кэшированных данных', 'error');
            }
            
            state.isLoading = false;
            markModuleLoaded();
            render();
            return;
        }
        
        const supabase = await getSupabase();
        
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        console.log('[Inventory] Loaded from server:', data?.length || 0, 'products');
        
        state.products = data || [];
        state.isOffline = false;
        hideOfflineBanner();
        
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        
        // Синхронизируем отложенные операции
        await syncPendingOperations();
        
    } catch (error) {
        console.error('[Inventory] Load products error:', error);
        
        if (cached) {
            state.products = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            showNotification('Ошибка загрузки. Используются кэшированные данные.', 'warning');
        } else {
            showError('Ошибка загрузки товаров: ' + error.message);
        }
    } finally {
        state.isLoading = false;
        markModuleLoaded();
        render();
    }
}

function updateCategoryFilter() {
    const categories = new Set();
    state.products.forEach(p => {
        if (p.category) categories.add(p.category);
    });
    
    state.categories = Array.from(categories).sort();
    
    if (DOM.categoryFilter) {
        const currentValue = DOM.categoryFilter.value;
        
        while (DOM.categoryFilter.options.length > 1) {
            DOM.categoryFilter.remove(1);
        }
        
        state.categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = getCategoryName(cat);
            DOM.categoryFilter.appendChild(option);
        });
        
        if (currentValue) {
            DOM.categoryFilter.value = currentValue;
        }
    }
}

function applyFilters() {
    let filtered = [...state.products];
    
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name?.toLowerCase().includes(q) ||
            p.id?.toLowerCase().includes(q)
        );
    }
    
    if (state.selectedStatus) {
        filtered = filtered.filter(p => p.status === state.selectedStatus);
    }
    
    if (state.selectedCategory) {
        filtered = filtered.filter(p => p.category === state.selectedCategory);
    }
    
    filtered = sortProducts(filtered, state.sortBy);
    state.filteredProducts = filtered;
}

function sortProducts(products, sortBy) {
    const sorted = [...products];
    
    switch (sortBy) {
        case 'price-asc':
            return sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
        case 'price-desc':
            return sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
        case 'name-asc':
            return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        case 'created_at-desc':
        default:
            return sorted.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
            });
    }
}

function updateStats() {
    if (!DOM.statsBar) return;
    
    const total = state.products.length;
    const inStock = state.products.filter(p => p.status === 'in_stock').length;
    const sold = state.products.filter(p => p.status === 'sold').length;
    const reserved = state.products.filter(p => p.status === 'reserved').length;
    const totalValue = state.products
        .filter(p => p.status === 'in_stock')
        .reduce((sum, p) => sum + (p.price || 0), 0);
    
    DOM.statsBar.innerHTML = `
        <div class="stat-card-inline">
            <span class="stat-icon">📦</span>
            <div class="stat-content">
                <span class="stat-label">Всего товаров</span>
                <span class="stat-value">${total}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">✅</span>
            <div class="stat-content">
                <span class="stat-label">В наличии</span>
                <span class="stat-value" style="color: var(--color-success)">${inStock}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">💰</span>
            <div class="stat-content">
                <span class="stat-label">Продано</span>
                <span class="stat-value" style="color: var(--color-danger)">${sold}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">🔖</span>
            <div class="stat-content">
                <span class="stat-label">Забронировано</span>
                <span class="stat-value" style="color: var(--color-warning)">${reserved}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">💵</span>
            <div class="stat-content">
                <span class="stat-label">Стоимость склада</span>
                <span class="stat-value">${formatMoney(totalValue)}</span>
            </div>
        </div>
    `;
}

// ========== CRUD ОПЕРАЦИИ ==========

/**
 * Удаляет товар (оптимистично)
 */
async function deleteProduct(id) {
    if (state.isDeleting) return;
    
    const product = state.products.find(p => p.id === id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    const confirmed = await showConfirmDialog({
        title: 'Удаление товара',
        message: `Вы уверены, что хотите удалить товар "${product.name}"?`,
        confirmText: 'Удалить'
    });
    
    if (!confirmed) return;
    
    // ОПТИМИСТИЧНОЕ УДАЛЕНИЕ: сразу удаляем из локального стейта
    state.products = state.products.filter(p => p.id !== id);
    saveProductsToCache(state.products);
    updateCategoryFilter();
    applyFilters();
    updateStats();
    render();
    
    // Если офлайн — добавляем в очередь
    if (!isOnline()) {
        addPendingOperation({
            type: 'delete',
            productId: id,
            productName: product.name
        });
        
        showNotification(
            `Товар "${product.name}" будет удалён при восстановлении сети`,
            'warning'
        );
        return;
    }
    
    // Онлайн — удаляем сразу
    state.isDeleting = true;
    render();
    
    try {
        const supabase = await getSupabase();
        
        // Удаляем фото если есть
        if (product.photo_url) {
            try {
                const photoPath = product.photo_url.split('/').pop();
                if (photoPath) {
                    await supabase.storage
                        .from('product-photos')
                        .remove([photoPath]);
                }
            } catch (photoError) {
                console.warn('[Inventory] Photo deletion error:', photoError);
            }
        }
        
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        showNotification(`Товар "${product.name}" удалён`, 'success');
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        
        // Восстанавливаем товар в стейте при ошибке
        state.products.unshift(product);
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        
        showError('Ошибка удаления: ' + error.message);
    } finally {
        state.isDeleting = false;
        render();
    }
}

async function openAddProductForm() {
    if (!isOnline()) {
        showError('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    const newProduct = await openProductFormModal({
        mode: 'create',
        userId: state.user?.id
    });
    
    if (newProduct) {
        state.products.unshift(newProduct);
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        render();
        
        showNotification(`Товар "${newProduct.name}" добавлен`, 'success');
    }
}

async function openEditProductForm(id) {
    if (!isOnline()) {
        showError('Редактирование товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    const product = state.products.find(p => p.id === id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    const updatedProduct = await openProductFormModal({
        mode: 'edit',
        initialData: product,
        userId: state.user?.id
    });
    
    if (updatedProduct) {
        const index = state.products.findIndex(p => p.id === updatedProduct.id);
        if (index !== -1) {
            state.products[index] = updatedProduct;
            saveProductsToCache(state.products);
            updateCategoryFilter();
            applyFilters();
            updateStats();
            render();
            
            showNotification(`Товар "${updatedProduct.name}" обновлён`, 'success');
        }
    }
}

// ========== РЕНДЕРИНГ ==========

function getStatusClass(status) {
    const classes = {
        'in_stock': 'status-in_stock',
        'sold': 'status-sold',
        'reserved': 'status-reserved',
        'draft': 'status-draft'
    };
    return classes[status] || 'status-unknown';
}

function render() {
    if (!DOM.tableBody) return;
    
    const productsTable = document.getElementById('productsTable');
    
    if (state.isLoading && state.products.length === 0) {
        DOM.tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <div class="loading-spinner"></div>
                    <span style="margin-left: 12px;">Загрузка товаров...</span>
                </td>
            </tr>
        `;
        if (productsTable) productsTable.style.display = 'table';
        return;
    }
    
    if (state.filteredProducts.length === 0) {
        let message = 'Товары не найдены';
        if (state.searchQuery || state.selectedStatus || state.selectedCategory) {
            message = 'По вашему запросу ничего не найдено';
        }
        
        DOM.tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 60px;">
                    <div class="empty-state-icon">📦</div>
                    <p style="margin-top: 16px; color: var(--color-text-muted);">${escapeHtml(message)}</p>
                </td>
            </tr>
        `;
        if (productsTable) productsTable.style.display = 'table';
        return;
    }
    
    if (productsTable) productsTable.style.display = 'table';
    
    DOM.tableBody.innerHTML = state.filteredProducts.map(product => {
        const statusText = getStatusText(product.status);
        const statusClass = getStatusClass(product.status);
        const safeName = escapeHtml(product.name || 'Без названия');
        const safeId = escapeHtml(product.id?.slice(0, 8) || '—');
        const safePhotoUrl = product.photo_url ? escapeHtml(product.photo_url) : null;
        
        return `
            <tr class="product-row" data-id="${product.id}">
                <td class="checkbox-cell">
                    <input type="checkbox" class="table-checkbox" data-id="${product.id}" ${state.isDeleting ? 'disabled' : ''}>
                </td>
                <td class="photo-cell">
                    <div class="product-thumb">
                        ${safePhotoUrl 
                            ? `<img src="${safePhotoUrl}" alt="${safeName}" loading="lazy">` 
                            : '<span class="thumb-placeholder">📦</span>'
                        }
                    </div>
                </td>
                <td class="name-cell">
                    <div class="product-name">${safeName}</div>
                    <div class="product-id">ID: ${safeId}</div>
                </td>
                <td class="category-cell">${getCategoryName(product.category)}</td>
                <td class="price-cell">
                    <div class="price-main">${formatMoney(product.price)}</div>
                    ${product.cost_price ? `<div class="price-cost">Себ.: ${formatMoney(product.cost_price)}</div>` : ''}
                </td>
                <td class="status-cell">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td class="actions-cell">
                    <div class="row-actions">
                        <button class="btn-icon" data-action="edit" data-id="${product.id}" title="Редактировать" ${state.isDeleting ? 'disabled' : ''}>
                            ✎
                        </button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" title="Удалить" ${state.isDeleting ? 'disabled' : ''}>
                            ${state.isDeleting ? '⌛' : '✕'}
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    attachRowEvents();
}

function attachRowEvents() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!state.isDeleting) {
                openEditProductForm(btn.dataset.id);
            }
        });
    });
    
    DOM.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!state.isDeleting) {
                deleteProduct(btn.dataset.id);
            }
        });
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function cacheElements() {
    DOM.tableBody = document.getElementById('tableBody');
    DOM.statsBar = document.getElementById('statsBar');
    DOM.errorBanner = document.getElementById('errorBanner');
    DOM.errorMessage = document.getElementById('errorMessage');
    DOM.searchInput = document.getElementById('searchInput');
    DOM.statusFilter = document.getElementById('statusFilter');
    DOM.categoryFilter = document.getElementById('categoryFilter');
    DOM.sortSelect = document.getElementById('sortSelect');
    DOM.addProductBtn = document.getElementById('addProductBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
    DOM.moduleLoading = document.getElementById('moduleLoading');
}

function displayUserInfo() {
    if (DOM.userEmail) {
        if (state.user) {
            const name = state.user.email?.split('@')[0] || 'Пользователь';
            DOM.userEmail.textContent = name;
        } else {
            DOM.userEmail.textContent = 'Офлайн-режим';
        }
    }
}

function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            hideError();
            loadProducts(true);
        });
    }
    
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', openAddProductForm);
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => loadProducts(true));
    }
    
    if (DOM.searchInput) {
        const debouncedSearch = debounce(() => {
            state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
            applyFilters();
            render();
        }, 300);
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            state.selectedStatus = e.target.value;
            applyFilters();
            render();
        });
    }
    
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            state.selectedCategory = e.target.value;
            applyFilters();
            render();
        });
    }
    
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            applyFilters();
            render();
        });
    }
    
    const closeErrorBtn = document.getElementById('closeErrorBtn');
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', hideError);
    }
    
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.table-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
    }
    
    window.addEventListener('online', () => {
        console.log('[Inventory] Online detected');
        if (state.isOffline) {
            hideOfflineBanner();
            showNotification('Соединение восстановлено', 'success');
            // Синхронизируем отложенные операции
            syncPendingOperations().then(() => {
                loadProducts(true);
            });
        }
    });
    
    window.addEventListener('offline', () => {
        console.log('[Inventory] Offline detected');
        state.isOffline = true;
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

async function init() {
    console.log('[Inventory] Initializing MPA page...');
    
    cacheElements();
    loadPendingOperations();
    
    state.isOffline = !isOnline();
    if (state.isOffline) {
        showOfflineBanner();
    }
    
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
    } else if (authResult.offline || authResult.networkError) {
        state.isOffline = true;
        state.user = null;
        showOfflineBanner();
        showNotification('Работа в офлайн-режиме. Некоторые функции недоступны.', 'warning');
    } else if (authResult.authError) {
        return;
    }
    
    displayUserInfo();
    attachEvents();
    
    markModuleLoaded();
    
    await loadProducts();
    
    // Обновляем индикатор синхронизации
    updateSyncIndicator();
    
    console.log('[Inventory] Page initialized');
}

document.addEventListener('DOMContentLoaded', init);

export { init };
