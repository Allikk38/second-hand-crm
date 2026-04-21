// ========================================
// FILE: ./modules/cashier/PaymentModal.js
// ========================================

/**
 * Payment Modal Component
 * 
 * Модальное окно для приема оплаты.
 * Позволяет выбрать способ оплаты, ввести полученную сумму и рассчитать сдачу.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Замена старого `PaymentPanel` на полноценное модальное окно.
 * - Поддержка быстрых сумм для наличных.
 * 
 * @module PaymentModal
 * @version 5.0.0
 * @changes
 * - Создан на замену PaymentPanel.js.
 * - Добавлен расчет сдачи.
 * - Добавлены быстрые суммы.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { formatMoney } from '../../utils/formatters.js';

const PAYMENT_METHODS = [
    { value: 'cash', label: 'Наличные', icon: '💵' },
    { value: 'card', label: 'Карта', icon: '💳' },
    { value: 'transfer', label: 'Перевод', icon: '📱' }
];

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export class PaymentModal extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            total: 0,
            onConfirm: null,
            onCancel: null,
            ...options
        };
        
        this.selectedMethod = 'cash';
        this.receivedAmount = '';
        this.change = 0;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const total = this.options.total || 0;
        const received = parseFloat(this.receivedAmount) || 0;
        this.change = Math.max(0, received - total);

        return `
            <div class="modal-overlay" data-ref="overlay">
                <div class="modal payment-modal">
                    <div class="modal-header">
                        <h3>Оплата</h3>
                        <button class="btn-icon btn-close" data-ref="closeBtn">✕</button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="payment-details">
                            <div class="payment-amount-row">
                                <span class="payment-amount-label">Сумма к оплате:</span>
                                <span class="payment-amount-value">${formatMoney(total)}</span>
                            </div>
                            
                            <div class="payment-methods">
                                ${PAYMENT_METHODS.map(method => `
                                    <label class="payment-option ${this.selectedMethod === method.value ? 'active' : ''}">
                                        <input 
                                            type="radio" 
                                            name="paymentMethod" 
                                            value="${method.value}"
                                            data-ref="method_${method.value}"
                                            ${this.selectedMethod === method.value ? 'checked' : ''}
                                        >
                                        <span class="payment-icon">${method.icon}</span>
                                        <span>${method.label}</span>
                                    </label>
                                `).join('')}
                            </div>
                            
                            ${this.selectedMethod === 'cash' ? `
                                <div class="payment-input-row">
                                    <label>Получено от покупателя:</label>
                                    <input 
                                        type="number" 
                                        data-ref="receivedInput"
                                        class="payment-input"
                                        value="${this.receivedAmount}"
                                        placeholder="0"
                                        min="0"
                                        step="100"
                                        autofocus
                                    >
                                </div>
                                
                                <div class="quick-amounts">
                                    ${QUICK_AMOUNTS.map(amt => {
                                        const suggested = Math.ceil(total / amt) * amt;
                                        return `
                                            <button class="quick-amount-btn" data-amount="${suggested}">
                                                ${formatMoney(suggested)}
                                            </button>
                                        `;
                                    }).join('')}
                                </div>
                                
                                <div class="change-row">
                                    <span class="change-label">Сдача:</span>
                                    <span class="change-value">${formatMoney(this.change)}</span>
                                </div>
                            ` : `
                                <div class="payment-info-message">
                                    ${this.selectedMethod === 'card' ? 'Оплата банковской картой через терминал' : 'Оплата по QR-коду или СБП'}
                                </div>
                            `}
                        </div>
                    </div>
                    
                    <div class="modal-footer">
                        <div class="form-actions">
                            <button class="btn-secondary" data-ref="cancelBtn">Отмена</button>
                            <button class="btn-primary" data-ref="confirmBtn" ${this.selectedMethod === 'cash' && this.change < 0 ? 'disabled' : ''}>
                                Подтвердить оплату
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Закрытие
        this.addDomListener('closeBtn', 'click', () => this.handleCancel());
        this.addDomListener('cancelBtn', 'click', () => this.handleCancel());
        this.addDomListener('overlay', 'click', (e) => {
            if (e.target === this.refs.get('overlay')) {
                this.handleCancel();
            }
        });
        
        // Выбор способа оплаты
        PAYMENT_METHODS.forEach(method => {
            const radio = this.refs.get(`method_${method.value}`);
            if (radio) {
                radio.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.selectedMethod = method.value;
                        this.update();
                    }
                });
            }
        });
        
        // Ввод полученной суммы
        const receivedInput = this.refs.get('receivedInput');
        if (receivedInput) {
            receivedInput.addEventListener('input', (e) => {
                this.receivedAmount = e.target.value;
                this.update();
            });
        }
        
        // Быстрые суммы
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-amount]');
            if (btn) {
                const amount = parseFloat(btn.dataset.amount);
                this.receivedAmount = amount.toString();
                this.update();
            }
        });
        
        // Подтверждение
        this.addDomListener('confirmBtn', 'click', () => this.handleConfirm());
        
        // Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.handleCancel();
            }
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.handleConfirm();
            }
        });
    }

    // ========== ОБРАБОТЧИКИ ==========
    
    handleConfirm() {
        const total = this.options.total || 0;
        let received = total;
        
        if (this.selectedMethod === 'cash') {
            received = parseFloat(this.receivedAmount) || 0;
            if (received < total) {
                return; // Недостаточно средств
            }
        }
        
        if (this.options.onConfirm) {
            this.options.onConfirm(this.selectedMethod, received);
        }
        
        this.destroy();
    }

    handleCancel() {
        if (this.options.onCancel) {
            this.options.onCancel();
        }
        this.destroy();
    }

    // ========== ОЧИСТКА ==========
    
    destroy() {
        this.container.innerHTML = '';
        super.destroy();
    }
}
