/**
 * Страница склада
 * Отображение, поиск и управление товарами
 * 
 * @module InventoryPage
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { ProductForm } from './ProductForm.js';

export class InventoryPage extends BaseComponent {
    constructor(container) {
        super(container);
        this.products = [];
        this.filteredProducts = [];
        this.searchQuery = '';
    }

    async render() {
        this.showLoader();
        
        try {
            this.products = await ProductService.getAll();
            this.filterProducts();
        } catch (error) {
            this.publish('app:error', error);
        }

        const canCreate = PermissionManager.can('products:create');

        return `
            <div class="inventory-page">
                <div class="header">
                    <h2>Склад (${this.filteredProducts.length})</h2>
                    ${canCreate ? '<button class="btn-add" data-action="add">Добавить товар</button>' : ''}
                </div>
                
                <div class="search-bar">
                    <input 
                        type="text" 
                        name="search" 
                        placeholder="Поиск по названию или размеру..." 
                        value="${this.searchQuery}"
                        autocomplete="off"
                    >
                </div>
                
                <div class="products-grid">
                    ${this.filteredProducts.length 
                        ? this.filteredProducts.map(p => this.renderProductCard(p)).join('')
                        : '<div class="empty-state">Товары не найдены</div>'
                    }
                </div>
            </div>
        `;
    }

    renderProductCard(product) {
        return `
            <div class="product-card" data-id="${product.id}">
                <div class="product-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${product.name}">` 
                        : '<span class="empty-state-icon">📦</span>'
                    }
                </div>
                <div class="product-info">
                    <h4>${product.name}</h4>
                    ${product.size ? `<span class="product-size">Размер: ${product.size}</span>` : ''}
                    <p class="price">${this.formatMoney(product.price)}</p>
                    <span class="status ${product.status}">${this.getStatusText(product.status)}</span>
                </div>
            </div>
        `;
    }

    getStatusText(status) {
        const statuses = {
            in_stock: 'В наличии',
            sold: 'Продан',
            reserved: 'Забронирован'
        };
        return statuses[status] || status;
    }

    attachEvents() {
        // Кнопка добавления
        const addBtn = this.element.querySelector('[data-action="add"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openProductForm());
        }
        
        // Поиск
        const searchInput = this.element.querySelector('[name="search"]');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.filterProducts();
                this.update();
            });
        }

        this.subscribe('product:created', () => this.refresh());
        this.subscribe('product:updated', () => this.refresh());
        this.subscribe('product:deleted', () => this.refresh());
    }

    filterProducts() {
        const query = this.searchQuery.toLowerCase().trim();
        
        if (!query) {
            this.filteredProducts = [...this.products];
        } else {
            this.filteredProducts = this.products.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(query);
                const sizeMatch = p.size && p.size.toLowerCase().includes(query);
                return nameMatch || sizeMatch;
            });
        }
    }

    async refresh() {
        try {
            this.products = await ProductService.getAll();
            this.filterProducts();
            this.update();
        } catch (error) {
            this.publish('app:error', error);
        }
    }

    openProductForm() {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'modal-container';
        document.body.appendChild(modalContainer);
        
        const form = new ProductForm(modalContainer);
        form.mount();
        
        const unsubscribe = this.subscribe('product:created', () => {
            modalContainer.remove();
            unsubscribe();
        });
    }
}
