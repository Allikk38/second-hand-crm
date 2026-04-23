// ========================================
// FILE: js/cashier.js
// ========================================

/**
 * Cashier Page Module - MPA Edition
 * 
 * Логика страницы кассового модуля. Управляет открытием/закрытием смен,
 * отображает доступные товары, управляет корзиной и оформляет продажи.
 * 
 * Архитектурные решения:
 * - Прямое использование глобального клиента window.supabase через getSupabase из core/auth.js.
 * - Полная независимость от других страниц (MPA).
 * - Локальное кэширование смены и корзины в localStorage.
 * - Использование централизованных UI-утилит из utils/ui.js.
 * - Поддержка офлайн-режима при отсутствии сети.
 * - Чёткое разделение на state, actions, rendering.
 * 
 * @module cashier
 * @version 3.5.0
 * @changes
 * - Проведён рефакторинг: разделение на логические секции, декомпозиция render().
 * - Добавлена кнопка быстрого добавления товара.
 * - Вынесены хелперы корзины в отдельные чистые функции.
 * - Улучшена читаемость и поддерживаемость кода.
 */

import { requireAuth, logout, getCurrentUser, isOnline, getSupabase } from '../core/auth.js';
import { 
    formatMoney, 
    escapeHtml, 
    getCategoryName, 
    getPaymentMethodName,
    debounce 
} from '../utils/formatters.js';
import { showNotification, showConfirmDialog, showPaymentModal } from '../utils/ui.js';

// ========== КОНСТАНТЫ ==========

const CART_STORAGE_KEY = 'sh_cashier_cart';
const SHIFT_STORAGE_KEY = 'sh_cashier_shift';
const SCANNER_DEBOUNCE_MS = 500;

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

/**
 * Локальное состояние страницы кассы
 * @type {Object}
 */
const state = {
    // Пользователь
    user: null,
    isOffline: false,
    
    // Смена
    currentShift: null,
    shiftStats: { revenue: 0, salesCount: 0, profit: 0, itemsCount: 0 },
    isShiftActionPending: false,
    
    // Товары
    products: [],
    filteredProducts: [],
    categories: [],
    searchQuery: '',
    selectedCategory: null,
    isLoadingProducts: false,
    
    // Корзина
    cartItems: [],
    cartTotalDiscount: 0,
    
    // UI
    errorMessage: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

/** @type {Object<string, HTMLElement>} */
const DOM = {
    content: null,
    modalContainer: null,
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

// ========== ХЕЛПЕРЫ КОРЗИНЫ (ЧИСТЫЕ ФУНКЦИИ) ==========

/**
 * Вычисляет количество товаров в корзине
 * @param {Array} items - Массив товаров в корзине
 * @returns {number}
 */
function calculateCartCount(items) {
    return items.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

/**
 * Вычисляет итоговую сумму корзины
 * @param {Array} items - Массив товаров в корзине
 * @param {number} totalDiscount - Общая скидка в процентах
 * @returns {number}
 */
function calculateCartTotal(items, totalDiscount = 0) {
    const subtotal = items.reduce((sum, item) => {
        const itemPrice = item.price || 0;
        const itemDiscount = item.discount || 0;
        const discountedPrice = itemPrice * (1 - itemDiscount / 100);
        return sum + (discountedPrice * (item.quantity || 0));
    }, 0);
    
    const total = subtotal * (1 - totalDiscount / 100);
    return Math.max(0, Math.round(total));
}

/**
 * Вычисляет итоговую сумму для конкретного товара
 * @param {Object} item - Товар в корзине
 * @returns {number}
 */
function calculateItemTotal(item) {
    const price = item.price || 0;
    const discount = item.discount || 0;
    const quantity = item.quantity || 0;
    const discountedPrice = price * (1 - discount / 100);
    return discountedPrice * quantity;
}

// ========== КЭШИРОВАНИЕ ==========

function saveCartToCache() {
    try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
            items: state.cartItems,
            totalDiscount: state.cartTotalDiscount,
            cachedAt: Date.now()
        }));
    } catch (e) {
        console.warn('[Cashier] Failed to cache cart:', e);
    }
}

