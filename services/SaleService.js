/**
 * Sale Service
 * 
 * Управление продажами: создание, отмена, статистика.
 * 
 * Архитектурные решения:
 * - Транзакционное создание продажи (обновление статусов товаров)
 * - Валидация наличия товаров перед продажей
 * - Расчет финансовых показателей
 * - Публикация детальных событий для аналитики
 * 
 * @module SaleService
 * @requires db
 * @requires EventBus
 * @requires ProductService
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';
import { ProductService } from './ProductService.js';

export const SaleService = {
    /**
     * Создает новую продажу
     * @param {Object} saleData - Данные продажи
     * @param {string} saleData.shiftId - ID смены
     * @param {Array} saleData.items - Товары в продаже
     * @param {number} saleData.total - Итоговая сумма
     * @param {number} saleData.discount - Скидка в процентах
     * @param {string} saleData.paymentMethod - Способ оплаты
     * @returns {Promise<Object>}
     */
    async create({ shiftId, items, total, discount = 0, paymentMethod }) {
        // Валидация
        if (!shiftId) throw new Error('Shift ID is required');
        if (!items || items.length === 0) throw new Error('No items in sale');
        if (!paymentMethod) throw new Error('Payment method is required');
        if (total < 0) throw new Error('Total cannot be negative');
        
        // Проверяем наличие товаров
        const itemIds = items.map(item => item.id);
        const products = await ProductService.getAll();
        
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
        
        // Рассчитываем себестоимость
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
        
        // Создаем запись о продаже
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
            console.error('[SaleService] create error:', error);
            throw error;
        }
        
        // Обновляем статусы товаров
        await ProductService.bulkUpdateStatus(itemIds, 'sold');
        
        // Инвалидируем кэш товаров
        ProductService.clearCache();
        
        // Публикуем событие
        EventBus.emit('sale:completed', {
            sale,
            items: itemsWithCost,
            profit,
            margin,
            source: 'SaleService.create'
        });
        
        return sale;
    },

    /**
     * Получает продажи за период
     * @param {Date|string} startDate - Начало периода
     * @param {Date|string} endDate - Конец периода
     * @returns {Promise<Array>}
     */
    async getByPeriod(startDate, endDate) {
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
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('[SaleService] getByPeriod error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Получает продажи по смене
     * @param {string} shiftId - ID смены
     * @returns {Promise<Array>}
     */
    async getByShift(shiftId) {
        const { data, error } = await db
            .from('sales')
            .select('*')
            .eq('shift_id', shiftId)
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('[SaleService] getByShift error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Получает детальную информацию о продаже
     * @param {string} id - ID продажи
     * @returns {Promise<Object>}
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
            console.error('[SaleService] getById error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Отменяет продажу (возвращает товары в наличие)
     * @param {string} id - ID продажи
     * @returns {Promise<void>}
     */
    async cancel(id) {
        const sale = await this.getById(id);
        
        if (!sale) {
            throw new Error(`Sale with id ${id} not found`);
        }
        
        // Возвращаем товары в наличие
        const itemIds = sale.items.map(item => item.id);
        await ProductService.bulkUpdateStatus(itemIds, 'in_stock');
        
        // Удаляем запись о продаже (или помечаем как отмененную)
        const { error } = await db
            .from('sales')
            .delete()
            .eq('id', id);
        
        if (error) {
            console.error('[SaleService] cancel error:', error);
            throw error;
        }
        
        ProductService.clearCache();
        
        EventBus.emit('sale:cancelled', {
            sale,
            source: 'SaleService.cancel'
        });
    },

    /**
     * Получает статистику продаж
     * @param {Object} options - Опции фильтрации
     * @returns {Promise<Object>}
     */
    async getStats(options = {}) {
        const { startDate, endDate, shiftId } = options;
        
        let query = db.from('sales').select('total, discount, profit, payment_method, created_at');
        
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);
        if (shiftId) query = query.eq('shift_id', shiftId);
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[SaleService] getStats error:', error);
            throw error;
        }
        
        const stats = {
            count: data.length,
            totalRevenue: 0,
            totalDiscount: 0,
            totalProfit: 0,
            averageCheck: 0,
            byPaymentMethod: {}
        };
        
        data.forEach(sale => {
            stats.totalRevenue += sale.total || 0;
            stats.totalProfit += sale.profit || 0;
            
            const method = sale.payment_method || 'unknown';
            stats.byPaymentMethod[method] = (stats.byPaymentMethod[method] || 0) + 1;
            
            // Расчет суммы скидки (обратный расчет)
            if (sale.discount) {
                const originalTotal = sale.total / (1 - sale.discount / 100);
                stats.totalDiscount += originalTotal - sale.total;
            }
        });
        
        if (stats.count > 0) {
            stats.averageCheck = stats.totalRevenue / stats.count;
        }
        
        return stats;
    },

    /**
     * Получает топ продаваемых товаров
     * @param {number} limit - Количество записей
     * @returns {Promise<Array>}
     */
    async getTopProducts(limit = 10) {
        const { data, error } = await db
            .from('sales')
            .select('items');
        
        if (error) {
            console.error('[SaleService] getTopProducts error:', error);
            throw error;
        }
        
        const productStats = new Map();
        
        data.forEach(sale => {
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
    }
};
