// ========================================
// FILE: ./js/cashier.js
// ========================================

/**
 * Cashier Page Module
 * 
 * Логика страницы кассового модуля. Управление сменами,
 * корзиной, поиском товаров и оформлением продаж.
 * 
 * Архитектурные решения:
 * - Полностью автономный модуль, работает только со своей страницей.
 * - Использует единый клиент из core/supabase.js.
 * - Сохранение состояния смены и корзины в localStorage.
 * - Поддержка офлайн-режима для открытой смены.
 * - Модальное окно для выбора оплаты вместо prompt().
 * 
 * @module cashier
 * @version 2.0.0
 * @changes
 * - Заменен prompt() на модальное окно выбора оплаты.
 * - Добавлено сохранение корзины в localStorage.
 * - Добавлен дебаунс на поиск.
 * - Добавлена поддержка скидок.
 * - Добавлен сканер для быстрого добавления товаров.
 * - Добавлена проверка остатков.
 */

import { supabase } from '../core/supabase.js';
import { requireAuth, logout, getUserProfile } from '../core/auth.js';
import { 
    formatMoney, 
    formatNumber,
    escapeHtml, 
    getCategoryName,
    getPaymentMethodName,
    debounce 
} from '../utils/formatters.js';
import { getCategoryOptions } from '../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========

const CART_STORAGE_KEY = 'sh_cashier_cart';
const SHIFT_STORAGE_KEY = 'sh_cashier_shift';
const SCANNER_DEBOUNCE = 500;

// ========== СОСТОЯНИЕ ==========

/**
 * Состояние кассового модуля
 * @type {Object}
 */
const state = {
    // Смена
    currentShift: null,
    shiftStats: {
        revenue: 0,
        salesCount: 0,
        profit: 0,
        itemsCount: 0
    },
    isShiftActionPending: false,
    
    // Товары
    products: [],
    filteredProducts: [],
    categories: [],
    
    // Фильтры
    searchQuery: '',
    selectedCategory: null,
    
    // Корзина
    cartItems: [],
    cartTotalDiscount: 0,
    cartItemDiscounts: new Map(),
    
    // UI
    isLoading: false,
    isScanning: false,
    
    // Пользователь
    user: null,
    profile: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    content: null,
    modalContainer: null,
    notificationContainer: null,
    userEmail: null,
    logoutBtn: null
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Cashier] Initializing...');
    
    // Проверяем авторизацию
    state.user = await requireAuth();
    if (!state.user) return;
    
    // Получаем профиль
    state.profile = await getUserProfile();
    
    // Кэшируем DOM элементы
    cacheElements();
    
    // Отображаем информацию о пользователе
    displayUserInfo();
    
    // Привязываем события
    attachEvents();
    
    // Загружаем кэшированные данные
    loadCachedData();
    
    // Проверяем наличие открытой смены
    await checkOpenShift();
    
    // Загружаем товары
    await loadProducts();
    
    console.log('[Cashier] Initialized');
}

/**
 * Кэширует DOM элементы
 */
function cacheElements() {
    DOM.content = document.getElementById('cashierContent');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.notificationContainer = document.getElementById('notificationContainer');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
}

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    // Горячие клавиши
    document.addEventListener('keydown', handleHotkeys);
    
    // Сохранение корзины перед закрытием
    window.addEventListener('beforeunload', () => {
        saveCartToCache();
    });
}

/**
 * Загружает кэшированные данные
 */
