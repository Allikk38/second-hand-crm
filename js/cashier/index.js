// ========================================
// FILE: js/cashier/index.js
// ========================================

/**
 * Cashier Page Module - Index
 * 
 * Точка входа для страницы кассового модуля.
 * Связывает подмодули (cart, shift, products), управляет рендерингом
 * и обработчиками событий.
 * 
 * Архитектурные решения:
 * - Делегирование бизнес-логики подмодулям (cart.js, shift.js, products.js).
 * - Централизованный рендеринг с реактивностью через колбэки.
 * - Клавиатурные сокращения (F9, Ctrl+F).
 * - Поддержка офлайн-режима.
 * 
 * @module cashier/index
 * @version 1.0.0
 */

import { requireAuth, logout, isOnline, getSupabase } from '../../core/auth.js';
import { formatMoney, escapeHtml, getCategoryName, getPaymentMethodName } from '../../utils/formatters.js';
import { showNotification, showPaymentModal } from '../../utils/ui.js';

// Подмодули
import {
    cartState,
    setCartChangeCallback,
    calculateCartCount,
    calculateItemTotal,
    calculateCartTotal,
    loadCartFromCache,
    saveCartToCache,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    resetCart,
    isCartEmpty,
    getCartTotal,
    getCartCount,
    getCartItems
} from './cart.js';

import {
    shiftState,
    setShiftChangeCallback,
    isShiftOpen,
    getCurrentShiftId,
    loadShiftFromCache,
    checkOpenShift,
    openShift,
    closeShift
} from './shift.js';

import {
    productsState,
    setProductsChangeCallback,
    loadProducts,
    setSearchQuery,
    setSelectedCategory,
    resetFilters,
    createScannerHandler,
    openQuickAddProductForm,
    getFilteredProducts,
    getCategories,
    isLoading,
    getSearchQuery,
    getSelectedCategory
} from './products.js';

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

const state = {
    user: null,
    isOffline: false,
    errorMessage: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    content: null,
    userEmail: null,
    logoutBtn: null,
    offlineBanner: null,
    offlineRetryBtn: null
};

// ========== ОФЛАЙН-БАННЕР ==========

function showOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'flex';
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) DOM.offlineBanner.style.display = 'none';
}

// ========== ПРОВЕРКА НАЛИЧИЯ ТОВАРОВ ==========

async function checkStockAvailability() {
    if (!isOnline()) return false;
    
    const items = getCartItems();
    if (items.length === 0) return true;
    
    try {
        const supabase = await getSupabase();
        const productIds = items.map(i => i.id);
        
        const { data, error } = await supabase
            .from('products')
            .select('id, status, name')
            .in('id', productIds);
        
        if (error) throw error;
        
        const productMap = new Map(data.map(p => [p.id, p]));
        const unavailableItems = items.filter(item => {
            const product = productMap.get(item.id);
            return !product || product.status !== 'in_stock';
        });
        
        if (unavailableItems.length > 0) {
            const names = unavailableItems.map(i => i.name).join(', ');
            showNotification(`Товары больше не доступны: ${names}`, 'error');
            
            // Удаляем недоступные товары из корзины
            unavailableItems.forEach(item => removeFromCart(item.id));
            
            return false;
        }
        
        return true;
        
    } catch (error) {
        console.error('[Cashier] Stock check error:', error);
        return false;
    }
}

// ========== ОФОРМЛЕНИЕ ПРОДАЖИ ==========

