/**
 * Logger Utility
 * 
 * Централизованная система логирования для приложения.
 * Поддерживает уровни логирования, пространства имён и отключение в production.
 * 
 * Архитектурные решения:
 * - Уровни логирования для фильтрации (DEBUG, INFO, WARN, ERROR)
 * - Пространства имён для контекстного логирования
 * - Автоматическое отключение DEBUG в production
 * - Форматирование с временными метками
 * 
 * @module logger
 * @version 1.1.0
 * @changes
 * - Убрана отправка логов на сервер (не требуется).
 * - Упрощена буферизация ошибок.
 * - Добавлена проверка console.group.
 * - Улучшена обработка stack trace в throwError.
 */

// ========== КОНФИГУРАЦИЯ ==========

/**
 * Текущее окружение
 * @type {'development'|'production'}
 */
const ENV = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('.local')) {
        return 'development';
    }
    return 'production';
})();

/**
 * Уровни логирования
 * @enum {number}
 */
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

/**
 * Минимальный уровень логирования в зависимости от окружения
 */
const MIN_LEVEL = ENV === 'development' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

/**
 * Хранилище логов для отладки
 * @type {Array<Object>}
 */
const logBuffer = [];
const MAX_BUFFER_SIZE = 50;

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Форматирует текущее время для лога
 * @returns {string} Отформатированное время HH:MM:SS.mmm
 */
function formatTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Получает символ для уровня логирования
 * @param {number} level - Уровень логирования
 * @returns {string}
 */
function getLevelSymbol(level) {
    switch (level) {
        case LOG_LEVELS.DEBUG: return '🔍';
        case LOG_LEVELS.INFO: return 'ℹ️';
        case LOG_LEVELS.WARN: return '⚠️';
        case LOG_LEVELS.ERROR: return '❌';
        default: return '📝';
    }
}

/**
 * Получает текстовое название уровня
 * @param {number} level - Уровень логирования
 * @returns {string}
 */
function getLevelName(level) {
    switch (level) {
        case LOG_LEVELS.DEBUG: return 'DEBUG';
        case LOG_LEVELS.INFO: return 'INFO';
        case LOG_LEVELS.WARN: return 'WARN';
        case LOG_LEVELS.ERROR: return 'ERROR';
        default: return 'LOG';
    }
}

/**
 * Форматирует сообщение лога
 * @param {string} namespace - Пространство имён
 * @param {number} level - Уровень логирования
 * @param {Array} args - Аргументы для логирования
 * @returns {Array} Отформатированные аргументы
 */
function formatLogMessage(namespace, level, args) {
    const timestamp = formatTimestamp();
    const symbol = getLevelSymbol(level);
    const prefix = `[${timestamp}] ${symbol} [${namespace}]`;
    
    if (typeof args[0] === 'string') {
        return [`${prefix} ${args[0]}`, ...args.slice(1)];
    }
    
    return [prefix, ...args];
}

/**
 * Сохраняет лог в буфер для отладки
 * @param {string} namespace - Пространство имён
 * @param {number} level - Уровень логирования
 * @param {Array} args - Аргументы лога
 */
