// ========================================
// FILE: core/sync-engine.js
// ========================================

/**
 * Sync Engine - Единый движок синхронизации для всего приложения
 * 
 * Обеспечивает надёжную работу при нестабильном соединении с БД.
 * Реализует стратегию "Cache First, Sync Later":
 * - Данные мгновенно отдаются из локального кэша (IndexedDB)
 * - Все изменения сохраняются локально и ставятся в очередь синхронизации
 * - Фоновая синхронизация при восстановлении сети
 * - Автоматическое разрешение конфликтов
 * 
 * Архитектурные решения:
 * - IndexedDB для надёжного хранения (транзакции, большие объёмы)
 * - Единая очередь операций для всех сущностей
 * - Экспоненциальная задержка при повторных попытках
 * - Приоритизация операций (продажи > товары > смены)
 * - Интеграция с Supabase через getSupabase()
 * 
 * @module sync-engine
 * @version 1.0.0
 */

import { getSupabase } from './auth.js';

// ========== КОНСТАНТЫ ==========

const DB_NAME = 'sh_crm_sync';
const DB_VERSION = 1;
const MAX_RETRY_COUNT = 10;
const BASE_RETRY_DELAY = 5000; // 5 секунд
const MAX_RETRY_DELAY = 300000; // 5 минут
const SYNC_INTERVAL = 30000; // 30 секунд
const OPERATION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 дней

// Таблицы IndexedDB
const STORES = {
    CACHE: 'cache',           // Кэш данных с сервера
    OPERATIONS: 'operations', // Очередь операций
    META: 'meta'              // Метаданные синхронизации
};

// Типы сущностей
const ENTITIES = {
    PRODUCTS: 'products',
    SALES: 'sales',
    SHIFTS: 'shifts'
};

// Типы операций
const OP_TYPES = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete'
};

// Приоритеты операций (чем меньше число, тем выше приоритет)
const PRIORITIES = {
    [ENTITIES.SALES]: 1,
    [ENTITIES.SHIFTS]: 2,
    [ENTITIES.PRODUCTS]: 3
};

// ========== СОСТОЯНИЕ ==========

export const syncState = {
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSyncTime: null,
    pendingCount: 0,
    syncInterval: null,
    listeners: new Set()
};

// ========== ПОДПИСЧИКИ ==========

/**
 * Подписывается на изменения состояния синхронизации
 * @param {Function} listener - Функция-слушатель
 * @returns {Function} Функция для отписки
 */
export function subscribeToSync(listener) {
    syncState.listeners.add(listener);
    return () => syncState.listeners.delete(listener);
}

/**
 * Уведомляет всех подписчиков об изменении состояния
 */
