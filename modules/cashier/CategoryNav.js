/**
 * Category Navigation Component
 * 
 * Навигация по категориям товаров с поиском и переключением вида.
 * 
 * @module CategoryNav
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { getCategoryName } from '../../utils/categorySchema.js';

const SEARCH_DEBOUNCE_MS = 300;

export class CategoryNav extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onCategorySelect: null,
            onSearch: null,
            onViewModeChange: null,
            ...options
        };
        
        this.searchDebounceTimer = null;
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = CashierState.getState();
        const categories = state.categories || [];
        const selectedCategory = state.selectedCategory;
        const searchQuery = state.searchQuery;
        const viewMode = state.viewMode;
        const inStockCount = state.filteredProducts.length;
        
        return `
            <div class="category-nav">
                <div class="products-toolbar">
                    <div class="search-wrapper">
                        <input 
                            type="text" 
                            data-ref="searchInput"
                            placeholder="Поиск по названию, ID или ключевым словам... (нажмите /)"
                            value="${this.escapeHtml(searchQuery)}"
                            autocomplete="off"
                        >
                        ${searchQuery ? `
                            <button class="btn-icon btn-clear" data-ref="clearSearchBtn" title="Очистить (Esc)">
                                ✕
                            </button>
                        ` : ''}
                    </div>
                    
                    <div class="view-controls">
                        <button 
                            class="btn-icon ${viewMode === 'grid' ? 'active' : ''}" 
                            data-ref="gridViewBtn"
                            title="Сетка"
                        >
                            ▦
                        </button>
                        <button 
                            class="btn-icon ${viewMode === 'list' ? 'active' : ''}" 
                            data-ref="listViewBtn"
                            title="Список"
                        >
                            ☰
                        </button>
                    </div>
                </div>
                
                <div class="categories-header">
                    <h3>
                        Товары в наличии 
                        <span class="count-badge">${inStockCount}</span>
                    </h3>
                    <div class="category-tabs" data-ref="categoryTabs">
                        <button 
                            class="category-tab ${!selectedCategory ? 'active' : ''}"
                            data-category="all"
                        >
                            Все
                        </button>
                        ${categories.slice(0, 6).map(cat => `
                            <button 
                                class="category-tab ${selectedCategory === cat.value ? 'active' : ''}"
                                data-category="${cat.value}"
                            >
                                ${getCategoryName(cat.value)} (${cat.count})
                            </button>
                        `).join('')}
                    </div>
                </div>
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
            
            setTimeout(() => searchInput.focus(), 100);
        }
        
        // Очистка поиска
        this.addDomListener('clearSearchBtn', 'click', () => {
            const input = this.refs.get('searchInput');
            if (input) {
                input.value = '';
                if (this.options.onSearch) {
                    this.options.onSearch('');
                }
            }
        });
        
        // Переключение вида
        this.addDomListener('gridViewBtn', 'click', () => {
            if (this.options.onViewModeChange) {
                this.options.onViewModeChange('grid');
            }
        });
        
        this.addDomListener('listViewBtn', 'click', () => {
            if (this.options.onViewModeChange) {
                this.options.onViewModeChange('list');
            }
        });
        
        // Выбор категории
        const categoryTabs = this.refs.get('categoryTabs');
        if (categoryTabs) {
            categoryTabs.addEventListener('click', (e) => {
                const tab = e.target.closest('[data-category]');
                if (!tab) return;
                
                const category = tab.dataset.category;
                if (this.options.onCategorySelect) {
                    this.options.onCategorySelect(category === 'all' ? null : category);
                }
            });
        }
        
        // Подписка на состояние
        this.unsubscribeState = CashierState.subscribe((changes) => {
            const shouldUpdate = changes.some(c => 
                ['categories', 'selectedCategory', 'searchQuery', 'viewMode', 'filteredProducts'].includes(c.key)
            );
            if (shouldUpdate) {
                this.update();
            }
        });
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
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
        }
        
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
    }
}
