// ========================================
// FILE: core/sync-engine/logger.js
// ========================================

/**
 * Extended Logger Module
 * 
 * Подробное логирование для аудита и выявления аномалий.
 * В локальной версии все логи сохраняются только в localStorage.
 * Отправка на сервер будет добавлена позже при подключении VPS.
 * 
 * @module sync-engine/logger
 * @version 3.0.0
 * @changes
 * - v3.0.0: Полный переход на локальное хранение, удалена зависимость от Supabase
 * - Логи сохраняются только в localStorage
 * - Упрощена инициализация (всегда доступна)
 */

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
        const savedUserId = localStorage.getItem('sh_current_user_id');
        return savedUserId || null;
    } catch {
        return null;
    }
}

function getCurrentPage() {
    try {
        const path = window.location.pathname;
        if (path.includes('inventory')) return 'inventory';
        if (path.includes('cashier')) return 'cashier';
        if (path.includes('reports')) return 'reports';
        if (path.includes('login')) return 'login';
        return 'unknown';
    } catch {
        return 'unknown';
    }
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
        return logs;
    } catch {
        return [];
    }
}

// ========== ОТПРАВКА ЛОГОВ (ЛОКАЛЬНАЯ) ==========

/**
 * Отправляет накопленные логи в локальное хранилище.
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
    
    // Сохраняем логи локально
    saveLogsLocally(logs);
    
    isFlushing = false;
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
        device_id: getDeviceId(),
        user_id: getUserId(),
        session_id: sessionId,
        page: getCurrentPage(),
        created_at: new Date().toISOString()
    };
    
    // ВСЕГДА пишем в буфер
    logBuffer.push(logEntry);
    
    // И ВСЕГДА сохраняем локально как fallback
    setTimeout(() => {
        saveLogsLocally([logEntry]);
    }, 0);
    
    // Консоль для отладки
    const consoleMsg = `[${category}] ${event}`;
    const consoleData = typeof details === 'object' ? details : {};
    
    if (level === 'error') console.error(consoleMsg, consoleData);
    else if (level === 'warn') console.warn(consoleMsg, consoleData);
    else if (level === 'info') console.info(consoleMsg, consoleData);
    else console.log(consoleMsg, consoleData);
    
    // Отправляем только если буфер заполнен или это ошибка
    if (logBuffer.length >= BUFFER_SIZE || level === 'error') {
        setTimeout(() => flushLogs(), 0);
    } else {
        scheduleAsyncFlush();
    }
}

// ========== ПУБЛИЧНЫЙ API ==========

/**
 * Тестирует соединение (заглушка для локальной версии)
 * @returns {Promise<Object>}
 */
export async function testLoggerConnection() {
    return {
        available: true,
        lastError: null
    };
}

/**
 * Возвращает статус логгера
 * @returns {Object}
 */
export function getLoggerStatus() {
    return {
        initialized: isLoggerInitialized,
        tableAvailable: true, // Всегда доступно локально
        bufferSize: logBuffer.length,
        isFlushing,
        lastFlushError: null,
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

/**
 * Принудительная отправка всех накопленных логов
 */
export async function flushAllLogs() {
    await flushLogs();
}

export function newSession() {
    sessionId = generateSessionId();
    info(CATEGORIES.USER, 'session_start');
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализирует логгер.
 * В локальной версии всегда доступен.
 */
export async function initLogger() {
    if (isLoggerInitialized) return;
    
    console.log('[Logger] Initializing local logger...');
    
    isLoggerInitialized = true;
    
    // Отправляем накопленные логи если есть
    const localLogs = getLocalLogs();
    if (localLogs.length > 0) {
        console.log('[Logger] Found', localLogs.length, 'locally saved logs');
    }
    
    console.log('[Logger] Initialized (local mode)');
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
