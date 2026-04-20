import { SupabaseClient } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';

export const ShiftService = {
    async getCurrentShift(userId) {
        const { data, error } = await SupabaseClient
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .is('closed_at', null)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    async openShift(userId) {
        const { data, error } = await SupabaseClient
            .from('shifts')
            .insert({ user_id: userId })
            .select()
            .single();
        
        if (error) throw error;
        EventBus.emit('shift:opened', data);
        return data;
    },

    async closeShift(shiftId, finalCash) {
        const { data, error } = await SupabaseClient
            .from('shifts')
            .update({ closed_at: new Date(), final_cash: finalCash })
            .eq('id', shiftId)
            .select()
            .single();
        
        if (error) throw error;
        EventBus.emit('shift:closed', data);
        return data;
    }
};
