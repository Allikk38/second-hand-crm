import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { ShiftService } from '../../services/ShiftService.js';
import { SaleService } from '../../services/SaleService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Cart } from './Cart.js';
import { ShiftOpener } from './ShiftOpener.js';

export class CashierPage extends BaseComponent {
    constructor(container) {
        super(container);
        this.products = [];
        this.cart = null;
        this.currentShift = null;
    }

    async render() {
        this.showLoader();
        
        const user = AuthManager.getUser();
        this.currentShift = await ShiftService.getCurrentShift(user.id);
        
        try {
            this.products = await ProductService.getAll();
        } catch (error) {
            this.publish('app:error', error);
        }

        const inStock = this.products.filter(p => p.status === 'in_stock');

        return `
            <div class="cashier-page">
                <div class="cashier-header">
                    <div id="shift-container"></div>
                </div>
                <div class="cashier-layout">
                    <div class="products-panel">
                        <h3>Товары в наличии (${inStock.length})</h3>
                        <div class="products-list">
                            ${inStock.map(p => `
                                <div class="product-item" data-id="${p.id}">
                                    <span>${p.name}</span>
                                    <span class="price">${this.formatMoney(p.price)}</span>
                                    <button data-action="add-to-cart" data-id="${p.id}">+</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="cart-panel">
                        <div id="cart-container"></div>
                    </div>
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
        
        // Кнопки добавления в корзину
        this.element.querySelectorAll('[data-action="add-to-cart"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!this.currentShift) {
                    alert('Сначала откройте смену');
                    return;
                }
                const id = btn.dataset.id;
                const product = this.products.find(p => p.id === id);
                this.cart.addItem(product);
            });
        });
        
        this.subscribe('cart:checkout', async ({ items }) => {
            await this.checkout(items);
        });
        
        this.subscribe('shift:opened', (shift) => {
            this.currentShift = shift;
            shiftOpener.update();
        });
    }

    async checkout(items) {
        const total = items.reduce((sum, i) => sum + i.price, 0);
        const method = prompt('Способ оплаты (cash/card):', 'cash') || 'cash';
        
        try {
            await SaleService.create(this.currentShift.id, items, total, method);
            alert(`Продажа на ${this.formatMoney(total)}`);
            this.cart.clear();
            this.update();
        } catch (error) {
            alert('Ошибка: ' + error.message);
        }
    }
}
