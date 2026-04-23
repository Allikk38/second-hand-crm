// ========================================
// FILE: js/inventory/operations.js
// ========================================

/**
 * Operations Module - Inventory
 * 
 * Управление отложенными операциями и синхронизацией с сервером.
 * Обеспечивает надёжную работу при нестабильном соединении.
 * 
 * Архитектурные решения:
 * - Операции сохраняются в localStorage с TTL 7 дней.
 * - Поддержка типов: 'delete', 'create', 'update'.
 * - Оптимистичное выполнение: товар удаляется из UI сразу, при ошибке НЕ восстанавливается.
 * - Фоновая синхронизация каждые 30 секунд при наличии сети.
 * - Разрешение конфликтов: если товар уже удалён/продан, операция считается успешной.
 * - Интеграция с ui.js для уведомлений.
 * 
 * @module inventory/operations
 * @version 1.0.0
 */

import { getSupabase } from '../../core/auth.js';
import { showNotification } from '../../utils/ui.js';

// ========== КОНСТАНТЫ ==========

const PENDING_OPS_KEY = 'sh_inventory_pending_ops';
const OPS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 дней
const SYNC_INTERVAL_MS = 30000; // 30 секунд
const MAX_RETRY_COUNT = 5;
const DEVICE_ID = generateDeviceId();

// ========== ГЕНЕРАЦИЯ ID УСТРОЙСТВА ==========

/**
 * Генерирует уникальный ID устройства
 * @returns {string}
 */
function generateDeviceId() {
    let deviceId = localStorage.getItem('sh_device_id');
    if (!deviceId) {
        deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sh_device_id', deviceId);
    }
    return deviceId;
}

// ========== СОСТОЯНИЕ ОПЕРАЦИЙ ==========

/**
 * Состояние отложенных операций
 * @type {Object}
 */
export const operationsState = {
    pending: [],
    isSyncing: false,
    lastSyncTime: null,
    syncInterval: null
};

// ========== ПОДПИСЧИКИ НА ИЗМЕНЕНИЯ ==========

/** @type {Function|null} */
let onChangeCallback = null;

/**
 * Устанавливает колбэк для вызова при изменении очереди
 * @param {Function} callback - Функция для вызова
 */
export function setOperationsChangeCallback(callback) {
    onChangeCallback = callback;
}

/**
 * Вызывает колбэк изменения очереди
 */
function notifyOperationsChanged() {
    if (onChangeCallback) {
        onChangeCallback();
    }
}

// ========== УПРАВЛЕНИЕ ОЧЕРЕДЬЮ ==========

/**
 * Загружает отложенные операции из localStorage
 */
export function loadPendingOperations() {
    try {
        const stored = localStorage.getItem(PENDING_OPS_KEY);
        if (stored) {
            const ops = JSON.parse(stored);
            const now = Date.now();
            
            // Фильтруем устаревшие операции
            operationsState.pending = ops.filter(op => {
                return (now - op.timestamp) < OPS_TTL;
            });
            
            // Если были удалены устаревшие — сохраняем изменения
            if (ops.length !== operationsState.pending.length) {
                savePendingOperations();
            }
            
            console.log('[Operations] Loaded pending operations:', operationsState.pending.length);
        }
    } catch (e) {
        console.warn('[Operations] Failed to load pending operations:', e);
        operationsState.pending = [];
    }
    notifyOperationsChanged();
}

/**
 * Сохраняет отложенные операции в localStorage
 */
export function savePendingOperations() {
    try {
        localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(operationsState.pending));
        notifyOperationsChanged();
    } catch (e) {
        console.warn('[Operations] Failed to save pending operations:', e);
    }
}

/**
 * Добавляет операцию в очередь
 * @param {Object} operation - Операция { type, productId, product }
 */
export function addPendingOperation(operation) {
    const op = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        type: operation.type,
        productId: operation.productId,
        product: operation.product || null,
        timestamp: Date.now(),
        status: 'pending',
        retryCount: 0,
        deviceId: DEVICE_ID
    };
    
    operationsState.pending.push(op);
    savePendingOperations();
    console.log('[Operations] Added pending operation:', op.type, op.productId);
    
    return op;
}

/**
 * Удаляет операцию из очереди
 * @param {string} operationId - ID операции
 */
export function removePendingOperation(operationId) {
    const initialLength = operationsState.pending.length;
    operationsState.pending = operationsState.pending.filter(op => op.id !== operationId);
    
    if (operationsState.pending.length !== initialLength) {
        savePendingOperations();
    }
}

/**
 * Обновляет статус операции
 * @param {string} operationId - ID операции
 * @param {string} status - Новый статус
 * @param {number} [retryCount] - Количество попыток
 */
