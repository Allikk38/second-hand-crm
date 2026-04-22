// ========================================
// FILE: ./modules/inventory/InventoryFilters.js
// ========================================

/**
 * Inventory Filters Component
 * 
 * Компонент фильтрации товаров на странице склада.
 * Включает поиск, фильтр по категории, статусу и сортировку.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Прямое чтение состояния из `Store.state.inventory`.
 * - Автоматическая синхронизация через `Store.subscribe()`.
 * - Дебаунс для поиска для оптимизации производительности.
 * 
 * @module InventoryFilters
 * @version 6.0.0
 * @changes
 * - Обновлена документация.
 * - Упрощены импорты.
 * - Оптимизирована очистка таймеров.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { getCategoryName } from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS = [
    { value: 'created_at-desc', label: 'Новые сначала' },
    { value: 'created_at-asc', label: 'Старые сначала' },
    { value: 'price-desc', label: 'Цена: по убыванию' },
    { value: 'price-asc', label: 'Цена: по возрастанию' },
    { value: 'name-asc', label: 'Название: А-Я' },
    { value: 'name-desc', label: 'Название: Я-А' }
];

const STATUS_OPTIONS = [
    { value: '', label: 'Все статусы' },
    { value: 'in_stock', label: 'В наличии' },
    { value: 'sold', label: 'Проданные' },
    { value: 'reserved', label: 'Забронированные' }
];

export class InventoryFilters extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onSearch: null,
            onCategoryChange: null,
            onStatusChange: null,
            onSortChange: null,
            onClearFilters: null,
            ...options
        };
        
        this.searchDebounceTimer = null;
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const inventory = Store.state.inventory;
        const categories = inventory.categories || [];
        const hasActiveFilters = inventory.searchQuery || inventory.selectedCategory || inventory.selectedStatus;
        
        return `
            <div class="filters-panel" data-ref="filtersPanel">
                <div class="search-wrapper">
                    <span class="search-icon">🔍</span>
                    <input 
                        type="text" 
                        data-ref="searchInput"
                        class="search-input"
                        placeholder="Поиск по названию или характеристикам..." 
                        value="${this.escapeHtml(inventory.searchQuery)}"
                        autocomplete="off"
                    >
                    ${inventory.searchQuery ? `
                        <button class="clear-search-btn" data-ref="clearSearchBtn" title="Очистить">✕</button>
                    ` : ''}
                </div>
                
                <div class="filters-group">
                    <select data-ref="categoryFilter" class="filter-select">
                        <option value="">Все категории</option>
                        ${categories.map(cat => `
                            <option value="${cat.value}" ${inventory.selectedCategory === cat.value ? 'selected' : ''}>
                                ${cat.label} (${cat.count})
                            </option>
                        `).join('')}
                    </select>
                    
                    <select data-ref="statusFilter" class="filter-select">
                        ${STATUS_OPTIONS.map(opt => `
                            <option value="${opt.value}" ${inventory.selectedStatus === opt.value ? 'selected' : ''}>
                                ${opt.label}
                            </option>
                        `).join('')}
                    </select>
                    
                    <select data-ref="sortSelect" class="filter-select">
                        ${SORT_OPTIONS.map(opt => `
                            <option value="${opt.value}" ${inventory.sortBy === opt.value ? 'selected' : ''}>
                                ${opt.label}
                            </option>
                        `).join('')}
                    </select>
                </div>
                
                ${hasActiveFilters ? `
                    <button class="btn-ghost btn-sm" data-ref="clearFiltersBtn" title="Сбросить все фильтры">
                        Сбросить
                    </button>
                ` : ''}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Поиск с дебаунсом
        const searchInput = this.refs.get('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    const query = e.target.value;
                    if (this.options.onSearch) {
                        this.options.onSearch(query);
                    }
                }, SEARCH_DEBOUNCE_MS);
            });
            
            // Фокус при загрузке
            setTimeout(() => searchInput.focus(), 100);
        }
        
        // Кнопка очистки поиска
        this.addDomListener('clearSearchBtn', 'click', () => {
            const input = this.refs.get('searchInput');
            if (input) {
                input.value = '';
                if (this.options.onSearch) {
                    this.options.onSearch('');
                }
            }
        });
        
        // Фильтр по категории
        this.addDomListener('categoryFilter', 'change', (e) => {
            if (this.options.onCategoryChange) {
                this.options.onCategoryChange(e.target.value);
            }
        });
        
        // Фильтр по статусу
        this.addDomListener('statusFilter', 'change', (e) => {
            if (this.options.onStatusChange) {
                this.options.onStatusChange(e.target.value);
            }
        });
        
        // Сортировка
        this.addDomListener('sortSelect', 'change', (e) => {
            if (this.options.onSortChange) {
                this.options.onSortChange(e.target.value);
            }
        });
        
        // Сброс всех фильтров
        this.addDomListener('clearFiltersBtn', 'click', () => {
            const searchInput = this.refs.get('searchInput');
            const categoryFilter = this.refs.get('categoryFilter');
            const statusFilter = this.refs.get('statusFilter');
            
            if (searchInput) searchInput.value = '';
            if (categoryFilter) categoryFilter.value = '';
            if (statusFilter) statusFilter.value = '';
            
            if (this.options.onClearFilters) {
                this.options.onClearFilters();
            }
        });
        
        // Подписка на изменения категорий в Store
        this.unsubscribers.push(
            Store.subscribe('inventory.categories', () => {
                this.updateCategoryOptions();
            })
        );
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    updateCategoryOptions() {
        const select = this.refs.get('categoryFilter');
        if (!select) return;
        
        const inventory = Store.state.inventory;
        const categories = inventory.categories || [];
        const selectedCategory = inventory.selectedCategory;
        
        select.innerHTML = `
            <option value="">Все категории</option>
            ${categories.map(cat => `
                <option value="${cat.value}" ${selectedCategory === cat.value ? 'selected' : ''}>
                    ${cat.label} (${cat.count})
                </option>
            `).join('')}
        `;
    }
    
    getFilters() {
        return {
            searchQuery: this.refs.get('searchInput')?.value || '',
            category: this.refs.get('categoryFilter')?.value || '',
            status: this.refs.get('statusFilter')?.value || '',
            sort: this.refs.get('sortSelect')?.value || 'created_at-desc'
        };
    }
    
    focusSearch() {
        this.refs.get('searchInput')?.focus();
    }
    
    clearSearch() {
        const input = this.refs.get('searchInput');
        if (input) {
            input.value = '';
            if (this.options.onSearch) {
                this.options.onSearch('');
            }
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }
        
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
    }
}
