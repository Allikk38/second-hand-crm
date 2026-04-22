// ========================================
// FILE: ./services/ShiftService.js
// ========================================

/**
 * Shift Service
 * 
 * Управление кассовыми сменами: открытие, закрытие, статистика.
 * 
 * Архитектурные решения:
 * - Единый источник правды для операций со сменами.
 * - Встроенное логирование всех операций через logger.
 * - Поддержка офлайн-режима с созданием локальных смен.
 * - Таймауты для предотвращения зависания UI.
 * - Проверка существования профиля пользователя.
 * 
 * @module ShiftService
 * @version 5.0.0
 * @changes
 * - Добавлено структурированное логирование.
 * - Добавлена проверка профиля перед открытием смены.
 * - Добавлены таймауты запросов через AbortController.
 * - Офлайн-режим перенесён из UI в сервис.
 * - Созданы типизированные классы ошибок.
 */

import { db } from '../core/SupabaseClient.js';
import { EventBus } from '../core/EventBus.js';
import { createLogger } from '../utils/logger.js';
import { SaleService } from './SaleService.js';

// ========== КОНСТАНТЫ ==========
const REQUEST_TIMEOUT_MS = 10000; // 10 секунд
const CACHE_TTL_MS = 30000; // 30 секунд

// ========== LOGGER ==========
const logger = createLogger('ShiftService');

// ========== КЛАССЫ ОШИБОК ==========

/**
 * Базовый класс ошибки смены
 */
class ShiftError extends Error {
    constructor(message, code, context = {}) {
        super(message);
        this.name = 'ShiftError';
        this.code = code;
        this.context = context;
    }
}

/**
 * Ошибка: смена уже открыта
 */
class ShiftAlreadyOpenError extends ShiftError {
    constructor(userId, existingShift) {
        super('User already has an open shift', 'SHIFT_ALREADY_OPEN', { userId, existingShift });
        this.name = 'ShiftAlreadyOpenError';
    }
}

/**
 * Ошибка: профиль не найден
 */
class ProfileNotFoundError extends ShiftError {
    constructor(userId) {
        super('User profile not found', 'PROFILE_NOT_FOUND', { userId });
        this.name = 'ProfileNotFoundError';
    }
}

/**
 * Ошибка: таймаут запроса
 */
class ShiftTimeoutError extends ShiftError {
    constructor(operation, timeoutMs) {
        super(`Shift operation timed out after ${timeoutMs}ms`, 'SHIFT_TIMEOUT', { operation, timeoutMs });
        this.name = 'ShiftTimeoutError';
    }
}

/**
 * Ошибка: сеть недоступна (офлайн)
 */
class ShiftOfflineError extends ShiftError {
    constructor(operation) {
        super('Network unavailable', 'SHIFT_OFFLINE', { operation });
        this.name = 'ShiftOfflineError';
    }
}

// ========== КЭШ ==========
const currentShiftCache = new Map();

/**
 * Инвалидирует кэш смены
 * @param {string} userId - ID пользователя (если не указан, очищается весь кэш)
 */
function invalidateShiftCache(userId = null) {
    if (userId) {
        const deleted = currentShiftCache.delete(userId);
        logger.debug(`Cache invalidated for user: ${userId}`, { deleted });
    } else {
        const size = currentShiftCache.size;
        currentShiftCache.clear();
        logger.debug(`Full cache invalidated, cleared ${size} entries`);
    }
}

/**
 * Проверяет валидность кэша
 * @param {Object} cached - Объект кэша
 * @returns {boolean}
 */
