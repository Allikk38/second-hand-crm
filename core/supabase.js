// ========================================
// FILE: ./core/supabase.js
// ========================================

/**
 * Supabase Client Module (Standalone - No CDN)
 * 
 * Автономная реализация Supabase клиента без внешних зависимостей.
 * Работает напрямую через REST API Supabase.
 * 
 * Архитектурные решения:
 * - Полностью автономный, не требует CDN.
 * - Реализует только необходимые методы для работы приложения.
 * - Использует fetch API для запросов к Supabase.
 * - Сохраняет сессию в localStorage.
 * 
 * @module supabase
 * @version 3.0.0
 * @changes
 * - Полностью переписан без внешних зависимостей.
 * - Реализованы базовые методы: auth, from, select, insert, update, delete.
 * - Добавлено управление сессией через localStorage.
 */

// ========== КОНФИГУРАЦИЯ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// Ключ для хранения сессии
const SESSION_STORAGE_KEY = 'sh-crm-auth';

// ========== УПРАВЛЕНИЕ СЕССИЕЙ ==========

/**
 * Сохраняет сессию в localStorage
 */
function saveSession(session) {
    if (session) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
    }
}

/**
 * Загружает сессию из localStorage
 */
function loadSession() {
    try {
        const stored = localStorage.getItem(SESSION_STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

/**
 * Текущая сессия
 */
let currentSession = loadSession();
let authChangeCallbacks = [];

/**
 * Уведомляет подписчиков об изменении аутентификации
 */
function notifyAuthChange(event, session) {
    authChangeCallbacks.forEach(cb => {
        try {
            cb(event, session);
        } catch (e) {
            console.error('[Supabase] Auth change callback error:', e);
        }
    });
}

// ========== HTTP ЗАПРОСЫ ==========

/**
 * Выполняет HTTP запрос к Supabase API
 */
async function request(endpoint, options = {}) {
    const { method = 'GET', body, headers = {} } = options;
    
    const url = `${SUPABASE_URL}${endpoint}`;
    
    const requestHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...headers
    };
    
    // Добавляем токен авторизации если есть сессия
    if (currentSession?.access_token) {
        requestHeaders['Authorization'] = `Bearer ${currentSession.access_token}`;
    }
    
    try {
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined
        });
        
        // Обработка ошибок
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { message: errorText };
            }
            
            const error = new Error(errorData.message || errorData.error || response.statusText);
            error.code = errorData.code;
            error.status = response.status;
            error.details = errorData;
            throw error;
        }
        
        // Для ответов без тела (например DELETE)
        if (response.status === 204) {
            return { data: null, error: null };
        }
        
        const data = await response.json();
        return { data, error: null };
        
    } catch (error) {
        console.error('[Supabase] Request error:', error);
        return { data: null, error };
    }
}

// ========== QUERY BUILDER ==========

/**
 * Строитель запросов к таблице
 */
class QueryBuilder {
    constructor(tableName) {
        this.tableName = tableName;
        this.filters = [];
        this.selectColumns = '*';
        this.orderColumn = null;
        this.orderAscending = true;
        this.limitCount = null;
        this.rangeStart = null;
        this.rangeEnd = null;
        this.countOption = null;
    }
    
    /**
     * Выбирает колонки
     */
    select(columns = '*', options = {}) {
        this.selectColumns = columns;
        if (options.count) {
            this.countOption = options.count;
        }
        return this;
    }
    
    /**
     * Фильтр равенства
     */
    eq(column, value) {
        this.filters.push({ type: 'eq', column, value });
        return this;
    }
    
    /**
     * Фильтр неравенства
     */
    neq(column, value) {
        this.filters.push({ type: 'neq', column, value });
        return this;
    }
    
    /**
     * Фильтр больше
     */
    gt(column, value) {
        this.filters.push({ type: 'gt', column, value });
        return this;
    }
    
    /**
     * Фильтр больше или равно
     */
    gte(column, value) {
        this.filters.push({ type: 'gte', column, value });
        return this;
    }
    
    /**
     * Фильтр меньше
     */
    lt(column, value) {
        this.filters.push({ type: 'lt', column, value });
        return this;
    }
    
    /**
     * Фильтр меньше или равно
     */
    lte(column, value) {
        this.filters.push({ type: 'lte', column, value });
        return this;
    }
    
    /**
     * Фильтр LIKE
     */
    like(column, pattern) {
        this.filters.push({ type: 'like', column, value: pattern });
        return this;
    }
    
    /**
     * Фильтр ILIKE (регистронезависимый)
     */
    ilike(column, pattern) {
        this.filters.push({ type: 'ilike', column, value: pattern });
        return this;
    }
    
    /**
     * Фильтр IN
     */
    in(column, values) {
        this.filters.push({ type: 'in', column, value: values });
        return this;
    }
    
    /**
     * Фильтр IS
     */
    is(column, value) {
        this.filters.push({ type: 'is', column, value });
        return this;
    }
    
    /**
     * OR условие
     */
    or(condition) {
        this.filters.push({ type: 'or', value: condition });
        return this;
    }
    
