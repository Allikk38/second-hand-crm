/**
 * Cart Item Component
 * 
 * Компонент строки товара в корзине.
 * Управление количеством, скидкой и удалением.
 * 
 * @module CartItem
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { formatMoney } from '../../utils/formatters.js';

const MAX_ITEM_DISCOUNT = 30;

export class CartItem extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            item: null,
            onQuantityChange: null,
            onRemove: null,
            onDiscountChange: null,
            ...options
        };
        this.item = options.item;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const item = this.item;
        const itemDiscount = item.discount || 0;
        const originalPrice = item.price;
        const discountedPrice = itemDiscount > 0 
            ? originalPrice * (1 - itemDiscount / 100) 
            : originalPrice;
        const itemTotal = discountedPrice * item.quantity;
        const savings = itemDiscount > 0 
            ? (originalPrice - discountedPrice) * item.quantity 
            : 0;
        
        const stockWarning = item.quantity >= (item.maxStock || Infinity) * 0.8;
        const isMaxReached = item.quantity >= (item.maxStock || Infinity);
        
        return `
            <div class="cart-item ${stockWarning ? 'stock-warning' : ''}" data-id="${item.id}">
                <div class="cart-item-main">
                    <div class="cart-item-info">
                        <span class="cart-item-name">${this.escapeHtml(item.name)}</span>
                        ${item.size ? `
                            <span class="cart-item-size">Размер: ${item.size}</span>
                        ` : ''}
                        <div class="cart-item-prices">
                            ${itemDiscount > 0 ? `
                                <span class="original-price">${formatMoney(originalPrice)}</span>
                                <span class="discounted-price">${formatMoney(discountedPrice)}</span>
                            ` : `
                                <span class="item-price">${formatMoney(originalPrice)}</span>
                            `}
                        </div>
                    </div>
                    
                    <div class="cart-item-actions">
                        <div class="quantity-control">
                            <button 
                                class="btn-icon btn-qty" 
                                data-action="decrease" 
                                data-id="${item.id}"
                                ${item.quantity <= 1 ? 'disabled' : ''}
                            >
                                −
                            </button>
                            <input 
                                type="number" 
                                class="qty-input" 
                                data-id="${item.id}"
                                data-ref="qtyInput"
                                value="${item.quantity}" 
                                min="1" 
                                max="${item.maxStock || 999}"
                                step="1"
                            >
                            <button 
                                class="btn-icon btn-qty" 
                                data-action="increase" 
                                data-id="${item.id}"
                                ${isMaxReached ? 'disabled' : ''}
                            >
                                +
                            </button>
                        </div>
                        
                        <div class="item-total">
                            ${formatMoney(itemTotal)}
                        </div>
                        
                        <button 
                            class="btn-icon btn-remove" 
                            data-action="remove" 
                            data-id="${item.id}"
                            title="Удалить"
                        >
                            ✕
                        </button>
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
                                data-ref="discountInput"
                                value="${itemDiscount}" 
                                min="0" 
                                max="${MAX_ITEM_DISCOUNT}" 
                                step="1"
                            >
                            <span>%</span>
                            ${itemDiscount > 0 ? `
                                <button 
                                    class="btn-ghost btn-xs" 
                                    data-action="clearDiscount" 
                                    data-id="${item.id}"
                                >
                                    Сбросить
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${itemDiscount > 0 ? `
                        <div class="discount-info">
                            <span>Экономия: ${formatMoney(savings)}</span>
                            <span class="discount-badge">-${itemDiscount}%</span>
                        </div>
                    ` : ''}
                    
                    ${stockWarning ? `
                        <div class="stock-warning-message">
                            ⚠ Осталось всего ${item.maxStock - item.quantity} шт.
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            
            if (action === 'increase') {
                if (this.options.onQuantityChange) {
                    this.options.onQuantityChange(id, this.item.quantity + 1);
                }
            } else if (action === 'decrease') {
                if (this.options.onQuantityChange) {
                    this.options.onQuantityChange(id, this.item.quantity - 1);
                }
            } else if (action === 'remove') {
                if (this.options.onRemove) {
                    this.options.onRemove(id);
                }
            } else if (action === 'clearDiscount') {
                if (this.options.onDiscountChange) {
                    this.options.onDiscountChange(id, 0);
                }
            }
        });
        
        // Изменение количества через input
        const qtyInput = this.refs.get('qtyInput');
        if (qtyInput) {
            qtyInput.addEventListener('change', (e) => {
                const quantity = parseInt(e.target.value) || 1;
                if (this.options.onQuantityChange) {
                    this.options.onQuantityChange(this.item.id, quantity);
                }
            });
        }
        
        // Изменение скидки
        const discountInput = this.refs.get('discountInput');
        if (discountInput) {
            discountInput.addEventListener('change', (e) => {
                let discount = parseFloat(e.target.value) || 0;
                discount = Math.min(discount, MAX_ITEM_DISCOUNT);
                if (this.options.onDiscountChange) {
                    this.options.onDiscountChange(this.item.id, discount);
                }
            });
        }
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    updateItem(item) {
        this.item = item;
        this.update();
    }
}