function notifyListeners(event = null) {
    syncState.listeners.forEach(listener => {
        try {
            listener(syncState, event);
        } catch (e) {
            console.error('[SyncEngine] Listener error:', e);
        }
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ==========

/**
 * Открывает соединение с IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Хранилище кэша
            if (!db.objectStoreNames.contains(STORES.CACHE)) {
                const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
                cacheStore.createIndex('entity', 'entity', { unique: false });
                cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            
            // Хранилище операций
            if (!db.objectStoreNames.contains(STORES.OPERATIONS)) {
                const opsStore = db.createObjectStore(STORES.OPERATIONS, { keyPath: 'id' });
                opsStore.createIndex('entity', 'entity', { unique: false });
                opsStore.createIndex('status', 'status', { unique: false });
                opsStore.createIndex('priority', 'priority', { unique: false });
                opsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            
            // Хранилище метаданных
            if (!db.objectStoreNames.contains(STORES.META)) {
                db.createObjectStore(STORES.META, { keyPath: 'key' });
            }
        };
    });
}

/**
 * Выполняет транзакцию в IndexedDB
 * @param {string} storeName - Имя хранилища
 * @param {'readonly'|'readwrite'} mode - Режим
 * @param {Function} callback - Функция с транзакцией
 * @returns {Promise<any>}
 */
async function withTransaction(storeName, mode, callback) {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        
        let result;
        
        transaction.oncomplete = () => {
            db.close();
            resolve(result);
        };
        
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transaction aborted'));
        
        result = callback(store);
    });
}

// ========== РАБОТА С КЭШЕМ ==========

/**
 * Сохраняет данные в кэш
 * @param {string} entity - Тип сущности
 * @param {string} id - Ключ кэша (обычно query string)
 * @param {any} data - Данные для сохранения
 */
export async function cacheSet(entity, id, data) {
    const key = `${entity}:${id}`;
    const timestamp = Date.now();
    
    await withTransaction(STORES.CACHE, 'readwrite', (store) => {
        store.put({ key, entity, data, timestamp });
    });
}

/**
 * Получает данные из кэша
 * @param {string} entity - Тип сущности
 * @param {string} id - Ключ кэша
 * @param {number} [maxAge] - Максимальный возраст в мс
 * @returns {Promise<any|null>}
 */
export async function cacheGet(entity, id, maxAge = null) {
    const key = `${entity}:${id}`;
    
    const result = await withTransaction(STORES.CACHE, 'readonly', (store) => {
        return store.get(key);
    });
    
    if (!result) return null;
    
    if (maxAge && Date.now() - result.timestamp > maxAge) {
        await cacheDelete(entity, id);
        return null;
    }
    
    return result.data;
}

/**
 * Удаляет данные из кэша
 * @param {string} entity - Тип сущности
 * @param {string} id - Ключ кэша
 */
export async function cacheDelete(entity, id) {
    const key = `${entity}:${id}`;
    
    await withTransaction(STORES.CACHE, 'readwrite', (store) => {
        store.delete(key);
    });
}

/**
 * Очищает весь кэш для сущности
 * @param {string} entity - Тип сущности
 */
export async function cacheClear(entity = null) {
    await withTransaction(STORES.CACHE, 'readwrite', (store) => {
        if (entity) {
            const index = store.index('entity');
            const range = IDBKeyRange.only(entity);
            return index.openCursor(range).onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
        } else {
            store.clear();
        }
    });
}

// ========== РАБОТА С ОЧЕРЕДЬЮ ОПЕРАЦИЙ ==========

/**
 * Добавляет операцию в очередь
 * @param {Object} operation - Операция для добавления
 * @returns {Promise<string>} ID операции
 */
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
    
    await withTransaction(STORES.OPERATIONS, 'readwrite', (store) => {
        store.add(op);
    });
    
    await updatePendingCount();
    notifyListeners({ type: 'operation-added', operation: op });
    
    // Пытаемся синхронизировать сразу если онлайн
    if (syncState.isOnline) {
        syncNow();
    }
    
    return op.id;
}

/**
 * Получает все ожидающие операции, отсортированные по приоритету
 * @returns {Promise<Array>}
 */
export async function getPendingOperations() {
    const ops = await withTransaction(STORES.OPERATIONS, 'readonly', (store) => {
        const index = store.index('status');
        const range = IDBKeyRange.only('pending');
        return index.getAll(range);
    });
    
    // Сортируем по приоритету и времени
    return ops.sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        return a.timestamp - b.timestamp;
    });
}

/**
 * Обновляет статус операции
 * @param {string} id - ID операции
 * @param {Object} updates - Обновления
 */
export async function updateOperation(id, updates) {
    await withTransaction(STORES.OPERATIONS, 'readwrite', async (store) => {
        const op = await store.get(id);
        if (op) {
            Object.assign(op, updates);
            op.updatedAt = Date.now();
            store.put(op);
        }
    });
    
    await updatePendingCount();
    notifyListeners({ type: 'operation-updated', id, updates });
}

/**
 * Удаляет операцию из очереди
 * @param {string} id - ID операции
 */
export async function removeOperation(id) {
    await withTransaction(STORES.OPERATIONS, 'readwrite', (store) => {
        store.delete(id);
    });
    
    await updatePendingCount();
    notifyListeners({ type: 'operation-removed', id });
}

/**
 * Обновляет счётчик ожидающих операций
 */
async function updatePendingCount() {
    const ops = await getPendingOperations();
    syncState.pendingCount = ops.length;
}

// ========== СИНХРОНИЗАЦИЯ ==========

/**
 * Синхронизирует одну операцию с сервером
 * @param {Object} op - Операция
 * @returns {Promise<boolean>} true если успешно
 */
