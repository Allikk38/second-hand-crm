/**
 * Shift Panel Component
 * 
 * Панель отображения статистики текущей смены.
 * Показывает выручку, количество продаж, средний чек и прибыль.
 * 
 * @module ShiftPanel
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { formatMoney, formatNumber } from '../../utils/formatters.js';

export class ShiftPanel extends BaseComponent {
    constructor(container) {
        super(container);
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = CashierState.getState();
        const stats = state.shiftStats;
        const currentShift = state.currentShift;
        
        return `
            <div class="shift-stats-panel">
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Выручка</span>
                        <span class="stat-value">${formatMoney(stats.revenue)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Продаж</span>
                        <span class="stat-value">${formatNumber(stats.salesCount)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Средний чек</span>
                        <span class="stat-value">${formatMoney(stats.averageCheck)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Прибыль</span>
                        <span class="stat-value ${stats.profit >= 0 ? 'text-success' : 'text-danger'}">
                            ${formatMoney(stats.profit)}
                        </span>
                    </div>
                </div>
                ${currentShift ? `
                    <div class="shift-time">
                        <span>Смена открыта: ${new Date(currentShift.opened_at).toLocaleTimeString()}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        this.unsubscribeState = CashierState.subscribe((changes) => {
            const shouldUpdate = changes.some(c => 
                c.key === 'shiftStats' || c.key === 'currentShift'
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
