// ========================================
// FILE: js/inventory/index.js
// ========================================

/**
 * Inventory Page Module - Index
 * 
 * Точка входа для страницы управления складом.
 * Использует единый движок синхронизации sync-engine.js.
 * 
 * Архитектурные решения:
 * - Sync Engine для всех операций с данными (Cache First, Sync Later)
 * - Оптимистичное обновление UI без ожидания ответа сервера
 * - Единая очередь операций для всех изменений
 * - Подписка на события синхронизации для обновления UI
 * 
 * @module inventory/index
 * @version 2.0.0
 * @changes
 * - Полная интеграция с sync-engine.js
 * - Удалены отдельные модули products.js и operations.js
 * - Оптимистичные CRUD операции через saveChange()
 * - Мгновенная загрузка из IndexedDB
 */

import { requireAuth, logout, isOnline, getSupabase } from '../../core/auth.js';
import { 
    formatMoney, 
    escapeHtml, 
    getStatusText, 
    getCategoryName, 
    debounce 
} from '../../utils/formatters.js';
import { showNotification, showConfirmDialog } from '../../utils/ui.js';
import { openProductFormModal } from '../../utils/product-form.js';
import { 
    initSyncEngine,
    subscribeToSync,
    loadData,
    saveChange,
    syncNow,
    syncState,
    ENTITIES,
    OP_TYPES
} from '../../core/sync-engine.js';

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

const state = {
    user: null,
    products: [],
    filteredProducts: [],
    categories: [],
    isLoading: false,
    isDeleting: false,
    searchQuery: '',
    selectedStatus: '',
    selectedCategory: '',
    sortBy: 'created_at-desc',
    selectedIds: new Set(),
    stats: {
        total: 0,
        inStock: 0,
        sold: 0,
        reserved: 0,
        stockValue: 0
    }
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    tableBody: null,
    statsBar: null,
    categoryFilter: null,
    searchInput: null,
    statusFilter: null,
    sortSelect: null,
    addProductBtn: null,
    refreshBtn: null,
    errorBanner: null,
    errorMessage: null,
    offlineBanner: null,
    offlineRetryBtn: null,
    syncBadge: null,
    syncStatus: null,
    userEmail: null,
    logoutBtn: null,
    moduleLoading: null
};

// ========== ОТОБРАЖЕНИЕ БАННЕРОВ ==========

function showOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'flex';
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'none';
}

function updateSyncIndicator() {
    const pendingCount = syncState.pendingCount;
    
    if (DOM.syncBadge) {
        if (pendingCount > 0) {
            DOM.syncBadge.textContent = pendingCount;
            DOM.syncBadge.style.display = 'inline-block';
        } else {
            DOM.syncBadge.style.display = 'none';
        }
    }
    
    if (DOM.syncStatus) {
        if (syncState.isSyncing) {
            DOM.syncStatus.textContent = 'Синхронизация...';
            DOM.syncStatus.style.display = 'inline';
        } else if (pendingCount > 0) {
            DOM.syncStatus.textContent = `Ожидает: ${pendingCount}`;
            DOM.syncStatus.style.display = 'inline';
        } else {
            DOM.syncStatus.style.display = 'none';
        }
    }
}

function showError(message, type = 'error') {
    if (DOM.errorBanner && DOM.errorMessage) {
        DOM.errorMessage.textContent = message;
        DOM.errorBanner.style.display = 'flex';
        DOM.errorBanner.className = `error-banner error-banner-${type}`;
        
        if (type === 'success' || type === 'info') {
            setTimeout(() => DOM.errorBanner.style.display = 'none', 3000);
        }
    } else {
        showNotification(message, type);
    }
}

function hideError() {
    if (DOM.errorBanner) DOM.errorBanner.style.display = 'none';
}

// ========== РАБОТА С ТОВАРАМИ ==========

/**
 * Загрузка товаров через Sync Engine (Cache First)
 */
