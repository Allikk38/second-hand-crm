/**
 * Inventory Filters Component
 * 
 * Компонент фильтрации товаров на странице склада.
 * Включает поиск, фильтр по категории, статусу и сортировку.
 * 
 * @module InventoryFilters
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { InventoryState } from './inventoryState.js';

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
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = InventoryState.getState();
        const categories = state.categories || [];
        const hasActiveFilters = state.searchQuery || state.selectedCategory || state.selectedStatus;
        
        return `
            <div class="filters-panel" data-ref="filtersPanel">
                <div class="search-wrapper">
                    <input 
                        type="text" 
                        data-ref="searchInput"
                        placeholder="Поиск по названию или характеристикам..." 
                        value="${this.escapeHtml(state.searchQuery)}"
                        autocomplete="off"
                    >
                    ${state.searchQuery ? `
                        <button class="btn-ghost btn-icon" data-ref="clearSearchBtn" title="Очистить">✕</button>
                    ` : ''}
                </div>
                
                <div class="filters-group">
                    <select data-ref="categoryFilter">
                        <option value="">Все категории</option>
                        ${categories.map(cat => `
                            <option value="${cat.value}" ${state.selectedCategory === cat.value ? 'selected' : ''}>
                                ${cat.label} (${cat.count})
                            </option>
                        `).join('')}
                    </select>
                    
                    <select data-ref="statusFilter">
                        ${STATUS_OPTIONS.map(opt => `
                            <option value="${opt.value}" ${state.selectedStatus === opt.value ? 'selected' : ''}>
                                ${opt.label}
                            </option>
                        `).join('')}
                    </select>
                    
                    <select data-ref="sortSelect">
                        ${SORT_OPTIONS.map(opt => `
                            <option value="${opt.value}" ${state.sortBy === opt.value ? 'selected' : ''}>
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
            // Очищаем поля
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
        
        // Подписка на изменения состояния (для обновления списка категорий)
        this.unsubscribeState = InventoryState.subscribe((changes) => {
            const categoriesChanged = changes.some(c => c.key === 'categories');
            if (categoriesChanged) {
                this.updateCategoryOptions();
            }
        });
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    /**
     * Обновляет список категорий в селекте
     */
    updateCategoryOptions() {
        const select = this.refs.get('categoryFilter');
        if (!select) return;
        
        const state = InventoryState.getState();
        const categories = state.categories || [];
        const selectedCategory = state.selectedCategory;
        
        const currentValue = select.value;
        
        select.innerHTML = `
            <option value="">Все категории</option>
            ${categories.map(cat => `
                <option value="${cat.value}" ${selectedCategory === cat.value ? 'selected' : ''}>
                    ${cat.label} (${cat.count})
                </option>
            `).join('')}
        `;
        
        // Восстанавливаем значение если оно было изменено внешне
        if (selectedCategory && selectedCategory !== currentValue) {
            select.value = selectedCategory;
        }
    }
    
    /**
     * Обновляет категории (вызывается извне)
     */
    updateCategories(categories) {
        InventoryState.set('categories', categories);
        this.updateCategoryOptions();
    }
    
    /**
     * Получает текущие значения фильтров
     */
    getFilters() {
        return {
            searchQuery: this.refs.get('searchInput')?.value || '',
            category: this.refs.get('categoryFilter')?.value || '',
            status: this.refs.get('statusFilter')?.value || '',
            sort: this.refs.get('sortSelect')?.value || 'created_at-desc'
        };
    }
    
    /**
     * Устанавливает значения фильтров
     */
    setFilters(filters) {
        const searchInput = this.refs.get('searchInput');
        const categoryFilter = this.refs.get('categoryFilter');
        const statusFilter = this.refs.get('statusFilter');
        const sortSelect = this.refs.get('sortSelect');
        
        if (searchInput && filters.searchQuery !== undefined) {
            searchInput.value = filters.searchQuery;
        }
        if (categoryFilter && filters.category !== undefined) {
            categoryFilter.value = filters.category;
        }
        if (statusFilter && filters.status !== undefined) {
            statusFilter.value = filters.status;
        }
        if (sortSelect && filters.sort !== undefined) {
            sortSelect.value = filters.sort;
        }
    }
    
    /**
     * Фокусирует поле поиска
     */
    focusSearch() {
        this.refs.get('searchInput')?.focus();
    }
    
    /**
     * Очищает поле поиска
     */
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
        }
        
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
    }
}
