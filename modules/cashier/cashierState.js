/**
 * Cashier State - Page State Manager
 * 
 * Управление состоянием страницы кассы.
 * Хранит товары, корзину, фильтры и статистику смены.
 * 
 * @module cashierState
 * @version 1.0.0
 */

import { EventBus } from '../../core/EventBus.js';

class CashierStateClass {
    constructor() {
        this._state = {
            // Смена
            currentShift: null,
            shiftStats: {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            },
            
            // Товары
            products: [],
            filteredProducts: [],
            categories: [],
            popularProducts: [],
            recentlyAdded: [],
            
            // UI состояние
            searchQuery: '',
            selectedCategory: null,
            expandedCategories: new Set(),
            viewMode: 'grid',
            isLoading: false,
            
            // Корзина
            cartItems: [],
            cartTotalDiscount: 0,
            cartPaymentMethod: 'cash',
            cartItemDiscounts: new Map(),
            
            // Сканер
            scannerInput: ''
        };
        
        this._subscribers = new Set();
    }
    
    // ========== ГЕТТЕРЫ / СЕТТЕРЫ ==========
    
    get(key) {
        return this._state[key];
    }
    
    set(key, value) {
        const oldValue = this._state[key];
        this._state[key] = value;
        this._notify([{ key, newValue: value, oldValue }]);
    }
    
    setMultiple(updates) {
        const changes = [];
        Object.entries(updates).forEach(([key, value]) => {
            const oldValue = this._state[key];
            this._state[key] = value;
            changes.push({ key, newValue: value, oldValue });
        });
        this._notify(changes);
    }
    
    getState() {
        return {
            ...this._state,
            expandedCategories: new Set(this._state.expandedCategories),
            cartItemDiscounts: new Map(this._state.cartItemDiscounts)
        };
    }
    
    subscribe(callback) {
        this._subscribers.add(callback);
        return () => this._subscribers.delete(callback);
    }
    
    _notify(changes) {
        this._subscribers.forEach(callback => {
            callback(Array.isArray(changes) ? changes : [changes]);
        });
        
        changes.forEach(change => {
            EventBus.emit(`cashier:${change.key}:changed`, {
                newValue: change.newValue,
                oldValue: change.oldValue
            });
        });
    }
    
    // ========== СМЕНА ==========
    
    hasOpenShift() {
        return this._state.currentShift !== null;
    }
    
    getShiftId() {
        return this._state.currentShift?.id || null;
    }
    
    // ========== КОРЗИНА ==========
    
    addToCart(product) {
        const existing = this._state.cartItems.find(i => i.id === product.id);
        
        if (existing) {
            existing.quantity += 1;
        } else {
            this._state.cartItems.push({
                ...product,
                quantity: 1
            });
        }
        
        // Добавляем в недавние
        if (!this._state.recentlyAdded.find(p => p.id === product.id)) {
            this._state.recentlyAdded.unshift(product);
            if (this._state.recentlyAdded.length > 5) {
                this._state.recentlyAdded.pop();
            }
        }
        
        this._notify([
            { key: 'cartItems', newValue: this._state.cartItems, oldValue: null },
            { key: 'recentlyAdded', newValue: this._state.recentlyAdded, oldValue: null }
        ]);
        
        return true;
    }
    
    removeFromCart(id) {
        const index = this._state.cartItems.findIndex(i => i.id === id);
        if (index !== -1) {
            this._state.cartItems.splice(index, 1);
            this._state.cartItemDiscounts.delete(id);
            this._notify([
                { key: 'cartItems', newValue: this._state.cartItems, oldValue: null },
                { key: 'cartItemDiscounts', newValue: this._state.cartItemDiscounts, oldValue: null }
            ]);
            return true;
        }
        return false;
    }
    
    updateCartItemQuantity(id, quantity) {
        const item = this._state.cartItems.find(i => i.id === id);
        if (item) {
            item.quantity = Math.max(1, Math.min(quantity, 999));
            this._notify([{ key: 'cartItems', newValue: this._state.cartItems, oldValue: null }]);
        }
    }
    
