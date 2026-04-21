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
 * @version 5.0.0
 * @changes
 * - Полная замена InventoryState, CashierState, ReportsState
 * - Добавлена автоматическая реактивность через Proxy (больше не нужен .set())
 * - Добавлена поддержка плагинов (persist, logger)
 * - Единая система событий store:changed
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
        // Формат: Map<pathPattern, Set<callback>>
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
                if (value && typeof value === 'object') {
                    // Не оборачиваем Set и Map (они не должны быть реактивными глубоко)
                    if (value instanceof Set || value instanceof Map) {
                        return value;
                    }
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
        
        // Если в режиме пакетной обработки - накапливаем изменения
        if (this._batchMode) {
            this._pendingChanges.push(change);
            return;
        }
        
        // Иначе отправляем немедленно
        this._dispatchChange(change);
    }

    /**
     * Отправляет изменение подписчикам
     * @param {Object} change - Объект изменения
     */
    _dispatchChange(change) {
        const { path } = change;
        
        // Проходим по всем подписчикам и проверяем совпадение путей
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
        
        // Глобальное событие для отладки
        EventBus.emit('store:changed', change);
        
        // Вызываем хуки плагинов
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

    /**
     * Проверяет, соответствует ли путь паттерну подписки
     * @param {string} path - Полный путь ('inventory.products')
     * @param {string} pattern - Паттерн подписки ('inventory.*' или 'inventory.products')
     * @returns {boolean}
     */
    _pathMatches(path, pattern) {
        // Точное совпадение
        if (path === pattern) {
            return true;
        }
        
        // Паттерн с wildcard (*)
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return path.startsWith(prefix + '.') || path === prefix;
        }
        
        // Паттерн - префикс пути
        if (pattern.endsWith('.')) {
            return path.startsWith(pattern);
        }
        
        return false;
    }

    // ========== ПУБЛИЧНЫЙ API ==========

    /**
     * Подписаться на изменения в состоянии
     * @param {string} pathPattern - Паттерн пути ('inventory.*', 'cashier.cartItems')
     * @param {Function} callback - Функция обратного вызова (change) => void
     * @returns {Function} Функция отписки
     */
    subscribe(pathPattern, callback) {
        if (!this._subscribers.has(pathPattern)) {
            this._subscribers.set(pathPattern, new Set());
        }
        
        this._subscribers.get(pathPattern).add(callback);
        
        console.log(`[Store] Subscribed to: ${pathPattern}`);
        
        // Возвращаем функцию отписки
        return () => {
            const callbacks = this._subscribers.get(pathPattern);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this._subscribers.delete(pathPattern);
                }
                console.log(`[Store] Unsubscribed from: ${pathPattern}`);
            }
        };
    }

    /**
     * Подписаться на несколько паттернов одновременно
     * @param {string[]} patterns - Массив паттернов
     * @param {Function} callback - Функция обратного вызова
     * @returns {Function} Функция отписки от всех
     */
    subscribeMany(patterns, callback) {
        const unsubscribers = patterns.map(pattern => this.subscribe(pattern, callback));
        
        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }

    /**
     * Получить значение по пути
     * @param {string} path - Путь к свойству ('inventory.products')
     * @returns {*} Значение или undefined
     */
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

    /**
     * Получить иммутабельный снапшот части состояния
     * @param {string} path - Путь к свойству
     * @returns {*} Копия значения
     */
    getSnapshot(path) {
        const value = this.get(path);
        
        if (value === null || value === undefined) {
            return value;
        }
        
        // Для Set и Map создаем новые экземпляры
        if (value instanceof Set) {
            return new Set(value);
        }
        if (value instanceof Map) {
            return new Map(value);
        }
        
        // Для объектов - глубокая копия
        if (typeof value === 'object') {
            return JSON.parse(JSON.stringify(value));
        }
        
        return value;
    }

    /**
     * Начать пакетное обновление (все изменения отправятся разом)
     */
    beginBatch() {
        this._batchMode = true;
        this._pendingChanges = [];
    }

    /**
     * Завершить пакетное обновление и отправить все изменения
     */
    endBatch() {
        this._batchMode = false;
        
        // Группируем изменения по путям (берем последнее для каждого пути)
        const latestChanges = new Map();
        this._pendingChanges.forEach(change => {
            latestChanges.set(change.path, change);
        });
        
        // Отправляем сгруппированные изменения
        latestChanges.forEach(change => {
            this._dispatchChange(change);
        });
        
        // Отправляем событие о завершении пакета
        if (this._pendingChanges.length > 0) {
            EventBus.emit('store:batch-completed', {
                changes: Array.from(latestChanges.values()),
                count: this._pendingChanges.length
            });
        }
        
        this._pendingChanges = [];
    }

    /**
     * Выполнить функцию в пакетном режиме
     * @param {Function} fn - Функция для выполнения
     */
    batch(fn) {
        this.beginBatch();
        try {
            fn(this.state);
        } finally {
            this.endBatch();
        }
    }

    /**
     * Сбросить определенную ветку состояния к начальному значению
     * @param {string} branch - Имя ветки ('inventory', 'cashier', 'reports')
     */
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
                    startDate: this._getPresetDateRange('week').start,
                    endDate: this._getPresetDateRange('week').end
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
            }
        };
        
        if (defaultState[branch]) {
            this.batch(() => {
                Object.assign(this._state[branch], defaultState[branch]);
            });
            
            console.log(`[Store] Reset branch: ${branch}`);
        }
    }

    /**
     * Полностью сбросить все состояние (при выходе из системы)
     */
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
        
        console.log('[Store] Full reset completed');
    }

    // ========== ПЛАГИНЫ ==========

    /**
     * Зарегистрировать плагин
     * @param {Object} plugin - Объект плагина с методами init, onChange, destroy
     */
    use(plugin) {
        this._plugins.push(plugin);
        
        if (plugin.init) {
            try {
                plugin.init(this);
            } catch (error) {
                console.error('[Store] Plugin init error:', error);
            }
        }
        
        console.log(`[Store] Plugin registered: ${plugin.name || 'unnamed'}`);
    }

    // ========== УТИЛИТЫ ДЛЯ КОНКРЕТНЫХ ВЕТОК ==========

    /**
     * Получить количество выбранных товаров в инвентаре
     * @returns {number}
     */
    getInventorySelectedCount() {
        return this.state.inventory.selectedIds.size;
    }

    /**
     * Получить массив выбранных ID товаров
     * @returns {string[]}
     */
    getInventorySelectedIds() {
        return Array.from(this.state.inventory.selectedIds);
    }

    /**
     * Проверить, выбран ли товар в инвентаре
     * @param {string} id - ID товара
     * @returns {boolean}
     */
    isInventoryItemSelected(id) {
        return this.state.inventory.selectedIds.has(id);
    }

    /**
     * Выбрать все видимые товары в инвентаре
     */
    selectAllInventory() {
        const products = this.state.inventory.products;
        const selectedIds = this.state.inventory.selectedIds;
        
        products.forEach(p => selectedIds.add(p.id));
        this.state.inventory.isAllSelected = true;
    }

    /**
     * Очистить выделение в инвентаре
     */
    clearInventorySelection() {
        this.state.inventory.selectedIds.clear();
        this.state.inventory.isAllSelected = false;
    }

    /**
     * Получить итоговую сумму корзины
     * @returns {number}
     */
    getCartTotal() {
        const items = this.state.cashier.cartItems;
        const totalDiscount = this.state.cashier.cartTotalDiscount;
        const itemDiscounts = this.state.cashier.cartItemDiscounts;
        
        const subtotal = items.reduce((sum, item) => {
            const itemDiscount = itemDiscounts.get(item.id) || 0;
            const price = item.price * (1 - itemDiscount / 100);
            return sum + (price * item.quantity);
        }, 0);
        
        return subtotal * (1 - totalDiscount / 100);
    }

    /**
     * Получить количество товаров в корзине
     * @returns {number}
     */
    getCartItemsCount() {
        return this.state.cashier.cartItems.reduce((sum, item) => sum + item.quantity, 0);
    }

    /**
     * Проверить, открыта ли смена
     * @returns {boolean}
     */
    hasOpenShift() {
        return this.state.cashier.currentShift !== null;
    }

    /**
     * Получить ID текущей смены
     * @returns {string|null}
     */
    getShiftId() {
        return this.state.cashier.currentShift?.id || null;
    }

    // ========== ОТЛАДКА ==========

    /**
     * Включить режим отладки (логирование всех изменений)
     */
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

    /**
     * Получить все состояние (для отладки)
     * @returns {Object}
     */
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

// Создаем и экспортируем синглтон
export const Store = new StoreClass();

// Для отладки в консоли браузера
if (typeof window !== 'undefined') {
    window.Store = Store;
    console.log('[Store] Available in console as window.Store');
}

export default Store;
