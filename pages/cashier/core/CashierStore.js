/**
 * Cashier Store
 * 
 * Централизованное хранилище состояния кассового модуля.
 * Управляет сменой, товарами, корзиной и UI-состоянием.
 * 
 * Архитектурные решения:
 * - Реактивность через Proxy (автоматическое отслеживание изменений)
 * - Кэширование вычислений корзины для производительности
 * - Сохранение состояния в localStorage для восстановления после перезагрузки
 * - Изоляция от других модулей (только касса)
 * 
 * @module CashierStore
 * @version 6.0.0
 * @changes
 * - Создан специально для MPA архитектуры
 * - Не зависит от общего Store
 * - Добавлено кэширование вычислений
 * - Добавлено сохранение в localStorage
 */

import { EventBus } from '../../../core/EventBus.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY = 'cashier_store';
const CART_CACHE_KEY = 'cashier_cart';
const MAX_TOTAL_DISCOUNT = 50;
const MAX_ITEM_DISCOUNT = 30;

class CashierStoreClass {
    constructor() {
        // Приватное состояние
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
            recentProducts: [],
            
            // UI состояние
            searchQuery: '',
            selectedCategory: null,
            isLoading: false,
            
            // Корзина
            cartItems: [],
            cartTotalDiscount: 0,
            cartPaymentMethod: 'cash',
            cartItemDiscounts: new Map(),
            
            // Метаданные
            userId: null,
            userName: null
        };
        
        // Кэш вычислений корзины
        this._cartCache = {
            subtotal: 0,
            itemsDiscount: 0,
            totalDiscountAmount: 0,
            total: 0,
            totalQuantity: 0,
            version: 0
        };
        
        // Подписчики на изменения
        this._subscribers = new Map();
        
        // Реактивный прокси
        this.state = this._createReactiveProxy(this._state, '');
        
