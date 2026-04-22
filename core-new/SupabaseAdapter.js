// ========================================
// FILE: ./core-new/SupabaseAdapter.js
// ========================================

/**
 * Supabase Adapter - Адаптер данных для Supabase
 * 
 * Слушает события запросов данных и преобразует их в вызовы Supabase API.
 * Отвечает за кэширование, офлайн-режим и трансформацию данных.
 * Предоставляет единый клиент Supabase для виджетов.
 * 
 * Архитектурные решения:
 * - Полная изоляция клиента Supabase от виджетов.
 * - Автоматическое переключение на офлайн-режим.
 * - Кэширование запросов в памяти (TTL 30 секунд).
 * - Единая обработка ошибок с публикацией в EventBus.
 * - Предоставление клиента Supabase через событие adapter:supabase:ready.
 * 
 * @module SupabaseAdapter
 * @version 1.2.0
 * @changes
 * - Добавлен обработчик DATA.REPORTS_FETCH.
 * - Реализована агрегация данных для отчетов.
 * - Добавлен обработчик adapter:supabase:request для предоставления клиента.
 */

import { EventBus, EventTypes, EventSource } from './EventBus.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ========== КОНФИГУРАЦИЯ ==========
const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// Время жизни кэша в миллисекундах
const CACHE_TTL = 30000; // 30 секунд

// Типы событий для отчетов (добавляем, если нет в EventTypes)
const REPORTS_EVENTS = {
    FETCH: 'data:reports:fetch',
    FETCHED: 'data:reports:fetched'
};

export class SupabaseAdapter {
    constructor() {
        /** @type {any} Клиент Supabase */
        this.client = null;
        
        /** @type {boolean} Флаг инициализации */
        this.initialized = false;
        
        /** @type {boolean} Онлайн ли приложение */
        this.isOnline = navigator.onLine;
        
        /** @type {Map<string, {data: any, timestamp: number}>} Кэш запросов */
        this.cache = new Map();
        
        /** @type {Array<Function>} Функции отписки от EventBus */
        this._unsubscribers = [];
        
        // Привязка методов
        this.handleOnline = this.handleOnline.bind(this);
        this.handleOffline = this.handleOffline.bind(this);
    }
    
    /**
     * Инициализация адаптера.
     */
    async init() {
        if (this.initialized) return;
        
        console.log('[SupabaseAdapter] Initializing...');
        
        try {
            this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { persistSession: true, autoRefreshToken: true },
                db: { schema: 'public' }
            });
            
            console.log('[SupabaseAdapter] Supabase client created');
            
            this.subscribeToEvents();
            
            window.addEventListener('online', this.handleOnline);
            window.addEventListener('offline', this.handleOffline);
            
            this.initialized = true;
            
