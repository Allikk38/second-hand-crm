// ========================================
// FILE: core/sync-engine/logger.js
// ========================================

/**
 * Sync Logger Module
 * 
 * Логирование ошибок синхронизации в Supabase и консоль.
 * Используется для мониторинга проблем в production.
 * 
 * @module sync-engine/logger
 * @version 1.0.0
 */

import { getSupabase } from '../auth.js';

// ========== КОНСТАНТЫ ==========

const LOG_LEVELS = {
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

// Буфер для накопления логов перед отправкой
let logBuffer = [];
const BUFFER_SIZE = 10;
const FLUSH_INTERVAL = 30000; // 30 секунд
let flushTimer = null;

// ========== УТИЛИТЫ ==========

function getDeviceId() {
    let deviceId = localStorage.getItem('sh_device_id');
    if (!deviceId) {
        deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sh_device_id', deviceId);
    }
    return deviceId;
}

function getUserId() {
    try {
        const user = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
        return user?.user?.id || null;
    } catch {
        return null;
    }
}

// ========== ОТПРАВКА ЛОГОВ В SUPABASE ==========

/**
 * Отправляет накопленные логи в Supabase
 */
async function flushLogs() {
    if (logBuffer.length === 0) return;
    
    const logs = [...logBuffer];
    logBuffer = [];
    
    try {
        const supabase = await getSupabase();
        
        // Добавляем device_id и user_id
        const enrichedLogs = logs.map(log => ({
            ...log,
            device_id: getDeviceId(),
            user_id: getUserId()
        }));
        
        const { error } = await supabase
            .from('sync_logs')
            .insert(enrichedLogs);
        
        if (error) {
            console.error('[Logger] Failed to send logs to Supabase:', error);
        }
    } catch (error) {
        console.error('[Logger] Flush error:', error);
    }
}

/**
 * Планирует отправку логов
 */
function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    
    flushTimer = setTimeout(() => {
        flushLogs();
        flushTimer = null;
    }, FLUSH_INTERVAL);
}

/**
 * Добавляет лог в буфер
 */
function addToBuffer(level, message, metadata = {}) {
    const logEntry = {
        level,
        message: String(message),
        metadata,
        created_at: new Date().toISOString()
    };
    
    logBuffer.push(logEntry);
    
    // Отправляем если буфер заполнен
    if (logBuffer.length >= BUFFER_SIZE) {
        flushLogs();
    } else {
        scheduleFlush();
    }
    
    // Всегда пишем в консоль для отладки
    const consoleMethod = level === 'error' ? console.error : 
                         level === 'warn' ? console.warn : console.log;
    consoleMethod(`[SyncLogger][${level.toUpperCase()}]`, message, metadata);
}

// ========== ПУБЛИЧНЫЙ API ==========

/**
 * Логирует информационное сообщение
 */
export function logInfo(message, metadata = {}) {
    addToBuffer(LOG_LEVELS.INFO, message, metadata);
}

/**
 * Логирует предупреждение
 */
export function logWarn(message, metadata = {}) {
    addToBuffer(LOG_LEVELS.WARN, message, metadata);
}

/**
 * Логирует ошибку (с автоматическим захватом стека)
 */
export function logError(message, error = null, metadata = {}) {
    const errorMetadata = {
        ...metadata,
        error_name: error?.name,
        error_stack: error?.stack?.split('\n').slice(0, 5).join('\n')
    };
    
    addToBuffer(LOG_LEVELS.ERROR, message, errorMetadata);
}

/**
 * Логирует операцию синхронизации
 */
export function logSyncOperation(operationType, entity, status, metadata = {}) {
    const level = status === 'success' ? LOG_LEVELS.INFO : 
                  status === 'failed' ? LOG_LEVELS.ERROR : LOG_LEVELS.WARN;
    
    addToBuffer(level, `Sync ${operationType} ${entity}: ${status}`, {
        operation_type: operationType,
        entity,
        sync_status: status,
        ...metadata
    });
}

/**
 * Принудительно отправляет все накопленные логи
 */
export async function flushAllLogs() {
    await flushLogs();
}

/**
 * Очищает буфер логов (при выходе)
 */
export function clearLogBuffer() {
    logBuffer = [];
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
}

// ========== ОЧИСТКА ПРИ ВЫХОДЕ ==========

window.addEventListener('beforeunload', () => {
    flushLogs();
});

// ========== ЭКСПОРТ ==========

export default {
    logInfo,
    logWarn,
    logError,
    logSyncOperation,
    flushAllLogs,
    clearLogBuffer
};
