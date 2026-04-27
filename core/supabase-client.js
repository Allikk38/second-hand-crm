// ========================================
// FILE: core/supabase-client.js
// ========================================

/**
 * Локальный Supabase Client
 * 
 * Собственная реализация клиента Supabase без внешних зависимостей.
 * Поддерживает method chaining (билдер-паттерн) как оригинальный SDK.
 * 
 * @module supabase-client
 * @version 1.8.0
 * @changes
 * - v1.8.0: Все запросы теперь с AbortController и таймаутом
 * - v1.8.0: GET-запросы: таймаут 12с, мутирующие: 15с, auth: 10с
 * - v1.8.0: getUser() с таймаутом 10с
 * - v1.8.0: refreshSession с таймаутом 10с
 * - v1.8.0: signInWithPassword — retry при abort
 * - v1.8.0: Убрано двойное URL-кодирование в фильтрах
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';
const STORAGE_KEY = 'sb-bhdwniiyrrujeoubrvle-auth-token';

// Таймауты
const DEFAULT_GET_TIMEOUT = 12000;    // 12 секунд для GET
const DEFAULT_MUTATE_TIMEOUT = 15000; // 15 секунд для POST/PATCH/DELETE
const AUTH_TIMEOUT_MS = 10000;        // 10 секунд для auth-запросов
const STORAGE_TIMEOUT = 15000;        // 15 секунд для storage

// ========== ПОЛИФИЛЛ ==========

function createTimeoutSignal(ms) {
    if (typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    setTimeout(() => {
        try { controller.abort(new DOMException('TimeoutError', 'TimeoutError')); } catch {}
    }, ms);
    return controller.signal;
}

// ========== HTTP FETCH ==========

/**
 * Выполняет HTTP-запрос к Supabase API.
 * Всегда имеет таймаут через AbortController.
 * 
 * @param {string} path - Путь API
 * @param {Object} options - Опции запроса
 * @param {number} [options.timeoutMs] - Таймаут в мс (по умолчанию зависит от метода)
 * @returns {Promise<Response>}
 */
async function apiFetch(path, options = {}) {
    const { 
        method = 'GET', 
        body, 
        headers = {}, 
        signal: externalSignal,
        timeoutMs 
    } = options;
    
    const token = getAccessToken();
    
    // Определяем таймаут
    let effectiveTimeout = timeoutMs;
    if (!effectiveTimeout) {
        if (path.startsWith('/auth/')) {
            effectiveTimeout = AUTH_TIMEOUT_MS;
        } else if (method === 'GET') {
            effectiveTimeout = DEFAULT_GET_TIMEOUT;
        } else {
            effectiveTimeout = DEFAULT_MUTATE_TIMEOUT;
        }
    }
    
    // Создаём AbortController с таймаутом
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
        try { timeoutController.abort(new DOMException('TimeoutError', 'TimeoutError')); } catch {}
    }, effectiveTimeout);
    
    // Комбинируем с внешним сигналом если есть
    let combinedSignal = timeoutController.signal;
    if (externalSignal) {
        // Если внешний сигнал сработает — отменяем наш таймаут
        externalSignal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            try { timeoutController.abort(externalSignal.reason); } catch {}
        }, { once: true });
    }
    
    const fetchOptions = {
        method,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            ...headers
        },
        signal: combinedSignal
    };
    
    if (token && !path.startsWith('/auth/v1/token')) {
        fetchOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(`${SUPABASE_URL}${path}`, fetchOptions);
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            const timeoutError = new Error('Сервер не отвечает. Попробуйте обновить страницу.');
            timeoutError.code = 'TIMEOUT';
            timeoutError.originalError = error;
            throw timeoutError;
        }
        if (error.message === 'Failed to fetch' || error.message?.includes('NetworkError')) {
            const networkError = new Error('Нет подключения к интернету. Проверьте соединение.');
            networkError.code = 'NETWORK_ERROR';
            networkError.originalError = error;
            throw networkError;
        }
        throw error;
    }
}

// ========== УПРАВЛЕНИЕ ТОКЕНОМ ==========

function saveSession(session) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch {}
}

function getSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function getAccessToken() {
    const session = getSession();
    return session?.access_token || null;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

async function signInWithPassword(email, password) {
    let lastError = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            const delay = 2000 * attempt; // 2с, 4с
            console.log('[Supabase] Retrying signInWithPassword (attempt ' + (attempt + 1) + ') in ' + delay + 'ms...');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        try {
            const response = await apiFetch('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: { email, password },
                headers: { 'Content-Type': 'application/json' },
                timeoutMs: AUTH_TIMEOUT_MS
            });
            
            let data;
            try { data = await response.json(); } catch {
                lastError = new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.');
                continue;
            }
            
            if (!response.ok) {
                const msg = data.error_description || data.error || data.msg || '';
                
                if (msg.includes('Invalid login credentials')) {
                    return { data: null, error: new Error('Неверный email или пароль') };
                }
                
                lastError = new Error(msg || `Ошибка сервера (${response.status}). Попробуйте позже.`);
                continue;
            }
            
            if (!data.user || !data.access_token) {
                lastError = new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.');
                continue;
            }
            
            saveSession(data);
            console.log('[Supabase] Login successful');
            return { data: { user: data.user, session: data }, error: null };
            
        } catch (error) {
            lastError = error;
            
            // При таймауте — пробуем ещё раз
            if (error.code === 'TIMEOUT' && attempt < 2) {
                console.log('[Supabase] Timeout, will retry...');
                continue;
            }
            
            // При сетевой ошибке — тоже пробуем
            if (error.code === 'NETWORK_ERROR' && attempt < 2) {
                console.log('[Supabase] Network error, will retry...');
                continue;
            }
            
            break;
        }
    }
    
    let message = 'Не удалось подключиться к серверу.';
    
    if (lastError) {
        if (lastError.code === 'TIMEOUT') {
            message = 'Сервер не отвечает. Возможно, он "просыпается" после долгого бездействия. Попробуйте ещё раз через несколько секунд.';
        } else if (lastError.code === 'NETWORK_ERROR') {
            message = lastError.message;
        } else if (lastError.message) {
            message = 'Ошибка входа: ' + lastError.message;
        }
    }
    
    return { data: null, error: new Error(message) };
}

async function refreshSession() {
    const session = getSession();
    if (!session?.refresh_token) {
        clearSession();
        throw { status: 401, message: 'Сессия истекла. Войдите заново.' };
    }
    
    let lastError = null;
    
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            console.log('[Supabase] Retrying refreshSession...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        try {
            const response = await apiFetch('/auth/v1/token?grant_type=refresh_token', {
                method: 'POST',
                body: { refresh_token: session.refresh_token },
                headers: { 'Content-Type': 'application/json' },
                timeoutMs: AUTH_TIMEOUT_MS
            });
            
            let data;
            try { data = await response.json(); } catch {
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
            
        } catch (error) {
            lastError = error;
            
            if (error.code === 'TIMEOUT' && attempt < 1) {
                continue;
            }
            
            break;
        }
    }
    
    if (lastError) {
        if (lastError.code === 'TIMEOUT') {
            throw { status: 0, message: 'Сервер не отвечает. Проверьте подключение к интернету.' };
        }
        throw lastError;
    }
}

async function getUser() {
    const token = getAccessToken();
    if (!token) {
        return { user: null, error: { status: 401, message: 'No session' } };
    }
    
    let response;
    try {
        response = await apiFetch('/auth/v1/user', { timeoutMs: AUTH_TIMEOUT_MS });
    } catch (error) {
        return { 
            user: null, 
            error: { 
                status: error.code === 'TIMEOUT' ? 0 : 500, 
                message: error.message || 'Сервер недоступен' 
            } 
        };
    }
    
    if (response.status === 401) {
        try { 
            await refreshSession(); 
        } catch (refreshError) {
            return { 
                user: null, 
                error: refreshError 
            };
        }
        try { 
            response = await apiFetch('/auth/v1/user', { timeoutMs: AUTH_TIMEOUT_MS }); 
        } catch (error) {
            return { 
                user: null, 
                error: { 
                    status: error.code === 'TIMEOUT' ? 0 : 500, 
                    message: error.message || 'Сервер недоступен' 
                } 
            };
        }
    }
    
    if (!response.ok) {
        let errorData;
        try { errorData = await response.json(); } catch { errorData = {}; }
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
    return { data: { session: getSession() } };
}

async function signOut() {
    const token = getAccessToken();
    if (token) {
        try {
            await apiFetch('/auth/v1/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                timeoutMs: 5000
            });
        } catch {}
    }
    clearSession();
}

// ========== QUERY BUILDER (METHOD CHAINING) ==========

/**
 * Строитель запросов с поддержкой method chaining.
 * Накопляет фильтры, выполняет запрос при await.
 * 
 * ВАЖНО: значения НЕ кодируются через encodeURIComponent — 
 * URLSearchParams.append() делает это автоматически.
 */
class QueryBuilder {
    constructor(table) {
        this._table = table;
        this._method = 'GET';
        this._selectStr = '*';
        this._filters = [];
        this._orderStr = null;
        this._limitNum = null;
        this._single = false;
        this._body = null;
        this._headers = {};
        this._hasExecuted = false;
        this._resultPromise = null;
    }
    
    /**
     * Делает билдер thenable — можно использовать с await.
     */
    then(resolve, reject) {
        if (!this._resultPromise) {
            this._resultPromise = this._execute();
        }
        return this._resultPromise.then(resolve, reject);
    }
    
