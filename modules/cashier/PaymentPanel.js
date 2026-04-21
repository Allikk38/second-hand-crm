/**
 * Payment Panel Component
 * 
 * Компонент выбора способа оплаты и кнопки оформления продажи.
 * 
 * @module PaymentPanel
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { formatMoney } from '../../utils/formatters.js';

const PAYMENT_METHODS = [
    { value: 'cash', label: 'Наличные', icon: '💵' },
    { value: 'card', label: 'Карта', icon: '💳' },
    { value: 'transfer', label: 'Перевод', icon: '📱' }
];

export class PaymentPanel extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onPaymentMethodChange: null,
            onCheckout: null,
            ...options
        };
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = CashierState.getState();
        const paymentMethod = state.cartPaymentMethod;
        const total = CashierState.getCartTotal();
        
        return `
            <div class="payment-section">
                <div class="payment-methods">
                    ${PAYMENT_METHODS.map(method => `
                        <label class="payment-option ${paymentMethod === method.value ? 'active' : ''}">
                            <input 
                                type="radio" 
                                name="payment" 
                                value="${method.value}" 
                                data-ref="payment_${method.value}"
                                ${paymentMethod === method.value ? 'checked' : ''}
                            >
                            <span class="payment-icon">${method.icon}</span>
                            <span>${method.label}</span>
                        </label>
                    `).join('')}
                </div>
                
                <button class="btn-checkout" data-ref="checkoutBtn">
                    💰 Продать (${formatMoney(total)})
                </button>
                
                <div class="keyboard-hints">
                    <small>Alt+C — очистить | Alt+Enter — продать</small>
                </div>
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Выбор способа оплаты
        PAYMENT_METHODS.forEach(method => {
            const radio = this.refs.get(`payment_${method.value}`);
            if (radio) {
                radio.addEventListener('change', (e) => {
                    if (e.target.checked && this.options.onPaymentMethodChange) {
                        this.options.onPaymentMethodChange(method.value);
                    }
                });
            }
        });
        
        // Кнопка оформления
        this.addDomListener('checkoutBtn', 'click', () => {
            if (this.options.onCheckout) {
                this.options.onCheckout();
            }
        });
        
        // Подписка на состояние
        this.unsubscribeState = CashierState.subscribe((changes) => {
            const shouldUpdate = changes.some(c => 
                ['cartPaymentMethod', 'cartItems', 'cartTotalDiscount', 'cartItemDiscounts'].includes(c.key)
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
