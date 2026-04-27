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
 * - Использует sync-engine напрямую для мутирующих операций.
 * - Оптимистичное удаление: товар исчезает сразу, при ошибке восстанавливается.
 * - Подписывается на события `sync-engine` для обновления UI.
 * - Все операции проходят через очередь синхронизации.
 * 
 * @module inventory/index
 * @version 3.1.0
 * @changes
 * - Полностью удалена зависимость от старого модуля operations.js
 * - Удаление теперь через saveChange() из sync-engine
 * - Оптимистичное удаление с восстановлением при ошибке
 * - Добавлена проверка isOnline перед мутирующими операциями
 * - Улучшена обработка ошибок при удалении
 */

import { requireAuth, logout, isOnline } from '../../core/auth.js';
import { debounce, escapeHtml, formatMoney, getCategoryName, getStatusText } from '../../utils/formatters.js';
import { showNotification, showConfirmDialog } from '../../utils/ui.js';
import { 
    initSyncEngine, 
    subscribeToSync, 
    syncNow, 
    syncState,
    loadData,
    saveChange,
    ENTITIES,
    OP_TYPES
} from '../../core/sync-engine.js';
import * as productsModule from './products.js';
import { openProductFormModal } from '../../utils/product-form.js';

// ========== СОСТОЯНИЕ UI ==========

