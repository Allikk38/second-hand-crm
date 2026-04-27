// ========================================
// FILE: js/cashier/index.js
// ========================================

/**
 * Cashier Page Module - Index (Supabase Version)
 * 
 * Точка входа для страницы кассового модуля.
 * Использует подмодули cart.js, shift.js, products.js.
 * Работает напрямую через Supabase (core/db.js + core/auth.js).
 * 
 * @module cashier/index
 * @version 3.1.0
 * @changes
 * - v3.1.0: Исправлены вызовы calculateCartCount/calculateCartTotal (теперь без аргументов).
 * - v3.0.1: getSupabase() теперь с await (официальный SDK)
 * - v3.0.0: Убран Sync Engine, убрано дублирование кода.
 */

import { requireAuth, logout, isOnline, getSupabase } from '../../core/auth.js';
import { 
    formatMoney, 
    escapeHtml, 
    getCategoryName, 
    getPaymentMethodName,
    debounce 
} from '../../utils/formatters.js';
import { showNotification, showPaymentModal, showConfirmDialog } from '../../utils/ui.js';
import { openProductFormModal } from '../../utils/product-form.js';

// Подмодули кассы
import { 
    cartState,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    resetCart,
    calculateCartCount,
    calculateItemTotal,
    calculateCartTotal,
    loadCartFromCache,
    saveCartToCache
} from './cart.js';

import {
    shiftState,
    isShiftOpen,
    getCurrentShiftId,
    checkOpenShift,
    loadShiftStats,
    openShift,
    closeShift,
    loadShiftFromCache,
    saveShiftToCache
} from './shift.js';

import {
    productsState,
    loadProducts,
    setSearchQuery,
    setSelectedCategory,
    resetFilters,
    findProductByCode,
    openQuickAddProductForm
} from './products.js';

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

