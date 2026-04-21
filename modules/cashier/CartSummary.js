/**
 * Cart Summary Component
 * 
 * Компонент итоговой суммы корзины с управлением общей скидкой.
 * 
 * @module CartSummary
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { formatMoney } from '../../utils/formatters.js';

const MAX_TOTAL_DISCOUNT = 50;
const QUICK_DISCOUNTS = [5, 10, 15, 20, 25];

export class CartSummary extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onTotalDiscountChange: null,
            onQuickDiscount: null,
            ...options
        };
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const subtotal = CashierState.getCartSubtotal();
        const itemsDiscount = CashierState.getCartItemsDiscountAmount();
        const totalDiscountAmount = CashierState.getCartTotalDiscountAmount();
        const totalDiscount = CashierState.get('cartTotalDiscount');
        const total = CashierState.getCartTotal();
        
        return `
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
                                max="${MAX_TOTAL_DISCOUNT}" 
                                step="1"
                            >
                            <span>%</span>
                        </div>
                        <div class="quick-discounts">
                            ${QUICK_DISCOUNTS.map(d => `
                                <button 
                                    class="btn-ghost btn-xs quick-discount" 
                                    data-discount="${d}"
                                >
                                    ${d}%
                                </button>
                            `).join('')}
                            ${totalDiscount > 0 ? `
                                <button 
                                    class="btn-ghost btn-xs" 
                                    data-ref="clearTotalDiscountBtn"
                                >
                                    Сбросить
                                </button>
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
                    <span class="total-amount" data-ref="totalAmount">${formatMoney(total)}</span>
                </div>
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Общая скидка
        const discountInput = this.refs.get('totalDiscountInput');
        if (discountInput) {
            discountInput.addEventListener('input', (e) => {
                let discount = parseFloat(e.target.value) || 0;
                discount = Math.min(discount, MAX_TOTAL_DISCOUNT);
                if (this.options.onTotalDiscountChange) {
                    this.options.onTotalDiscountChange(discount);
                }
            });
        }
        
        // Сброс скидки
        this.addDomListener('clearTotalDiscountBtn', 'click', () => {
            if (this.options.onTotalDiscountChange) {
                this.options.onTotalDiscountChange(0);
            }
        });
        
        // Быстрые скидки
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-discount]');
            if (btn) {
                const discount = parseFloat(btn.dataset.discount);
                if (this.options.onTotalDiscountChange) {
                    this.options.onTotalDiscountChange(discount);
                }
            }
        });
        
        // Подписка на состояние
        this.unsubscribeState = CashierState.subscribe((changes) => {
            const shouldUpdate = changes.some(c => 
                ['cartItems', 'cartTotalDiscount', 'cartItemDiscounts'].includes(c.key)
            );
            if (shouldUpdate) {
                this.update();
            }
        });
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
    }
}
