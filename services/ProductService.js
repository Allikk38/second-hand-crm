// ========================================
// FILE: ./services/ProductService.js
// ========================================

/**
 * Product Service
 * 
 * Управление товарами: CRUD операции, кэширование, пагинация.
 * 
 * @module ProductService
 * @version 4.2.0
 * @changes
 * - Исправлена ошибка в getStats(): убран запрос несуществующей колонки 'stock'
 * - Поле totalStock теперь вычисляется как количество товаров в наличии
 * - Увеличен TTL кэша до 60 секунд
 * - Добавлен метод getByCategory()
 * - Добавлен метод getLowStock()
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';

// ========== КЭШ ==========
const CACHE_TTL = 60000; // 60 секунд (увеличено)

const cache = {
    all: {
        data: null,
        timestamp: 0
    },
    byId: new Map(),
    inStock: {
        data: null,
        timestamp: 0
    },
    byCategory: new Map() // category -> { data, timestamp }
};

function isCacheValid(timestamp) {
    return timestamp > 0 && (Date.now() - timestamp) < CACHE_TTL;
}

function invalidateCache(productId = null) {
    cache.all.timestamp = 0;
    cache.all.data = null;
    cache.inStock.timestamp = 0;
    cache.inStock.data = null;
    cache.byCategory.clear();
    
    if (productId) {
        cache.byId.delete(productId);
    } else {
        cache.byId.clear();
    }
}

// ========== SERVICE ==========
export const ProductService = {
    /**
     * Получает все товары с пагинацией
     * @param {Object} options - Опции запроса
     * @returns {Promise<Array>}
     */
    async getAll(options = {}) {
        const { forceRefresh = false, limit, offset, category, status } = options;
        
        // Проверяем кэш только если нет фильтров
        if (!forceRefresh && !limit && !offset && !category && !status && isCacheValid(cache.all.timestamp)) {
            return cache.all.data;
        }
        
        let query = db
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (category) query = query.eq('category', category);
        if (status) query = query.eq('status', status);
        if (limit) query = query.limit(limit);
        if (offset) query = query.range(offset, offset + (limit || 1000) - 1);
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[ProductService] getAll error:', error);
            throw error;
        }
        
        // Кэшируем только полный список без фильтров
        if (!limit && !offset && !category && !status) {
            cache.all.data = data;
            cache.all.timestamp = Date.now();
        }
        
        return data || [];
    },

    /**
     * Получает товары по категории
     * @param {string} category - Категория
     * @param {boolean} forceRefresh - Игнорировать кэш
     * @returns {Promise<Array>}
     */
    async getByCategory(category, forceRefresh = false) {
        if (!category) return [];
        
        const cached = cache.byCategory.get(category);
        if (!forceRefresh && cached && isCacheValid(cached.timestamp)) {
            return cached.data;
        }
        
        const { data, error } = await db
            .from('products')
            .select('*')
            .eq('category', category)
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('[ProductService] getByCategory error:', error);
            throw error;
        }
        
        cache.byCategory.set(category, {
            data: data || [],
            timestamp: Date.now()
        });
        
        return data || [];
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
        
        cache.inStock.data = data || [];
        cache.inStock.timestamp = Date.now();
        
        return cache.inStock.data;
    },

    /**
     * Получает товары с низким остатком
     * В текущей версии БД нет поля stock, поэтому возвращает пустой массив
     * @param {number} threshold - Порог остатка (по умолчанию 5)
     * @returns {Promise<Array>}
     */
    async getLowStock(threshold = 5) {
        // В текущей схеме БД нет поля stock, возвращаем пустой массив
        console.warn('[ProductService] getLowStock: stock field not available in DB schema');
        return [];
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
        EventBus.emit('product:created', { product: data });
        
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
        
        const current = await this.getById(id);
        
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
        EventBus.emit('product:updated', { product: data, previous: current });
        
        return data;
    },

    /**
     * Обновляет статус товара
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
        
        const product = await this.getById(id);
        
        const { error } = await db
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) {
            console.error('[ProductService] delete error:', error);
            throw error;
        }
        
        invalidateCache(id);
        EventBus.emit('product:deleted', { id, product });
    },

    /**
     * Массовое обновление статусов
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
        EventBus.emit('product:bulk-updated', { ids, status });
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
        
        return data || [];
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
        
        const products = data || [];
        
        const stats = {
            total: products.length,
            inStock: products.filter(p => p.status === 'in_stock').length,
            sold: products.filter(p => p.status === 'sold').length,
            reserved: products.filter(p => p.status === 'reserved').length,
            totalValue: 0,
            totalCost: 0,
            totalStock: products.filter(p => p.status === 'in_stock').length
        };
        
        products.forEach(product => {
            if (product.status === 'in_stock') {
                stats.totalValue += product.price || 0;
                stats.totalCost += product.cost_price || 0;
            }
        });
        
        return stats;
    },

    /**
     * Проверяет, существует ли товар с таким именем
     * @param {string} name - Название товара
     * @param {string} excludeId - Исключить ID
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
     * Очищает кэш
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
                size: cache.byId.size
            },
            byCategory: {
                size: cache.byCategory.size
            }
        };
    }
};
