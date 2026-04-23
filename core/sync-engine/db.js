// ========================================
// FILE: core/sync-engine/db.js
// ========================================

/**
 * Database Module - Sync Engine
 * 
 * Низкоуровневая работа с IndexedDB.
 * Управляет кэшем данных и очередью операций.
 * 
 * @module sync-engine/db
 * @version 1.0.0
 */

// ========== КОНСТАНТЫ ==========

const DB_NAME = 'sh_crm_sync';
const DB_VERSION = 1;

// Таблицы IndexedDB
export const STORES = {
    CACHE: 'cache',
    OPERATIONS: 'operations',
    META: 'meta'
};

// ========== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ==========

/**
 * Открывает соединение с IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains(STORES.CACHE)) {
                const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
                cacheStore.createIndex('entity', 'entity', { unique: false });
                cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.OPERATIONS)) {
                const opsStore = db.createObjectStore(STORES.OPERATIONS, { keyPath: 'id' });
                opsStore.createIndex('entity', 'entity', { unique: false });
                opsStore.createIndex('status', 'status', { unique: false });
                opsStore.createIndex('priority', 'priority', { unique: false });
                opsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            
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
export async function withTransaction(storeName, mode, callback) {
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
 */
export async function cacheDelete(entity, id) {
    const key = `${entity}:${id}`;
    
    await withTransaction(STORES.CACHE, 'readwrite', (store) => {
        store.delete(key);
    });
}

/**
 * Очищает весь кэш для сущности
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
 * Генерирует уникальный ID операции
 */
export function generateOperationId() {
    return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Добавляет операцию в очередь
 */
export async function enqueueOperation(operation) {
    await withTransaction(STORES.OPERATIONS, 'readwrite', (store) => {
        store.add(operation);
    });
    return operation.id;
}

/**
 * Получает все ожидающие операции
 */
export async function getPendingOperations() {
    const ops = await withTransaction(STORES.OPERATIONS, 'readonly', (store) => {
        const index = store.index('status');
        const range = IDBKeyRange.only('pending');
        return index.getAll(range);
    });
    
    return ops.sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        return a.timestamp - b.timestamp;
    });
}

/**
 * Обновляет статус операции
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
}

/**
 * Удаляет операцию из очереди
 */
export async function removeOperation(id) {
    await withTransaction(STORES.OPERATIONS, 'readwrite', (store) => {
        store.delete(id);
    });
}
