/**
 * Product Grid Component
 * 
 * Сетка товаров с группировкой по категориям.
 * Поддерживает режимы отображения "сетка" и "список".
 * 
 * @module ProductGrid
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { formatMoney } from '../../utils/formatters.js';
import { getCategoryName, formatAttributes } from '../../utils/categorySchema.js';

export class ProductGrid extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onAddToCart: null,
            onQuickView: null,
            ...options
        };
        
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = CashierState.getState();
        const filteredProducts = state.filteredProducts;
        const popularProducts = state.popularProducts || [];
        const recentlyAdded = state.recentlyAdded || [];
        const viewMode = state.viewMode;
        const expandedCategories = state.expandedCategories;
        const searchQuery = state.searchQuery;
        
        const groupedProducts = this.groupByCategory(filteredProducts);
        
        return `
            <div class="product-grid-container">
                ${popularProducts.length > 0 ? `
                    <div class="quick-items-section">
                        <h4>🔥 Часто продаваемые</h4>
                        <div class="quick-items-scroll">
                            ${popularProducts.slice(0, 8).map(p => this.renderQuickItem(p)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${recentlyAdded.length > 0 && !searchQuery ? `
                    <div class="quick-items-section">
                        <h4>🆕 Недавние</h4>
                        <div class="quick-items-scroll">
                            ${recentlyAdded.map(p => this.renderQuickItem(p)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <div class="products-container">
                    ${Object.entries(groupedProducts).map(([category, products]) => 
                        this.renderCategoryGroup(category, products, expandedCategories.has(category) || !!searchQuery, viewMode)
                    ).join('')}
                    
                    ${filteredProducts.length === 0 ? this.renderEmptyState(searchQuery) : ''}
                </div>
            </div>
        `;
    }
    
    // ========== РЕНДЕРИНГ ==========
    
    renderCategoryGroup(category, products, isExpanded, viewMode) {
        const categoryName = getCategoryName(category);
        
        return `
            <div class="category-group ${isExpanded ? 'expanded' : 'collapsed'}" data-category="${category}">
                <div class="category-header" data-ref="categoryHeader" data-category="${category}">
                    <button class="btn-icon btn-toggle" data-action="toggleCategory" data-category="${category}">
                        ${isExpanded ? '▼' : '▶'}
                    </button>
                    <span class="category-name">${categoryName}</span>
                    <span class="category-count">${products.length}</span>
                </div>
                <div class="category-products ${viewMode}" data-category="${category}">
                    ${isExpanded ? products.map(p => this.renderProductCard(p)).join('') : ''}
                </div>
            </div>
        `;
    }
    
    renderProductCard(product) {
        const isAvailable = product.status === 'in_stock';
        const attributesText = formatAttributes(product.category, product.attributes);
        const margin = product.cost_price && product.price 
            ? ((product.price - product.cost_price) / product.price * 100).toFixed(0)
            : null;
        
        return `
            <div class="product-card ${!isAvailable ? 'product-sold' : ''}" 
                 data-id="${product.id}"
                 data-ref="productCard"
                 title="${this.escapeHtml(product.name)}"
            >
                <div class="product-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}" loading="lazy">` 
                        : '<span class="photo-placeholder">📦</span>'
                    }
                    ${margin && margin > 30 ? `
                        <span class="product-badge profit-badge">🔥</span>
                    ` : ''}
                </div>
                <div class="product-info">
                    <h4 class="product-name">${this.escapeHtml(product.name)}</h4>
                    ${attributesText ? `
                        <span class="product-attributes">${this.escapeHtml(attributesText)}</span>
                    ` : ''}
                    <div class="product-footer">
                        <span class="product-price">${formatMoney(product.price)}</span>
                        ${isAvailable ? `
                            <button 
                                class="btn-add-to-cart" 
                                data-action="addToCart" 
                                data-id="${product.id}"
                                title="Добавить в корзину"
                            >
                                +
                            </button>
                        ` : `
                            <span class="status-badge sold">Продан</span>
                        `}
                    </div>
                </div>
            </div>
        `;
    }
    
    renderQuickItem(product) {
        const isAvailable = product.status === 'in_stock';
        
        return `
            <div class="quick-item ${!isAvailable ? 'sold' : ''}" 
                 data-id="${product.id}"
                 data-action="addToCart"
            >
                <div class="quick-item-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}">` 
                        : '📦'
                    }
                </div>
                <span class="quick-item-price">${formatMoney(product.price)}</span>
            </div>
        `;
    }
    
    renderEmptyState(searchQuery) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <p>${searchQuery ? 'Товары не найдены. Попробуйте изменить поисковый запрос.' : 'Нет товаров в наличии.'}</p>
                ${searchQuery ? `
                    <button class="btn-secondary" data-ref="clearSearchEmptyBtn">
                        Сбросить поиск
                    </button>
                ` : ''}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Переключение категорий
        this.container.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('[data-action="toggleCategory"]');
            if (toggleBtn) {
                const category = toggleBtn.dataset.category;
                CashierState.toggleCategory(category);
                return;
            }
            
            const addBtn = e.target.closest('[data-action="addToCart"]');
            if (addBtn) {
                const id = addBtn.dataset.id;
                if (this.options.onAddToCart) {
                    this.options.onAddToCart(id);
                }
                return;
            }
            
            const card = e.target.closest('[data-ref="productCard"]');
            if (card && !e.target.closest('[data-action]')) {
                const id = card.dataset.id;
                if (this.options.onQuickView) {
                    this.options.onQuickView(id);
                }
            }
        });
        
        // Кнопка очистки поиска в пустом состоянии
        this.addDomListener('clearSearchEmptyBtn', 'click', () => {
            CashierState.set('searchQuery', '');
            CashierState.filterProducts();
        });
        
        // Подписка на состояние
        this.unsubscribeState = CashierState.subscribe((changes) => {
            const shouldUpdate = changes.some(c => 
                ['filteredProducts', 'viewMode', 'expandedCategories', 'popularProducts', 'recentlyAdded'].includes(c.key)
            );
            if (shouldUpdate) {
                this.update();
            }
        });
    }
    
    // ========== УТИЛИТЫ ==========
    
    groupByCategory(products) {
        const groups = {};
        
        products.forEach(p => {
            const cat = p.category || 'other';
            if (!groups[cat]) {
                groups[cat] = [];
            }
            groups[cat].push(p);
        });
        
        return Object.fromEntries(
            Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
        );
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
    }
}
