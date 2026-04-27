// ========================================
// FILE: core/supabase-client.js
// ========================================

/**
 * Локальный Supabase Client
 * 
 * Собственная реализация клиента Supabase без внешних зависимостей.
 * Использует нативный fetch с HTTP/2 для обхода QUIC-ошибок.
 * 
 * @module supabase-client
 * @version 1.4.0
 * @changes
 * - v1.3.0: signInWithPassword возвращает { data, error }
 * - v1.4.0: getUser() больше не делает рефреш перед запросом /auth/v1/user
 * - v1.4.0: getUser() вызывает refreshSession() только если получил 401
 * - v1.4.0: пользователь НЕ выбрасывается обратно на вход после успешного входа
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';
const STORAGE_KEY = 'sb-bhdwniiyrrujeoubrvle-auth-token';

function createTimeoutSignal(ms) {
    if (typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return controller.signal;
}

// ========== HTTP FETCH ==========

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
    
    // Токен добавляем только для НЕ-auth запросов
    // Для /auth/v1/user — нужен токен
    // Для /auth/v1/token — токен НЕ нужен (его ещё нет)
    if (token && !path.startsWith('/auth/v1/token')) {
        fetchOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
    }
    
    if (signal) {
        fetchOptions.signal = signal;
    }
    
    return await fetch(`${SUPABASE_URL}${path}`, fetchOptions);
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

// ========== АУТЕНТИФИКАЦИЯ ==========

async function signInWithPassword(email, password) {
    let response;
    
    try {
        response = await apiFetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email, password },
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (fetchError) {
        return {
            data: null,
            error: new Error('Сервер недоступен. Проверьте подключение к интернету.')
        };
    }
    
    let data;
    try {
        data = await response.json();
    } catch {
        return { data: null, error: new Error('Некорректный ответ сервера.') };
    }
    
    if (!response.ok) {
        const msg = data.error_description || data.error || data.msg || '';
        if (msg.includes('Invalid login credentials')) {
            return { data: null, error: new Error('Неверный email или пароль') };
        }
        return { data: null, error: new Error(msg || `Ошибка сервера (${response.status})`) };
    }
    
    if (!data.user || !data.access_token) {
        console.error('[SupabaseClient] Missing user or token:', data);
        return { data: null, error: new Error('Сервер вернул некорректный ответ.') };
    }
    
    saveSession(data);
    
    return {
        data: { user: data.user, session: data },
        error: null
    };
}

async function refreshSession() {
    const session = getSession();
    if (!session?.refresh_token) {
        clearSession();
        throw { status: 401, message: 'No refresh token' };
    }
    
    let response;
    try {
        response = await apiFetch('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            body: { refresh_token: session.refresh_token },
            headers: { 'Content-Type': 'application/json' }
        });
    } catch {
        throw { status: 0, message: 'Сервер недоступен' };
    }
    
    let data;
    try {
        data = await response.json();
    } catch {
        throw { status: response.status, message: 'Некорректный ответ сервера' };
    }
    
    if (!response.ok || data.error) {
        clearSession();
        throw { status: 401, message: 'Сессия истекла. Войдите заново.' };
    }
    
    if (!data.access_token) {
        throw { status: response.status, message: 'Сервер не вернул токен' };
    }
    
    saveSession(data);
    return data;
}

/**
 * Получает текущего пользователя.
 * Сначала пробует прямой запрос с текущим токеном.
 * Если получает 401 — пробует рефреш и повторяет запрос.
 * 
 * @returns {Promise<{user: Object, error: Object|null}>}
 */
async function getUser() {
    const token = getAccessToken();
    
    if (!token) {
        return { user: null, error: { status: 401, message: 'No session' } };
    }
    
    // Первая попытка — с текущим токеном
    let response;
    try {
        response = await apiFetch('/auth/v1/user');
    } catch {
        return { user: null, error: { status: 0, message: 'Сервер недоступен' } };
    }
    
    // Если 401 — пробуем рефреш
    if (response.status === 401) {
        try {
            await refreshSession();
        } catch (refreshError) {
            return { user: null, error: refreshError };
        }
        
        // Повторяем запрос с новым токеном
        try {
            response = await apiFetch('/auth/v1/user');
        } catch {
            return { user: null, error: { status: 0, message: 'Сервер недоступен после рефреша' } };
        }
    }
    
    // Проверяем финальный ответ
    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch {
            errorData = {};
        }
        return {
            user: null,
            error: {
                status: response.status,
                message: errorData.error_description || errorData.error || 'Ошибка авторизации'
            }
        };
    }
    
    const user = await response.json();
    return { user, error: null };
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

// ========== REST API ==========

async function from(table) {
    return {
        select: async (selectStr = '*') => {
            const query = buildQuery(table, { select: selectStr });
            try {
                const response = await apiFetch(`/rest/v1/${table}?${query}`, {
                    signal: createTimeoutSignal(30000)
                });
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
        update: async (updates) => ({
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
        }),
        delete: async () => ({
            eq: async (column, value) => {
                try {
                    const query = `${column}=eq.${encodeURIComponent(value)}`;
                    await apiFetch(`/rest/v1/${table}?${query}`, { method: 'DELETE' });
                    return { error: null };
                } catch (error) {
                    return { error };
                }
            }
        })
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
        upload: async (path, file) => {
            try {
                const formData = new FormData();
                formData.append('file', file);
                const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${getAccessToken() || ''}`
                    },
                    body: formData
                });
                if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
                return { error: null };
            } catch (error) {
                return { error };
            }
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` }
        }),
        remove: async (paths) => {
            try {
                await apiFetch(`/storage/v1/object/${bucket}`, {
                    method: 'DELETE',
                    body: { prefixes: paths },
                    headers: { 'Content-Type': 'application/json' }
                });
                return { error: null };
            } catch (error) {
                return { error };
            }
        }
    })
};

// ========== ПУБЛИЧНЫЙ API ==========

function createClient(url, key) {
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