    /**
     * Сортировка
     */
    order(column, options = {}) {
        this.orderColumn = column;
        this.orderAscending = options.ascending !== false;
        return this;
    }
    
    /**
     * Лимит записей
     */
    limit(count) {
        this.limitCount = count;
        return this;
    }
    
    /**
     * Диапазон для пагинации
     */
    range(start, end) {
        this.rangeStart = start;
        this.rangeEnd = end;
        return this;
    }
    
    /**
     * Одиночная запись
     */
    async single() {
        this.limitCount = 1;
        const result = await this.execute();
        if (result.error) throw result.error;
        
        if (Array.isArray(result.data) && result.data.length > 0) {
            return { data: result.data[0], error: null };
        }
        
        throw { code: 'PGRST116', message: 'Record not found' };
    }
    
    /**
     * Строит URL с query параметрами
     */
    buildUrl() {
        let url = `/rest/v1/${this.tableName}`;
        
        const params = new URLSearchParams();
        
        // Select
        if (this.selectColumns !== '*') {
            params.append('select', this.selectColumns);
        }
        
        // Order
        if (this.orderColumn) {
            params.append('order', `${this.orderColumn}.${this.orderAscending ? 'asc' : 'desc'}`);
        }
        
        // Limit
        if (this.limitCount !== null) {
            params.append('limit', this.limitCount.toString());
        }
        
        // Filters
        this.filters.forEach(filter => {
            switch (filter.type) {
                case 'eq':
                    params.append(filter.column, `eq.${filter.value}`);
                    break;
                case 'neq':
                    params.append(filter.column, `neq.${filter.value}`);
                    break;
                case 'gt':
                    params.append(filter.column, `gt.${filter.value}`);
                    break;
                case 'gte':
                    params.append(filter.column, `gte.${filter.value}`);
                    break;
                case 'lt':
                    params.append(filter.column, `lt.${filter.value}`);
                    break;
                case 'lte':
                    params.append(filter.column, `lte.${filter.value}`);
                    break;
                case 'like':
                    params.append(filter.column, `like.${filter.value}`);
                    break;
                case 'ilike':
                    params.append(filter.column, `ilike.${filter.value}`);
                    break;
                case 'in':
                    params.append(filter.column, `in.(${filter.value.join(',')})`);
                    break;
                case 'is':
                    params.append(filter.column, `is.${filter.value}`);
                    break;
                case 'or':
                    params.append('or', filter.value);
                    break;
            }
        });
        
        const queryString = params.toString();
        return queryString ? `${url}?${queryString}` : url;
    }
    
    /**
     * Выполняет SELECT запрос
     */
    async execute() {
        const url = this.buildUrl();
        
        const headers = {};
        
        if (this.rangeStart !== null && this.rangeEnd !== null) {
            headers['Range'] = `${this.rangeStart}-${this.rangeEnd}`;
        }
        
        if (this.countOption) {
            headers['Prefer'] = `count=${this.countOption}`;
        }
        
        const { data, error } = await request(url, { headers });
        
        if (error) {
            return { data: null, error };
        }
        
        // Для count запросов
        if (this.countOption) {
            // Count возвращается в заголовке Content-Range
            // Пропускаем для простоты
        }
        
        return { data, error: null };
    }
    
    /**
     * Алиас для execute
     */
    then(resolve, reject) {
        return this.execute().then(result => {
            if (result.error) {
                reject(result.error);
            } else {
                resolve(result);
            }
        }).catch(reject);
    }
}

/**
 * Storage Query Builder
 */
class StorageQueryBuilder {
    constructor(bucket) {
        this.bucket = bucket;
    }
    
    /**
     * Загрузка файла
     */
    async upload(path, file, options = {}) {
        const url = `/storage/v1/object/${this.bucket}/${path}`;
        
        const formData = new FormData();
        formData.append('file', file);
        
        const headers = {};
        if (options.upsert) {
            headers['x-upsert'] = 'true';
        }
        
        const response = await fetch(`${SUPABASE_URL}${url}`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': currentSession?.access_token ? `Bearer ${currentSession.access_token}` : '',
                ...headers
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }
        
        return { data: await response.json(), error: null };
    }
    
    /**
     * Получение публичного URL
     */
    getPublicUrl(path) {
        const url = `${SUPABASE_URL}/storage/v1/object/public/${this.bucket}/${path}`;
        return { data: { publicUrl: url } };
    }
    
