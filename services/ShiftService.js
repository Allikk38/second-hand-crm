/**
 * Shift Service
 * 
 * Управление кассовыми сменами: открытие, закрытие, статистика.
 * 
 * @module ShiftService
 * @version 4.1.0
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';
import { SaleService } from './SaleService.js';

// Кэш текущей смены
let currentShiftCache = new Map();
const CACHE_TTL = 30000;

function isCacheValid(timestamp) {
    return timestamp > 0 && (Date.now() - timestamp) < CACHE_TTL;
}

function invalidateShiftCache(userId) {
    if (userId) {
        currentShiftCache.delete(userId);
    } else {
        currentShiftCache.clear();
    }
}

export const ShiftService = {
    /**
     * Получает текущую открытую смену пользователя
     */
    async getCurrentShift(userId, forceRefresh = false) {
        if (!userId) {
            throw new Error('User ID is required');
        }
        
        const cached = currentShiftCache.get(userId);
        if (!forceRefresh && cached && isCacheValid(cached.timestamp)) {
            return cached.data;
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
        
        const shift = data || null;
        
        currentShiftCache.set(userId, {
            data: shift,
            timestamp: Date.now()
        });
        
        return shift;
    },

    /**
     * Проверяет, есть ли у пользователя открытая смена
     */
    async hasOpenShift(userId) {
        const shift = await this.getCurrentShift(userId);
        return shift !== null;
    },

    /**
     * Открывает новую смену
     */
    async openShift(userId, options = {}) {
        if (!userId) {
            throw new Error('User ID is required');
        }
        
        const existingShift = await this.getCurrentShift(userId);
        if (existingShift) {
            throw new Error('User already has an open shift');
        }
        
        const { initialCash = 0, notes = '' } = options;
        const now = new Date().toISOString();
        
        const { data, error } = await db
            .from('shifts')
            .insert({
                user_id: userId,
                opened_at: now,
                initial_cash: initialCash,
                notes,
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
        EventBus.emit('shift:opened', { shift: data, userId });
        
        return data;
    },

    /**
     * Закрывает смену
     */
    async closeShift(shiftId, options = {}) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
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
        
        const salesStats = await SaleService.getStats({ shiftId });
        const sales = await SaleService.getByShift(shiftId);
        
        const expectedCash = (shift.initial_cash || 0) + salesStats.totalRevenue;
        const { finalCash = expectedCash, notes = '' } = options;
        const now = new Date().toISOString();
        const discrepancy = finalCash - expectedCash;
        
        const { data, error } = await db
            .from('shifts')
            .update({
                closed_at: now,
                final_cash: finalCash,
                expected_cash: expectedCash,
                discrepancy,
                notes: shift.notes + (notes ? '\n' + notes : ''),
                sales_count: salesStats.count,
                total_revenue: salesStats.totalRevenue,
                total_profit: salesStats.totalProfit,
                status: 'closed',
                updated_at: now
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
            sales
        });
        
        return data;
    },

    /**
     * Получает все открытые смены
     */
    async getActiveShifts() {
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
            console.error('[ShiftService] getActiveShifts error:', error);
            throw error;
        }
        
        return data || [];
    },

    /**
     * Получает историю смен пользователя
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
        
        return data || [];
    },

    /**
     * Получает детальную информацию о смене
     */
    async getShiftDetails(shiftId) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
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
        
        const sales = await SaleService.getByShift(shiftId);
        
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
     * Получает сводную статистику по сменам
     */
    async getOverallStats(options = {}) {
        const { startDate, endDate, userId } = options;
        
        let query = db
            .from('shifts')
            .select('total_revenue, total_profit, sales_count, discrepancy')
            .not('closed_at', 'is', null);
        
        if (startDate) {
            const start = typeof startDate === 'string' ? startDate : startDate.toISOString();
            query = query.gte('opened_at', start);
        }
        if (endDate) {
            const end = typeof endDate === 'string' ? endDate : endDate.toISOString();
            query = query.lte('closed_at', end);
        }
        if (userId) {
            query = query.eq('user_id', userId);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[ShiftService] getOverallStats error:', error);
            throw error;
        }
        
        const shiftsData = data || [];
        
        const stats = {
            totalShifts: shiftsData.length,
            totalRevenue: 0,
            totalProfit: 0,
            totalSales: 0,
            totalDiscrepancy: 0,
            averageRevenue: 0,
            averageProfit: 0
        };
        
        shiftsData.forEach(shift => {
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
     * Получает текущую статистику по открытой смене
     */
    async getCurrentShiftStats(shiftId) {
        if (!shiftId) {
            throw new Error('Shift ID is required');
        }
        
        const { data: shift, error: shiftError } = await db
            .from('shifts')
            .select('*')
            .eq('id', shiftId)
            .single();
        
        if (shiftError) {
            console.error('[ShiftService] getCurrentShiftStats error:', shiftError);
            throw shiftError;
        }
        
        const salesStats = await SaleService.getStats({ shiftId });
        
        const expectedCash = (shift.initial_cash || 0) + salesStats.totalRevenue;
        
        return {
            shiftId,
            openedAt: shift.opened_at,
            duration: Date.now() - new Date(shift.opened_at).getTime(),
            initialCash: shift.initial_cash || 0,
            salesCount: salesStats.count,
            totalRevenue: salesStats.totalRevenue,
            totalProfit: salesStats.totalProfit,
            expectedCash,
            averageCheck: salesStats.averageCheck,
            paymentMethods: salesStats.byPaymentMethod
        };
    },

    /**
     * Очищает кэш смен
     */
    clearCache() {
        invalidateShiftCache();
        console.log('[ShiftService] Cache cleared');
    }
};
