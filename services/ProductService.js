import { SupabaseClient } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';

export const ProductService = {
    async getAll() {
        const { data, error } = await SupabaseClient
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        return data;
    },

    async getById(id) {
        const { data, error } = await SupabaseClient
            .from('products')
            .select('*')
            .eq('id', id)
            .single();
        
        if (error) throw error;
        return data;
    },

    async create(product) {
        const { data, error } = await SupabaseClient
            .from('products')
            .insert(product)
            .select()
            .single();
        
        if (error) throw error;
        EventBus.emit('product:created', data);
        return data;
    },

    async update(id, updates) {
        const { data, error } = await SupabaseClient
            .from('products')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        EventBus.emit('product:updated', data);
        return data;
    },

    async delete(id) {
        const { error } = await SupabaseClient
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        EventBus.emit('product:deleted', { id });
    }
};