const state = {
    user: null,
    isLoading: false,
    isDeleting: false,
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
    if (DOM.syncBadge) {
        if (syncState.pendingCount > 0) {
            DOM.syncBadge.textContent = syncState.pendingCount;
            DOM.syncBadge.style.display = 'inline-block';
        } else {
            DOM.syncBadge.style.display = 'none';
        }
    }
    
    if (DOM.syncStatus) {
        if (syncState.isSyncing) {
            DOM.syncStatus.textContent = 'Синхронизация...';
            DOM.syncStatus.style.display = 'inline';
        } else if (syncState.pendingCount > 0) {
            DOM.syncStatus.textContent = `Ожидает: ${syncState.pendingCount}`;
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
    updateSelectAllCheckbox();
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

// ========== ОБРАБОТЧИКИ ДЕЙСТВИЙ ==========

/**
 * Удаляет товар оптимистично через Sync Engine
 * 
 * Процесс:
 * 1. Запрашивает подтверждение
 * 2. Оптимистично удаляет из локального стейта
 * 3. Добавляет операцию в очередь синхронизации
 * 4. При ошибке синхронизации восстанавливает товар
 * 
 * @param {string} id - ID товара для удаления
 */
async function deleteProduct(id) {
    if (state.isDeleting) return;
    
    const product = productsModule.getProductById(id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    // Проверяем, не продан ли товар
    if (product.status === 'sold') {
        showNotification('Нельзя удалить проданный товар', 'warning');
        return;
    }
    
    // Запрашиваем подтверждение
    const confirmed = await showConfirmDialog({
        title: 'Удаление товара',
        message: `Вы уверены, что хотите удалить товар "${product.name}"?`,
        confirmText: 'Удалить',
        confirmClass: 'btn-danger'
    });
    
    if (!confirmed) return;
    
    // Сохраняем копию товара для возможности восстановления
    const productBackup = { ...product };
    
    // ОПТИМИСТИЧНОЕ УДАЛЕНИЕ: сразу убираем из локального стейта
    productsModule.removeProductFromState(id);
    state.selectedIds.delete(id);
    render();
    
    // Если офлайн — добавляем в очередь синхронизации
    if (!isOnline()) {
        try {
            await saveChange(ENTITIES.PRODUCTS, OP_TYPES.DELETE, { id }, productBackup);
            
            showNotification(
                `Товар "${product.name}" будет удалён при восстановлении сети`,
                'warning'
            );
            updateSyncIndicator();
        } catch (error) {
            console.error('[Inventory] Failed to enqueue delete operation:', error);
            
            // Восстанавливаем товар при ошибке добавления в очередь
            productsModule.addProductToState(productBackup);
            render();
            showNotification('Не удалось добавить операцию в очередь', 'error');
        }
        return;
    }
    
    // Онлайн — удаляем через Sync Engine
    state.isDeleting = true;
    render();
    
    try {
        // Сначала удаляем фото если есть
        if (product.photo_url) {
            try {
                const supabase = (await import('../../core/auth.js')).getSupabase;
                const client = await supabase();
                const photoPath = product.photo_url.split('/').pop();
                if (photoPath) {
                    await client.storage
                        .from('product-photos')
                        .remove([photoPath]);
                }
            } catch (photoError) {
                console.warn('[Inventory] Photo deletion error (non-critical):', photoError);
            }
        }
        
        // Сохраняем операцию удаления через Sync Engine
        // Это добавит операцию в очередь и немедленно попытается синхронизировать
        await saveChange(ENTITIES.PRODUCTS, OP_TYPES.DELETE, { id }, productBackup);
        
        // Принудительно запускаем синхронизацию
        if (syncState.isOnline) {
            await syncNow();
        }
        
        showNotification(`Товар "${product.name}" удалён`, 'success');
        updateSyncIndicator();
        
        // Перезагружаем товары для актуализации
        setTimeout(() => {
            productsModule.loadProducts(true).then(() => render());
        }, 1000);
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        
        // Восстанавливаем товар в стейте при ошибке
        productsModule.addProductToState(productBackup);
        render();
        
        showNotification('Ошибка удаления: ' + (error.message || 'Неизвестная ошибка'), 'error');
    } finally {
        state.isDeleting = false;
        render();
    }
}

/**
 * Открывает форму редактирования товара
 */
async function openEditProductForm(id) {
    const product = productsModule.getProductById(id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    // Проверяем онлайн
    if (!isOnline()) {
        showNotification('Редактирование товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    try {
        const updatedProduct = await openProductFormModal({
            mode: 'edit',
            initialData: product,
            userId: state.user?.id,
            onSuccess: async (product) => {
                // Обновляем товар в локальном стейте
                productsModule.updateProductInState(id, product);
                render();
                
                // Сохраняем изменение через Sync Engine
                await saveChange(ENTITIES.PRODUCTS, OP_TYPES.UPDATE, product);
                updateSyncIndicator();
                
                showNotification(`Товар "${product.name}" обновлён`, 'success');
            }
        });
        
        if (updatedProduct) {
            productsModule.updateProductInState(id, updatedProduct);
            render();
        }
        
    } catch (error) {
        console.error('[Inventory] Edit error:', error);
        showNotification('Не удалось открыть форму редактирования', 'error');
    }
}

/**
 * Открывает форму добавления товара
 */
async function openAddProductForm() {
    if (!isOnline()) {
        showNotification('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    if (!state.user?.id) {
        showNotification('Не удалось определить пользователя', 'error');
        return;
    }
    
    try {
        const newProduct = await openProductFormModal({
            mode: 'create',
            userId: state.user.id,
            onSuccess: async (product) => {
                // Добавляем товар в локальный стейт
                productsModule.addProductToState(product);
                render();
                
                // Сохраняем через Sync Engine
                await saveChange(ENTITIES.PRODUCTS, OP_TYPES.CREATE, product);
                updateSyncIndicator();
                
                showNotification(`Товар "${product.name}" добавлен`, 'success');
            }
        });
        
        if (newProduct) {
            productsModule.addProductToState(newProduct);
            render();
        }
        
    } catch (error) {
        console.error('[Inventory] Add error:', error);
        showNotification('Не удалось открыть форму добавления', 'error');
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
            render();
        });
    }
    
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', openAddProductForm);
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', async () => {
            if (syncState.isOnline) {
                await syncNow();
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
        syncNow();
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету. Работа в офлайн-режиме.', 'warning');
        updateSyncIndicator();
    });
}

function setupSyncSubscription() {
    subscribeToSync((currentSyncState, event) => {
        updateSyncIndicator();
        
        if (!currentSyncState.isOnline) {
            showOfflineBanner();
        } else {
            hideOfflineBanner();
        }
        
        // При завершении синхронизации обновляем данные
        if (event?.type === 'sync-completed' && event.synced > 0) {
            productsModule.loadProducts(true).then(() => render());
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
    
    // Загружаем товары
    await productsModule.loadProducts();
    render();
    
    markModuleLoaded();
    
    console.log('[Inventory] Initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
