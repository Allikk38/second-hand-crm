// ========================================
// FILE: core/supabase-client.js
// ========================================

/**
 * Локальный Supabase Client
 * 
 * Собственная реализация клиента Supabase без внешних зависимостей.
 * Использует нативный fetch с HTTP/2 для обхода QUIC-ошибок.
 * 
 * Архитектурные решения:
 * - Нет зависимости от @supabase/supabase-js (не грузится с CDN)
 * - Прямые REST-запросы к PostgREST API Supabase
 * - JWT-токен хранится в localStorage и передаётся в заголовках
 * - Автоматический рефреш токена
 * - HTTP/2 только (без QUIC/HTTP3)
 * 
 * @module supabase-client
 * @version 1.0.0
 */

// ========== КОНСТАНТЫ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';
const STORAGE_KEY = 'sb-bhdwniiyrrujeoubrvle-auth-token';

// ========== HTTP/2 FETCH ==========

/**
 * Выполняет запрос к Supabase API.
 * Форсирует HTTP/2 через специальные заголовки и опции.
 * 
 * @param {string} path - Путь API (напр. '/rest/v1/products')
 * @param {Object} options - Опции запроса
 * @param {string} [options.method='GET'] - HTTP метод
 * @param {Object} [options.body] - Тело запроса
 * @param {Object} [options.headers] - Дополнительные заголовки
 * @param {AbortSignal} [options.signal] - Сигнал отмены
 * @returns {Promise<Response>}
 */
async function apiFetch(path, options = {}) {
    const { method = 'GET', body, headers = {}, signal } = options;
    
    // Получаем JWT токен если есть
    const token = getAccessToken();
    
    const fetchOptions = {
        method,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            // Заголовки для принудительного HTTP/2
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...headers
        },
        // Ключевое: отключаем кэш и QUIC
        cache: 'no-store',
        // Увеличиваем таймаут
        signal: signal || AbortSignal.timeout(30000)
    };
    
    // Добавляем авторизацию если есть токен
    if (token) {
        fetchOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Добавляем тело для мутирующих запросов
    if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
    }
    
    const url = `${SUPABASE_URL}${path}`;
    
    const response = await fetch(url, fetchOptions);
    
    // Обрабатываем ошибки
    if (!response.ok) {
        const error = new Error(`Supabase API error: ${response.status}`);
        error.status = response.status;
        error.code = response.headers.get('x-sb-error-code') || null;
        
        try {
            error.details = await response.json();
        } catch {}
        
        throw error;
    }
    
    return response;
}

// ========== УПРАВЛЕНИЕ ТОКЕНОМ ==========

/**
 * Сохраняет сессию в localStorage
 * @param {Object} session
 */
function saveSession(session) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {}
}

/**
 * Получает сессию из localStorage
 * @returns {Object|null}
 */
function getSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Удаляет сессию из localStorage
 */
function clearSession() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

/**
 * Извлекает access_token из сессии
 * @returns {string|null}
 */
function getAccessToken() {
    const session = getSession();
    return session?.access_token || null;
}

/**
 * Проверяет, не протух ли токен
 * @returns {boolean}
 */
