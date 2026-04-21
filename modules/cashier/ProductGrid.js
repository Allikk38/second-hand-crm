// ========================================
// FILE: ./modules/cashier/ProductGrid.js
// ========================================

/**
 * Product Grid Component
 * 
 * Отображает сетку товаров с группировкой по категориям.
 * Поддерживает быстрое добавление в корзину.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Локальное управление раскрытием/скрытием категорий.
 * - Оптимизированный рендеринг через обновление DOM, а не полную перерисовку.
 * 
 * @module ProductGrid
 * @version 5.0.0
 * @changes
 * - Удалена зависимость от `CashierState`.
 * - Подключение к `Store.state.cashier`.
 * - Обновлен дизайн карточек.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { formatMoney } from '../../utils/formatters.js';
import { getCategoryName } from '../../utils/categorySchema.js';

export class ProductGrid extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onAddToCart: null,
            ...options
        };
        
        // Локальное состояние: какие категории развернуты
        this.expandedCategories = new Set();
        
        this.unsubscribers = [];
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const filteredProducts = cashier.filteredProducts || [];
        
        // Группируем товары по категориям
        const grouped = this.groupByCategory(filteredProducts);
        
        // Если есть поисковый запрос - разворачиваем все категории
        if (cashier.searchQuery) {
            Object.keys(grouped).forEach(cat => this.expandedCategories.add(cat));
        }

        return `
            <div class="products-grid-wrapper">
                ${Object.keys(grouped).length === 0 ? this.renderEmpty() : `
                    <div class="products-container">
                        ${Object.entries(grouped).map(([category, products]) => 
                            this.renderCategoryGroup(category, products)
                        ).join('')}
                    </div>
                `}
            </div>
        `;
    }

    renderEmpty() {
        const cashier = Store.state.cashier;
        return `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <p>${cashier.searchQuery ? 'Товары не найдены' : 'Нет товаров в наличии'}</p>
                ${cashier.searchQuery ? `
                    <button class="btn-secondary" data-ref="clearSearchBtn">Сбросить поиск</button>
                ` : ''}
            </div>
        `;
    }

    renderCategoryGroup(category, products) {
        const isExpanded = this.expandedCategories.has(category);
        const categoryName = getCategoryName(category);
        
        return `
            <div class="category-group" data-category="${category}">
                <div class="category-header" data-action="toggleCategory" data-category="${category}">
                    <span class="category-toggle">${isExpanded ? '▼' : '▶'}</span>
                    <span class="category-name">${categoryName}</span>
                    <span class="category-count">${products.length}</span>
                </div>
                ${isExpanded ? `
                    <div class="category-products grid">
                        ${products.map(p => this.renderProductCard(p)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderProductCard(product) {
        const isAvailable = product.status === 'in_stock';
        
        return `
            <div class="product-card ${!isAvailable ? 'product-sold' : ''}" data-id="${product.id}" data-action="addToCart">
                <div class="product-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}" loading="lazy">` 
                        : '<span class="photo-placeholder">📦</span>'
                    }
                </div>
                <div class="product-info">
                    <div class="product-name" title="${this.escapeHtml(product.name)}">${this.escapeHtml(product.name)}</div>
                    <div class="product-footer">
                        <span class="product-price">${formatMoney(product.price)}</span>
                        ${isAvailable ? `
                            <button class="btn-add-to-cart" data-action="addToCart" data-id="${product.id}">+</button>
                        ` : `
                            <span class="status-badge sold">Продан</span>
                        `}
                    </div>
                </div>
            </div>
        `;
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Делегирование событий
        this.container.addEventListener('click', (e) => {
            // Переключение категории
            const header = e.target.closest('[data-action="toggleCategory"]');
            if (header) {
                const category = header.dataset.category;
                this.toggleCategory(category);
                return;
            }
            
            // Добавление в корзину
            const addBtn = e.target.closest('[data-action="addToCart"]');
            if (addBtn) {
                const id = addBtn.dataset.id;
                const product = this.findProductById(id);
                if (product && this.options.onAddToCart) {
                    this.options.onAddToCart(product);
                }
                return;
            }
        });
        
        // Кнопка сброса поиска (в пустом состоянии)
        this.addDomListener('clearSearchBtn', 'click', () => {
            Store.state.cashier.searchQuery = '';
            // CashierApp сам применит фильтры и вызовет обновление
        });
        
        // Подписка на изменения товаров в Store
        this.unsubscribers.push(
            Store.subscribe('cashier.filteredProducts', () => this.refresh())
        );
    }

    // ========== УТИЛИТЫ ==========
    
    groupByCategory(products) {
        const groups = {};
        products.forEach(p => {
            const cat = p.category || 'other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(p);
        });
        return groups;
    }

    findProductById(id) {
        return Store.state.cashier.products.find(p => p.id === id);
    }

    toggleCategory(category) {
        if (this.expandedCategories.has(category)) {
            this.expandedCategories.delete(category);
        } else {
            this.expandedCategories.add(category);
        }
        this.refresh();
    }

    /**
     * Обновляет отображение без полной перерисовки (если возможно)
     */
    refresh() {
        const cashier = Store.state.cashier;
        const filteredProducts = cashier.filteredProducts || [];
        const grouped = this.groupByCategory(filteredProducts);
        
        const container = this.element?.querySelector('.products-grid-wrapper');
        if (!container) return;
        
        if (Object.keys(grouped).length === 0) {
            container.innerHTML = this.renderEmpty();
            this.cacheRefs();
            return;
        }
        
        // Проверяем, изменилась ли структура категорий
        const existingGroups = container.querySelectorAll('.category-group');
        if (existingGroups.length !== Object.keys(grouped).length) {
            // Полная перерисовка
            this.update();
            return;
        }
        
        // Обновляем только содержимое развернутых категорий
        Object.entries(grouped).forEach(([category, products]) => {
            const group = container.querySelector(`.category-group[data-category="${category}"]`);
            if (!group) return;
            
            const isExpanded = this.expandedCategories.has(category);
            const toggle = group.querySelector('.category-toggle');
            const productsContainer = group.querySelector('.category-products');
            
            if (toggle) {
                toggle.textContent = isExpanded ? '▼' : '▶';
            }
            
            if (productsContainer) {
                if (isExpanded) {
                    productsContainer.innerHTML = products.map(p => this.renderProductCard(p)).join('');
                } else {
                    productsContainer.innerHTML = '';
                }
            }
            
            const countEl = group.querySelector('.category-count');
            if (countEl) {
                countEl.textContent = products.length;
            }
        });
        
        this.cacheRefs();
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        this.unsubscribers = [];
    }
}