    /**
     * Удаление файлов
     */
    async remove(paths) {
        const url = `/storage/v1/object/${this.bucket}`;
        
        const response = await fetch(`${SUPABASE_URL}${url}`, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': currentSession?.access_token ? `Bearer ${currentSession.access_token}` : '',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prefixes: paths })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }
        
        return { data: await response.json(), error: null };
    }
}

// ========== SUPABASE КЛИЕНТ ==========

/**
 * Supabase клиент
 */
const supabase = {
    // ====== AUTH ======
    auth: {
        /**
         * Получение текущей сессии
         */
        async getSession() {
            // Проверяем валидность токена
            if (currentSession) {
                try {
                    const { data, error } = await request('/auth/v1/user');
                    if (error) {
                        // Токен невалидный
                        currentSession = null;
                        saveSession(null);
                        notifyAuthChange('SIGNED_OUT', null);
                        return { data: { session: null }, error: null };
                    }
                    
                    return { data: { session: currentSession }, error: null };
                } catch {
                    currentSession = null;
                    saveSession(null);
                    return { data: { session: null }, error: null };
                }
            }
            
            return { data: { session: null }, error: null };
        },
        
        /**
         * Получение текущего пользователя
         */
        async getUser() {
            if (!currentSession) {
                return { data: { user: null }, error: null };
            }
            
            try {
                const { data, error } = await request('/auth/v1/user');
                return { data: { user: data }, error };
            } catch (error) {
                return { data: { user: null }, error };
            }
        },
        
        /**
         * Вход по email и паролю
         */
        async signInWithPassword({ email, password }) {
            const { data, error } = await request('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: { email, password }
            });
            
            if (error) {
                return { data: null, error };
            }
            
            currentSession = data;
            saveSession(data);
            notifyAuthChange('SIGNED_IN', data);
            
            return { data: { user: data.user, session: data }, error: null };
        },
        
        /**
         * Регистрация
         */
        async signUp({ email, password, options = {} }) {
            const { data, error } = await request('/auth/v1/signup', {
                method: 'POST',
                body: { email, password, data: options.data }
            });
            
            if (error) {
                return { data: null, error };
            }
            
            return { data: { user: data.user, session: data.session }, error: null };
        },
        
        /**
         * Выход
         */
        async signOut() {
            if (currentSession) {
                try {
                    await request('/auth/v1/logout', { method: 'POST' });
                } catch {
                    // Игнорируем ошибки при выходе
                }
            }
            
            currentSession = null;
            saveSession(null);
            notifyAuthChange('SIGNED_OUT', null);
            
            return { error: null };
        },
        
        /**
         * Подписка на изменения аутентификации
         */
        onAuthStateChange(callback) {
            authChangeCallbacks.push(callback);
            
            // Сразу вызываем с текущим состоянием
            if (currentSession) {
                callback('SIGNED_IN', currentSession);
            } else {
                callback('SIGNED_OUT', null);
            }
            
            return {
                data: {
                    subscription: {
                        unsubscribe: () => {
                            const index = authChangeCallbacks.indexOf(callback);
                            if (index > -1) authChangeCallbacks.splice(index, 1);
                        }
                    }
                }
            };
        }
    },
    
    // ====== DATABASE ======
    /**
     * Выбор таблицы
     */
    from(table) {
        const builder = new QueryBuilder(table);
        
        // Добавляем методы модификации
        return {
            select: (columns, options) => builder.select(columns, options),
            
            /**
             * Вставка записей
             */
            insert: async (rows, options = {}) => {
                const url = `/rest/v1/${table}`;
                const { data, error } = await request(url, {
                    method: 'POST',
                    body: rows
                });
                
                if (error) throw error;
                
                if (options.select) {
                    return { data, error: null };
                }
                
                return { data: null, error: null };
            },
            
            /**
             * Обновление записей
             */
            update: async (updates) => {
                const builderWithFilters = builder;
                
                // Строим URL с фильтрами
                let url = builder.buildUrl();
                
                const { data, error } = await request(url, {
                    method: 'PATCH',
                    body: updates
                });
                
                if (error) throw error;
                return { data, error: null };
            },
            
            /**
             * Удаление записей
             */
            delete: async () => {
                let url = builder.buildUrl();
                
                const { data, error } = await request(url, {
                    method: 'DELETE'
                });
                
                if (error) throw error;
                return { data, error: null };
            },
            
            /**
             * Upsert записей
             */
            upsert: async (rows, options = {}) => {
                const url = `/rest/v1/${table}`;
                
                const headers = {};
                if (options.onConflict) {
                    headers['Prefer'] = `resolution=merge-duplicates`;
                }
                
                const { data, error } = await request(url, {
                    method: 'POST',
                    body: rows,
                    headers
                });
                
                if (error) throw error;
                return { data, error: null };
            }
        };
    },
    
    // ====== STORAGE ======
    storage: {
        from(bucket) {
            return new StorageQueryBuilder(bucket);
        }
    }
};

// ========== ЭКСПОРТ ==========

export { supabase };

// ========== УТИЛИТЫ ==========

export async function checkConnection(timeout = 5000) {
    const startTime = performance.now();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            headers: { 'apikey': SUPABASE_ANON_KEY },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const latency = Math.round(performance.now() - startTime);
        
        return {
            online: response.ok,
            latency,
            error: response.ok ? null : `HTTP ${response.status}`
        };
        
    } catch (error) {
        return {
            online: false,
            latency: Math.round(performance.now() - startTime),
            error: error.message
        };
    }
}

export function isOnline() {
    return navigator.onLine;
}

export function onNetworkChange(onOnline, onOffline) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    
    return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
    };
}

// Экспорт по умолчанию
export default supabase;
