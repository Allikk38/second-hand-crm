/**
 * Product Service
 * 
 * Управление товарами: CRUD операции, кэширование, пагинация.
 * 
 * Архитектурные решения:
 * - Кэширование в памяти с TTL для снижения нагрузки на БД
 * - Пагинация на уровне сервиса (подготовка к большим объемам данных)
 * - Валидация бизнес-правил перед операциями
 * - Публикация событий с полным контекстом
 * - Инвалидация кэша при мутациях
 * 
 * @module ProductService
 * @requires db
 * @requires EventBus
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';

// ========== КЭШ ==========
const CACHE_TTL = 30000; // 30 секунд

const cache = {
    all: {
        data: null,
        timestamp: 0
    },
    byId: new Map(), // id -> { data, timestamp }
    inStock: {
        data: null,
        timestamp: 0
    }
};

/**
 * Проверяет, валиден ли кэш
 * @param {number} timestamp - Время сохранения
 * @returns {boolean}
 */
function isCacheValid(timestamp) {
    return timestamp > 0 && (Date.now() - timestamp) < CACHE_TTL;
}

/**
 * Инвалидирует весь кэш товаров
 */
function invalidateCache(productId = null) {
    cache.all.timestamp = 0;
    cache.all.data = null;
    cache.inStock.timestamp = 0;
    cache.inStock.data = null;
    
    if (productId) {
        cache.byId.delete(productId);
    } else {
        cache.byId.clear();
    }
}

