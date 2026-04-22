// ========================================
// FILE: ./core/supabase.js
// ========================================

/**
 * Supabase Client Module
 * 
 * Единый клиент Supabase для всего приложения.
 * Предоставляет доступ к базе данных, аутентификации и хранилищу.
 * 
 * Архитектурные решения:
 * - Singleton паттерн — клиент создается один раз.
 * - Поддержка переопределения конфигурации через window.SH_CONFIG.
 * - Автоматическое восстановление сессии.
 * - Утилиты для типовых операций с БД.
 * - Проверка доступности подключения.
 * 
 * @module supabase
 * @version 2.0.0
 * @changes
 * - Добавлена полная JSDoc-документация.
 * - Ключи вынесены в конфигурацию с возможностью переопределения.
 * - Добавлена функция проверки подключения checkConnection.
 * - Добавлены утилиты для работы с хранилищем (uploadFile, getPublicUrl).
 * - Добавлены хелперы для пагинации и мягкого удаления.
 * - Добавлена функция upsert с автоматическим обновлением timestamps.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ========== КОНФИГУРАЦИЯ ==========

/**
 * Конфигурация Supabase по умолчанию.
 * Может быть переопределена через window.SH_CONFIG.
 * 
 * @type {Object}
 * @property {string} url - URL Supabase проекта
 * @property {string} anonKey - Публичный анонимный ключ
 */
const DEFAULT_CONFIG = {
    url: 'https://bhdwniiyrrujeoubrvle.supabase.co',
    anonKey: 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP'
};

/**
 * Получает конфигурацию из глобального объекта или использует значения по умолчанию.
 * 
 * @returns {Object} Конфигурация Supabase
 */
function getConfig() {
    const globalConfig = window.SH_CONFIG || {};
    
    return {
        url: globalConfig.SUPABASE_URL || DEFAULT_CONFIG.url,
        anonKey: globalConfig.SUPABASE_ANON_KEY || DEFAULT_CONFIG.anonKey
    };
}

const config = getConfig();

// ========== СОЗДАНИЕ КЛИЕНТА ==========

/**
 * Единый экземпляр клиента Supabase для всего приложения.
 * 
 * @type {import('@supabase/supabase-js').SupabaseClient}
 */
export const supabase = createClient(config.url, config.anonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'sh-crm-auth'
    },
    db: {
        schema: 'public'
    },
    global: {
        headers: {
            'x-application-name': 'sh-crm'
        }
    }
});

// ========== УТИЛИТЫ ПОДКЛЮЧЕНИЯ ==========

/**
 * Проверяет доступность подключения к Supabase.
 * 
 * @param {number} [timeout=5000] - Таймаут запроса в мс
 * @returns {Promise<Object>} Результат проверки
 * @returns {boolean} .online - true если подключение доступно
 * @returns {number} .latency - Задержка в мс
 * @returns {string} .error - Сообщение об ошибке (если есть)
 * 
 * @example
 * const status = await checkConnection();
 * if (status.online) {
 *     console.log(`Connected with ${status.latency}ms latency`);
 * }
 */
export async function checkConnection(timeout = 5000) {
    const startTime = performance.now();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const { error } = await supabase
            .from('products')
            .select('id', { count: 'exact', head: true })
            .limit(1)
            .abortSignal(controller.signal);
        
        clearTimeout(timeoutId);
        
        const latency = Math.round(performance.now() - startTime);
        
        if (error) {
            console.warn('[Supabase] Connection check failed:', error.message);
            return {
                online: false,
                latency: 0,
                error: error.message
            };
        }
        
        console.log(`[Supabase] Connection OK, latency: ${latency}ms`);
        
        return {
            online: true,
            latency,
            error: null
        };
        
    } catch (error) {
        const latency = Math.round(performance.now() - startTime);
        
        console.error('[Supabase] Connection error:', error);
        
        return {
            online: false,
            latency,
            error: error.message || 'Connection failed'
        };
    }
}

/**
 * Проверяет, доступна ли сеть и Supabase.
 * 
 * @returns {boolean} true если есть подключение к интернету
 */
export function isOnline() {
    return navigator.onLine;
}

