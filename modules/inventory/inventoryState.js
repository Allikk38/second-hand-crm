// ========================================
// FILE: ./modules/inventory/inventoryState.js
// ========================================

/**
 * Inventory State - Page State Manager
 * 
 * Управление состоянием страницы склада.
 * Хранит фильтры, пагинацию, выделенные товары.
 * 
 * @module inventoryState
 * @version 1.1.0
 * @changes
 * - Добавлено поле selectedCount в возвращаемый объект состояния
 * - Исправлена ошибка вызова getSelectedCount() из InventoryPage
 */

import { EventBus } from '../../core/EventBus.js';

class InventoryStateClass {
    constructor() {
        this._state = {
            // Данные
            products: [],
            filteredCount: 0,
            
            // Пагинация
            page: 0,
            hasMore: true,
            isLoading: false,
            
            // Фильтры
            searchQuery: '',
            selectedCategory: '',
            selectedStatus: '',
            sortBy: 'created_at-desc',
            
            // Выделение
            selectedIds: new Set(),
            isAllSelected: false,
            
            // Кэш категорий
            categories: []
        };
        
        this._subscribers = new Set();
    }
    
    /**
     * Получить значение
     */
    get(key) {
        return this._state[key];
    }
    
    /**
     * Установить значение
     */
    set(key, value) {
        const oldValue = this._state[key];
        this._state[key] = value;
        this._notify({ key, newValue: value, oldValue });
    }
    
    /**
     * Обновить несколько значений сразу
     */
    setMultiple(updates) {
        const changes = [];
        Object.entries(updates).forEach(([key, value]) => {
            const oldValue = this._state[key];
            this._state[key] = value;
            changes.push({ key, newValue: value, oldValue });
        });
        this._notify(changes);
    }
    
    /**
     * Получить все состояние
     */
    getState() {
        return {
            ...this._state,
            selectedIds: new Set(this._state.selectedIds),
            selectedCount: this._state.selectedIds.size
        };
    }
    
    /**
     * Сбросить состояние (кроме категорий)
     */
    reset() {
        this._state = {
            ...this._state,
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
            isAllSelected: false
        };
        this._notify([{ key: 'reset', newValue: null, oldValue: null }]);
    }
    
    /**
     * Подписаться на изменения
     */
    subscribe(callback) {
        this._subscribers.add(callback);
        return () => this._subscribers.delete(callback);
    }
    
    /**
     * Оповестить подписчиков
     */
    _notify(changes) {
        this._subscribers.forEach(callback => {
            callback(Array.isArray(changes) ? changes : [changes]);
        });
    }
    
    // ========== УТИЛИТЫ ==========
    
    /**
     * Проверить, выбран ли товар
     */
    isSelected(id) {
        return this._state.selectedIds.has(id);
    }
    
    /**
     * Выбрать товар
     */
    select(id) {
        this._state.selectedIds.add(id);
        this._notify([{ key: 'selectedIds', newValue: this._state.selectedIds, oldValue: null }]);
    }
    
    /**
     * Снять выделение с товара
     */
    deselect(id) {
        this._state.selectedIds.delete(id);
        this._state.isAllSelected = false;
        this._notify([{ key: 'selectedIds', newValue: this._state.selectedIds, oldValue: null }]);
    }
    
    /**
     * Выбрать все видимые товары
     */
    selectAll() {
        this._state.products.forEach(p => this._state.selectedIds.add(p.id));
        this._state.isAllSelected = true;
        this._notify([{ key: 'selectedIds', newValue: this._state.selectedIds, oldValue: null }]);
    }
    
    /**
     * Очистить выделение
     */
    clearSelection() {
        this._state.selectedIds.clear();
        this._state.isAllSelected = false;
        this._notify([{ key: 'selectedIds', newValue: this._state.selectedIds, oldValue: null }]);
    }
    
    /**
     * Получить количество выбранных товаров
     */
    getSelectedCount() {
        return this._state.selectedIds.size;
    }
    
    /**
     * Получить массив выбранных ID
     */
    getSelectedIds() {
        return Array.from(this._state.selectedIds);
    }
}

export const InventoryState = new InventoryStateClass();
