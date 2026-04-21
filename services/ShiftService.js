/**
 * Report Service
 * 
 * Формирование отчетов и аналитики.
 * 
 * @module ReportService
 * @version 4.1.0
 * @changes
 * - Уменьшен TTL кэша до 30 секунд
 * - Добавлен метод getSalesByHour()
 * - Добавлен метод getCategoryBreakdown()
 * - Улучшена агрегация данных
 */

import { db } from '../core/SupabaseClient.js';
import { ProductService } from './ProductService.js';
import { SaleService } from './SaleService.js';
import { ShiftService } from './ShiftService.js';

// ========== КЭШ ОТЧЕТОВ ==========
const reportCache = new Map();
const CACHE_TTL = 30000; // 30 секунд (уменьшено)

async function getCachedOrFetch(key, fetcher) {
    const cached = reportCache.get(key);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    const data = await fetcher();
    
    reportCache.set(key, {
        data,
        timestamp: Date.now()
    });
    
    return data;
}

export const ReportService = {
    /**
     * Получает общую статистику
     * @param {boolean} forceRefresh - Игнорировать кэш
     * @returns {Promise<Object>}
     */
    async getTotalStats(forceRefresh = false) {
        const cacheKey = 'total_stats';
        
        if (!forceRefresh) {
            const cached = await getCachedOrFetch(cacheKey, async () => {
                return this._fetchTotalStats();
            });
            return cached;
        }
        
        return this._fetchTotalStats();
    },

    async _fetchTotalStats() {
        const [productStats, salesStats, shiftStats] = await Promise.all([
            ProductService.getStats(),
            SaleService.getStats({}),
            ShiftService.getOverallStats({})
        ]);
        
        const { data: products } = await db
            .from('products')
            .select('category, status, price, cost_price');
        
        const categoryStats = {};
        let totalCost = 0;
        
        products?.forEach(p => {
            const cat = p.category || 'other';
            
            if (!categoryStats[cat]) {
                categoryStats[cat] = {
                    total: 0,
                    inStock: 0,
                    sold: 0,
                    value: 0,
                    cost: 0
                };
            }
            
            categoryStats[cat].total++;
            categoryStats[cat].value += p.price || 0;
            categoryStats[cat].cost += p.cost_price || 0;
            
            if (p.status === 'in_stock') {
                categoryStats[cat].inStock++;
                totalCost += p.cost_price || 0;
            } else if (p.status === 'sold') {
                categoryStats[cat].sold++;
            }
        });
        
        const totalRevenue = salesStats.totalRevenue;
        const totalProfit = salesStats.totalProfit;
        const margin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
        
        return {
            products: {
                total: productStats.total,
                inStock: productStats.inStock,
                sold: productStats.sold,
                reserved: productStats.reserved,
                inventoryValue: productStats.totalValue
            },
            sales: {
                count: salesStats.count,
                revenue: totalRevenue,
                profit: totalProfit,
                margin,
                averageCheck: salesStats.averageCheck
            },
            shifts: {
                count: shiftStats.totalShifts,
                totalRevenue: shiftStats.totalRevenue,
                totalProfit: shiftStats.totalProfit,
                averageRevenue: shiftStats.averageRevenue
            },
            financial: {
                totalCost,
                totalPotentialProfit: productStats.totalValue - totalCost,
                roi: totalCost > 0 ? (totalProfit / totalCost * 100) : 0
            },
            categories: categoryStats,
            generatedAt: new Date().toISOString()
        };
    },

    /**
     * Получает отчет по продажам за период
     * @param {Date|string} startDate - Начало периода
     * @param {Date|string} endDate - Конец периода
     * @returns {Promise<Object>}
     */
    async getSalesReport(startDate, endDate) {
        const sales = await SaleService.getByPeriod(startDate, endDate);
        const stats = await SaleService.getStats({ startDate, endDate });
        
        // Группировка по дням
        const dailyStats = {};
        
        sales.forEach(sale => {
            const date = new Date(sale.created_at);
            const dayKey = date.toISOString().split('T')[0];
            
            if (!dailyStats[dayKey]) {
                dailyStats[dayKey] = {
                    date: dayKey,
                    count: 0,
                    revenue: 0,
                    profit: 0
                };
            }
            
            dailyStats[dayKey].count++;
            dailyStats[dayKey].revenue += sale.total || 0;
            dailyStats[dayKey].profit += sale.profit || 0;
        });
        
        const topProducts = await SaleService.getTopProducts(10);
        
        return {
            period: { startDate, endDate },
            summary: stats,
            daily: Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date)),
            topProducts,
            sales: sales.slice(0, 100)
        };
    },

    /**
     * Получает статистику по часам
     * @param {Date|string} date - Дата
     * @returns {Promise<Object>}
     */
    async getSalesByHour(date) {
        const targetDate = typeof date === 'string' ? new Date(date) : date;
        const start = new Date(targetDate);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        
        const sales = await SaleService.getByPeriod(start, end);
        
        const hourlyStats = Array(24).fill(null).map(() => ({
            hour: 0,
            count: 0,
            revenue: 0,
            profit: 0
        }));
        
        sales.forEach(sale => {
            const hour = new Date(sale.created_at).getHours();
            hourlyStats[hour].hour = hour;
            hourlyStats[hour].count++;
            hourlyStats[hour].revenue += sale.total || 0;
            hourlyStats[hour].profit += sale.profit || 0;
        });
        
        return {
            date: start.toISOString().split('T')[0],
            hourly: hourlyStats,
            totalRevenue: hourlyStats.reduce((sum, h) => sum + h.revenue, 0),
            totalCount: hourlyStats.reduce((sum, h) => sum + h.count, 0)
        };
    },

    /**
     * Получает разбивку по категориям
     * @returns {Promise<Object>}
     */
    async getCategoryBreakdown() {
        const products = await ProductService.getAll();
        
        const breakdown = {
            byCategory: {},
            byStatus: {
                in_stock: 0,
                sold: 0,
                reserved: 0
            },
            totalValue: 0
        };
        
        products.forEach(p => {
            const cat = p.category || 'other';
            
            if (!breakdown.byCategory[cat]) {
                breakdown.byCategory[cat] = {
                    name: cat,
                    count: 0,
                    value: 0,
                    soldCount: 0
                };
            }
            
            breakdown.byCategory[cat].count++;
            breakdown.byCategory[cat].value += p.price || 0;
            
            if (p.status === 'sold') {
                breakdown.byCategory[cat].soldCount++;
            }
            
            breakdown.byStatus[p.status] = (breakdown.byStatus[p.status] || 0) + 1;
            breakdown.totalValue += p.price || 0;
        });
        
        return breakdown;
    },

    /**
     * Получает отчет по товарам
     * @returns {Promise<Object>}
     */
    async getProductsReport() {
        const products = await ProductService.getAll();
        const stats = await ProductService.getStats();
        const topProducts = await SaleService.getTopProducts(20);
        
        // Анализ ценовых сегментов
        const priceSegments = {
            budget: { min: 0, max: 500, count: 0, value: 0 },
            low: { min: 501, max: 1000, count: 0, value: 0 },
            medium: { min: 1001, max: 3000, count: 0, value: 0 },
            high: { min: 3001, max: 10000, count: 0, value: 0 },
            premium: { min: 10001, max: Infinity, count: 0, value: 0 }
        };
        
        products.forEach(p => {
            const price = p.price || 0;
            
            for (const [segment, range] of Object.entries(priceSegments)) {
                if (price >= range.min && price <= range.max) {
                    range.count++;
                    range.value += price;
                    break;
                }
            }
        });
        
        // Товары с наибольшей маржинальностью
        const highMarginProducts = products
            .filter(p => p.cost_price && p.price && p.price > p.cost_price)
            .map(p => ({
                ...p,
                margin: ((p.price - p.cost_price) / p.price * 100)
            }))
            .sort((a, b) => b.margin - a.margin)
            .slice(0, 20);
        
        // Низкооборачиваемые товары
        const now = new Date();
        const slowMovingProducts = products
            .filter(p => p.status === 'in_stock' && p.created_at)
            .map(p => ({
                ...p,
                daysInStock: Math.floor((now - new Date(p.created_at)) / (1000 * 60 * 60 * 24))
            }))
            .sort((a, b) => b.daysInStock - a.daysInStock)
            .slice(0, 20);
        
        return {
            summary: stats,
            priceSegments,
            topProducts,
            highMarginProducts,
            slowMovingProducts,
            totalProducts: products.length
        };
    },

    /**
     * Получает отчет по продавцам
     * @param {Object} options - Опции фильтрации
     * @returns {Promise<Object>}
     */
    async getSellersReport(options = {}) {
        const { startDate, endDate } = options;
        
        let query = db
            .from('shifts')
            .select(`
                id,
                user_id,
                opened_at,
                closed_at,
                total_revenue,
                total_profit,
                sales_count,
                profiles:user_id (
                    full_name,
                    email
                )
            `)
            .not('closed_at', 'is', null);
        
        if (startDate) query = query.gte('opened_at', startDate);
        if (endDate) query = query.lte('closed_at', endDate);
        
        const { data: shifts, error } = await query;
        
        if (error) {
            console.error('[ReportService] getSellersReport error:', error);
            throw error;
        }
        
        const sellersMap = new Map();
        
        shifts.forEach(shift => {
            const userId = shift.user_id;
            const profile = shift.profiles;
            
            if (!sellersMap.has(userId)) {
                sellersMap.set(userId, {
                    userId,
                    name: profile?.full_name || 'Неизвестно',
                    email: profile?.email || '',
                    shiftsCount: 0,
                    totalRevenue: 0,
                    totalProfit: 0,
                    totalSales: 0,
                    averageCheck: 0,
                    shifts: []
                });
            }
            
            const seller = sellersMap.get(userId);
            seller.shiftsCount++;
            seller.totalRevenue += shift.total_revenue || 0;
            seller.totalProfit += shift.total_profit || 0;
            seller.totalSales += shift.sales_count || 0;
            seller.shifts.push({
                shiftId: shift.id,
                openedAt: shift.opened_at,
                closedAt: shift.closed_at,
                revenue: shift.total_revenue,
                profit: shift.total_profit,
                salesCount: shift.sales_count
            });
        });
        
        const sellers = Array.from(sellersMap.values()).map(seller => ({
            ...seller,
            averageCheck: seller.totalSales > 0 ? seller.totalRevenue / seller.totalSales : 0,
            averageShiftRevenue: seller.shiftsCount > 0 ? seller.totalRevenue / seller.shiftsCount : 0
        }));
        
        sellers.sort((a, b) => b.totalRevenue - a.totalRevenue);
        
        return {
            period: { startDate, endDate },
            sellers,
            totalSellers: sellers.length,
            totalRevenue: sellers.reduce((sum, s) => sum + s.totalRevenue, 0),
            totalProfit: sellers.reduce((sum, s) => sum + s.totalProfit, 0)
        };
    },

    /**
     * Получает данные для дашборда
     * @returns {Promise<Object>}
     */
    async getDashboardData() {
        return getCachedOrFetch('dashboard', async () => {
            const [totalStats, todayStats, topProducts] = await Promise.all([
                this.getTotalStats(),
                this.getTodayStats(),
                SaleService.getTopProducts(5)
            ]);
            
            const yesterdayStats = await this.getYesterdayStats();
            
            const trends = {
                revenue: this.calculateTrend(todayStats.sales.revenue, yesterdayStats.sales.revenue),
                profit: this.calculateTrend(todayStats.sales.profit, yesterdayStats.sales.profit),
                salesCount: this.calculateTrend(todayStats.sales.count, yesterdayStats.sales.count),
                averageCheck: this.calculateTrend(todayStats.sales.averageCheck, yesterdayStats.sales.averageCheck)
            };
            
            return {
                timestamp: new Date().toISOString(),
                overview: totalStats,
                today: todayStats,
                trends,
                topProducts,
                alerts: this.generateAlerts(totalStats)
            };
        });
    },

    async getTodayStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        return this.getStatsForPeriod(today, tomorrow);
    },

    async getYesterdayStats() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        return this.getStatsForPeriod(yesterday, today);
    },

    async getStatsForPeriod(startDate, endDate) {
        const salesStats = await SaleService.getStats({ startDate, endDate });
        
        return {
            period: { startDate, endDate },
            sales: salesStats
        };
    },

    calculateTrend(current, previous) {
        if (!previous || previous === 0) {
            return { value: 0, direction: 'neutral' };
        }
        
        const change = ((current - previous) / previous) * 100;
        
        return {
            value: Math.abs(change).toFixed(1),
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
            raw: change
        };
    },

    generateAlerts(stats) {
        const alerts = [];
        
        if (stats.products.inStock < 10) {
            alerts.push({
                type: 'warning',
                message: 'Низкий остаток товаров на складе',
                value: stats.products.inStock
            });
        }
        
        if (stats.sales.margin > 50) {
            alerts.push({
                type: 'success',
                message: 'Отличная маржинальность продаж',
                value: stats.sales.margin.toFixed(1) + '%'
            });
        }
        
        if (stats.sales.margin < 20 && stats.sales.count > 0) {
            alerts.push({
                type: 'warning',
                message: 'Низкая маржинальность продаж',
                value: stats.sales.margin.toFixed(1) + '%'
            });
        }
        
        return alerts;
    },

    /**
     * Экспортирует отчет в CSV
     * @param {string} reportType - Тип отчета
     * @param {Object} data - Данные для экспорта
     * @returns {string}
     */
    exportToCSV(reportType, data) {
        switch (reportType) {
            case 'sales':
                return this.exportSalesToCSV(data);
            case 'products':
                return this.exportProductsToCSV(data);
            case 'sellers':
                return this.exportSellersToCSV(data);
            default:
                throw new Error(`Unknown report type: ${reportType}`);
        }
    },

    exportSalesToCSV(data) {
        const headers = ['Дата', 'Сумма', 'Скидка', 'Прибыль', 'Способ оплаты'];
        const rows = (data.sales || []).map(sale => [
            new Date(sale.created_at).toLocaleString('ru-RU'),
            sale.total,
            sale.discount || 0,
            sale.profit || 0,
            sale.payment_method
        ]);
        
        return this.formatCSV(headers, rows);
    },

    exportProductsToCSV(data) {
        const headers = ['Название', 'Категория', 'Цена', 'Себестоимость', 'Статус'];
        const rows = (data.topProducts || []).map(p => [
            p.name,
            p.category,
            p.price,
            p.cost_price || 0,
            p.status
        ]);
        
        return this.formatCSV(headers, rows);
    },

    exportSellersToCSV(data) {
        const headers = ['Продавец', 'Смен', 'Выручка', 'Прибыль', 'Средний чек'];
        const rows = (data.sellers || []).map(s => [
            s.name,
            s.shiftsCount,
            s.totalRevenue,
            s.totalProfit,
            s.averageCheck.toFixed(2)
        ]);
        
        return this.formatCSV(headers, rows);
    },

    formatCSV(headers, rows) {
        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        
        const headerRow = headers.map(escape).join(',');
        const dataRows = rows.map(row => row.map(escape).join(','));
        
        return [headerRow, ...dataRows].join('\n');
    },

    clearCache() {
        reportCache.clear();
        console.log('[ReportService] Cache cleared');
    }
};
