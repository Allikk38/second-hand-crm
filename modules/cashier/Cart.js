/**
 * Корзина для кассы
 * Управление товарами перед продажей: добавление, удаление, скидка, способ оплаты
 * 
 * @module Cart
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Notification } from '../common/Notification.js';

export class Cart extends BaseComponent {
    constructor(container) {
        super(container);
        this.items = [];
        this.discount = 0;
        this.paymentMethod = 'cash';
    }

    render() {
        const subtotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const discountAmount = subtotal * (this.discount / 100);
        const total = subtotal - discountAmount;
        
        const hasItems = this.items.length > 0;

        return `
            <div class="cart">
                <div class="cart-header">
                    <h3>Корзина (${this.getTotalQuantity()} поз.)</h3>
                    ${hasItems ? '<button class="btn-clear" data-action="clear-cart">Очистить</button>' : ''}
                </div>
                
                <div class="cart-items">
                    ${this.items.map(item => this.renderCartItem(item)).join('')}
                    ${!hasItems ? '<div class="cart-empty">Корзина пуста</div>' : ''}
                </div>
                
                ${hasItems ? `
                    <div class="cart-summary">
                        <div class="summary-row">
                            <span>Сумма:</span>
                            <span>${this.formatMoney(subtotal)}</span>
                        </div>
                        
                        <div class="summary-row discount-row">
                            <span>Скидка:</span>
                            <div class="discount-input">
                                <input type="number" name="discount" value="${this.discount}" min="0" max="100" step="1">
                                <span>%</span>
                            </div>
                        </div>
                        
                        <div class="summary-row total-row">
                            <span>Итого:</span>
                            <span class="total-amount">${this.formatMoney(total)}</span>
                        </div>
                        
                        <div class="payment-methods">
                            <label class="payment-option ${this.paymentMethod === 'cash' ? 'active' : ''}">
                                <input type="radio" name="payment" value="cash" ${this.paymentMethod === 'cash' ? 'checked' : ''}>
                                Наличные
                            </label>
                            <label class="payment-option ${this.paymentMethod === 'card' ? 'active' : ''}">
                                <input type="radio" name="payment" value="card" ${this.paymentMethod === 'card' ? 'checked' : ''}>
                                Карта
                            </label>
                            <label class="payment-option ${this.paymentMethod === 'transfer' ? 'active' : ''}">
                                <input type="radio" name="payment" value="transfer" ${this.paymentMethod === 'transfer' ? 'checked' : ''}>
                                Перевод
                            </label>
                        </div>
                        
                        <button class="btn-checkout" data-action="checkout">
                            Продать (${this.formatMoney(total)})
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderCartItem(item) {
        return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <span class="cart-item-name">${item.name}</span>
                    ${item.size ? `<span class="cart-item-size">Размер: ${item.size}</span>` : ''}
                    <span class="cart-item-price">${this.formatMoney(item.price)} × ${item.quantity}</span>
                </div>
                <div class="cart-item-actions">
                    <span class="cart-item-total">${this.formatMoney(item.price * item.quantity)}</span>
                    <button class="btn-remove" data-action="remove-item" data-id="${item.id}">−</button>
                </div>
            </div>
        `;
    }

    attachEvents() {
        // Удаление одного товара
        this.element.querySelectorAll('[data-action="remove-item"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                this.removeItem(id);
            });
        });
        
        // Очистка корзины
        const clearBtn = this.element.querySelector('[data-action="clear-cart"]');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Очистить корзину?')) {
                    this.clear();
                }
            });
        }
        
        // Изменение скидки
        const discountInput = this.element.querySelector('[name="discount"]');
        if (discountInput) {
            discountInput.addEventListener('input', (e) => {
                this.discount = parseFloat(e.target.value) || 0;
                this.update();
            });
        }
        
        // Выбор способа оплаты
        this.element.querySelectorAll('[name="payment"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.paymentMethod = e.target.value;
                this.update();
            });
        });
        
        // Оформление продажи
        const checkoutBtn = this.element.querySelector('[data-action="checkout"]');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                const subtotal = this.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                const discountAmount = subtotal * (this.discount / 100);
                const total = subtotal - discountAmount;
                
                this.publish('cart:checkout', { 
                    items: this.items, 
                    total,
                    discount: this.discount,
                    paymentMethod: this.paymentMethod
                });
            });
        }
    }

    addItem(product) {
        if (product.status !== 'in_stock') {
            Notification.warning('Товар уже продан');
            return;
        }
        
        const existing = this.items.find(i => i.id === product.id);
        
        if (existing) {
            existing.quantity += 1;
        } else {
            this.items.push({ ...product, quantity: 1 });
        }
        
        Notification.info(`Добавлено: ${product.name}`);
        this.update();
        this.publish('cart:updated', this.items);
    }

    removeItem(id) {
        this.items = this.items.filter(i => i.id !== id);
        Notification.info('Товар удален из корзины');
        this.update();
        this.publish('cart:updated', this.items);
    }

    clear() {
        this.items = [];
        this.discount = 0;
        this.paymentMethod = 'cash';
        this.update();
        this.publish('cart:updated', this.items);
    }

    getTotalQuantity() {
        return this.items.reduce((sum, item) => sum + item.quantity, 0);
    }
}
