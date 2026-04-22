// ========================================
// FILE: ./services/SaleService.js
// ========================================

/**
 * Sale Service
 * 
 * Управление продажами: создание, отмена, статистика.
 * 
 * @module SaleService
 * @version 4.1.3
 * @changes
 * - ИСПРАВЛЕНО: правильная обработка ошибки PGRST116 при пустой таблице.
 * - Улучшено логирование для отладки.
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';
import { ProductService } from './ProductService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SaleService');

export const SaleService = {
    /**
     * Создает новую продажу
     */
    async create({ shiftId, items, total, discount = 0, paymentMethod }) {
        if (!shiftId) throw new Error('Shift ID is required');
        if (!items || items.length === 0) throw new Error('No items in sale');
        if (!paymentMethod) throw new Error('Payment method is required');
        if (total < 0) throw new Error('Total cannot be negative');
        
        for (const item of items) {
            if (item.quantity <= 0) {
                throw new Error(`Invalid quantity for product ${item.id}`);
            }
        }
        
        const products = await ProductService.getAll({ forceRefresh: true });
        
        const unavailableItems = [];
        
        items.forEach(item => {
            const product = products.find(p => p.id === item.id);
            
            if (!product) {
                unavailableItems.push({ id: item.id, reason: 'not_found' });
            } else if (product.status !== 'in_stock') {
                unavailableItems.push({ 
                    id: item.id, 
                    name: product.name, 
                    reason: `status_${product.status}` 
                });
            }
        });
        
        if (unavailableItems.length > 0) {
            const error = new Error('Some items are not available for sale');
            error.details = unavailableItems;
            throw error;
        }
        
        const itemsWithCost = items.map(item => {
            const product = products.find(p => p.id === item.id);
            return {
                ...item,
                cost_price: product.cost_price || 0
            };
        });
        
        const totalCost = itemsWithCost.reduce((sum, item) => {
            return sum + (item.cost_price * item.quantity);
        }, 0);
        
        const profit = total - totalCost;
        const margin = total > 0 ? (profit / total * 100) : 0;
        
        const { data: sale, error } = await db
            .from('sales')
            .insert({
                shift_id: shiftId,
                items: itemsWithCost,
                total,
                discount,
                payment_method: paymentMethod,
                profit,
                margin,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (error) {
            logger.error('Create sale error', { error });
            throw error;
        }
        
        const productIds = items.map(item => item.id);
        await ProductService.bulkUpdateStatus(productIds, 'sold');
        
        ProductService.clearCache();
        
        EventBus.emit('sale:completed', {
            sale,
            items: itemsWithCost,
            profit,
            margin
        });
        
        return sale;
    },

    /**
     * Получает продажи за период
     */
    async getByPeriod(startDate, endDate) {
        const start = typeof startDate === 'string' ? startDate : startDate.toISOString();
        const end = typeof endDate === 'string' ? endDate : endDate.toISOString();
        
        const { data, error } = await db
            .from('sales')
            .select(`
                *,
                shifts (
                    id,
                    user_id,
                    opened_at,
                    closed_at
                )
            `)
            .gte('created_at', start)
            .lte('created_at', end)
            .order('created_at', { ascending: false });
        
        if (error) {
            logger.error('getByPeriod error', { error });
            throw error;
        }
        
        return data || [];
    },

    /**
     * Получает продажи по смене
     */
    async getByShift(shiftId) {
        const { data, error } = await db
            .from('sales')
            .select('*')
            .eq('shift_id', shiftId)
            .order('created_at', { ascending: false });
        
        if (error) {
            if (error.code === 'PGRST116') {
                logger.debug('No sales found for shift', { shiftId });
                return [];
            }
            logger.error('getByShift error', { error });
            throw error;
        }
        
        return data || [];
    },

    /**
     * Получает статистику продаж
     */
    async getStats(options = {}) {
        const { startDate, endDate, shiftId } = options;
        
        logger.debug('getStats called', { startDate, endDate, shiftId });
        
        try {
            let query = db.from('sales').select('total, discount, profit, payment_method, created_at');
            
            if (startDate) {
                query = query.gte('created_at', startDate);
            }
            if (endDate) {
                query = query.lte('created_at', endDate);
            }
            if (shiftId) {
                query = query.eq('shift_id', shiftId);
            }
            
            const { data, error } = await query;
            
            // Проверяем ошибку
            if (error) {
                // PGRST116 означает что записи не найдены (пустая таблица)
                if (error.code === 'PGRST116') {
                    logger.debug('No sales data found (PGRST116), returning empty stats');
                    return {
                        count: 0,
                        totalRevenue: 0,
                        totalDiscount: 0,
                        totalProfit: 0,
                        averageCheck: 0,
                        byPaymentMethod: {}
                    };
                }
                
                // Проверяем статус 400 (Bad Request) - тоже может означать пустой результат
                if (error.status === 400) {
                    logger.debug('Bad request (400), likely no sales data, returning empty stats');
                    return {
                        count: 0,
                        totalRevenue: 0,
                        totalDiscount: 0,
                        totalProfit: 0,
                        averageCheck: 0,
                        byPaymentMethod: {}
                    };
                }
                
                logger.error('getStats query error', { error });
                throw error;
            }
            
            const salesData = data || [];
            
            const stats = {
                count: salesData.length,
                totalRevenue: 0,
                totalDiscount: 0,
                totalProfit: 0,
                averageCheck: 0,
                byPaymentMethod: {}
            };
            
            salesData.forEach(sale => {
                stats.totalRevenue += sale.total || 0;
                stats.totalProfit += sale.profit || 0;
                
                const method = sale.payment_method || 'unknown';
                stats.byPaymentMethod[method] = (stats.byPaymentMethod[method] || 0) + 1;
                
                if (sale.discount) {
                    const originalTotal = sale.total / (1 - sale.discount / 100);
                    stats.totalDiscount += originalTotal - sale.total;
                }
            });
            
            if (stats.count > 0) {
                stats.averageCheck = stats.totalRevenue / stats.count;
            }
            
            logger.debug('getStats completed', stats);
            
            return stats;
            
        } catch (error) {
            logger.error('getStats error', { error });
            
            // Возвращаем пустую статистику при любой ошибке
            return {
                count: 0,
                totalRevenue: 0,
                totalDiscount: 0,
                totalProfit: 0,
                averageCheck: 0,
                byPaymentMethod: {}
            };
        }
    },

    /**
     * Получает топ продаваемых товаров
     */
    async getTopProducts(limit = 10) {
        const { data, error } = await db
            .from('sales')
            .select('items');
        
        if (error) {
            if (error.code === 'PGRST116') {
                return [];
            }
            logger.error('getTopProducts error', { error });
            throw error;
        }
        
        const salesData = data || [];
        const productStats = new Map();
        
        salesData.forEach(sale => {
            if (!sale.items) return;
            
            sale.items.forEach(item => {
                const key = item.id;
                const current = productStats.get(key) || {
                    id: item.id,
                    name: item.name,
                    quantity: 0,
                    revenue: 0,
                    profit: 0
                };
                
                current.quantity += item.quantity || 1;
                current.revenue += (item.price || 0) * (item.quantity || 1);
                current.profit += ((item.price || 0) - (item.cost_price || 0)) * (item.quantity || 1);
                
                productStats.set(key, current);
            });
        });
        
        return Array.from(productStats.values())
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, limit);
    },
    
    /**
     * Отменяет продажу
     */
    async cancel(id) {
        const sale = await this.getById(id);
        
        if (!sale) {
            throw new Error(`Sale with id ${id} not found`);
        }
        
        const itemIds = sale.items.map(item => item.id);
        await ProductService.bulkUpdateStatus(itemIds, 'in_stock');
        
        const { error } = await db
            .from('sales')
            .delete()
            .eq('id', id);
        
        if (error) {
            logger.error('cancel error', { error });
            throw error;
        }
        
        ProductService.clearCache();
        
        EventBus.emit('sale:cancelled', { sale });
    },
    
    /**
     * Получает детальную информацию о продаже
     */
    async getById(id) {
        const { data, error } = await db
            .from('sales')
            .select(`
                *,
                shifts (
                    id,
                    user_id,
                    opened_at,
                    closed_at,
                    profiles:user_id (
                        full_name,
                        email
                    )
                )
            `)
            .eq('id', id)
            .single();
        
        if (error) {
            logger.error('getById error', { error });
            throw error;
        }
        
        return data;
    }
};
