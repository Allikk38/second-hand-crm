// ========================================
// FILE: js/inventory/index.js
// ========================================

/**
 * Inventory Page Module - Index
 * 
 * Точка входа для страницы управления складом.
 * Связывает подмодули (products, operations), управляет рендерингом
 * и обработчиками событий.
 * 
 * Архитектурные решения:
 * - Делегирование бизнес-логики подмодулям (products.js, operations.js).
 * - Централизованный рендеринг с реактивностью через колбэки.
 * - Поддержка офлайн-режима с отображением статуса синхронизации.
 * 
 * @module inventory/index
 * @version 1.0.0
 */

import { requireAuth, logout, isOnline } from '../../core/auth.js';
import { 
    formatMoney, 
    escapeHtml, 
    getStatusText, 
    getCategoryName, 
    debounce 
} from '../../utils/formatters.js';
import { showNotification, showConfirmDialog } from '../../utils/ui.js';
import { openProductFormModal } from '../../utils/product-form.js';

// Подмодули
import {
    productsState,
    setProductsChangeCallback,
    loadProducts,
    refreshProductsList,
    setSearchQuery,
    setStatusFilter,
    setCategoryFilter,
    setSortBy,
    addProductToState,
    updateProductInState,
    removeProductFromState,
    getFilteredProducts,
    getCategories,
    getStats,
    getProductById,
    isLoading,
    isOffline,
    getSearchQuery,
    getSelectedStatus,
    getSelectedCategory,
    getSortBy
} from './products.js';

import {
    operationsState,
    setOperationsChangeCallback,
    loadPendingOperations,
    addPendingOperation,
    getPendingCount,
    hasPendingOperations,
    syncPendingOperations,
    startBackgroundSync,
    stopBackgroundSync,
    getOperationsStats
} from './operations.js';

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

const state = {
    user: null,
    isDeleting: false,
    selectedIds: new Set()
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    // Контейнеры
    tableBody: null,
    statsBar: null,
    categoryFilter: null,
    
    // Элементы управления
    searchInput: null,
    statusFilter: null,
    sortSelect: null,
    addProductBtn: null,
    refreshBtn: null,
    
    // Баннеры и уведомления
    errorBanner: null,
    errorMessage: null,
    offlineBanner: null,
    offlineRetryBtn: null,
    syncBadge: null,
    
    // Пользователь
    userEmail: null,
    logoutBtn: null,
    
    // Загрузка
    moduleLoading: null
};

// ========== ОТОБРАЖЕНИЕ БАННЕРОВ ==========

function showOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'flex';
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'none';
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

// ========== ИНДИКАТОР СИНХРОНИЗАЦИИ ==========

function updateSyncIndicator() {
    const pendingCount = getPendingCount();
    
    if (DOM.syncBadge) {
        if (pendingCount > 0) {
            DOM.syncBadge.textContent = pendingCount;
            DOM.syncBadge.style.display = 'inline-block';
        } else {
            DOM.syncBadge.style.display = 'none';
        }
    }
    
    // Обновляем информацию в офлайн-баннере
    const lastSyncSpan = document.getElementById('lastSyncTime');
    if (lastSyncSpan) {
        const stats = getOperationsStats();
        if (stats.lastSyncTime) {
            const timeStr = new Date(stats.lastSyncTime).toLocaleString('ru-RU');
            lastSyncSpan.textContent = `Последняя синхронизация: ${timeStr}`;
        } else {
            lastSyncSpan.textContent = '';
        }
    }
}

// ========== ОТМЕТКА ЗАГРУЗКИ МОДУЛЯ ==========

function markModuleLoaded() {
    if (DOM.moduleLoading) {
        DOM.moduleLoading.style.display = 'none';
    }
    if (window.markInventoryModuleLoaded) {
        window.markInventoryModuleLoaded();
    }
}

// ========== CRUD ОПЕРАЦИИ ==========

/**
 * Удаляет товар (оптимистично, через очередь)
 */
async function deleteProduct(id) {
    if (state.isDeleting) return;
    
    const product = getProductById(id);
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
    
    // ОПТИМИСТИЧНОЕ УДАЛЕНИЕ: НЕМЕДЛЕННО удаляем из локального стейта
    // Товар НЕ восстанавливается при ошибке синхронизации
    const removed = removeProductFromState(id);
    if (!removed) return;
    
    // Если офлайн или сервер недоступен — добавляем в очередь
    if (!isOnline() || isOffline()) {
        addPendingOperation({
            type: 'delete',
            productId: id,
            product: product
        });
        
        updateSyncIndicator();
        showNotification(
            `Товар "${product.name}" будет удалён при восстановлении сети`,
            'warning'
        );
        return;
    }
    
    // Онлайн — удаляем через очередь (для единообразия)
    state.isDeleting = true;
    render();
    
    try {
        // Добавляем в очередь и сразу синхронизируем
        addPendingOperation({
            type: 'delete',
            productId: id,
            product: product
        });
        
        const result = await syncPendingOperations();
        
        if (result.synced > 0) {
            showNotification(`Товар "${product.name}" удалён`, 'success');
        } else {
            showNotification(
                `Товар "${product.name}" будет удалён при восстановлении сети`,
                'warning'
            );
        }
        
        updateSyncIndicator();
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        showError('Ошибка удаления: ' + error.message);
    } finally {
        state.isDeleting = false;
        render();
    }
}

