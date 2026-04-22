// ========================================
// FILE: ./core/Store.js
// ========================================

/**
 * Store - Centralized State Management
 * 
 * Единое реактивное хранилище состояния приложения.
 * Заменяет разрозненные InventoryState, CashierState и ReportsState.
 * 
 * Архитектурные решения:
 * - Глубоко реактивный объект через Proxy (автоматическое отслеживание изменений)
 * - Паттерн "Наблюдатель" для оповещения компонентов об изменениях
 * - Поддержка вложенных путей через dot-notation ('inventory.products')
 * - Встроенная система middleware/плагинов (persist, logger, devtools)
 * - Иммутабельные снапшоты для предотвращения случайных мутаций
 * 
 * @module Store
 * @version 6.0.0
 * @changes
 * - Добавлены методы для работы с корзиной.
 * - Добавлен PersistPlugin для сохранения состояния.
 * - Расширен batch для асинхронных операций.
 */

import { EventBus } from './EventBus.js';

class StoreClass {
    constructor() {
        // Корневой объект состояния
        this._state = {
            inventory: {
                products: [],
                filteredCount: 0,
                page: 0,
                hasMore: true,
                isLoading: false,
                searchQuery: '',
                selectedCategory: '',
                selectedStatus: '',
                sortBy: 'created_at-desc',
                selectedIds: new Set(),
                isAllSelected: false,
                categories: []
            },
            cashier: {
                currentShift: null,
                shiftStats: {
                    revenue: 0,
                    salesCount: 0,
                    averageCheck: 0,
                    profit: 0
                },
                products: [],
                filteredProducts: [],
                categories: [],
                popularProducts: [],
                recentlyAdded: [],
                searchQuery: '',
                selectedCategory: null,
                expandedCategories: new Set(),
                viewMode: 'grid',
                isLoading: false,
                cartItems: [],
                cartTotalDiscount: 0,
                cartPaymentMethod: 'cash',
                cartItemDiscounts: new Map(),
                scannerInput: ''
            },
            reports: {
                activeTab: 'dashboard',
                period: {
                    preset: 'week',
                    startDate: null,
                    endDate: null
                },
                compareWithPrevious: true,
                isLoading: false,
                reportData: {
                    dashboard: null,
                    sales: null,
                    products: null,
                    sellers: null,
                    profit: null
                }
            },
            ui: {
                theme: 'light',
                sidebarCollapsed: false,
                notifications: [],
                modals: {
                    activeModal: null,
                    modalData: null
                }
            },
            user: {
                profile: null,
                permissions: new Set(),
                isAuthenticated: false
            }
        };

        // Подписчики на изменения
        this._subscribers = new Map();
        
        // Плагины
        this._plugins = [];
        
        // Создаем реактивный прокси
        this.state = this._createReactiveProxy(this._state, '');
        
        // Флаг для пакетных обновлений
        this._batchMode = false;
        this._pendingChanges = [];
        
        // Инициализация
        this._init();
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========

    _init() {
        // Устанавливаем даты по умолчанию для отчетов
        const range = this._getPresetDateRange('week');
        this.state.reports.period.startDate = range.start;
        this.state.reports.period.endDate = range.end;
        
        // Добавляем плагин сохранения состояния
        this.use(new PersistPlugin());
        
        console.log('[Store] Initialized with reactive state');
    }

    _getPresetDateRange(preset) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (preset) {
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay() + 1);
                return { start: weekStart, end: now };
            default:
                return { start: today, end: now };
        }
    }

    // ========== РЕАКТИВНЫЙ PROXY ==========

    _createReactiveProxy(target, path) {
        const self = this;
        
        return new Proxy(target, {
            get(obj, prop) {
                const value = obj[prop];
                const newPath = path ? `${path}.${prop}` : prop;
                
                if (value && typeof value === 'object') {
                    if (value instanceof Set || value instanceof Map) {
                        return value;
                    }
                    return self._createReactiveProxy(value, newPath);
                }
                
                return value;
            },
            
            set(obj, prop, value) {
                const oldValue = obj[prop];
                
                if (oldValue === value) {
                    return true;
                }
                
                obj[prop] = value;
                
                const changePath = path ? `${path}.${prop}` : prop;
                
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

    _notifyChange(path, newValue, oldValue) {
        const change = { path, newValue, oldValue, timestamp: Date.now() };
        
        if (this._batchMode) {
            this._pendingChanges.push(change);
            return;
        }
        
        this._dispatchChange(change);
    }

    _dispatchChange(change) {
        const { path } = change;
        
        this._subscribers.forEach((callbacks, pattern) => {
            if (this._pathMatches(path, pattern)) {
                callbacks.forEach(callback => {
                    try {
                        callback(change);
                    } catch (error) {
                        console.error(`[Store] Error in subscriber for ${pattern}:`, error);
                    }
                });
            }
        });
        
        EventBus.emit('store:changed', change);
        
        this._plugins.forEach(plugin => {
            if (plugin.onChange) {
                try {
                    plugin.onChange(change, this.state);
                } catch (error) {
                    console.error('[Store] Plugin error:', error);
                }
            }
        });
    }

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

    // ========== ПУБЛИЧНЫЙ API ==========

    subscribe(pathPattern, callback) {
        if (!this._subscribers.has(pathPattern)) {
            this._subscribers.set(pathPattern, new Set());
        }
        
        this._subscribers.get(pathPattern).add(callback);
        
        return () => {
            const callbacks = this._subscribers.get(pathPattern);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this._subscribers.delete(pathPattern);
                }
            }
        };
    }

    subscribeMany(patterns, callback) {
        const unsubscribers = patterns.map(pattern => this.subscribe(pattern, callback));
        return () => unsubscribers.forEach(unsub => unsub());
    }

    get(path) {
        const parts = path.split('.');
        let current = this._state;
        
        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[part];
        }
        
        return current;
    }

    getSnapshot(path) {
        const value = this.get(path);
        
        if (value === null || value === undefined) {
            return value;
        }
        
        if (value instanceof Set) return new Set(value);
        if (value instanceof Map) return new Map(value);
        if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
        
        return value;
    }

    beginBatch() {
        this._batchMode = true;
        this._pendingChanges = [];
    }

    endBatch() {
        this._batchMode = false;
        
        const latestChanges = new Map();
        this._pendingChanges.forEach(change => {
            latestChanges.set(change.path, change);
        });
        
        latestChanges.forEach(change => {
            this._dispatchChange(change);
        });
        
        if (this._pendingChanges.length > 0) {
            EventBus.emit('store:batch-completed', {
                changes: Array.from(latestChanges.values()),
                count: this._pendingChanges.length
            });
        }
        
        this._pendingChanges = [];
    }

    batch(fn) {
        this.beginBatch();
        try {
            fn(this.state);
        } finally {
            this.endBatch();
        }
    }

    reset(branch) {
        const defaultState = {
            inventory: {
                products: [],
                filteredCount: 0,
                page: 0,
                hasMore: true,
                isLoading: false,
                searchQuery: '',
                selectedCategory: '',
                selectedStatus: '',
                sortBy: 'created_at-desc',
                selectedIds: new Set(),
                isAllSelected: false,
                categories: []
            },
            cashier: {
                currentShift: null,
                shiftStats: { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 },
                products: [],
                filteredProducts: [],
                categories: [],
                popularProducts: [],
                recentlyAdded: [],
                searchQuery: '',
                selectedCategory: null,
                expandedCategories: new Set(),
                viewMode: 'grid',
                isLoading: false,
                cartItems: [],
                cartTotalDiscount: 0,
                cartPaymentMethod: 'cash',
                cartItemDiscounts: new Map(),
                scannerInput: ''
            },
            reports: {
                activeTab: 'dashboard',
                period: {
                    preset: 'week',
                    startDate: this._getPresetDateRange('week').start,
                    endDate: this._getPresetDateRange('week').end
                },
                compareWithPrevious: true,
                isLoading: false,
                reportData: { dashboard: null, sales: null, products: null, sellers: null, profit: null }
            }
        };
        
        if (defaultState[branch]) {
            this.batch(() => {
                Object.assign(this._state[branch], defaultState[branch]);
            });
        }
    }

    resetAll() {
        const defaultState = {
            inventory: {
                products: [],
                filteredCount: 0,
                page: 0,
                hasMore: true,
                isLoading: false,
                searchQuery: '',
                selectedCategory: '',
                selectedStatus: '',
                sortBy: 'created_at-desc',
                selectedIds: new Set(),
                isAllSelected: false,
                categories: []
            },
            cashier: {
                currentShift: null,
                shiftStats: { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 },
                products: [],
                filteredProducts: [],
                categories: [],
                popularProducts: [],
                recentlyAdded: [],
                searchQuery: '',
                selectedCategory: null,
                expandedCategories: new Set(),
                viewMode: 'grid',
                isLoading: false,
                cartItems: [],
                cartTotalDiscount: 0,
                cartPaymentMethod: 'cash',
                cartItemDiscounts: new Map(),
                scannerInput: ''
            },
            reports: {
                activeTab: 'dashboard',
                period: {
                    preset: 'week',
                    startDate: this._getPresetDateRange('week').start,
                    endDate: this._getPresetDateRange('week').end
                },
                compareWithPrevious: true,
                isLoading: false,
                reportData: { dashboard: null, sales: null, products: null, sellers: null, profit: null }
            },
            ui: {
                theme: 'light',
                sidebarCollapsed: false,
                notifications: [],
                modals: { activeModal: null, modalData: null }
            },
            user: {
                profile: null,
                permissions: new Set(),
                isAuthenticated: false
            }
        };
        
        this.batch(() => {
            Object.assign(this._state, JSON.parse(JSON.stringify(defaultState)));
        });
    }

    use(plugin) {
        this._plugins.push(plugin);
        
        if (plugin.init) {
            try {
                plugin.init(this);
            } catch (error) {
                console.error('[Store] Plugin init error:', error);
            }
        }
    }

    // ========== УТИЛИТЫ ДЛЯ ИНВЕНТАРЯ ==========

    getInventorySelectedCount() {
        return this.state.inventory.selectedIds.size;
    }

    getInventorySelectedIds() {
        return Array.from(this.state.inventory.selectedIds);
    }

    isInventoryItemSelected(id) {
        return this.state.inventory.selectedIds.has(id);
    }

    selectAllInventory() {
        const products = this.state.inventory.products;
        const selectedIds = this.state.inventory.selectedIds;
        
        products.forEach(p => selectedIds.add(p.id));
        this.state.inventory.isAllSelected = true;
    }

    clearInventorySelection() {
        this.state.inventory.selectedIds.clear();
        this.state.inventory.isAllSelected = false;
    }

    // ========== УТИЛИТЫ ДЛЯ КАССЫ ==========

    getCartSubtotal() {
        return this.state.cashier.cartItems.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
    }

    getCartItemsDiscount() {
        return this.state.cashier.cartItems.reduce((sum, item) => {
            const discount = this.state.cashier.cartItemDiscounts.get(item.id) || 0;
            return sum + (item.price * item.quantity * discount / 100);
        }, 0);
    }

    getCartTotalDiscountAmount() {
        const subtotal = this.getCartSubtotal();
        const itemsDiscount = this.getCartItemsDiscount();
        return Math.max(0, subtotal - itemsDiscount) * (this.state.cashier.cartTotalDiscount / 100);
    }

    getCartTotal() {
        const subtotal = this.getCartSubtotal();
        const itemsDiscount = this.getCartItemsDiscount();
        const totalDiscount = this.getCartTotalDiscountAmount();
        return Math.max(0, subtotal - itemsDiscount - totalDiscount);
    }

    getCartItemsCount() {
        return this.state.cashier.cartItems.reduce((sum, item) => sum + item.quantity, 0);
    }

    hasOpenShift() {
        return this.state.cashier.currentShift !== null;
    }

    getShiftId() {
        return this.state.cashier.currentShift?.id || null;
    }

    addToCart(product) {
        if (product.status !== 'in_stock') return false;
        
        const items = this.state.cashier.cartItems;
        const existing = items.find(i => i.id === product.id);
        
        if (existing) {
            existing.quantity += 1;
        } else {
            items.push({ ...product, quantity: 1 });
        }
        
        this.state.cashier.cartItems = [...items];
        return true;
    }

    updateCartItemQuantity(id, quantity) {
        const items = this.state.cashier.cartItems;
        const item = items.find(i => i.id === id);
        
        if (item) {
            const newQuantity = Math.max(1, Math.min(quantity, 999));
            if (item.quantity !== newQuantity) {
                item.quantity = newQuantity;
                this.state.cashier.cartItems = [...items];
            }
        }
    }

    removeFromCart(id) {
        const items = this.state.cashier.cartItems;
        const newItems = items.filter(i => i.id !== id);
        
        if (items.length !== newItems.length) {
            this.state.cashier.cartItems = newItems;
            this.state.cashier.cartItemDiscounts.delete(id);
            return true;
        }
        
        return false;
    }

    clearCart() {
        this.state.cashier.cartItems = [];
        this.state.cashier.cartTotalDiscount = 0;
        this.state.cashier.cartItemDiscounts.clear();
        this.state.cashier.cartPaymentMethod = 'cash';
    }

    // ========== ОТЛАДКА ==========

    enableDebug() {
        this.use({
            name: 'Logger',
            onChange: (change) => {
                console.log(`[Store] ${change.path}:`, {
                    from: change.oldValue,
                    to: change.newValue
                });
            }
        });
    }

    debug() {
        return JSON.parse(JSON.stringify({
            inventory: {
                ...this._state.inventory,
                selectedIds: Array.from(this._state.inventory.selectedIds)
            },
            cashier: {
                ...this._state.cashier,
                expandedCategories: Array.from(this._state.cashier.expandedCategories),
                cartItemDiscounts: Array.from(this._state.cashier.cartItemDiscounts.entries())
            },
            reports: this._state.reports,
            ui: this._state.ui,
            user: {
                ...this._state.user,
                permissions: Array.from(this._state.user.permissions)
            }
        }));
    }
}