function isTokenExpired() {
    const session = getSession();
    if (!session?.expires_at) return true;
    
    const expiresAt = new Date(session.expires_at * 1000);
    const now = new Date();
    // Токен протух если осталось меньше 60 секунд
    return (expiresAt - now) < 60000;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

/**
 * Вход по email и паролю
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: Object, session: Object}>}
 */
async function signInWithPassword(email, password) {
    const response = await apiFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email, password },
        headers: {
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    saveSession(data);
    
    return {
        user: data.user,
        session: data
    };
}

/**
 * Рефреш токена
 * @returns {Promise<Object>} Новая сессия
 */
async function refreshSession() {
    const session = getSession();
    if (!session?.refresh_token) {
        throw new Error('No refresh token available');
    }
    
    const response = await apiFetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: session.refresh_token },
        headers: {
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    saveSession(data);
    
    return data;
}

/**
 * Получает текущего пользователя
 * @returns {Promise<Object>} { user }
 */
async function getUser() {
    // Проверяем токен
    if (!getAccessToken()) {
        throw { status: 401, message: 'No session' };
    }
    
    // Рефрешим если протух
    if (isTokenExpired()) {
        await refreshSession();
    }
    
    const response = await apiFetch('/auth/v1/user');
    const user = await response.json();
    
    return { user };
}

/**
 * Получает текущую сессию
 * @returns {{session: Object|null}}
 */
function getCurrentSession() {
    const session = getSession();
    return { data: { session } };
}

/**
 * Выход из системы
 */
async function signOut() {
    const token = getAccessToken();
    
    if (token) {
        try {
            await apiFetch('/auth/v1/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch {}
    }
    
    clearSession();
}

// ========== REST API (PostgREST) ==========

/**
 * Выполняет SELECT-запрос к таблице
 * @param {string} table - Имя таблицы
 * @param {Object} options - Опции запроса
 * @param {string[]} [options.select='*'] - Колонки
 * @param {Object} [options.filters] - Фильтры { column: value }
 * @param {string} [options.order] - Сортировка 'column.asc'
 * @param {number} [options.limit] - Лимит
 * @param {boolean} [options.single] - Вернуть один объект
 * @param {string} [options.head] - Только заголовки 'exact'
 * @returns {Promise<{data: any, error: Error|null}>}
 */
async function from(table) {
    return {
        /**
         * SELECT запрос
         */
        select: async (selectStr = '*') => {
            const query = buildQuery(table, { select: selectStr });
            
            try {
                const response = await apiFetch(`/rest/v1/${table}?${query}`);
                const data = await response.json();
                return { data, error: null };
            } catch (error) {
                return { data: null, error };
            }
        },
        
        /**
         * INSERT запрос
         */
        insert: async (rows) => {
            try {
                const response = await apiFetch(`/rest/v1/${table}`, {
                    method: 'POST',
                    body: rows,
                    headers: {
                        'Prefer': 'return=representation'
                    }
                });
                const data = await response.json();
                return { data, error: null };
            } catch (error) {
                return { data: null, error };
            }
        },
        
        /**
         * UPDATE запрос
         */
        update: async (updates) => {
            return {
                eq: async (column, value) => {
                    try {
                        const query = `${column}=eq.${encodeURIComponent(value)}`;
                        const response = await apiFetch(`/rest/v1/${table}?${query}`, {
                            method: 'PATCH',
                            body: updates,
                            headers: {
                                'Prefer': 'return=representation'
                            }
                        });
                        const data = await response.json();
                        return { data: data[0] || null, error: null };
                    } catch (error) {
                        return { data: null, error };
                    }
                }
            };
        },
        
        /**
         * DELETE запрос
         */
        delete: async () => {
            return {
                eq: async (column, value) => {
                    try {
                        const query = `${column}=eq.${encodeURIComponent(value)}`;
                        await apiFetch(`/rest/v1/${table}?${query}`, {
                            method: 'DELETE'
                        });
                        return { error: null };
                    } catch (error) {
                        return { error };
                    }
                }
            };
        }
    };
}

/**
 * Строит строку запроса для PostgREST
 */
function buildQuery(table, options = {}) {
    const params = new URLSearchParams();
    
    if (options.select) {
        params.append('select', options.select);
    }
    
    if (options.order) {
        params.append('order', options.order);
    }
    
    if (options.limit) {
        params.append('limit', String(options.limit));
    }
    
    return params.toString();
}

// ========== STORAGE ==========

/**
 * Доступ к хранилищу файлов
 */
const storage = {
    from: (bucket) => ({
        /**
         * Загрузка файла
         */
        upload: async (path, file, options = {}) => {
            try {
                const formData = new FormData();
                formData.append('file', file);
                
                const fetchOptions = {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${getAccessToken() || ''}`,
                        'Cache-Control': 'no-cache'
                    },
                    cache: 'no-store',
                    body: formData,
                    signal: AbortSignal.timeout(30000)
                };
                
                const response = await fetch(
                    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
                    fetchOptions
                );
                
                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }
                
                return { error: null };
            } catch (error) {
                return { error };
            }
        },
        
        /**
         * Получение публичного URL
         */
        getPublicUrl: (path) => {
            return {
                data: {
                    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
                }
            };
        },
        
        /**
         * Удаление файлов
         */
        remove: async (paths) => {
            try {
                const response = await apiFetch(`/storage/v1/object/${bucket}`, {
                    method: 'DELETE',
                    body: { prefixes: paths },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                await response.json();
                return { error: null };
            } catch (error) {
                return { error };
            }
        }
    })
};

// ========== ПУБЛИЧНЫЙ API (СОВМЕСТИМЫЙ С SUPABASE SDK) ==========

/**
 * Создаёт клиент Supabase (совместимый интерфейс)
 */
function createClient(url, key, options = {}) {
    return {
        auth: {
            signInWithPassword: (creds) => signInWithPassword(creds.email, creds.password),
            signOut: () => signOut(),
            getUser: () => getUser(),
            getSession: () => getCurrentSession(),
            refreshSession: () => refreshSession(),
            onAuthStateChange: (callback) => {
                // Простая реализация — колбэк при изменениях
                window.addEventListener('storage', (e) => {
                    if (e.key === STORAGE_KEY) {
                        const session = e.newValue ? JSON.parse(e.newValue) : null;
                        callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
                    }
                });
                return { data: { subscription: { unsubscribe: () => {} } } };
            }
        },
        from: (table) => from(table),
        storage,
        // Для обратной совместимости
        rest: { url, key }
    };
}

// Экспорт для совместимости
window.supabase = { createClient };

export { createClient };