    select(columns = '*') {
        this._method = 'GET';
        this._selectStr = columns;
        return this;
    }
    
    insert(rows) {
        this._method = 'POST';
        this._body = rows;
        this._headers['Prefer'] = 'return=representation';
        return this;
    }
    
    update(updates) {
        this._method = 'PATCH';
        this._body = updates;
        this._headers['Prefer'] = 'return=representation';
        return this;
    }
    
    delete() {
        this._method = 'DELETE';
        return this;
    }
    
    eq(column, value) {
        this._filters.push({ column, op: 'eq', value: String(value) });
        return this;
    }
    
    neq(column, value) {
        this._filters.push({ column, op: 'neq', value: String(value) });
        return this;
    }
    
    is(column, value) {
        if (value === null) {
            this._filters.push({ column, op: 'is', value: 'null' });
        } else if (value === true) {
            this._filters.push({ column, op: 'is', value: 'true' });
        } else if (value === false) {
            this._filters.push({ column, op: 'is', value: 'false' });
        } else {
            this._filters.push({ column, op: 'eq', value: String(value) });
        }
        return this;
    }
    
    gte(column, value) {
        this._filters.push({ column, op: 'gte', value: String(value) });
        return this;
    }
    
    lte(column, value) {
        this._filters.push({ column, op: 'lte', value: String(value) });
        return this;
    }
    
    gt(column, value) {
        this._filters.push({ column, op: 'gt', value: String(value) });
        return this;
    }
    
    lt(column, value) {
        this._filters.push({ column, op: 'lt', value: String(value) });
        return this;
    }
    
    order(column, options = {}) {
        const direction = options.ascending === false ? 'desc' : 'asc';
        this._orderStr = `${column}.${direction}`;
        return this;
    }
    
    limit(n) {
        this._limitNum = n;
        return this;
    }
    
    single() {
        this._single = true;
        return this;
    }
    
    maybeSingle() {
        this._single = true;
        this._headers['Accept'] = 'application/vnd.pgrst.object+json';
        return this;
    }
    
    /**
     * Добавляет поддержку AbortSignal.
     * @param {AbortSignal} signal
     * @returns {QueryBuilder}
     */
    abortSignal(signal) {
        this._abortSignal = signal;
        return this;
    }
    
    /**
     * Выполняет запрос к API.
     * @returns {Promise<{data: any, error: Error|null}>}
     */
    async _execute() {
        if (this._hasExecuted) return this._resultPromise;
        this._hasExecuted = true;
        
        const params = new URLSearchParams();
        
        if (this._method === 'GET' && this._selectStr) {
            params.append('select', this._selectStr);
        }
        
        this._filters.forEach(f => {
            const key = f.column;
            const value = f.op + '.' + f.value;
            params.append(key, value);
        });
        
        if (this._orderStr) {
            params.append('order', this._orderStr);
        }
        
        if (this._limitNum) {
            params.append('limit', String(this._limitNum));
        }
        
        const queryString = params.toString();
        const path = `/rest/v1/${this._table}${queryString ? '?' + queryString : ''}`;
        
        try {
            const fetchOptions = {
                method: this._method,
                headers: { ...this._headers }
            };
            
            if (this._abortSignal) {
                fetchOptions.signal = this._abortSignal;
            }
            
            if (this._body) {
                fetchOptions.body = this._body;
            }
            
            const response = await apiFetch(path, fetchOptions);
            
            if (!response.ok) {
                if (response.status === 406 && this._single) {
                    return { data: null, error: null };
                }
                
                const error = new Error(`Supabase API error: ${response.status}`);
                error.status = response.status;
                error.code = response.headers.get('x-sb-error-code') || null;
                try { error.details = await response.json(); } catch {}
                return { data: null, error };
            }
            
            if (this._method === 'DELETE') {
                return { data: null, error: null };
            }
            
            const responseData = await response.json();
            
            if (this._single && Array.isArray(responseData)) {
                return { data: responseData[0] || null, error: null };
            }
            
            return { data: responseData, error: null };
            
        } catch (error) {
            if (error.code === 'TIMEOUT') {
                error.message = 'Сервер не отвечает. Попробуйте обновить страницу.';
            }
            return { data: null, error };
        }
    }
}

function from(table) {
    return new QueryBuilder(table);
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
                    body: formData,
                    signal: createTimeoutSignal(STORAGE_TIMEOUT)
                });
                if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
                return { error: null };
            } catch (error) {
                if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                    return { error: new Error('Таймаут загрузки. Попробуйте снова.') };
                }
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
                    headers: { 'Content-Type': 'application/json' },
                    timeoutMs: STORAGE_TIMEOUT
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
