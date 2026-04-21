// ========================================
// FILE: ./modules/cashier/CategoryNav.js
// ========================================

/**
 * Category Navigation Component
 * 
 * Панель поиска и навигации по категориям товаров.
 * Поддерживает быстрый поиск и сканирование штрихкодов.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Удалена зависимость от `CashierState`.
 * - Добавлена обработка сканера (Enter).
 * - Дебаунс поиска для оптимизации.
 * 
 * @module CategoryNav
 * @version 5.0.0
 * @changes
 * - Удалена зависимость от `CashierState`.
 * - Подключение к `Store.state.cashier`.
 * - Убрано переключение viewMode.
 * - Добавлена обработка сканера.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { ProductService } from '../../services/ProductService.js';
import { Notification } from '../common/Notification.js';
import { getCategoryName } from '../../utils/categorySchema.js';

const SEARCH_DEBOUNCE_MS = 300;

export class CategoryNav extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onCategorySelect: null,
            onSearch: null,
            onScan: null,  // Колбэк для сканера
            ...options
        };
        
        this.searchDebounceTimer = null;
        this.unsubscribers = [];
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const categories = cashier.categories || [];
        const selectedCategory = cashier.selectedCategory;
        const searchQuery = cashier.searchQuery;
        const scannerInput = cashier.scannerInput || '';

        return `
            <div class="category-nav">
                <div class="products-toolbar">
                    <div class="search-wrapper">
                        <span class="search-icon">🔍</span>
                        <input 
                            type="text" 
                            data-ref="searchInput"
                            class="search-input"
                            placeholder="Поиск по названию или ID... (нажмите /)"
                            value="${this.escapeHtml(searchQuery)}"
                            autocomplete="off"
                        >
                        ${searchQuery ? `
                            <button class="clear-search-btn" data-ref="clearSearchBtn" title="Очистить (Esc)">✕</button>
                        ` : ''}
                    </div>
                </div>
                
                <div class="scanner-section">
                    <div class="search-wrapper">
                        <span class="search-icon">📷</span>
                        <input 
                            type="text" 
                            data-ref="scannerInput"
                            class="search-input"
                            placeholder="Сканер / Быстрый ввод ID..."
                            value="${this.escapeHtml(scannerInput)}"
                            autocomplete="off"
                        >
                        ${scannerInput ? `
                            <button class="clear-search-btn" data-ref="clearScannerBtn">✕</button>
                        ` : ''}
                        <span class="scanner-hint">Enter ↵</span>
                    </div>
                </div>
                
                <div class="category-bar">
                    <button 
                        class="category-tab ${!selectedCategory ? 'active' : ''}"
                        data-category="all"
                    >
                        Все
                    </button>
                    ${categories.map(cat => `
                        <button 
                            class="category-tab ${selectedCategory === cat.value ? 'active' : ''}"
                            data-category="${cat.value}"
                        >
                            ${getCategoryName(cat.value)}
                            <span class="category-count">${cat.count}</span>
                        </button>
                    `).join('')}
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
                    Store.state.cashier.searchQuery = query;
                    if (this.options.onSearch) {
                        this.options.onSearch(query);
                    }
                }, SEARCH_DEBOUNCE_MS);
            });
            
            // Фокус при загрузке
            setTimeout(() => searchInput.focus(), 100);
        }
        
        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            // / - фокус на поиск
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
                e.preventDefault();
                this.refs.get('searchInput')?.focus();
            }
            // Escape - очистка поиска
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                e.preventDefault();
                this.clearSearch();
            }
        });
        
        // Сканер
        const scannerInput = this.refs.get('scannerInput');
        if (scannerInput) {
            scannerInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = scannerInput.value.trim();
                    if (value) {
                        await this.handleScan(value);
                        scannerInput.value = '';
                        Store.state.cashier.scannerInput = '';
                    }
                }
            });
            
            scannerInput.addEventListener('input', (e) => {
                Store.state.cashier.scannerInput = e.target.value;
            });
        }
        
        // Очистка поиска
        this.addDomListener('clearSearchBtn', 'click', () => this.clearSearch());
        this.addDomListener('clearScannerBtn', 'click', () => {
            const input = this.refs.get('scannerInput');
            if (input) {
                input.value = '';
                Store.state.cashier.scannerInput = '';
                input.focus();
            }
        });
        
        // Выбор категории
        this.container.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-category]');
            if (!tab) return;
            
            const category = tab.dataset.category;
            const selectedCategory = category === 'all' ? null : category;
            
            Store.state.cashier.selectedCategory = selectedCategory;
            
            // Обновляем активный класс
            this.container.querySelectorAll('[data-category]').forEach(t => {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            
            if (this.options.onCategorySelect) {
                this.options.onCategorySelect(selectedCategory);
            }
        });
        
        // Подписка на изменения в Store
        this.unsubscribers.push(
            Store.subscribe('cashier.categories', () => this.update()),
            Store.subscribe('cashier.selectedCategory', () => this.updateActiveCategory()),
            Store.subscribe('cashier.searchQuery', () => this.updateSearchInput())
        );
    }

    // ========== ОБРАБОТЧИКИ ==========
    
    async handleScan(value) {
        try {
            // Пробуем найти по ID
            let product = await ProductService.getById(value).catch(() => null);
            
            // Если не нашли, ищем по названию
            if (!product) {
                const products = Store.state.cashier.products;
                product = products.find(p => 
                    p.name.toLowerCase().includes(value.toLowerCase()) ||
                    p.keywords?.toLowerCase().includes(value.toLowerCase())
                );
            }
            
            if (!product) {
                Notification.warning(`Товар не найден: ${value}`);
                return;
            }
            
            if (product.status !== 'in_stock') {
                Notification.warning(`Товар "${product.name}" уже продан`);
                return;
            }
            
            if (this.options.onScan) {
                this.options.onScan(product);
            }
            
        } catch (error) {
            console.error('[CategoryNav] Scan error:', error);
            Notification.error('Ошибка при поиске товара');
        }
    }

    clearSearch() {
        const input = this.refs.get('searchInput');
        if (input) {
            input.value = '';
            Store.state.cashier.searchQuery = '';
            if (this.options.onSearch) {
                this.options.onSearch('');
            }
            input.focus();
        }
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    updateActiveCategory() {
        const selectedCategory = Store.state.cashier.selectedCategory;
        this.container.querySelectorAll('[data-category]').forEach(tab => {
            const cat = tab.dataset.category;
            if ((cat === 'all' && !selectedCategory) || cat === selectedCategory) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    }

    updateSearchInput() {
        const input = this.refs.get('searchInput');
        if (input) {
            input.value = Store.state.cashier.searchQuery || '';
        }
    }

    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    focusSearch() {
        this.refs.get('searchInput')?.focus();
    }

    focusScanner() {
        this.refs.get('scannerInput')?.focus();
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        
        this.unsubscribers.forEach(u => u());
        this.unsubscribers = [];
    }
}
