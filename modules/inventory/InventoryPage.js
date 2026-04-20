import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { PermissionManager } from '../../core/PermissionManager.js';

export class InventoryPage extends BaseComponent {
    constructor(container) {
        super(container);
        this.products = [];
    }

    async render() {
        this.showLoader();
        
        try {
            this.products = await ProductService.getAll();
        } catch (error) {
            this.publish('app:error', error);
        }

        const canCreate = PermissionManager.can('products:create');

        return `
            <div class="inventory-page">
                <div class="header">
                    <h2>Склад (${this.products.length})</h2>
                    ${canCreate ? '<button class="btn-add" data-action="add">+ Добавить товар</button>' : ''}
                </div>
                <div class="products-grid">
                    ${this.products.map(p => this.renderProductCard(p)).join('')}
                </div>
            </div>
        `;
    }

    renderProductCard(product) {
        return `
            <div class="product-card" data-id="${product.id}">
                <div class="product-photo">
                    ${product.photo_url ? `<img src="${product.photo_url}" alt="${product.name}">` : '📦'}
                </div>
                <div class="product-info">
                    <h4>${product.name}</h4>
                    <p class="price">${this.formatMoney(product.price)}</p>
                    <span class="status ${product.status}">${product.status}</span>
                </div>
            </div>
        `;
    }

    attachEvents() {
        const addBtn = this.element.querySelector('[data-action="add"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.publish('inventory:add_clicked'));
        }

        this.subscribe('product:created', () => this.update());
        this.subscribe('product:updated', () => this.update());
        this.subscribe('product:deleted', () => this.update());
    }
}
