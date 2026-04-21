/**
 * Event Bus - Central Event System
 * 
 * Центральная шина событий для коммуникации между компонентами.
 * Позволяет подписываться, отписываться и публиковать события.
 * 
 * @module EventBus
 * @version 1.0.0
 * @changes
 * - Добавлена обработка ошибок в колбэках
 * - Добавлен метод once() для одноразовых подписок
 * - Добавлен метод clear() для очистки всех событий
 */

class EventBusClass {
    constructor() {
        /**
         * Хранилище событий
         * @type {Map<string, Set<Function>>}
         */
        this.events = new Map();
    }

    /**
     * Подписаться на событие
     * @param {string} event - Название события
     * @param {Function} callback - Функция-обработчик
     * @returns {Function} Функция для отписки
     */
    on(event, callback) {
        if (typeof callback !== 'function') {
            console.warn(`[EventBus] Callback for event "${event}" is not a function`);
            return () => {};
        }

        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event).add(callback);
        
        // Возвращаем функцию отписки
        return () => this.off(event, callback);
    }

    /**
     * Подписаться на событие один раз
     * @param {string} event - Название события
     * @param {Function} callback - Функция-обработчик
     * @returns {Function} Функция для отписки
     */
    once(event, callback) {
        const wrapper = (data) => {
            callback(data);
            this.off(event, wrapper);
        };
        return this.on(event, wrapper);
    }

    /**
     * Отписаться от события
     * @param {string} event - Название события
     * @param {Function} callback - Функция-обработчик
     */
    off(event, callback) {
        if (this.events.has(event)) {
            this.events.get(event).delete(callback);
            
            // Если больше нет подписчиков, удаляем событие
            if (this.events.get(event).size === 0) {
                this.events.delete(event);
            }
        }
    }

    /**
     * Опубликовать событие
     * @param {string} event - Название события
     * @param {*} data - Данные события (по умолчанию {})
     */
    emit(event, data = {}) {
        if (!this.events.has(event)) return;

        const callbacks = this.events.get(event);
        
        callbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[EventBus] Error in callback for event "${event}":`, error);
            }
        });
    }

    /**
     * Очистить все подписки
     */
    clear() {
        this.events.clear();
    }

    /**
     * Проверить, есть ли подписчики на событие
     * @param {string} event - Название события
     * @returns {boolean}
     */
    has(event) {
        return this.events.has(event) && this.events.get(event).size > 0;
    }

    /**
     * Получить количество подписчиков на событие
     * @param {string} event - Название события
     * @returns {number}
     */
    listenerCount(event) {
        return this.events.has(event) ? this.events.get(event).size : 0;
    }
}

export const EventBus = new EventBusClass();
