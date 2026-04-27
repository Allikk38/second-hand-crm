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
 * @version 1.2.0
 * @changes
 * - Добавлен вызов initLogger() при инициализации
 * - Добавлен диагностический вывод статуса логгера
 * - Добавлен лог успешной отправки логов
 * - Экспортирован getLoggerStatus для диагностики из консоли
 * - Добавлена проверка доступности таблицы логирования
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

import {
    info as logInfo,
    warn as logWarn,
    error as logError,
    logSyncEvent,
    logPerformance,
    logNetworkEvent,
    initLogger,
    testLoggerConnection,
    getLoggerStatus,
    flushAllLogs,
    CATEGORIES
} from './logger.js';

// ========== КОНСТАНТЫ ==========

const MAX_RETRY_COUNT = 10;
const BASE_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 300000;
const SYNC_INTERVAL = 30000;
const OPERATION_TTL = 7 * 24 * 60 * 60 * 1000;
const LOGGER_CHECK_INTERVAL = 60000; // Проверка логгера раз в минуту

// ========== СОСТОЯНИЕ ==========

export const syncState = {
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSyncTime: null,
    pendingCount: 0,
    syncInterval: null,
    loggerCheckInterval: null,
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

// ========== ДИАГНОСТИКА ЛОГГЕРА ==========

/**
 * Проверяет состояние логгера и логирует результат
 */
async function checkLoggerHealth() {
    const status = getLoggerStatus();
    
    if (!status.initialized) {
        console.warn('[SyncEngine] Logger not initialized, initializing now...');
        await initLogger();
        return;
    }
    
    if (status.tableAvailable === false) {
        console.warn('[SyncEngine] Logger table not available, logs saved locally');
        logInfo('logger_status', {
            entity: 'system',
            details: { 
                tableAvailable: false, 
                localLogs: status.localLogsCount,
                bufferSize: status.bufferSize,
                lastError: status.lastFlushError
            }
        });
    } else if (status.tableAvailable === null) {
        console.log('[SyncEngine] Logger table status unknown, testing...');
        const result = await testLoggerConnection();
        console.log('[SyncEngine] Logger test result:', result);
    }
    
    // Если есть локальные логи и таблица доступна — они отправятся при следующем flush
    if (status.tableAvailable && status.localLogsCount > 0) {
        console.log('[SyncEngine] Found', status.localLogsCount, 'local logs, forcing flush');
        await flushAllLogs();
    }
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
    
    logInfo(`Operation enqueued: ${type} ${entity}`, { opId: op.id });
    
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
    
    logInfo(`Sync started: ${pendingOps.length} operations`, {
        entity: 'system',
        details: { pendingCount: pendingOps.length }
    });
    
    const startTime = Date.now();
    
    let synced = 0, failed = 0;
    
    for (const op of pendingOps) {
        if (Date.now() - op.timestamp > OPERATION_TTL) {
            await dbRemoveOperation(op.id);
            logWarn(`Operation expired: ${op.id}`, { details: { op } });
            continue;
        }
        
        await dbUpdateOperation(op.id, { status: 'syncing' });
        
        try {
            const success = await syncOperation(op);
            
            if (success) {
                await dbRemoveOperation(op.id);
                synced++;
                logSyncEvent('operation_synced', op.type, op.entity, {
                    entityId: op.id,
                    details: { success: true }
                });
            } else {
                const newRetry = op.retryCount + 1;
                if (newRetry >= MAX_RETRY_COUNT) {
                    await dbUpdateOperation(op.id, { status: 'failed', retryCount: newRetry });
                    logError(`Operation max retries exceeded: ${op.id}`, null, {
                        entity: op.entity,
                        details: { op }
                    });
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
            logError(`Sync operation failed: ${op.id}`, error, {
                entity: op.entity,
                details: { op }
            });
        }
    }
    
    syncState.isSyncing = false;
    syncState.lastSyncTime = Date.now();
    await updatePendingCount();
    notifyListeners({ type: 'sync-completed', synced, failed });
    
    logInfo(`Sync completed`, {
        entity: 'system',
        details: {
            synced,
            failed,
            duration: Date.now() - startTime,
            remaining: syncState.pendingCount
        }
    });
    
    // После синхронизации проверяем логгер
    if (synced > 0 || failed > 0) {
        await flushAllLogs();
    }
    
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
    
    // Периодическая проверка логгера
    if (syncState.loggerCheckInterval) clearInterval(syncState.loggerCheckInterval);
    syncState.loggerCheckInterval = setInterval(() => {
        checkLoggerHealth();
    }, LOGGER_CHECK_INTERVAL);
    
    console.log('[SyncEngine] Background sync and logger check started');
}

export function stopBackgroundSync() {
    if (syncState.syncInterval) {
        clearInterval(syncState.syncInterval);
        syncState.syncInterval = null;
    }
    if (syncState.loggerCheckInterval) {
        clearInterval(syncState.loggerCheckInterval);
        syncState.loggerCheckInterval = null;
    }
}

// ========== СЕТЕВЫЕ СОБЫТИЯ ==========

window.addEventListener('online', () => {
    syncState.isOnline = true;
    logNetworkEvent('online');
    logInfo('Network online', { entity: 'network' });
    notifyListeners({ type: 'online' });
    syncNow();
    // При восстановлении сети проверяем логгер
    checkLoggerHealth();
});

window.addEventListener('offline', () => {
    syncState.isOnline = false;
    logNetworkEvent('offline');
    logWarn('Network offline', { entity: 'network' });
    notifyListeners({ type: 'offline' });
});

// ========== ПУБЛИЧНЫЙ API ==========

export async function loadData(entity, options = {}) {
    const { id = 'all', fetcher, maxAge = 5 * 60 * 1000 } = options;
    
    const cached = await cacheGet(entity, id, maxAge);
    
    if (cached) {
        logInfo(`Data loaded from cache: ${entity}`, {
            entity,
            entityId: id,
            details: { fromCache: true }
        });
        
        if (syncState.isOnline && fetcher) {
            fetcher().then(data => cacheSet(entity, id, data)).catch(err => {
                logWarn(`Background refresh failed: ${entity}`, { details: { error: err.message } });
            });
        }
        return { data: cached, fromCache: true };
    }
    
    if (fetcher) {
        try {
            const startTime = Date.now();
            const data = await fetcher();
            await cacheSet(entity, id, data);
            
            logPerformance(`load_${entity}`, Date.now() - startTime, {
                entity,
                entityId: id,
                details: { count: data?.length || 0 }
            });
            
            return { data, fromCache: false };
        } catch (error) {
            logError(`Failed to load ${entity}`, error, {
                entity,
                entityId: id
            });
            throw error;
        }
    }
    
    return { data: null, fromCache: false };
}

export async function saveChange(entity, type, data, originalData = null) {
    await updateLocalCacheOptimistic(entity, type, data);
    
    logInfo(`Change saved: ${type} ${entity}`, {
        entity,
        operationType: type,
        details: { data }
    });
    
    return await enqueueOperation({ entity, type, data, originalData });
}

export async function initSyncEngine() {
    console.log('[SyncEngine] Initializing...');
    
    // Первым делом инициализируем логгер
    await initLogger();
    
    // Проверяем здоровье логгера
    await checkLoggerHealth();
    
    try {
        await openDatabase();
        await updatePendingCount();
        startBackgroundSync();
        
        if (syncState.isOnline) {
            syncNow();
        }
        
        console.log('[SyncEngine] Initialized. Pending operations:', syncState.pendingCount);
        console.log('[SyncEngine] Logger status:', getLoggerStatus());
        
        logInfo('Sync engine initialized', {
            entity: 'system',
            details: { 
                pendingCount: syncState.pendingCount,
                isOnline: syncState.isOnline,
                loggerStatus: getLoggerStatus()
            }
        });
        
        // Принудительно сбрасываем логи после инициализации
        await flushAllLogs();
        
    } catch (error) {
        console.error('[SyncEngine] Init failed:', error);
        logError('Sync engine init failed', error, {
            entity: 'system'
        });
        throw error;
    }
}

// ========== ЭКСПОРТ ==========

export { ENTITIES, OP_TYPES };
export { cacheGet, cacheSet, cacheDelete, cacheClear } from './db.js';

export { 
    logInfo, 
    logWarn, 
    logError, 
    logSyncEvent, 
    logPerformance, 
    logNetworkEvent,
    logUserAction,
    logProductEvent,
    logSaleEvent,
    logShiftEvent,
    logAnomaly,
    logAuthEvent,
    measurePerformance,
    flushAllLogs,
    newSession,
    initLogger,
    testLoggerConnection,
    getLoggerStatus,
    CATEGORIES,
    LOG_LEVELS
} from './logger.js';

// Экспорт для диагностики из консоли браузера
if (typeof window !== 'undefined') {
    window.__syncEngine = {
        syncState,
        syncNow,
        initSyncEngine,
        getLoggerStatus,
        testLoggerConnection,
        getPendingOperations,
        flushAllLogs
    };
    console.log('[SyncEngine] Diagnostic API available at window.__syncEngine');
}

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
    logInfo,
    logWarn,
    logError,
    logSyncEvent,
    ENTITIES,
    OP_TYPES
};
