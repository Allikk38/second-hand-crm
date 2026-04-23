// ========================================
// FILE: core/sync-engine/index.js
// ========================================

/**
 * Sync Engine - Точка входа
 * 
 * Единый движок синхронизации для всего приложения.
 * Реализует стратегию "Cache First, Sync Later".
 * 
 * @module sync-engine
 * @version 1.0.0
 */

import {
    openDatabase,
    cacheGet,
    cacheSet,
    cacheDelete,
    cacheClear,
    enqueueOperation as dbEnqueueOperation,
    getPendingOperations as dbGetPendingOperations,
    updateOperation as dbUpdateOperation,
    removeOperation as dbRemoveOperation,
    generateOperationId
} from './db.js';

import {
    ENTITIES,
    OP_TYPES,
    PRIORITIES,
    syncOperation,
    updateLocalCacheOptimistic
} from './sync.js';

// ========== КОНСТАНТЫ ==========

const MAX_RETRY_COUNT = 10;
const BASE_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 300000;
const SYNC_INTERVAL = 30000;
const OPERATION_TTL = 7 * 24 * 60 * 60 * 1000;

// ========== СОСТОЯНИЕ ==========

export const syncState = {
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSyncTime: null,
    pendingCount: 0,
    syncInterval: null,
    listeners: new Set()
};

// ========== УТИЛИТЫ ==========

function getDeviceId() {
    let deviceId = localStorage.getItem('sh_device_id');
    if (!deviceId) {
        deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sh_device_id', deviceId);
    }
    return deviceId;
}

function notifyListeners(event = null) {
    syncState.listeners.forEach(listener => {
        try { listener(syncState, event); } catch (e) {}
    });
}

async function updatePendingCount() {
    const ops = await dbGetPendingOperations();
    syncState.pendingCount = ops.length;
}

// ========== ПОДПИСКА ==========

export function subscribeToSync(listener) {
    syncState.listeners.add(listener);
    return () => syncState.listeners.delete(listener);
}

// ========== РАБОТА С ОЧЕРЕДЬЮ ==========

export async function enqueueOperation(operation) {
    const { entity, type, data, originalData = null } = operation;
    
    const op = {
        id: generateOperationId(),
        entity,
        type,
        data,
        originalData,
        status: 'pending',
        priority: PRIORITIES[entity] || 99,
        retryCount: 0,
        timestamp: Date.now(),
        deviceId: getDeviceId(),
        error: null
    };
    
    await dbEnqueueOperation(op);
    await updatePendingCount();
    notifyListeners({ type: 'operation-added', operation: op });
    
    if (syncState.isOnline) syncNow();
    return op.id;
}

export const getPendingOperations = dbGetPendingOperations;
export const updateOperation = dbUpdateOperation;
export const removeOperation = dbRemoveOperation;

// ========== СИНХРОНИЗАЦИЯ ==========

export async function syncNow() {
    if (syncState.isSyncing || !syncState.isOnline) return;
    
    const pendingOps = await dbGetPendingOperations();
    if (pendingOps.length === 0) return;
    
    syncState.isSyncing = true;
    notifyListeners({ type: 'sync-started' });
    
    console.log('[SyncEngine] Syncing', pendingOps.length, 'operations');
    
    let synced = 0, failed = 0;
    
    for (const op of pendingOps) {
        if (Date.now() - op.timestamp > OPERATION_TTL) {
            await dbRemoveOperation(op.id);
            continue;
        }
        
        await dbUpdateOperation(op.id, { status: 'syncing' });
        
        try {
            const success = await syncOperation(op);
            
            if (success) {
                await dbRemoveOperation(op.id);
                synced++;
            } else {
                const newRetry = op.retryCount + 1;
                if (newRetry >= MAX_RETRY_COUNT) {
                    await dbUpdateOperation(op.id, { status: 'failed', retryCount: newRetry });
                } else {
                    await dbUpdateOperation(op.id, { status: 'pending', retryCount: newRetry });
                }
                failed++;
            }
        } catch (error) {
            const newRetry = op.retryCount + 1;
            await dbUpdateOperation(op.id, {
                status: newRetry >= MAX_RETRY_COUNT ? 'failed' : 'pending',
                retryCount: newRetry,
                error: error.message
            });
            failed++;
        }
    }
    
    syncState.isSyncing = false;
    syncState.lastSyncTime = Date.now();
    await updatePendingCount();
    notifyListeners({ type: 'sync-completed', synced, failed });
    
    if (failed > 0) scheduleRetry();
}

function scheduleRetry() {
    const delay = Math.min(
        BASE_RETRY_DELAY * Math.pow(1.5, Math.min(syncState.pendingCount, 10)),
        MAX_RETRY_DELAY
    );
    setTimeout(() => { if (syncState.isOnline) syncNow(); }, delay);
}

// ========== ФОНОВАЯ СИНХРОНИЗАЦИЯ ==========

export function startBackgroundSync() {
    if (syncState.syncInterval) clearInterval(syncState.syncInterval);
    syncState.syncInterval = setInterval(() => {
        if (syncState.isOnline && !syncState.isSyncing) syncNow();
    }, SYNC_INTERVAL);
}

export function stopBackgroundSync() {
    if (syncState.syncInterval) {
        clearInterval(syncState.syncInterval);
        syncState.syncInterval = null;
    }
}

// ========== СЕТЕВЫЕ СОБЫТИЯ ==========

window.addEventListener('online', () => {
    syncState.isOnline = true;
    notifyListeners({ type: 'online' });
    syncNow();
});

window.addEventListener('offline', () => {
    syncState.isOnline = false;
    notifyListeners({ type: 'offline' });
});

// ========== ПУБЛИЧНЫЙ API ==========

export async function loadData(entity, options = {}) {
    const { id = 'all', fetcher, maxAge = 5 * 60 * 1000 } = options;
    
    const cached = await cacheGet(entity, id, maxAge);
    
    if (cached) {
        if (syncState.isOnline && fetcher) {
            fetcher().then(data => cacheSet(entity, id, data)).catch(() => {});
        }
        return { data: cached, fromCache: true };
    }
    
    if (fetcher) {
        const data = await fetcher();
        await cacheSet(entity, id, data);
        return { data, fromCache: false };
    }
    
    return { data: null, fromCache: false };
}

export async function saveChange(entity, type, data, originalData = null) {
    await updateLocalCacheOptimistic(entity, type, data);
    return await enqueueOperation({ entity, type, data, originalData });
}

export async function initSyncEngine() {
    await openDatabase();
    await updatePendingCount();
    startBackgroundSync();
    if (syncState.isOnline) syncNow();
    console.log('[SyncEngine] Initialized. Pending:', syncState.pendingCount);
}

// ========== ЭКСПОРТ КОНСТАНТ ==========

export { ENTITIES, OP_TYPES };
export { cacheGet, cacheSet, cacheDelete, cacheClear } from './db.js';

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    syncState,
    initSyncEngine,
    subscribeToSync,
    loadData,
    saveChange,
    cacheGet,
    cacheSet,
    cacheDelete,
    cacheClear,
    enqueueOperation,
    getPendingOperations,
    removeOperation,
    syncNow,
    startBackgroundSync,
    stopBackgroundSync,
    ENTITIES,
    OP_TYPES
};