async function loadProductsData(forceRefresh = false) {
    state.isLoading = true;
    render();
    
    try {
        const result = await loadData(ENTITIES.PRODUCTS, {
            id: 'all',
            maxAge: forceRefresh ? 0 : 5 * 60 * 1000,
            fetcher: async () => {
                const supabase = await getSupabase();
                const { data, error } = await supabase
                    .from('products')
                    .select('*')
                    .order('created_at', { ascending: false });
                
                if (error) throw error;
                return data || [];
            }
        });
        
        state.products = result.data || [];
        
        if (result.fromCache) {
            console.log('[Inventory] Loaded from cache:', state.products.length);
        } else {
            console.log('[Inventory] Loaded from server:', state.products.length);
        }
        
        updateCategories();
        applyFilters();
        updateStats();
        
    } catch (error) {
        console.error('[Inventory] Load error:', error);
        if (state.products.length === 0) {
            showError('Не удалось загрузить товары', 'error');
        }
    } finally {
        state.isLoading = false;
        render();
        markModuleLoaded();
    }
}

function updateCategories() {
    const counts = new Map();
    
    state.products.forEach(p => {
        const cat = p.category || 'other';
        counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    
    state.categories = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
}

function applyFilters() {
    let filtered = [...state.products];
    
    // Убираем оптимистично удалённые (помеченные _deleted)
    filtered = filtered.filter(p => !p._deleted);
    
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
    const filtered = state.products.filter(p => !p._deleted);
    const inStock = filtered.filter(p => p.status === 'in_stock');
    
    state.stats = {
        total: filtered.length,
        inStock: inStock.length,
        sold: filtered.filter(p => p.status === 'sold').length,
        reserved: filtered.filter(p => p.status === 'reserved').length,
        stockValue: inStock.reduce((sum, p) => sum + (p.price || 0), 0)
    };
}

// ========== ОПТИМИСТИЧНЫЕ CRUD ОПЕРАЦИИ ==========

/**
 * Оптимистично добавляет товар в локальный стейт
 */
function optimisticAdd(product) {
    product._optimistic = true;
    state.products.unshift(product);
    updateCategories();
    applyFilters();
    updateStats();
    render();
}

/**
 * Оптимистично обновляет товар в локальном стейте
 */
function optimisticUpdate(productId, updates) {
    const index = state.products.findIndex(p => p.id === productId);
    if (index !== -1) {
        state.products[index] = { ...state.products[index], ...updates, _optimistic: true };
        updateCategories();
        applyFilters();
        updateStats();
        render();
        return true;
    }
    return false;
}

/**
 * Оптимистично удаляет товар из локального стейта
 */
function optimisticDelete(productId) {
    const index = state.products.findIndex(p => p.id === productId);
    if (index !== -1) {
        state.products[index]._deleted = true;
        applyFilters();
        updateStats();
        render();
        return true;
    }
    return false;
}

/**
 * Удаление товара через Sync Engine
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
        confirmText: 'Удалить',
        confirmClass: 'btn-danger'
    });
    
    if (!confirmed) return;
    
    // Оптимистичное удаление
    optimisticDelete(id);
    
    // Сохраняем изменение через Sync Engine
    try {
        await saveChange(
            ENTITIES.PRODUCTS,
            OP_TYPES.DELETE,
            { id, name: product.name },
            product
        );
        
        showNotification(
            syncState.isOnline 
                ? `Товар "${product.name}" удалён`
                : `Товар "${product.name}" будет удалён при восстановлении сети`,
            'success'
        );
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        showError('Ошибка удаления: ' + error.message);
    }
    
    updateSyncIndicator();
}

/**
 * Открытие формы добавления товара
 */
async function openAddProductForm() {
    if (!state.user?.id) {
        showError('Не удалось определить пользователя', 'error');
        return;
    }
    
    try {
        const newProduct = await openProductFormModal({
            mode: 'create',
            userId: state.user.id,
            onSuccess: async (product) => {
                // Оптимистично добавляем
                optimisticAdd(product);
                
                // Сохраняем через Sync Engine
                await saveChange(
                    ENTITIES.PRODUCTS,
                    OP_TYPES.CREATE,
                    product
                );
                
                showNotification(
                    syncState.isOnline
                        ? `Товар "${product.name}" добавлен`
                        : `Товар "${product.name}" сохранён локально`,
                    'success'
                );
                
                updateSyncIndicator();
            }
        });
        
        if (newProduct) {
            optimisticAdd(newProduct);
            await saveChange(ENTITIES.PRODUCTS, OP_TYPES.CREATE, newProduct);
            updateSyncIndicator();
        }
        
    } catch (error) {
        console.error('[Inventory] Add error:', error);
        showError('Не удалось открыть форму добавления', 'error');
    }
}

/**
 * Открытие формы редактирования товара
 */
async function openEditProductForm(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    try {
        const updatedProduct = await openProductFormModal({
            mode: 'edit',
            initialData: product,
            userId: state.user?.id,
            onSuccess: async (product) => {
                optimisticUpdate(id, product);
                
                await saveChange(
                    ENTITIES.PRODUCTS,
                    OP_TYPES.UPDATE,
                    product,
                    product
                );
                
                showNotification(`Товар "${product.name}" обновлён`, 'success');
                updateSyncIndicator();
            }
        });
        
        if (updatedProduct) {
            optimisticUpdate(id, updatedProduct);
            await saveChange(ENTITIES.PRODUCTS, OP_TYPES.UPDATE, updatedProduct, product);
            updateSyncIndicator();
        }
        
    } catch (error) {
        console.error('[Inventory] Edit error:', error);
        showError('Не удалось открыть форму редактирования', 'error');
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

function renderStats() {
    if (!DOM.statsBar) return;
    
    const stats = state.stats;
    
    DOM.statsBar.innerHTML = `
        <div class="stat-card-inline">
            <span class="stat-icon">📦</span>
            <div class="stat-content">
                <span class="stat-label">Всего товаров</span>
                <span class="stat-value">${stats.total}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">✅</span>
            <div class="stat-content">
                <span class="stat-label">В наличии</span>
                <span class="stat-value" style="color: var(--color-success)">${stats.inStock}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">💰</span>
            <div class="stat-content">
                <span class="stat-label">Продано</span>
                <span class="stat-value" style="color: var(--color-danger)">${stats.sold}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">🔖</span>
            <div class="stat-content">
                <span class="stat-label">Забронировано</span>
                <span class="stat-value" style="color: var(--color-warning)">${stats.reserved}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">💵</span>
            <div class="stat-content">
                <span class="stat-label">Стоимость склада</span>
                <span class="stat-value">${formatMoney(stats.stockValue)}</span>
            </div>
        </div>
    `;
}

function updateCategorySelect() {
    if (!DOM.categoryFilter) return;
    
    const selectedCategory = state.selectedCategory;
    const currentValue = DOM.categoryFilter.value;
    
    while (DOM.categoryFilter.options.length > 1) {
        DOM.categoryFilter.remove(1);
    }
    
    state.categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.value;
        option.textContent = `${getCategoryName(cat.value)} (${cat.count})`;
        DOM.categoryFilter.appendChild(option);
    });
    
    if (currentValue) {
        DOM.categoryFilter.value = currentValue;
    }
}

function render() {
    if (!DOM.tableBody) return;
    
    renderStats();
    updateCategorySelect();
    
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
        const isSelected = state.selectedIds.has(product.id);
        const isOptimistic = product._optimistic ? 'optimistic' : '';
        
        return `
            <tr class="product-row ${isSelected ? 'selected' : ''} ${isOptimistic}" data-id="${product.id}">
                <td class="checkbox-cell">
                    <input type="checkbox" class="table-checkbox" data-id="${product.id}" 
                        ${state.isDeleting ? 'disabled' : ''} ${isSelected ? 'checked' : ''}>
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
                    <div class="product-name">
                        ${safeName}
                        ${product._optimistic ? '<span class="optimistic-badge" title="Ожидает синхронизации">⏳</span>' : ''}
                    </div>
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
                        <button class="btn-icon" data-action="edit" data-id="${product.id}" 
                            title="Редактировать" ${state.isDeleting ? 'disabled' : ''}>
                            ✎
                        </button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" 
                            title="Удалить" ${state.isDeleting ? 'disabled' : ''}>
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
    
    DOM.tableBody.querySelectorAll('.table-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            const id = cb.dataset.id;
            if (cb.checked) {
                state.selectedIds.add(id);
            } else {
                state.selectedIds.delete(id);
            }
            updateSelectAllCheckbox();
        });
    });
}

function updateSelectAllCheckbox() {
    const selectAll = document.getElementById('selectAllCheckbox');
    if (!selectAll) return;
    
    const checkboxes = document.querySelectorAll('.table-checkbox');
    const checkedCount = document.querySelectorAll('.table-checkbox:checked').length;
    
    if (checkedCount === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
    } else {
        selectAll.indeterminate = true;
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function cacheElements() {
    DOM.tableBody = document.getElementById('tableBody');
    DOM.statsBar = document.getElementById('statsBar');
    DOM.categoryFilter = document.getElementById('categoryFilter');
    DOM.searchInput = document.getElementById('searchInput');
    DOM.statusFilter = document.getElementById('statusFilter');
    DOM.sortSelect = document.getElementById('sortSelect');
    DOM.addProductBtn = document.getElementById('addProductBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.errorBanner = document.getElementById('errorBanner');
    DOM.errorMessage = document.getElementById('errorMessage');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
    DOM.syncBadge = document.getElementById('syncBadge');
    DOM.syncStatus = document.getElementById('syncStatus');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.moduleLoading = document.getElementById('moduleLoading');
}

function displayUserInfo() {
    if (DOM.userEmail) {
        if (state.user) {
            const name = state.user.email?.split('@')[0] || 'Пользователь';
            DOM.userEmail.textContent = name;
        } else {
            DOM.userEmail.textContent = 'Гость';
        }
    }
}

function markModuleLoaded() {
    if (DOM.moduleLoading) {
        DOM.moduleLoading.style.display = 'none';
    }
    if (window.markInventoryModuleLoaded) {
        window.markInventoryModuleLoaded();
    }
}

function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            hideError();
            loadProductsData(true);
            if (syncState.isOnline) {
                syncNow();
            }
        });
    }
    
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', openAddProductForm);
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => {
            if (syncState.isOnline) {
                syncNow();
            }
            loadProductsData(true);
        });
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
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                const id = cb.dataset.id;
                if (e.target.checked) {
                    state.selectedIds.add(id);
                } else {
                    state.selectedIds.delete(id);
                }
            });
        });
    }
    
    // События сети
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        updateSyncIndicator();
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету. Работа в офлайн-режиме.', 'warning');
        updateSyncIndicator();
    });
}

function setupSyncSubscription() {
    subscribeToSync((syncState, event) => {
        updateSyncIndicator();
        
        if (!syncState.isOnline) {
            showOfflineBanner();
        } else {
            hideOfflineBanner();
        }
        
        // При завершении синхронизации обновляем данные
        if (event?.type === 'sync-completed' && event.synced > 0) {
            loadProductsData(true);
            showNotification(`Синхронизировано операций: ${event.synced}`, 'success');
        }
    });
}

async function init() {
    console.log('[Inventory] Initializing...');
    
    cacheElements();
    
    // Инициализируем Sync Engine
    await initSyncEngine();
    setupSyncSubscription();
    
    // Проверяем сеть
    if (!syncState.isOnline) {
        showOfflineBanner();
    } else {
        hideOfflineBanner();
    }
    updateSyncIndicator();
    
    // Проверяем авторизацию
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
    } else if (authResult.offline || authResult.networkError) {
        state.user = null;
        showOfflineBanner();
        showNotification('Работа в офлайн-режиме. Некоторые функции недоступны.', 'warning');
    } else if (authResult.authError) {
        return;
    }
    
    displayUserInfo();
    attachEvents();
    
    // Загружаем товары (мгновенно из кэша)
    await loadProductsData();
    
    markModuleLoaded();
    
    console.log('[Inventory] Initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
