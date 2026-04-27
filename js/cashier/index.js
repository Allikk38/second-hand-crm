// ========================================
// FILE: js/cashier/index.js
// ========================================

/**
 * Cashier Page Module - Index
 * 
 * Точка входа для страницы кассового модуля.
 * Использует единый движок синхронизации sync-engine.js.
 * 
 * Архитектурные решения:
 * - Sync Engine для всех операций с данными (Cache First, Sync Later)
 * - Корзина в localStorage (быстрый доступ, не требует синхронизации)
 * - Оптимистичное оформление продаж без ожидания ответа сервера
 * - Единая очередь для продаж и управления сменой
 * 
 * @module cashier/index
 * @version 2.0.1
 * @changes
 * - v2.0.1: Добавлен вызов window.markCashierModuleLoaded() в конце init()
 * - v2.0.0: Полная интеграция с sync-engine.js
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

// ========== КОНСТАНТЫ ==========

const CART_STORAGE_KEY = 'sh_cashier_cart';
const SHIFT_STORAGE_KEY = 'sh_cashier_shift';
const CART_CACHE_TTL = 60 * 60 * 1000; // 60 минут

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

const state = {
    user: null,
    
    // Товары
    products: [],
    filteredProducts: [],
    categories: [],
    searchQuery: '',
    selectedCategory: null,
    isLoadingProducts: false,
    
    // Смена
    currentShift: null,
    shiftStats: { revenue: 0, salesCount: 0, profit: 0, itemsCount: 0 },
    isShiftActionPending: false,
    
    // Корзина
    cartItems: [],
    cartTotalDiscount: 0,
    
    // UI
    errorMessage: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    content: null,
    userEmail: null,
    logoutBtn: null,
    offlineBanner: null,
    offlineRetryBtn: null,
    syncBadge: null,
    syncStatus: null
};

// ========== ОФЛАЙН-БАННЕР И СИНХРОНИЗАЦИЯ ==========

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

// ========== КОРЗИНА (ЛОКАЛЬНАЯ) ==========

function calculateCartCount() {
    return state.cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

function calculateItemTotal(item) {
    const price = item.price || 0;
    const discount = item.discount || 0;
    const quantity = item.quantity || 0;
    const discountedPrice = price * (1 - discount / 100);
    return Math.round(discountedPrice * quantity);
}

function calculateCartTotal() {
    const subtotal = state.cartItems.reduce((sum, item) => sum + calculateItemTotal(item), 0);
    const total = subtotal * (1 - state.cartTotalDiscount / 100);
    return Math.max(0, Math.round(total));
}

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
            if (Date.now() - cart.cachedAt < CART_CACHE_TTL) {
                state.cartItems = cart.items || [];
                state.cartTotalDiscount = cart.totalDiscount || 0;
                return true;
            }
        }
    } catch (e) {
        console.warn('[Cashier] Failed to load cached cart:', e);
    }
    return false;
}

function addToCart(product) {
    const existing = state.cartItems.find(i => i.id === product.id);
    
    if (existing) {
        existing.quantity += 1;
    } else {
        state.cartItems.push({ ...product, quantity: 1, discount: 0 });
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
        state.cartItems = state.cartItems.filter(i => i.id !== productId);
    } else {
        item.quantity = newQty;
    }
    
    saveCartToCache();
    render();
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

function resetCart() {
    state.cartItems = [];
    state.cartTotalDiscount = 0;
    saveCartToCache();
}

// ========== РАБОТА С ТОВАРАМИ ==========

async function loadProductsData(forceRefresh = false) {
    state.isLoadingProducts = true;
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
                    .eq('status', 'in_stock')
                    .order('created_at', { ascending: false });
                
                if (error) throw error;
                return data || [];
            }
        });
        
        state.products = result.data || [];
        
        // Убираем оптимистично удалённые
        state.products = state.products.filter(p => !p._deleted);
        
        buildCategories();
        applyFilters();
        
    } catch (error) {
        console.error('[Cashier] Load products error:', error);
        if (state.products.length === 0) {
            showNotification('Ошибка загрузки товаров', 'error');
        }
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
    let filtered = state.products.filter(p => !p._deleted);
    
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name?.toLowerCase().includes(q) || 
            p.id?.toLowerCase().includes(q)
        );
    }
    
    if (state.selectedCategory) {
        filtered = filtered.filter(p => p.category === state.selectedCategory);
    }
    
    state.filteredProducts = filtered;
}

function findProductByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim();
    return state.products.find(p => p.id === cleanCode || p.barcode === cleanCode) || null;
}

// ========== РАБОТА СО СМЕНОЙ ==========

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
                return true;
            }
        }
    } catch (e) {
        console.warn('[Cashier] Failed to load cached shift:', e);
    }
    return false;
}

async function checkOpenShift() {
    if (!syncState.isOnline) {
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
        render();
    }
}

async function loadShiftStats() {
    if (!state.currentShift || !syncState.isOnline) return;
    
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
    
    if (!syncState.isOnline) {
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
    
    if (!syncState.isOnline) {
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
        resetCart();
        
        localStorage.removeItem(SHIFT_STORAGE_KEY);
        
        showNotification('Смена закрыта', 'success');
        
    } catch (error) {
        console.error('[Cashier] Close shift error:', error);
        showNotification('Ошибка закрытия смены: ' + error.message, 'error');
    } finally {
        state.isShiftActionPending = false;
        render();
    }
}

// ========== БЫСТРОЕ ДОБАВЛЕНИЕ ТОВАРА ==========

async function openQuickAddProductForm() {
    if (!syncState.isOnline) {
        showNotification('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    if (!state.currentShift) {
        showNotification('Откройте смену для добавления товаров', 'warning');
        return;
    }
    
    try {
        const newProduct = await openProductFormModal({
            mode: 'create',
            userId: state.user?.id,
            onSuccess: async (product) => {
                // Оптимистично добавляем в список
                product._optimistic = true;
                state.products.unshift(product);
                buildCategories();
                applyFilters();
                render();
                
                // Сохраняем через Sync Engine
                await saveChange(ENTITIES.PRODUCTS, OP_TYPES.CREATE, product);
                
                // Добавляем в корзину
                addToCart(product);
                
                updateSyncIndicator();
            }
        });
        
        if (newProduct) {
            newProduct._optimistic = true;
            state.products.unshift(newProduct);
            buildCategories();
            applyFilters();
            render();
            
            await saveChange(ENTITIES.PRODUCTS, OP_TYPES.CREATE, newProduct);
            addToCart(newProduct);
            updateSyncIndicator();
        }
        
    } catch (error) {
        console.error('[Cashier] Quick add error:', error);
        showNotification('Не удалось открыть форму добавления', 'error');
    }
}

// ========== ОФОРМЛЕНИЕ ПРОДАЖИ ==========

async function checkout() {
    if (state.cartItems.length === 0) {
        showNotification('Корзина пуста', 'warning');
        return;
    }
    
    if (!state.currentShift) {
        showNotification('Смена не открыта', 'warning');
        return;
    }
    
    const total = calculateCartTotal();
    const paymentMethod = await showPaymentModal(total);
    if (!paymentMethod) return;
    
    // Подготавливаем данные продажи
    const items = state.cartItems.map(item => ({
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
        shift_id: state.currentShift.id,
        items,
        total,
        profit,
        payment_method: paymentMethod,
        created_by: state.user?.id,
        created_at: new Date().toISOString()
    };
    
    // Оптимистично обновляем UI
    const cartSnapshot = [...state.cartItems];
    const totalSnapshot = total;
    const paymentMethodSnapshot = paymentMethod;
    
    // Очищаем корзину сразу
    resetCart();
    
    // Обновляем статистику смены оптимистично
    state.shiftStats.revenue += total;
    state.shiftStats.salesCount += 1;
    state.shiftStats.profit += profit;
    state.shiftStats.itemsCount += items.reduce((sum, i) => sum + i.quantity, 0);
    saveShiftToCache();
    
    // Помечаем товары как проданные в локальном стейте
    const soldProductIds = items.map(i => i.id);
    state.products = state.products.filter(p => !soldProductIds.includes(p.id));
    buildCategories();
    applyFilters();
    
    render();
    
    // Сохраняем продажу через Sync Engine
    try {
        await saveChange(ENTITIES.SALES, OP_TYPES.CREATE, saleData);
        
        // Обновляем статус товаров через Sync Engine
        for (const item of items) {
            await saveChange(
                ENTITIES.PRODUCTS,
                OP_TYPES.UPDATE,
                { id: item.id, status: 'sold', sold_at: new Date().toISOString() }
            );
        }
        
        showNotification(
            syncState.isOnline 
                ? `Продажа на ${formatMoney(total)} оформлена`
                : `Продажа сохранена локально. Синхронизируется при подключении к сети.`,
            'success'
        );
        
        showReceipt(cartSnapshot, totalSnapshot, paymentMethodSnapshot);
        
        // Перезагружаем товары для актуализации
        if (syncState.isOnline) {
            setTimeout(() => loadProductsData(true), 1000);
        }
        
    } catch (error) {
        console.error('[Cashier] Checkout error:', error);
        showNotification('Ошибка оформления продажи: ' + error.message, 'error');
        
        // Восстанавливаем корзину при ошибке
        state.cartItems = cartSnapshot;
        saveCartToCache();
        render();
    }
    
    updateSyncIndicator();
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
    if (!state.currentShift) return '';
    
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

function renderToolbar() {
    return `
        <div class="products-toolbar">
            <div class="toolbar-left">
                <div class="search-wrapper">
                    <input type="text" id="searchInput" class="search-input" 
                        placeholder="Поиск товара или сканирование..." 
                        value="${escapeHtml(state.searchQuery)}">
                </div>
                <button class="quick-add-btn" id="quickAddProductBtn" title="Быстрое добавление товара">
                    <span class="icon">➕</span>
                    <span>Быстрый товар</span>
                </button>
            </div>
            
            <div class="toolbar-right">
                ${(state.searchQuery || state.selectedCategory) ? `
                    <button class="btn-secondary btn-sm" id="resetFiltersBtn">Сбросить фильтры</button>
                ` : ''}
            </div>
        </div>
        <div class="category-bar">
            <button class="category-tab ${!state.selectedCategory ? 'active' : ''}" data-category="">
                Все (${state.products.length})
            </button>
            ${state.categories.map(c => `
                <button class="category-tab ${state.selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">
                    ${getCategoryName(c.value)} (${c.count})
                </button>
            `).join('')}
        </div>
    `;
}

function renderProductsGrid() {
    if (state.isLoadingProducts) {
        return '<div class="loading-spinner"></div>';
    }
    
    if (state.filteredProducts.length === 0) {
        const message = state.searchQuery || state.selectedCategory 
            ? 'По вашему запросу ничего не найдено'
            : 'Товары не найдены. Добавьте товар через кнопку "Быстрый товар".';
        
        return `<div class="empty-state">${message}</div>`;
    }
    
    return `
        <div class="products-grid">
            ${state.filteredProducts.map(p => `
                <div class="product-card ${p._optimistic ? 'optimistic' : ''}" data-id="${p.id}">
                    <div class="product-photo">
                        ${p.photo_url 
                            ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}" loading="lazy">` 
                            : '<span class="photo-placeholder">📦</span>'
                        }
                        ${p._optimistic ? '<span class="optimistic-badge" title="Ожидает синхронизации">⏳</span>' : ''}
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
    
    const itemsHtml = state.cartItems.length === 0 
        ? '<div class="cart-empty">Корзина пуста</div>'
        : state.cartItems.map(item => {
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
                ${state.cartItems.length > 0 ? '<button class="btn-ghost btn-sm" id="clearCartBtn">Очистить</button>' : ''}
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
    
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
        state.searchQuery = '';
        state.selectedCategory = null;
        applyFilters();
        render();
    });
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const scannerHandler = debounce((value) => {
            if (!value) {
                state.searchQuery = '';
                applyFilters();
                render();
                return;
            }
            
            const product = findProductByCode(value);
            if (product) {
                addToCart(product);
                searchInput.value = '';
                state.searchQuery = '';
                applyFilters();
            } else {
                state.searchQuery = value;
                applyFilters();
                render();
            }
        }, 300);
        
        searchInput.addEventListener('input', (e) => scannerHandler(e.target.value));
        searchInput.focus();
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

function cacheElements() {
    DOM.content = document.getElementById('cashierContent');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
    DOM.syncBadge = document.getElementById('syncBadge');
    DOM.syncStatus = document.getElementById('syncStatus');
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
            if (syncState.isOnline) {
                syncNow();
            }
            loadProductsData(true);
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
    
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        updateSyncIndicator();
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
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
            checkOpenShift();
            showNotification(`Синхронизировано операций: ${event.synced}`, 'success');
        }
    });
}

async function init() {
    console.log('[Cashier] Initializing...');
    
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
    attachGlobalEvents();
    
    // Загружаем кэшированные данные
    loadCartFromCache();
    loadShiftFromCache();
    
    // Проверяем смену и загружаем товары
    await checkOpenShift();
    await loadProductsData();
    
    // Сообщаем HTML-обёртке, что модуль загружен
    if (window.markCashierModuleLoaded) {
        window.markCashierModuleLoaded();
    }
    
    console.log('[Cashier] Initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
