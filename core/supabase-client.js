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
 * 
 * @module supabase-client
 * @version 1.2.0
 * @changes
 * - v1.1.0: Добавлен полифилл createTimeoutSignal()
 * - v1.1.0: Исправлена валидация ответа signInWithPassword
 * - v1.2.0: Убран signal для auth-запросов (вызывал ERR_CONNECTION_TIMED_OUT)
 * - v1.2.0: Убран cache: 'no-store' для POST-запросов
 * - v1.2.0: signal оставлен только для GET-запросов к REST API
 */

// ========== КОНСТАНТЫ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';
const STORAGE_KEY = 'sb-bhdwniiyrrujeoubrvle-auth-token';

// ========== ПОЛИФИЛЛ ДЛЯ ABORTSIGNAL.TIMEOUT ==========

/**
 * Создаёт AbortSignal с таймаутом.
 * Использует нативный AbortSignal.timeout() если доступен.
 * Иначе — полифилл на основе AbortController + setTimeout.
 * 
 * @param {number} ms - Таймаут в миллисекундах
 * @returns {AbortSignal}
 */
function createTimeoutSignal(ms) {
    // Пробуем нативный API (Chrome 103+, Firefox 88+, Safari 16+)
    if (typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    
    // Полифилл для старых браузеров
    const controller = new AbortController();
    setTimeout(() => {
        controller.abort(new DOMException('TimeoutError', 'TimeoutError'));
    }, ms);
    return controller.signal;
}

// ========== HTTP FETCH ==========

/**
 * Выполняет запрос к Supabase API.
 * 
 * ВАЖНО: signal НЕ устанавливается по умолчанию.
 * Для GET-запросов используйте apiFetchWithTimeout.
 * Для POST/PATCH/DELETE (мутирующих и auth) signal НЕ используется,
 * так как это вызывает ERR_CONNECTION_TIMED_OUT в некоторых окружениях.
 * 
 * @param {string} path - Путь API (напр. '/rest/v1/products')
 * @param {Object} options - Опции запроса
 * @param {string} [options.method='GET'] - HTTP метод
 * @param {Object} [options.body] - Тело запроса (для POST/PATCH)
 * @param {Object} [options.headers] - Дополнительные заголовки
 * @param {AbortSignal} [options.signal] - Опциональный сигнал отмены
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
            ...headers
        }
    };
    
    // Добавляем авторизацию если есть токен
    if (token) {
        fetchOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Добавляем тело для мутирующих запросов
    if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
    }
    
    // signal добавляем ТОЛЬКО если он явно передан
    if (signal) {
        fetchOptions.signal = signal;
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

/**
 * Выполняет GET-запрос с таймаутом.
 * Используется для загрузки данных через REST API.
 * 
 * @param {string} path - Путь API
 * @param {Object} options - Опции запроса
 * @returns {Promise<Response>}
 */
async function apiFetchWithTimeout(path, options = {}) {
    return apiFetch(path, {
        ...options,
        signal: createTimeoutSignal(30000)
    });
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
    return (expiresAt - now) < 60000;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

/**
 * Вход по email и паролю.
 * НЕ использует signal/таймаут, так как это вызывает проблемы в некоторых окружениях.
 * 
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: Object, session: Object}>}
 * @throws {Error} При неверных учётных данных или ошибке сервера
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
        throw new Error('Сервер недоступен. Проверьте подключение к интернету.');
    }
    
    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        throw new Error('Некорректный ответ сервера.');
    }
    
    if (data.error) {
        const message = data.error_description || data.error;
        if (message?.includes('Invalid login credentials')) {
            throw new Error('Неверный email или пароль');
        }
        throw new Error(message || 'Ошибка аутентификации');
    }
    
    if (!data.user || !data.access_token) {
        console.error('[SupabaseClient] Unexpected auth response:', data);
        throw new Error('Сервер вернул некорректный ответ.');
    }
    
    saveSession(data);
    
    return {
        user: data.user,
        session: data
    };
}

/**
 * Рефреш токена
 * @returns {Promise<Object>} Новая сессия
 * @throws {Error} Если нет refresh_token или он истёк
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
        throw new Error('Некорректный ответ сервера при обновлении сессии.');
    }
    
    if (data.error) {
        clearSession();
        throw new Error('Сессия истекла. Пожалуйста, войдите заново.');
    }
    
    if (!data.access_token) {
        throw new Error('Сервер не вернул токен при обновлении сессии.');
    }
    
    saveSession(data);
    
    return data;
}

/**
 * Получает текущего пользователя
 * @returns {Promise<Object>} { user }
 * @throws {Object} Объект ошибки со статусом
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
 * Работа с таблицами через PostgREST
 * @param {string} table - Имя таблицы
 * @returns {Object} Объект для построения запросов
 */
async function from(table) {
    return {
        /**
         * SELECT запрос (с таймаутом для GET)
         */
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
        
        /**
         * INSERT запрос (без таймаута — мутирующий)
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
         * UPDATE запрос (без таймаута — мутирующий)
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
         * DELETE запрос (без таймаута — мутирующий)
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

// Экспорт
window.supabase = { createClient };

export { createClient };