export function updateOperationStatus(operationId, status, retryCount = 0) {
    const op = operationsState.pending.find(o => o.id === operationId);
    if (op) {
        op.status = status;
        op.retryCount = retryCount;
        savePendingOperations();
    }
}

/**
 * Возвращает количество ожидающих операций
 * @returns {number}
 */
export function getPendingCount() {
    return operationsState.pending.filter(op => op.status === 'pending' || op.status === 'failed').length;
}

/**
 * Проверяет, есть ли ожидающие операции
 * @returns {boolean}
 */
export function hasPendingOperations() {
    return getPendingCount() > 0;
}

// ========== СИНХРОНИЗАЦИЯ ОПЕРАЦИЙ ==========

/**
 * Проверяет существование товара в БД
 * @param {string} productId - ID товара
 * @returns {Promise<Object|null>} Товар или null
 */
async function checkProductExists(productId) {
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('products')
            .select('id, status, photo_url')
            .eq('id', productId)
            .maybeSingle();
        
        if (error) {
            if (error.code === 'PGRST116') return null;
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error('[Operations] Check product exists error:', error);
        throw error;
    }
}

/**
 * Синхронизирует операцию удаления
 * @param {Object} operation - Операция удаления
 * @returns {Promise<boolean>} true если успешно
 */
async function syncDeleteOperation(operation) {
    const { productId, product } = operation;
    
    console.log('[Operations] Syncing delete:', productId);
    
    try {
        // Проверяем, существует ли товар
        const existing = await checkProductExists(productId);
        
        // Если товар не найден или уже продан — операция успешна
        if (!existing) {
            console.log('[Operations] Product already deleted or does not exist:', productId);
            return true;
        }
        
        if (existing.status === 'sold') {
            console.log('[Operations] Product already sold, skipping delete:', productId);
            return true;
        }
        
        const supabase = await getSupabase();
        
        // Удаляем фото если есть
        if (existing.photo_url) {
            try {
                const photoPath = existing.photo_url.split('/').pop();
                if (photoPath) {
                    await supabase.storage
                        .from('product-photos')
                        .remove([photoPath]);
                }
            } catch (photoError) {
                console.warn('[Operations] Photo deletion error:', photoError);
            }
        }
        
        // Удаляем товар
        const { error: deleteError } = await supabase
            .from('products')
            .delete()
            .eq('id', productId);
        
        if (deleteError) throw deleteError;
        
        console.log('[Operations] Synced delete:', productId);
        return true;
        
    } catch (error) {
        console.error('[Operations] Sync delete error:', error);
        throw error;
    }
}

/**
 * Синхронизирует операцию создания
 * @param {Object} operation - Операция создания
 * @returns {Promise<boolean>} true если успешно
 */
async function syncCreateOperation(operation) {
    const { product } = operation;
    
    if (!product) {
        console.warn('[Operations] Create operation without product data');
        return true; // Пропускаем
    }
    
    console.log('[Operations] Syncing create:', product.name);
    
    try {
        // Проверяем, не существует ли уже такой товар
        const existing = await checkProductExists(product.id);
        if (existing) {
            console.log('[Operations] Product already exists, skipping create:', product.id);
            return true;
        }
        
        const supabase = await getSupabase();
        
        const productData = {
            ...product,
            created_at: new Date().toISOString()
        };
        
        const { error } = await supabase
            .from('products')
            .insert(productData);
        
        if (error) {
            // Если конфликт по ID — считаем успешным
            if (error.code === '23505') {
                console.log('[Operations] Product already exists (conflict):', product.id);
                return true;
            }
            throw error;
        }
        
        console.log('[Operations] Synced create:', product.name);
        return true;
        
    } catch (error) {
        console.error('[Operations] Sync create error:', error);
        throw error;
    }
}

/**
 * Синхронизирует операцию обновления
 * @param {Object} operation - Операция обновления
 * @returns {Promise<boolean>} true если успешно
 */
async function syncUpdateOperation(operation) {
    const { productId, product } = operation;
    
    if (!product) {
        console.warn('[Operations] Update operation without product data');
        return true;
    }
    
    console.log('[Operations] Syncing update:', product.name);
    
    try {
        // Проверяем, существует ли товар
        const existing = await checkProductExists(productId);
        if (!existing) {
            console.log('[Operations] Product does not exist, skipping update:', productId);
            return true;
        }
        
        const supabase = await getSupabase();
        
        const { error } = await supabase
            .from('products')
            .update(product)
            .eq('id', productId);
        
        if (error) throw error;
        
        console.log('[Operations] Synced update:', product.name);
        return true;
        
    } catch (error) {
        console.error('[Operations] Sync update error:', error);
        throw error;
    }
}

/**
 * Синхронизирует одну операцию
 * @param {Object} operation - Операция
 * @returns {Promise<boolean>} true если успешно
 */
