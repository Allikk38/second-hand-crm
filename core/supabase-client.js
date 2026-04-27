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
 * - Нет зависимости от @supabase/supabase-js
 * - Прямые REST-запросы к PostgREST API Supabase
 * - JWT-токен хранится в localStorage и передаётся в заголовках
 * - Автоматический рефреш токена
 * - Встроенный полифилл для AbortSignal.timeout()
 * - signInWithPassword возвращает результат в формате { data, error } для совместимости с auth.js
 * - HTTP-ошибки (400, 401) корректно парсятся и возвращаются как error, не выбрасываются
 * 
 * @module supabase-client
 * @version 1.3.0
 * @changes
 * - v1.1.0: Добавлен полифилл createTimeoutSignal()
 * - v1.1.0: Исправлена валидация ответа signInWithPassword
 * - v1.2.0: Убран signal для auth-запросов
 * - v1.3.0: signInWithPassword возвращает { data, error } вместо выбрасывания исключений
 * - v1.3.0: apiFetch больше не выбрасывает ошибки — их обрабатывает вызывающий код
 */

// ========== КОНСТАНТЫ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';
const STORAGE_KEY = 'sb-bhdwniiyrrujeoubrvle-auth-token';

// ========== ПОЛИФИЛЛ ДЛЯ ABORTSIGNAL.TIMEOUT ==========

function createTimeoutSignal(ms) {
    if (typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    
    const controller = new AbortController();
    setTimeout(() => {
        controller.abort(new DOMException('TimeoutError', 'TimeoutError'));
    }, ms);
    return controller.signal;
}

// ========== HTTP FETCH ==========

/**
 * Выполняет запрос к Supabase API.
 * НЕ выбрасывает исключений при HTTP-ошибках.
 * Возвращает response в любом случае.
 * 
 * @param {string} path - Путь API
 * @param {Object} options - Опции запроса
 * @returns {Promise<Response>}
 * @throws {Error} Только при сетевых ошибках (нет соединения)
 */
async function apiFetch(path, options = {}) {
    const { method = 'GET', body, headers = {}, signal } = options;
    const token = getAccessToken();
    
    const fetchOptions = {
        method,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            ...headers
        }
    };
    
    if (token) {
        fetchOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
    }
    
    if (signal) {
        fetchOptions.signal = signal;
    }
    
    const url = `${SUPABASE_URL}${path}`;
    
    // Не оборачиваем в try/catch — сетевая ошибка должна всплыть
    return await fetch(url, fetchOptions);
}

function apiFetchWithTimeout(path, options = {}) {
    return apiFetch(path, {
        ...options,
        signal: createTimeoutSignal(30000)
    });
}

// ========== УПРАВЛЕНИЕ ТОКЕНОМ ==========

function saveSession(session) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {}
}

function getSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function clearSession() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

function getAccessToken() {
    const session = getSession();
    return session?.access_token || null;
}

function isTokenExpired() {
    const session = getSession();
    if (!session?.expires_at) return true;
    const expiresAt = new Date(session.expires_at * 1000);
    const now = new Date();
    return (expiresAt - now) < 60000;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

/**
 * Вход по email и паролю.
 * ВОЗВРАЩАЕТ { data, error } — никогда не выбрасывает исключений.
 * Все ошибки (сетевые, HTTP, валидации) попадают в поле error.
 * 
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{data: {user: Object, session: Object}|null, error: Error|null}>}
 */
async function signInWithPassword(email, password) {
    let response;
    
    try {
        response = await apiFetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email, password },
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (fetchError) {
        // Сетевая ошибка — нет соединения с сервером
        return {
            data: null,
            error: new Error('Сервер недоступен. Проверьте подключение к интернету.')
        };
    }
    
    // Пробуем распарсить тело ответа
    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        return {
            data: null,
            error: new Error('Некорректный ответ сервера.')
        };
    }
    
    // Проверяем HTTP-ошибки (400, 401, 403, etc.)
    if (!response.ok) {
        // Supabase возвращает ошибку в теле ответа
        if (data.error || data.error_description) {
            const message = data.error_description || data.error || data.msg || '';
            
            if (message.includes('Invalid login credentials')) {
                return {
                    data: null,
                    error: new Error('Неверный email или пароль')
                };
            }
            if (message.includes('Email not confirmed')) {
                return {
                    data: null,
                    error: new Error('Email не подтверждён. Проверьте почту.')
                };
            }
            
            return {
                data: null,
                error: new Error(message || `Ошибка сервера (${response.status})`)
            };
        }
        
        return {
            data: null,
            error: new Error(`Ошибка сервера (${response.status})`)
        };
    }
    
    // Успешный ответ — проверяем наличие user и токена
    if (!data.user || !data.access_token) {
        console.error('[SupabaseClient] Response missing user or token:', data);
        return {
            data: null,
            error: new Error('Сервер вернул некорректный ответ.')
        };
    }
    
    // Сохраняем сессию
    saveSession(data);
    
    return {
        data: {
            user: data.user,
            session: data
        },
        error: null
    };
}