function bufferLog(namespace, level, args) {
    if (level < LOG_LEVELS.WARN) return;
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        namespace,
        level: getLevelName(level),
        message: args.map(arg => {
            if (arg instanceof Error) {
                return {
                    name: arg.name,
                    message: arg.message,
                    stack: arg.stack
                };
            }
            if (typeof arg === 'object') {
                try {
                    return JSON.parse(JSON.stringify(arg));
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
    };
    
    logBuffer.push(logEntry);
    
    if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift();
    }
}

// ========== ПУБЛИЧНЫЙ API ==========

/**
 * Создаёт логгер для указанного пространства имён
 * @param {string} namespace - Пространство имён (например, 'ShiftPanel', 'CashierApp')
 * @returns {Object} Объект с методами логирования
 * @throws {Error} Если namespace не указан
 */
export function createLogger(namespace) {
    if (!namespace || typeof namespace !== 'string') {
        throw new Error('Logger: namespace is required and must be a string');
    }
    
    return {
        /**
         * Логирует отладочное сообщение (только в development)
         * @param {...any} args - Аргументы для логирования
         */
        debug(...args) {
            if (MIN_LEVEL <= LOG_LEVELS.DEBUG) {
                console.debug(...formatLogMessage(namespace, LOG_LEVELS.DEBUG, args));
            }
        },
        
        /**
         * Логирует информационное сообщение
         * @param {...any} args - Аргументы для логирования
         */
        info(...args) {
            if (MIN_LEVEL <= LOG_LEVELS.INFO) {
                console.info(...formatLogMessage(namespace, LOG_LEVELS.INFO, args));
            }
        },
        
        /**
         * Логирует предупреждение
         * @param {...any} args - Аргументы для логирования
         */
        warn(...args) {
            if (MIN_LEVEL <= LOG_LEVELS.WARN) {
                console.warn(...formatLogMessage(namespace, LOG_LEVELS.WARN, args));
                bufferLog(namespace, LOG_LEVELS.WARN, args);
            }
        },
        
        /**
         * Логирует ошибку
         * @param {...any} args - Аргументы для логирования
         */
        error(...args) {
            if (MIN_LEVEL <= LOG_LEVELS.ERROR) {
                console.error(...formatLogMessage(namespace, LOG_LEVELS.ERROR, args));
                bufferLog(namespace, LOG_LEVELS.ERROR, args);
            }
        },
        
        /**
         * Логирует и бросает ошибку
         * @param {string|Error} error - Сообщение об ошибке или объект Error
         * @param {Object} [context] - Дополнительный контекст
         * @throws {Error}
         */
        throwError(error, context = {}) {
            const errorObj = typeof error === 'string' ? new Error(error) : error;
            
            // Добавляем контекст к ошибке
            if (context && typeof context === 'object') {
                errorObj.context = context;
            }
            
            this.error('Throwing error:', errorObj.message, context);
            
            throw errorObj;
        },
        
        /**
         * Начинает измерение производительности
         * @param {string} label - Метка для измерения
         */
        time(label) {
            if (MIN_LEVEL <= LOG_LEVELS.DEBUG && console.time) {
                console.time(`[${namespace}] ${label}`);
            }
        },
        
        /**
         * Завершает измерение производительности
         * @param {string} label - Метка для измерения
         */
        timeEnd(label) {
            if (MIN_LEVEL <= LOG_LEVELS.DEBUG && console.timeEnd) {
                console.timeEnd(`[${namespace}] ${label}`);
            }
        },
        
        /**
         * Создаёт сгруппированный лог
         * @param {string} label - Заголовок группы
         * @param {Function} fn - Функция, внутри которой пишутся логи
         */
        group(label, fn) {
            if (MIN_LEVEL <= LOG_LEVELS.DEBUG) {
                const hasGroupCollapsed = typeof console.groupCollapsed === 'function';
                const hasGroupEnd = typeof console.groupEnd === 'function';
                
                if (hasGroupCollapsed) {
                    console.groupCollapsed(`[${namespace}] ${label}`);
                } else if (hasGroupEnd) {
                    console.group(`[${namespace}] ${label}`);
                } else {
                    console.log(`--- ${label} ---`);
                }
                
                try {
                    fn();
                } finally {
                    if (hasGroupEnd) {
                        console.groupEnd();
                    }
                }
            } else {
                fn();
            }
        },
        
        /**
         * Логирует состояние объекта с форматированием
         * @param {string} label - Описание состояния
         * @param {Object} state - Объект состояния
         */
        state(label, stateObj) {
            if (MIN_LEVEL <= LOG_LEVELS.DEBUG) {
                console.debug(...formatLogMessage(namespace, LOG_LEVELS.DEBUG, [`${label}:`, stateObj]));
            }
        }
    };
}

/**
 * Глобальный логгер без пространства имён
 */
export const logger = createLogger('App');

/**
 * Получает накопленные логи (для отладки)
 * @returns {Array<Object>} Массив логов
 */
export function getBufferedLogs() {
    return [...logBuffer];
}

/**
 * Очищает буфер логов
 */
export function clearLogBuffer() {
    logBuffer.length = 0;
}

// ========== ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ ОШИБОК ==========

// Перехват глобальных ошибок (только в development)
if (ENV === 'development') {
    window.addEventListener('error', (event) => {
        const errorLogger = createLogger('Global');
        errorLogger.error('Uncaught error:', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: event.error
        });
    });
    
    window.addEventListener('unhandledrejection', (event) => {
        const errorLogger = createLogger('Global');
        errorLogger.error('Unhandled promise rejection:', {
            reason: event.reason
        });
    });
}

// Экспорт для использования в консоли браузера (только development)
if (ENV === 'development' && typeof window !== 'undefined') {
    window.__logger = { 
        createLogger, 
        getBufferedLogs, 
        clearLogBuffer,
        LOG_LEVELS
    };
}

export default logger;