async function syncOperation(op) {
    const supabase = await getSupabase();
    
    try {
        switch (op.type) {
            case OP_TYPES.CREATE:
                return await syncCreate(supabase, op);
            case OP_TYPES.UPDATE:
                return await syncUpdate(supabase, op);
            case OP_TYPES.DELETE:
                return await syncDelete(supabase, op);
            default:
                console.warn('[SyncEngine] Unknown operation type:', op.type);
                return true; // Пропускаем
        }
    } catch (error) {
        console.error('[SyncEngine] Sync operation error:', error);
        throw error;
    }
}

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
            
            // Обновляем локальный кэш
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
            console.warn('[SyncEngine] Unknown entity for create:', entity);
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
        console.warn('[SyncEngine] Update operation without id');
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
            console.warn('[SyncEngine] Unknown entity for update:', entity);
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
        console.warn('[SyncEngine] Delete operation without id');
        return true;
    }
    
    switch (entity) {
        case ENTITIES.PRODUCTS:
            // Проверяем существование товара
            const { data: existing, error: checkError } = await supabase
                .from('products')
                .select('id, status, photo_url')
                .eq('id', id)
                .maybeSingle();
            
            if (checkError && checkError.code !== 'PGRST116') {
                throw checkError;
            }
            
            // Если товар не найден или уже продан - ок
            if (!existing || existing.status === 'sold') {
                return true;
            }
            
            // Удаляем фото если есть
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
            console.warn('[SyncEngine] Unknown entity for delete:', entity);
            return true;
    }
}

/**
 * Обновляет локальный кэш после синхронизации
 */
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

/**
 * Удаляет из локального кэша после синхронизации
 */
async function removeFromLocalCache(entity, id) {
    if (entity === ENTITIES.PRODUCTS) {
        const cached = await cacheGet(entity, 'all', null) || [];
        const filtered = cached.filter(p => p.id !== id);
        await cacheSet(entity, 'all', filtered);
    }
}

/**
 * Выполняет синхронизацию всех ожидающих операций
 */
export async function syncNow() {
    if (syncState.isSyncing) return;
    if (!syncState.isOnline) return;
    
    const pendingOps = await getPendingOperations();
    if (pendingOps.length === 0) return;
    
    syncState.isSyncing = true;
    notifyListeners({ type: 'sync-started' });
    
    console.log('[SyncEngine] Starting sync of', pendingOps.length, 'operations');
    
    let synced = 0;
    let failed = 0;
    
    for (const op of pendingOps) {
        // Проверяем TTL
        if (Date.now() - op.timestamp > OPERATION_TTL) {
            await removeOperation(op.id);
            console.log('[SyncEngine] Operation expired:', op.id);
            continue;
        }
        
        await updateOperation(op.id, { status: 'syncing' });
        
        try {
            const success = await syncOperation(op);
            
            if (success) {
                await removeOperation(op.id);
                synced++;
            } else {
                const newRetryCount = op.retryCount + 1;
                
                if (newRetryCount >= MAX_RETRY_COUNT) {
                    await updateOperation(op.id, {
                        status: 'failed',
                        retryCount: newRetryCount,
                        error: 'Max retries exceeded'
                    });
                    failed++;
                } else {
                    await updateOperation(op.id, {
                        status: 'pending',
                        retryCount: newRetryCount
                    });
                    failed++;
                }
            }
        } catch (error) {
            console.error('[SyncEngine] Operation failed:', op.id, error);
            
            const newRetryCount = op.retryCount + 1;
            
            if (newRetryCount >= MAX_RETRY_COUNT) {
                await updateOperation(op.id, {
                    status: 'failed',
                    retryCount: newRetryCount,
                    error: error.message
                });
            } else {
                await updateOperation(op.id, {
                    status: 'pending',
                    retryCount: newRetryCount,
                    error: error.message
                });
            }
            failed++;
        }
    }
    
    syncState.isSyncing = false;
    syncState.lastSyncTime = Date.now();
    
    await updatePendingCount();
    notifyListeners({ type: 'sync-completed', synced, failed });
    
    console.log('[SyncEngine] Sync completed. Synced:', synced, 'Failed:', failed);
    
    // Планируем следующую попытку если есть ошибки
    if (failed > 0) {
        scheduleRetry();
    }
}

/**
 * Планирует повторную синхронизацию с экспоненциальной задержкой
 */
function scheduleRetry() {
    const pendingOps = syncState.pendingCount;
    
    if (pendingOps === 0) return;
    
    // Экспоненциальная задержка на основе количества ожидающих операций
    const delay = Math.min(
        BASE_RETRY_DELAY * Math.pow(1.5, Math.min(pendingOps, 10)),
        MAX_RETRY_DELAY
    );
    
    setTimeout(() => {
        if (syncState.isOnline && !syncState.isSyncing) {
            syncNow();
        }
    }, delay);
}

// ========== ФОНОВАЯ СИНХРОНИЗАЦИЯ ==========

