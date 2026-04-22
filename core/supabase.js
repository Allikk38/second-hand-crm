// ========================================
// FILE: ./core/supabase.js
// ========================================

/**
 * Supabase Client Module (Multi-CDN with fallback)
 * 
 * Единый клиент Supabase для всего приложения.
 * Использует несколько CDN с автоматическим переключением при недоступности.
 * 
 * Архитектурные решения:
 * - Основной CDN: jsDelivr (хорошо работает в РФ).
 * - Запасные CDN: unpkg, esm.sh.
 * - При полной недоступности CDN показывает понятную ошибку.
 * 
 * @module supabase
 * @version 2.2.0
 * @changes
 * - Добавлена поддержка нескольких CDN с fallback.
 * - Основной CDN заменен на jsDelivr.
 */

// ========== ЗАГРУЗКА SUPABASE С FALLBACK ==========

/**
 * Список CDN для загрузки Supabase (в порядке приоритета)
 */
const SUPABASE_CDNS = [
    {
        name: 'jsDelivr',
        url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
    },
    {
        name: 'unpkg',
        url: 'https://unpkg.com/@supabase/supabase-js@2?module'
    },
    {
        name: 'esm.sh',
        url: 'https://esm.sh/@supabase/supabase-js@2'
    }
];

/**
 * Загружает Supabase с указанного CDN
 * @param {string} url - URL для загрузки
 * @returns {Promise<Object>} Модуль Supabase
 */
async function loadFromCDN(url) {
    return import(url);
}

/**
 * Загружает Supabase с перебором CDN до первого успешного
 * @returns {Promise<Object>} Модуль Supabase
 */
async function loadSupabase() {
    let lastError = null;
    
    for (const cdn of SUPABASE_CDNS) {
        try {
            console.log(`[Supabase] Пробуем загрузить с ${cdn.name}...`);
            
            const module = await loadFromCDN(cdn.url);
            
            if (module && module.createClient) {
                console.log(`[Supabase] ✅ Успешно загружено с ${cdn.name}`);
                return module;
            } else {
                throw new Error(`Модуль загружен, но createClient не найден`);
            }
            
        } catch (error) {
            console.warn(`[Supabase] ❌ ${cdn.name} недоступен:`, error.message);
            lastError = error;
        }
    }
    
    // Все CDN недоступны
    throw new Error(
        `Не удалось загрузить Supabase ни с одного CDN.\n` +
        `Проверьте подключение к интернету.\n` +
        `Последняя ошибка: ${lastError?.message || 'неизвестно'}`
    );
}

// Загружаем Supabase и создаем клиент
let supabaseInstance = null;

try {
    const supabaseModule = await loadSupabase();
    const { createClient } = supabaseModule;
    
    // ========== КОНФИГУРАЦИЯ ==========
    
    const DEFAULT_CONFIG = {
        url: 'https://bhdwniiyrrujeoubrvle.supabase.co',
        anonKey: 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP'
    };
    
    function getConfig() {
        const globalConfig = window.SH_CONFIG || {};
        return {
            url: globalConfig.SUPABASE_URL || DEFAULT_CONFIG.url,
            anonKey: globalConfig.SUPABASE_ANON_KEY || DEFAULT_CONFIG.anonKey
        };
    }
    
    const config = getConfig();
    
    // ========== СОЗДАНИЕ КЛИЕНТА ==========
    
    supabaseInstance = createClient(config.url, config.anonKey, {
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
    
    console.log('[Supabase] Клиент успешно создан');
    
} catch (error) {
    console.error('[Supabase] КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    
    // Создаем заглушку, чтобы не ломать импорты в других модулях
    supabaseInstance = {
        auth: {
            getSession: () => Promise.resolve({ data: { session: null }, error: new Error('Supabase не загружен') }),
            getUser: () => Promise.resolve({ data: { user: null }, error: new Error('Supabase не загружен') }),
            signOut: () => Promise.resolve({ error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
        },
        from: () => {
            throw new Error('Supabase не загружен. Проверьте подключение к интернету.');
        },
        storage: {
            from: () => {
                throw new Error('Supabase не загружен. Проверьте подключение к интернету.');
            }
        }
    };
    
    // Показываем ошибку пользователю
    setTimeout(() => {
        alert(`Ошибка загрузки Supabase: ${error.message}\n\nПроверьте подключение к интернету и обновите страницу.`);
    }, 100);
}

// ========== ЭКСПОРТ КЛИЕНТА ==========

export const supabase = supabaseInstance;

// ========== УТИЛИТЫ ПОДКЛЮЧЕНИЯ ==========

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
            return { online: false, latency: 0, error: error.message };
        }
        
        console.log(`[Supabase] Connection OK, latency: ${latency}ms`);
        return { online: true, latency, error: null };
        
    } catch (error) {
        const latency = Math.round(performance.now() - startTime);
        console.error('[Supabase] Connection error:', error);
        return { online: false, latency, error: error.message || 'Connection failed' };
    }
}

export function isOnline() {
    return navigator.onLine;
}

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
    
    filters.forEach(({ column, operator, value }) => {
        switch (operator) {
            case 'eq': query = query.eq(column, value); break;
            case 'neq': query = query.neq(column, value); break;
            case 'gt': query = query.gt(column, value); break;
            case 'gte': query = query.gte(column, value); break;
            case 'lt': query = query.lt(column, value); break;
            case 'lte': query = query.lte(column, value); break;
            case 'like': query = query.like(column, `%${value}%`); break;
            case 'ilike': query = query.ilike(column, `%${value}%`); break;
            case 'in': query = query.in(column, value); break;
            case 'is': query = query.is(column, value); break;
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
    
    const orConditions = searchFields.map(field => `${field}.ilike.%${term}%`).join(',');
    query = query.or(orConditions);
    
    if (options.limit) query = query.limit(options.limit);
    if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending ?? false });
    
    const { data, error } = await query;
    if (error) throw error;
    
    return data || [];
}

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

export async function uploadFile(bucket, path, file, options = {}) {
    const { upsert = true, contentType } = options;
    
    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert, contentType: contentType || file.type });
    
    if (error) throw error;
    return data;
}

export function getPublicUrl(bucket, path) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}

export async function deleteFile(bucket, paths) {
    const { data, error } = await supabase.storage
        .from(bucket)
        .remove(Array.isArray(paths) ? paths : [paths]);
    
    if (error) throw error;
    return data;
}

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

export async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('[Supabase] Get session error:', error);
        return null;
    }
    return session;
}

export async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
        console.error('[Supabase] Get user error:', error);
        return null;
    }
    return user;
}

export async function isAuthenticated() {
    const session = await getSession();
    return !!session;
}

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Supabase] Auth state changed:', event);
        callback(event, session);
    });
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default supabase;