function loadCartFromCache() {
    try {
        const cached = localStorage.getItem(CART_STORAGE_KEY);
        if (cached) {
            const cart = JSON.parse(cached);
            if (Date.now() - cart.cachedAt < 60 * 60 * 1000) {
                state.cartItems = cart.items || [];
                state.cartTotalDiscount = cart.totalDiscount || 0;
            } else {
                localStorage.removeItem(CART_STORAGE_KEY);
            }
        }
    } catch (e) {
        console.warn('[Cashier] Failed to load cached cart:', e);
    }
}

function saveShiftToCache() {
    if (state.currentShift) {
        try {
            localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify({
                ...state.currentShift,
                stats: state.shiftStats,
                cachedAt: Date.now()
            }));
        } catch (e) {
            console.warn('[Cashier] Failed to cache shift:', e);
        }
    }
}

function loadShiftFromCache() {
    try {
        const cached = localStorage.getItem(SHIFT_STORAGE_KEY);
        if (cached) {
            const shift = JSON.parse(cached);
            if (Date.now() - shift.cachedAt < 24 * 60 * 60 * 1000) {
                state.currentShift = shift;
                state.shiftStats = shift.stats || state.shiftStats;
            } else {
                localStorage.removeItem(SHIFT_STORAGE_KEY);
            }
        }
    } catch (e) {
        console.warn('[Cashier] Failed to load cached shift:', e);
    }
}

// ========== УПРАВЛЕНИЕ СМЕНОЙ ==========

async function checkOpenShift() {
    if (!isOnline()) {
        render();
        return;
    }
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('user_id', state.user?.id)
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
            state.currentShift = data;
            await loadShiftStats();
        }
        
        render();
        
    } catch (error) {
        console.error('[Cashier] Check shift error:', error);
        state.errorMessage = 'Ошибка проверки смены';
        render();
    }
}

async function loadShiftStats() {
    if (!state.currentShift || !isOnline()) return;
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('sales')
            .select('total, profit, items')
            .eq('shift_id', state.currentShift.id);
        
        if (error) throw error;
        
        const sales = data || [];
        
        state.shiftStats = {
            revenue: sales.reduce((sum, s) => sum + (s.total || 0), 0),
            salesCount: sales.length,
            profit: sales.reduce((sum, s) => sum + (s.profit || 0), 0),
            itemsCount: sales.reduce((sum, s) => {
                return sum + (s.items?.reduce((s2, i) => s2 + (i.quantity || 0), 0) || 0);
            }, 0)
        };
        
        saveShiftToCache();
        
    } catch (error) {
        console.error('[Cashier] Load stats error:', error);
    }
}

async function openShift() {
    if (state.isShiftActionPending) return;
    
    if (!isOnline()) {
        showNotification('Невозможно открыть смену в офлайн-режиме', 'error');
        return;
    }
    
    state.isShiftActionPending = true;
    render();
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('shifts')
            .insert({
                user_id: state.user.id,
                opened_at: new Date().toISOString(),
                initial_cash: 0,
                status: 'active'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        state.currentShift = data;
        state.shiftStats = { revenue: 0, salesCount: 0, profit: 0, itemsCount: 0 };
        
        saveShiftToCache();
        showNotification('Смена открыта', 'success');
        
    } catch (error) {
        console.error('[Cashier] Open shift error:', error);
        showNotification('Ошибка открытия смены: ' + error.message, 'error');
    } finally {
        state.isShiftActionPending = false;
        render();
    }
}

async function closeShift() {
    if (!state.currentShift || state.isShiftActionPending) return;
    
    if (!isOnline()) {
        showNotification('Невозможно закрыть смену в офлайн-режиме', 'error');
        return;
    }
    
    const confirmed = await showConfirmDialog({
        title: 'Закрытие смены',
        message: `Выручка: ${formatMoney(state.shiftStats.revenue)}\nПродаж: ${state.shiftStats.salesCount}\nПрибыль: ${formatMoney(state.shiftStats.profit)}\n\nВы уверены, что хотите закрыть смену?`,
        confirmText: 'Закрыть смену'
    });
    
    if (!confirmed) return;
    
    state.isShiftActionPending = true;
    render();
    
    try {
        const supabase = await getSupabase();
        const { error } = await supabase
            .from('shifts')
            .update({
                closed_at: new Date().toISOString(),
                final_cash: state.shiftStats.revenue,
                total_revenue: state.shiftStats.revenue,
                total_profit: state.shiftStats.profit,
                sales_count: state.shiftStats.salesCount,
                items_count: state.shiftStats.itemsCount,
                status: 'closed'
            })
            .eq('id', state.currentShift.id);
        
        if (error) throw error;
        
        state.currentShift = null;
        state.shiftStats = { revenue: 0, salesCount: 0, profit: 0, itemsCount: 0 };
        state.cartItems = [];
        state.cartTotalDiscount = 0;
        
        localStorage.removeItem(SHIFT_STORAGE_KEY);
        localStorage.removeItem(CART_STORAGE_KEY);
        
        showNotification('Смена закрыта', 'success');
        
    } catch (error) {
        console.error('[Cashier] Close shift error:', error);
        showNotification('Ошибка закрытия смены: ' + error.message, 'error');
    } finally {
        state.isShiftActionPending = false;
        render();
    }
}

// ========== УПРАВЛЕНИЕ ТОВАРАМИ ==========

async function loadProducts() {
    state.isLoadingProducts = true;
    render();
    
    if (!isOnline()) {
        state.isLoadingProducts = false;
        render();
        showNotification('Невозможно загрузить товары в офлайн-режиме', 'warning');
        return;
    }
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('status', 'in_stock')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        state.products = data || [];
        buildCategories();
        applyFilters();
        hideOfflineBanner();
        
    } catch (error) {
        console.error('[Cashier] Load products error:', error);
        showNotification('Ошибка загрузки товаров', 'error');
    } finally {
        state.isLoadingProducts = false;
        render();
    }
}