async function checkout() {
    if (isCartEmpty()) {
        showNotification('Корзина пуста', 'warning');
        return;
    }
    
    if (!isShiftOpen()) {
        showNotification('Смена не открыта', 'warning');
        return;
    }
    
    if (!isOnline()) {
        showNotification('Невозможно оформить продажу в офлайн-режиме', 'error');
        return;
    }
    
    // Проверяем доступность товаров
    const stockOk = await checkStockAvailability();
    if (!stockOk) {
        return;
    }
    
    const total = getCartTotal();
    const paymentMethod = await showPaymentModal(total);
    if (!paymentMethod) return;
    
    // Блокируем интерфейс
    productsState.isLoading = true;
    render();
    
    try {
        const supabase = await getSupabase();
        const items = getCartItems();
        
        const saleItems = items.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            cost_price: item.cost_price || 0,
            quantity: item.quantity,
            discount: item.discount || 0
        }));
        
        const profit = items.reduce((sum, item) => {
            const discountedPrice = (item.price || 0) * (1 - (item.discount || 0) / 100);
            return sum + ((discountedPrice - (item.cost_price || 0)) * (item.quantity || 0));
        }, 0);
        
        // Создаём запись о продаже
        const { error: saleError } = await supabase
            .from('sales')
            .insert({
                shift_id: getCurrentShiftId(),
                items: saleItems,
                total,
                profit,
                payment_method: paymentMethod,
                created_by: state.user?.id,
                created_at: new Date().toISOString()
            });
        
        if (saleError) throw saleError;
        
        // Обновляем статус товаров
        const productIds = items.map(i => i.id);
        await supabase
            .from('products')
            .update({ 
                status: 'sold', 
                sold_at: new Date().toISOString() 
            })
            .in('id', productIds);
        
        // Обновляем статистику смены
        const { loadShiftStats } = await import('./shift.js');
        await loadShiftStats();
        
        // Очищаем корзину
        resetCart();
        
        // Перезагружаем товары
        await loadProducts(true);
        
        showNotification(`Продажа на ${formatMoney(total)}`, 'success');
        showReceipt(items, total, paymentMethod);
        
    } catch (error) {
        console.error('[Cashier] Checkout error:', error);
        showNotification('Ошибка оформления продажи: ' + error.message, 'error');
    } finally {
        productsState.isLoading = false;
        render();
    }
}

/**
 * Показывает модальное окно с чеком
 */
function showReceipt(items, total, paymentMethod) {
    const receiptLines = items.map(item => 
        `${item.name} x${item.quantity} = ${formatMoney((item.price || 0) * (item.quantity || 0))}`
    ).join('\n');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal receipt-modal">
            <div class="modal-header">
                <h3>Чек</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <pre class="receipt-text">${escapeHtml(receiptLines)}</pre>
                <hr>
                <div class="receipt-total">
                    <strong>ИТОГО: ${formatMoney(total)}</strong>
                </div>
                <div class="receipt-method">
                    Оплата: ${getPaymentMethodName(paymentMethod)}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" data-action="close">Закрыть</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const closeHandler = () => modal.remove();
    modal.querySelector('.btn-close').addEventListener('click', closeHandler);
    modal.querySelector('[data-action="close"]').addEventListener('click', closeHandler);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeHandler();
    });
}

// ========== РЕНДЕРИНГ ==========

/**
 * Рендерит панель смены
 */
function renderShiftBar() {
    if (!isShiftOpen()) return '';
    
    return `
        <div class="shift-bar">
            <div class="shift-status">
                <span class="status-dot"></span>
                <span>Смена открыта</span>
            </div>
            <div class="shift-stats">
                <div class="stat-item">
                    <span class="stat-label">Выручка</span>
                    <span class="stat-value">${formatMoney(shiftState.stats.revenue)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Продаж</span>
                    <span class="stat-value">${shiftState.stats.salesCount}</span>
                </div>
            </div>
            <button class="btn-secondary btn-sm" id="closeShiftBtn" ${shiftState.isActionPending ? 'disabled' : ''}>
                ${shiftState.isActionPending ? 'Закрытие...' : 'Закрыть смену'}
            </button>
        </div>
    `;
}

/**
 * Рендерит панель инструментов
 */
function renderToolbar() {
    const searchQuery = getSearchQuery();
    const categories = getCategories();
    const selectedCategory = getSelectedCategory();
    const allCount = productsState.all.length;
    
    return `
        <div class="products-toolbar">
            <div class="toolbar-left">
                <div class="search-wrapper">
                    <input type="text" id="searchInput" class="search-input" 
                        placeholder="Поиск товара или сканирование штрихкода..." 
                        value="${escapeHtml(searchQuery)}">
                </div>
                <button class="quick-add-btn" id="quickAddProductBtn" title="Быстрое добавление товара">
                    <span class="icon">➕</span>
                    <span>Быстрый товар</span>
                </button>
            </div>
            
            <div class="toolbar-right">
                <button class="btn-secondary btn-sm" id="resetFiltersBtn" 
                    style="${(searchQuery || selectedCategory) ? '' : 'display: none;'}">
                    Сбросить фильтры
                </button>
            </div>
        </div>
        <div class="category-bar">
            <button class="category-tab ${!selectedCategory ? 'active' : ''}" data-category="">
                Все (${allCount})
            </button>
            ${categories.map(c => `
                <button class="category-tab ${selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">
                    ${getCategoryName(c.value)} (${c.count})
                </button>
            `).join('')}
        </div>
    `;
}

/**
 * Рендерит сетку товаров
 */
