// ========================================
// FILE: core/sync-engine/sync.js
// ========================================

/**
 * Sync Module - Sync Engine
 * 
 * Логика синхронизации операций с сервером Supabase.
 * 
 * @module sync-engine/sync
 * @version 1.0.0
 */

import { getSupabase } from '../auth.js';
import { cacheGet, cacheSet } from './db.js';

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
    const { entity, data } = op;
    
    switch (entity) {
        case ENTITIES.PRODUCTS:
            const { data: product, error } = await supabase
                .from('products')
                .insert(data)
                .select()
                .single();
            if (error) throw error;
            await updateLocalCache(entity, product);
            return true;
            
        case ENTITIES.SALES:
            const { error: saleError } = await supabase
                .from('sales')
                .insert(data);
            if (saleError) throw saleError;
            return true;
            
        case ENTITIES.SHIFTS:
            const { error: shiftError } = await supabase
                .from('shifts')
                .insert(data);
            if (shiftError) throw shiftError;
            return true;
            
        default:
            console.warn('[Sync] Unknown entity for create:', entity);
            return true;
    }
}

/**
 * Синхронизирует операцию обновления
 */
async function syncUpdate(supabase, op) {
    const { entity, data } = op;
    const id = data.id;
    
    if (!id) {
        console.warn('[Sync] Update operation without id');
        return true;
    }
    
    switch (entity) {
        case ENTITIES.PRODUCTS:
            const { data: product, error } = await supabase
                .from('products')
                .update(data)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            await updateLocalCache(entity, product);
            return true;
            
        default:
            console.warn('[Sync] Unknown entity for update:', entity);
            return true;
    }
}

/**
 * Синхронизирует операцию удаления
 */
async function syncDelete(supabase, op) {
    const { entity, data } = op;
    const id = data.id;
    
    if (!id) {
        console.warn('[Sync] Delete operation without id');
        return true;
    }
    
    switch (entity) {
        case ENTITIES.PRODUCTS:
            const { data: existing, error: checkError } = await supabase
                .from('products')
                .select('id, status, photo_url')
                .eq('id', id)
                .maybeSingle();
            
            if (checkError && checkError.code !== 'PGRST116') throw checkError;
            if (!existing || existing.status === 'sold') return true;
            
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
                .eq('id', id);
            
            if (error) throw error;
            await removeFromLocalCache(entity, id);
            return true;
            
        default:
            console.warn('[Sync] Unknown entity for delete:', entity);
            return true;
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
            default: return true;
        }
    } catch (error) {
        console.error('[Sync] Operation error:', error);
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