function buildCategories() {
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
    let filtered = state.products;
    
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(q) || 
            p.id?.toLowerCase().includes(q)
        );
    }
    
    if (state.selectedCategory) {
        filtered = filtered.filter(p => p.category === state.selectedCategory);
    }
    
    state.filteredProducts = filtered;
}

// ========== УПРАВЛЕНИЕ КОРЗИНОЙ ==========

function addToCart(product) {
    const existing = state.cartItems.find(i => i.id === product.id);
    
    if (existing) {
        existing.quantity += 1;
    } else {
        state.cartItems.push({ ...product, quantity: 1 });
    }
    
    saveCartToCache();
    render();
    showNotification(`${product.name} добавлен в корзину`, 'success');
}

function updateQuantity(productId, delta) {
    const item = state.cartItems.find(i => i.id === productId);
    if (!item) return;
    
    const newQty = item.quantity + delta;
    
    if (newQty <= 0) {
        removeFromCart(productId);
    } else {
        item.quantity = newQty;
        saveCartToCache();
        render();
    }
}

function removeFromCart(productId) {
    state.cartItems = state.cartItems.filter(i => i.id !== productId);
    saveCartToCache();
    render();
}

async function clearCart() {
    if (state.cartItems.length === 0) return;
    
    const confirmed = await showConfirmDialog({
        title: 'Очистка корзины',
        message: 'Вы уверены, что хотите удалить все товары из корзины?',
        confirmText: 'Очистить'
    });
    
    if (!confirmed) return;
    
    state.cartItems = [];
    state.cartTotalDiscount = 0;
    saveCartToCache();
    render();
}

// ========== БЫСТРОЕ ДОБАВЛЕНИЕ ТОВАРА ==========

/**
 * Открывает форму быстрого добавления товара из кассы
 */