function renderProductsGrid() {
    if (isLoading()) {
        return '<div class="loading-spinner"></div>';
    }
    
    const filteredProducts = getFilteredProducts();
    
    if (filteredProducts.length === 0) {
        const message = getSearchQuery() || getSelectedCategory() 
            ? 'По вашему запросу ничего не найдено'
            : 'Товары не найдены. Добавьте товар через кнопку "Быстрый товар".';
        
        return `<div class="empty-state">${message}</div>`;
    }
    
    return `
        <div class="products-grid">
            ${filteredProducts.map(p => `
                <div class="product-card" data-id="${p.id}">
                    <div class="product-photo">
                        ${p.photo_url 
                            ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}" loading="lazy">` 
                            : '<span class="photo-placeholder">📦</span>'
                        }
                    </div>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(p.name)}</div>
                        <div class="product-price">${formatMoney(p.price)}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Рендерит корзину
 */
function renderCart() {
    const items = getCartItems();
    const cartCount = getCartCount();
    const cartTotal = getCartTotal();
    
    const itemsHtml = items.length === 0 
        ? '<div class="cart-empty">Корзина пуста</div>'
        : items.map(item => {
            const itemTotal = calculateItemTotal(item);
            const hasDiscount = (item.discount || 0) > 0;
            
            return `
                <div class="cart-item ${hasDiscount ? 'has-discount' : ''}">
                    <div class="cart-item-main">
                        <div class="cart-item-info">
                            <span class="cart-item-name">${escapeHtml(item.name)}</span>
                            ${hasDiscount 
                                ? `<span class="discount-badge">-${item.discount}%</span>` 
                                : ''}
                        </div>
                        <div class="cart-item-actions">
                            <div class="quantity-control">
                                <button class="btn-qty" data-action="decrease" data-id="${item.id}" ${item.quantity <= 1 ? 'disabled' : ''}>−</button>
                                <span class="qty-input">${item.quantity}</span>
                                <button class="btn-qty" data-action="increase" data-id="${item.id}">+</button>
                            </div>
                            <span class="item-total">${formatMoney(itemTotal)}</span>
                            <button class="btn-remove" data-action="remove" data-id="${item.id}" title="Удалить">✕</button>
                        </div>
                    </div>
                    <div class="cart-item-prices">
                        <span class="item-price">${formatMoney(item.price)} / шт.</span>
                        ${hasDiscount 
                            ? `<span class="original-price">${formatMoney(item.price)}</span>
                               <span class="discounted-price">${formatMoney(item.price * (1 - item.discount / 100))}</span>`
                            : ''}
                    </div>
                </div>
            `;
        }).join('');
    
    const hasTotalDiscount = cartState.totalDiscount > 0;
    const subtotal = items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
    
    return `
        <div class="cart-panel">
            <div class="cart-header">
                <h3>🛒 Корзина</h3>
                <span class="cart-count">${cartCount} поз.</span>
                ${items.length > 0 ? '<button class="btn-ghost btn-sm" id="clearCartBtn">Очистить</button>' : ''}
            </div>
            
            <div class="cart-items-container">
                <div class="cart-items">
                    ${itemsHtml}
                </div>
            </div>
            
            <div class="cart-footer">
                <div class="cart-summary">
                    ${hasTotalDiscount ? `
                        <div class="summary-row">
                            <span>Сумма без скидки</span>
                            <span>${formatMoney(subtotal)}</span>
                        </div>
                        <div class="summary-row text-success">
                            <span>Скидка ${cartState.totalDiscount}%</span>
                            <span>-${formatMoney(subtotal * cartState.totalDiscount / 100)}</span>
                        </div>
                    ` : ''}
                    <div class="summary-row total">
                        <span>ИТОГО</span>
                        <span class="total-amount">${formatMoney(cartTotal)}</span>
                    </div>
                </div>
                
                <button class="btn-checkout" id="checkoutBtn" ${items.length === 0 ? 'disabled' : ''}>
                    Оформить продажу (F9)
                </button>
                
                <div class="keyboard-hints">
                    <kbd>F9</kbd> — оформить
                    <kbd>Ctrl</kbd> + <kbd>F</kbd> — поиск
                </div>
            </div>
        </div>
    `;
}

/**
 * Главная функция рендеринга
 */
