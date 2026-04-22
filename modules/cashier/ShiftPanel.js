// ========================================
// FILE: ./modules/cashier/ShiftPanel.js
// ========================================

/**
 * Shift Panel Component
 * 
 * Панель управления кассовой сменой.
 * Отображает статистику и предоставляет кнопки открытия/закрытия смены.
 * Поддерживает офлайн-режим при недоступности сервера.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Офлайн-режим: сохранение смены в localStorage.
 * - Автоматическая синхронизация при восстановлении сети.
 * 
 * @module ShiftPanel
 * @version 5.0.1
 * @changes
 * - Добавлена обработка ошибок сети.
 * - Добавлен офлайн-режим открытия смены.
 * - Улучшены уведомления.
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
        this.isOpeningShift = false;
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
                        <button class="btn-secondary btn-sm" data-action="closeShift" ${this.isOpeningShift ? 'disabled' : ''}>
                            Закрыть смену
                        </button>
                    </div>
                ` : `
                    <div class="shift-actions">
                        <button class="btn-primary btn-sm" data-action="openShift" ${this.isOpeningShift ? 'disabled' : ''}>
                            ${this.isOpeningShift ? 'Открытие...' : 'Открыть смену'}
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
        
        // Подписка на восстановление сети
        window.addEventListener('online', () => this.handleOnline());
    }
    
    // ========== ОБРАБОТЧИКИ СМЕНЫ ==========
    
    async handleOpenShift() {
        if (this.isOpeningShift) return;
        
        this.isOpeningShift = true;
        this.update();
        
        try {
            let shift = null;
            
            // Проверяем соединение с сервером
            const isOnline = navigator.onLine;
            
            if (isOnline) {
                try {
                    // Пытаемся открыть смену на сервере
                    shift = await ShiftService.openShift(this.user.id);
                    console.log('[ShiftPanel] Shift opened on server:', shift.id);
                } catch (error) {
                    console.warn('[ShiftPanel] Server shift open failed:', error);
                    
                    // Если ошибка не критичная (например, таймаут), создаем локальную смену
                    if (error.message?.includes('timeout') || error.message?.includes('network') || error.message?.includes('fetch')) {
                        Notification.warning('Сервер недоступен. Смена открыта локально.');
                        shift = this.createLocalShift();
                    } else {
                        throw error;
                    }
                }
            } else {
                // Офлайн - создаем локальную смену
                Notification.info('Работа в офлайн-режиме. Смена открыта локально.');
                shift = this.createLocalShift();
            }
            
            if (!shift) {
                shift = this.createLocalShift();
            }
            
            // Сохраняем смену в Store
            Store.state.cashier.currentShift = shift;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            
            // Сохраняем в localStorage для восстановления
            this.saveShiftToStorage(shift);
            
            Notification.success('Смена успешно открыта');
            
            if (this.options.onShiftOpened) {
                this.options.onShiftOpened(shift);
            }
            
        } catch (error) {
            console.error('[ShiftPanel] Open shift error:', error);
            
            let errorMessage = 'Ошибка при открытии смены';
            if (error.message?.includes('already has an open shift')) {
                errorMessage = 'У вас уже есть открытая смена';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            Notification.error(errorMessage);
        } finally {
            this.isOpeningShift = false;
            this.update();
        }
    }
    
    /**
     * Создает локальную смену для офлайн-режима
     */
    createLocalShift() {
        const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return {
            id: localId,
            user_id: this.user.id,
            opened_at: new Date().toISOString(),
            initial_cash: 0,
            status: 'active',
            is_local: true, // Флаг локальной смены
            created_at: new Date().toISOString()
        };
    }
    
    /**
     * Сохраняет смену в localStorage
     */
    saveShiftToStorage(shift) {
        try {
            const shifts = JSON.parse(localStorage.getItem('cashier_shifts') || '[]');
            shifts.push(shift);
            localStorage.setItem('cashier_shifts', JSON.stringify(shifts));
        } catch (error) {
            console.warn('[ShiftPanel] Failed to save shift to storage:', error);
        }
    }
    
    /**
     * Обработчик восстановления сети
     */
    async handleOnline() {
        const currentShift = Store.state.cashier.currentShift;
        
        // Если есть локальная смена, пытаемся синхронизировать
        if (currentShift?.is_local) {
            console.log('[ShiftPanel] Online detected, syncing local shift...');
            
            try {
                // Пытаемся создать смену на сервере
                const serverShift = await ShiftService.openShift(this.user.id);
                
                // Обновляем ID смены в Store
                Store.state.cashier.currentShift = {
                    ...serverShift,
                    local_id: currentShift.id // Сохраняем связь с локальной
                };
                
                // Обновляем в localStorage
                this.updateShiftInStorage(currentShift.id, serverShift);
                
                Notification.success('Смена синхронизирована с сервером');
            } catch (error) {
                console.warn('[ShiftPanel] Failed to sync shift:', error);
                Notification.warning('Не удалось синхронизировать смену. Продолжайте работу.');
            }
        }
    }
    
    /**
     * Обновляет смену в localStorage
     */
    updateShiftInStorage(localId, serverShift) {
        try {
            const shifts = JSON.parse(localStorage.getItem('cashier_shifts') || '[]');
            const index = shifts.findIndex(s => s.id === localId);
            
            if (index !== -1) {
                shifts[index] = { ...shifts[index], ...serverShift, is_local: false, synced_at: new Date().toISOString() };
                localStorage.setItem('cashier_shifts', JSON.stringify(shifts));
            }
        } catch (error) {
            console.warn('[ShiftPanel] Failed to update shift in storage:', error);
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
            const currentShift = Store.state.cashier.currentShift;
            
            let result = null;
            
            // Если смена локальная или нет сети
            if (currentShift?.is_local || !navigator.onLine) {
                // Закрываем локально
                result = {
                    id: shiftId,
                    total_revenue: Store.state.cashier.shiftStats.revenue,
                    total_profit: Store.state.cashier.shiftStats.profit,
                    sales_count: Store.state.cashier.shiftStats.salesCount,
                    closed_at: new Date().toISOString(),
                    is_local: true
                };
                
                // Сохраняем в архив
                this.archiveLocalShift(currentShift, result);
                
                Notification.warning('Смена закрыта локально. Данные будут отправлены при восстановлении сети.');
            } else {
                // Закрываем на сервере
                result = await ShiftService.closeShift(shiftId);
            }
            
            // Очищаем состояние
            Store.state.cashier.currentShift = null;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            Notification.success(`Смена закрыта. Выручка: ${formatMoney(result.total_revenue || 0)}`);
            
            if (this.options.onShiftClosed) {
                this.options.onShiftClosed(result);
            }
        } catch (error) {
            console.error('[ShiftPanel] Close shift error:', error);
            Notification.error('Ошибка при закрытии смены: ' + (error.message || 'Неизвестная ошибка'));
        }
    }
    
    /**
     * Архивирует локальную смену
     */
    archiveLocalShift(shift, result) {
        try {
            const archive = JSON.parse(localStorage.getItem('cashier_shifts_archive') || '[]');
            archive.push({
                ...shift,
                ...result,
                archived_at: new Date().toISOString()
            });
            localStorage.setItem('cashier_shifts_archive', JSON.stringify(archive));
            
            // Удаляем из активных
            const shifts = JSON.parse(localStorage.getItem('cashier_shifts') || '[]');
            const filtered = shifts.filter(s => s.id !== shift.id);
            localStorage.setItem('cashier_shifts', JSON.stringify(filtered));
        } catch (error) {
            console.warn('[ShiftPanel] Failed to archive shift:', error);
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        this.unsubscribers = [];
        window.removeEventListener('online', () => this.handleOnline());
    }
}
