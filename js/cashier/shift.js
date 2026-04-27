// ========================================
// FILE: js/cashier/shift.js
// ========================================

/**
 * Shift Module - Cashier
 * 
 * Управление сменой кассового модуля.
 * Отвечает за открытие/закрытие смены, загрузку статистики,
 * кэширование данных смены и интеграцию с Supabase.
 * 
 * @module cashier/shift
 * @version 1.0.2
 * @changes
 * - v1.0.2: Убран неиспользуемый импорт getSupabase из auth.js.
 * - v1.0.1: getSupabase() теперь с await (официальный SDK)
 */

import { getSupabase } from '../../core/auth.js';
import { showConfirmDialog } from '../../utils/ui.js';

const SHIFT_STORAGE_KEY = 'sh_cashier_shift';
const SHIFT_CACHE_TTL = 24 * 60 * 60 * 1000;

export const shiftState = {
    currentShift: null,
    stats: {
        revenue: 0,
        salesCount: 0,
        profit: 0,
        itemsCount: 0
    },
    isActionPending: false
};

let onChangeCallback = null;

export function setShiftChangeCallback(callback) {
    onChangeCallback = callback;
}

function notifyShiftChanged() {
    if (onChangeCallback) onChangeCallback();
}

export function isShiftOpen() {
    return !!shiftState.currentShift;
}

export function getCurrentShiftId() {
    return shiftState.currentShift?.id || null;
}

export function saveShiftToCache() {
    if (shiftState.currentShift) {
        try {
            localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify({
                ...shiftState.currentShift,
                stats: shiftState.stats,
                cachedAt: Date.now()
            }));
        } catch (e) {
            console.warn('[Shift] Failed to cache shift:', e);
        }
    }
}

export function loadShiftFromCache() {
    try {
        const cached = localStorage.getItem(SHIFT_STORAGE_KEY);
        if (cached) {
            const shift = JSON.parse(cached);
            if (Date.now() - shift.cachedAt < SHIFT_CACHE_TTL) {
                shiftState.currentShift = {
                    id: shift.id,
                    user_id: shift.user_id,
                    opened_at: shift.opened_at,
                    status: shift.status
                };
                shiftState.stats = shift.stats || shiftState.stats;
                notifyShiftChanged();
                return true;
            } else {
                localStorage.removeItem(SHIFT_STORAGE_KEY);
            }
        }
    } catch (e) {
        console.warn('[Shift] Failed to load cached shift:', e);
    }
    return false;
}

export function clearShiftCache() {
    try {
        localStorage.removeItem(SHIFT_STORAGE_KEY);
    } catch (e) {
        console.warn('[Shift] Failed to clear shift cache:', e);
    }
}

export async function loadShiftStats() {
    if (!shiftState.currentShift) return false;
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('sales')
            .select('total, profit, items')
            .eq('shift_id', shiftState.currentShift.id);
        
        if (error) throw error;
        
        const sales = data || [];
        
        shiftState.stats = {
            revenue: sales.reduce((sum, s) => sum + (s.total || 0), 0),
            salesCount: sales.length,
            profit: sales.reduce((sum, s) => sum + (s.profit || 0), 0),
            itemsCount: sales.reduce((sum, s) => {
                return sum + (s.items?.reduce((s2, i) => s2 + (i.quantity || 0), 0) || 0);
            }, 0)
        };
        
        saveShiftToCache();
        notifyShiftChanged();
        return true;
        
    } catch (error) {
        console.error('[Shift] Load stats error:', error);
        return false;
    }
}

export async function checkOpenShift(userId) {
    if (!userId) return false;
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
            shiftState.currentShift = data;
            await loadShiftStats();
            saveShiftToCache();
            notifyShiftChanged();
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('[Shift] Check shift error:', error);
        return false;
    }
}

export async function openShift(userId) {
    if (shiftState.isActionPending) return false;
    if (!userId) {
        console.error('[Shift] Cannot open shift: no user ID');
        return false;
    }
    
    shiftState.isActionPending = true;
    notifyShiftChanged();
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('shifts')
            .insert({
                user_id: userId,
                opened_at: new Date().toISOString(),
                initial_cash: 0,
                status: 'active'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        shiftState.currentShift = data;
        shiftState.stats = { revenue: 0, salesCount: 0, profit: 0, itemsCount: 0 };
        
        saveShiftToCache();
        notifyShiftChanged();
        return true;
        
    } catch (error) {
        console.error('[Shift] Open shift error:', error);
        return false;
    } finally {
        shiftState.isActionPending = false;
        notifyShiftChanged();
    }
}

export async function closeShift() {
    if (!shiftState.currentShift || shiftState.isActionPending) return false;
    
    // Импортируем formatMoney динамически чтобы избежать циклической зависимости
    const { formatMoney } = await import('../../utils/formatters.js');
    
    const confirmed = await showConfirmDialog({
        title: 'Закрытие смены',
        message: `Выручка: ${formatMoney(shiftState.stats.revenue)}\nПродаж: ${shiftState.stats.salesCount}\nПрибыль: ${formatMoney(shiftState.stats.profit)}\n\nВы уверены, что хотите закрыть смену?`,
        confirmText: 'Закрыть смену',
        confirmClass: 'btn-primary'
    });
    
    if (!confirmed) return false;
    
    shiftState.isActionPending = true;
    notifyShiftChanged();
    
    try {
        const supabase = await getSupabase();
        const { error } = await supabase
            .from('shifts')
            .update({
                closed_at: new Date().toISOString(),
                final_cash: shiftState.stats.revenue,
                total_revenue: shiftState.stats.revenue,
                total_profit: shiftState.stats.profit,
                sales_count: shiftState.stats.salesCount,
                items_count: shiftState.stats.itemsCount,
                status: 'closed'
            })
            .eq('id', shiftState.currentShift.id);
        
        if (error) throw error;
        
        shiftState.currentShift = null;
        shiftState.stats = { revenue: 0, salesCount: 0, profit: 0, itemsCount: 0 };
        
        clearShiftCache();
        notifyShiftChanged();
        return true;
        
    } catch (error) {
        console.error('[Shift] Close shift error:', error);
        return false;
    } finally {
        shiftState.isActionPending = false;
        notifyShiftChanged();
    }
}

export default {
    shiftState,
    setShiftChangeCallback,
    isShiftOpen,
    getCurrentShiftId,
    saveShiftToCache,
    loadShiftFromCache,
    clearShiftCache,
    checkOpenShift,
    loadShiftStats,
    openShift,
    closeShift
};