function render() {
    if (!DOM.content) return;
    
    if (!isShiftOpen()) {
        renderClosedShift();
        return;
    }
    
    DOM.content.innerHTML = `
        <div class="cashier-layout">
            <div class="products-panel">
                ${renderShiftBar()}
                ${renderToolbar()}
                <div class="products-grid-container">
                    ${renderProductsGrid()}
                </div>
            </div>
            
            ${renderCart()}
        </div>
    `;
    
    attachRenderEvents();
}

/**
 * Рендерит экран закрытой смены
 */
function renderClosedShift() {
    DOM.content.innerHTML = `
        <div class="shift-closed-overlay">
            <div class="shift-closed-icon">🔒</div>
            <h2>Смена закрыта</h2>
            <p>Для начала работы откройте смену</p>
            <button class="btn-primary btn-lg" id="openShiftBtn" ${shiftState.isActionPending ? 'disabled' : ''}>
                ${shiftState.isActionPending ? 'Открытие...' : 'Открыть смену'}
            </button>
        </div>
    `;
    
    document.getElementById('openShiftBtn')?.addEventListener('click', async () => {
        const success = await openShift(state.user?.id);
        if (success) {
            showNotification('Смена открыта', 'success');
        } else {
            showNotification('Ошибка открытия смены', 'error');
        }
    });
}

/**
 * Привязывает обработчики событий после рендеринга
 */
function attachRenderEvents() {
    // Закрытие смены
    document.getElementById('closeShiftBtn')?.addEventListener('click', async () => {
        const success = await closeShift();
        if (success) {
            showNotification('Смена закрыта', 'success');
            resetCart();
        } else {
            showNotification('Ошибка закрытия смены', 'error');
        }
    });
    
    // Очистка корзины
    document.getElementById('clearCartBtn')?.addEventListener('click', clearCart);
    
    // Оформление продажи
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
    
    // Быстрое добавление товара
    document.getElementById('quickAddProductBtn')?.addEventListener('click', () => {
        openQuickAddProductForm(state.user?.id);
    });
    
    // Сброс фильтров
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
        resetFilters();
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
    });
    
    // Поиск и сканер
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const scannerHandler = createScannerHandler(
            (product) => {
                addToCart(product);
                showNotification(`${product.name} добавлен в корзину`, 'success');
                searchInput.value = '';
                setSearchQuery('');
            },
            (code) => {
                // Не найдено - используем как поисковый запрос
                setSearchQuery(code);
            }
        );
        
        searchInput.addEventListener('input', (e) => {
            scannerHandler(e.target.value);
        });
        
        // Фокус при загрузке
        searchInput.focus();
    }
    
    // Категории
    document.querySelectorAll('[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category || null;
            setSelectedCategory(category);
        });
    });
    
    // Карточки товаров
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const productId = card.dataset.id;
            const product = productsState.all.find(p => p.id === productId);
            if (product) {
                addToCart(product);
                showNotification(`${product.name} добавлен в корзину`, 'success');
            }
        });
    });
    
    // Действия с корзиной
    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const { action, id } = btn.dataset;
            
            if (action === 'increase') updateQuantity(id, 1);
            if (action === 'decrease') updateQuantity(id, -1);
            if (action === 'remove') removeFromCart(id);
        });
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Отображает email пользователя
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
 * Кэширует DOM элементы
 */
function cacheElements() {
    DOM.content = document.getElementById('cashierContent');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
}

/**
 * Привязывает глобальные обработчики
 */
function attachGlobalEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => {
            loadProducts(true);
            checkOpenShift(state.user?.id);
        });
    }
    
    // Клавиатурные сокращения
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput')?.focus();
        }
        
        if (e.key === 'F9') {
            e.preventDefault();
            if (!isCartEmpty()) checkout();
        }
        
        if (e.key === 'Escape') {
            document.getElementById('searchInput')?.blur();
        }
    });
    
    // События сети
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        loadProducts(true);
        checkOpenShift(state.user?.id);
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

/**
 * Настраивает реактивность подмодулей
 */
function setupReactivity() {
    // При изменении в подмодулях перерисовываем интерфейс
    setCartChangeCallback(render);
    setShiftChangeCallback(render);
    setProductsChangeCallback(render);
}

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Cashier] Initializing MPA page...');
    
    cacheElements();
    setupReactivity();
    
    // Проверяем авторизацию
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
        return;
    }
    
    displayUserInfo();
    attachGlobalEvents();
    
    // Загружаем данные из кэша
    loadCartFromCache();
    loadShiftFromCache();
    
    // Проверяем смену и загружаем товары
    if (state.user?.id) {
        await checkOpenShift(state.user.id);
    }
    await loadProducts();
    
    console.log('[Cashier] Page initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
