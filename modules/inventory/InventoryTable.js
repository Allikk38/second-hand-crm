// ========================================
// FILE: ./modules/inventory/InventoryTable.js
// ========================================

/**
 * Inventory Table Component
 * 
 * Отвечает за рендеринг таблицы товаров, обработку выделения,
 * действия со строками (редактировать, удалить) и бесконечный скролл.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Прямое реактивное связывание через `Store.state.inventory`.
 * - Упрощенная логика выделения через методы `Store`.
 * - Оптимизация рендеринга через виртуальный скролл (IntersectionObserver).
 * 
 * @module InventoryTable
 * @version 6.0.0
 * @changes
 * - Обновлена документация.
 * - Добавлена очистка observer при destroy.
 * - Улучшена обработка выделения.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { formatMoney } from '../../utils/formatters.js';
import { getCategoryName, formatAttributes } from '../../utils/categorySchema.js';

const STATUS_TEXTS = {
    in_stock: 'В наличии',
    sold: 'Продан',
    reserved: 'Забронирован'
};

const SCROLL_THRESHOLD = 0.8;

export class InventoryTable extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onEdit: null,
            onDelete: null,
            onLoadMore: null,
            ...options
        };
        
        this.intersectionObserver = null;
        this.loadMoreTrigger = null;
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const inventory = Store.state.inventory;
        const products = inventory.products;
        const isLoading = inventory.isLoading;
        const hasMore = inventory.hasMore;
        const isAllSelected = inventory.isAllSelected;
        
        return `
            <div class="products-table-wrapper" data-ref="tableWrapper">
                <table class="products-table">
                    <thead>
                        <tr>
                            <th width="40">
                                <input 
                                    type="checkbox" 
                                    data-ref="selectAllCheckbox"
                                    ${isAllSelected ? 'checked' : ''}
                                >
                            </th>
                            <th width="80">Фото</th>
                            <th>Название</th>
                            <th>Категория</th>
                            <th>Характеристики</th>
                            <th class="text-right">Цена</th>
                            <th>Статус</th>
                            <th width="100">Действия</th>
                        </tr>
                    </thead>
                    <tbody data-ref="tableBody">
                        ${this.renderRows(products)}
                    </tbody>
                </table>
                
                <div data-ref="loadMoreTrigger" class="load-more-trigger"></div>
                
                ${isLoading ? this.renderSkeleton() : ''}
                
                ${!hasMore && products.length > 0 ? `
                    <div class="end-of-list">Все товары загружены (${products.length})</div>
                ` : ''}
                
                ${products.length === 0 && !isLoading ? `
                    <div class="empty-state">
                        <div class="empty-state-icon">📦</div>
                        <p>Нет товаров</p>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    renderRows(products) {
        if (!products.length) return '';
        return products.map(product => this.renderRow(product)).join('');
    }
    
    renderRow(product) {
        const attributesText = formatAttributes(product.category, product.attributes);
        const isSelected = Store.isInventoryItemSelected(product.id);
        const margin = product.cost_price && product.price 
            ? ((product.price - product.cost_price) / product.price * 100).toFixed(0)
            : null;
        
        return `
            <tr class="product-row ${product.status === 'sold' ? 'row-sold' : ''}" data-id="${product.id}">
                <td class="checkbox-cell">
                    <input 
                        type="checkbox" 
                        class="product-checkbox"
                        data-id="${product.id}"
                        ${isSelected ? 'checked' : ''}
                    >
                </td>
                <td class="photo-cell">
                    <div class="product-thumb">
                        ${product.photo_url 
                            ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}" loading="lazy">` 
                            : '<span class="thumb-placeholder">📦</span>'
                        }
                    </div>
                </td>
                <td class="name-cell">
                    <div class="product-name">${this.escapeHtml(product.name)}</div>
                    <div class="product-id">ID: ${product.id.slice(0, 8)}</div>
                </td>
                <td class="category-cell">
                    ${getCategoryName(product.category)}
                </td>
                <td class="attributes-cell">
                    <span class="attributes-text">${this.escapeHtml(attributesText) || '—'}</span>
                </td>
                <td class="price-cell text-right">
                    <div class="price-main">${formatMoney(product.price)}</div>
                    ${product.cost_price ? `
                        <div class="price-cost">Себ: ${formatMoney(product.cost_price)}</div>
                    ` : ''}
                    ${margin ? `
                        <div class="price-margin ${margin > 0 ? 'positive' : 'negative'}">
                            Маржа: ${margin}%
                        </div>
                    ` : ''}
                </td>
                <td class="status-cell">
                    <span class="status-badge status-${product.status}">
                        ${STATUS_TEXTS[product.status] || product.status}
                    </span>
                </td>
                <td class="actions-cell">
                    <div class="row-actions">
                        <button class="btn-icon" data-action="edit" data-id="${product.id}" title="Редактировать">
                            ✎
                        </button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" title="Удалить">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }
    
    renderSkeleton() {
        return `
            <div class="skeleton-rows">
                ${Array(3).fill(0).map(() => `
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-checkbox"></div>
                        <div class="skeleton skeleton-image"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-badge"></div>
                        <div class="skeleton skeleton-actions"></div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Чекбокс "Выбрать все"
        this.addDomListener('selectAllCheckbox', 'change', (e) => {
            if (e.target.checked) {
                Store.selectAllInventory();
            } else {
                Store.clearInventorySelection();
            }
            this.update();
        });
        
        // Делегирование событий в tbody
        const tbody = this.refs.get('tableBody');
        if (tbody) {
            tbody.addEventListener('change', (e) => {
                if (e.target.classList.contains('product-checkbox')) {
                    const id = e.target.dataset.id;
                    const selectedIds = Store.state.inventory.selectedIds;
                    
                    if (e.target.checked) {
                        selectedIds.add(id);
                    } else {
                        selectedIds.delete(id);
                        Store.state.inventory.isAllSelected = false;
                    }
                    
                    this.updateSelectAllCheckbox();
                }
            });
            
            tbody.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                
                if (action === 'edit' && this.options.onEdit) {
                    this.options.onEdit(id);
                } else if (action === 'delete' && this.options.onDelete) {
                    this.options.onDelete(id);
                }
            });
        }
        
        // Бесконечный скролл
        this.setupInfiniteScroll();
        
        // Подписка на изменения Store
        this.unsubscribers.push(
            Store.subscribe('inventory.products', () => this.update()),
            Store.subscribe('inventory.isLoading', () => this.update()),
            Store.subscribe('inventory.hasMore', () => this.update()),
            Store.subscribe('inventory.selectedIds', () => this.updateSelectAllCheckbox()),
            Store.subscribe('inventory.isAllSelected', () => this.updateSelectAllCheckbox())
        );
    }
    
    setupInfiniteScroll() {
        this.loadMoreTrigger = this.refs.get('loadMoreTrigger');
        if (!this.loadMoreTrigger) return;
        
        this.intersectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    const inventory = Store.state.inventory;
                    if (entry.isIntersecting && inventory.hasMore && !inventory.isLoading && this.options.onLoadMore) {
                        this.options.onLoadMore();
                    }
                });
            },
            {
                root: this.refs.get('tableWrapper'),
                threshold: SCROLL_THRESHOLD
            }
        );
        
        this.intersectionObserver.observe(this.loadMoreTrigger);
    }
    
    updateSelectAllCheckbox() {
        const checkbox = this.refs.get('selectAllCheckbox');
        if (checkbox) {
            const inventory = Store.state.inventory;
            const visibleIds = new Set(inventory.products.map(p => p.id));
            const selectedVisible = Store.getInventorySelectedIds().filter(id => visibleIds.has(id));
            
            checkbox.checked = selectedVisible.length === inventory.products.length && inventory.products.length > 0;
        }
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    refresh() {
        this.update();
    }
    
    clearSelection() {
        Store.clearInventorySelection();
    }
    
    getSelectedIds() {
        return Store.getInventorySelectedIds();
    }
    
    getSelectedCount() {
        return Store.getInventorySelectedCount();
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
    }
}
