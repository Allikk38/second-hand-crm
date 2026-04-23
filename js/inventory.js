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
 * - Использование централизованных UI-утилит из utils/ui.js.
 * - Поддержка офлайн-режима при отсутствии сети.
 * 
 * @module inventory
 * @version 3.4.0
 * @changes
 * - Добавлена поддержка офлайн-режима через requireAuth.
 * - Добавлен офлайн-баннер и функция showOfflineBanner.
 * - Исправлено дублирование вызова loadProducts.
 */

import { requireAuth, logout, getCurrentUser, isOnline, getSupabase } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText, getCategoryName, debounce } from '../utils/formatters.js';
import { showNotification, showConfirmDialog } from '../utils/ui.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_CACHE_KEY = 'sh_inventory_products';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// ========== СОСТОЯНИЕ ==========

const state = {
    user: null,
    isOffline: false,
    products: [],
    filteredProducts: [],
    isLoading: false,
    searchQuery: '',
    selectedStatus: '',
    selectedCategory: '',
    sortBy: 'created_at-desc',
    categories: []
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    tableBody: null,
    statsBar: null,
    errorBanner: null,
    errorMessage: null,
    emptyState: null,
    searchInput: null,
    statusFilter: null,
    categoryFilter: null,
    sortSelect: null,
    addProductBtn: null,
    refreshBtn: null,
    logoutBtn: null,
    userEmail: null,
    modalContainer: null,
    offlineBanner: null,
    offlineRetryBtn: null
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Показывает офлайн-баннер
 */
function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'block';
    }
}

/**
 * Скрывает офлайн-баннер
 */
function hideOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'none';
    }
}

/**
 * Показывает ошибку в баннере или через уведомление
 * @param {string} message - Сообщение об ошибке
 * @param {string} type - Тип ошибки (error, success, warning, info)
 */
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

/**
 * Скрывает баннер ошибки
 */
function hideError() {
    if (DOM.errorBanner) {
        DOM.errorBanner.style.display = 'none';
    }
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Сохраняет товары в кэш
 * @param {Array} products - Массив товаров
 */
function saveProductsToCache(products) {
    try {
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            data: products,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('[Inventory] Failed to cache products:', e);
    }
}

/**
 * Загружает товары из кэша
 * @returns {Array|null}
 */
function loadProductsFromCache() {
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) {
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

/**
 * Загружает список товаров
 * @param {boolean} forceRefresh - Принудительно обновить без кэша
 */
async function loadProducts(forceRefresh = false) {
    if (state.isLoading) return;
    
    // Проверяем кэш при офлайн-режиме
    if (!forceRefresh && !isOnline()) {
        const cached = loadProductsFromCache();
        if (cached) {
            state.products = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            showNotification('Работа в офлайн-режиме (данные из кэша)', 'warning');
            return;
        }
    }
    
    if (!isOnline()) {
        showError('Отсутствует подключение к интернету', 'warning');
        return;
    }
    
    state.isLoading = true;
    renderLoadingState();
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        state.products = data || [];
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        hideOfflineBanner();
        
    } catch (error) {
        console.error('[Inventory] Load products error:', error);
        showError('Ошибка загрузки товаров: ' + error.message);
        
        // Пробуем загрузить из кэша
        const cached = loadProductsFromCache();
        if (cached) {
            state.products = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            showNotification('Загружены данные из кэша', 'info');
        }
    } finally {
        state.isLoading = false;
        render();
    }
}

/**
 * Обновляет список категорий в фильтре
 */
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

/**
 * Применяет фильтры к списку товаров
 */
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
    render();
}

/**
 * Сортирует товары
 * @param {Array} products - Массив товаров
 * @param {string} sortBy - Критерий сортировки
 * @returns {Array}
 */
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

/**
 * Обновляет панель статистики
 */
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
 * Удаляет товар
 * @param {string} id - ID товара
 */
async function deleteProduct(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    
    const confirmed = await showConfirmDialog({
        title: 'Удаление товара',
        message: `Вы уверены, что хотите удалить товар "${product.name}"? Это действие нельзя отменить.`,
        confirmText: 'Удалить'
    });
    
    if (!confirmed) return;
    
    if (!isOnline()) {
        showError('Отсутствует подключение к интернету', 'warning');
        return;
    }
    
    try {
        const supabase = await getSupabase();
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        state.products = state.products.filter(p => p.id !== id);
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        
        showNotification('Товар удален', 'success');
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        showError('Ошибка удаления: ' + error.message);
    }
}

/**
 * Открывает форму добавления товара
 */
