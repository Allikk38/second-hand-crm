// ========================================
// FILE: ./modules/cashier/Cart.js
// ========================================

/**
 * Cart Component
 * 
 * Отображает корзину товаров, управляет количеством, скидками и удалением.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Упрощенная структура без вложенных компонентов.
 * - Управление скидками через `Store.state.cashier`.
 * 
 * @module Cart
 * @version 5.0.1
 * @changes
 * - Исправлен импорт ConfirmDialog.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { formatMoney } from '../../utils/formatters.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';

const MAX_ITEM_DISCOUNT = 30;
const QUICK_DISCOUNTS = [5, 10, 15, 20, 25];

export class Cart extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onCheckout: null,
            ...options
        };
        
        this.unsubscribers = [];
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const items = cashier.cartItems || [];
        const totalDiscount = cashier.cartTotalDiscount || 0;
        
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const itemsDiscount = items.reduce((sum, item) => {
            const discount = cashier.cartItemDiscounts?.get(item.id) || 0;
            return sum + (item.price * item.quantity * discount / 100);
        }, 0);
        const subtotalAfterItems = subtotal - itemsDiscount;
        const totalDiscountAmount = subtotalAfterItems * totalDiscount / 100;
        const total = subtotal - itemsDiscount - totalDiscountAmount;

        return `
            <div class="cart-container">
                ${items.length === 0 ? this.renderEmpty() : `
                    <div class="cart-items">
                        ${items.map(item => this.renderCartItem(item, cashier.cartItemDiscounts)).join('')}
                    </div>
                    
                    <div class="cart-summary">
                        <div class="summary-row">
                            <span>Сумма без скидок:</span>
                            <span>${formatMoney(subtotal)}</span>
                        </div>
                        
                        ${itemsDiscount > 0 ? `
                            <div class="summary-row text-success">
                                <span>Скидка на товары:</span>
                                <span>−${formatMoney(itemsDiscount)}</span>
                            </div>
                        ` : ''}
                        
                        <div class="summary-row discount-row">
                            <span>Общая скидка:</span>
                            <div class="discount-control">
                                <div class="discount-input-wrapper">
                                    <input 
                                        type="number" 
                                        data-ref="totalDiscountInput"
                                        value="${totalDiscount}" 
                                        min="0" 
                                        max="50" 
                                        step="1"
                                    >
                                    <span>%</span>
                                </div>
                                <div class="quick-discounts">
                                    ${QUICK_DISCOUNTS.map(d => `
                                        <button class="quick-discount" data-discount="${d}">${d}%</button>
                                    `).join('')}
                                    ${totalDiscount > 0 ? `
                                        <button class="quick-discount" data-ref="clearTotalDiscountBtn">Сбросить</button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                        
                        ${totalDiscountAmount > 0 ? `
                            <div class="summary-row text-success">
                                <span>Сумма скидки:</span>
                                <span>−${formatMoney(totalDiscountAmount)}</span>
                            </div>
                        ` : ''}
                        
                        <div class="summary-row total-row">
                            <span>ИТОГО:</span>
                            <span class="total-amount">${formatMoney(total)}</span>
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    renderEmpty() {
        return `
            <div class="cart-empty">
                <div class="cart-empty-icon">🛒</div>
                <p>Корзина пуста</p>
                <p class="cart-hint">Нажмите на товар или отсканируйте штрихкод</p>
            </div>
        `;
    }

    renderCartItem(item, itemDiscounts) {
        const discount = itemDiscounts?.get(item.id) || 0;
        const originalPrice = item.price;
        const discountedPrice = discount > 0 ? originalPrice * (1 - discount / 100) : originalPrice;
        const itemTotal = discountedPrice * item.quantity;
        const savings = discount > 0 ? (originalPrice - discountedPrice) * item.quantity : 0;

        return `
            <div class="cart-item" data-id="${item.id}">
                <div class="cart-item-main">
                    <div class="cart-item-info">
                        <span class="cart-item-name">${this.escapeHtml(item.name)}</span>
                        <div class="cart-item-prices">
                            ${discount > 0 ? `
                                <span class="original-price">${formatMoney(originalPrice)}</span>
                                <span class="discounted-price">${formatMoney(discountedPrice)}</span>
                            ` : `
                                <span class="item-price">${formatMoney(originalPrice)}</span>
                            `}
                        </div>
                    </div>
                    
                    <div class="cart-item-actions">
                        <div class="quantity-control">
                            <button class="btn-qty" data-action="decrease" data-id="${item.id}">−</button>
                            <input 
                                type="number" 
                                class="qty-input" 
                                data-id="${item.id}"
                                value="${item.quantity}" 
                                min="1" 
                                max="999"
                                readonly
                            >
                            <button class="btn-qty" data-action="increase" data-id="${item.id}">+</button>
                        </div>
                        
                        <div class="item-total">${formatMoney(itemTotal)}</div>
                        
                        <button class="btn-remove" data-action="remove" data-id="${item.id}" title="Удалить">✕</button>
                    </div>
                </div>
                
                <div class="cart-item-discount">
                    <div class="discount-row">
                        <label>Скидка на товар:</label>
                        <div class="discount-input-group">
                            <input 
                                type="number" 
                                class="item-discount-input" 
                                data-id="${item.id}"
                                value="${discount}" 
                                min="0" 
                                max="${MAX_ITEM_DISCOUNT}" 
                                step="1"
                            >
                            <span>%</span>
                            ${discount > 0 ? `
                                <button class="btn-ghost btn-xs" data-action="clearItemDiscount" data-id="${item.id}">Сбросить</button>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${discount > 0 ? `
                        <div class="discount-info">
                            <span>Экономия: ${formatMoney(savings)}</span>
                            <span class="discount-badge">-${discount}%</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Делегирование событий
        this.container.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            
            switch (action) {
                case 'increase':
                    this.updateQuantity(id, 1);
                    break;
                case 'decrease':
                    this.updateQuantity(id, -1);
                    break;
                case 'remove':
                    await this.removeItem(id);
                    break;
                case 'clearItemDiscount':
                    this.setItemDiscount(id, 0);
                    break;
            }
        });
        
        // Быстрые скидки
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-discount]');
            if (btn) {
                const discount = parseFloat(btn.dataset.discount);
                this.setTotalDiscount(discount);
            }
        });
        
        // Изменение скидки товара
        this.container.addEventListener('change', (e) => {
            if (e.target.classList.contains('item-discount-input')) {
                const id = e.target.dataset.id;
                let discount = parseFloat(e.target.value) || 0;
                discount = Math.min(discount, MAX_ITEM_DISCOUNT);
                this.setItemDiscount(id, discount);
            }
            
            if (e.target.dataset.ref === 'totalDiscountInput') {
                let discount = parseFloat(e.target.value) || 0;
                discount = Math.min(discount, 50);
                this.setTotalDiscount(discount);
            }
        });
        
        // Кнопка сброса общей скидки
        this.addDomListener('clearTotalDiscountBtn', 'click', () => {
            this.setTotalDiscount(0);
        });
        
        // Подписка на изменения корзины в Store
        this.unsubscribers.push(
            Store.subscribe('cashier.cartItems', () => this.update()),
            Store.subscribe('cashier.cartTotalDiscount', () => this.update()),
            Store.subscribe('cashier.cartItemDiscounts', () => this.update())
        );
    }

    // ========== МЕТОДЫ УПРАВЛЕНИЯ ==========
    
    updateQuantity(id, delta) {
        const items = Store.state.cashier.cartItems;
        const item = items.find(i => i.id === id);
        if (!item) return;
        
        const newQuantity = Math.max(1, item.quantity + delta);
        if (item.quantity !== newQuantity) {
            item.quantity = newQuantity;
            Store.state.cashier.cartItems = [...items];
        }
    }

    async removeItem(id) {
        const items = Store.state.cashier.cartItems;
        const item = items.find(i => i.id === id);
        if (!item) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Удаление товара',
            message: `Удалить "${item.name}" из корзины?`,
            type: 'warning'
        });
        
        if (confirmed) {
            const newItems = items.filter(i => i.id !== id);
            Store.state.cashier.cartItems = newItems;
            
            // Удаляем скидку товара
            const discounts = Store.state.cashier.cartItemDiscounts;
            if (discounts?.has(id)) {
                discounts.delete(id);
                Store.state.cashier.cartItemDiscounts = new Map(discounts);
            }
        }
    }

    setItemDiscount(id, discount) {
        const discounts = Store.state.cashier.cartItemDiscounts || new Map();
        
        if (discount === 0) {
            discounts.delete(id);
        } else {
            discounts.set(id, Math.min(discount, MAX_ITEM_DISCOUNT));
        }
        
        Store.state.cashier.cartItemDiscounts = new Map(discounts);
    }

    setTotalDiscount(discount) {
        Store.state.cashier.cartTotalDiscount = Math.min(discount, 50);
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        this.unsubscribers = [];
    }
}