/**
 * Рефреш токена
 */
async function refreshSession() {
    const session = getSession();
    if (!session?.refresh_token) {
        throw new Error('No refresh token available');
    }
    
    let response;
    try {
        response = await apiFetch('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            body: { refresh_token: session.refresh_token },
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (fetchError) {
        throw new Error('Не удалось обновить сессию. Сервер недоступен.');
    }
    
    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        throw new Error('Некорректный ответ сервера.');
    }
    
    if (!response.ok || data.error) {
        clearSession();
        throw new Error('Сессия истекла. Пожалуйста, войдите заново.');
    }
    
    if (!data.access_token) {
        throw new Error('Сервер не вернул токен.');
    }
    
    saveSession(data);
    return data;
}

/**
 * Получает текущего пользователя
 */
async function getUser() {
    if (!getAccessToken()) {
        throw { status: 401, message: 'No session' };
    }
    
    if (isTokenExpired()) {
        try {
            await refreshSession();
        } catch (refreshError) {
            throw { status: 401, message: refreshError.message };
        }
    }
    
    const response = await apiFetch('/auth/v1/user');
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
            status: response.status,
            message: errorData.error_description || errorData.error || 'Auth error',
            code: errorData.error
        };
    }
    
    const user = await response.json();
    return { user };
}

function getCurrentSession() {
    const session = getSession();
    return { data: { session } };
}

async function signOut() {
    const token = getAccessToken();
    if (token) {
        try {
            await apiFetch('/auth/v1/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch {}
    }
    clearSession();
}

// ========== REST API (PostgREST) ==========

async function from(table) {
    return {
        select: async (selectStr = '*') => {
            const query = buildQuery(table, { select: selectStr });
            try {
                const response = await apiFetchWithTimeout(`/rest/v1/${table}?${query}`);
                const data = await response.json();
                return { data, error: null };
            } catch (error) {
                return { data: null, error };
            }
        },
        
        insert: async (rows) => {
            try {
                const response = await apiFetch(`/rest/v1/${table}`, {
                    method: 'POST',
                    body: rows,
                    headers: { 'Prefer': 'return=representation' }
                });
                const data = await response.json();
                return { data, error: null };
            } catch (error) {
                return { data: null, error };
            }
        },
        
        update: async (updates) => {
            return {
                eq: async (column, value) => {
                    try {
                        const query = `${column}=eq.${encodeURIComponent(value)}`;
                        const response = await apiFetch(`/rest/v1/${table}?${query}`, {
                            method: 'PATCH',
                            body: updates,
                            headers: { 'Prefer': 'return=representation' }
                        });
                        const data = await response.json();
                        return { data: data[0] || null, error: null };
                    } catch (error) {
                        return { data: null, error };
                    }
                }
            };
        },
        
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

function buildQuery(table, options = {}) {
    const params = new URLSearchParams();
    if (options.select) params.append('select', options.select);
    if (options.order) params.append('order', options.order);
    if (options.limit) params.append('limit', String(options.limit));
    return params.toString();
}

// ========== STORAGE ==========

const storage = {
    from: (bucket) => ({
        upload: async (path, file, options = {}) => {
            try {
                const formData = new FormData();
                formData.append('file', file);
                
                const response = await fetch(
                    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
                    {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${getAccessToken() || ''}`
                        },
                        body: formData
                    }
                );
                
                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }
                
                return { error: null };
            } catch (error) {
                return { error };
            }
        },
        
        getPublicUrl: (path) => {
            return {
                data: {
                    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
                }
            };
        },
        
        remove: async (paths) => {
            try {
                const response = await apiFetch(`/storage/v1/object/${bucket}`, {
                    method: 'DELETE',
                    body: { prefixes: paths },
                    headers: { 'Content-Type': 'application/json' }
                });
                await response.json();
                return { error: null };
            } catch (error) {
                return { error };
            }
        }
    })
};

// ========== ПУБЛИЧНЫЙ API ==========

function createClient(url, key, options = {}) {
    return {
        auth: {
            signInWithPassword: (creds) => signInWithPassword(creds.email, creds.password),
            signOut: () => signOut(),
            getUser: () => getUser(),
            getSession: () => getCurrentSession(),
            refreshSession: () => refreshSession(),
            onAuthStateChange: (callback) => {
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
        rest: { url, key }
    };
}

window.supabase = { createClient };

export { createClient };
