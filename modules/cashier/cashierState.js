/**
 * Cashier State - Page State Manager
 * 
 * Управление состоянием страницы кассы.
 * Хранит товары, корзину, фильтры и статистику смены.
 * 
 * @module cashierState
 * @version 4.1.0
 * @changes
 * - Добавлено кэширование вычислений корзины
 * - Добавлена валидация остатков при добавлении
 * - Упрощена структура
 */

import { EventBus } from '../../core/EventBus.js';

// Кэш для вычислений корзины
let cartCache = {
    subtotal: 0,
    itemsDiscount: 0,
    totalDiscountAmount: 0,
    total: 0,
    totalQuantity: 0,
    version: 0
};

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
        this._cacheVersion = 0;
    }
    
    // ========== ГЕТТЕРЫ / СЕТТЕРЫ ==========
    
    get(key) {
        return this._state[key];
    }
    
    set(key, value) {
        const oldValue = this._state[key];
        this._state[key] = value;
        
        // Инвалидируем кэш при изменении корзины
        if (['cartItems', 'cartTotalDiscount', 'cartItemDiscounts'].includes(key)) {
            this._invalidateCartCache();
        }
        
        this._notify([{ key, newValue: value, oldValue }]);
    }
    
    setMultiple(updates) {
        const changes = [];
        let invalidateCache = false;
        
        Object.entries(updates).forEach(([key, value]) => {
            const oldValue = this._state[key];
            this._state[key] = value;
            changes.push({ key, newValue: value, oldValue });
            
            if (['cartItems', 'cartTotalDiscount', 'cartItemDiscounts'].includes(key)) {
                invalidateCache = true;
            }
        });
        
        if (invalidateCache) {
            this._invalidateCartCache();
        }
        
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
    
    // ========== КЭШ КОРЗИНЫ ==========
    
    _invalidateCartCache() {
        this._cacheVersion++;
        cartCache.version = this._cacheVersion;
    }
    
    _getCachedOrCompute(computeFn) {
        if (cartCache.version !== this._cacheVersion) {
            cartCache = {
                subtotal: this._computeSubtotal(),
                itemsDiscount: this._computeItemsDiscount(),
                totalDiscountAmount: 0,
                total: 0,
                totalQuantity: this._computeTotalQuantity(),
                version: this._cacheVersion
            };
            cartCache.totalDiscountAmount = this._computeTotalDiscountAmount(cartCache.subtotal, cartCache.itemsDiscount);
            cartCache.total = this._computeTotal(cartCache.subtotal, cartCache.itemsDiscount, cartCache.totalDiscountAmount);
        }
        
        return computeFn(cartCache);
    }
    
    _computeSubtotal() {
        return this._state.cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }
    
    _computeItemsDiscount() {
        return this._state.cartItems.reduce((sum, item) => {
            const discount = this._state.cartItemDiscounts.get(item.id) || 0;
            if (discount > 0) {
                return sum + (item.price * item.quantity * discount / 100);
            }
            return sum;
        }, 0);
    }
    
    _computeTotalDiscountAmount(subtotal, itemsDiscount) {
        const subtotalAfterItems = subtotal - itemsDiscount;
        return subtotalAfterItems * (this._state.cartTotalDiscount / 100);
    }
    
    _computeTotal(subtotal, itemsDiscount, totalDiscountAmount) {
        return Math.max(0, subtotal - itemsDiscount - totalDiscountAmount);
    }
    
    _computeTotalQuantity() {
        return this._state.cartItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    
    getCartTotalQuantity() {
        return this._getCachedOrCompute(cache => cache.totalQuantity);
    }
    
    getCartSubtotal() {
        return this._getCachedOrCompute(cache => cache.subtotal);
    }
    
    getCartItemsDiscountAmount() {
        return this._getCachedOrCompute(cache => cache.itemsDiscount);
    }
    
    getCartTotalDiscountAmount() {
        return this._getCachedOrCompute(cache => cache.totalDiscountAmount);
    }
    
    getCartTotal() {
        return this._getCachedOrCompute(cache => cache.total);
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
        // Проверка остатка (если есть поле stock)
        if (product.stock !== undefined && product.stock <= 0) {
            console.warn('[CashierState] Product out of stock:', product.name);
            return false;
        }
        
        const existing = this._state.cartItems.find(i => i.id === product.id);
        
        if (existing) {
            // Проверка лимита
            if (product.stock !== undefined && existing.quantity >= product.stock) {
                console.warn('[CashierState] Max stock reached:', product.name);
                return false;
            }
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
        
        this._invalidateCartCache();
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
            this._invalidateCartCache();
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
            const maxStock = item.stock || 999;
            const newQuantity = Math.max(1, Math.min(quantity, maxStock));
            if (item.quantity !== newQuantity) {
                item.quantity = newQuantity;
                this._invalidateCartCache();
                this._notify([{ key: 'cartItems', newValue: this._state.cartItems, oldValue: null }]);
            }
        }
    }
    
    setCartItemDiscount(id, discount) {
        const maxDiscount = 30;
        const validDiscount = Math.min(Math.max(0, discount), maxDiscount);
        
        if (validDiscount === 0) {
            this._state.cartItemDiscounts.delete(id);
        } else {
            this._state.cartItemDiscounts.set(id, validDiscount);
        }
        
        this._invalidateCartCache();
        this._notify([{ key: 'cartItemDiscounts', newValue: this._state.cartItemDiscounts, oldValue: null }]);
    }
    
    clearCart() {
        this._state.cartItems = [];
        this._state.cartTotalDiscount = 0;
        this._state.cartItemDiscounts.clear();
        this._state.cartPaymentMethod = 'cash';
        
        this._invalidateCartCache();
        this._notify([
            { key: 'cartItems', newValue: [], oldValue: null },
            { key: 'cartTotalDiscount', newValue: 0, oldValue: null },
            { key: 'cartItemDiscounts', newValue: new Map(), oldValue: null },
            { key: 'cartPaymentMethod', newValue: 'cash', oldValue: null }
        ]);
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
        
        // Разворачиваем категории при поиске
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
        
        this._notify([{ key: 'categories', newValue: this._state.categories, oldValue: null }]);
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
        
        this._invalidateCartCache();
        this._notify([{ key: 'reset', newValue: null, oldValue: null }]);
    }
}

export const CashierState = new CashierStateClass();