            EventBus.emit('adapter:ready', { 
                type: 'supabase', 
                online: this.isOnline 
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] ✅ Initialized (Online:', this.isOnline, ')');
            
        } catch (error) {
            console.error('[SupabaseAdapter] ❌ Init failed:', error);
            throw error;
        }
    }
    
    /**
     * Подписывается на все события запросов данных.
     */
    subscribeToEvents() {
        // === ЗАПРОС КЛИЕНТА SUPABASE ===
        this._unsubscribers.push(
            EventBus.on('adapter:supabase:request', 
                (data) => this.handleClientRequest(data)
            )
        );
        
        // === ПРОДУКТЫ ===
        this._unsubscribers.push(
            EventBus.on(EventTypes.DATA.PRODUCTS_FETCH, 
                (data) => this.handleProductsFetch(data), 
                EventSource.WIDGET_INVENTORY
            )
        );
        
        this._unsubscribers.push(
            EventBus.on(EventTypes.DATA.PRODUCT_CREATED, 
                (data) => this.handleProductCreate(data), 
                EventSource.WIDGET_INVENTORY
            )
        );
        
        this._unsubscribers.push(
            EventBus.on(EventTypes.DATA.PRODUCT_UPDATED, 
                (data) => this.handleProductUpdate(data), 
                EventSource.WIDGET_INVENTORY
            )
        );
        
        this._unsubscribers.push(
            EventBus.on(EventTypes.DATA.PRODUCT_DELETED, 
                (data) => this.handleProductDelete(data), 
                EventSource.WIDGET_INVENTORY
            )
        );
        
        // === СМЕНЫ ===
        this._unsubscribers.push(
            EventBus.on(EventTypes.DATA.SHIFT_OPEN, 
                (data) => this.handleShiftOpen(data), 
                EventSource.WIDGET_CASHIER
            )
        );
        
        this._unsubscribers.push(
            EventBus.on(EventTypes.DATA.SHIFT_CLOSE, 
                (data) => this.handleShiftClose(data), 
                EventSource.WIDGET_CASHIER
            )
        );
        
        // === ОТЧЕТЫ ===
        this._unsubscribers.push(
            EventBus.on(REPORTS_EVENTS.FETCH, 
                (data) => this.handleReportsFetch(data), 
                EventSource.WIDGET_REPORTS
            )
        );
        
        console.log('[SupabaseAdapter] Subscribed to data events');
    }
    
    // ========== ОБРАБОТЧИК ЗАПРОСА КЛИЕНТА ==========
    
    /**
     * Отправляет клиент Supabase виджету, который его запросил.
     */
    handleClientRequest(data) {
        const { widgetId } = data;
        console.log('[SupabaseAdapter] Client requested by:', widgetId);
        
        if (!this.client) {
            console.warn('[SupabaseAdapter] Client not ready yet');
            return;
        }
        
        EventBus.emit('adapter:supabase:ready', {
            client: this.client,
            online: this.isOnline
        }, EventSource.ADAPTER_SUPABASE);
    }
    
    // ========== ОБРАБОТЧИКИ ПРОДУКТОВ ==========
    
    async handleProductsFetch(request) {
        const { page = 0, limit = 30, filters = {}, sort = 'created_at-desc' } = request;
        
        console.log('[SupabaseAdapter] Fetching products', { page, limit, filters, sort });
        
        const cacheKey = `products_${page}_${limit}_${JSON.stringify(filters)}_${sort}`;
        
        if (this.isOnline) {
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
                console.log('[SupabaseAdapter] Returning cached products');
                EventBus.emit(EventTypes.DATA.PRODUCTS_FETCHED, {
                    ...cached.data,
                    source: EventSource.ADAPTER_SUPABASE,
                    fromCache: true
                }, EventSource.ADAPTER_SUPABASE);
                return;
            }
        }
        
        if (!this.isOnline) {
            const offlineData = await this.getOfflineProducts(page, limit, filters);
            if (offlineData) {
                EventBus.emit(EventTypes.DATA.PRODUCTS_FETCHED, {
                    ...offlineData,
                    source: EventSource.ADAPTER_SUPABASE,
                    offline: true
                }, EventSource.ADAPTER_SUPABASE);
                return;
            }
        }
        
        try {
            let query = this.client
                .from('products')
                .select('*', { count: 'exact' });
            
            if (filters.search) {
                query = query.ilike('name', `%${filters.search}%`);
            }
            if (filters.category) {
                query = query.eq('category', filters.category);
            }
            if (filters.status) {
                query = query.eq('status', filters.status);
            }
            
            const [field, direction] = sort.split('-');
            query = query.order(field, { ascending: direction === 'asc' });
            
            const from = page * limit;
            const to = from + limit - 1;
            query = query.range(from, to);
            
            const { data, error, count } = await query;
            
            if (error) throw error;
            
            const hasMore = count > (from + data.length);
            
            const response = {
                products: data || [],
                page,
                hasMore,
                total: count
            };
            
            if (this.isOnline) {
                this.cache.set(cacheKey, {
                    data: response,
                    timestamp: Date.now()
                });
            }
            
            await this.saveOfflineProducts(data, page);
            
            console.log('[SupabaseAdapter] Products fetched:', data.length);
            
            EventBus.emit(EventTypes.DATA.PRODUCTS_FETCHED, {
                ...response,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to fetch products:', error);
            
            const offlineData = await this.getOfflineProducts(page, limit, filters);
            if (offlineData) {
                EventBus.emit(EventTypes.DATA.PRODUCTS_FETCHED, {
                    ...offlineData,
                    source: EventSource.ADAPTER_SUPABASE,
                    offline: true,
                    error: error.message
                }, EventSource.ADAPTER_SUPABASE);
                return;
            }
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: 'fetch_products',
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    async handleProductCreate(request) {
        console.log('[SupabaseAdapter] Creating product:', request);
        
        try {
            const { data, error } = await this.client
                .from('products')
                .insert({
                    ...request,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (error) throw error;
            
            this.clearProductCache();
            
            EventBus.emit(EventTypes.DATA.PRODUCT_CREATED, {
                product: data,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Product created:', data.id);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to create product:', error);
            await this.addToOfflineQueue('create_product', request);
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: 'create_product',
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    async handleProductUpdate(request) {
        const { id, ...updates } = request;
        
        console.log('[SupabaseAdapter] Updating product:', id);
        
        try {
            const { data, error } = await this.client
                .from('products')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();
            
            if (error) throw error;
            
            this.clearProductCache();
            
            EventBus.emit(EventTypes.DATA.PRODUCT_UPDATED, {
                product: data,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Product updated:', id);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to update product:', error);
            await this.addToOfflineQueue('update_product', { id, ...updates });
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: 'update_product',
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    async handleProductDelete(request) {
        const { id, ids, bulk } = request;
        
        console.log('[SupabaseAdapter] Deleting product(s):', bulk ? ids : id);
        
        try {
            let error;
            
            if (bulk && ids) {
                const { error: deleteError } = await this.client
                    .from('products')
                    .delete()
                    .in('id', ids);
                error = deleteError;
            } else {
                const { error: deleteError } = await this.client
                    .from('products')
                    .delete()
                    .eq('id', id);
                error = deleteError;
            }
            
            if (error) throw error;
            
            this.clearProductCache();
            
            EventBus.emit(EventTypes.DATA.PRODUCT_DELETED, {
                id,
                ids,
                bulk,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Product(s) deleted');
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to delete product(s):', error);
            await this.addToOfflineQueue('delete_product', request);
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: 'delete_product',
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    // ========== ОБРАБОТЧИКИ СМЕН ==========
    
    async handleShiftOpen(request) {
        const { userId, initialCash = 0 } = request;
        
        console.log('[SupabaseAdapter] Opening shift for user:', userId);
        
        try {
            const { data, error } = await this.client
                .from('shifts')
                .insert({
                    user_id: userId,
                    opened_at: new Date().toISOString(),
                    initial_cash: initialCash,
                    status: 'active'
                })
                .select()
                .single();
            
            if (error) throw error;
            
            EventBus.emit(EventTypes.DATA.SHIFT_OPENED, {
                shift: data,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Shift opened:', data.id);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to open shift:', error);
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: 'open_shift',
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    async handleShiftClose(request) {
        const { shiftId, finalCash } = request;
        
        console.log('[SupabaseAdapter] Closing shift:', shiftId);
        
        try {
            const { data, error } = await this.client
                .from('shifts')
                .update({
                    closed_at: new Date().toISOString(),
                    final_cash: finalCash,
                    status: 'closed'
                })
                .eq('id', shiftId)
                .select()
                .single();
            
            if (error) throw error;
            
            EventBus.emit(EventTypes.DATA.SHIFT_CLOSED, {
                shift: data,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Shift closed:', shiftId);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to close shift:', error);
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: 'close_shift',
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    // ========== ОБРАБОТЧИКИ ОТЧЕТОВ ==========
    
    async handleReportsFetch(request) {
        const { reportType, startDate, endDate } = request;
        
        console.log('[SupabaseAdapter] Fetching report:', reportType, { startDate, endDate });
        
        const cacheKey = `report_${reportType}_${startDate}_${endDate}`;
        
        const cached = this.cache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            console.log('[SupabaseAdapter] Returning cached report');
            EventBus.emit(REPORTS_EVENTS.FETCHED, {
                reportType,
                payload: cached.data,
                source: EventSource.ADAPTER_SUPABASE,
                fromCache: true
            }, EventSource.ADAPTER_SUPABASE);
            return;
        }
        
        try {
            let payload = null;
            
            switch (reportType) {
                case 'dashboard':
                    payload = await this.buildDashboardReport(startDate, endDate);
                    break;
                case 'sales':
                    payload = await this.buildSalesReport(startDate, endDate);
                    break;
                case 'products':
                    payload = await this.buildProductsReport();
                    break;
                default:
                    throw new Error(`Unknown report type: ${reportType}`);
            }
            
            this.cache.set(cacheKey, {
                data: payload,
                timestamp: Date.now()
            });
            
            EventBus.emit(REPORTS_EVENTS.FETCHED, {
                reportType,
                payload,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Report generated:', reportType);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to generate report:', error);
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.ADAPTER_SUPABASE,
                operation: `report_${reportType}`,
                error: error.message
            }, EventSource.ADAPTER_SUPABASE);
        }
    }
    
    async buildDashboardReport(startDate, endDate) {
        // Получаем продажи за период
        const { data: sales, error: salesError } = await this.client
            .from('sales')
            .select('*')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .order('created_at', { ascending: true });
        
        if (salesError) throw salesError;
        
        // Получаем предыдущий период для трендов
        const periodLength = new Date(endDate) - new Date(startDate);
        const prevStart = new Date(new Date(startDate) - periodLength).toISOString();
        const prevEnd = startDate;
        
        const { data: prevSales, error: prevError } = await this.client
            .from('sales')
            .select('*')
            .gte('created_at', prevStart)
            .lte('created_at', prevEnd);
        
        if (prevError) throw prevError;
        
        // Получаем товары в наличии
        const { count: inStock, error: stockError } = await this.client
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'in_stock');
        
        if (stockError) throw stockError;
        
        // Вычисляем статистику
        const salesData = sales || [];
        const prevSalesData = prevSales || [];
        
        const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
        const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
        const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
        
        const prevRevenue = prevSalesData.reduce((sum, s) => sum + (s.total || 0), 0);
        const prevProfit = prevSalesData.reduce((sum, s) => sum + (s.profit || 0), 0);
        const prevCount = prevSalesData.length;
        
        // Тренды
        const trends = {
            revenue: this.calculateTrend(totalRevenue, prevRevenue),
            profit: this.calculateTrend(totalProfit, prevProfit),
            salesCount: this.calculateTrend(salesData.length, prevCount),
            averageCheck: this.calculateTrend(
                salesData.length > 0 ? totalRevenue / salesData.length : 0,
                prevCount > 0 ? prevRevenue / prevCount : 0
            )
        };
        
        // Группировка по дням
        const daily = this.groupSalesByDay(salesData);
        
        // Топ товаров
        const topProducts = this.calculateTopProducts(salesData, 5);
        
        // Алерты
        const alerts = this.generateAlerts({
            totalRevenue,
            margin,
            inStock: inStock || 0,
            salesCount: salesData.length
        });
        
        return {
            overview: {
                revenue: totalRevenue,
                profit: totalProfit,
                margin,
                salesCount: salesData.length,
                averageCheck: salesData.length > 0 ? totalRevenue / salesData.length : 0,
                inStock: inStock || 0
            },
            trends,
            daily,
            topProducts,
            alerts
        };
    }
    
    async buildSalesReport(startDate, endDate) {
        const { data: sales, error } = await this.client
            .from('sales')
            .select('*')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        const salesData = sales || [];
        
        const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
        const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
        
        return {
            summary: {
                count: salesData.length,
                revenue: totalRevenue,
                profit: totalProfit,
                averageCheck: salesData.length > 0 ? totalRevenue / salesData.length : 0
            },
            sales: salesData
        };
    }
    
    async buildProductsReport() {
        // Топ продаваемых товаров
        const { data: sales, error } = await this.client
            .from('sales')
            .select('items');
        
        if (error && error.code !== 'PGRST116') throw error;
        
        const topProducts = this.calculateTopProducts(sales || [], 10);
        
        // Залежавшиеся товары
        const { data: products, error: prodError } = await this.client
            .from('products')
            .select('*')
            .eq('status', 'in_stock')
            .order('created_at', { ascending: true });
        
        if (prodError) throw prodError;
        
        const now = new Date();
        const slowMoving = (products || [])
            .map(p => ({
                ...p,
                daysInStock: Math.floor((now - new Date(p.created_at)) / (1000 * 60 * 60 * 24))
            }))
            .filter(p => p.daysInStock > 30)
            .sort((a, b) => b.daysInStock - a.daysInStock)
            .slice(0, 10);
        
        return {
            topProducts,
            slowMoving
        };
    }
    
    // ========== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ОТЧЕТОВ ==========
    
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
    }
    
    groupSalesByDay(sales) {
        const daily = {};
        
        sales.forEach(sale => {
            const day = sale.created_at.split('T')[0];
            
            if (!daily[day]) {
                daily[day] = { date: day, count: 0, revenue: 0, profit: 0 };
            }
            
            daily[day].count++;
            daily[day].revenue += sale.total || 0;
            daily[day].profit += sale.profit || 0;
        });
        
        return Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
    }
    
    calculateTopProducts(sales, limit) {
        const productStats = new Map();
        
        sales.forEach(sale => {
            if (!sale.items) return;
            
            sale.items.forEach(item => {
                const key = item.id;
                const current = productStats.get(key) || {
                    id: item.id,
                    name: item.name,
                    quantity: 0,
                    revenue: 0
                };
                
                current.quantity += item.quantity || 1;
                current.revenue += (item.price || 0) * (item.quantity || 1);
                
                productStats.set(key, current);
            });
        });
        
        return Array.from(productStats.values())
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, limit);
    }
    
    generateAlerts(stats) {
        const alerts = [];
        
        if (stats.inStock < 10) {
            alerts.push({
                type: 'warning',
                message: 'Низкий остаток товаров',
                value: `${stats.inStock} шт.`
            });
        }
        
        if (stats.margin > 40) {
            alerts.push({
                type: 'success',
                message: 'Отличная маржинальность',
                value: `${stats.margin.toFixed(1)}%`
            });
        }
        
        if (stats.salesCount > 50) {
            alerts.push({
                type: 'info',
                message: 'Высокая активность продаж',
                value: `${stats.salesCount} продаж`
            });
        }
        
        return alerts;
    }
    
    // ========== ОФЛАЙН-РЕЖИМ ==========
    
    handleOnline() {
        console.log('[SupabaseAdapter] 🌐 Online');
        this.isOnline = true;
        EventBus.emit(EventTypes.SYSTEM.NETWORK_ONLINE, null, EventSource.ADAPTER_SUPABASE);
        this.syncOfflineQueue();
    }
    
    handleOffline() {
        console.log('[SupabaseAdapter] 📴 Offline');
        this.isOnline = false;
        EventBus.emit(EventTypes.SYSTEM.NETWORK_OFFLINE, null, EventSource.ADAPTER_SUPABASE);
    }
    
    async getOfflineProducts(page, limit, filters) {
        try {
            const stored = localStorage.getItem(`offline_products_page_${page}`);
            if (!stored) return null;
            
            const data = JSON.parse(stored);
            let products = data.products || [];
            
            if (filters.search) {
                const q = filters.search.toLowerCase();
                products = products.filter(p => p.name.toLowerCase().includes(q));
            }
            if (filters.category) {
                products = products.filter(p => p.category === filters.category);
            }
            if (filters.status) {
                products = products.filter(p => p.status === filters.status);
            }
            
            return {
                products: products.slice(0, limit),
                page,
                hasMore: products.length > limit,
                total: products.length
            };
            
        } catch (error) {
            console.warn('[SupabaseAdapter] Failed to read offline products:', error);
            return null;
        }
    }
    
    async saveOfflineProducts(products, page) {
        try {
            if (page < 3) {
                localStorage.setItem(`offline_products_page_${page}`, JSON.stringify({
                    products,
                    timestamp: Date.now()
                }));
            }
        } catch (error) {
            console.warn('[SupabaseAdapter] Failed to save offline products:', error);
        }
    }
    
    async addToOfflineQueue(operation, data) {
        try {
            const queue = JSON.parse(localStorage.getItem('offline_queue') || '[]');
            queue.push({ operation, data, timestamp: Date.now() });
            localStorage.setItem('offline_queue', JSON.stringify(queue));
            console.log('[SupabaseAdapter] Added to offline queue:', operation);
        } catch (error) {
            console.warn('[SupabaseAdapter] Failed to add to offline queue:', error);
        }
    }
    
    async syncOfflineQueue() {
        try {
            const queue = JSON.parse(localStorage.getItem('offline_queue') || '[]');
            if (queue.length === 0) return;
            
            console.log('[SupabaseAdapter] Syncing offline queue:', queue.length, 'items');
            // TODO: Реализовать синхронизацию
            localStorage.removeItem('offline_queue');
        } catch (error) {
            console.warn('[SupabaseAdapter] Failed to sync offline queue:', error);
        }
    }
    
    // ========== УТИЛИТЫ ==========
    
    clearProductCache() {
        for (const key of this.cache.keys()) {
            if (key.startsWith('products_')) {
                this.cache.delete(key);
            }
        }
        console.log('[SupabaseAdapter] Product cache cleared');
    }
    
    destroy() {
        console.log('[SupabaseAdapter] Destroying...');
        
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
        
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        
        this.cache.clear();
        this.client = null;
        this.initialized = false;
        
        console.log('[SupabaseAdapter] 💀 Destroyed');
    }
}

// Создаем и экспортируем синглтон
export const supabaseAdapter = new SupabaseAdapter();

export default supabaseAdapter;