/**
 * Подписывается на изменения статуса сети.
 * 
 * @param {Function} onOnline - Колбэк при восстановлении сети
 * @param {Function} onOffline - Колбэк при потере сети
 * @returns {Function} Функция для отписки
 */
export function onNetworkChange(onOnline, onOffline) {
    const handleOnline = () => {
        console.log('[Supabase] Network online');
        onOnline?.();
    };
    
    const handleOffline = () => {
        console.log('[Supabase] Network offline');
        onOffline?.();
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
}

// ========== УТИЛИТЫ ДЛЯ ТАБЛИЦ ==========

/**
 * Выполняет пагинированный запрос к таблице.
 * 
 * @param {string} table - Название таблицы
 * @param {Object} options - Опции запроса
 * @param {number} [options.page=0] - Номер страницы (начиная с 0)
 * @param {number} [options.limit=20] - Количество записей на странице
 * @param {Array<Object>} [options.filters] - Фильтры в формате [{ column, operator, value }]
 * @param {string} [options.orderBy='created_at'] - Поле для сортировки
 * @param {boolean} [options.ascending=false] - По возрастанию
 * @returns {Promise<Object>} Результат с данными и метаинформацией
 * 
 * @example
 * const result = await paginate('products', {
 *     page: 0,
 *     limit: 30,
 *     filters: [{ column: 'status', operator: 'eq', value: 'in_stock' }],
 *     orderBy: 'price'
 * });
 */
export async function paginate(table, options = {}) {
    const {
        page = 0,
        limit = 20,
        filters = [],
        orderBy = 'created_at',
        ascending = false
    } = options;
    
    const from = page * limit;
    const to = from + limit - 1;
    
    let query = supabase
        .from(table)
        .select('*', { count: 'exact' })
        .range(from, to)
        .order(orderBy, { ascending });
    
    // Применяем фильтры
    filters.forEach(({ column, operator, value }) => {
        switch (operator) {
            case 'eq':
                query = query.eq(column, value);
                break;
            case 'neq':
                query = query.neq(column, value);
                break;
            case 'gt':
                query = query.gt(column, value);
                break;
            case 'gte':
                query = query.gte(column, value);
                break;
            case 'lt':
                query = query.lt(column, value);
                break;
            case 'lte':
                query = query.lte(column, value);
                break;
            case 'like':
                query = query.like(column, `%${value}%`);
                break;
            case 'ilike':
                query = query.ilike(column, `%${value}%`);
                break;
            case 'in':
                query = query.in(column, value);
                break;
            case 'is':
                query = query.is(column, value);
                break;
        }
    });
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    
    return {
        data: data || [],
        count: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
        hasMore: from + (data?.length || 0) < (count || 0)
    };
}

/**
 * Выполняет поиск по текстовым полям таблицы.
 * 
 * @param {string} table - Название таблицы
 * @param {string} searchTerm - Поисковый запрос
 * @param {Array<string>} searchFields - Поля для поиска
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Array>} Массив найденных записей
 */
export async function searchTable(table, searchTerm, searchFields, options = {}) {
    if (!searchTerm || searchTerm.trim() === '') {
        const { data } = await supabase
            .from(table)
            .select('*')
            .limit(options.limit || 50);
        return data || [];
    }
    
    const term = searchTerm.trim();
    let query = supabase.from(table).select('*');
    
    // Строим OR запрос для всех полей
    const orConditions = searchFields.map(field => `${field}.ilike.%${term}%`).join(',');
    query = query.or(orConditions);
    
    if (options.limit) {
        query = query.limit(options.limit);
    }
    
    if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? false });
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return data || [];
}

/**
 * Мягкое удаление записи (установка deleted_at).
 * 
 * @param {string} table - Название таблицы
 * @param {string} id - ID записи
 * @returns {Promise<Object>} Обновленная запись
 */