/**
 * Запускает фоновую синхронизацию
 */
export function startBackgroundSync() {
    if (syncState.syncInterval) {
        clearInterval(syncState.syncInterval);
    }
    
    syncState.syncInterval = setInterval(() => {
        if (syncState.isOnline && !syncState.isSyncing) {
            syncNow();
        }
    }, SYNC_INTERVAL);
    
    console.log('[SyncEngine] Background sync started');
}

/**
 * Останавливает фоновую синхронизацию
 */
export function stopBackgroundSync() {
    if (syncState.syncInterval) {
        clearInterval(syncState.syncInterval);
        syncState.syncInterval = null;
        console.log('[SyncEngine] Background sync stopped');
    }
}

// ========== СЕТЕВЫЕ СОБЫТИЯ ==========

function handleOnline() {
    syncState.isOnline = true;
    notifyListeners({ type: 'online' });
    syncNow();
}

function handleOffline() {
    syncState.isOnline = false;
    notifyListeners({ type: 'offline' });
}

window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

// ========== УТИЛИТЫ ==========

/**
 * Генерирует уникальный ID операции
 */
function generateOperationId() {
    return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Получает ID устройства
 */
function getDeviceId() {
    let deviceId = localStorage.getItem('sh_device_id');
    if (!deviceId) {
        deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sh_device_id', deviceId);
    }
    return deviceId;
}

// ========== ПУБЛИЧНЫЙ API ДЛЯ РАБОТЫ С ДАННЫМИ ==========

/**
 * Загружает данные (Cache First)
 * @param {string} entity - Тип сущности
 * @param {Object} options - Опции загрузки
 * @returns {Promise<{data: any, fromCache: boolean}>}
 */
export async function loadData(entity, options = {}) {
    const { id = 'all', fetcher, maxAge = 5 * 60 * 1000 } = options;
    
    // Сначала пробуем загрузить из кэша
    const cached = await cacheGet(entity, id, maxAge);
    
    if (cached) {
        // Фоновое обновление если онлайн
        if (syncState.isOnline && fetcher) {
            fetcher().then(freshData => {
                cacheSet(entity, id, freshData);
            }).catch(err => {
                console.warn('[SyncEngine] Background refresh failed:', err);
            });
        }
        
        return { data: cached, fromCache: true };
    }
    
    // Если кэша нет — загружаем с сервера
    if (fetcher) {
        try {
            const freshData = await fetcher();
            await cacheSet(entity, id, freshData);
            return { data: freshData, fromCache: false };
        } catch (error) {
            console.error('[SyncEngine] Failed to load data:', error);
            throw error;
        }
    }
    
    return { data: null, fromCache: false };
}

/**
 * Сохраняет изменение (оптимистично)
 * @param {string} entity - Тип сущности
 * @param {string} type - Тип операции
 * @param {Object} data - Данные
 * @param {Object} originalData - Оригинальные данные (для отката)
 * @returns {Promise<string>} ID операции
 */
export async function saveChange(entity, type, data, originalData = null) {
    // 1. Оптимистично обновляем локальный кэш
    await updateLocalCacheOptimistic(entity, type, data);
    
    // 2. Добавляем операцию в очередь
    const opId = await enqueueOperation({
        entity,
        type,
        data,
        originalData
    });
    
    return opId;
}

/**
 * Оптимистично обновляет локальный кэш
 */
async function updateLocalCacheOptimistic(entity, type, data) {
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
            if (deleteIndex !== -1) {
                cached.splice(deleteIndex, 1);
            }
            break;
    }
    
    await cacheSet(entity, 'all', cached);
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализирует движок синхронизации
 */
export async function initSyncEngine() {
    console.log('[SyncEngine] Initializing...');
    
    try {
        // Открываем базу данных
        await openDatabase();
        
        // Обновляем счётчик операций
        await updatePendingCount();
        
        // Запускаем фоновую синхронизацию
        startBackgroundSync();
        
        // Синхронизируем если онлайн
        if (syncState.isOnline) {
            syncNow();
        }
        
        console.log('[SyncEngine] Initialized. Pending operations:', syncState.pendingCount);
        
    } catch (error) {
        console.error('[SyncEngine] Init error:', error);
    }
}

// ========== ЭКСПОРТ ==========

// Именованные экспорты (для импорта вида import { ENTITIES } from '...')
export { 
    ENTITIES, 
    OP_TYPES,
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
    stopBackgroundSync
};

// Экспорт по умолчанию
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
