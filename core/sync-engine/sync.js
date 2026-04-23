// ========================================
// FILE: core/sync-engine/sync.js
// ========================================

/**
 * Sync Module - Sync Engine
 * 
 * Логика синхронизации операций с сервером Supabase.
 * 
 * @module sync-engine/sync
 * @version 1.1.0
 * @changes
 * - Добавлено логирование операций синхронизации
 */

import { getSupabase } from '../auth.js';
import { cacheGet, cacheSet } from './db.js';
import { logSyncEvent, error as logError, info as logInfo } from './logger.js';
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

// ========== СИНХРОНИЗАЦИЯ ОПЕРАЦИЙ ==========

/**
 * Синхронизирует операцию создания
 */
async function syncCreate(supabase, op) {
    const { entity, data, id: opId } = op;
    const startTime = Date.now();
    
    try {
        switch (entity) {
            case ENTITIES.PRODUCTS:
                const { data: product, error } = await supabase
                    .from('products')
                    .insert(data)
                    .select()
                    .single();
                if (error) throw error;
                await updateLocalCache(entity, product);
                
                logSyncOperation('create', entity, 'success', {
                    opId,
                    productId: product.id,
                    duration: Date.now() - startTime
                });
                return true;
                
            case ENTITIES.SALES:
                const { error: saleError } = await supabase
                    .from('sales')
                    .insert(data);
                if (saleError) throw saleError;
                
                logSyncOperation('create', entity, 'success', {
                    opId,
                    saleTotal: data.total,
                    duration: Date.now() - startTime
                });
                return true;
                
            case ENTITIES.SHIFTS:
                const { error: shiftError } = await supabase
                    .from('shifts')
                    .insert(data);
                if (shiftError) throw shiftError;
                
                logSyncOperation('create', entity, 'success', {
                    opId,
                    duration: Date.now() - startTime
                });
                return true;
                
            default:
                logSyncOperation('create', entity, 'skipped', { opId, reason: 'unknown entity' });
                return true;
        }
    } catch (error) {
        logError(`Sync create ${entity} failed`, error, {
            opId,
            entity,
            duration: Date.now() - startTime
        });
        throw error;
    }
}

/**
 * Синхронизирует операцию обновления
 */
async function syncUpdate(supabase, op) {
    const { entity, data, id: opId } = op;
    const itemId = data.id;
    const startTime = Date.now();
    
    if (!itemId) {
        logSyncOperation('update', entity, 'skipped', { opId, reason: 'no id' });
        return true;
    }
    
    try {
        switch (entity) {
            case ENTITIES.PRODUCTS:
                const { data: product, error } = await supabase
                    .from('products')
                    .update(data)
                    .eq('id', itemId)
                    .select()
                    .single();
                if (error) throw error;
                await updateLocalCache(entity, product);
                
                logSyncOperation('update', entity, 'success', {
                    opId,
                    productId: itemId,
                    duration: Date.now() - startTime
                });
                return true;
                
            default:
                logSyncOperation('update', entity, 'skipped', { opId, reason: 'unknown entity' });
                return true;
        }
    } catch (error) {
        logError(`Sync update ${entity} failed`, error, {
            opId,
            entity,
            itemId,
            duration: Date.now() - startTime
        });
        throw error;
    }
}

/**
 * Синхронизирует операцию удаления
 */
async function syncDelete(supabase, op) {
    const { entity, data, id: opId } = op;
    const itemId = data.id;
    const startTime = Date.now();
    
    if (!itemId) {
        logSyncOperation('delete', entity, 'skipped', { opId, reason: 'no id' });
        return true;
    }
    
    try {
        switch (entity) {
            case ENTITIES.PRODUCTS:
                const { data: existing, error: checkError } = await supabase
                    .from('products')
                    .select('id, status, photo_url')
                    .eq('id', itemId)
                    .maybeSingle();
                
                if (checkError && checkError.code !== 'PGRST116') throw checkError;
                if (!existing || existing.status === 'sold') {
                    logSyncOperation('delete', entity, 'skipped', {
                        opId,
                        productId: itemId,
                        reason: existing ? 'already sold' : 'not found'
                    });
                    return true;
                }
                
                if (existing.photo_url) {
                    const photoPath = existing.photo_url.split('/').pop();
                    if (photoPath) {
                        await supabase.storage
                            .from('product-photos')
                            .remove([photoPath]);
                    }
                }
                
                const { error } = await supabase
                    .from('products')
                    .delete()
                    .eq('id', itemId);
                
                if (error) throw error;
                await removeFromLocalCache(entity, itemId);
                
                logSyncOperation('delete', entity, 'success', {
                    opId,
                    productId: itemId,
                    duration: Date.now() - startTime
                });
                return true;
                
            default:
                logSyncOperation('delete', entity, 'skipped', { opId, reason: 'unknown entity' });
                return true;
        }
    } catch (error) {
        logError(`Sync delete ${entity} failed`, error, {
            opId,
            entity,
            itemId,
            duration: Date.now() - startTime
        });
        throw error;
    }
}

/**
 * Синхронизирует одну операцию
 */
export async function syncOperation(op) {
    const supabase = await getSupabase();
    
    try {
        switch (op.type) {
            case OP_TYPES.CREATE: return await syncCreate(supabase, op);
            case OP_TYPES.UPDATE: return await syncUpdate(supabase, op);
            case OP_TYPES.DELETE: return await syncDelete(supabase, op);
            default:
                logSyncOperation(op.type, op.entity, 'skipped', { opId: op.id, reason: 'unknown type' });
                return true;
        }
    } catch (error) {
        logError(`Sync operation ${op.type} ${op.entity} failed`, error, {
            opId: op.id,
            operationType: op.type,
            entity: op.entity
        });
        throw error;
    }
}

// ========== ОБНОВЛЕНИЕ ЛОКАЛЬНОГО КЭША ==========

async function updateLocalCache(entity, data) {
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