function openAddProductForm() {
    if (!isOnline()) {
        showError('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    showNotification('Функция добавления товара в разработке', 'info');
}

/**
 * Открывает форму редактирования товара
 * @param {string} id - ID товара
 */
function openEditProductForm(id) {
    if (!isOnline()) {
        showError('Редактирование товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    showNotification(`Редактирование товара ${id} в разработке`, 'info');
}

// ========== РЕНДЕРИНГ ==========

/**
 * Отрисовывает состояние загрузки
 */
function renderLoadingState() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <span style="margin-left: 12px;">Загрузка товаров...</span>
            </td>
        </tr>
    `;
}

/**
 * Отрисовывает пустое состояние
 */
function renderEmptyState() {
    if (!DOM.tableBody) return;
    
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
}

/**
 * Получает CSS-класс для статуса
 * @param {string} status - Ключ статуса
 * @returns {string}
 */
function getStatusClass(status) {
    const classes = {
        'in_stock': 'status-in_stock',
        'sold': 'status-sold',
        'reserved': 'status-reserved',
        'draft': 'status-draft'
    };
    return classes[status] || 'status-unknown';
}

/**
 * Главная функция рендеринга
 */
function render() {
    if (!DOM.tableBody) return;
    
    if (state.isLoading && state.products.length === 0) {
        renderLoadingState();
        return;
    }
    
    if (state.filteredProducts.length === 0) {
        renderEmptyState();
        return;
    }
    
    const productsTable = document.getElementById('productsTable');
    if (productsTable) {
        productsTable.style.display = 'table';
    }
    
    DOM.tableBody.innerHTML = state.filteredProducts.map(product => {
        const statusText = getStatusText(product.status);
        const statusClass = getStatusClass(product.status);
        const safeName = escapeHtml(product.name || 'Без названия');
        const safeId = escapeHtml(product.id?.slice(0, 8) || '—');
        const safePhotoUrl = product.photo_url ? escapeHtml(product.photo_url) : null;
        
        return `
            <tr class="product-row" data-id="${product.id}">
                <td class="checkbox-cell">
                    <input type="checkbox" class="table-checkbox" data-id="${product.id}">
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
                        <button class="btn-icon" data-action="edit" data-id="${product.id}" title="Редактировать">
                            ✎
                        </button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" title="Удалить">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    attachRowEvents();
}

/**
 * Привязывает обработчики к кнопкам в строках таблицы
 */
function attachRowEvents() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditProductForm(btn.dataset.id);
        });
    });
    
    DOM.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProduct(btn.dataset.id);
        });
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Кэширует DOM элементы
 */
function cacheElements() {
    DOM.tableBody = document.getElementById('tableBody');
    DOM.statsBar = document.getElementById('statsBar');
    DOM.errorBanner = document.getElementById('errorBanner');
    DOM.errorMessage = document.getElementById('errorMessage');
    DOM.emptyState = document.getElementById('emptyState');
    DOM.searchInput = document.getElementById('searchInput');
    DOM.statusFilter = document.getElementById('statusFilter');
    DOM.categoryFilter = document.getElementById('categoryFilter');
    DOM.sortSelect = document.getElementById('sortSelect');
    DOM.addProductBtn = document.getElementById('addProductBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
}

/**
 * Отображает email пользователя в шапке
 */
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

/**
 * Привязывает обработчики событий
 */
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
        DOM.offlineRetryBtn.addEventListener('click', () => {
            loadProducts(true);
        });
    }
    
    if (DOM.searchInput) {
        const debouncedSearch = debounce(() => {
            state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
            applyFilters();
        }, 300);
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            state.selectedStatus = e.target.value;
            applyFilters();
        });
    }
    
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            state.selectedCategory = e.target.value;
            applyFilters();
        });
    }
    
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            applyFilters();
        });
    }
    
    // Закрытие баннера ошибки
    const closeErrorBtn = document.getElementById('closeErrorBtn');
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', hideError);
    }
    
    // Выделение всех чекбоксов
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.table-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
    }
    
    // Слушатели сети
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        if (!state.user) {
            // Можно попробовать переинициализировать
            location.reload();
        }
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Inventory] Initializing MPA page...');
    
    cacheElements();
    
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
        state.isOffline = false;
        hideOfflineBanner();
    } else if (authResult.offline || authResult.networkError) {
        state.isOffline = true;
        state.user = null;
        showOfflineBanner();
        showNotification('Работа в офлайн-режиме. Некоторые функции недоступны.', 'warning');
    } else if (authResult.authError) {
        // Уже произошел редирект
        return;
    }
    
    displayUserInfo();
    attachEvents();
    
    await loadProducts();
    
    console.log('[Inventory] Page initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