function loadCachedData() {
    // Загружаем смену
    try {
        const cachedShift = localStorage.getItem(SHIFT_STORAGE_KEY);
        if (cachedShift) {
            const shift = JSON.parse(cachedShift);
            const age = Date.now() - shift.cachedAt;
            
            // Кэш действителен 24 часа
            if (age < 24 * 60 * 60 * 1000) {
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
            const age = Date.now() - cart.cachedAt;
            
            // Кэш корзины действителен 1 час
            if (age < 60 * 60 * 1000) {
                state.cartItems = cart.items || [];
                state.cartTotalDiscount = cart.totalDiscount || 0;
                
                if (cart.itemDiscounts) {
                    state.cartItemDiscounts = new Map(cart.itemDiscounts);
                }
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
 * Проверяет наличие открытой смены
 */
async function checkOpenShift() {
    try {
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
        render();
    }
}

/**
 * Загружает статистику смены
 */
async function loadShiftStats() {
    if (!state.currentShift) return;
    
    try {
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
        
        // Обновляем кэш
        saveShiftToCache();
        
    } catch (error) {
        console.error('[Cashier] Load stats error:', error);
    }
}

/**
 * Открывает смену
 */
async function openShift() {
    if (state.isShiftActionPending) return;
    
    state.isShiftActionPending = true;
    render();
    
    try {
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
        
        render();
        
    } catch (error) {
        console.error('[Cashier] Open shift error:', error);
        showNotification('Ошибка открытия смены: ' + error.message, 'error');
    } finally {
        state.isShiftActionPending = false;
        render();
    }
}

/**
 * Закрывает смену
 */
async function closeShift() {
    if (!state.currentShift || state.isShiftActionPending) return;
    
    // Показываем подтверждение
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
        confirmText: 'Закрыть смену',
        cancelText: 'Отмена'
    });
    
    if (!confirmed) return;
    
    state.isShiftActionPending = true;
    render();
    
    try {
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
        state.cartItemDiscounts.clear();
        
        localStorage.removeItem(SHIFT_STORAGE_KEY);
        localStorage.removeItem(CART_STORAGE_KEY);
        
        showNotification('Смена закрыта', 'success');
        render();
        
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
    state.isLoading = true;
    render();
    
    try {
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
        state.isLoading = false;
        render();
    }
}

/**
 * Строит список категорий
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
 * Применяет фильтры к товарам
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
    state.cartItemDiscounts.delete(productId);
    saveCartToCache();
    render();
}

/**
 * Очищает корзину
 */
function clearCart() {
    if (state.cartItems.length === 0) return;
    
    state.cartItems = [];
    state.cartTotalDiscount = 0;
    state.cartItemDiscounts.clear();
    saveCartToCache();
    render();
}

/**
 * Применяет скидку к товару
 */
function applyItemDiscount(productId, discountPercent) {
    if (discountPercent > 0 && discountPercent <= 100) {
        state.cartItemDiscounts.set(productId, discountPercent);
    } else {
        state.cartItemDiscounts.delete(productId);
    }
    saveCartToCache();
    render();
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
    
    state.isLoading = true;
    render();
    
    try {
        // Формируем список товаров
        const items = state.cartItems.map(item => {
            const discount = state.cartItemDiscounts.get(item.id) || 0;
            const price = discount > 0 ? item.price * (1 - discount / 100) : item.price;
            
            return {
                id: item.id,
                name: item.name,
                price: price,
                cost_price: item.cost_price || 0,
                quantity: item.quantity,
                discount_percent: discount
            };
        });
        
        // Считаем прибыль
        const profit = items.reduce((sum, item) => {
            const itemProfit = (item.price - item.cost_price) * item.quantity;
            return sum + itemProfit;
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
        
        // Обновляем статус товаров
        const productIds = items.map(i => i.id);
        await supabase
            .from('products')
            .update({ 
                status: 'sold', 
                sold_at: new Date().toISOString() 
            })
            .in('id', productIds);
        
        // Обновляем статистику
        await loadShiftStats();
        
        // Очищаем корзину
        state.cartItems = [];
        state.cartTotalDiscount = 0;
        state.cartItemDiscounts.clear();
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
        state.isLoading = false;
        render();
    }
}

/**
 * Вычисляет итоговую сумму
 */
function calculateTotal() {
    let subtotal = state.cartItems.reduce((sum, item) => {
        const discount = state.cartItemDiscounts.get(item.id) || 0;
        const price = discount > 0 ? item.price * (1 - discount / 100) : item.price;
        return sum + (price * item.quantity);
    }, 0);
    
    if (state.cartTotalDiscount > 0) {
        subtotal = subtotal * (1 - state.cartTotalDiscount / 100);
    }
    
    return Math.max(0, Math.round(subtotal));
}

// ========== МОДАЛЬНЫЕ ОКНА ==========

/**
 * Показывает модальное окно выбора оплаты
 */
async function showPaymentModal(total) {
    return new Promise((resolve) => {
        const modalHtml = `
            <div class="modal-overlay" id="paymentModalOverlay">
                <div class="modal payment-modal">
                    <div class="modal-header">
                        <h3>Выбор способа оплаты</h3>
                        <button class="btn-close" id="closePaymentModal">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="payment-amount">
                            Сумма к оплате: <strong>${formatMoney(total)}</strong>
                        </div>
                        
                        <div class="payment-methods">
                            <button class="payment-method-btn" data-method="cash">
                                <span class="payment-icon">💵</span>
                                <span>Наличные</span>
                            </button>
                            <button class="payment-method-btn" data-method="card">
                                <span class="payment-icon">💳</span>
                                <span>Карта</span>
                            </button>
                            <button class="payment-method-btn" data-method="transfer">
                                <span class="payment-icon">📱</span>
                                <span>Перевод</span>
                            </button>
                        </div>
                        
                        <div class="quick-amounts">
                            <button class="quick-amount" data-amount="${Math.ceil(total / 100) * 100}">
                                ${formatMoney(Math.ceil(total / 100) * 100)}
                            </button>
                            <button class="quick-amount" data-amount="${Math.ceil(total / 500) * 500}">
                                ${formatMoney(Math.ceil(total / 500) * 500)}
                            </button>
                            <button class="quick-amount" data-amount="${Math.ceil(total / 1000) * 1000}">
                                ${formatMoney(Math.ceil(total / 1000) * 1000)}
                            </button>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" id="cancelPaymentBtn">Отмена</button>
                    </div>
                </div>
            </div>
        `;
        
        DOM.modalContainer.innerHTML = modalHtml;
        
        const overlay = document.getElementById('paymentModalOverlay');
        const closeBtn = document.getElementById('closePaymentModal');
        const cancelBtn = document.getElementById('cancelPaymentBtn');
        
        const closeModal = (method = null) => {
            DOM.modalContainer.innerHTML = '';
            resolve(method);
        };
        
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        
        closeBtn?.addEventListener('click', () => closeModal());
        cancelBtn?.addEventListener('click', () => closeModal());
        
        // Выбор способа оплаты
        document.querySelectorAll('[data-method]').forEach(btn => {
            btn.addEventListener('click', () => closeModal(btn.dataset.method));
        });
        
        // Быстрые суммы
        document.querySelectorAll('[data-amount]').forEach(btn => {
            btn.addEventListener('click', () => {
                const amount = parseFloat(btn.dataset.amount);
                const change = amount - total;
                showNotification(`Сдача: ${formatMoney(change)}`, 'info');
            });
        });
        
        // Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Показывает диалог подтверждения
 */
async function showConfirmDialog({ title, message, confirmText = 'Да', cancelText = 'Отмена' }) {
    return new Promise((resolve) => {
        const modalHtml = `
            <div class="modal-overlay" id="confirmModalOverlay">
                <div class="modal confirm-modal">
                    <div class="modal-header">
                        <h3>${escapeHtml(title)}</h3>
                        <button class="btn-close" id="closeConfirmModal">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="confirm-message">${message}</div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" id="cancelConfirmBtn">${escapeHtml(cancelText)}</button>
                        <button class="btn-primary" id="confirmBtn">${escapeHtml(confirmText)}</button>
                    </div>
                </div>
            </div>
        `;
        
        DOM.modalContainer.innerHTML = modalHtml;
        
        const overlay = document.getElementById('confirmModalOverlay');
        const closeBtn = document.getElementById('closeConfirmModal');
        const cancelBtn = document.getElementById('cancelConfirmBtn');
        const confirmBtn = document.getElementById('confirmBtn');
        
        const closeModal = (confirmed = false) => {
            DOM.modalContainer.innerHTML = '';
            resolve(confirmed);
        };
        
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        
        closeBtn?.addEventListener('click', () => closeModal());
        cancelBtn?.addEventListener('click', () => closeModal());
        confirmBtn?.addEventListener('click', () => closeModal(true));
        
        // Enter для подтверждения
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                closeModal(true);
                document.removeEventListener('keydown', handleEnter);
            }
        };
        document.addEventListener('keydown', handleEnter);
    });
}

/**
 * Показывает чек после продажи
 */
function showReceipt(items, total, paymentMethod) {
    const receiptHtml = `
        <div class="modal-overlay" id="receiptModalOverlay">
            <div class="modal receipt-modal">
                <div class="modal-header">
                    <h3>🧾 Чек</h3>
                    <button class="btn-close" id="closeReceiptModal">✕</button>
                </div>
                <div class="modal-body">
                    <div class="receipt-header">
                        <p>Смена #${state.currentShift?.id?.slice(0, 8)}</p>
                        <p>${new Date().toLocaleString('ru-RU')}</p>
                    </div>
                    
                    <table class="receipt-items">
                        ${items.map(item => `
                            <tr>
                                <td>${escapeHtml(item.name)}</td>
                                <td>${item.quantity} × ${formatMoney(item.price)}</td>
                                <td>${formatMoney(item.price * item.quantity)}</td>
                            </tr>
                        `).join('')}
                    </table>
                    
                    <div class="receipt-total">
                        <div class="total-row">
                            <span>ИТОГО:</span>
                            <strong>${formatMoney(total)}</strong>
                        </div>
                        <div class="payment-method">
                            Оплата: ${getPaymentMethodName(paymentMethod)}
                        </div>
                    </div>
                    
                    <div class="receipt-footer">
                        <p>Спасибо за покупку!</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" id="printReceiptBtn">🖨️ Печать</button>
                    <button class="btn-secondary" id="closeReceiptBtn">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    
    DOM.modalContainer.innerHTML = receiptHtml;
    
    const closeModal = () => {
        DOM.modalContainer.innerHTML = '';
    };
    
    document.getElementById('closeReceiptModal')?.addEventListener('click', closeModal);
    document.getElementById('closeReceiptBtn')?.addEventListener('click', closeModal);
    document.getElementById('printReceiptBtn')?.addEventListener('click', () => {
        window.print();
    });
    
    document.getElementById('receiptModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'receiptModalOverlay') closeModal();
    });
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

/**
 * Обработчик горячих клавиш
 */
function handleHotkeys(e) {
    // Ctrl+F - фокус на поиск
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
    }
    
    // F9 - оформление продажи
    if (e.key === 'F9') {
        e.preventDefault();
        if (state.cartItems.length > 0) {
            checkout();
        }
    }
    
    // Delete - очистка корзины
    if (e.key === 'Delete' && e.ctrlKey) {
        e.preventDefault();
        clearCart();
    }
}

/**
 * Обработчик сканера (поиск по ID)
 */
function handleScanner(value) {
    if (!value || state.isScanning) return;
    
    state.isScanning = true;
    
    // Ищем товар по ID
    const product = state.products.find(p => 
        p.id === value || 
        p.id?.startsWith(value)
    );
    
    if (product) {
        addToCart(product);
        document.getElementById('scanInput').value = '';
    } else {
        showNotification('Товар не найден', 'warning');
    }
    
    setTimeout(() => {
        state.isScanning = false;
    }, SCANNER_DEBOUNCE);
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Сохраняет смену в кэш
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
 * Сохраняет корзину в кэш
 */
function saveCartToCache() {
    try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
            items: state.cartItems,
            totalDiscount: state.cartTotalDiscount,
            itemDiscounts: Array.from(state.cartItemDiscounts.entries()),
            cachedAt: Date.now()
        }));
    } catch (e) {
        console.warn('[Cashier] Failed to cache cart:', e);
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Отображает информацию о пользователе
 */
function displayUserInfo() {
    if (DOM.userEmail) {
        const name = state.profile?.full_name || state.user?.email?.split('@')[0] || 'Пользователь';
        DOM.userEmail.textContent = name;
    }
}

/**
 * Показывает уведомление
 */
function showNotification(message, type = 'info') {
    if (!DOM.notificationContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-left: 3px solid;
        animation: slideIn 0.3s ease;
    `;
    
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    notification.style.borderLeftColor = colors[type] || colors.info;
    notification.textContent = message;
    
    DOM.notificationContainer.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ========== РЕНДЕРИНГ ==========

/**
 * Отрисовывает страницу
 */
function render() {
    if (!DOM.content) return;
    
    if (!state.currentShift) {
        renderClosedShift();
        return;
    }
    
    const categories = state.categories;
    const cartTotal = calculateTotal();
    const cartCount = state.cartItems.reduce((sum, i) => sum + i.quantity, 0);
    
    DOM.content.innerHTML = `
        <div class="cashier-layout">
            <!-- Левая панель - товары -->
            <div class="products-panel">
                <div class="shift-bar">
                    <div class="shift-status">
                        <span class="status-dot"></span>
                        <span>Смена открыта</span>
                        <span style="font-size: 12px; color: var(--color-text-muted);">
                            ${new Date(state.currentShift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
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
                        ${state.isShiftActionPending ? '...' : 'Закрыть смену'}
                    </button>
                </div>
                
                <div class="products-toolbar">
                    <div class="search-wrapper">
                        <span class="search-icon">🔍</span>
                        <input 
                            type="text" 
                            id="searchInput" 
                            class="search-input" 
                            placeholder="Поиск товара..."
                            value="${escapeHtml(state.searchQuery)}"
                        >
                        <button class="clear-btn ${state.searchQuery ? 'visible' : ''}" id="clearSearchBtn">✕</button>
                    </div>
                    
                    <div class="category-bar">
                        <button class="category-tab ${!state.selectedCategory ? 'active' : ''}" data-category="">
                            Все (${state.products.length})
                        </button>
                        ${categories.map(c => `
                            <button class="category-tab ${state.selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">
                                ${getCategoryName(c.value)} (${c.count})
                            </button>
                        `).join('')}
                    </div>
                </div>
                
                <div class="products-grid">
                    ${state.isLoading ? `
                        <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                            <div class="loading-spinner"></div>
                            <p>Загрузка товаров...</p>
                        </div>
                    ` : state.filteredProducts.map(p => `
                        <div class="product-card" data-id="${p.id}">
                            <div class="product-photo">
                                ${p.photo_url 
                                    ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}">` 
                                    : '📦'
                                }
                            </div>
                            <div class="product-info">
                                <div class="product-name">${escapeHtml(p.name)}</div>
                                <div class="product-price">${formatMoney(p.price)}</div>
                            </div>
                        </div>
                    `).join('')}
                    
                    ${!state.isLoading && state.filteredProducts.length === 0 ? `
                        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);">
                            <p>Товары не найдены</p>
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <!-- Правая панель - корзина -->
            <div class="cart-panel">
                <div class="cart-header">
                    <h2>🛒 Корзина</h2>
                    <span class="cart-count">${cartCount} поз.</span>
                    ${cartCount > 0 ? `
                        <button class="btn-ghost btn-sm" id="clearCartBtn">Очистить</button>
                    ` : ''}
                </div>
                
                <div class="cart-items">
                    ${state.cartItems.length === 0 ? `
                        <div class="cart-empty">
                            <div class="cart-empty-icon">🛒</div>
                            <p>Корзина пуста</p>
                            <p style="font-size: 12px; margin-top: 8px;">Нажмите на товар, чтобы добавить</p>
                        </div>
                    ` : state.cartItems.map(item => {
                        const itemDiscount = state.cartItemDiscounts.get(item.id) || 0;
                        const itemPrice = itemDiscount > 0 ? item.price * (1 - itemDiscount / 100) : item.price;
                        const itemTotal = itemPrice * item.quantity;
                        
                        return `
                            <div class="cart-item">
                                <div class="cart-item-header">
                                    <span class="cart-item-name">${escapeHtml(item.name)}</span>
                                    ${itemDiscount > 0 ? `
                                        <span style="color: var(--color-success-dark); font-size: 12px;">-${itemDiscount}%</span>
                                    ` : ''}
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
                    }).join('')}
                </div>
                
                <div class="cart-footer">
                    <div class="cart-summary">
                        ${state.cartTotalDiscount > 0 ? `
                            <div class="summary-row">
                                <span>Скидка ${state.cartTotalDiscount}%</span>
                                <span style="color: var(--color-success-dark);">-${formatMoney(calculateTotal() / (1 - state.cartTotalDiscount / 100) * state.cartTotalDiscount / 100)}</span>
                            </div>
                        ` : ''}
                        <div class="summary-row total">
                            <span>ИТОГО</span>
                            <span class="total-amount">${formatMoney(cartTotal)}</span>
                        </div>
                    </div>
                    
                    <button class="btn-checkout" id="checkoutBtn" ${cartCount === 0 ? 'disabled' : ''}>
                        Оформить продажу (F9)
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Привязываем события после рендера
    attachRenderEvents();
}

/**
 * Отрисовывает закрытую смену
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
 * Привязывает события после рендера
 */
function attachRenderEvents() {
    // Закрытие смены
    document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);
    
    // Очистка корзины
    document.getElementById('clearCartBtn')?.addEventListener('click', clearCart);
    
    // Оформление
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
    
    // Поиск
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    
    if (searchInput) {
        const debouncedSearch = debounce((value) => {
            state.searchQuery = value;
            applyFilters();
            render();
        }, 300);
        
        searchInput.addEventListener('input', (e) => {
            const value = e.target.value;
            debouncedSearch(value);
            
            if (clearSearchBtn) {
                clearSearchBtn.classList.toggle('visible', value.length > 0);
            }
        });
    }
    
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            state.searchQuery = '';
            if (searchInput) searchInput.value = '';
            clearSearchBtn.classList.remove('visible');
            applyFilters();
            render();
        });
    }
    
    // Категории
    document.querySelectorAll('[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.selectedCategory = btn.dataset.category || null;
            applyFilters();
            render();
        });
    });
    
    // Товары
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const product = state.products.find(p => p.id === id);
            if (product) addToCart(product);
        });
    });
    
    // Действия с корзиной
    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            
            switch (action) {
                case 'increase':
                    updateQuantity(id, 1);
                    break;
                case 'decrease':
                    updateQuantity(id, -1);
                    break;
                case 'remove':
                    removeFromCart(id);
                    break;
            }
        });
    });
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
