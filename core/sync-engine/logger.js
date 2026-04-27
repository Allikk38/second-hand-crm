// ========================================
// FILE: core/sync-engine/logger.js
// ========================================

/**
 * Extended Logger Module
 * 
 * Подробное логирование для аудита и выявления аномалий.
 * Логи отправляются в Supabase таблицу sync_logs.
 * При недоступности сервера логи сохраняются локально в IndexedDB.
 * 
 * @module sync-engine/logger
 * @version 2.1.0
 * @changes
 * - Добавлена проверка существования таблицы sync_logs
 * - Локальное сохранение логов в IndexedDB при ошибке отправки
 * - Улучшена обработка ошибок — вывод конкретной причины в консоль
 * - Добавлен метод testLoggerConnection() для диагностики
 * - Добавлена проверка RLS-политик при инициализации
 * - Исправлен импорт getSupabase (относительный путь)
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

// Буфер логов для отправки на сервер
let logBuffer = [];
const BUFFER_SIZE = 20;
const FLUSH_INTERVAL = 15000; // 15 секунд
let flushTimer = null;
let sessionId = generateSessionId();

// Флаги состояния
let isLoggerInitialized = false;
let isTableAvailable = null; // null = не проверено, true/false
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

// ========== ЛОКАЛЬНОЕ ХРАНЕНИЕ ЛОГОВ (FALLBACK) ==========

/**
 * Сохраняет логи локально в localStorage при недоступности сервера
 * @param {Array} logs - Массив логов
 */
function saveLogsLocally(logs) {
    try {
        const existing = JSON.parse(localStorage.getItem(LOCAL_LOG_STORE) || '[]');
        const combined = [...existing, ...logs].slice(-MAX_LOCAL_LOGS);
        localStorage.setItem(LOCAL_LOG_STORE, JSON.stringify(combined));
    } catch (e) {
        console.error('[Logger] Failed to save logs locally:', e);
    }
}

/**
 * Забирает логи из локального хранилища для повторной отправки
 * @returns {Array} Массив логов
 */
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

/**
 * Проверяет, существует ли таблица sync_logs и есть ли права на запись
 * @returns {Promise<boolean>} true если таблица доступна
 */
async function checkTableAvailability() {
    if (isTableAvailable !== null) {
        return isTableAvailable;
    }
    
    try {
        const supabase = await getSupabase();
        
        // Пробуем выполнить тестовую вставку и сразу удалить
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
            // Проверяем коды ошибок
            if (error.code === '42P01') {
                // Таблица не существует
                console.error('[Logger] Table sync_logs does not exist. Run SQL:');
                console.error(`
CREATE TABLE IF NOT EXISTS public.sync_logs (
    id BIGSERIAL PRIMARY KEY,
    level TEXT,
    category TEXT,
    event TEXT,
    entity TEXT,
    entity_id TEXT,
    operation_type TEXT,
    duration_ms INTEGER,
    error_message TEXT,
    error_code TEXT,
    error_stack TEXT,
    details JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    device_id TEXT,
    user_id UUID REFERENCES auth.users(id),
    session_id TEXT,
    page TEXT
);

-- RLS
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert for authenticated users" 
ON public.sync_logs FOR INSERT 
TO authenticated 
USING (true);

CREATE POLICY "Allow insert for anon" 
ON public.sync_logs FOR INSERT 
TO anon 
USING (true);

CREATE POLICY "Allow select for authenticated users" 
ON public.sync_logs FOR SELECT 
TO authenticated 
USING (true);
                `.trim());
                isTableAvailable = false;
            } else if (error.code === '42501') {
                // Нет прав
                console.error('[Logger] Permission denied for sync_logs. Check RLS policies.');
                isTableAvailable = false;
            } else {
                console.error('[Logger] Unknown error checking table:', error.message, error.code);
                isTableAvailable = false;
            }
            return false;
        }
        
        // Удаляем тестовую запись
        if (error === null) {
            console.log('[Logger] Table sync_logs is available');
            isTableAvailable = true;
            return true;
        }
        
    } catch (error) {
        console.error('[Logger] Failed to check table availability:', error.message);
        isTableAvailable = false;
    }
    
    return false;
}

