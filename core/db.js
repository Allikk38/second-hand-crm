// ========================================
// FILE: core/db.js
// ========================================

/**
 * Database Module - Supabase Backend
 * 
 * Прямое общение с Supabase REST API.
 * Замена sqlite-client.js для восстановления серверной работы.
 * 
 * @module db
 * @version 1.0.0
 */

import { createClient } from './supabase-client.js';

// Создаём единый инстанс клиента
const supabase = createClient(
    'https://bhdwniiyrrujeoubrvle.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM'
);

const log = (msg, data) => console.log(`[DB] ${msg}`, data || '');
const logError = (msg, err) => console.error(`[DB] ${msg}`, err?.message || err);

// ========== PRODUCTS API ==========

export const products = {
    /**
     * Получить все товары
     */
    async getAll(options = {}) {
        log('Fetching all products...');
        const startTime = Date.now();
        
        let query = supabase
            .from('products')
            .select('*');
        
        if (options.status) {
            query = query.eq('status', options.status);
        }
        
        // Сортировка по умолчанию
        query = query.order('created_at', { ascending: false });
        
        const { data, error } = await query;
        
        if (error) {
            logError('Failed to fetch products', error);
            throw error;
        }
        
        log(`Fetched ${data.length} products in ${Date.now() - startTime}ms`);
        return data;
    },

    /**
     * Получить товар по ID
     */
    async getById(id) {
        log(`Fetching product: ${id}`);
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', id)
            .single();
            
        if (error && error.code !== 'PGRST116') {
            logError(`Failed to fetch product ${id}`, error);
            throw error;
        }
        
        return data || null;
    },

    /**
     * Создать товар
     */
    async create(productData) {
        log('Creating product:', productData.name);
        const { data, error } = await supabase
            .from('products')
            .insert({
                name: productData.name,
                price: productData.price || 0,
                cost_price: productData.cost_price || 0,
                category: productData.category || 'other',
                status: 'in_stock',
                photo_url: productData.photo_url || null,
                created_by: productData.created_by,
                attributes: productData.attributes || {}
            })
            .select()
            .single();
            
        if (error) {
            logError('Failed to create product', error);
            throw error;
        }
        
        log(`Created product: ${data.id}`);
        return data;
    },

    /**
     * Обновить товар
     */
    async update(id, updates) {
        log(`Updating product: ${id}`);
        const { data, error } = await supabase
            .from('products')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
            
        if (error) {
            logError(`Failed to update product ${id}`, error);
            throw error;
        }
        
        log(`Updated product: ${data.id}`);
        return data;
    },

    /**
     * Удалить товар
     */
    async remove(id) {
        log(`Deleting product: ${id}`);
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);
            
        if (error) {
            logError(`Failed to delete product ${id}`, error);
            throw error;
        }
        
        log(`Deleted product: ${id}`);
        return true;
    }
};

// ========== SALES API ==========

export const sales = {
    /**
     * Получить все продажи (опционально фильтр по смене)
     */
    async getAll(shiftId = null) {
        log(`Fetching sales ${shiftId ? 'for shift: ' + shiftId : ''}`);
        let query = supabase
            .from('sales')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (shiftId) {
            query = query.eq('shift_id', shiftId);
        }
        
        const { data, error } = await query;
        
        if (error) {
            logError('Failed to fetch sales', error);
            throw error;
        }
        
        log(`Fetched ${data.length} sales`);
        return data;
    },

    /**
     * Создать продажу
     */
    async create(saleData) {
        log('Creating sale...');
        const { data, error } = await supabase
            .from('sales')
            .insert({
                shift_id: saleData.shift_id,
                items: saleData.items,
                total: saleData.total,
                profit: saleData.profit,
                payment_method: saleData.payment_method || 'cash',
                created_by: saleData.created_by
            })
            .select()
            .single();
            
        if (error) {
            logError('Failed to create sale', error);
            throw error;
        }
        
        log(`Created sale: ${data.id}`);
        return data;
    }
};

// ========== SHIFTS API ==========

export const shifts = {
    /**
     * Получить смены
     */
    async getAll() {
        log('Fetching all shifts...');
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .order('opened_at', { ascending: false });
            
        if (error) {
            logError('Failed to fetch shifts', error);
            throw error;
        }
        
        log(`Fetched ${data.length} shifts`);
        return data;
    },

    /**
     * Получить активную смену пользователя
     */
    async getActiveByUser(userId) {
        log(`Fetching active shift for user: ${userId}`);
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .single();
            
        if (error && error.code !== 'PGRST116') {
            logError('Failed to fetch active shift', error);
            throw error;
        }
        
        return data || null;
    },

    /**
     * Открыть смену
     */
    async open(userId) {
        log(`Opening shift for user: ${userId}`);
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
            
        if (error) {
            logError('Failed to open shift', error);
            throw error;
        }
        
        log(`Opened shift: ${data.id}`);
        return data;
    },

    /**
     * Закрыть смену
     */
    async close(shiftId, stats) {
        log(`Closing shift: ${shiftId}`, stats);
        const { data, error } = await supabase
            .from('shifts')
            .update({
                closed_at: new Date().toISOString(),
                final_cash: stats.revenue,
                total_revenue: stats.revenue,
                total_profit: stats.profit,
                sales_count: stats.salesCount,
                items_count: stats.itemsCount,
                status: 'closed'
            })
            .eq('id', shiftId)
            .select()
            .single();
            
        if (error) {
            logError('Failed to close shift', error);
            throw error;
        }
        
        log(`Closed shift: ${data.id}`);
        return data;
    }
};

// ========== STORAGE API ==========

export const storage = supabase.storage;

// Экспорт по умолчанию
export default {
    products,
    sales,
    shifts,
    storage
};

console.log('[DB] Module loaded');
