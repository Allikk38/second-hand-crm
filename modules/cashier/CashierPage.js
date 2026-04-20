/**
 * Страница кассы
 * Управление продажами: выбор товаров, корзина, смена
 * 
 * @module CashierPage
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { ShiftService } from '../../services/ShiftService.js';
import { SaleService } from '../../services/SaleService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Cart } from './Cart.js';
import { ShiftOpener } from './ShiftOpener.js';
import { Notification } from '../common/Notification.js';

export class CashierPage extends BaseComponent {
    constructor(container) {
        super(container);
        this.products = [];
        this.filteredProducts = [];
        this.searchQuery = '';
        this.cart = null;
        this.currentShift = null;
    }

    async render() {
        this.showLoader();
        
        const user = AuthManager.getUser();
        this.currentShift = await ShiftService.getCurrentShift(user.id);
        
        try {
            this.products = await ProductService.getAll();
            this.filterProducts();
        } catch (error) {
            this.publish('app:error', error);
        }

        const inStockCount = this.filteredProducts.filter(p => p.status === 'in_stock').length;

        return `
            <div class="cashier-page">
                <div class="cashier-header">
                    <div id="shift-container"></div>
                </div>
                <div class="cashier-layout">
                    <div class="products-panel">
                        <h3>Товары в наличии (${inStockCount})</h3>
                        
                        <div class="search-bar">
                            <input 
                                type="text" 
                                name="search" 
                                placeholder="Поиск по названию или размеру..." 
                                value="${this.searchQuery}"
                                autocomplete="off"
                            >
                        </div>
                        
                        <div class="products-list">
                            ${this.filteredProducts.length 
                                ? this.filteredProducts.map(p => this.renderProductItem(p)).join('')
                                : '<div class="empty-state">Товары не найдены</div>'
                            }
                        </div>
                    </div>
                    <div class="cart-panel">
                        <div id="cart-container"></div>
                    </div>
                </div>
            </div>
        `;
    }

    renderProductItem(product) {
        const isAvailable = product.status === 'in_stock';
        
        return `
            <div class="product-item ${!isAvailable ? 'product-sold' : ''}" data-id="${product.id}">
                <div class="product-item-info">
                    <span class="product-item-name">${product.name}</span>
                    ${product.size ? `<span class="product-item-size">Размер: ${product.size}</span>` : ''}
                </div>
                <div class="product-item-actions">
                    <span class="price">${this.formatMoney(product.price)}</span>
                    ${isAvailable 
                        ? `<button data-action="add-to-cart" data-id="${product.id}">В корзину</button>`
                        : '<span class="status-badge sold">Продан</span>'
                    }
                </div>
            </div>
        `;
    }

    async attachEvents() {
        // ShiftOpener
        const shiftContainer = this.element.querySelector('#shift-container');
        const shiftOpener = new ShiftOpener(shiftContainer);
        await shiftOpener.mount();
        
        // Cart
        const cartContainer = this.element.querySelector('#cart-container');
        this.cart = new Cart(cartContainer);
        await this.cart.mount();
        
        // Поиск
        const searchInput = this.element.querySelector('[name="search"]');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.filterProducts();
                this.updateProductList();
            });
        }
        
        // Кнопки добавления в корзину
        this.attachAddToCartEvents();
        
        this.subscribe('cart:checkout', async ({ items, total, discount, paymentMethod }) => {
            await this.checkout(items, total, discount, paymentMethod);
        });
        
        this.subscribe('shift:opened', (shift) => {
            this.currentShift = shift;
            shiftOpener.update();
        });
        
        this.subscribe('product:updated', () => this.refreshProducts());
    }

    attachAddToCartEvents() {
        this.element.querySelectorAll('[data-action="add-to-cart"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!this.currentShift) {
                    Notification.warning('Сначала откройте смену');
                    return;
                }
                const id = btn.dataset.id;
                const product = this.products.find(p => p.id === id);
                this.cart.addItem(product);
            });
        });
    }

    filterProducts() {
        const query = this.searchQuery.toLowerCase().trim();
        
        // Сначала фильтруем только товары в наличии
        let available = this.products.filter(p => p.status === 'in_stock');
        
        if (!query) {
            this.filteredProducts = available;
        } else {
            this.filteredProducts = available.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(query);
                const sizeMatch = p.size && p.size.toLowerCase().includes(query);
                return nameMatch || sizeMatch;
            });
        }
    }

    updateProductList() {
        const productsList = this.element.querySelector('.products-list');
        const inStockCount = this.filteredProducts.filter(p => p.status === 'in_stock').length;
        
        // Обновляем заголовок
        const header = this.element.querySelector('.products-panel h3');
        if (header) {
            header.textContent = `Товары в наличии (${inStockCount})`;
        }
        
        // Обновляем список
        if (this.filteredProducts.length) {
            productsList.innerHTML = this.filteredProducts.map(p => this.renderProductItem(p)).join('');
        } else {
            productsList.innerHTML = '<div class="empty-state">Товары не найдены</div>';
        }
        
        // Перевешиваем события
        this.attachAddToCartEvents();
    }

    async refreshProducts() {
        try {
            this.products = await ProductService.getAll();
            this.filterProducts();
            this.updateProductList();
        } catch (error) {
            this.publish('app:error', error);
        }
    }

    async checkout(items, total, discount, paymentMethod) {
        try {
            await SaleService.create(this.currentShift.id, items, total, paymentMethod);
            Notification.success(`Продажа на ${this.formatMoney(total)}`);
            
            if (discount > 0) {
                Notification.info(`Применена скидка ${discount}%`);
            }
            
            this.cart.clear();
            await this.refreshProducts();
            
        } catch (error) {
            Notification.error('Ошибка при создании продажи');
            this.publish('app:error', error);
        }
    }
}