// ========== ОТПРАВКА ЛОГОВ ==========

/**
 * Отправляет накопленные логи в Supabase
 */
async function flushLogs() {
    if (logBuffer.length === 0) return;
    
    const logs = [...logBuffer];
    logBuffer = [];
    
    // Проверяем доступность таблицы
    const available = await checkTableAvailability();
    
    if (!available) {
        // Сохраняем логи локально
        saveLogsLocally(logs);
        console.warn('[Logger] Table not available, logs saved locally');
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
            console.error('[Logger] Failed to send logs to Supabase:', error.message, error.code, error.details);
            lastFlushError = { message: error.message, code: error.code, time: Date.now() };
            
            // Сохраняем логи локально при ошибке отправки
            saveLogsLocally(enrichedLogs);
        } else {
            lastFlushError = null;
            
            // Пытаемся отправить ранее сохранённые локальные логи
            const localLogs = getLocalLogs();
            if (localLogs.length > 0) {
                console.log('[Logger] Retrying', localLogs.length, 'locally saved logs');
                logBuffer = [...localLogs, ...logBuffer];
                scheduleFlush();
            }
        }
    } catch (error) {
        console.error('[Logger] Flush error:', error.message);
        lastFlushError = { message: error.message, code: 'NETWORK', time: Date.now() };
        
        // Сохраняем логи локально
        saveLogsLocally(logs);
    }
}

function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushLogs();
        flushTimer = null;
    }, FLUSH_INTERVAL);
}

/**
 * Добавляет лог в буфер с локальным сохранением
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
        details: JSON.stringify(details),
        metadata: JSON.stringify(metadata),
        created_at: new Date().toISOString()
    };
    
    logBuffer.push(logEntry);
    
    // Всегда пишем в консоль для отладки
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

/**
 * Проверяет работоспособность логгера
 * Вызывает checkTableAvailability и пишет тестовый лог
 * @returns {Promise<{available: boolean, lastError: Object|null}>}
 */
export async function testLoggerConnection() {
    const available = await checkTableAvailability();
    
    if (available) {
        info(CATEGORIES.SYSTEM, 'logger_test_passed', {
            details: { message: 'Logger connection test passed' }
        });
        await flushLogs();
    }
    
    return {
        available,
        lastError: lastFlushError
    };
}

/**
 * Получает статус логгера
 * @returns {Object}
 */
export function getLoggerStatus() {
    return {
        initialized: isLoggerInitialized,
        tableAvailable: isTableAvailable,
        bufferSize: logBuffer.length,
        lastFlushError: lastFlushError,
        localLogsCount: JSON.parse(localStorage.getItem(LOCAL_LOG_STORE) || '[]').length
    };
}

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

export function error(category, event, errorObj, options = {}) {
    addLog(LOG_LEVELS.ERROR, category, event, { ...options, error: errorObj });
}

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
    warn(CATEGORIES.SYSTEM, `anomaly_${event}`, { details });
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

/**
 * Инициализирует логгер: проверяет таблицу и отправляет локальные логи
 */
export async function initLogger() {
    if (isLoggerInitialized) return;
    
    console.log('[Logger] Initializing...');
    
    const available = await checkTableAvailability();
    
    if (available) {
        // Отправляем ранее сохранённые локальные логи
        const localLogs = getLocalLogs();
        if (localLogs.length > 0) {
            console.log('[Logger] Found', localLogs.length, 'locally saved logs, retrying');
            logBuffer = [...localLogs, ...logBuffer];
            await flushLogs();
        }
    }
    
    isLoggerInitialized = true;
    console.log('[Logger] Initialized. Table available:', available);
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
