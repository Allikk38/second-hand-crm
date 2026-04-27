// ========================================
// FILE: core/sync-engine/logger.js
// ========================================

/**
 * Extended Logger Module
 * 
 * Подробное логирование для аудита и выявления аномалий.
 * Логи отправляются в Supabase таблицу sync_logs асинхронно.
 * При недоступности сервера логи сохраняются локально в localStorage.
 * 
 * ВАЖНО: отправка логов НЕ блокирует основной поток.
 * Все запросы к Supabase выполняются через setTimeout.
 * 
 * @module sync-engine/logger
 * @version 2.2.0
 * @changes
 * - Асинхронная отправка логов через setTimeout (не блокирует UI)
 * - Добавлен флаг isFlushing для предотвращения наложения запросов
 * - Увеличен BUFFER_SIZE до 50 для снижения частоты отправок
 * - Увеличен FLUSH_INTERVAL до 30 секунд
 * - Исправлена синхронная блокировка при инициализации
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
    SYSTEM: 'system',
    AUTH: 'auth'
};

const LOCAL_LOG_STORE = 'sync_logs_local';
const MAX_LOCAL_LOGS = 500;

// Буфер логов
let logBuffer = [];
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL = 30000; // 30 секунд
let flushTimer = null;
let isFlushing = false;
let sessionId = generateSessionId();

// Флаги состояния
let isLoggerInitialized = false;
let isTableAvailable = null;
let lastFlushError = null;

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

// ========== ЛОКАЛЬНОЕ ХРАНЕНИЕ ЛОГОВ ==========

function saveLogsLocally(logs) {
    try {
        const existing = JSON.parse(localStorage.getItem(LOCAL_LOG_STORE) || '[]');
        const combined = [...existing, ...logs].slice(-MAX_LOCAL_LOGS);
        localStorage.setItem(LOCAL_LOG_STORE, JSON.stringify(combined));
    } catch (e) {
        console.error('[Logger] Failed to save logs locally:', e);
    }
}

function getLocalLogs() {
    try {
        const logs = JSON.parse(localStorage.getItem(LOCAL_LOG_STORE) || '[]');
        localStorage.removeItem(LOCAL_LOG_STORE);
        return logs;
    } catch {
        return [];
    }
}

// ========== ПРОВЕРКА ДОСТУПНОСТИ ТАБЛИЦЫ ==========

async function checkTableAvailability() {
    if (isTableAvailable !== null) {
        return isTableAvailable;
    }
    
    try {
        const supabase = await getSupabase();
        
        const testLog = {
            level: 'debug',
            category: 'system',
            event: 'logger_test',
            entity: null,
            entity_id: null,
            operation_type: null,
            duration_ms: null,
            error_message: null,
            error_code: null,
            error_stack: null,
            details: JSON.stringify({ test: true }),
            metadata: JSON.stringify({ test: true }),
            created_at: new Date().toISOString(),
            device_id: getDeviceId(),
            user_id: getUserId(),
            session_id: sessionId,
            page: getCurrentPage()
        };
        
        const { error } = await supabase
            .from('sync_logs')
            .insert(testLog)
            .select('id')
            .single();
        
        if (error) {
            if (error.code === '42P01') {
                console.error('[Logger] Table sync_logs does not exist');
                isTableAvailable = false;
            } else if (error.code === '42501') {
                console.error('[Logger] Permission denied for sync_logs');
                isTableAvailable = false;
            } else {
                console.error('[Logger] Unknown error checking table:', error.message, error.code);
                isTableAvailable = false;
            }
            return false;
        }
        
        console.log('[Logger] Table sync_logs is available');
        isTableAvailable = true;
        return true;
        
    } catch (error) {
        console.error('[Logger] Failed to check table availability:', error.message);
        isTableAvailable = false;
    }
    
    return false;
}

// ========== ОТПРАВКА ЛОГОВ (АСИНХРОННАЯ) ==========

/**
 * Отправляет накопленные логи в Supabase.
 * Выполняется АСИНХРОННО через setTimeout, не блокирует UI.
 */
function scheduleAsyncFlush() {
    if (flushTimer) return;
    
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        await flushLogs();
    }, FLUSH_INTERVAL);
}

async function flushLogs() {
    if (isFlushing) return;
    if (logBuffer.length === 0) return;
    
    isFlushing = true;
    
    const logs = [...logBuffer];
    logBuffer = [];
    
    const available = await checkTableAvailability();
    
    if (!available) {
        saveLogsLocally(logs);
        isFlushing = false;
        return;
    }
    
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
            console.error('[Logger] Failed to send logs:', error.message, error.code);
            lastFlushError = { message: error.message, code: error.code, time: Date.now() };
            saveLogsLocally(enrichedLogs);
        } else {
            lastFlushError = null;
            
            // Пытаемся отправить локальные логи
            const localLogs = getLocalLogs();
            if (localLogs.length > 0) {
                logBuffer = [...localLogs, ...logBuffer];
            }
        }
    } catch (error) {
        console.error('[Logger] Flush error:', error.message);
        lastFlushError = { message: error.message, code: 'NETWORK', time: Date.now() };
        saveLogsLocally(logs);
    } finally {
        isFlushing = false;
    }
}

