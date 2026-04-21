/**
 * App State - Global State Manager
 * 
 * Централизованное хранилище глобального состояния приложения.
 * Управляет текущей страницей, пользователем и флагами загрузки.
 * 
 * @module AppState
 * @version 1.1.0
 * @changes
 * - Добавлена валидация ключей
 * - Исправлен reset() (isInitialized сбрасывается в false)
 * - Добавлен метод update() для массового обновления
 * - Глубокое клонирование при возврате состояния
 */

import { EventBus } from './EventBus.js';

// Допустимые ключи состояния (для валидации)
const VALID_KEYS = [
    'currentPage',
    'user',
    'isInitialized',
    'isLoading',
    'permissions'
];

class AppStateClass {
    constructor() {
        // Состояние
        this._state = {
            currentPage: null,
            user: null,
            isInitialized: false,
            isLoading: false,
            permissions: new Set()
        };
        
        // Подписчики на изменения состояния
        this._subscribers = new Map();
    }
    
    /**
     * Проверяет, является ли ключ допустимым
     * @private
     */
    _isValidKey(key) {
        if (!VALID_KEYS.includes(key)) {
            console.warn(`[AppState] Unknown key: "${key}". Valid keys: ${VALID_KEYS.join(', ')}`);
            return false;
        }
        return true;
    }
    
    /**
     * Получить значение из состояния
     * @param {string} key - Ключ состояния
     * @returns {*} Значение
     */
    get(key) {
        if (!this._isValidKey(key)) return null;
        
        const value = this._state[key];
        
        // Возвращаем копию для объектов и массивов
        if (value && typeof value === 'object') {
            if (value instanceof Set) {
                return new Set(value);
            }
            return { ...value };
        }
        
        return value;
    }
    
    /**
     * Установить значение и оповестить подписчиков
     * @param {string} key - Ключ состояния
     * @param {*} value - Новое значение
     */
    set(key, value) {
        if (!this._isValidKey(key)) return;
        
        const oldValue = this._state[key];
        
        // Не обновляем если значение не изменилось
        if (oldValue === value) return;
        
        this._state[key] = value;
        
        // Оповещаем подписчиков
        if (this._subscribers.has(key)) {
            this._subscribers.get(key).forEach(callback => {
                try {
                    callback(value, oldValue);
                } catch (error) {
                    console.error(`[AppState] Error in subscriber for key "${key}":`, error);
                }
            });
        }
        
        // Глобальное событие
        EventBus.emit(`state:${key}:changed`, { newValue: value, oldValue });
    }
    
    /**
     * Массовое обновление состояния
     * @param {Object} updates - Объект с обновлениями { key: value }
     */
    update(updates) {
        const changedKeys = [];
        
        Object.entries(updates).forEach(([key, value]) => {
            if (this._isValidKey(key)) {
                const oldValue = this._state[key];
                if (oldValue !== value) {
                    this._state[key] = value;
                    changedKeys.push({ key, value, oldValue });
                }
            }
        });
        
        // Оповещаем подписчиков
        changedKeys.forEach(({ key, value, oldValue }) => {
            if (this._subscribers.has(key)) {
                this._subscribers.get(key).forEach(callback => {
                    try {
                        callback(value, oldValue);
                    } catch (error) {
                        console.error(`[AppState] Error in subscriber for key "${key}":`, error);
                    }
                });
            }
            EventBus.emit(`state:${key}:changed`, { newValue: value, oldValue });
        });
    }
    
    /**
     * Подписаться на изменение конкретного ключа
     * @param {string} key - Ключ состояния
     * @param {Function} callback - Функция-обработчик (newValue, oldValue)
     * @returns {Function} Функция отписки
     */
    subscribe(key, callback) {
        if (!this._isValidKey(key)) return () => {};
        
        if (!this._subscribers.has(key)) {
            this._subscribers.set(key, new Set());
        }
        this._subscribers.get(key).add(callback);
        
        // Возвращаем функцию отписки
        return () => {
            this._subscribers.get(key)?.delete(callback);
        };
    }
    
    /**
     * Получить все состояние (только для чтения)
     * @returns {Object} Копия состояния
     */
    getState() {
        return {
            currentPage: this._state.currentPage,
            user: this._state.user ? { ...this._state.user } : null,
            isInitialized: this._state.isInitialized,
            isLoading: this._state.isLoading,
            permissions: new Set(this._state.permissions)
        };
    }
    
    /**
     * Сбросить состояние (при выходе)
     */
    reset() {
        const oldState = { ...this._state };
        
        this._state = {
            currentPage: null,
            user: null,
            isInitialized: false,
            isLoading: false,
            permissions: new Set()
        };
        
        // Оповещаем о сбросе всех ключей
        VALID_KEYS.forEach(key => {
            if (oldState[key] !== this._state[key]) {
                if (this._subscribers.has(key)) {
                    this._subscribers.get(key).forEach(callback => {
                        try {
                            callback(this._state[key], oldState[key]);
                        } catch (error) {
                            console.error(`[AppState] Error in reset subscriber for key "${key}":`, error);
                        }
                    });
                }
                EventBus.emit(`state:${key}:changed`, { 
                    newValue: this._state[key], 
                    oldValue: oldState[key] 
                });
            }
        });
        
        EventBus.emit('state:reset');
    }
}

export const AppState = new AppStateClass();
