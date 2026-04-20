/**
 * Сервис отчетов и аналитики
 * 
 * @module ReportService
 */

import { SupabaseClient } from '../core/SupabaseClient.js';

export const ReportService = {
    async getSalesByPeriod(startDate, endDate) {
        const { data, error } = await SupabaseClient
            .from('sales')
            .select(`
                *,
                shifts(user_id)
            `)
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        return data;
    },

    async getSalesByCategory() {
        const { data: products } = await SupabaseClient
            .from('products')
            .select('category')
            .eq('status', 'sold');
        
        const stats = {};
        products?.forEach(p => {
            const cat = p.category || 'other';
            stats[cat] = (stats[cat] || 0) + 1;
        });
        
        return stats;
    },

    async getSalesBySeller() {
        const { data, error } = await SupabaseClient
            .from('sales')
            .select(`
                total,
                shifts!inner(user_id)
            `);
        
        if (error) throw error;
        
        const stats = {};
        data?.forEach(sale => {
            const userId = sale.shifts.user_id;
            stats[userId] = (stats[userId] || 0) + sale.total;
        });
        
        return stats;
    },

    async getTotalStats() {
        const { data: products } = await SupabaseClient
            .from('products')
            .select('status, price, cost_price');
        
        const { data: sales } = await SupabaseClient
            .from('sales')
            .select('total');
        
        const inStock = products?.filter(p => p.status === 'in_stock').length || 0;
        const sold = products?.filter(p => p.status === 'sold').length || 0;
        const totalRevenue = sales?.reduce((sum, s) => sum + s.total, 0) || 0;
        const inventoryValue = products?.filter(p => p.status === 'in_stock')
            .reduce((sum, p) => sum + p.price, 0) || 0;
        
        const soldProducts = products?.filter(p => p.status === 'sold') || [];
        const totalCost = soldProducts.reduce((sum, p) => sum + (p.cost_price || 0), 0);
        const totalProfit = totalRevenue - totalCost;
        
        return { 
            inStock, 
            sold, 
            totalRevenue, 
            inventoryValue,
            totalCost,
            totalProfit
        };
    }
};
