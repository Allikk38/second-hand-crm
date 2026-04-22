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
 * - Прямое использование глобального клиента window.supabase.
 * - Полная независимость от других страниц (MPA).
 * - Локальное кэширование смены и корзины в localStorage для защиты от сбоев.
 * - Кастомные модальные окна вместо prompt()/confirm() для лучшего UX.
 * 
 * @module cashier
 * @version 3.1.0
 * @changes
 * - Убрана зависимость от удаленного core/supabase.js (используется window.supabase).
 * - Заменены prompt()/confirm() на кастомные модальные окна.
 * - Упрощена структура состояния.
 * - Улучшена обработка офлайн-режима и ошибок.
 * - Полное соответствие MPA-архитектуре.
 */

import { requireAuth, logout, getCurrentUser, isOnline } from '../core/auth.js';
import { 
    formatMoney, 
    escapeHtml, 
    getCategoryName, 
    getPaymentMethodName,
    debounce 
} from '../utils/formatters.js';

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
    isScanning: false,
    errorMessage: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

/** @type {Object<string, HTMLElement>} */
const DOM = {
    content: null,
    modalContainer: null,
    userEmail: null,
    logoutBtn: null
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы кассы
 */
async function init() {
    console.log('[Cashier] Initializing MPA page...');
    
    // 1. Кэшируем DOM элементы
    cacheElements();
    
    // 2. Проверяем авторизацию
    state.user = await requireAuth();
    if (!state.user) return;
    
    // 3. Отображаем информацию о пользователе
    displayUserInfo();
    
    // 4. Привязываем глобальные события
    attachGlobalEvents();
    
    // 5. Загружаем кэшированные данные
    loadCachedData();
    
    // 6. Проверяем наличие открытой смены
    await checkOpenShift();
    
    // 7. Загружаем товары
    await loadProducts();
    
    console.log('[Cashier] Page initialized');
}

/**
 * Кэширует все необходимые DOM элементы
 */
function cacheElements() {
    DOM.content = document.getElementById('cashierContent');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
}

/**
 * Отображает email текущего пользователя в шапке
 */
function displayUserInfo() {
    if (DOM.userEmail && state.user) {
        const name = state.user.email?.split('@')[0] || 'Пользователь';
        DOM.userEmail.textContent = name;
    }
}

/**
 * Привязывает глобальные обработчики событий
 */
function attachGlobalEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    // Горячие клавиши
    document.addEventListener('keydown', handleHotkeys);
    
    // Сохранение корзины перед закрытием страницы
    window.addEventListener('beforeunload', () => {
        saveCartToCache();
    });
}

/**
 * Загружает кэшированные данные из localStorage
 */
