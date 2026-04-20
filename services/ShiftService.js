/**
 * Shift Service
 * 
 * Управление кассовыми сменами: открытие, закрытие, статистика.
 * 
 * Архитектурные решения:
 * - Атомарные операции открытия/закрытия смены
 * - Автоматический подсчет статистики при закрытии
 * - Валидация состояния перед закрытием
 * - Кэширование текущей смены для быстрого доступа
 * - Публикация событий с полным контекстом для аудита
 * 
 * @module ShiftService
 * @requires db
 * @requires EventBus
 * @requires SaleService
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';
import { SaleService } from './SaleService.js';

// ========== КЭШ ТЕКУЩЕЙ СМЕНЫ ==========
let currentShiftCache = new Map(); // userId -> shift

/**
 * Инвалидирует кэш смены для пользователя
 * @param {string} userId - ID пользователя
 */
function invalidateShiftCache(userId) {
    if (userId) {
        currentShiftCache.delete(userId);
    } else {
        currentShiftCache.clear();
    }
}

// ========== SERVICE ==========
export const ShiftService = {
    /**
     * Получает текущую открытую смену пользователя
     * @param {string} userId - ID пользователя
     * @param {boolean} forceRefresh - Игнорировать кэш
     * @returns {Promise<Object|null>}
     */
    async getCurrentShift(userId, forceRefresh = false) {
        if (!userId) {
            throw new Error('User ID is required');
        }
        
        if (!forceRefresh && currentShiftCache.has(userId)) {
            const cached = currentShiftCache.get(userId);
            // Проверяем, не устарел ли кэш (5 минут)
            if (Date.now() - cached.timestamp < 300000) {
                return cached.data;
            }
        }
        
        const { data, error } = await db
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.error('[ShiftService] getCurrentShift error:', error);
            throw error;
        }
        
        currentShiftCache.set(userId, {
            data: data || null,
            timestamp: Date.now()
        });
        
        return data || null;
    },

    /**
     * Проверяет, есть ли у пользователя открытая смена
     * @param {string} userId - ID пользователя
     * @returns {Promise<boolean>}
     */
    async hasOpenShift(userId) {
        const shift = await this.getCurrentShift(userId);
        return shift !== null;
    },

    /**
     * Открывает новую смену
     * @param {string} userId - ID пользователя
     * @param {Object} options - Дополнительные опции
     * @param {number} options.initialCash - Начальный остаток в кассе
     * @returns {Promise<Object>}
     */
    async openShift(userId, options = {}) {
        if (!userId) {
            throw new Error('User ID is required');
        }
        
        // Проверяем, нет ли уже открытой смены
        const existingShift = await this.getCurrentShift(userId);
        if (existingShift) {
            throw new Error('User already has an open shift');
        }
        
        const { initialCash = 0 } = options;
        const now = new Date().toISOString();
        
        const { data, error } = await db
            .from('shifts')
            .insert({
                user_id: userId,
                opened_at: now,
                initial_cash: initialCash,
                status: 'active',
                created_at: now,
                updated_at: now
            })
            .select()
            .single();
        
        if (error) {
            console.error('[ShiftService] openShift error:', error);
            throw error;
        }
        
        invalidateShiftCache(userId);
        
        EventBus.emit('shift:opened', {
            shift: data,
            userId,
            source: 'ShiftService.openShift'
        });
        
        return data;
    },

    /**
     * Закрывает смену
     * @param {string} shiftId - ID смены
     * @param {Object} options - Опции закрытия
     * @param {number} options.finalCash - Конечный остаток в кассе
     * @param {string} options.notes - Заметки к смене
     * @returns {Promise<Object>}
     */
    async closeShift(shiftId, options = {}) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
        // Получаем смену
        const { data: shift, error: fetchError } = await db
            .from('shifts')
            .select('*')
            .eq('id', shiftId)
            .single();
        
        if (fetchError) {
            console.error('[ShiftService] closeShift fetch error:', fetchError);
            throw fetchError;
        }
        
        if (shift.closed_at) {
            throw new Error('Shift is already closed');
        }
        
        // Получаем статистику продаж за смену
        const salesStats = await SaleService.getStats({ shiftId });
        
        // Получаем список продаж для детализации
        const sales = await SaleService.getByShift(shiftId);
        
        // Рассчитываем ожидаемый остаток в кассе
        const expectedCash = (shift.initial_cash || 0) + salesStats.totalRevenue;
        
        const { finalCash = expectedCash, notes = '' } = options;
        const now = new Date().toISOString();
        
        // Рассчитываем расхождение
        const discrepancy = finalCash - expectedCash;
        
        const { data, error } = await db
            .from('shifts')
            .update({
                closed_at: now,
                final_cash: finalCash,
                expected_cash: expectedCash,
                discrepancy,
                notes,
                sales_count: salesStats.count,
                total_revenue: salesStats.totalRevenue,
                total_profit: salesStats.totalProfit,
                status: 'closed',
                updated_at: now,
                closed_by: shift.user_id // Можно добавить audit trail
            })
            .eq('id', shiftId)
            .select()
            .single();
        
        if (error) {
            console.error('[ShiftService] closeShift error:', error);
            throw error;
        }
        
        invalidateShiftCache(shift.user_id);
        
        EventBus.emit('shift:closed', {
            shift: data,
            stats: {
                salesCount: salesStats.count,
                revenue: salesStats.totalRevenue,
                profit: salesStats.totalProfit,
                expectedCash,
                finalCash,
                discrepancy
            },
            sales,
            source: 'ShiftService.closeShift'
        });
        
        // Если есть расхождение, публикуем отдельное событие для аудита
        if (Math.abs(discrepancy) > 0.01) {
            EventBus.emit('shift:discrepancy', {
                shiftId,
                expected: expectedCash,
                actual: finalCash,
                difference: discrepancy,
                source: 'ShiftService.closeShift'
            });
        }
        
        return data;
    },

    /**
     * Получает историю смен пользователя
     * @param {string} userId - ID пользователя
     * @param {Object} options - Опции пагинации
     * @returns {Promise<Array>}
     */
    async getUserHistory(userId, options = {}) {
        if (!userId) {
            throw new Error('User ID is required');
        }
        
        const { limit = 50, offset = 0, includeOpen = false } = options;
        
        let query = db
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .order('opened_at', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (!includeOpen) {
            query = query.not('closed_at', 'is', null);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[ShiftService] getUserHistory error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Получает детальную информацию о смене
     * @param {string} shiftId - ID смены
     * @returns {Promise<Object>}
     */
    async getShiftDetails(shiftId) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
        // Получаем смену
        const { data: shift, error: shiftError } = await db
            .from('shifts')
            .select(`
                *,
                profiles:user_id (
                    full_name,
                    email
                )
            `)
            .eq('id', shiftId)
            .single();
        
        if (shiftError) {
            console.error('[ShiftService] getShiftDetails error:', shiftError);
            throw shiftError;
        }
        
        // Получаем продажи за смену
        const sales = await SaleService.getByShift(shiftId);
        
        // Группируем продажи по способам оплаты
        const paymentBreakdown = {};
        sales.forEach(sale => {
            const method = sale.payment_method || 'unknown';
            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + sale.total;
        });
        
        return {
            ...shift,
            sales,
            salesCount: sales.length,
            paymentBreakdown
        };
    },

    /**
     * Получает все открытые смены (для администратора)
     * @returns {Promise<Array>}
     */
    async getAllOpenShifts() {
        const { data, error } = await db
            .from('shifts')
            .select(`
                *,
                profiles:user_id (
                    full_name,
                    email
                )
            `)
            .is('closed_at', null)
            .order('opened_at', { ascending: false });
        
        if (error) {
            console.error('[ShiftService] getAllOpenShifts error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Получает сводную статистику по сменам
     * @param {Object} options - Опции фильтрации
     * @returns {Promise<Object>}
     */
    async getOverallStats(options = {}) {
        const { startDate, endDate, userId } = options;
        
        let query = db
            .from('shifts')
            .select('total_revenue, total_profit, sales_count, discrepancy')
            .not('closed_at', 'is', null);
        
        if (startDate) query = query.gte('opened_at', startDate);
        if (endDate) query = query.lte('closed_at', endDate);
        if (userId) query = query.eq('user_id', userId);
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[ShiftService] getOverallStats error:', error);
            throw error;
        }
        
        const stats = {
            totalShifts: data.length,
            totalRevenue: 0,
            totalProfit: 0,
            totalSales: 0,
            totalDiscrepancy: 0,
            averageRevenue: 0,
            averageProfit: 0
        };
        
        data.forEach(shift => {
            stats.totalRevenue += shift.total_revenue || 0;
            stats.totalProfit += shift.total_profit || 0;
            stats.totalSales += shift.sales_count || 0;
            stats.totalDiscrepancy += Math.abs(shift.discrepancy || 0);
        });
        
        if (stats.totalShifts > 0) {
            stats.averageRevenue = stats.totalRevenue / stats.totalShifts;
            stats.averageProfit = stats.totalProfit / stats.totalShifts;
        }
        
        return stats;
    },

    /**
     * Принудительно закрывает смену (административная функция)
     * @param {string} shiftId - ID смены
     * @param {string} reason - Причина принудительного закрытия
     * @returns {Promise<Object>}
     */
    async forceCloseShift(shiftId, reason) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
        if (!reason) {
            throw new Error('Reason is required for force close');
        }
        
        const now = new Date().toISOString();
        
        const { data, error } = await db
            .from('shifts')
            .update({
                closed_at: now,
                status: 'force_closed',
                notes: `FORCE CLOSED: ${reason}`,
                updated_at: now
            })
            .eq('id', shiftId)
            .select()
            .single();
        
        if (error) {
            console.error('[ShiftService] forceCloseShift error:', error);
            throw error;
        }
        
        invalidateShiftCache(data.user_id);
        
        EventBus.emit('shift:force-closed', {
            shift: data,
            reason,
            source: 'ShiftService.forceCloseShift'
        });
        
        return data;
    },

    /**
     * Обновляет заметки к смене
     * @param {string} shiftId - ID смены
     * @param {string} notes - Новые заметки
     * @returns {Promise<Object>}
     */
    async updateNotes(shiftId, notes) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
        const { data, error } = await db
            .from('shifts')
            .update({
                notes,
                updated_at: new Date().toISOString()
            })
            .eq('id', shiftId)
            .select()
            .single();
        
        if (error) {
            console.error('[ShiftService] updateNotes error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Получает текущую статистику по открытой смене
     * @param {string} shiftId - ID смены
     * @returns {Promise<Object>}
     */
    async getCurrentShiftStats(shiftId) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
        const [shift, salesStats] = await Promise.all([
            db.from('shifts').select('*').eq('id', shiftId).single(),
            SaleService.getStats({ shiftId })
        ]);
        
        if (shift.error) {
            console.error('[ShiftService] getCurrentShiftStats error:', shift.error);
            throw shift.error;
        }
        
        const expectedCash = (shift.data.initial_cash || 0) + salesStats.totalRevenue;
        
        return {
            shiftId,
            openedAt: shift.data.opened_at,
            duration: Date.now() - new Date(shift.data.opened_at).getTime(),
            initialCash: shift.data.initial_cash || 0,
            salesCount: salesStats.count,
            totalRevenue: salesStats.totalRevenue,
            totalProfit: salesStats.totalProfit,
            expectedCash,
            averageCheck: salesStats.averageCheck,
            paymentMethods: salesStats.byPaymentMethod
        };
    },

    /**
     * Очищает кэш смен (полезно при разлогине)
     */
    clearCache() {
        invalidateShiftCache();
        console.log('[ShiftService] Cache cleared');
    }
};
