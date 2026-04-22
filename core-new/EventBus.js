// ========================================
// FILE: ./core-new/EventBus.js
// ========================================

/**
 * Event Bus - Типизированная шина событий
 * 
 * Основа архитектуры микро-виджетов.
 * Обеспечивает независимую коммуникацию между модулями.
 * 
 * Архитектурные решения:
 * - Строгая типизация событий через объект EventTypes (защита от опечаток).
 * - Валидация источника (EventSource) для безопасности.
 * - Режим отладки (debug) для трассировки потока данных.
 * - Изоляция: падение одного подписчика не влияет на остальные.
 * 
 * @module EventBus
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

// ========== КОНСТАНТЫ СОБЫТИЙ ==========

/**
 * Словарь всех возможных событий в системе.
 * Использование: EventBus.emit(EventTypes.DATA.PRODUCT_CREATED, {...})
 */
export const EventTypes = {
    // Системные события (Жизненный цикл)
    SYSTEM: {
        APP_READY: 'system:app:ready',
        NETWORK_ONLINE: 'system:network:online',
        NETWORK_OFFLINE: 'system:network:offline',
        ERROR: 'system:error'
    },
    
    // События данных (Асинхронные запросы и ответы)
    DATA: {
        // Продукты
        PRODUCTS_FETCH: 'data:products:fetch',
        PRODUCTS_FETCHED: 'data:products:fetched',
        PRODUCT_CREATED: 'data:product:created',
        PRODUCT_UPDATED: 'data:product:updated',
        PRODUCT_DELETED: 'data:product:deleted',
        
        // Смены
        SHIFT_OPEN: 'data:shift:open',
        SHIFT_OPENED: 'data:shift:opened',
        SHIFT_CLOSE: 'data:shift:close',
        SHIFT_CLOSED: 'data:shift:closed'
    },
    
    // События UI (Действия пользователя)
    UI: {
        TAB_CHANGED: 'ui:tab:changed',
        MODAL_OPENED: 'ui:modal:opened',
        MODAL_CLOSED: 'ui:modal:closed',
        NOTIFICATION_SHOW: 'ui:notification:show'
    },
    
    // События Аутентификации
    AUTH: {
        LOGIN_SUCCESS: 'auth:login:success',
        LOGOUT: 'auth:logout'
    }
};

// Список разрешенных отправителей (Source ID)
export const EventSource = {
    KERNEL: 'kernel',
    WIDGET_INVENTORY: 'widget:inventory',
    WIDGET_CASHIER: 'widget:cashier',
    WIDGET_REPORTS: 'widget:reports',
    WIDGET_AUTH: 'widget:auth',
    ADAPTER_SUPABASE: 'adapter:supabase'
};

// ========== ШИНА ==========

class EventBusClass {
    constructor() {
        /** @type {Map<string, Set<{callback: Function, source: string|null}>>} */
        this.listeners = new Map();
        
        /** @type {boolean} */
        this.debugMode = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1';
        
        // Счетчик событий для отладки
        this.eventCounter = 0;
    }

    /**
     * Подписаться на событие
     * @param {string} event - Строка события (желательно из EventTypes)
     * @param {Function} callback - Функция-обработчик
     * @param {string|null} sourceFilter - Принимать события только от указанного источника (null = от всех)
     * @returns {Function} Функция отписки
     */
    on(event, callback, sourceFilter = null) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        
        const listener = { callback, source: sourceFilter };
        this.listeners.get(event).add(listener);
        
        if (this.debugMode) {
            console.log(`[EventBus] 👂 Subscribed to "${event}"`, sourceFilter ? `(from: ${sourceFilter})` : '');
        }
        
        // Возвращаем функцию отписки
        return () => this.off(event, callback);
    }

    /**
     * Подписаться на событие ОДИН раз
     */
    once(event, callback, sourceFilter = null) {
        const wrapper = (data) => {
            callback(data);
            this.off(event, wrapper);
        };
        this.on(event, wrapper, sourceFilter);
    }

    /**
     * Отписаться от события
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;
        
        for (const item of listeners) {
            if (item.callback === callback) {
                listeners.delete(item);
                break;
            }
        }
        
        if (listeners.size === 0) {
            this.listeners.delete(event);
        }
        
        if (this.debugMode) {
            console.log(`[EventBus] 🔕 Unsubscribed from "${event}"`);
        }
    }

    /**
     * Отправить событие
     * @param {string} event - Тип события
     * @param {any} data - Данные
     * @param {string} source - Источник события (кто отправил)
     */
    emit(event, data = null, source = EventSource.KERNEL) {
        this.eventCounter++;
        const eventId = this.eventCounter;
        
        if (this.debugMode) {
            console.groupCollapsed(`[EventBus] 📢 [${eventId}] ${event} (from: ${source})`);
            console.log('Data:', data);
            console.groupEnd();
        }
        
        const listeners = this.listeners.get(event);
        if (!listeners || listeners.size === 0) {
            if (this.debugMode) {
                console.warn(`[EventBus] ⚠️ No listeners for "${event}"`);
            }
            return;
        }
        
        // Выполняем подписчиков в порядке их добавления
        listeners.forEach(({ callback, source: requiredSource }) => {
            // Если подписчик ждет события только от конкретного источника - проверяем
            if (requiredSource && requiredSource !== source) {
                if (this.debugMode) {
                    console.log(`[EventBus] ⏭️ Skipping listener (requires source: ${requiredSource}, got: ${source})`);
                }
                return;
            }
            
            try {
                callback(data);
            } catch (error) {
                console.error(`[EventBus] ❌ Error in listener for "${event}":`, error);
                
                // Пробрасываем ошибку дальше как системное событие, но не роняем цикл
                this.emit(EventTypes.SYSTEM.ERROR, {
                    event,
                    error,
                    source
                }, EventSource.KERNEL);
            }
        });
    }

    /**
     * Очистить все подписки (используется при выгрузке виджета)
     * @param {string} source - Удалить все подписки, сделанные этим источником
     */
    clearSource(source) {
        if (this.debugMode) {
            console.log(`[EventBus] 🧹 Clearing all listeners for source: ${source}`);
        }
        
        this.listeners.forEach((listeners, event) => {
            listeners.forEach((listener) => {
                if (listener.source === source) {
                    listeners.delete(listener);
                }
            });
            
            if (listeners.size === 0) {
                this.listeners.delete(event);
            }
        });
    }

    /**
     * Включить/выключить режим отладки
     */
    setDebug(enabled) {
        this.debugMode = enabled;
    }
}

// Экспортируем синглтон
export const EventBus = new EventBusClass();

// Для удобства отладки в консоли браузера
if (typeof window !== 'undefined') {
    window.__EventBus = EventBus;
}

export default EventBus;