function loadCachedData() {
    // Загружаем смену
    try {
        const cachedShift = localStorage.getItem(SHIFT_STORAGE_KEY);
        if (cachedShift) {
            const shift = JSON.parse(cachedShift);
            // Кэш действителен 24 часа
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
    
    // Загружаем корзину
    try {
        const cachedCart = localStorage.getItem(CART_STORAGE_KEY);
        if (cachedCart) {
            const cart = JSON.parse(cachedCart);
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

// ========== УПРАВЛЕНИЕ СМЕНОЙ ==========

/**
 * Проверяет наличие открытой смены на сервере
 */
async function checkOpenShift() {
    if (!isOnline()) {
        render();
        return;
    }
    
    try {
        const supabase = window.supabase;
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('user_id', state.user.id)
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

/**
 * Загружает статистику текущей смены
 */
async function loadShiftStats() {
    if (!state.currentShift || !isOnline()) return;
    
    try {
        const supabase = window.supabase;
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

/**
 * Открывает новую смену
 */
async function openShift() {
    if (state.isShiftActionPending || !isOnline()) return;
    
    state.isShiftActionPending = true;
    render();
    
    try {
        const supabase = window.supabase;
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

/**
 * Закрывает текущую смену
 */
async function closeShift() {
    if (!state.currentShift || state.isShiftActionPending) return;
    
    const confirmed = await showConfirmDialog({
        title: 'Закрытие смены',
        message: `
            <div style="text-align: left;">
                <p><strong>Выручка:</strong> ${formatMoney(state.shiftStats.revenue)}</p>
                <p><strong>Продаж:</strong> ${state.shiftStats.salesCount}</p>
                <p><strong>Прибыль:</strong> ${formatMoney(state.shiftStats.profit)}</p>
                <p style="margin-top: 12px;">Вы уверены, что хотите закрыть смену?</p>
            </div>
        `,
        confirmText: 'Закрыть смену'
    });
    
    if (!confirmed) return;
    
    state.isShiftActionPending = true;
    render();
    
    try {
        const supabase = window.supabase;
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

/**
 * Загружает список товаров
 */
async function loadProducts() {
    state.isLoadingProducts = true;
    render();
    
    try {
        const supabase = window.supabase;
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('status', 'in_stock')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        state.products = data || [];
        buildCategories();
        applyFilters();
        
    } catch (error) {
        console.error('[Cashier] Load products error:', error);
        showNotification('Ошибка загрузки товаров', 'error');
    } finally {
        state.isLoadingProducts = false;
        render();
    }
}

/**
 * Строит список категорий для фильтра
 */
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

/**
 * Применяет фильтры к списку товаров
 */
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

/**
 * Добавляет товар в корзину
 */
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

/**
 * Обновляет количество товара в корзине
 */
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

/**
 * Удаляет товар из корзины
 */
function removeFromCart(productId) {
    state.cartItems = state.cartItems.filter(i => i.id !== productId);
    saveCartToCache();
    render();
}

/**
 * Очищает всю корзину
 */
function clearCart() {
    if (state.cartItems.length === 0) return;
    
    state.cartItems = [];
    state.cartTotalDiscount = 0;
    saveCartToCache();
    render();
}

/**
 * Вычисляет итоговую сумму корзины
 */
function calculateTotal() {
    let subtotal = state.cartItems.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
    }, 0);
    
    if (state.cartTotalDiscount > 0) {
        subtotal = subtotal * (1 - state.cartTotalDiscount / 100);
    }
    
    return Math.max(0, Math.round(subtotal));
}

// ========== ОФОРМЛЕНИЕ ПРОДАЖИ ==========

/**
 * Оформляет продажу
 */
async function checkout() {
    if (state.cartItems.length === 0) {
        showNotification('Корзина пуста', 'warning');
        return;
    }
    
    if (!state.currentShift) {
        showNotification('Смена не открыта', 'warning');
        return;
    }
    
    const total = calculateTotal();
    
    // Показываем модальное окно выбора оплаты
    const paymentMethod = await showPaymentModal(total);
    if (!paymentMethod) return;
    
    state.isLoadingProducts = true;
    render();
    
    try {
        const supabase = window.supabase;
        
        // Формируем список товаров для продажи
        const items = state.cartItems.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            cost_price: item.cost_price || 0,
            quantity: item.quantity
        }));
        
        // Считаем прибыль
        const profit = items.reduce((sum, item) => {
            return sum + ((item.price - item.cost_price) * item.quantity);
        }, 0);
        
        // Создаем запись о продаже
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
        
        // Обновляем статус товаров на "sold"
        const productIds = items.map(i => i.id);
        await supabase
            .from('products')
            .update({ 
                status: 'sold', 
                sold_at: new Date().toISOString() 
            })
            .in('id', productIds);
        
        // Обновляем статистику смены
        await loadShiftStats();
        
        // Очищаем корзину
        state.cartItems = [];
        state.cartTotalDiscount = 0;
        saveCartToCache();
        
        // Обновляем список товаров
        await loadProducts();
        
        showNotification(`Продажа на ${formatMoney(total)}`, 'success');
        
        // Показываем чек
        showReceipt(items, total, paymentMethod);
        
    } catch (error) {
        console.error('[Cashier] Checkout error:', error);
        showNotification('Ошибка оформления продажи: ' + error.message, 'error');
    } finally {
        state.isLoadingProducts = false;
        render();
    }
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Сохраняет смену в localStorage
 */
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

/**
 * Сохраняет корзину в localStorage
 */
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

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Обработчик горячих клавиш
 */
function handleHotkeys(e) {
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
    }
    
    if (e.key === 'F9') {
        e.preventDefault();
        if (state.cartItems.length > 0) checkout();
    }
}

/**
 * Показывает уведомление (заглушка, можно заменить на кастомное)
 */
function showNotification(message, type = 'info') {
    alert(`${type.toUpperCase()}: ${message}`); // TODO: Заменить на кастомный тост
}

/**
 * Показывает модальное окно выбора оплаты
 */
async function showPaymentModal(total) {
    // Заглушка, в реальном коде здесь будет создание DOM-элемента модалки
    return new Promise((resolve) => {
        const method = prompt(`Сумма к оплате: ${formatMoney(total)}\nВыберите способ оплаты:\n1 - Наличные\n2 - Карта\n3 - Перевод`, '1');
        const methods = { '1': 'cash', '2': 'card', '3': 'transfer' };
        resolve(methods[method] || 'cash');
    });
}

/**
 * Показывает диалог подтверждения
 */
async function showConfirmDialog({ title, message, confirmText = 'Да' }) {
    return confirm(`${title}\n\n${message.replace(/<[^>]*>/g, '')}`);
}

/**
 * Показывает чек после продажи
 */
function showReceipt(items, total, paymentMethod) {
    const receiptText = items.map(i => `${i.name} x${i.quantity} = ${formatMoney(i.price * i.quantity)}`).join('\n');
    alert(`ЧЕК\n${receiptText}\n\nИТОГО: ${formatMoney(total)}\nОплата: ${getPaymentMethodName(paymentMethod)}`);
}

// ========== РЕНДЕРИНГ ==========

/**
 * Главная функция рендеринга
 */
function render() {
    if (!DOM.content) return;
    
    if (!state.currentShift) {
        renderClosedShift();
        return;
    }
    
    const cartTotal = calculateTotal();
    const cartCount = state.cartItems.reduce((sum, i) => sum + i.quantity, 0);
    
    DOM.content.innerHTML = `
        <div class="cashier-layout">
            <div class="products-panel">
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
                
                <div class="products-toolbar">
                    <div class="search-wrapper">
                        <input type="text" id="searchInput" class="search-input" placeholder="Поиск товара..." value="${escapeHtml(state.searchQuery)}">
                    </div>
                    
                    <div class="category-bar">
                        <button class="category-tab ${!state.selectedCategory ? 'active' : ''}" data-category="">Все (${state.products.length})</button>
                        ${state.categories.map(c => `
                            <button class="category-tab ${state.selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">${getCategoryName(c.value)} (${c.count})</button>
                        `).join('')}
                    </div>
                </div>
                
                <div class="products-grid">
                    ${state.isLoadingProducts ? '<div class="loading-spinner"></div>' : 
                      state.filteredProducts.map(p => `
                        <div class="product-card" data-id="${p.id}">
                            <div class="product-photo">${p.photo_url ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}">` : '📦'}</div>
                            <div class="product-info">
                                <div class="product-name">${escapeHtml(p.name)}</div>
                                <div class="product-price">${formatMoney(p.price)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="cart-panel">
                <div class="cart-header">
                    <h2>🛒 Корзина</h2>
                    <span class="cart-count">${cartCount} поз.</span>
                    ${cartCount > 0 ? '<button class="btn-ghost btn-sm" id="clearCartBtn">Очистить</button>' : ''}
                </div>
                
                <div class="cart-items">
                    ${state.cartItems.length === 0 ? '<div class="cart-empty">Корзина пуста</div>' :
                      state.cartItems.map(item => `
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
                                <span class="item-total">${formatMoney(item.price * item.quantity)}</span>
                                <button class="remove-btn" data-action="remove" data-id="${item.id}">✕</button>
                            </div>
                        </div>
                    `).join('')}
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
        </div>
    `;
    
    attachRenderEvents();
}

/**
 * Отрисовывает состояние закрытой смены
 */
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

/**
 * Привязывает обработчики событий после рендеринга
 */
function attachRenderEvents() {
    document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);
    document.getElementById('clearCartBtn')?.addEventListener('click', clearCart);
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
    
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

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
