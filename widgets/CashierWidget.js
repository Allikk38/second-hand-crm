// ========================================
// FILE: ./widgets/CashierWidget.js
// ========================================

/**
 * Cashier Widget - Виджет кассового модуля
 * 
 * Управляет интерфейсом кассира: открытие/закрытие смены,
 * отображение товаров, работа с корзиной и оформление продаж.
 * 
 * Архитектурные решения:
 * - Наследуется от BaseWidget.
 * - Содержит три дочерних панели: ShiftPanel, ProductGrid, CartPanel.
 * - Общение с данными только через EventBus.
 * - Поддержка офлайн-режима через localStorage.
 * 
 * @module CashierWidget
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { BaseWidget } from '../core-new/BaseWidget.js';
import { EventTypes, EventSource } from '../core-new/EventBus.js';

export class CashierWidget extends BaseWidget {
    constructor(container) {
        super(container);
        
        // Локальное состояние виджета
        this.state = {
            // Смена
            currentShift: null,
            shiftStats: { revenue: 0, salesCount: 0, profit: 0 },
            
            // Товары
            products: [],
            filteredProducts: [],
            categories: [],
            searchQuery: '',
            selectedCategory: null,
            
            // Корзина
            cartItems: [],
            cartTotalDiscount: 0,
            cartItemDiscounts: new Map(),
            
            // UI
            isLoading: false,
            isShiftActionPending: false,
            viewMode: 'grid'
        };
        
        // Привязка методов
        this.handleSearchInput = this.debounce(this.handleSearchInput.bind(this), 300);
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const hasOpenShift = this.state.currentShift !== null;
        
        return `
            <div class="cashier-widget">
                <div class="cashier-layout ${!hasOpenShift ? 'shift-closed' : ''}">
                    ${hasOpenShift ? this.renderMainLayout() : this.renderShiftClosed()}
                </div>
            </div>
        `;
    }
    
    renderMainLayout() {
        const { cartItems, shiftStats, searchQuery } = this.state;
        const cartItemsCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
        const cartTotal = this.calculateCartTotal();
        
        return `
            <!-- Левая панель: Смена + Товары -->
            <div class="products-panel">
                ${this.renderShiftPanel()}
                
                <div class="products-toolbar">
                    <div class="search-wrapper">
                        <input 
                            type="text" 
                            data-ref="searchInput"
                            class="search-input"
                            placeholder="🔍 Поиск товара..."
                            value="${this.escapeHtml(searchQuery)}"
                        >
                        ${searchQuery ? `
                            <button class="clear-btn" data-ref="clearSearchBtn">✕</button>
                        ` : ''}
                    </div>
                </div>
                
                ${this.renderCategories()}
                
                <div class="products-grid-container" data-ref="productGrid">
                    ${this.renderProductGrid()}
                </div>
            </div>
            
            <!-- Правая панель: Корзина -->
            <div class="cart-panel">
                <div class="cart-header">
                    <h2>🛒 Корзина</h2>
                    <span class="cart-count">${cartItemsCount} поз.</span>
                    ${cartItemsCount > 0 ? `
                        <button class="btn-ghost" data-ref="clearCartBtn">Очистить</button>
                    ` : ''}
                </div>
                
                <div class="cart-items-container" data-ref="cartItems">
                    ${this.renderCartItems()}
                </div>
                
                <div class="cart-footer">
                    <div class="cart-summary">
                        <div class="summary-row">
                            <span>Скидка:</span>
                            <div class="discount-control">
                                <input 
                                    type="number" 
                                    data-ref="totalDiscountInput"
                                    value="${this.state.cartTotalDiscount}" 
                                    min="0" 
                                    max="50"
                                >
                                <span>%</span>
                            </div>
                        </div>
                        
                        <div class="summary-row total-row">
                            <span>ИТОГО:</span>
                            <span class="total-amount">${this.formatMoney(cartTotal)}</span>
                        </div>
                    </div>
                    
                    <button 
                        class="btn-checkout" 
                        data-ref="checkoutBtn"
                        ${cartItemsCount === 0 ? 'disabled' : ''}
                    >
                        Оформить продажу
                    </button>
                </div>
            </div>
        `;
    }
    
    renderShiftPanel() {
        const { currentShift, shiftStats, isShiftActionPending } = this.state;
        const isLocalShift = currentShift?.is_local || false;
        
        return `
            <div class="shift-bar">
                <div class="shift-info">
                    <span class="shift-status ${isLocalShift ? 'local' : ''}">
                        ${isLocalShift ? '📡 Офлайн' : '🟢 Смена открыта'}
                    </span>
                    <span class="shift-time">
                        ${new Date(currentShift?.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
                
                <div class="shift-stats">
                    <div class="stat-item">
                        <span>Выручка</span>
                        <strong>${this.formatMoney(shiftStats.revenue)}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Продаж</span>
                        <strong>${shiftStats.salesCount}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Прибыль</span>
                        <strong>${this.formatMoney(shiftStats.profit)}</strong>
                    </div>
                </div>
                
                <button 
                    class="btn-secondary" 
                    data-ref="closeShiftBtn"
                    ${isShiftActionPending ? 'disabled' : ''}
                >
                    ${isShiftActionPending ? 'Закрытие...' : 'Закрыть смену'}
                </button>
            </div>
        `;
    }
    
    renderShiftClosed() {
        const { isShiftActionPending } = this.state;
        
        return `
            <div class="shift-closed-overlay">
                <div class="closed-icon">🔒</div>
                <h2>Смена закрыта</h2>
                <p>Для начала работы откройте смену</p>
                <button 
                    class="btn-primary" 
                    data-ref="openShiftBtn"
                    ${isShiftActionPending ? 'disabled' : ''}
                >
                    ${isShiftActionPending ? 'Открытие...' : 'Открыть смену'}
                </button>
            </div>
        `;
    }
    
    renderCategories() {
        const { categories, selectedCategory } = this.state;
        
        if (categories.length === 0) return '';
        
        return `
            <div class="category-bar">
                <button 
                    class="category-tab ${!selectedCategory ? 'active' : ''}"
                    data-category="all"
                >
                    Все
                </button>
                ${categories.map(cat => `
                    <button 
                        class="category-tab ${selectedCategory === cat.value ? 'active' : ''}"
                        data-category="${cat.value}"
                    >
                        ${cat.label} (${cat.count})
                    </button>
                `).join('')}
            </div>
        `;
    }
    
    renderProductGrid() {
        const { filteredProducts } = this.state;
        
        if (filteredProducts.length === 0) {
            return `
                <div class="empty-state">
                    <span>📦</span>
                    <p>Нет товаров в наличии</p>
                </div>
            `;
        }
        
        return `
            <div class="products-grid">
                ${filteredProducts.map(p => this.renderProductCard(p)).join('')}
            </div>
        `;
    }
    
    renderProductCard(product) {
        return `
            <div class="product-card" data-id="${product.id}" data-action="addToCart">
                <div class="product-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}">` 
                        : '📦'
                    }
                </div>
                <div class="product-info">
                    <div class="product-name">${this.escapeHtml(product.name)}</div>
                    <div class="product-price">${this.formatMoney(product.price)}</div>
                </div>
                <button class="add-btn" data-action="addToCart" data-id="${product.id}">+</button>
            </div>
        `;
    }
    
    renderCartItems() {
        const { cartItems, cartItemDiscounts } = this.state;
        
        if (cartItems.length === 0) {
            return `
                <div class="cart-empty">
                    <span>🛒</span>
                    <p>Корзина пуста</p>
                </div>
            `;
        }
        
        return cartItems.map(item => {
            const discount = cartItemDiscounts.get(item.id) || 0;
            const price = discount > 0 ? item.price * (1 - discount / 100) : item.price;
            const total = price * item.quantity;
            
            return `
                <div class="cart-item" data-id="${item.id}">
                    <div class="item-info">
                        <span class="item-name">${this.escapeHtml(item.name)}</span>
                        <span class="item-price">${this.formatMoney(price)} × ${item.quantity}</span>
                    </div>
                    <div class="item-actions">
                        <button data-action="decreaseQty" data-id="${item.id}">−</button>
                        <span class="item-qty">${item.quantity}</span>
                        <button data-action="increaseQty" data-id="${item.id}">+</button>
                        <button class="remove-btn" data-action="removeItem" data-id="${item.id}">✕</button>
                    </div>
                    <div class="item-total">${this.formatMoney(total)}</div>
                </div>
            `;
        }).join('');
    }

    // ========== ПОСЛЕ РЕНДЕРА ==========
    
    async afterRender() {
        // Загружаем сохраненную смену из localStorage
        this.loadCachedShift();
        
        // Запрашиваем товары
        this.loadProducts();
        
        // Запрашиваем текущую смену с сервера
        this.checkOpenShift();
    }
    
    attachEvents() {
        // Подписки на события данных
        this.subscribe(EventTypes.DATA.PRODUCTS_FETCHED, (data) => {
            if (data.source !== EventSource.ADAPTER_SUPABASE) return;
            
            this.state.products = data.products.filter(p => p.status === 'in_stock');
            this.state.filteredProducts = this.state.products;
            this.buildCategories();
            this.update();
        });
        
        this.subscribe(EventTypes.DATA.SHIFT_OPENED, (data) => {
            this.state.currentShift = data.shift;
            this.state.isShiftActionPending = false;
            this.saveShiftToCache(data.shift);
            this.update();
            
            this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
                type: 'success',
                message: 'Смена успешно открыта'
            });
        });
        
        this.subscribe(EventTypes.DATA.SHIFT_CLOSED, () => {
            this.state.currentShift = null;
            this.state.shiftStats = { revenue: 0, salesCount: 0, profit: 0 };
            this.state.cartItems = [];
            this.state.isShiftActionPending = false;
            localStorage.removeItem('cached_shift');
            this.update();
            
            this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
                type: 'success',
                message: 'Смена закрыта'
            });
        });
        
        // DOM события
        this.addDomListener('openShiftBtn', 'click', () => this.handleOpenShift());
        this.addDomListener('closeShiftBtn', 'click', () => this.handleCloseShift());
        this.addDomListener('searchInput', 'input', this.handleSearchInput);
        this.addDomListener('clearSearchBtn', 'click', () => this.clearSearch());
        this.addDomListener('checkoutBtn', 'click', () => this.handleCheckout());
        this.addDomListener('clearCartBtn', 'click', () => this.handleClearCart());
        
        // Делегирование событий
        this.container.addEventListener('click', (e) => {
            // Категории
            const categoryTab = e.target.closest('[data-category]');
            if (categoryTab) {
                this.handleCategorySelect(categoryTab.dataset.category);
                return;
            }
            
            // Товары
            const addBtn = e.target.closest('[data-action="addToCart"]');
            if (addBtn) {
                const id = addBtn.dataset.id;
                this.handleAddToCart(id);
                return;
            }
            
            // Корзина
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                
                if (action === 'increaseQty') this.handleUpdateQuantity(id, 1);
                if (action === 'decreaseQty') this.handleUpdateQuantity(id, -1);
                if (action === 'removeItem') this.handleRemoveItem(id);
                return;
            }
        });
    }

    // ========== БИЗНЕС-ЛОГИКА ==========
    
    async checkOpenShift() {
        // Проверяем localStorage
        const cached = localStorage.getItem('cached_shift');
        if (cached) {
            try {
                const shift = JSON.parse(cached);
                // Проверяем, не старше ли смена 24 часов
                const age = Date.now() - new Date(shift.opened_at).getTime();
                if (age < 24 * 60 * 60 * 1000) {
                    this.state.currentShift = shift;
                    this.update();
                } else {
                    localStorage.removeItem('cached_shift');
                }
            } catch (e) {
                localStorage.removeItem('cached_shift');
            }
        }
        
        // Запрашиваем с сервера
        this.publish(EventTypes.DATA.SHIFT_OPEN, {
            action: 'check'
        });
    }
    
    handleOpenShift() {
        if (this.state.isShiftActionPending) return;
        
        this.state.isShiftActionPending = true;
        this.update();
        
        // Отправляем запрос на открытие смены
        this.publish(EventTypes.DATA.SHIFT_OPEN, {
            userId: 'current_user', // TODO: получить из AuthWidget
            initialCash: 0
        });
    }
    
    handleCloseShift() {
        if (!this.state.currentShift) return;
        
        this.publish(EventTypes.UI.MODAL_OPENED, {
            type: 'confirm-dialog',
            data: {
                title: 'Закрытие смены',
                message: `Закрыть смену? Выручка: ${this.formatMoney(this.state.shiftStats.revenue)}`,
                onConfirm: () => {
                    this.state.isShiftActionPending = true;
                    this.update();
                    
                    this.publish(EventTypes.DATA.SHIFT_CLOSE, {
                        shiftId: this.state.currentShift.id,
                        finalCash: this.state.shiftStats.revenue
                    });
                }
            }
        });
    }
    
    loadProducts() {
        this.state.isLoading = true;
        
        this.publish(EventTypes.DATA.PRODUCTS_FETCH, {
            page: 0,
            limit: 100,
            filters: { status: 'in_stock' }
        });
        
        this.state.isLoading = false;
    }
    
    buildCategories() {
        const counts = new Map();
        
        this.state.products.forEach(p => {
            const cat = p.category || 'other';
            counts.set(cat, (counts.get(cat) || 0) + 1);
        });
        
        this.state.categories = Array.from(counts.entries())
            .map(([value, count]) => ({ value, label: this.getCategoryName(value), count }))
            .sort((a, b) => b.count - a.count);
    }
    
    handleSearchInput(e) {
        const query = e.target.value.toLowerCase();
        this.state.searchQuery = query;
        
        if (query) {
            this.state.filteredProducts = this.state.products.filter(p => 
                p.name.toLowerCase().includes(query) ||
                p.id.toLowerCase().includes(query)
            );
        } else {
            this.state.filteredProducts = this.state.products;
        }
        
        this.update();
    }
    
    clearSearch() {
        this.state.searchQuery = '';
        this.state.filteredProducts = this.state.products;
        const input = this.refs.get('searchInput');
        if (input) input.value = '';
        this.update();
    }
    
    handleCategorySelect(category) {
        this.state.selectedCategory = category === 'all' ? null : category;
        
        let filtered = this.state.products;
        
        if (this.state.selectedCategory) {
            filtered = filtered.filter(p => p.category === this.state.selectedCategory);
        }
        
        if (this.state.searchQuery) {
            const q = this.state.searchQuery;
            filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
        }
        
        this.state.filteredProducts = filtered;
        this.update();
    }
    
    handleAddToCart(id) {
        const product = this.state.products.find(p => p.id === id);
        if (!product) return;
        
        const existing = this.state.cartItems.find(i => i.id === id);
        
        if (existing) {
            existing.quantity += 1;
        } else {
            this.state.cartItems.push({ ...product, quantity: 1 });
        }
        
        this.saveCartToCache();
        this.update();
        
        this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
            type: 'success',
            message: `${product.name} добавлен в корзину`
        });
    }
    
    handleUpdateQuantity(id, delta) {
        const item = this.state.cartItems.find(i => i.id === id);
        if (!item) return;
        
        const newQty = item.quantity + delta;
        
        if (newQty <= 0) {
            this.handleRemoveItem(id);
        } else {
            item.quantity = newQty;
            this.saveCartToCache();
            this.update();
        }
    }
    
    handleRemoveItem(id) {
        this.state.cartItems = this.state.cartItems.filter(i => i.id !== id);
        this.state.cartItemDiscounts.delete(id);
        this.saveCartToCache();
        this.update();
    }
    
    handleClearCart() {
        if (this.state.cartItems.length === 0) return;
        
        this.publish(EventTypes.UI.MODAL_OPENED, {
            type: 'confirm-dialog',
            data: {
                title: 'Очистка корзины',
                message: 'Удалить все товары из корзины?',
                onConfirm: () => {
                    this.state.cartItems = [];
                    this.state.cartTotalDiscount = 0;
                    this.state.cartItemDiscounts.clear();
                    localStorage.removeItem('cached_cart');
                    this.update();
                }
            }
        });
    }
    
    handleCheckout() {
        if (this.state.cartItems.length === 0) return;
        
        const total = this.calculateCartTotal();
        
        this.publish(EventTypes.UI.MODAL_OPENED, {
            type: 'payment-modal',
            data: {
                total,
                onConfirm: (method) => {
                    // TODO: Отправить событие создания продажи
                    this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
                        type: 'success',
                        message: `Продажа на ${this.formatMoney(total)}`
                    });
                    
                    this.state.cartItems = [];
                    this.state.shiftStats.salesCount++;
                    this.state.shiftStats.revenue += total;
                    localStorage.removeItem('cached_cart');
                    this.update();
                }
            }
        });
    }

    // ========== ВЫЧИСЛЕНИЯ ==========
    
    calculateCartTotal() {
        let subtotal = this.state.cartItems.reduce((sum, item) => {
            const discount = this.state.cartItemDiscounts.get(item.id) || 0;
            const price = discount > 0 ? item.price * (1 - discount / 100) : item.price;
            return sum + (price * item.quantity);
        }, 0);
        
        if (this.state.cartTotalDiscount > 0) {
            subtotal = subtotal * (1 - this.state.cartTotalDiscount / 100);
        }
        
        return Math.max(0, subtotal);
    }

    // ========== КЭШИРОВАНИЕ ==========
    
    saveShiftToCache(shift) {
        try {
            localStorage.setItem('cached_shift', JSON.stringify(shift));
        } catch (e) {
            console.warn('Failed to cache shift:', e);
        }
    }
    
    loadCachedShift() {
        try {
            const cached = localStorage.getItem('cached_shift');
            if (cached) {
                this.state.currentShift = JSON.parse(cached);
            }
            
            const cartCached = localStorage.getItem('cached_cart');
            if (cartCached) {
                const cart = JSON.parse(cartCached);
                this.state.cartItems = cart.items || [];
                this.state.cartTotalDiscount = cart.discount || 0;
            }
        } catch (e) {
            console.warn('Failed to load cached data:', e);
        }
    }
    
    saveCartToCache() {
        try {
            localStorage.setItem('cached_cart', JSON.stringify({
                items: this.state.cartItems,
                discount: this.state.cartTotalDiscount,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Failed to cache cart:', e);
        }
    }

    // ========== УТИЛИТЫ ==========
    
    getCategoryName(category) {
        const names = {
            clothes: 'Одежда',
            toys: 'Игрушки',
            dishes: 'Посуда',
            other: 'Другое'
        };
        return names[category] || category;
    }
    
    debounce(fn, delay) {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
}

export default CashierWidget;