/**
 * Открывает форму добавления товара
 */
async function openAddProductForm() {
    if (!isOnline()) {
        showError('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    if (!state.user?.id) {
        showError('Не удалось определить пользователя', 'error');
        return;
    }
    
    try {
        const newProduct = await openProductFormModal({
            mode: 'create',
            userId: state.user.id,
            onSuccess: (product) => {
                addProductToState(product);
                showNotification(`Товар "${product.name}" добавлен`, 'success');
            }
        });
        
        if (newProduct && !getProductById(newProduct.id)) {
            addProductToState(newProduct);
            showNotification(`Товар "${newProduct.name}" добавлен`, 'success');
        }
        
    } catch (error) {
        console.error('[Inventory] Add product error:', error);
        
        if (!isOnline() || isOffline()) {
            showError('Сервер недоступен. Добавьте товар позже.', 'warning');
        } else {
            showError('Не удалось открыть форму добавления', 'error');
        }
    }
}

/**
 * Открывает форму редактирования товара
 */
async function openEditProductForm(id) {
    if (!isOnline() || isOffline()) {
        showError('Редактирование товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    const product = getProductById(id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    try {
        const updatedProduct = await openProductFormModal({
            mode: 'edit',
            initialData: product,
            userId: state.user?.id,
            onSuccess: (product) => {
                updateProductInState(id, product);
                showNotification(`Товар "${product.name}" обновлён`, 'success');
            }
        });
        
        if (updatedProduct) {
            updateProductInState(id, updatedProduct);
            showNotification(`Товар "${updatedProduct.name}" обновлён`, 'success');
        }
        
    } catch (error) {
        console.error('[Inventory] Edit product error:', error);
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
    const stats = getStats();
    
    if (!DOM.statsBar) return;
    
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
    
    const categories = getCategories();
    const selectedCategory = getSelectedCategory();
    const currentValue = DOM.categoryFilter.value;
    
    while (DOM.categoryFilter.options.length > 1) {
        DOM.categoryFilter.remove(1);
    }
    
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = getCategoryName(cat);
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
    const filteredProducts = getFilteredProducts();
    const loading = isLoading();
    
    // Состояние загрузки
    if (loading && productsState.all.length === 0) {
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
    
    // Пустое состояние
    if (filteredProducts.length === 0) {
        let message = 'Товары не найдены';
        const searchQuery = getSearchQuery();
        const selectedStatus = getSelectedStatus();
        const selectedCategory = getSelectedCategory();
        
        if (searchQuery || selectedStatus || selectedCategory) {
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
    
    DOM.tableBody.innerHTML = filteredProducts.map(product => {
        const statusText = getStatusText(product.status);
        const statusClass = getStatusClass(product.status);
        const safeName = escapeHtml(product.name || 'Без названия');
        const safeId = escapeHtml(product.id?.slice(0, 8) || '—');
        const safePhotoUrl = product.photo_url ? escapeHtml(product.photo_url) : null;
        const isSelected = state.selectedIds.has(product.id);
        
        return `
            <tr class="product-row ${isSelected ? 'selected' : ''}" data-id="${product.id}">
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
    
    DOM.tableBody.querySelectorAll('.product-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox' || e.target.tagName === 'BUTTON') return;
            
            const checkbox = row.querySelector('.table-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                const id = checkbox.dataset.id;
                if (checkbox.checked) {
                    state.selectedIds.add(id);
                } else {
                    state.selectedIds.delete(id);
                }
                updateSelectAllCheckbox();
                row.classList.toggle('selected', checkbox.checked);
            }
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
            setSearchQuery(DOM.searchInput.value);
        }, 300);
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            setStatusFilter(e.target.value);
        });
    }
    
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            setCategoryFilter(e.target.value);
        });
    }
    
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            setSortBy(e.target.value);
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
    
    window.addEventListener('online', () => {
        if (isOffline()) {
            hideOfflineBanner();
            showNotification('Соединение восстановлено', 'success');
            syncPendingOperations().then(() => loadProducts(true));
        }
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

function setupReactivity() {
    setProductsChangeCallback(() => {
        render();
        updateSyncIndicator();
    });
    
    setOperationsChangeCallback(() => {
        updateSyncIndicator();
        
        // Если пришёл сигнал о необходимости обновления данных
        const callback = (data) => {
            if (data?.needsRefresh) {
                loadProducts(true);
            }
        };
        
        // Переопределяем колбэк
        setOperationsChangeCallback((data) => {
            updateSyncIndicator();
            callback(data);
        });
    });
}

async function init() {
    console.log('[Inventory] Initializing MPA page...');
    
    cacheElements();
    loadPendingOperations();
    setupReactivity();
    
    // Проверяем офлайн-статус
    if (!isOnline()) {
        showOfflineBanner();
    }
    
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
    
    // Загружаем товары
    await loadProducts();
    
    // Запускаем фоновую синхронизацию
    startBackgroundSync();
    
    // Обновляем индикатор синхронизации
    updateSyncIndicator();
    
    markModuleLoaded();
    
    console.log('[Inventory] Page initialized');
}

// Очистка при уходе со страницы
window.addEventListener('beforeunload', () => {
    stopBackgroundSync();
});

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