function isCacheValid(cached) {
    if (!cached) return false;
    const age = Date.now() - cached.timestamp;
    const isValid = age < CACHE_TTL_MS;
    if (!isValid) {
        logger.debug('Cache entry expired', { age, ttl: CACHE_TTL_MS });
    }
    return isValid;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Выполняет запрос с таймаутом
 * @template T
 * @param {string} operation - Название операции для логирования
 * @param {() => Promise<T>} fn - Функция запроса
 * @param {number} timeoutMs - Таймаут в мс
 * @returns {Promise<T>}
 */
async function withTimeout(operation, fn, timeoutMs = REQUEST_TIMEOUT_MS) {
    logger.debug(`Starting operation: ${operation}`, { timeoutMs });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        logger.warn(`Operation timed out: ${operation}`, { timeoutMs });
    }, timeoutMs);
    
    try {
        const result = await fn(controller.signal);
        clearTimeout(timeoutId);
        logger.debug(`Operation completed: ${operation}`);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            logger.error(`Operation timeout: ${operation}`, { timeoutMs });
            throw new ShiftTimeoutError(operation, timeoutMs);
        }
        
        // Проверяем на сетевую ошибку
        if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('Failed to fetch')) {
            logger.error(`Network error in ${operation}`, { error: error.message });
            throw new ShiftOfflineError(operation);
        }
        
        logger.error(`Operation failed: ${operation}`, { error: error.message, code: error.code });
        throw error;
    }
}

/**
 * Проверяет существование профиля пользователя
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object>} Профиль пользователя
 * @throws {ProfileNotFoundError}
 */
