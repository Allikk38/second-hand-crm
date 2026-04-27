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
 * @version 1.6.0
 * @changes
 * - v1.4.0: getUser() с отложенным рефрешем
 * - v1.5.0: Полный рефакторинг from() — поддержка method chaining
 * - v1.5.0: .select().eq().order().limit() работают как в оригинальном SDK
 * - v1.5.0: .insert(), .update().eq(), .delete().eq() возвращают { data, error }
 * - v1.6.0: Добавлен метод .is() для проверки IS NULL/TRUE/FALSE
 * - v1.6.0: Добавлен метод .neq() для проверки неравенства
 * - v1.6.0: Добавлен метод .gte() и .lte() для диапазонов
 * - v1.6.0: Полифилл AbortSignal.timeout вынесен в начало файла
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';
const STORAGE_KEY = 'sb-bhdwniiyrrujeoubrvle-auth-token';

// ========== ПОЛИФИЛЛ ==========

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
    let response;
    try {
        response = await apiFetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email, password },
            headers: { 'Content-Type': 'application/json' }
        });
    } catch {
        return { data: null, error: new Error('Сервер недоступен. Проверьте подключение к интернету.') };
    }
    
    let data;
    try { data = await response.json(); } catch {
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
        return { data: null, error: new Error('Сервер вернул некорректный ответ.') };
    }
    
    saveSession(data);
    return { data: { user: data.user, session: data }, error: null };
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
}

