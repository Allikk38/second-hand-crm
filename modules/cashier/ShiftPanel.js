// ========================================
// FILE: ./modules/cashier/ShiftPanel.js
// ========================================

/**
 * Shift Panel Component
 * 
 * Панель отображения статистики кассовой смены и кнопок управления.
 * 
 * Архитектурные решения:
 * - Dumb-компонент: только отображение и эмит событий.
 * - Бизнес-логика вынесена в `CashierApp` и `ShiftService`.
 * - Использует глобальный `Store` для чтения состояния.
 * - Эмитит события через `EventBus` для запросов открытия/закрытия.
 * - Поддерживает отображение офлайн-смен (is_local).
 * 
 * @module ShiftPanel
 * @version 6.0.0
 * @changes
 * - Полный рефакторинг: удалена бизнес-логика.
 * - Добавлено структурированное логирование.
 * - Компонент стал чисто презентационным.
 * - Добавлена поддержка пропсов загрузки из Store.
 * - Убрана работа с localStorage (перенесена в ShiftService).
 * - Добавлено отображение статуса офлайн-смены.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { EventBus } from '../../core/EventBus.js';
import { createLogger } from '../../utils/logger.js';
import { formatMoney, formatNumber } from '../../utils/formatters.js';

// ========== LOGGER ==========
const logger = createLogger('ShiftPanel');

export class ShiftPanel extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        
        this.options = {
            // Колбэки теперь не нужны, используем EventBus
            ...options
        };
        
        this.unsubscribers = [];
        
        logger.debug('ShiftPanel constructed');
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const currentShift = cashier.currentShift;
        const stats = cashier.shiftStats || { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 };
        
        // Проверяем глобальное состояние загрузки операций со сменой
        const isShiftActionPending = cashier.isShiftActionPending || false;
        
        const hasOpenShift = currentShift !== null;
        const isLocalShift = currentShift?.is_local || false;
        
        logger.debug('Rendering ShiftPanel', {
            hasOpenShift,
            isLocalShift,
            shiftId: currentShift?.id,
            isShiftActionPending,
            stats: {
                revenue: stats.revenue,
                salesCount: stats.salesCount
            }
        });

        return `
            <div class="shift-bar">
                <div class="shift-info">
                    <div class="shift-indicator ${hasOpenShift ? '' : 'closed'}">
                        <span class="indicator-dot ${isLocalShift ? 'local' : ''}"></span>
                        <span>
                            ${hasOpenShift 
                                ? (isLocalShift ? 'Смена открыта (офлайн)' : 'Смена открыта') 
                                : 'Смена закрыта'
                            }
                        </span>
                    </div>
                    ${hasOpenShift && currentShift ? `
                        <span class="shift-time">
                            ${new Date(currentShift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        ${isLocalShift ? `
                            <span class="shift-badge local" title="Смена создана офлайн, будет синхронизирована при подключении к сети">
                                📡 Ожидает синхронизации
                            </span>
                        ` : ''}
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
                        <button 
                            class="btn-secondary btn-sm" 
                            data-action="closeShift" 
                            ${isShiftActionPending ? 'disabled' : ''}
                            title="${isLocalShift ? 'Смена будет закрыта локально' : 'Закрыть смену и сформировать отчёт'}"
                        >
                            ${isShiftActionPending ? 'Закрытие...' : 'Закрыть смену'}
                        </button>
                    </div>
                ` : `
                    <div class="shift-actions">
                        <button 
                            class="btn-primary btn-sm" 
                            data-action="openShift" 
                            ${isShiftActionPending ? 'disabled' : ''}
                            title="Открыть новую кассовую смену"
                        >
                            ${isShiftActionPending ? 'Открытие...' : 'Открыть смену'}
                        </button>
                    </div>
                `}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        logger.debug('Attaching events');
        
        // Кнопки управления (делегирование)
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            
            logger.debug('Button clicked', { action });
            
            if (action === 'openShift') {
                this.emitOpenShiftRequest();
            } else if (action === 'closeShift') {
                this.emitCloseShiftRequest();
            }
        });
        
        // Подписка на изменения состояния в Store
        this.unsubscribers.push(
            Store.subscribe('cashier.currentShift', (change) => {
                logger.debug('Store changed: currentShift', { 
                    oldValue: change.oldValue?.id, 
                    newValue: change.newValue?.id 
                });
                this.update();
            }),
            
            Store.subscribe('cashier.shiftStats', (change) => {
                logger.debug('Store changed: shiftStats', { 
                    revenue: change.newValue?.revenue,
                    salesCount: change.newValue?.salesCount
                });
                this.update();
            }),
            
            Store.subscribe('cashier.isShiftActionPending', (change) => {
                logger.debug('Store changed: isShiftActionPending', { 
                    oldValue: change.oldValue, 
                    newValue: change.newValue 
                });
                this.update();
            })
        );
        
        // Подписка на события синхронизации (для отображения статуса)
        EventBus.on('shift:sync:started', () => {
            logger.debug('Shift sync started');
            // Можно показать индикатор синхронизации
        });
        
        EventBus.on('shift:sync:completed', (data) => {
            logger.debug('Shift sync completed', data);
            // Обновляем UI после синхронизации
            this.update();
        });
        
        EventBus.on('shift:sync:failed', (error) => {
            logger.warn('Shift sync failed', error);
            // Можно показать предупреждение
        });
    }
    
    // ========== ЭМИТ СОБЫТИЙ ==========
    
    /**
     * Эмитит запрос на открытие смены
     */
    emitOpenShiftRequest() {
        const currentShift = Store.state.cashier.currentShift;
        
        if (currentShift) {
            logger.warn('Open shift requested but shift already open', { shiftId: currentShift.id });
            return;
        }
        
        logger.info('Emitting shift:open-requested event');
        
        EventBus.emit('shift:open-requested', {
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Эмитит запрос на закрытие смены
     */
    emitCloseShiftRequest() {
        const currentShift = Store.state.cashier.currentShift;
        
        if (!currentShift) {
            logger.warn('Close shift requested but no shift open');
            return;
        }
        
        logger.info('Emitting shift:close-requested event', { 
            shiftId: currentShift.id,
            isLocal: currentShift.is_local || false
        });
        
        EventBus.emit('shift:close-requested', {
            shiftId: currentShift.id,
            isLocal: currentShift.is_local || false,
            currentStats: Store.state.cashier.shiftStats
        });
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    /**
     * Принудительно обновляет панель
     */
    refresh() {
        logger.debug('Manual refresh requested');
        this.update();
    }
    
    /**
     * Проверяет, открыта ли смена
     * @returns {boolean}
     */
    isShiftOpen() {
        return Store.state.cashier.currentShift !== null;
    }
    
    /**
     * Проверяет, является ли текущая смена локальной (офлайн)
     * @returns {boolean}
     */
    isLocalShift() {
        return Store.state.cashier.currentShift?.is_local || false;
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        logger.debug('Destroying ShiftPanel');
        
        this.unsubscribers.forEach(unsub => {
            try {
                unsub();
            } catch (error) {
                logger.warn('Error during unsubscribe', { error });
            }
        });
        this.unsubscribers = [];
    }
}

// Для отладки
if (typeof window !== 'undefined') {
    window.__ShiftPanel = ShiftPanel;
}

export default ShiftPanel;