/**
 * Добавляет лог в буфер. Отправка асинхронная, не блокирует UI.
 */
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
        details: typeof details === 'string' ? details : JSON.stringify(details),
        metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
        created_at: new Date().toISOString()
    };
    
    // Пишем в буфер
    logBuffer.push(logEntry);
    
    // Консоль для отладки
    const consoleMsg = `[${category}] ${event}`;
    const consoleData = typeof details === 'object' ? details : {};
    
    if (level === 'error') console.error(consoleMsg, consoleData);
    else if (level === 'warn') console.warn(consoleMsg, consoleData);
    else if (level === 'info') console.info(consoleMsg, consoleData);
    else console.log(consoleMsg, consoleData);
    
    // Отправляем только если буфер заполнен или это ошибка
    if (logBuffer.length >= BUFFER_SIZE || level === 'error') {
        // Асинхронная отправка без await — не блокирует
        setTimeout(() => flushLogs(), 0);
    } else {
        scheduleAsyncFlush();
    }
}

// ========== ПУБЛИЧНЫЙ API ==========

export async function testLoggerConnection() {
    const available = await checkTableAvailability();
    
    if (available) {
        info(CATEGORIES.SYSTEM, 'logger_test_passed', {
            details: { message: 'Logger connection test passed' }
        });
    }
    
    return {
        available,
        lastError: lastFlushError
    };
}

export function getLoggerStatus() {
    return {
        initialized: isLoggerInitialized,
        tableAvailable: isTableAvailable,
        bufferSize: logBuffer.length,
        isFlushing,
        lastFlushError: lastFlushError,
        localLogsCount: JSON.parse(localStorage.getItem(LOCAL_LOG_STORE) || '[]').length
    };
}

// Базовые методы
export function debug(category, event, options = {}) {
    addLog(LOG_LEVELS.DEBUG, category, event, options);
}

function info(category, event, options = {}) {
    addLog(LOG_LEVELS.INFO, category, event, options);
}

function warnLog(category, event, options = {}) {
    addLog(LOG_LEVELS.WARN, category, event, options);
}

function errorLog(category, event, errorObj, options = {}) {
    addLog(LOG_LEVELS.ERROR, category, event, { ...options, error: errorObj });
}

export { info as logInfo };
export { warnLog as logWarn };
export { errorLog as logError };

// Специализированные методы
export function logUserAction(event, details = {}) {
    info(CATEGORIES.USER, event, { details });
}

export function logProductEvent(event, productId, details = {}) {
    info(CATEGORIES.PRODUCT, event, {
        entity: 'product',
        entityId: productId,
        details
    });
}

export function logSaleEvent(event, saleData = {}) {
    info(CATEGORIES.SALE, event, {
        entity: 'sale',
        entityId: saleData.id,
        details: saleData
    });
}

export function logShiftEvent(event, shiftId, details = {}) {
    info(CATEGORIES.SHIFT, event, {
        entity: 'shift',
        entityId: shiftId,
        details
    });
}

export function logSyncEvent(event, operationType, entity, details = {}) {
    info(CATEGORIES.SYNC, event, {
        operationType,
        entity,
        details
    });
}

export function logPerformance(operation, duration, details = {}) {
    const level = duration > 3000 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
    addLog(level, CATEGORIES.PERFORMANCE, operation, {
        duration,
        details: { ...details, slow: duration > 3000 }
    });
}

export function logNetworkEvent(event, details = {}) {
    info(CATEGORIES.NETWORK, event, { details });
}

export function logAnomaly(event, details = {}) {
    warnLog(CATEGORIES.SYSTEM, `anomaly_${event}`, { details });
}

export function logAuthEvent(event, details = {}) {
    info(CATEGORIES.AUTH, event, { details });
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

// ========== ИНИЦИАЛИЗАЦИЯ ==========

export async function initLogger() {
    if (isLoggerInitialized) return;
    
    console.log('[Logger] Initializing...');
    
    const available = await checkTableAvailability();
    
    if (available) {
        const localLogs = getLocalLogs();
        if (localLogs.length > 0) {
            console.log('[Logger] Found', localLogs.length, 'locally saved logs, retrying');
            logBuffer = [...localLogs, ...logBuffer];
            // Асинхронная отправка, не блокирует
            setTimeout(() => flushLogs(), 100);
        }
    }
    
    isLoggerInitialized = true;
    console.log('[Logger] Initialized. Table available:', available);
}

// ========== ЭКСПОРТ ==========

export { CATEGORIES, LOG_LEVELS };

export default {
    debug,
    info,
    warn: warnLog,
    error: errorLog,
    logUserAction,
    logProductEvent,
    logSaleEvent,
    logShiftEvent,
    logSyncEvent,
    logPerformance,
    logNetworkEvent,
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
};