async function getUser() {
    const token = getAccessToken();
    if (!token) {
        return { user: null, error: { status: 401, message: 'No session' } };
    }
    
    let response;
    try { response = await apiFetch('/auth/v1/user'); } catch {
        return { user: null, error: { status: 0, message: 'Сервер недоступен' } };
    }
    
    if (response.status === 401) {
        try { await refreshSession(); } catch (refreshError) {
            return { user: null, error: refreshError };
        }
        try { response = await apiFetch('/auth/v1/user'); } catch {
            return { user: null, error: { status: 0, message: 'Сервер недоступен' } };
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
                headers: { 'Authorization': `Bearer ${token}` }
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
 * Поддерживаемые операторы PostgREST:
 * - eq (equals)
 * - neq (not equals)
 * - is (null, true, false)
 * - gte (greater than or equal)
 * - lte (less than or equal)
 * - gt (greater than)
 * - lt (less than)
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
    
    /**
     * SELECT запрос.
     * @param {string} columns
     * @returns {QueryBuilder}
     */
    select(columns = '*') {
        this._method = 'GET';
        this._selectStr = columns;
        return this;
    }
    
    /**
     * INSERT запрос.
     * @param {Object|Array} rows
     * @returns {QueryBuilder}
     */
    insert(rows) {
        this._method = 'POST';
        this._body = rows;
        this._headers['Prefer'] = 'return=representation';
        return this;
    }
    
    /**
     * UPDATE запрос (требует .eq() после).
     * @param {Object} updates
     * @returns {QueryBuilder}
     */
    update(updates) {
        this._method = 'PATCH';
        this._body = updates;
        this._headers['Prefer'] = 'return=representation';
        return this;
    }
    
    /**
     * DELETE запрос (требует .eq() после).
     * @returns {QueryBuilder}
     */
    delete() {
        this._method = 'DELETE';
        return this;
    }
    
    /**
     * Добавляет фильтр равенства.
     * @param {string} column
     * @param {any} value
     * @returns {QueryBuilder}
     */
    eq(column, value) {
        this._filters.push(`${column}=eq.${encodeURIComponent(value)}`);
        return this;
    }
    
    /**
     * Добавляет фильтр неравенства.
     * @param {string} column
     * @param {any} value
     * @returns {QueryBuilder}
     */
    neq(column, value) {
        this._filters.push(`${column}=neq.${encodeURIComponent(value)}`);
        return this;
    }
    
    /**
     * Добавляет фильтр IS NULL, IS TRUE, IS FALSE.
     * @param {string} column
     * @param {string|null|boolean} value - null, true, false
     * @returns {QueryBuilder}
     */
    is(column, value) {
        if (value === null) {
            this._filters.push(`${column}=is.null`);
        } else if (value === true) {
            this._filters.push(`${column}=is.true`);
        } else if (value === false) {
            this._filters.push(`${column}=is.false`);
        } else {
            // Если передано что-то другое, используем eq как fallback
            this._filters.push(`${column}=eq.${encodeURIComponent(value)}`);
        }
        return this;
    }
    
    /**
     * Добавляет фильтр "больше или равно".
     * @param {string} column
     * @param {any} value
     * @returns {QueryBuilder}
     */
    gte(column, value) {
        this._filters.push(`${column}=gte.${encodeURIComponent(value)}`);
        return this;
    }
    
    /**
     * Добавляет фильтр "меньше или равно".
     * @param {string} column
     * @param {any} value
     * @returns {QueryBuilder}
     */
    lte(column, value) {
        this._filters.push(`${column}=lte.${encodeURIComponent(value)}`);
        return this;
    }
    
    /**
     * Добавляет фильтр "больше".
     * @param {string} column
     * @param {any} value
     * @returns {QueryBuilder}
     */
    gt(column, value) {
        this._filters.push(`${column}=gt.${encodeURIComponent(value)}`);
        return this;
    }
    
    /**
     * Добавляет фильтр "меньше".
     * @param {string} column
     * @param {any} value
     * @returns {QueryBuilder}
     */
    lt(column, value) {
        this._filters.push(`${column}=lt.${encodeURIComponent(value)}`);
        return this;
    }
    
    /**
     * Добавляет сортировку.
     * @param {string} column
     * @param {{ascending?: boolean}} options
     * @returns {QueryBuilder}
     */
    order(column, options = {}) {
        const direction = options.ascending === false ? 'desc' : 'asc';
        this._orderStr = `${column}.${direction}`;
        return this;
    }
    
    /**
     * Ограничивает количество результатов.
     * @param {number} n
     * @returns {QueryBuilder}
     */
    limit(n) {
        this._limitNum = n;
        return this;
    }
    
    /**
     * Возвращает один объект вместо массива.
     * @returns {QueryBuilder}
     */
    single() {
        this._single = true;
        return this;
    }
    
    /**
     * Возвращает null если запись не найдена (вместо ошибки 406).
     * @returns {QueryBuilder}
     */
    maybeSingle() {
        this._single = true;
        this._headers['Accept'] = 'application/vnd.pgrst.object+json';
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
        
        // select
        if (this._method === 'GET' && this._selectStr) {
            params.append('select', this._selectStr);
        }
        
        // filters
        this._filters.forEach(f => {
            // Каждый фильтр уже в формате "column=operator.value"
            const eqIndex = f.indexOf('=');
            if (eqIndex !== -1) {
                const key = f.substring(0, eqIndex);
                const value = f.substring(eqIndex + 1);
                params.append(key, value);
            }
        });
        
        // order
        if (this._orderStr) {
            params.append('order', this._orderStr);
        }
        
        // limit
        if (this._limitNum) {
            params.append('limit', String(this._limitNum));
        }
        
        const queryString = params.toString();
        const path = `/rest/v1/${this._table}${queryString ? '?' + queryString : ''}`;
        
        try {
            const fetchOptions = {
                method: this._method,
                headers: { ...this._headers },
                signal: this._method === 'GET' ? createTimeoutSignal(30000) : undefined
            };
            
            if (this._body) {
                fetchOptions.body = this._body;
            }
            
            const response = await apiFetch(path, fetchOptions);
            
            if (!response.ok) {
                // 406 Not Acceptable — нет результатов для single
                if (response.status === 406 && this._single) {
                    return { data: null, error: null };
                }
                
                const error = new Error(`Supabase API error: ${response.status}`);
                error.status = response.status;
                error.code = response.headers.get('x-sb-error-code') || null;
                try { error.details = await response.json(); } catch {}
                return { data: null, error };
            }
            
            // DELETE — нет тела ответа
            if (this._method === 'DELETE') {
                return { data: null, error: null };
            }
            
            const responseData = await response.json();
            
            // single — возвращаем первый элемент
            if (this._single && Array.isArray(responseData)) {
                return { data: responseData[0] || null, error: null };
            }
            
            return { data: responseData, error: null };
            
        } catch (error) {
            return { data: null, error };
        }
    }
}

/**
 * Создаёт строитель запросов для таблицы.
 * @param {string} table
 * @returns {QueryBuilder}
 */
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
                const response = await apiFetch(`/storage/v1/object/${bucket}`, {
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
