// ========================================
// FILE: core/sync-engine/sync.js
// ========================================

/**
 * Sync Module - Sync Engine
 * 
 * Локальная версия синхронизации через SQLite.
 * Все операции выполняются напрямую в локальной базе данных.
 * 
 * @module sync-engine/sync
 * @version 2.0.0
 * @changes
 * - v2.0.0: Полный переход на SQLite, удалены все вызовы Supabase
 * - Операции выполняются напрямую через sqlite-client
 * - Добавлена обработка фото в локальном хранилище
 */

import sqlite from '../sqlite-client.js';
import { cacheGet, cacheSet, cacheDelete } from './db.js';
import { 
    logSyncEvent, 
    logError, 
    logInfo 
} from './logger.js';

// ========== КОНСТАНТЫ ==========

export const ENTITIES = {
    PRODUCTS: 'products',
    SALES: 'sales',
    SHIFTS: 'shifts'
};

export const OP_TYPES = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete'
};

export const PRIORITIES = {
    [ENTITIES.SALES]: 1,
    [ENTITIES.SHIFTS]: 2,
    [ENTITIES.PRODUCTS]: 3
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Сохраняет фото локально в формате base64
 * @param {string} photoUrl - URL фото
 * @returns {Promise<string>} Локальный URL фото
 */
async function storePhotoLocally(photoUrl) {
    if (!photoUrl) return null;
    
    try {
        // Если это уже data URL, возвращаем как есть
        if (photoUrl.startsWith('data:')) {
            return photoUrl;
        }
        
        // Пытаемся загрузить фото и конвертировать в base64
        const response = await fetch(photoUrl);
        if (!response.ok) {
            console.warn('[Sync] Failed to fetch photo:', photoUrl);
            return photoUrl; // Возвращаем оригинальный URL если не удалось загрузить
        }
        
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn('[Sync] Photo storage error:', error);
        return photoUrl; // Возвращаем оригинальный URL при ошибке
    }
}

/**
 * Сохраняет фото из файла в base64
 * @param {File|Blob} file - Файл изображения
 * @returns {Promise<string>} Data URL фото
 */
async function storePhotoFromFile(file) {
    if (!file) return null;
    
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

// ========== СИНХРОНИЗАЦИЯ ОПЕРАЦИЙ ==========

/**
 * Синхронизирует операцию создания
 */
async function syncCreate(op) {
    const { entity, data, id: opId } = op;
    const startTime = Date.now();
    
    try {
        switch (entity) {
            case ENTITIES.PRODUCTS: {
                const productId = sqlite.generateId();
                const productData = {
                    id: productId,
                    name: data.name || 'Без названия',
                    price: data.price || 0,
                    cost_price: data.cost_price || 0,
                    category: data.category || 'other',
                    status: data.status || 'in_stock',
                    photo_url: data.photo_url || null,
                    created_by: data.created_by || null,
                    attributes: typeof data.attributes === 'object' 
                        ? JSON.stringify(data.attributes) 
                        : (data.attributes || '{}'),
                    created_at: new Date().toISOString(),
                    sold_at: null,
                    _deleted: 0,
                    _optimistic: 0
                };
                
                sqlite.execute(`
                    INSERT INTO products (id, name, price, cost_price, category, status, photo_url, created_by, attributes, created_at, sold_at, _deleted, _optimistic)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    productData.id,
                    productData.name,
                    productData.price,
                    productData.cost_price,
                    productData.category,
                    productData.status,
                    productData.photo_url,
                    productData.created_by,
                    productData.attributes,
                    productData.created_at,
                    productData.sold_at,
                    productData._deleted,
                    productData._optimistic
                ]);
                
                await updateLocalCache(entity, productData);
                
                logSyncEvent('create', 'create', entity, {
                    entityId: opId,
                    details: {
                        productId: productId,
                        duration: Date.now() - startTime
                    }
                });
                return true;
            }
                
            case ENTITIES.SALES: {
                const saleId = sqlite.generateId();
                const saleData = {
                    id: saleId,
                    shift_id: data.shift_id || null,
                    items: typeof data.items === 'object' ? JSON.stringify(data.items) : (data.items || '[]'),
                    total: data.total || 0,
                    profit: data.profit || 0,
                    payment_method: data.payment_method || 'cash',
                    created_by: data.created_by || null,
                    created_at: data.created_at || new Date().toISOString()
                };
                
                sqlite.execute(`
                    INSERT INTO sales (id, shift_id, items, total, profit, payment_method, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    saleData.id,
                    saleData.shift_id,
                    saleData.items,
                    saleData.total,
                    saleData.profit,
                    saleData.payment_method,
                    saleData.created_by,
                    saleData.created_at
                ]);
                
                logSyncEvent('create', 'create', entity, {
                    entityId: opId,
                    details: {
                        saleTotal: data.total,
                        duration: Date.now() - startTime
                    }
                });
                return true;
            }
                
            case ENTITIES.SHIFTS: {
                const shiftId = sqlite.generateId();
                const shiftData = {
                    id: shiftId,
                    user_id: data.user_id || null,
                    opened_at: data.opened_at || new Date().toISOString(),
                    closed_at: data.closed_at || null,
                    initial_cash: data.initial_cash || 0,
                    final_cash: data.final_cash || null,
                    total_revenue: data.total_revenue || 0,
                    total_profit: data.total_profit || 0,
                    sales_count: data.sales_count || 0,
                    items_count: data.items_count || 0,
                    status: data.status || 'active'
                };
                
                sqlite.execute(`
                    INSERT INTO shifts (id, user_id, opened_at, closed_at, initial_cash, final_cash, total_revenue, total_profit, sales_count, items_count, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    shiftData.id,
                    shiftData.user_id,
                    shiftData.opened_at,
                    shiftData.closed_at,
                    shiftData.initial_cash,
                    shiftData.final_cash,
                    shiftData.total_revenue,
                    shiftData.total_profit,
                    shiftData.sales_count,
                    shiftData.items_count,
                    shiftData.status
                ]);
                
                logSyncEvent('create', 'create', entity, {
                    entityId: opId,
                    details: {
                        duration: Date.now() - startTime
                    }
                });
                return true;
            }
                
            default:
                logInfo(`Sync create skipped: unknown entity ${entity}`, {
                    entity,
                    entityId: opId
                });
                return true;
        }
    } catch (error) {
        logError(`Sync create ${entity} failed`, error, {
            entity,
            entityId: opId,
            details: {
                duration: Date.now() - startTime
            }
        });
        throw error;
    }
}

/**
 * Синхронизирует операцию обновления
 */
async function syncUpdate(op) {
    const { entity, data, id: opId } = op;
    const itemId = data.id;
    const startTime = Date.now();
    
    if (!itemId) {
        logInfo(`Sync update skipped: no id for ${entity}`, {
            entity,
            entityId: opId
        });
        return true;
    }
    
    try {
        switch (entity) {
            case ENTITIES.PRODUCTS: {
                const updateData = {};
                const params = [];
                
                if (data.name !== undefined) {
                    updateData.name = data.name;
                }
                if (data.price !== undefined) {
                    updateData.price = data.price;
                }
                if (data.cost_price !== undefined) {
                    updateData.cost_price = data.cost_price;
                }
                if (data.category !== undefined) {
                    updateData.category = data.category;
                }
                if (data.status !== undefined) {
                    updateData.status = data.status;
                }
                if (data.sold_at !== undefined) {
                    updateData.sold_at = data.sold_at;
                }
                if (data.photo_url !== undefined) {
                    updateData.photo_url = data.photo_url;
                }
                if (data.attributes !== undefined) {
                    updateData.attributes = typeof data.attributes === 'object' 
                        ? JSON.stringify(data.attributes) 
                        : data.attributes;
                }
                
                const setClauses = [];
                Object.entries(updateData).forEach(([key, value]) => {
                    setClauses.push(`${key} = ?`);
                    params.push(value);
                });
                
                if (setClauses.length > 0) {
                    params.push(itemId);
                    sqlite.execute(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`, params);
                }
                
                // Получаем обновлённый товар для кэша
                const updatedProduct = sqlite.selectOne('SELECT * FROM products WHERE id = ?', [itemId]);
                await updateLocalCache(entity, updatedProduct);
                
                logSyncEvent('update', 'update', entity, {
                    entityId: opId,
                    details: {
                        productId: itemId,
                        duration: Date.now() - startTime
                    }
                });
                return true;
            }
                
            case ENTITIES.SALES:
            case ENTITIES.SHIFTS:
                // Для продаж и смен пока не поддерживаем обновление через синхронизацию
                logInfo(`Sync update skipped for ${entity}`, {
                    entity,
                    entityId: opId
                });
                return true;
                
            default:
                logInfo(`Sync update skipped: unknown entity ${entity}`, {
                    entity,
                    entityId: opId
                });
                return true;
        }
    } catch (error) {
        logError(`Sync update ${entity} failed`, error, {
            entity,
            entityId: opId,
            details: {
                itemId,
                duration: Date.now() - startTime
            }
        });
        throw error;
    }
}

/**
 * Синхронизирует операцию удаления
 */
async function syncDelete(op) {
    const { entity, data, id: opId } = op;
    const itemId = data.id;
    const startTime = Date.now();
    
    if (!itemId) {
        logInfo(`Sync delete skipped: no id for ${entity}`, {
            entity,
            entityId: opId
        });
        return true;
    }
    
    try {
        switch (entity) {
            case ENTITIES.PRODUCTS: {
                // Получаем товар перед удалением для проверки
                const existing = sqlite.selectOne('SELECT * FROM products WHERE id = ?', [itemId]);
                
                if (!existing || existing.status === 'sold') {
                    logInfo(`Sync delete skipped: product ${itemId} not found or already sold`, {
                        entity,
                        entityId: opId,
                        details: {
                            productId: itemId,
                            reason: existing ? 'already sold' : 'not found'
                        }
                    });
                    return true;
                }
                
                // Удаляем товар
                sqlite.execute('DELETE FROM products WHERE id = ?', [itemId]);
                await removeFromLocalCache(entity, itemId);
                
                logSyncEvent('delete', 'delete', entity, {
                    entityId: opId,
                    details: {
                        productId: itemId,
                        duration: Date.now() - startTime
                    }
                });
                return true;
            }
                
            case ENTITIES.SALES:
            case ENTITIES.SHIFTS:
                // Для продаж и смен пока не поддерживаем удаление через синхронизацию
                logInfo(`Sync delete skipped for ${entity}`, {
                    entity,
                    entityId: opId
                });
                return true;
                
            default:
                logInfo(`Sync delete skipped: unknown entity ${entity}`, {
                    entity,
                    entityId: opId
                });
                return true;
        }
    } catch (error) {
        logError(`Sync delete ${entity} failed`, error, {
            entity,
            entityId: opId,
            details: {
                itemId,
                duration: Date.now() - startTime
            }
        });
        throw error;
    }
}

/**
 * Синхронизирует одну операцию
 */
export async function syncOperation(op) {
    try {
        switch (op.type) {
            case OP_TYPES.CREATE: return await syncCreate(op);
            case OP_TYPES.UPDATE: return await syncUpdate(op);
            case OP_TYPES.DELETE: return await syncDelete(op);
            default:
                logInfo(`Sync operation skipped: unknown type ${op.type}`, {
                    entity: op.entity,
                    entityId: op.id
                });
                return true;
        }
    } catch (error) {
        logError(`Sync operation ${op.type} ${op.entity} failed`, error, {
            entity: op.entity,
            entityId: op.id,
            details: {
                operationType: op.type
            }
        });
        throw error;
    }
}

// ========== ОБНОВЛЕНИЕ ЛОКАЛЬНОГО КЭША ==========

async function updateLocalCache(entity, data) {
    if (!data) return;
    
    if (entity === ENTITIES.PRODUCTS) {
        const cached = await cacheGet(entity, 'all', null) || [];
        const index = cached.findIndex(p => p.id === data.id);
        if (index !== -1) {
            cached[index] = data;
        } else {
            cached.unshift(data);
        }
        await cacheSet(entity, 'all', cached);
    }
}

async function removeFromLocalCache(entity, id) {
    if (entity === ENTITIES.PRODUCTS) {
        const cached = await cacheGet(entity, 'all', null) || [];
        const filtered = cached.filter(p => p.id !== id);
        await cacheSet(entity, 'all', filtered);
    }
}

/**
 * Оптимистично обновляет локальный кэш
 */
export async function updateLocalCacheOptimistic(entity, type, data) {
    if (entity !== ENTITIES.PRODUCTS) return;
    
    const cached = await cacheGet(entity, 'all', null) || [];
    
    switch (type) {
        case OP_TYPES.CREATE:
            cached.unshift({ ...data, _optimistic: true });
            break;
        case OP_TYPES.UPDATE:
            const updateIndex = cached.findIndex(p => p.id === data.id);
            if (updateIndex !== -1) {
                cached[updateIndex] = { ...cached[updateIndex], ...data, _optimistic: true };
            }
            break;
        case OP_TYPES.DELETE:
            const deleteIndex = cached.findIndex(p => p.id === data.id);
            if (deleteIndex !== -1) cached.splice(deleteIndex, 1);
            break;
    }
    
    await cacheSet(entity, 'all', cached);
}