export async function softDelete(table, id) {
    const { data, error } = await supabase
        .from(table)
        .update({
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
    
    if (error) throw error;
    
    return data;
}

/**
 * Восстановление мягко удаленной записи.
 * 
 * @param {string} table - Название таблицы
 * @param {string} id - ID записи
 * @returns {Promise<Object>} Обновленная запись
 */
export async function restoreSoftDeleted(table, id) {
    const { data, error } = await supabase
        .from(table)
        .update({
            deleted_at: null,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
    
    if (error) throw error;
    
    return data;
}

/**
 * Upsert записи с автоматическим обновлением timestamps.
 * 
 * @param {string} table - Название таблицы
 * @param {Object|Array} data - Данные для вставки/обновления
 * @param {string} [conflictColumn='id'] - Колонка для проверки конфликта
 * @returns {Promise<Object>} Результат операции
 */
export async function upsertWithTimestamps(table, data, conflictColumn = 'id') {
    const now = new Date().toISOString();
    
    const dataWithTimestamps = Array.isArray(data)
        ? data.map(item => ({
            ...item,
            updated_at: now,
            created_at: item.created_at || now
        }))
        : {
            ...data,
            updated_at: now,
            created_at: data.created_at || now
        };
    
    const { data: result, error } = await supabase
        .from(table)
        .upsert(dataWithTimestamps, {
            onConflict: conflictColumn,
            ignoreDuplicates: false
        })
        .select();
    
    if (error) throw error;
    
    return result;
}

// ========== УТИЛИТЫ ДЛЯ ХРАНИЛИЩА ==========

/**
 * Загружает файл в Supabase Storage.
 * 
 * @param {string} bucket - Название бакета
 * @param {string} path - Путь к файлу в бакете
 * @param {File|Blob} file - Файл для загрузки
 * @param {Object} options - Опции загрузки
 * @returns {Promise<Object>} Результат загрузки
 */
export async function uploadFile(bucket, path, file, options = {}) {
    const { upsert = true, contentType } = options;
    
    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
            upsert,
            contentType: contentType || file.type
        });
    
    if (error) throw error;
    
    return data;
}

/**
 * Получает публичный URL файла из хранилища.
 * 
 * @param {string} bucket - Название бакета
 * @param {string} path - Путь к файлу
 * @returns {string} Публичный URL
 */
export function getPublicUrl(bucket, path) {
    const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);
    
    return data.publicUrl;
}

/**
 * Удаляет файл из хранилища.
 * 
 * @param {string} bucket - Название бакета
 * @param {string|Array<string>} paths - Путь или массив путей к файлам
 * @returns {Promise<Object>} Результат удаления
 */
export async function deleteFile(bucket, paths) {
    const { data, error } = await supabase.storage
        .from(bucket)
        .remove(Array.isArray(paths) ? paths : [paths]);
    
    if (error) throw error;
    
    return data;
}

/**
 * Загружает фото товара и возвращает публичный URL.
 * 
 * @param {File} file - Файл изображения
 * @param {string} productId - ID товара
 * @returns {Promise<string>} Публичный URL загруженного фото
 */
export async function uploadProductPhoto(file, productId) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${productId}_${Date.now()}.${fileExt}`;
    const filePath = `products/${fileName}`;
    
    await uploadFile('product-photos', filePath, file, {
        contentType: file.type,
        upsert: false
    });
    
    return getPublicUrl('product-photos', filePath);
}

// ========== УТИЛИТЫ АУТЕНТИФИКАЦИИ ==========

/**
 * Получает текущую сессию пользователя.
 * 
 * @returns {Promise<Object|null>} Объект сессии или null
 */
export async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
        console.error('[Supabase] Get session error:', error);
        return null;
    }
    
    return session;
}

/**
 * Получает текущего пользователя.
 * 
 * @returns {Promise<Object|null>} Объект пользователя или null
 */
export async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
        console.error('[Supabase] Get user error:', error);
        return null;
    }
    
    return user;
}

/**
 * Проверяет, авторизован ли пользователь.
 * 
 * @returns {Promise<boolean>} true если пользователь авторизован
 */
export async function isAuthenticated() {
    const session = await getSession();
    return !!session;
}

/**
 * Подписывается на изменения аутентификации.
 * 
 * @param {Function} callback - Функция обратного вызова
 * @returns {Object} Объект подписки с методом unsubscribe
 */
export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Supabase] Auth state changed:', event);
        callback(event, session);
    });
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default supabase;