async function syncOperation(operation) {
    try {
        let success = false;
        
        switch (operation.type) {
            case 'delete':
                success = await syncDeleteOperation(operation);
                break;
            case 'create':
                success = await syncCreateOperation(operation);
                break;
            case 'update':
                success = await syncUpdateOperation(operation);
                break;
            default:
                console.warn('[Operations] Unknown operation type:', operation.type);
                success = true; // Пропускаем неизвестные
        }
        
        return success;
        
    } catch (error) {
        console.error('[Operations] Sync operation error:', error, operation);
        return false;
    }
}

/**
 * Синхронизирует все отложенные операции
 * @returns {Promise<{synced: number, failed: number}>}
 */
export async function syncPendingOperations() {
    if (operationsState.isSyncing) {
        return { synced: 0, failed: 0 };
    }
    
    if (operationsState.pending.length === 0) {
        return { synced: 0, failed: 0 };
    }
    
    if (!navigator.onLine) {
        console.log('[Operations] Offline, skipping sync');
        return { synced: 0, failed: 0 };
    }
    
    operationsState.isSyncing = true;
    console.log('[Operations] Starting sync of', operationsState.pending.length, 'operations');
    
    let synced = 0;
    let failed = 0;
    
    const pendingOps = operationsState.pending.filter(
        op => op.status === 'pending' || op.status === 'failed'
    );
    
    for (const op of pendingOps) {
        // Пропускаем операции, превысившие лимит попыток
        if (op.retryCount >= MAX_RETRY_COUNT) {
            console.warn('[Operations] Max retries exceeded for operation:', op.id);
            removePendingOperation(op.id);
            failed++;
            continue;
        }
        
        updateOperationStatus(op.id, 'syncing', op.retryCount);
        
        try {
            const success = await syncOperation(op);
            
            if (success) {
                removePendingOperation(op.id);
                synced++;
            } else {
                updateOperationStatus(op.id, 'failed', op.retryCount + 1);
                failed++;
            }
        } catch (error) {
            updateOperationStatus(op.id, 'failed', op.retryCount + 1);
            failed++;
        }
    }
    
    operationsState.isSyncing = false;
    operationsState.lastSyncTime = Date.now();
    
    if (synced > 0) {
        showNotification(`Синхронизировано операций: ${synced}`, 'success');
        
        // Если были синхронизированы операции, уведомляем об обновлении данных
        if (onChangeCallback) {
            // Возвращаем true чтобы указать что нужно обновить данные
            setTimeout(() => onChangeCallback({ needsRefresh: true }), 500);
        }
    }
    
    console.log('[Operations] Sync completed. Synced:', synced, 'Failed:', failed);
    
    return { synced, failed };
}

// ========== ФОНОВАЯ СИНХРОНИЗАЦИЯ ==========

/**
 * Запускает фоновую синхронизацию
 */
export function startBackgroundSync() {
    if (operationsState.syncInterval) {
        clearInterval(operationsState.syncInterval);
    }
    
    operationsState.syncInterval = setInterval(async () => {
        if (navigator.onLine && hasPendingOperations()) {
            console.log('[Operations] Background sync triggered');
            await syncPendingOperations();
        }
    }, SYNC_INTERVAL_MS);
    
    console.log('[Operations] Background sync started (interval:', SYNC_INTERVAL_MS, 'ms)');
}

/**
 * Останавливает фоновую синхронизацию
 */
export function stopBackgroundSync() {
    if (operationsState.syncInterval) {
        clearInterval(operationsState.syncInterval);
        operationsState.syncInterval = null;
        console.log('[Operations] Background sync stopped');
    }
}

// ========== ОЧИСТКА ==========

/**
 * Очищает все отложенные операции
 */
export function clearAllPendingOperations() {
    operationsState.pending = [];
    savePendingOperations();
    console.log('[Operations] All pending operations cleared');
}

/**
 * Получает статистику операций
 * @returns {Object}
 */
export function getOperationsStats() {
    const pending = operationsState.pending.filter(op => op.status === 'pending').length;
    const failed = operationsState.pending.filter(op => op.status === 'failed').length;
    const syncing = operationsState.pending.filter(op => op.status === 'syncing').length;
    
    return {
        total: operationsState.pending.length,
        pending,
        failed,
        syncing,
        lastSyncTime: operationsState.lastSyncTime
    };
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    operationsState,
    setOperationsChangeCallback,
    loadPendingOperations,
    savePendingOperations,
    addPendingOperation,
    removePendingOperation,
    updateOperationStatus,
    getPendingCount,
    hasPendingOperations,
    syncPendingOperations,
    startBackgroundSync,
    stopBackgroundSync,
    clearAllPendingOperations,
    getOperationsStats
};
