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
 * @version 1.3.0
 * @changes
 * - v1.3.0: syncNow() при инициализации откладывается на 3 секунды
 * - v1.3.0: loadData() защищён от параллельных запросов для одного entity
 * - v1.3.0: checkLoggerHealth() не делает запросов при cached результате
 * - v1.3.0: Интервал проверки логгера увеличен до 5 минут
 * - v1.3.0: Добавлен глобальный Map для отслеживания активных загрузок
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
    logInfo,
    logWarn,
    logError,
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
const LOGGER_CHECK_INTERVAL = 300000; // 5 минут (было 60000)
const INITIAL_SYNC_DELAY = 3000; // 3 секунды задержки перед первой синхронизацией

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

// Защита от параллельных загрузок одних и тех же данных
const activeLoads = new Map();

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
 * Проверяет здоровье логгера.
 * НЕ делает запросов если результат уже закэширован.
 */
async function checkLoggerHealth() {
    const status = getLoggerStatus();
    
    if (!status.initialized) {
        console.warn('[SyncEngine] Logger not initialized, initializing now...');
        await initLogger();
        return;
    }
    
    // Если таблица точно недоступна — не проверяем повторно
    if (status.tableAvailable === false) {
        // Только выводим статистику локальных логов
        if (status.localLogsCount > 0) {
            console.log('[SyncEngine] Logger table unavailable,', status.localLogsCount, 'logs stored locally');
        }
        return;
    }
    
    // Если таблица доступна и есть локальные логи — отправляем
    if (status.tableAvailable === true && status.localLogsCount > 0) {
        console.log('[SyncEngine] Found', status.localLogsCount, 'local logs, forcing flush');
        flushAllLogs();
        return;
    }
    
    // Статус неизвестен (null) — проверяем в первый раз
    if (status.tableAvailable === null) {
        console.log('[SyncEngine] Logger table status unknown, testing...');
        await testLoggerConnection();
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
    
    logInfo(`Operation enqueued: ${type} ${entity}`, { entity, entityId: op.id });
    
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
            logWarn(`Operation expired: ${op.id}`, { entity: op.entity });
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
                    logError(`Operation max retries exceeded: ${op.id}`, null, {
                        entity: op.entity
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
                entity: op.entity
            });
        }
    }
    
    syncState.isSyncing = false;
    syncState.lastSyncTime = Date.now();
    await updatePendingCount();
    notifyListeners({ type: 'sync-completed', synced, failed });
    
    logInfo('Sync completed', {
        entity: 'system',
        details: {
            synced,
            failed,
            duration: Date.now() - startTime,
            remaining: syncState.pendingCount
        }
    });
    
    // Фоновая отправка логов — не блокирует
    if (synced > 0 || failed > 0) {
        flushAllLogs();
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
    notifyListeners({ type: 'online' });
    
    // При восстановлении сети — синхронизация с задержкой
    setTimeout(() => {
        syncNow();
        checkLoggerHealth();
    }, 2000);
});

window.addEventListener('offline', () => {
    syncState.isOnline = false;
    logNetworkEvent('offline');
    notifyListeners({ type: 'offline' });
});

// ========== ПУБЛИЧНЫЙ API ==========

/**
 * Загружает данные с кэшированием.
 * Защищён от параллельных запросов для одного entity+id.
 * 
 * @param {string} entity - Тип сущности
 * @param {Object} options - Опции
 * @param {string} options.id - ID данных
 * @param {Function} options.fetcher - Функция-загрузчик
 * @param {number} [options.maxAge=300000] - Максимальный возраст кэша в мс
 * @returns {Promise<{data: any, fromCache: boolean}>}
 */
export async function loadData(entity, options = {}) {
    const { id = 'all', fetcher, maxAge = 5 * 60 * 1000 } = options;
    const loadKey = `${entity}:${id}`;
    
    // Защита от параллельных загрузок
    if (activeLoads.has(loadKey)) {
        console.log('[SyncEngine] Load already in progress for', loadKey, '- waiting for existing promise');
        return activeLoads.get(loadKey);
    }
    
    // Создаём промис и сохраняем его
    const loadPromise = _loadDataInternal(entity, id, fetcher, maxAge, loadKey);
    activeLoads.set(loadKey, loadPromise);
    
    try {
        const result = await loadPromise;
        return result;
    } finally {
        // Удаляем из активных после завершения
        activeLoads.delete(loadKey);
    }
}

/**
 * Внутренняя реализация загрузки данных.
 */
async function _loadDataInternal(entity, id, fetcher, maxAge, loadKey) {
    // Пробуем загрузить из кэша
    const cached = await cacheGet(entity, id, maxAge);
    
    if (cached) {
        // Данные есть в кэше — возвращаем сразу
        // Фоновое обновление запускаем если онлайн и есть fetcher
        if (syncState.isOnline && fetcher) {
            // НЕ запускаем фоновое обновление если уже есть активная загрузка для этого entity
            const existingLoad = activeLoads.get(loadKey + '_bg');
            if (!existingLoad) {
                const bgPromise = fetcher()
                    .then(data => {
                        cacheSet(entity, id, data);
                        console.log('[SyncEngine] Background refresh completed for', entity);
                    })
                    .catch(err => {
                        logWarn(`Background refresh failed: ${entity}`, {
                            entity,
                            details: { error: err.message }
                        });
                    });
                activeLoads.set(loadKey + '_bg', bgPromise);
                bgPromise.finally(() => activeLoads.delete(loadKey + '_bg'));
            }
        }
        return { data: cached, fromCache: true };
    }
    
    // Нет кэша — загружаем с сервера
    if (fetcher) {
        try {
            const startTime = Date.now();
            const data = await fetcher();
            await cacheSet(entity, id, data);
            
            logPerformance(`load_${entity}`, Date.now() - startTime, {
                entity,
                details: { count: data?.length || 0 }
            });
            
            return { data, fromCache: false };
        } catch (error) {
            logError(`Failed to load ${entity}`, error, { entity });
            throw error;
        }
    }
    
    return { data: null, fromCache: false };
}

export async function saveChange(entity, type, data, originalData = null) {
    await updateLocalCacheOptimistic(entity, type, data);
    return await enqueueOperation({ entity, type, data, originalData });
}

/**
 * Инициализирует Sync Engine.
 * 
 * ВАЖНО: 
 * - initLogger() не блокирует (проверка таблицы в фоне)
 * - syncNow() откладывается на 3 секунды чтобы не конкурировать с основными запросами
 * - flushAllLogs() вызывается БЕЗ await
 */
export async function initSyncEngine() {
    console.log('[SyncEngine] Initializing...');
    
    // Инициализируем логгер (НЕ БЛОКИРУЕТ — проверка таблицы в фоне)
    await initLogger();
    
    // Проверяем здоровье логгера (быстро, использует кэш)
    await checkLoggerHealth();
    
    try {
        await openDatabase();
        await updatePendingCount();
        startBackgroundSync();
        
        // ОТЛОЖЕННАЯ синхронизация — не конкурирует с основными запросами
        if (syncState.isOnline) {
            setTimeout(() => {
                console.log('[SyncEngine] Starting delayed initial sync...');
                syncNow();
            }, INITIAL_SYNC_DELAY);
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
        
        // Отправляем логи в фоне, не блокируем загрузку
        flushAllLogs();
        
    } catch (error) {
        console.error('[SyncEngine] Init failed:', error);
        logError('Sync engine init failed', error, { entity: 'system' });
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

// Диагностический API для консоли браузера
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