    setCartItemDiscount(id, discount) {
        if (discount === 0) {
            this._state.cartItemDiscounts.delete(id);
        } else {
            this._state.cartItemDiscounts.set(id, Math.min(discount, 30));
        }
        this._notify([{ key: 'cartItemDiscounts', newValue: this._state.cartItemDiscounts, oldValue: null }]);
    }
    
    clearCart() {
        this._state.cartItems = [];
        this._state.cartTotalDiscount = 0;
        this._state.cartItemDiscounts.clear();
        this._state.cartPaymentMethod = 'cash';
        this._notify([
            { key: 'cartItems', newValue: [], oldValue: null },
            { key: 'cartTotalDiscount', newValue: 0, oldValue: null },
            { key: 'cartItemDiscounts', newValue: new Map(), oldValue: null }
        ]);
    }
    
    getCartTotalQuantity() {
        return this._state.cartItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    
    getCartSubtotal() {
        return this._state.cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }
    
    getCartItemsDiscountAmount() {
        return this._state.cartItems.reduce((sum, item) => {
            const discount = this._state.cartItemDiscounts.get(item.id) || 0;
            if (discount > 0) {
                return sum + (item.price * item.quantity * discount / 100);
            }
            return sum;
        }, 0);
    }
    
    getCartTotalDiscountAmount() {
        const subtotalAfterItems = this.getCartSubtotal() - this.getCartItemsDiscountAmount();
        return subtotalAfterItems * (this._state.cartTotalDiscount / 100);
    }
    
    getCartTotal() {
        const subtotal = this.getCartSubtotal();
        const itemsDiscount = this.getCartItemsDiscountAmount();
        const subtotalAfterItems = subtotal - itemsDiscount;
        const totalDiscount = subtotalAfterItems * (this._state.cartTotalDiscount / 100);
        return Math.max(0, subtotalAfterItems - totalDiscount);
    }
    
    // ========== ФИЛЬТРАЦИЯ ТОВАРОВ ==========
    
    filterProducts() {
        let filtered = this._state.products.filter(p => p.status === 'in_stock');
        
        if (this._state.searchQuery) {
            const query = this._state.searchQuery.toLowerCase();
            filtered = filtered.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(query);
                const idMatch = p.id.toLowerCase().includes(query);
                const keywordMatch = p.keywords?.toLowerCase().includes(query);
                const attrMatch = p.attributes && Object.values(p.attributes).some(
                    v => v && v.toString().toLowerCase().includes(query)
                );
                return nameMatch || idMatch || keywordMatch || attrMatch;
            });
        }
        
        if (this._state.selectedCategory) {
            filtered = filtered.filter(p => p.category === this._state.selectedCategory);
        }
        
        this._state.filteredProducts = filtered;
        
        if (this._state.searchQuery) {
            const categories = new Set(filtered.map(p => p.category));
            this._state.expandedCategories = categories;
        }
        
        this._notify([{ key: 'filteredProducts', newValue: filtered, oldValue: null }]);
    }
    
    // ========== КАТЕГОРИИ ==========
    
    buildCategories() {
        const counts = new Map();
        this._state.products.forEach(p => {
            if (p.status === 'in_stock') {
                const cat = p.category || 'other';
                counts.set(cat, (counts.get(cat) || 0) + 1);
            }
        });
        
        this._state.categories = Array.from(counts.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count);
    }
    
    toggleCategory(category) {
        if (this._state.expandedCategories.has(category)) {
            this._state.expandedCategories.delete(category);
        } else {
            this._state.expandedCategories.add(category);
        }
        this._notify([{ key: 'expandedCategories', newValue: this._state.expandedCategories, oldValue: null }]);
    }
    
    // ========== СБРОС ==========
    
    reset() {
        this._state = {
            ...this._state,
            products: [],
            filteredProducts: [],
            searchQuery: '',
            selectedCategory: null,
            expandedCategories: new Set(),
            cartItems: [],
            cartTotalDiscount: 0,
            cartItemDiscounts: new Map(),
            scannerInput: ''
        };
        this._notify([{ key: 'reset', newValue: null, oldValue: null }]);
    }
}

export const CashierState = new CashierStateClass();