async function openQuickAddProductForm() {
    if (!isOnline()) {
        showNotification('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    // TODO: Импортировать и использовать openProductFormModal из utils/product-form.js
    // Пока показываем заглушку
    showNotification('Форма добавления товара будет доступна после рефакторинга', 'info');
    
    // В следующей версии:
    // const newProduct = await openProductFormModal({ mode: 'create' });
    // if (newProduct) {
    //     state.products.unshift(newProduct);
    //     applyFilters();
    //     addToCart(newProduct);
    //     render();
    // }
}

// ========== ОФОРМЛЕНИЕ ПРОДАЖИ ==========

async function checkStockAvailability() {
    if (!isOnline()) return false;
    
    try {
        const supabase = await getSupabase();
        const productIds = state.cartItems.map(i => i.id);
        
        const { data, error } = await supabase
            .from('products')
            .select('id, status, name')
            .in('id', productIds);
        
        if (error) throw error;
        
        const productMap = new Map(data.map(p => [p.id, p]));
        const unavailableItems = state.cartItems.filter(item => {
            const product = productMap.get(item.id);
            return !product || product.status !== 'in_stock';
        });
        
        if (unavailableItems.length > 0) {
            const names = unavailableItems.map(i => i.name).join(', ');
            showNotification(`Товары больше не доступны: ${names}`, 'error');
            return false;
        }
        
        return true;
        
    } catch (error) {
        console.error('[Cashier] Stock check error:', error);
        return false;
    }
}

async function checkout() {
    if (state.cartItems.length === 0) {
        showNotification('Корзина пуста', 'warning');
        return;
    }
    
    if (!state.currentShift) {
        showNotification('Смена не открыта', 'warning');
        return;
    }
    
    if (!isOnline()) {
        showNotification('Невозможно оформить продажу в офлайн-режиме', 'error');
        return;
    }
    
    const stockOk = await checkStockAvailability();
    if (!stockOk) {
        await loadProducts();
        return;
    }
    
    const total = calculateCartTotal(state.cartItems, state.cartTotalDiscount);
    
    const paymentMethod = await showPaymentModal(total);
    if (!paymentMethod) return;
    
    state.isLoadingProducts = true;
    render();
    
    try {
        const supabase = await getSupabase();
        
        const items = state.cartItems.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            cost_price: item.cost_price || 0,
            quantity: item.quantity
        }));
        
        const profit = items.reduce((sum, item) => {
            return sum + ((item.price - item.cost_price) * item.quantity);
        }, 0);
        
        const { error } = await supabase
            .from('sales')
            .insert({
                shift_id: state.currentShift.id,
                items,
                total,
                profit,
                payment_method: paymentMethod,
                created_by: state.user.id,
                created_at: new Date().toISOString()
            });
        
        if (error) throw error;
        
        const productIds = items.map(i => i.id);
        await supabase
            .from('products')
            .update({ 
                status: 'sold', 
                sold_at: new Date().toISOString() 
            })
            .in('id', productIds);
        
        await loadShiftStats();
        
        state.cartItems = [];
        state.cartTotalDiscount = 0;
        saveCartToCache();
        
        await loadProducts();
        
        showNotification(`Продажа на ${formatMoney(total)}`, 'success');
        showReceipt(items, total, paymentMethod);
        
    } catch (error) {
        console.error('[Cashier] Checkout error:', error);
        showNotification('Ошибка оформления продажи: ' + error.message, 'error');
    } finally {
        state.isLoadingProducts = false;
        render();
    }
}

