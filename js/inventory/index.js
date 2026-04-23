// ========================================
// FILE: js/inventory/index.js
// ========================================

/**
 * Inventory Page Module - Index
 * 
 * Точка входа для страницы управления складом. Координирует модули данных,
 * синхронизации и рендеринг интерфейса.
 * 
 * Архитектурные решения:
 * - Контроллер управляет состоянием UI и рендерингом.
 * - Делегирует работу с данными в модуль `products.js`.
 * - Делегирует синхронизацию операций в модуль `operations.js`.
 * - Подписывается на события `sync-engine` для обновления UI.
 * 
 * @module inventory/index
 * @version 3.0.0
 * @changes
 * - Полный рефакторинг в тонкий контроллер.
 * - Удалена прямая работа с данными и синхронизацией.
 * - Добавлена координация работы модулей `products` и `operations`.
 * - Соблюдена модульная архитектура.
 */

import { requireAuth, logout } from '../../core/auth.js';
import { debounce, escapeHtml, formatMoney, getCategoryName, getStatusText } from '../../utils/formatters.js';
import { showNotification } from '../../utils/ui.js';
import { initSyncEngine, subscribeToSync, syncNow, syncState } from '../../core/sync-engine.js';
import * as productsModule from './products.js';
import * as operationsModule from './operations.js';
import { openProductFormModal } from '../../utils/product-form.js';

// ========== СОСТОЯНИЕ UI ==========

const state = {
    user: null,
    isLoading: false,
    selectedIds: new Set()
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

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ UI ==========

function showOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'flex';
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'none';
}

function updateSyncIndicator() {
    const stats = operationsModule.getOperationsStats();
    
    if (DOM.syncBadge) {
        if (stats.pending > 0) {
            DOM.syncBadge.textContent = stats.pending;
            DOM.syncBadge.style.display = 'inline-block';
        } else {
            DOM.syncBadge.style.display = 'none';
        }
    }
    
    if (DOM.syncStatus) {
        if (stats.syncing > 0) {
            DOM.syncStatus.textContent = 'Синхронизация...';
            DOM.syncStatus.style.display = 'inline';
        } else if (stats.pending > 0) {
            DOM.syncStatus.textContent = `Ожидает: ${stats.pending}`;
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

function markModuleLoaded() {
    if (DOM.moduleLoading) {
        DOM.moduleLoading.style.display = 'none';
    }
    if (window.markInventoryModuleLoaded) {
        window.markInventoryModuleLoaded();
    }
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
    
    const stats = productsModule.getStats();
    
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
    
    const categories = productsModule.getCategories();
    const selectedCategory = productsModule.getSelectedCategory();
    const currentValue = DOM.categoryFilter.value;
    
    while (DOM.categoryFilter.options.length > 1) {
        DOM.categoryFilter.remove(1);
    }
    
    categories.forEach(cat => {
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
    const isLoading = productsModule.isLoading();
    const filteredProducts = productsModule.getFilteredProducts();
    const searchQuery = productsModule.getSearchQuery();
    const selectedStatus = productsModule.getSelectedStatus();
    const selectedCategory = productsModule.getSelectedCategory();
    
    if (isLoading && filteredProducts.length === 0) {
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
    
    if (filteredProducts.length === 0) {
        let message = 'Товары не найдены';
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
        const isOptimistic = product._optimistic ? 'optimistic' : '';
        
        return `
            <tr class="product-row ${isSelected ? 'selected' : ''} ${isOptimistic}" data-id="${product.id}">
                <td class="checkbox-cell">
                    <input type="checkbox" class="table-checkbox" data-id="${product.id}" 
                        ${state.isLoading ? 'disabled' : ''} ${isSelected ? 'checked' : ''}>
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
                            title="Редактировать" ${state.isLoading ? 'disabled' : ''}>
                            ✎
                        </button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" 
                            title="Удалить" ${state.isLoading ? 'disabled' : ''}>
                            ${state.isLoading ? '⌛' : '✕'}
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    attachRowEvents();
    updateSelectAllCheckbox();
}

function attachRowEvents() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!state.isLoading) {
                openEditProductForm(btn.dataset.id);
            }
        });
    });
    
    DOM.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!state.isLoading) {
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

// ========== ОБРАБОТЧИКИ ДЕЙСТВИЙ ==========

async function deleteProduct(id) {
    const success = await operationsModule.deleteProduct(id);
    if (success) {
        render();
        updateSyncIndicator();
    }
}

async function openEditProductForm(id) {
    const product = productsModule.getProductById(id);
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
                const success = await operationsModule.updateProduct(id, product);
                if (success) {
                    showNotification(`Товар "${product.name}" обновлён`, 'success');
                    productsModule.updateProductInState(id, product);
                    render();
                    updateSyncIndicator();
                }
            }
        });
        
        if (updatedProduct) {
            await operationsModule.updateProduct(id, updatedProduct);
            productsModule.updateProductInState(id, updatedProduct);
            render();
            updateSyncIndicator();
        }
        
    } catch (error) {
        console.error('[Inventory] Edit error:', error);
        showError('Не удалось открыть форму редактирования', 'error');
    }
}

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
                const success = await operationsModule.createProduct(product);
                if (success) {
                    showNotification(`Товар "${product.name}" добавлен`, 'success');
                    productsModule.addProductToState(product);
                    render();
                    updateSyncIndicator();
                }
            }
        });
        
        if (newProduct) {
            await operationsModule.createProduct(newProduct);
            productsModule.addProductToState(newProduct);
            render();
            updateSyncIndicator();
        }
        
    } catch (error) {
        console.error('[Inventory] Add error:', error);
        showError('Не удалось открыть форму добавления', 'error');
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

function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', async () => {
            hideError();
            await productsModule.loadProducts(true);
            await operationsModule.syncPendingOperations();
            render();
        });
    }
    
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', openAddProductForm);
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', async () => {
            if (syncState.isOnline) {
                await operationsModule.syncPendingOperations();
            }
            await productsModule.loadProducts(true);
            render();
        });
    }
    
    if (DOM.searchInput) {
        const debouncedSearch = debounce(() => {
            productsModule.setSearchQuery(DOM.searchInput.value.trim());
            render();
        }, 300);
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            productsModule.setStatusFilter(e.target.value);
            render();
        });
    }
    
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            productsModule.setCategoryFilter(e.target.value);
            render();
        });
    }
    
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            productsModule.setSortBy(e.target.value);
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
            updateSelectAllCheckbox();
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

    // Подписка на изменения в модулях
    productsModule.setProductsChangeCallback(render);
    operationsModule.setOperationsChangeCallback(() => {
        updateSyncIndicator();
        productsModule.loadProducts(true);
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
            productsModule.loadProducts(true);
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
    await productsModule.loadProducts();
    render();
    
    markModuleLoaded();
    
    console.log('[Inventory] Initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