const state = {
    user: null,
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

// ========== ОФОРМЛЕНИЕ ПРОДАЖИ ==========

async function checkout() {
    if (calculateCartCount() === 0) {
        showNotification('Корзина пуста', 'warning');
        return;
    }
    
    if (!isShiftOpen()) {
        showNotification('Смена не открыта', 'warning');
        return;
    }
    
    const total = calculateCartTotal();
    const paymentMethod = await showPaymentModal(total);
    if (!paymentMethod) return;
    
    const items = cartState.items.map(item => ({
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
    
    const saleData = {
        shift_id: getCurrentShiftId(),
        items,
        total,
        profit,
        payment_method: paymentMethod,
        created_by: state.user?.id,
        created_at: new Date().toISOString()
    };
    
    // Сохраняем снапшот для чека
    const cartSnapshot = [...cartState.items];
    const totalSnapshot = total;
    const paymentMethodSnapshot = paymentMethod;
    
    // Очищаем корзину сразу (оптимистично)
    resetCart();
    
    try {
        const supabase = await getSupabase();
        
        // Сохраняем продажу в Supabase
        const { error: saleError } = await supabase
            .from('sales')
            .insert(saleData);
        
        if (saleError) throw saleError;
        
        // Обновляем статус товаров на 'sold'
        for (const item of items) {
            const { error: updateError } = await supabase
                .from('products')
                .update({ status: 'sold', sold_at: new Date().toISOString() })
                .eq('id', item.id);
            
            if (updateError) {
                console.error('[Cashier] Failed to update product status:', item.id, updateError);
            }
        }
        
        // Обновляем статистику смены
        shiftState.stats.revenue += total;
        shiftState.stats.salesCount += 1;
        shiftState.stats.profit += profit;
        shiftState.stats.itemsCount += items.reduce((sum, i) => sum + i.quantity, 0);
        saveShiftToCache();
        
        // Убираем проданные товары из списка
        const soldIds = items.map(i => i.id);
        productsState.all = productsState.all.filter(p => !soldIds.includes(p.id));
        
        showNotification(`Продажа на ${formatMoney(total)} оформлена`, 'success');
        showReceipt(cartSnapshot, totalSnapshot, paymentMethodSnapshot);
        
        // Перезагружаем товары
        setTimeout(() => loadProducts(true), 1000);
        
    } catch (error) {
        console.error('[Cashier] Checkout error:', error);
        showNotification('Ошибка оформления продажи: ' + error.message, 'error');
        
        // Восстанавливаем корзину
        cartState.items = cartSnapshot;
        saveCartToCache();
    }
    
    render();
}

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
                Закрыть смену
            </button>
        </div>
    `;
}

function renderToolbar() {
    const searchQuery = productsState.searchQuery;
    const selectedCategory = productsState.selectedCategory;
    
    return `
        <div class="products-toolbar">
            <div class="toolbar-left">
                <div class="search-wrapper">
                    <input type="text" id="searchInput" class="search-input" 
                        placeholder="Поиск товара или сканирование..." 
                        value="${escapeHtml(searchQuery)}">
                </div>
                <button class="btn-secondary btn-sm" id="quickAddProductBtn" title="Быстрое добавление товара">
                    + Быстрый товар
                </button>
            </div>
            
            <div class="toolbar-right">
                ${(searchQuery || selectedCategory) ? `
                    <button class="btn-ghost btn-sm" id="resetFiltersBtn">Сбросить фильтры</button>
                ` : ''}
            </div>
        </div>
        <div class="category-bar">
            <button class="category-tab ${!selectedCategory ? 'active' : ''}" data-category="">
                Все (${productsState.all.length})
            </button>
            ${productsState.categories.map(c => `
                <button class="category-tab ${selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">
                    ${getCategoryName(c.value)} (${c.count})
                </button>
            `).join('')}
        </div>
    `;
}

function renderProductsGrid() {
    if (productsState.isLoading) {
        return '<div class="loading-spinner"></div>';
    }
    
    if (productsState.filtered.length === 0) {
        const message = productsState.searchQuery || productsState.selectedCategory 
            ? 'По вашему запросу ничего не найдено'
            : 'Товары не найдены. Добавьте товар через кнопку "+ Быстрый товар".';
        
        return `<div class="empty-state">${message}</div>`;
    }
    
    return `
        <div class="products-grid">
            ${productsState.filtered.map(p => `
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

function renderCart() {
    const cartCount = calculateCartCount();
    const cartTotal = calculateCartTotal();
    
    const itemsHtml = cartState.items.length === 0 
        ? '<div class="cart-empty">Корзина пуста</div>'
        : cartState.items.map(item => {
            const itemTotal = calculateItemTotal(item);
            return `
                <div class="cart-item">
                    <div class="cart-item-main">
                        <div class="cart-item-info">
                            <span class="cart-item-name">${escapeHtml(item.name)}</span>
                        </div>
                        <div class="cart-item-actions">
                            <div class="quantity-control">
                                <button class="btn-qty" data-action="decrease" data-id="${item.id}">−</button>
                                <span class="qty-input">${item.quantity}</span>
                                <button class="btn-qty" data-action="increase" data-id="${item.id}">+</button>
                            </div>
                            <span class="item-total">${formatMoney(itemTotal)}</span>
                            <button class="btn-remove" data-action="remove" data-id="${item.id}" title="Удалить">✕</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    
    return `
        <div class="cart-panel">
            <div class="cart-header">
                <h3>🛒 Корзина</h3>
                <span class="cart-count">${cartCount} поз.</span>
                ${cartState.items.length > 0 ? '<button class="btn-ghost btn-sm" id="clearCartBtn">Очистить</button>' : ''}
            </div>
            
            <div class="cart-items-container">
                <div class="cart-items">
                    ${itemsHtml}
                </div>
            </div>
            
            <div class="cart-footer">
                <div class="cart-summary">
                    <div class="summary-row total">
                        <span>ИТОГО</span>
                        <span class="total-amount">${formatMoney(cartTotal)}</span>
                    </div>
                </div>
                <button class="btn-checkout" id="checkoutBtn" ${cartCount === 0 ? 'disabled' : ''}>
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
        render();
    });
}

function attachRenderEvents() {
    document.getElementById('closeShiftBtn')?.addEventListener('click', async () => {
        const success = await closeShift();
        if (success) {
            resetCart();
            showNotification('Смена закрыта', 'success');
        }
        render();
    });
    
    document.getElementById('clearCartBtn')?.addEventListener('click', async () => {
        await clearCart();
        render();
    });
    
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
    
    document.getElementById('quickAddProductBtn')?.addEventListener('click', async () => {
        const newProduct = await openQuickAddProductForm(state.user?.id);
        if (newProduct) {
            render();
        }
    });
    
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
        resetFilters();
        render();
    });
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const scannerHandler = debounce((value) => {
            if (!value) {
                setSearchQuery('');
                render();
                return;
            }
            
            const product = findProductByCode(value);
            if (product) {
                addToCart(product);
                searchInput.value = '';
                setSearchQuery('');
                render();
            } else {
                setSearchQuery(value);
                render();
            }
        }, 300);
        
        searchInput.addEventListener('input', (e) => scannerHandler(e.target.value));
        searchInput.focus();
    }
    
    document.querySelectorAll('[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            setSelectedCategory(btn.dataset.category || null);
            render();
        });
    });
    
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const product = productsState.all.find(p => p.id === card.dataset.id);
            if (product) {
                addToCart(product);
                render();
            }
        });
    });
    
    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const { action, id } = btn.dataset;
            if (action === 'increase') updateQuantity(id, 1);
            if (action === 'decrease') updateQuantity(id, -1);
            if (action === 'remove') removeFromCart(id);
            render();
        });
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function cacheElements() {
    DOM.content = document.getElementById('cashierContent');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
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

function attachGlobalEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => {
            location.reload();
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput')?.focus();
        }
        
        if (e.key === 'F9') {
            e.preventDefault();
            if (calculateCartCount() > 0) checkout();
        }
    });
    
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

async function init() {
    console.log('[Cashier] Initializing...');
    
    cacheElements();
    
    if (!isOnline()) {
        showOfflineBanner();
    } else {
        hideOfflineBanner();
    }
    
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
    } else if (authResult.offline) {
        state.user = null;
        showOfflineBanner();
        showNotification('Работа в офлайн-режиме. Некоторые функции недоступны.', 'warning');
    } else if (authResult.authError) {
        return;
    }
    
    displayUserInfo();
    attachGlobalEvents();
    
    loadCartFromCache();
    loadShiftFromCache();
    
    const hasShift = await checkOpenShift(state.user?.id);
    if (!hasShift && isOnline()) {
        console.log('[Cashier] No open shift found');
    }
    
    await loadProducts();
    
    if (window.markCashierModuleLoaded) {
        window.markCashierModuleLoaded();
    }
    
    render();
    
    console.log('[Cashier] Initialized');
}

document.addEventListener('DOMContentLoaded', init);

export { init };