function showReceipt(items, total, paymentMethod) {
    const receiptLines = items.map(item => 
        `${item.name} x${item.quantity} = ${formatMoney(item.price * item.quantity)}`
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
    
    modal.querySelector('.btn-close').addEventListener('click', () => modal.remove());
    modal.querySelector('[data-action="close"]').addEventListener('click', () => modal.remove());
}

// ========== РЕНДЕРИНГ ==========

/**
 * Рендерит панель смены
 * @returns {string} HTML
 */
function renderShiftBar() {
    return `
        <div class="shift-bar">
            <div class="shift-status">
                <span class="status-dot"></span>
                <span>Смена открыта</span>
            </div>
            <div class="shift-stats">
                <div class="stat-item">
                    <span class="stat-label">Выручка</span>
                    <span class="stat-value">${formatMoney(state.shiftStats.revenue)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Продаж</span>
                    <span class="stat-value">${state.shiftStats.salesCount}</span>
                </div>
            </div>
            <button class="btn-secondary btn-sm" id="closeShiftBtn" ${state.isShiftActionPending ? 'disabled' : ''}>
                Закрыть смену
            </button>
        </div>
    `;
}

/**
 * Рендерит панель инструментов
 * @returns {string} HTML
 */
function renderToolbar() {
    return `
        <div class="products-toolbar">
            <div class="toolbar-left">
                <div class="search-wrapper">
                    <input type="text" id="searchInput" class="search-input" placeholder="Поиск товара..." value="${escapeHtml(state.searchQuery)}">
                </div>
                <button class="quick-add-btn" id="quickAddProductBtn" title="Быстрое добавление товара">
                    <span class="icon">➕</span>
                    <span>Быстрый товар</span>
                </button>
            </div>
            
            <div class="toolbar-right">
                <div class="category-bar">
                    <button class="category-tab ${!state.selectedCategory ? 'active' : ''}" data-category="">Все (${state.products.length})</button>
                    ${state.categories.map(c => `
                        <button class="category-tab ${state.selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">${getCategoryName(c.value)} (${c.count})</button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Рендерит сетку товаров
 * @returns {string} HTML
 */
function renderProductsGrid() {
    if (state.isLoadingProducts) {
        return '<div class="loading-spinner"></div>';
    }
    
    if (state.filteredProducts.length === 0) {
        return '<div class="empty-state">Товары не найдены</div>';
    }
    
    return `
        <div class="products-grid">
            ${state.filteredProducts.map(p => `
                <div class="product-card" data-id="${p.id}">
                    <div class="product-photo">${p.photo_url ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}">` : '📦'}</div>
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
 * @returns {string} HTML
 */
function renderCart() {
    const cartCount = calculateCartCount(state.cartItems);
    const cartTotal = calculateCartTotal(state.cartItems, state.cartTotalDiscount);
    
    const itemsHtml = state.cartItems.length === 0 
        ? '<div class="cart-empty">Корзина пуста</div>'
        : state.cartItems.map(item => {
            const itemTotal = calculateItemTotal(item);
            return `
                <div class="cart-item">
                    <div class="cart-item-header">
                        <span class="cart-item-name">${escapeHtml(item.name)}</span>
                    </div>
                    <div class="cart-item-price">${formatMoney(item.price)} / шт.</div>
                    <div class="cart-item-controls">
                        <div class="quantity-control">
                            <button class="qty-btn" data-action="decrease" data-id="${item.id}">−</button>
                            <span class="item-qty">${item.quantity}</span>
                            <button class="qty-btn" data-action="increase" data-id="${item.id}">+</button>
                        </div>
                        <span class="item-total">${formatMoney(itemTotal)}</span>
                        <button class="remove-btn" data-action="remove" data-id="${item.id}">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    
    return `
        <div class="cart-panel">
            <div class="cart-header">
                <h2>🛒 Корзина</h2>
                <span class="cart-count">${cartCount} поз.</span>
                ${cartCount > 0 ? '<button class="btn-ghost btn-sm" id="clearCartBtn">Очистить</button>' : ''}
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
                <button class="btn-checkout" id="checkoutBtn" ${cartCount === 0 ? 'disabled' : ''}>Оформить продажу (F9)</button>
            </div>
        </div>
    `;
}

/**
 * Главная функция рендеринга
 */
function render() {
    if (!DOM.content) return;
    
    if (!state.currentShift) {
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
            <button class="btn-primary btn-lg" id="openShiftBtn" ${state.isShiftActionPending ? 'disabled' : ''}>
                ${state.isShiftActionPending ? 'Открытие...' : 'Открыть смену'}
            </button>
        </div>
    `;
    
    document.getElementById('openShiftBtn')?.addEventListener('click', openShift);
}

function attachRenderEvents() {
    document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);
    document.getElementById('clearCartBtn')?.addEventListener('click', clearCart);
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
    document.getElementById('quickAddProductBtn')?.addEventListener('click', openQuickAddProductForm);
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const debouncedSearch = debounce((value) => {
            state.searchQuery = value;
            applyFilters();
            render();
        }, 300);
        
        searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));
    }
    
    document.querySelectorAll('[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.selectedCategory = btn.dataset.category || null;
            applyFilters();
            render();
        });
    });
    
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const product = state.products.find(p => p.id === card.dataset.id);
            if (product) addToCart(product);
        });
    });
    
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

function cacheElements() {
    DOM.content = document.getElementById('cashierContent');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
}

function attachGlobalEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => {
            loadProducts();
            checkOpenShift();
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput')?.focus();
        }
        
        if (e.key === 'F9') {
            e.preventDefault();
            if (state.cartItems.length > 0) checkout();
        }
    });
    
    window.addEventListener('beforeunload', () => {
        saveCartToCache();
    });
    
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        loadProducts();
        checkOpenShift();
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

async function init() {
    console.log('[Cashier] Initializing MPA page...');
    
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
        return;
    }
    
    displayUserInfo();
    attachGlobalEvents();
    
    loadCartFromCache();
    loadShiftFromCache();
    
    await checkOpenShift();
    await loadProducts();
    
    console.log('[Cashier] Page initialized');
}

document.addEventListener('DOMContentLoaded', init);

export { init };
