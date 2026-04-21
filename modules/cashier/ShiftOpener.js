/**
 * Shift Opener Component
 * 
 * Компонент управления открытием/закрытием смены.
 * 
 * @module ShiftOpener
 * @version 1.1.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { ShiftService } from '../../services/ShiftService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';

export class ShiftOpener extends BaseComponent {
    constructor(container) {
        super(container);
        this.unsubscribeState = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = CashierState.getState();
        const currentShift = state.currentShift;
        
        if (currentShift) {
            return `
                <div class="shift-status shift-open">
                    <span class="shift-indicator">🟢</span>
                    <span class="shift-text">Смена открыта (${new Date(currentShift.opened_at).toLocaleTimeString()})</span>
                    <button class="btn-secondary btn-sm" data-action="close-shift">
                        Закрыть смену
                    </button>
                </div>
            `;
        }
        
        return `
            <div class="shift-status shift-closed">
                <span class="shift-indicator">🔴</span>
                <span class="shift-text">Смена закрыта</span>
                <button class="btn-primary btn-sm" data-action="open-shift">
                    Открыть смену
                </button>
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        this.container.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            
            if (action === 'open-shift') {
                await this.handleOpenShift();
            } else if (action === 'close-shift') {
                await this.handleCloseShift();
            }
        });
        
        this.unsubscribeState = CashierState.subscribe((changes) => {
            if (changes.some(c => c.key === 'currentShift')) {
                this.update();
            }
        });
        
        this.subscribe('shift:opened', () => this.update());
        this.subscribe('shift:closed', () => this.update());
    }
    
    // ========== ОБРАБОТЧИКИ ==========
    
    async handleOpenShift() {
        try {
            const user = AuthManager.getUser();
            const shift = await ShiftService.openShift(user.id);
            CashierState.set('currentShift', shift);
            Notification.success('Смена успешно открыта');
        } catch (error) {
            console.error('[ShiftOpener] Open error:', error);
            Notification.error('Ошибка при открытии смены');
        }
    }
    
    async handleCloseShift() {
        const state = CashierState.getState();
        const shiftId = state.currentShift?.id;
        
        if (!shiftId) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Закрытие смены',
            message: 'Вы уверены, что хотите закрыть смену?',
            confirmText: 'Закрыть',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (!confirmed) return;
        
        try {
            await ShiftService.closeShift(shiftId);
            CashierState.set('currentShift', null);
            CashierState.reset();
            Notification.success('Смена успешно закрыта');
        } catch (error) {
            console.error('[ShiftOpener] Close error:', error);
            Notification.error('Ошибка при закрытии смены');
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
    }
}
