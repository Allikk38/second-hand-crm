/**
 * App State - Global State Manager
 * 
 * Централизованное хранилище глобального состояния приложения.
 * Управляет текущей страницей, пользователем и флагами загрузки.
 * 
 * @module AppState
 * @version 1.0.0
 */

import { EventBus } from './EventBus.js';

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
     * Получить значение из состояния
     */
    get(key) {
        return this._state[key];
    }
    
    /**
     * Установить значение и оповестить подписчиков
     */
    set(key, value) {
        const oldValue = this._state[key];
        this._state[key] = value;
        
        // Оповещаем подписчиков
        if (this._subscribers.has(key)) {
            this._subscribers.get(key).forEach(callback => {
                callback(value, oldValue);
            });
        }
        
        // Глобальное событие
        EventBus.emit(`state:${key}:changed`, { newValue: value, oldValue });
    }
    
    /**
     * Подписаться на изменение конкретного ключа
     */
    subscribe(key, callback) {
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
     */
    getState() {
        return { ...this._state };
    }
    
    /**
     * Сбросить состояние (при выходе)
     */
    reset() {
        this._state = {
            currentPage: null,
            user: null,
            isInitialized: true,
            isLoading: false,
            permissions: new Set()
        };
        EventBus.emit('state:reset');
    }
}

export const AppState = new AppStateClass();
