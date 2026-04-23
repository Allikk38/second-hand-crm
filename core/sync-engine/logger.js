// ========================================
// FILE: core/sync-engine/logger.js
// ========================================

/**
 * Extended Logger Module
 * 
 * Подробное логирование для аудита и выявления аномалий.
 * 
 * @module sync-engine/logger
 * @version 2.0.0
 */

import { getSupabase } from '../auth.js';

// ========== КОНСТАНТЫ ==========

const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

const CATEGORIES = {
    USER: 'user',
    PRODUCT: 'product',
    SALE: 'sale',
    SHIFT: 'shift',
    SYNC: 'sync',
    NETWORK: 'network',
    PERFORMANCE: 'performance',
    SYSTEM: 'system'
};

// Буфер логов
let logBuffer = [];
const BUFFER_SIZE = 20;
const FLUSH_INTERVAL = 15000; // 15 секунд
let flushTimer = null;
let sessionId = generateSessionId();

// ========== УТИЛИТЫ ==========

function generateSessionId() {
    return `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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
        const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
        return token?.user?.id || null;
    } catch {
        return null;
    }
}

function getCurrentPage() {
    const path = window.location.pathname;
    if (path.includes('inventory')) return 'inventory';
    if (path.includes('cashier')) return 'cashier';
    if (path.includes('reports')) return 'reports';
    if (path.includes('login')) return 'login';
    return 'unknown';
}

// ========== ОТПРАВКА ЛОГОВ ==========

async function flushLogs() {
    if (logBuffer.length === 0) return;
    
    const logs = [...logBuffer];
    logBuffer = [];
    
    try {
        const supabase = await getSupabase();
        
        const enrichedLogs = logs.map(log => ({
            ...log,
            device_id: getDeviceId(),
            user_id: getUserId(),
            session_id: sessionId,
            page: getCurrentPage()
        }));
        
        const { error } = await supabase
            .from('sync_logs')
            .insert(enrichedLogs);
        
        if (error) {
            console.error('[Logger] Failed to send logs:', error);
        }
    } catch (error) {
        console.error('[Logger] Flush error:', error);
    }
}

function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushLogs();
        flushTimer = null;
    }, FLUSH_INTERVAL);
}

function addLog(level, category, event, options = {}) {
    const {
        entity,
        entityId,
        operationType,
        duration,
        error,
        errorCode,
        details = {},
        metadata = {}
    } = options;
    
    const logEntry = {
        level,
        category,
        event,
        entity: entity || null,
        entity_id: entityId || null,
        operation_type: operationType || null,
        duration_ms: duration || null,
        error_message: error?.message || null,
        error_code: errorCode || error?.code || null,
        error_stack: error?.stack?.split('\n').slice(0, 5).join('\n') || null,
        details: JSON.stringify(details),
        metadata: JSON.stringify(metadata),
        created_at: new Date().toISOString()
    };
    
    logBuffer.push(logEntry);
    
    // Консоль для отладки
    const consoleMsg = `[${category}] ${event}`;
    const consoleData = { ...details, ...metadata };
    
    if (level === 'error') console.error(consoleMsg, consoleData);
    else if (level === 'warn') console.warn(consoleMsg, consoleData);
    else if (level === 'info') console.info(consoleMsg, consoleData);
    else console.log(consoleMsg, consoleData);
    
    if (logBuffer.length >= BUFFER_SIZE) {
        flushLogs();
    } else {
        scheduleFlush();
    }
}

// ========== ПУБЛИЧНЫЙ API ==========

// Базовые методы
export function debug(category, event, options = {}) {
    addLog(LOG_LEVELS.DEBUG, category, event, options);
}

export function info(category, event, options = {}) {
    addLog(LOG_LEVELS.INFO, category, event, options);
}

export function warn(category, event, options = {}) {
    addLog(LOG_LEVELS.WARN, category, event, options);
}

export function error(category, event, error, options = {}) {
    addLog(LOG_LEVELS.ERROR, category, event, { ...options, error });
}

// Специализированные методы

// Пользователь
export function logUserAction(event, details = {}) {
    info(CATEGORIES.USER, event, { details });
}

// Товары
export function logProductEvent(event, productId, details = {}) {
    info(CATEGORIES.PRODUCT, event, {
        entity: 'product',
        entityId: productId,
        details
    });
}

// Продажи
export function logSaleEvent(event, saleData = {}) {
    info(CATEGORIES.SALE, event, {
        entity: 'sale',
        entityId: saleData.id,
        details: saleData
    });
}

// Смена
export function logShiftEvent(event, shiftId, details = {}) {
    info(CATEGORIES.SHIFT, event, {
        entity: 'shift',
        entityId: shiftId,
        details
    });
}

// Синхронизация
export function logSyncEvent(event, operationType, entity, details = {}) {
    info(CATEGORIES.SYNC, event, {
        operationType,
        entity,
        details
    });
}

// Производительность
export function logPerformance(operation, duration, details = {}) {
    const level = duration > 3000 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
    addLog(level, CATEGORIES.PERFORMANCE, operation, {
        duration,
        details: { ...details, slow: duration > 3000 }
    });
}

// Сеть
export function logNetworkEvent(event, details = {}) {
    info(CATEGORIES.NETWORK, event, { details });
}

// Аномалии
export function logAnomaly(event, details = {}) {
    warn(CATEGORIES.SYSTEM, `anomaly_${event}`, { details });
}

// ========== УТИЛИТЫ ==========

export function measurePerformance(name, fn) {
    return async (...args) => {
        const start = Date.now();
        try {
            return await fn(...args);
        } finally {
            logPerformance(name, Date.now() - start);
        }
    };
}

export async function flushAllLogs() {
    await flushLogs();
}

export function newSession() {
    sessionId = generateSessionId();
    info(CATEGORIES.USER, 'session_start');
}

// ========== ЭКСПОРТ ==========

export { CATEGORIES, LOG_LEVELS };

export default {
    debug, info, warn, error,
    logUserAction,
    logProductEvent,
    logSaleEvent,
    logShiftEvent,
    logSyncEvent,
    logPerformance,
    logNetworkEvent,
    logAnomaly,
    measurePerformance,
    flushAllLogs,
    newSession,
    CATEGORIES,
    LOG_LEVELS
};
