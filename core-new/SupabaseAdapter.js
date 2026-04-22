// ========================================
// FILE: ./core-new/SupabaseAdapter.js
// ========================================

/**
 * Supabase Adapter - Адаптер данных для Supabase
 * 
 * Слушает события запросов данных и преобразует их в вызовы Supabase API.
 * Отвечает за кэширование, офлайн-режим и трансформацию данных.
 * 
 * Архитектурные решения:
 * - Полная изоляция клиента Supabase от виджетов.
 * - Автоматическое переключение на офлайн-режим.
 * - Кэширование запросов в памяти (TTL 30 секунд).
 * - Единая обработка ошибок с публикацией в EventBus.
 * 
 * @module SupabaseAdapter
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { EventBus, EventTypes, EventSource } from './EventBus.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ========== КОНФИГУРАЦИЯ ==========
const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// Время жизни кэша в миллисекундах
const CACHE_TTL = 30000; // 30 секунд

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
     * Подключается к Supabase и начинает слушать события данных.
     */
    async init() {
        if (this.initialized) return;
        
        console.log('[SupabaseAdapter] Initializing...');
        
        try {
            // Инициализируем клиент Supabase
            this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true
                },
                db: {
                    schema: 'public'
                }
            });
            
            console.log('[SupabaseAdapter] Supabase client created');
            
            // Подписываемся на события данных
            this.subscribeToEvents();
            
            // Подписываемся на события сети
            window.addEventListener('online', this.handleOnline);
            window.addEventListener('offline', this.handleOffline);
            
            this.initialized = true;
            
            // Сообщаем системе, что адаптер готов
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
        // Продукты
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
        
        // Смены
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
        
        console.log('[SupabaseAdapter] Subscribed to data events');
    }
    
    // ========== ОБРАБОТЧИКИ ПРОДУКТОВ ==========
    
    async handleProductsFetch(request) {
        const { page = 0, limit = 30, filters = {}, sort = 'created_at-desc' } = request;
        
        console.log('[SupabaseAdapter] Fetching products', { page, limit, filters, sort });
        
        // Формируем ключ кэша
        const cacheKey = `products_${page}_${limit}_${JSON.stringify(filters)}_${sort}`;
        
        // Проверяем кэш (если онлайн и не истек)
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
        
        // Если офлайн - пытаемся взять из локального хранилища
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
            
            // Применяем фильтры
            if (filters.search) {
                query = query.ilike('name', `%${filters.search}%`);
            }
            if (filters.category) {
                query = query.eq('category', filters.category);
            }
            if (filters.status) {
                query = query.eq('status', filters.status);
            }
            
            // Применяем сортировку
            const [field, direction] = sort.split('-');
            query = query.order(field, { ascending: direction === 'asc' });
            
            // Пагинация
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
            
            // Сохраняем в кэш
            if (this.isOnline) {
                this.cache.set(cacheKey, {
                    data: response,
                    timestamp: Date.now()
                });
            }
            
            // Сохраняем в офлайн-хранилище
            await this.saveOfflineProducts(data, page);
            
            console.log('[SupabaseAdapter] Products fetched:', data.length);
            
            EventBus.emit(EventTypes.DATA.PRODUCTS_FETCHED, {
                ...response,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to fetch products:', error);
            
            // Пробуем отдать офлайн-данные при ошибке
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
            
            // Очищаем кэш продуктов
            this.clearProductCache();
            
            EventBus.emit(EventTypes.DATA.PRODUCT_CREATED, {
                product: data,
                source: EventSource.ADAPTER_SUPABASE
            }, EventSource.ADAPTER_SUPABASE);
            
            console.log('[SupabaseAdapter] Product created:', data.id);
            
        } catch (error) {
            console.error('[SupabaseAdapter] Failed to create product:', error);
            
            // Сохраняем в офлайн-очередь
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
    
    // ========== ОФЛАЙН-РЕЖИМ ==========
    
    handleOnline() {
        console.log('[SupabaseAdapter] 🌐 Online');
        this.isOnline = true;
        EventBus.emit(EventTypes.SYSTEM.NETWORK_ONLINE, null, EventSource.ADAPTER_SUPABASE);
        
        // Синхронизируем офлайн-очередь
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
            
            // Применяем фильтры к офлайн-данным
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
            // Сохраняем только первые 3 страницы для экономии места
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
            queue.push({
                operation,
                data,
                timestamp: Date.now()
            });
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
            
            // TODO: Реализовать синхронизацию очереди
            
            localStorage.removeItem('offline_queue');
            
        } catch (error) {
            console.warn('[SupabaseAdapter] Failed to sync offline queue:', error);
        }
    }
    
    // ========== УТИЛИТЫ ==========
    
    clearProductCache() {
        // Очищаем кэш продуктов
        for (const key of this.cache.keys()) {
            if (key.startsWith('products_')) {
                this.cache.delete(key);
            }
        }
        console.log('[SupabaseAdapter] Product cache cleared');
    }
    
    /**
     * Уничтожение адаптера.
     */
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