// ========== SERVICE ==========
export const ProductService = {
    /**
     * Получает все товары
     * @param {Object} options - Опции запроса
     * @param {boolean} options.forceRefresh - Игнорировать кэш
     * @param {number} options.limit - Лимит записей
     * @param {number} options.offset - Смещение
     * @returns {Promise<Array>}
     */
    async getAll(options = {}) {
        const { forceRefresh = false, limit, offset } = options;
        
        // Проверяем кэш только если нет пагинации
        if (!forceRefresh && !limit && !offset && isCacheValid(cache.all.timestamp)) {
            return cache.all.data;
        }
        
        let query = db
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (limit) query = query.limit(limit);
        if (offset) query = query.range(offset, offset + (limit || 1000) - 1);
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[ProductService] getAll error:', error);
            throw error;
        }
        
        // Кэшируем только полный список
        if (!limit && !offset) {
            cache.all.data = data;
            cache.all.timestamp = Date.now();
        }
        
        return data;
    },

    /**
     * Получает товары в наличии (для кассы)
     * @param {boolean} forceRefresh - Игнорировать кэш
     * @returns {Promise<Array>}
     */
    async getInStock(forceRefresh = false) {
        if (!forceRefresh && isCacheValid(cache.inStock.timestamp)) {
            return cache.inStock.data;
        }
        
        const { data, error } = await db
            .from('products')
            .select('*')
            .eq('status', 'in_stock')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('[ProductService] getInStock error:', error);
            throw error;
        }
        
        cache.inStock.data = data;
        cache.inStock.timestamp = Date.now();
        
        return data;
    },

    /**
     * Получает товар по ID
     * @param {string} id - ID товара
     * @param {boolean} forceRefresh - Игнорировать кэш
     * @returns {Promise<Object>}
     */
    async getById(id, forceRefresh = false) {
        if (!id) throw new Error('Product ID is required');
        
        const cached = cache.byId.get(id);
        if (!forceRefresh && cached && isCacheValid(cached.timestamp)) {
            return cached.data;
        }
        
        const { data, error } = await db
            .from('products')
            .select('*')
            .eq('id', id)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                throw new Error(`Product with id ${id} not found`);
            }
            console.error('[ProductService] getById error:', error);
            throw error;
        }
        
        cache.byId.set(id, {
            data,
            timestamp: Date.now()
        });
        
        return data;
    },

    /**
     * Создает новый товар
     * @param {Object} product - Данные товара
     * @returns {Promise<Object>}
     */
    async create(product) {
        if (!product.name || !product.price) {
            throw new Error('Name and price are required');
        }
        
        if (product.price < 0) {
            throw new Error('Price cannot be negative');
        }
        
        if (product.cost_price && product.cost_price >= product.price) {
            console.warn('[ProductService] Cost price is greater than or equal to sale price');
        }
        
        const { data, error } = await db
            .from('products')
            .insert({
                ...product,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (error) {
            console.error('[ProductService] create error:', error);
            throw error;
        }
        
        invalidateCache();
        EventBus.emit('product:created', { 
            product: data,
            source: 'ProductService.create'
        });
        
        return data;
    },

    /**
     * Обновляет товар
     * @param {string} id - ID товара
     * @param {Object} updates - Обновляемые поля
     * @returns {Promise<Object>}
     */
    async update(id, updates) {
        if (!id) throw new Error('Product ID is required');
        
        // Получаем текущую версию для проверки
        const current = await this.getById(id);
        
        // Бизнес-правила
        if (current.status === 'sold' && updates.status !== 'sold') {
            console.warn('[ProductService] Attempting to modify sold product');
        }
        
        if (updates.price && updates.price < 0) {
            throw new Error('Price cannot be negative');
        }
        
        const { data, error } = await db
            .from('products')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
        
        if (error) {
            console.error('[ProductService] update error:', error);
            throw error;
        }
        
        invalidateCache(id);
        EventBus.emit('product:updated', { 
            product: data,
            previous: current,
            source: 'ProductService.update'
        });
        
        return data;
    },

    /**
     * Обновляет статус товара (атомарная операция)
     * @param {string} id - ID товара
     * @param {string} status - Новый статус
     * @returns {Promise<Object>}
     */
    async updateStatus(id, status) {
        const validStatuses = ['in_stock', 'sold', 'reserved'];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status: ${status}`);
        }
        
        return this.update(id, { status });
    },

    /**
     * Удаляет товар
     * @param {string} id - ID товара
     * @returns {Promise<void>}
     */
    async delete(id) {
        if (!id) throw new Error('Product ID is required');
        
        // Проверяем, можно ли удалить
        const product = await this.getById(id);
        
        if (product.status === 'sold') {
            console.warn('[ProductService] Deleting sold product:', id);
            // Не блокируем, но логируем
        }
        
        const { error } = await db
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) {
            console.error('[ProductService] delete error:', error);
            throw error;
        }
        
        invalidateCache(id);
        EventBus.emit('product:deleted', { 
            id,
            product,
            source: 'ProductService.delete'
        });
    },

    /**
     * Массовое обновление статусов (для продажи)
     * @param {Array<string>} ids - Массив ID товаров
     * @param {string} status - Новый статус
     * @returns {Promise<void>}
     */
    async bulkUpdateStatus(ids, status) {
        if (!ids || ids.length === 0) return;
        
        const validStatuses = ['in_stock', 'sold', 'reserved'];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status: ${status}`);
        }
        
        const { error } = await db
            .from('products')
            .update({ 
                status,
                updated_at: new Date().toISOString()
            })
            .in('id', ids);
        
        if (error) {
            console.error('[ProductService] bulkUpdateStatus error:', error);
            throw error;
        }
        
        invalidateCache();
        ids.forEach(id => cache.byId.delete(id));
        
        EventBus.emit('product:bulk-updated', {
            ids,
            status,
            source: 'ProductService.bulkUpdateStatus'
        });
    },

    /**
     * Поиск товаров
     * @param {string} query - Поисковый запрос
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>}
     */
    async search(query, options = {}) {
        if (!query || query.length < 2) {
            return this.getAll(options);
        }
        
        const { limit = 50, status = null } = options;
        
        let dbQuery = db
            .from('products')
            .select('*')
            .ilike('name', `%${query}%`)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (status) {
            dbQuery = dbQuery.eq('status', status);
        }
        
        const { data, error } = await dbQuery;
        
        if (error) {
            console.error('[ProductService] search error:', error);
            throw error;
        }
        
        return data;
    },

    /**
     * Получает статистику по товарам
     * @returns {Promise<Object>}
     */
    async getStats() {
        const { data, error } = await db
            .from('products')
            .select('status, price, cost_price');
        
        if (error) {
            console.error('[ProductService] getStats error:', error);
            throw error;
        }
        
        const stats = {
            total: data.length,
            inStock: data.filter(p => p.status === 'in_stock').length,
            sold: data.filter(p => p.status === 'sold').length,
            reserved: data.filter(p => p.status === 'reserved').length,
            totalValue: 0,
            totalCost: 0,
            potentialProfit: 0
        };
        
        data.forEach(product => {
            if (product.status === 'in_stock') {
                stats.totalValue += product.price || 0;
                stats.totalCost += product.cost_price || 0;
                stats.potentialProfit += (product.price || 0) - (product.cost_price || 0);
            }
        });
        
        return stats;
    },

    /**
     * Проверяет, существует ли товар с таким именем
     * @param {string} name - Название товара
     * @param {string} excludeId - Исключить ID (при редактировании)
     * @returns {Promise<boolean>}
     */
    async exists(name, excludeId = null) {
        let query = db
            .from('products')
            .select('id')
            .eq('name', name);
        
        if (excludeId) {
            query = query.neq('id', excludeId);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[ProductService] exists error:', error);
            throw error;
        }
        
        return data && data.length > 0;
    },

    /**
     * Очищает кэш (полезно после массовых операций)
     */
    clearCache() {
        invalidateCache();
        console.log('[ProductService] Cache cleared');
    },

    /**
     * Получает информацию о кэше (для отладки)
     * @returns {Object}
     */
    getCacheInfo() {
        return {
            all: {
                hasData: cache.all.data !== null,
                age: cache.all.timestamp ? Date.now() - cache.all.timestamp : null,
                count: cache.all.data?.length || 0
            },
            inStock: {
                hasData: cache.inStock.data !== null,
                age: cache.inStock.timestamp ? Date.now() - cache.inStock.timestamp : null,
                count: cache.inStock.data?.length || 0
            },
            byId: {
                size: cache.byId.size,
                ids: Array.from(cache.byId.keys())
            }
        };
    }
};
