import { SupabaseClient } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';

export const SaleService = {
    async create(shiftId, items, total, paymentMethod) {
        const { data, error } = await SupabaseClient
            .from('sales')
            .insert({
                shift_id: shiftId,
                items,
                total,
                payment_method: paymentMethod
            })
            .select()
            .single();
        
        if (error) throw error;
        
        // Обновляем статусы товаров на 'sold'
        for (const item of items) {
            await SupabaseClient
                .from('products')
                .update({ status: 'sold' })
                .eq('id', item.id);
        }
        
        EventBus.emit('sale:completed', data);
        return data;
    }
};