async function ensureUserProfile(userId) {
    logger.debug(`Checking profile for user: ${userId}`);
    
    const { data: profile, error } = await db
        .from('profiles')
        .select('id, full_name, role_id')
        .eq('id', userId)
        .single();
    
    if (error) {
        logger.error('Profile check failed', { userId, error });
        
        // Если профиля нет, пытаемся создать
        if (error.code === 'PGRST116') {
            logger.info('Profile not found, creating new profile', { userId });
            
            const { data: newProfile, error: createError } = await db
                .from('profiles')
                .insert({
                    id: userId,
                    full_name: 'Пользователь',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (createError) {
                logger.error('Failed to create profile', { userId, error: createError });
                throw new ProfileNotFoundError(userId);
            }
            
            logger.info('Profile created successfully', { userId, profile: newProfile });
            return newProfile;
        }
        
        throw new ShiftError('Failed to check user profile', 'PROFILE_CHECK_ERROR', { userId, error });
    }
    
    logger.debug('Profile found', { userId, profile });
    return profile;
}

/**
 * Создаёт локальную смену для офлайн-режима
 * @param {string} userId - ID пользователя
 * @param {Object} options - Опции смены
 * @returns {Object} Локальная смена
 */
function createLocalShift(userId, options = {}) {
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const shift = {
        id: localId,
        user_id: userId,
        opened_at: now,
        initial_cash: options.initialCash || 0,
        notes: options.notes || '',
        status: 'active',
        is_local: true,
        created_at: now,
        updated_at: now
    };
    
    logger.info('Created local shift (offline mode)', { shiftId: localId, userId });
    
    // Сохраняем в localStorage для восстановления
    try {
        const localShifts = JSON.parse(localStorage.getItem('cashier_local_shifts') || '[]');
        localShifts.push(shift);
        localStorage.setItem('cashier_local_shifts', JSON.stringify(localShifts));
        logger.debug('Local shift saved to localStorage', { shiftId: localId });
    } catch (storageError) {
        logger.warn('Failed to save local shift to localStorage', { error: storageError });
    }
    
    return shift;
}

/**
 * Синхронизирует локальную смену с сервером
 * @param {Object} localShift - Локальная смена
 * @returns {Promise<Object>} Серверная смена
 */
async function syncLocalShift(localShift) {
    logger.info('Syncing local shift with server', { localId: localShift.id });
    
    try {
        // Проверяем, нет ли уже открытой смены на сервере
        const existingShift = await getCurrentShiftFromServer(localShift.user_id);
        
        if (existingShift) {
            logger.warn('Server already has an open shift, using server shift', {
                localId: localShift.id,
                serverId: existingShift.id
            });
            return existingShift;
        }
        
        // Создаём смену на сервере
        const serverShift = await withTimeout('syncLocalShift', () => 
            db
                .from('shifts')
                .insert({
                    user_id: localShift.user_id,
                    opened_at: localShift.opened_at,
                    initial_cash: localShift.initial_cash,
                    notes: localShift.notes,
                    status: 'active',
                    created_at: localShift.created_at,
                    updated_at: new Date().toISOString()
                })
                .select()
                .single()
        );
        
        logger.info('Local shift synced successfully', {
            localId: localShift.id,
            serverId: serverShift.id
        });
        
        // Удаляем локальную смену из хранилища
        removeLocalShift(localShift.id);
        
        return serverShift;
    } catch (error) {
        logger.error('Failed to sync local shift', { localId: localShift.id, error });
        throw error;
    }
}

/**
 * Удаляет локальную смену из localStorage
 * @param {string} shiftId - ID смены
 */
function removeLocalShift(shiftId) {
    try {
        const localShifts = JSON.parse(localStorage.getItem('cashier_local_shifts') || '[]');
        const filtered = localShifts.filter(s => s.id !== shiftId);
        localStorage.setItem('cashier_local_shifts', JSON.stringify(filtered));
        logger.debug('Local shift removed from storage', { shiftId });
    } catch (error) {
        logger.warn('Failed to remove local shift', { shiftId, error });
    }
}

/**
 * Получает локальную смену пользователя
 * @param {string} userId - ID пользователя
 * @returns {Object|null}
 */
function getLocalShift(userId) {
    try {
        const localShifts = JSON.parse(localStorage.getItem('cashier_local_shifts') || '[]');
        const openShift = localShifts.find(s => s.user_id === userId && s.status === 'active');
        
        if (openShift) {
            logger.debug('Found local shift', { shiftId: openShift.id, userId });
        }
        
        return openShift || null;
    } catch (error) {
        logger.warn('Failed to read local shifts', { error });
        return null;
    }
}

/**
 * Получает текущую смену с сервера (без кэша)
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object|null>}
 */
async function getCurrentShiftFromServer(userId) {
    logger.debug('Fetching shift from server', { userId });
    
    const { data, error } = await withTimeout('getCurrentShift', () =>
        db
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .single()
    );
    
    if (error) {
        if (error.code === 'PGRST116') {
            logger.debug('No open shift found on server', { userId });
            return null;
        }
        logger.error('Server query failed', { userId, error });
        throw error;
    }
    
    logger.debug('Shift fetched from server', { userId, shiftId: data?.id });
    return data || null;
}

// ========== ПУБЛИЧНЫЙ API ==========

export const ShiftService = {
    /**
     * Получает текущую открытую смену пользователя
     * @param {string} userId - ID пользователя
     * @param {boolean} forceRefresh - Игнорировать кэш
     * @returns {Promise<Object|null>}
     */
    async getCurrentShift(userId, forceRefresh = false) {
        if (!userId) {
            logger.throwError('User ID is required');
        }
        
        logger.group(`getCurrentShift for ${userId}`, () => {
            logger.debug('Parameters', { forceRefresh });
        });
        
        // Проверяем кэш
        if (!forceRefresh) {
            const cached = currentShiftCache.get(userId);
            if (isCacheValid(cached)) {
                logger.debug('Returning cached shift', { shiftId: cached.data?.id });
                return cached.data;
            }
        }
        
        try {
            // Пробуем получить с сервера
            const shift = await getCurrentShiftFromServer(userId);
            
            // Обновляем кэш
            currentShiftCache.set(userId, {
                data: shift,
                timestamp: Date.now()
            });
            
            return shift;
        } catch (error) {
            // При ошибке сети проверяем локальную смену
            if (error instanceof ShiftOfflineError || error instanceof ShiftTimeoutError) {
                logger.warn('Network issue, checking local shift', { userId });
                const localShift = getLocalShift(userId);
                
                if (localShift) {
                    logger.info('Using local shift due to network issue', { shiftId: localShift.id });
                    currentShiftCache.set(userId, {
                        data: localShift,
                        timestamp: Date.now()
                    });
                    return localShift;
                }
            }
            
            throw error;
        }
    },

    /**
     * Проверяет, есть ли у пользователя открытая смена
     * @param {string} userId - ID пользователя
     * @returns {Promise<boolean>}
     */
    async hasOpenShift(userId) {
        logger.debug(`Checking if user has open shift: ${userId}`);
        const shift = await this.getCurrentShift(userId);
        const hasShift = shift !== null;
        logger.debug(`Has open shift: ${hasShift}`, { userId, shiftId: shift?.id });
        return hasShift;
    },

    /**
     * Открывает новую смену
     * @param {string} userId - ID пользователя
     * @param {Object} options - Опции смены
     * @param {boolean} options.allowLocal - Разрешить создание локальной смены при отсутствии сети
     * @returns {Promise<Object>}
     */
    async openShift(userId, options = {}) {
        const { initialCash = 0, notes = '', allowLocal = true } = options;
        
        logger.group(`openShift for ${userId}`, () => {
            logger.debug('Options', { initialCash, notes, allowLocal });
        });
        
        if (!userId) {
            logger.throwError('User ID is required');
        }
        
        // Проверяем, нет ли уже открытой смены
        const existingShift = await this.getCurrentShift(userId, true);
        if (existingShift) {
            logger.warn('Shift already open', { userId, shiftId: existingShift.id });
            throw new ShiftAlreadyOpenError(userId, existingShift);
        }
        
        try {
            // Проверяем профиль
            await ensureUserProfile(userId);
            
            // Пытаемся создать смену на сервере
            const now = new Date().toISOString();
            
            const { data, error } = await withTimeout('openShift', () =>
                db
                    .from('shifts')
                    .insert({
                        user_id: userId,
                        opened_at: now,
                        initial_cash: initialCash,
                        notes,
                        status: 'active',
                        created_at: now,
                        updated_at: now
                    })
                    .select()
                    .single()
            );
            
            if (error) {
                logger.error('Failed to create shift on server', { userId, error });
                throw error;
            }
            
            logger.info('Shift opened on server', { userId, shiftId: data.id });
            
            // Инвалидируем кэш
            invalidateShiftCache(userId);
            
            // Публикуем событие
            EventBus.emit('shift:opened', { shift: data, userId });
            
            return data;
            
        } catch (error) {
            logger.error('Open shift failed', { userId, error: error.message, code: error.code });
            
            // Если разрешён офлайн и ошибка сети/таймаута - создаём локальную смену
            if (allowLocal && (error instanceof ShiftOfflineError || error instanceof ShiftTimeoutError)) {
                logger.info('Creating local shift due to network issue', { userId });
                
                const localShift = createLocalShift(userId, { initialCash, notes });
                
                // Кэшируем локальную смену
                currentShiftCache.set(userId, {
                    data: localShift,
                    timestamp: Date.now()
                });
                
                EventBus.emit('shift:opened:local', { shift: localShift, userId });
                
                return localShift;
            }
            
            throw error;
        }
    },

    /**
     * Закрывает смену
     * @param {string} shiftId - ID смены
     * @param {Object} options - Опции закрытия
     * @returns {Promise<Object>}
     */
    async closeShift(shiftId, options = {}) {
        const { finalCash = null, notes = '' } = options;
        
        logger.group(`closeShift ${shiftId}`, () => {
            logger.debug('Options', { finalCash, notes });
        });
        
        if (!shiftId) {
            logger.throwError('Shift ID is required');
        }
        
        // Проверяем, не локальная ли смена
        if (shiftId.startsWith('local_')) {
            logger.info('Closing local shift', { shiftId });
            
            const localShift = getLocalShift(shiftId);
            if (!localShift) {
                logger.throwError(`Local shift ${shiftId} not found`);
            }
            
            // Получаем статистику продаж (пока 0 для локальной)
            const stats = {
                salesCount: 0,
                totalRevenue: 0,
                totalProfit: 0
            };
            
            const now = new Date().toISOString();
            const closedShift = {
                ...localShift,
                closed_at: now,
                final_cash: finalCash || localShift.initial_cash,
                expected_cash: localShift.initial_cash,
                discrepancy: 0,
                sales_count: stats.salesCount,
                total_revenue: stats.totalRevenue,
                total_profit: stats.totalProfit,
                status: 'closed',
                updated_at: now
            };
            
            // Архивируем
            try {
                const archive = JSON.parse(localStorage.getItem('cashier_shifts_archive') || '[]');
                archive.push(closedShift);
                localStorage.setItem('cashier_shifts_archive', JSON.stringify(archive));
                
                // Удаляем из активных
                removeLocalShift(shiftId);
            } catch (storageError) {
                logger.warn('Failed to archive local shift', { error: storageError });
            }
            
            invalidateShiftCache(localShift.user_id);
            
            EventBus.emit('shift:closed', { shift: closedShift, stats });
            
            logger.info('Local shift closed', { shiftId });
            return closedShift;
        }
        
        // Серверная смена
        try {
            // Получаем данные смены
            const { data: shift, error: fetchError } = await db
                .from('shifts')
                .select('*')
                .eq('id', shiftId)
                .single();
            
            if (fetchError) {
                logger.error('Failed to fetch shift', { shiftId, error: fetchError });
                throw fetchError;
            }
            
            if (shift.closed_at) {
                logger.throwError('Shift is already closed', { shiftId });
            }
            
            // Получаем статистику продаж
            const salesStats = await SaleService.getStats({ shiftId });
            const sales = await SaleService.getByShift(shiftId);
            
            const expectedCash = (shift.initial_cash || 0) + salesStats.totalRevenue;
            const actualFinalCash = finalCash !== null ? finalCash : expectedCash;
            const discrepancy = actualFinalCash - expectedCash;
            const now = new Date().toISOString();
            
            logger.debug('Closing shift', {
                shiftId,
                salesCount: salesStats.count,
                revenue: salesStats.totalRevenue,
                expectedCash,
                finalCash: actualFinalCash,
                discrepancy
            });
            
            const { data, error } = await withTimeout('closeShift', () =>
                db
                    .from('shifts')
                    .update({
                        closed_at: now,
                        final_cash: actualFinalCash,
                        expected_cash: expectedCash,
                        discrepancy,
                        notes: shift.notes + (notes ? '\n' + notes : ''),
                        sales_count: salesStats.count,
                        total_revenue: salesStats.totalRevenue,
                        total_profit: salesStats.totalProfit,
                        status: 'closed',
                        updated_at: now
                    })
                    .eq('id', shiftId)
                    .select()
                    .single()
            );
            
            if (error) {
                logger.error('Failed to close shift on server', { shiftId, error });
                throw error;
            }
            
            logger.info('Shift closed on server', { shiftId, discrepancy });
            
            invalidateShiftCache(shift.user_id);
            
            EventBus.emit('shift:closed', {
                shift: data,
                stats: {
                    salesCount: salesStats.count,
                    revenue: salesStats.totalRevenue,
                    profit: salesStats.totalProfit,
                    expectedCash,
                    finalCash: actualFinalCash,
                    discrepancy
                },
                sales
            });
            
            return data;
            
        } catch (error) {
            logger.error('Close shift failed', { shiftId, error });
            throw error;
        }
    },

    /**
     * Получает все открытые смены
     * @returns {Promise<Array>}
     */
    async getActiveShifts() {
        logger.debug('Fetching active shifts');
        
        const { data, error } = await db
            .from('shifts')
            .select(`
                *,
                profiles:user_id (
                    full_name,
                    email
                )
            `)
            .is('closed_at', null)
            .order('opened_at', { ascending: false });
        
        if (error) {
            logger.error('Failed to fetch active shifts', { error });
            throw error;
        }
        
        logger.debug(`Found ${data?.length || 0} active shifts`);
        return data || [];
    },

    /**
     * Получает историю смен пользователя
     * @param {string} userId - ID пользователя
     * @param {Object} options - Опции
     * @returns {Promise<Array>}
     */
    async getUserHistory(userId, options = {}) {
        if (!userId) {
            logger.throwError('User ID is required');
        }
        
        const { limit = 50, offset = 0, includeOpen = false } = options;
        
        logger.debug(`Fetching shift history for user: ${userId}`, { limit, offset, includeOpen });
        
        let query = db
            .from('shifts')
            .select('*')
            .eq('user_id', userId)
            .order('opened_at', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (!includeOpen) {
            query = query.not('closed_at', 'is', null);
        }
        
        const { data, error } = await query;
        
        if (error) {
            logger.error('Failed to fetch user history', { userId, error });
            throw error;
        }
        
        logger.debug(`Found ${data?.length || 0} shifts`);
        return data || [];
    },

    /**
     * Получает детальную информацию о смене
     * @param {string} shiftId - ID смены
     * @returns {Promise<Object>}
     */
    async getShiftDetails(shiftId) {
        if (!shiftId) {
            logger.throwError('Shift ID is required');
        }
        
        logger.debug(`Fetching shift details: ${shiftId}`);
        
        const { data: shift, error: shiftError } = await db
            .from('shifts')
            .select(`
                *,
                profiles:user_id (
                    full_name,
                    email
                )
            `)
            .eq('id', shiftId)
            .single();
        
        if (shiftError) {
            logger.error('Failed to fetch shift details', { shiftId, error: shiftError });
            throw shiftError;
        }
        
        const sales = await SaleService.getByShift(shiftId);
        
        const paymentBreakdown = {};
        sales.forEach(sale => {
            const method = sale.payment_method || 'unknown';
            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + sale.total;
        });
        
        logger.debug('Shift details fetched', { shiftId, salesCount: sales.length });
        
        return {
            ...shift,
            sales,
            salesCount: sales.length,
            paymentBreakdown
        };
    },

    /**
     * Получает текущую статистику по открытой смене
     * @param {string} shiftId - ID смены
     * @returns {Promise<Object>}
     */
    async getCurrentShiftStats(shiftId) {
        if (!shiftId) {
            logger.throwError('Shift ID is required');
        }
        
        logger.debug(`Fetching current shift stats: ${shiftId}`);
        
        // Если локальная смена - возвращаем базовую статистику
        if (shiftId.startsWith('local_')) {
            logger.debug('Local shift stats requested', { shiftId });
            return {
                shiftId,
                openedAt: new Date().toISOString(),
                duration: 0,
                initialCash: 0,
                salesCount: 0,
                totalRevenue: 0,
                totalProfit: 0,
                expectedCash: 0,
                averageCheck: 0,
                paymentMethods: {}
            };
        }
        
        const { data: shift, error: shiftError } = await db
            .from('shifts')
            .select('*')
            .eq('id', shiftId)
            .single();
        
        if (shiftError) {
            logger.error('Failed to fetch shift for stats', { shiftId, error: shiftError });
            throw shiftError;
        }
        
        const salesStats = await SaleService.getStats({ shiftId });
        
        const expectedCash = (shift.initial_cash || 0) + salesStats.totalRevenue;
        
        logger.debug('Shift stats calculated', {
            shiftId,
            salesCount: salesStats.count,
            revenue: salesStats.totalRevenue
        });
        
        return {
            shiftId,
            openedAt: shift.opened_at,
            duration: Date.now() - new Date(shift.opened_at).getTime(),
            initialCash: shift.initial_cash || 0,
            salesCount: salesStats.count,
            totalRevenue: salesStats.totalRevenue,
            totalProfit: salesStats.totalProfit,
            expectedCash,
            averageCheck: salesStats.averageCheck,
            paymentMethods: salesStats.byPaymentMethod
        };
    },

    /**
     * Получает сводную статистику по сменам
     * @param {Object} options - Опции фильтрации
     * @returns {Promise<Object>}
     */
    async getOverallStats(options = {}) {
        const { startDate, endDate, userId } = options;
        
        logger.debug('Fetching overall shift stats', { startDate, endDate, userId });
        
        let query = db
            .from('shifts')
            .select('total_revenue, total_profit, sales_count, discrepancy')
            .not('closed_at', 'is', null);
        
        if (startDate) {
            const start = typeof startDate === 'string' ? startDate : startDate.toISOString();
            query = query.gte('opened_at', start);
        }
        if (endDate) {
            const end = typeof endDate === 'string' ? endDate : endDate.toISOString();
            query = query.lte('closed_at', end);
        }
        if (userId) {
            query = query.eq('user_id', userId);
        }
        
        const { data, error } = await query;
        
        if (error) {
            logger.error('Failed to fetch overall stats', { error });
            throw error;
        }
        
        const shiftsData = data || [];
        
        const stats = {
            totalShifts: shiftsData.length,
            totalRevenue: 0,
            totalProfit: 0,
            totalSales: 0,
            totalDiscrepancy: 0,
            averageRevenue: 0,
            averageProfit: 0
        };
        
        shiftsData.forEach(shift => {
            stats.totalRevenue += shift.total_revenue || 0;
            stats.totalProfit += shift.total_profit || 0;
            stats.totalSales += shift.sales_count || 0;
            stats.totalDiscrepancy += Math.abs(shift.discrepancy || 0);
        });
        
        if (stats.totalShifts > 0) {
            stats.averageRevenue = stats.totalRevenue / stats.totalShifts;
            stats.averageProfit = stats.totalProfit / stats.totalShifts;
        }
        
        logger.debug('Overall stats calculated', stats);
        
        return stats;
    },

    /**
     * Синхронизирует все локальные смены с сервером
     * @returns {Promise<number>} Количество синхронизированных смен
     */
    async syncLocalShifts() {
        logger.info('Syncing local shifts with server');
        
        try {
            const localShifts = JSON.parse(localStorage.getItem('cashier_local_shifts') || '[]');
            
            if (localShifts.length === 0) {
                logger.debug('No local shifts to sync');
                return 0;
            }
            
            logger.info(`Found ${localShifts.length} local shifts to sync`);
            
            let syncedCount = 0;
            
            for (const localShift of localShifts) {
                try {
                    await syncLocalShift(localShift);
                    syncedCount++;
                } catch (error) {
                    logger.error('Failed to sync individual shift', {
                        localId: localShift.id,
                        error: error.message
                    });
                }
            }
            
            logger.info(`Synced ${syncedCount} of ${localShifts.length} local shifts`);
            return syncedCount;
            
        } catch (error) {
            logger.error('Failed to sync local shifts', { error });
            throw error;
        }
    },

    /**
     * Очищает кэш смен
     */
    clearCache() {
        invalidateShiftCache();
        logger.info('Shift cache cleared');
    }
};

// ========== АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==========

// При восстановлении сети пытаемся синхронизировать локальные смены
window.addEventListener('online', () => {
    logger.info('Network online, attempting to sync local shifts');
    ShiftService.syncLocalShifts().catch(error => {
        logger.error('Auto-sync failed', { error });
    });
});

// Экспорт для отладки
if (typeof window !== 'undefined') {
    window.__ShiftService = ShiftService;
}

export default ShiftService;