        // Версия кэша
        this._cacheVersion = 0;
    }
    
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    /**
     * Инициализирует хранилище
     * @param {Object} options - Опции инициализации
     */
    init(options = {}) {
        this._state.userId = options.userId || null;
        this._state.userName = options.userName || null;
        
        console.log('[CashierStore] Initialized for user:', this._state.userName);
    }
    
    // ========== РЕАКТИВНЫЙ PROXY ==========
    
    /**
     * Создает рекурсивный Proxy для отслеживания изменений
     * @param {Object} target - Целевой объект
     * @param {string} path - Текущий путь в дереве состояния
     * @returns {Proxy}
     */
    _createReactiveProxy(target, path) {
        const self = this;
        
        return new Proxy(target, {
            get(obj, prop) {
                const value = obj[prop];
                const newPath = path ? `${path}.${prop}` : prop;
                
                // Если значение - объект и не является примитивом, оборачиваем в Proxy
                if (value && typeof value === 'object' && !(value instanceof Map) && !(value instanceof Set)) {
                    return self._createReactiveProxy(value, newPath);
                }
                
                return value;
            },
            
            set(obj, prop, value) {
                const oldValue = obj[prop];
                
                // Если значение не изменилось - ничего не делаем
                if (oldValue === value) {
                    return true;
                }
                
                // Устанавливаем новое значение
                obj[prop] = value;
                
                // Инвалидируем кэш при изменении корзины
                if (path.startsWith('cartItems') || path.startsWith('cartTotalDiscount') || path.startsWith('cartItemDiscounts')) {
                    self._invalidateCartCache();
                }
                
                // Формируем полный путь к измененному свойству
                const changePath = path ? `${path}.${prop}` : prop;
                
                // Оповещаем подписчиков
                self._notifyChange(changePath, value, oldValue);
                
                return true;
            },
            
            deleteProperty(obj, prop) {
                if (prop in obj) {
                    const oldValue = obj[prop];
                    delete obj[prop];
                    
                    const changePath = path ? `${path}.${prop}` : prop;
                    self._notifyChange(changePath, undefined, oldValue);
                }
                
                return true;
            }
        });
    }
    
    /**
     * Оповещает подписчиков об изменении
     * @param {string} path - Путь к измененному свойству
     * @param {*} newValue - Новое значение
     * @param {*} oldValue - Старое значение
     */
    _notifyChange(path, newValue, oldValue) {
        const change = { path, newValue, oldValue, timestamp: Date.now() };
        
        // Оповещаем локальных подписчиков
        this._subscribers.forEach((callbacks, pattern) => {
            if (this._pathMatches(path, pattern)) {
                callbacks.forEach(callback => {
                    try {
                        callback(change);
                    } catch (error) {
                        console.error('[CashierStore] Subscriber error:', error);
                    }
                });
            }
        });
        
        // Публикуем глобальное событие
        EventBus.emit('cashier:state:changed', change);
    }
    
    /**
     * Проверяет, соответствует ли путь паттерну подписки
     * @param {string} path - Полный путь
     * @param {string} pattern - Паттерн подписки
     * @returns {boolean}
     */
    _pathMatches(path, pattern) {
        if (path === pattern) return true;
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return path.startsWith(prefix + '.') || path === prefix;
        }
        if (pattern.endsWith('.')) {
            return path.startsWith(pattern);
        }
        return false;
    }
    
    // ========== КЭШ КОРЗИНЫ ==========
    
    /**
     * Инвалидирует кэш вычислений корзины
     */
    _invalidateCartCache() {
        this._cacheVersion++;
        this._cartCache.version = this._cacheVersion;
    }
    
    /**
     * Получает значение из кэша или вычисляет
     * @param {Function} computeFn - Функция вычисления
     * @returns {*}
     */
    _getCachedOrCompute(computeFn) {
        if (this._cartCache.version !== this._cacheVersion) {
            this._cartCache = {
                subtotal: this._computeSubtotal(),
                itemsDiscount: this._computeItemsDiscount(),
                totalDiscountAmount: 0,
                total: 0,
                totalQuantity: this._computeTotalQuantity(),
                version: this._cacheVersion
            };
            
            this._cartCache.totalDiscountAmount = this._computeTotalDiscountAmount(
                this._cartCache.subtotal,
                this._cartCache.itemsDiscount
            );
            
            this._cartCache.total = this._computeTotal(
                this._cartCache.subtotal,
                this._cartCache.itemsDiscount,
                this._cartCache.totalDiscountAmount
            );
        }
        
        return computeFn(this._cartCache);
    }
    
    _computeSubtotal() {
        return this._state.cartItems.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
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
        const subtotalAfterItems = Math.max(0, subtotal - itemsDiscount);
        return subtotalAfterItems * (this._state.cartTotalDiscount / 100);
    }
    
    _computeTotal(subtotal, itemsDiscount, totalDiscountAmount) {
        return Math.max(0, subtotal - itemsDiscount - totalDiscountAmount);
    }
    
    _computeTotalQuantity() {
        return this._state.cartItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    
    // ========== ПУБЛИЧНЫЙ API ==========
    
    /**
     * Подписаться на изменения
     * @param {string} pattern - Паттерн пути ('cartItems', 'shiftStats.*')
     * @param {Function} callback - Функция обратного вызова
     * @returns {Function} Функция отписки
     */
    subscribe(pattern, callback) {
        if (!this._subscribers.has(pattern)) {
            this._subscribers.set(pattern, new Set());
        }
        
        this._subscribers.get(pattern).add(callback);
        
        return () => {
            const callbacks = this._subscribers.get(pattern);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this._subscribers.delete(pattern);
                }
            }
        };
    }
    
    /**
     * Получить снапшот состояния
     * @returns {Object}
     */
    getSnapshot() {
        return {
            currentShift: this._state.currentShift ? { ...this._state.currentShift } : null,
            shiftStats: { ...this._state.shiftStats },
            products: [...this._state.products],
            filteredProducts: [...this._state.filteredProducts],
            categories: [...this._state.categories],
            popularProducts: [...this._state.popularProducts],
            recentProducts: [...this._state.recentProducts],
            searchQuery: this._state.searchQuery,
            selectedCategory: this._state.selectedCategory,
            isLoading: this._state.isLoading,
            cartItems: [...this._state.cartItems],
            cartTotalDiscount: this._state.cartTotalDiscount,
            cartPaymentMethod: this._state.cartPaymentMethod,
            cartItemDiscounts: new Map(this._state.cartItemDiscounts)
        };
    }
    
    // ========== СМЕНА ==========
    
    /**
     * Проверить, открыта ли смена
     * @returns {boolean}
     */
    hasOpenShift() {
        return this._state.currentShift !== null;
    }
    
    /**
     * Получить ID текущей смены
     * @returns {string|null}
     */
    getShiftId() {
        return this._state.currentShift?.id || null;
    }
    
    /**
     * Установить текущую смену
     * @param {Object} shift - Данные смены
     */
    setCurrentShift(shift) {
        this._state.currentShift = shift;
    }
    
    /**
     * Установить статистику смены
     * @param {Object} stats - Статистика
     */
    setShiftStats(stats) {
        this._state.shiftStats = {
            revenue: stats.totalRevenue || 0,
            salesCount: stats.salesCount || 0,
            averageCheck: stats.averageCheck || 0,
            profit: stats.totalProfit || 0
        };
    }
    
    /**
     * Очистить смену
     */
    clearShift() {
        this._state.currentShift = null;
        this._state.shiftStats = {
            revenue: 0,
            salesCount: 0,
            averageCheck: 0,
            profit: 0
        };
    }
    
    // ========== ТОВАРЫ ==========
    
    /**
     * Установить список товаров
     * @param {Array} products - Массив товаров
     */
    setProducts(products) {
        this._state.products = products;
        this._applyFilters();
    }
    
    /**
     * Установить популярные товары
     * @param {Array} products - Массив товаров
     */
    setPopularProducts(products) {
        this._state.popularProducts = products;
    }
    
    /**
     * Установить недавние товары
     * @param {Array} products - Массив товаров
     */
    setRecentProducts(products) {
        this._state.recentProducts = products;
    }
    
    /**
     * Установить поисковый запрос
     * @param {string} query - Поисковый запрос
     */
    setSearchQuery(query) {
        this._state.searchQuery = query;
        this._applyFilters();
    }
    
    /**
     * Установить выбранную категорию
     * @param {string|null} category - Категория
     */
    setSelectedCategory(category) {
        this._state.selectedCategory = category;
        this._applyFilters();
    }
    
    /**
     * Построить список категорий из товаров
     */
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
    
    /**
     * Применить фильтры к товарам
     */
    _applyFilters() {
        let filtered = this._state.products.filter(p => p.status === 'in_stock');
        
        // Поиск
        if (this._state.searchQuery) {
            const query = this._state.searchQuery.toLowerCase();
            filtered = filtered.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(query);
                const idMatch = p.id.toLowerCase().includes(query);
                const keywordMatch = p.keywords?.toLowerCase().includes(query);
                return nameMatch || idMatch || keywordMatch;
            });
        }
        
        // Категория
        if (this._state.selectedCategory) {
            filtered = filtered.filter(p => p.category === this._state.selectedCategory);
        }
        
        this._state.filteredProducts = filtered;
    }
    
    // ========== КОРЗИНА ==========
    
    /**
     * Добавить товар в корзину
     * @param {Object} product - Товар
     * @returns {boolean} - Успешно ли добавлен
     */
    addToCart(product) {
        if (product.status !== 'in_stock') {
            return false;
        }
        
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
        if (!this._state.recentProducts.find(p => p.id === product.id)) {
            this._state.recentProducts.unshift(product);
            if (this._state.recentProducts.length > 10) {
                this._state.recentProducts.pop();
            }
        }
        
        this._invalidateCartCache();
        return true;
    }
    
    /**
     * Обновить количество товара
     * @param {string} id - ID товара
     * @param {number} quantity - Новое количество (или изменение)
     * @param {boolean} relative - Относительное изменение
     */
    updateQuantity(id, quantity, relative = false) {
        const item = this._state.cartItems.find(i => i.id === id);
        if (!item) return;
        
        let newQuantity;
        if (relative) {
            newQuantity = item.quantity + quantity;
        } else {
            newQuantity = quantity;
        }
        
        newQuantity = Math.max(1, Math.min(newQuantity, 999));
        
        if (item.quantity !== newQuantity) {
            item.quantity = newQuantity;
            this._invalidateCartCache();
        }
    }
    
    /**
     * Удалить товар из корзины
     * @param {string} id - ID товара
     */
    removeFromCart(id) {
        const index = this._state.cartItems.findIndex(i => i.id === id);
        if (index !== -1) {
            this._state.cartItems.splice(index, 1);
            this._state.cartItemDiscounts.delete(id);
            this._invalidateCartCache();
        }
    }
    
    /**
     * Установить скидку на товар
     * @param {string} id - ID товара
     * @param {number} discount - Процент скидки
     */
    setItemDiscount(id, discount) {
        const validDiscount = Math.min(Math.max(0, discount), MAX_ITEM_DISCOUNT);
        
        if (validDiscount === 0) {
            this._state.cartItemDiscounts.delete(id);
        } else {
            this._state.cartItemDiscounts.set(id, validDiscount);
        }
        
        this._invalidateCartCache();
    }
    
    /**
     * Установить общую скидку
     * @param {number} discount - Процент скидки
     */
    setTotalDiscount(discount) {
        this._state.cartTotalDiscount = Math.min(Math.max(0, discount), MAX_TOTAL_DISCOUNT);
        this._invalidateCartCache();
    }
    
    /**
     * Установить способ оплаты
     * @param {string} method - Способ оплаты
     */
    setPaymentMethod(method) {
        this._state.cartPaymentMethod = method;
    }
    
    /**
     * Очистить корзину
     */
    clearCart() {
        this._state.cartItems = [];
        this._state.cartTotalDiscount = 0;
        this._state.cartItemDiscounts.clear();
        this._state.cartPaymentMethod = 'cash';
        this._invalidateCartCache();
    }
    
    /**
     * Получить количество товаров в корзине
     * @returns {number}
     */
    getCartItemsCount() {
        return this._getCachedOrCompute(cache => cache.totalQuantity);
    }
    
    /**
     * Получить сумму корзины без скидок
     * @returns {number}
     */
    getCartSubtotal() {
        return this._getCachedOrCompute(cache => cache.subtotal);
    }
    
    /**
     * Получить сумму скидок на товары
     * @returns {number}
     */
    getCartItemsDiscount() {
        return this._getCachedOrCompute(cache => cache.itemsDiscount);
    }
    
    /**
     * Получить сумму общей скидки
     * @returns {number}
     */
    getCartTotalDiscountAmount() {
        return this._getCachedOrCompute(cache => cache.totalDiscountAmount);
    }
    
    /**
     * Получить итоговую сумму
     * @returns {number}
     */
    getCartTotal() {
        return this._getCachedOrCompute(cache => cache.total);
    }
    
    /**
     * Получить товары в корзине с примененными скидками
     * @returns {Array}
     */
    getCartItemsWithDiscounts() {
        return this._state.cartItems.map(item => ({
            ...item,
            discount: this._state.cartItemDiscounts.get(item.id) || 0
        }));
    }
    
    // ========== СОХРАНЕНИЕ ==========
    
    /**
     * Сохранить состояние в localStorage
     */
    saveToStorage() {
        if (!this.hasOpenShift()) return;
        
        try {
            const data = {
                cartItems: this._state.cartItems,
                cartTotalDiscount: this._state.cartTotalDiscount,
                cartPaymentMethod: this._state.cartPaymentMethod,
                cartItemDiscounts: Array.from(this._state.cartItemDiscounts.entries()),
                savedAt: Date.now()
            };
            
            localStorage.setItem(`${CART_CACHE_KEY}_${this.getShiftId()}`, JSON.stringify(data));
        } catch (error) {
            console.error('[CashierStore] Save error:', error);
        }
    }
    
    /**
     * Восстановить состояние из localStorage
     */
    restoreFromStorage() {
        if (!this.hasOpenShift()) return;
        
        try {
            const stored = localStorage.getItem(`${CART_CACHE_KEY}_${this.getShiftId()}`);
            if (!stored) return;
            
            const data = JSON.parse(stored);
            
            // Проверяем, не устарели ли данные (больше 8 часов)
            if (Date.now() - data.savedAt > 8 * 60 * 60 * 1000) {
                localStorage.removeItem(`${CART_CACHE_KEY}_${this.getShiftId()}`);
                return;
            }
            
            this._state.cartItems = data.cartItems || [];
            this._state.cartTotalDiscount = data.cartTotalDiscount || 0;
            this._state.cartPaymentMethod = data.cartPaymentMethod || 'cash';
            this._state.cartItemDiscounts = new Map(data.cartItemDiscounts || []);
            
            this._invalidateCartCache();
            
            if (this._state.cartItems.length > 0) {
                console.log('[CashierStore] Restored cart with', this._state.cartItems.length, 'items');
            }
        } catch (error) {
            console.error('[CashierStore] Restore error:', error);
        }
    }
    
    /**
     * Очистить сохраненные данные
     */
    clearStorage() {
        if (this.hasOpenShift()) {
            localStorage.removeItem(`${CART_CACHE_KEY}_${this.getShiftId()}`);
        }
    }
    
    // ========== СБРОС ==========
    
    /**
     * Полный сброс состояния
     */
    reset() {
        this._state = {
            currentShift: null,
            shiftStats: { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 },
            products: [],
            filteredProducts: [],
            categories: [],
            popularProducts: [],
            recentProducts: [],
            searchQuery: '',
            selectedCategory: null,
            isLoading: false,
            cartItems: [],
            cartTotalDiscount: 0,
            cartPaymentMethod: 'cash',
            cartItemDiscounts: new Map(),
            userId: this._state.userId,
            userName: this._state.userName
        };
        
        this._invalidateCartCache();
    }
}

// Создаем и экспортируем синглтон
export const CashierStore = new CashierStoreClass();

// Для отладки
if (typeof window !== 'undefined') {
    window.CashierStore = CashierStore;
}

export default CashierStore;
