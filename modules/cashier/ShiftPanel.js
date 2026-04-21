// ========================================
// FILE: ./modules/cashier/ShiftPanel.js
// ========================================

/**
 * Shift Panel Component
 * 
 * Панель управления кассовой сменой.
 * Отображает статистику и предоставляет кнопки открытия/закрытия смены.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Удалена зависимость от `CashierState`.
 * - Добавлены обработчики открытия/закрытия смены.
 * 
 * @module ShiftPanel
 * @version 5.0.0
 * @changes
 * - Удалена зависимость от `CashierState`.
 * - Подключение к `Store.state.cashier`.
 * - Добавлены кнопки управления сменой.
 * - Обновлен дизайн.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { ShiftService } from '../../services/ShiftService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { formatMoney, formatNumber } from '../../utils/formatters.js';

export class ShiftPanel extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            onShiftOpened: null,
            onShiftClosed: null,
            ...options
        };
        
        this.user = AuthManager.getUser();
        this.unsubscribers = [];
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const currentShift = cashier.currentShift;
        const stats = cashier.shiftStats || { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 };
        
        const hasOpenShift = currentShift !== null;

        return `
            <div class="shift-bar">
                <div class="shift-info">
                    <div class="shift-indicator ${hasOpenShift ? '' : 'closed'}">
                        <span class="indicator-dot"></span>
                        <span>${hasOpenShift ? 'Смена открыта' : 'Смена закрыта'}</span>
                    </div>
                    ${hasOpenShift && currentShift ? `
                        <span class="shift-time">
                            ${new Date(currentShift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    ` : ''}
                </div>
                
                ${hasOpenShift ? `
                    <div class="shift-stats">
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
                            <span class="stat-value ${stats.profit >= 0 ? 'positive' : 'negative'}">
                                ${formatMoney(stats.profit)}
                            </span>
                        </div>
                    </div>
                    
                    <div class="shift-actions">
                        <button class="btn-secondary btn-sm" data-action="closeShift">
                            Закрыть смену
                        </button>
                    </div>
                ` : `
                    <div class="shift-actions">
                        <button class="btn-primary btn-sm" data-action="openShift">
                            Открыть смену
                        </button>
                    </div>
                `}
            </div>
        `;
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Кнопки управления
        this.container.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            
            if (action === 'openShift') {
                await this.handleOpenShift();
            } else if (action === 'closeShift') {
                await this.handleCloseShift();
            }
        });
        
        // Подписка на изменения смены и статистики
        this.unsubscribers.push(
            Store.subscribe('cashier.currentShift', () => this.update()),
            Store.subscribe('cashier.shiftStats', () => this.update())
        );
    }

    // ========== ОБРАБОТЧИКИ СМЕНЫ ==========
    
    async handleOpenShift() {
        try {
            const shift = await ShiftService.openShift(this.user.id);
            
            Store.state.cashier.currentShift = shift;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            
            Notification.success('Смена успешно открыта');
            
            if (this.options.onShiftOpened) {
                this.options.onShiftOpened(shift);
            }
        } catch (error) {
            console.error('[ShiftPanel] Open shift error:', error);
            Notification.error('Ошибка при открытии смены');
        }
    }

    async handleCloseShift() {
        const shiftId = Store.getShiftId();
        if (!shiftId) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Закрытие смены',
            message: 'Вы уверены, что хотите закрыть смену? Будет сформирован итоговый отчет.',
            confirmText: 'Закрыть смену',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (!confirmed) return;
        
        try {
            const result = await ShiftService.closeShift(shiftId);
            
            Store.state.cashier.currentShift = null;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            Notification.success(`Смена закрыта. Выручка: ${formatMoney(result.total_revenue)}`);
            
            if (this.options.onShiftClosed) {
                this.options.onShiftClosed(result);
            }
        } catch (error) {
            console.error('[ShiftPanel] Close shift error:', error);
            Notification.error('Ошибка при закрытии смены');
        }
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        this.unsubscribers = [];
    }
}