// ========== PLUGINS ==========

class PersistPlugin {
    constructor(options = {}) {
        this.name = 'PersistPlugin';
        this.key = options.key || 'sh_crm_store';
        this.paths = options.paths || ['cashier.cartItems', 'cashier.currentShift', 'reports.period'];
        this.debounceTimer = null;
    }

    init(store) {
        this.store = store;
        this.loadFromStorage();
        
        this.paths.forEach(path => {
            store.subscribe(path, () => this.saveToStorage());
        });
    }

    loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.key);
            if (!stored) return;
            
            const data = JSON.parse(stored);
            
            if (data.cashier?.cartItems) {
                this.store.state.cashier.cartItems = data.cashier.cartItems;
            }
            if (data.cashier?.cartTotalDiscount !== undefined) {
                this.store.state.cashier.cartTotalDiscount = data.cashier.cartTotalDiscount;
            }
            if (data.cashier?.cartPaymentMethod) {
                this.store.state.cashier.cartPaymentMethod = data.cashier.cartPaymentMethod;
            }
            if (data.reports?.period) {
                this.store.state.reports.period = {
                    ...data.reports.period,
                    startDate: new Date(data.reports.period.startDate),
                    endDate: new Date(data.reports.period.endDate)
                };
            }
        } catch (error) {
            console.error('[PersistPlugin] Load error:', error);
        }
    }

    saveToStorage() {
        clearTimeout(this.debounceTimer);
        
        this.debounceTimer = setTimeout(() => {
            try {
                const data = {
                    cashier: {
                        cartItems: this.store.state.cashier.cartItems,
                        cartTotalDiscount: this.store.state.cashier.cartTotalDiscount,
                        cartPaymentMethod: this.store.state.cashier.cartPaymentMethod
                    },
                    reports: {
                        period: {
                            preset: this.store.state.reports.period.preset,
                            startDate: this.store.state.reports.period.startDate?.toISOString(),
                            endDate: this.store.state.reports.period.endDate?.toISOString()
                        }
                    },
                    savedAt: Date.now()
                };
                
                localStorage.setItem(this.key, JSON.stringify(data));
            } catch (error) {
                console.error('[PersistPlugin] Save error:', error);
            }
        }, 500);
    }
}

// Создаем и экспортируем синглтон
export const Store = new StoreClass();

if (typeof window !== 'undefined') {
    window.Store = Store;
}

export default Store;
