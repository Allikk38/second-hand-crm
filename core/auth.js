// ========================================
// FILE: core/auth.js
// ========================================

/**
 * Authentication Module - MPA Edition
 * 
 * Использует локальный Supabase клиент без CDN-зависимостей.
 * HTTP/2 только, без QUIC.
 * 
 * Архитектурные решения:
 * - Динамический импорт supabase-client.js с try/catch.
 * - Клиент создаётся один раз и кэшируется (синглтон).
 * - Все функции безопасно обрабатывают отсутствие данных.
 * - getCurrentUser использует новый формат ответа getUser() (v1.4.0+).
 * - signIn имеет retry-логику для холодного старта Supabase.
 * - requireAuth не редиректит при таймауте — показывает офлайн-режим.
 * 
 * @module auth
 * @version 4.5.0
 * @changes
 * - v4.5.0: Уменьшен таймаут getCurrentUser с 8 до 3 секунд
 * - v4.4.0: Добавлен retry в signIn() для холодного старта Supabase
 * - v4.4.0: Добавлен таймаут 8с в getCurrentUser()
 * - v4.4.0: requireAuth() при таймауте возвращает timeout вместо редиректа
 * - v4.4.0: Улучшены сообщения об ошибках
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// ========== КОНСТАНТЫ RETRY ==========

const SIGN_IN_MAX_RETRIES = 3;
const SIGN_IN_RETRY_DELAY_MS = 2000;
const GET_USER_TIMEOUT_MS = 3000; // 3 секунды (было 8000)

// ========== БАЗОВЫЙ ПУТЬ ==========

function getBasePath() {
    const base = document.querySelector('base');
    if (base && base.href) {
        return base.href.replace(/\/$/, '');
    }
    return window.location.origin;
}

// ========== КЛИЕНТ ==========

let clientInstance = null;
let moduleLoadError = null;

export async function getSupabase() {
    if (clientInstance) {
        return clientInstance;
    }
    
    if (moduleLoadError) {
        throw moduleLoadError;
    }
    
    try {
        const module = await import('./supabase-client.js');
        
        if (typeof module.createClient !== 'function') {
            const error = new Error(
                'supabase-client.js загружен, но не экспортирует createClient.'
            );
            moduleLoadError = error;
            throw error;
        }
        
        clientInstance = module.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Auth] Supabase client created successfully');
        
        return clientInstance;
        
    } catch (error) {
        const wrappedError = new Error(
            'Не удалось загрузить модуль supabase-client.js: ' + 
            (error.message || 'Неизвестная ошибка')
        );
        wrappedError.originalError = error;
        wrappedError.code = 'SUPABASE_CLIENT_LOAD_FAILED';
        
        moduleLoadError = wrappedError;
        console.error('[Auth] Failed to load supabase-client.js:', error);
        
        throw wrappedError;
    }
}

export async function isSupabaseAvailable() {
    try {
        await getSupabase();
        return true;
    } catch {
        return false;
    }
}

// ========== УТИЛИТЫ ==========

/**
 * Выполняет функцию с таймаутом.
 * @param {Function} fn - Асинхронная функция
 * @param {number} timeoutMs - Таймаут в мс
 * @param {string} timeoutMessage - Сообщение при таймауте
 * @returns {Promise<any>}
 */
async function withTimeout(fn, timeoutMs, timeoutMessage) {
    return new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
        
        try {
            const result = await fn();
            clearTimeout(timer);
            resolve(result);
        } catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}

/**
 * Задержка на указанное количество миллисекунд.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== ПРОВЕРКИ ==========

export function isOnline() {
    return navigator.onLine;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

/**
 * Получает текущего пользователя.
 * Имеет таймаут 3 секунды. При таймауте проверяет localStorage.
 * 
 * @returns {Promise<{user: Object|null, error: string|null, errorType: string|null}>}
 */
export async function getCurrentUser() {
    // Быстрая проверка: если нет сети и нет токена в localStorage — сразу возвращаем
    if (!isOnline()) {
        // Проверяем, есть ли токен в localStorage
        try {
            const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
            if (token?.user) {
                console.log('[Auth] Offline but cached user found:', token.user.email);
                return { user: token.user, error: null, errorType: null };
            }
        } catch {}
        
        return { user: null, error: 'Нет подключения к интернету', errorType: 'network' };
    }
    
    try {
        const supabase = await getSupabase();
        
        // Выполняем getUser с таймаутом
        const { user, error } = await withTimeout(
            () => supabase.auth.getUser(),
            GET_USER_TIMEOUT_MS,
            'Сервер не отвечает. Проверка сессии прервана.'
        );
        
        if (error) {
            console.warn('[Auth] getUser returned error:', error);
            
            // 401 — сессия истекла или отсутствует
            if (error.status === 401) {
                return { user: null, error: error.message || 'Сессия истекла', errorType: 'auth' };
            }
            
            // Другие ошибки — проверяем кэш
            try {
                const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
                if (token?.user) {
                    console.log('[Auth] Server error but cached user found');
                    return { user: token.user, error: null, errorType: null };
                }
            } catch {}
            
            return { user: null, error: error.message || 'Ошибка сервера', errorType: 'network' };
        }
        
        if (!user) {
            return { user: null, error: 'Пользователь не найден', errorType: 'auth' };
        }
        
        return { user, error: null, errorType: null };
        
    } catch (error) {
        console.error('[Auth] getCurrentUser exception:', error);
        
        // При таймауте или сетевой ошибке — пробуем кэш
        if (error.message?.includes('не отвечает') || error.message?.includes('прервана')) {
            try {
                const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
                if (token?.user) {
                    console.log('[Auth] Timeout but cached user found');
                    return { user: token.user, error: null, errorType: null };
                }
            } catch {}
            
            return { user: null, error: error.message, errorType: 'timeout' };
        }
        
        const errorType = error?.status === 401 ? 'auth' : 'network';
        return { user: null, error: error.message || 'Неизвестная ошибка', errorType };
    }
}

/**
 * Проверяет, аутентифицирован ли пользователь.
 * Проверяет localStorage мгновенно, без запроса к серверу.
 * 
 * @returns {boolean}
 */
export async function isAuthenticated() {
    // Быстрая проверка localStorage
    try {
        const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
        if (token?.user?.id) {
            return true;
        }
    } catch {}
    
    // Если нет в localStorage, но есть сеть — проверяем сервер
    if (isOnline()) {
        try {
            const supabase = await getSupabase();
            const { data } = await supabase.auth.getSession();
            return !!(data?.session?.user);
        } catch {
            return false;
        }
    }
    
    return false;
}

/**
 * Требует аутентификацию для доступа к странице.
 * 
 * ПРИ ТАЙМАУТЕ: НЕ редиректит на логин. Возвращает timeout: true.
 * Страница должна показать офлайн-режим с кэшированными данными.
 * 
 * @param {Object} options
 * @param {string} [options.redirectTo='pages/login.html']
 * @returns {Promise<{user: Object|null, offline?: boolean, authError?: boolean, networkError?: boolean, timeout?: boolean}>}
 */
export async function requireAuth(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    // Нет сети — офлайн-режим
    if (!isOnline()) {
        // Проверяем кэшированную сессию
        try {
            const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
            if (token?.user) {
                console.log('[Auth] Offline mode with cached session');
                return { user: token.user, offline: true };
            }
        } catch {}
        
        return { user: null, offline: true };
    }
    
    try {
        const { user, errorType } = await getCurrentUser();
        
        // Таймаут — не редиректим, даём работать офлайн
        if (errorType === 'timeout') {
            console.log('[Auth] Auth check timed out, using cached session if available');
            try {
                const token = JSON.parse(localStorage.getItem('sb-bhdwniiyrrujeoubrvle-auth-token') || '{}');
                if (token?.user) {
                    return { user: token.user, timeout: true };
                }
            } catch {}
            return { user: null, timeout: true };
        }
        
        // Нет авторизации — редиректим
        if (errorType === 'auth' || !user) {
            const basePath = getBasePath();
            const fullPath = redirectTo.startsWith('/') 
                ? `${basePath}${redirectTo}` 
                : `${basePath}/${redirectTo}`;
            
            console.log('[Auth] No session, redirecting to:', fullPath);
            window.location.href = fullPath;
            return { user: null, authError: true };
        }
        
        // Сетевая ошибка — не редиректим
        if (errorType === 'network') {
            return { user: null, networkError: true };
        }
        
        return { user };
        
    } catch (error) {
        console.error('[Auth] requireAuth error:', error);
        return { user: null, networkError: true };
    }
}

// ========== ВХОД ==========

/**
 * Выполняет вход по email и паролю.
 * Имеет retry-логику (3 попытки с задержкой 2с) для холодного старта Supabase.
 * 
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, user: Object|null, error: string|null}>}
 */
export async function signIn(email, password) {
    if (!isOnline()) {
        return { success: false, user: null, error: 'Нет подключения к интернету. Проверьте соединение.' };
    }
    
    let lastError = null;
    
    // До 3 попыток с задержкой
    for (let attempt = 0; attempt < SIGN_IN_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            console.log(`[Auth] Sign in retry ${attempt + 1}/${SIGN_IN_MAX_RETRIES} after ${SIGN_IN_RETRY_DELAY_MS}ms...`);
            await delay(SIGN_IN_RETRY_DELAY_MS);
        }
        
        try {
            const supabase = await getSupabase();
            const result = await supabase.auth.signInWithPassword({ email, password });
            
            if (!result) {
                console.error('[Auth] signIn: empty result from signInWithPassword');
                lastError = 'Пустой ответ от сервера. Попробуйте ещё раз.';
                continue;
            }
            
            if (result.error) {
                console.warn('[Auth] signIn: error in result:', result.error.message);
                
                // Неверные учётные данные — нет смысла повторять
                if (result.error.message?.includes('Invalid login credentials') ||
                    result.error.message?.includes('Неверный email или пароль')) {
                    return { success: false, user: null, error: 'Неверный email или пароль' };
                }
                
                // Таймаут или сетевая ошибка — пробуем ещё раз
                if (result.error.message?.includes('не отвечает') ||
                    result.error.message?.includes('подключения к интернету')) {
                    lastError = result.error.message;
                    continue;
                }
                
                lastError = result.error.message || 'Ошибка входа';
                continue;
            }
            
            const user = result.data?.user || null;
            
            if (!user) {
                console.error('[Auth] signIn: no user in response');
                lastError = 'Сервер не вернул данные пользователя';
                continue;
            }
            
            console.log('[Auth] Login successful:', user.email);
            return { success: true, user, error: null };
            
        } catch (error) {
            console.error(`[Auth] signIn error (attempt ${attempt + 1}):`, error);
            
            let message = 'Ошибка входа';
            
            if (error.code === 'SUPABASE_CLIENT_LOAD_FAILED') {
                message = 'Не удалось загрузить модуль авторизации. Обновите страницу.';
            } else if (error.message?.includes('TIMEOUT') || error.message?.includes('не отвечает')) {
                message = 'Сервер не отвечает. Пробуем ещё раз...';
            } else if (error.message?.includes('NETWORK') || error.message?.includes('подключения')) {
                message = 'Проблемы с подключением. Проверьте интернет.';
            } else if (error.message) {
                message = error.message;
            }
            
            lastError = message;
            // Продолжаем попытки
        }
    }
    
    // Исчерпали попытки
    const finalMessage = lastError || 'Не удалось войти после нескольких попыток. Попробуйте позже.';
    console.error('[Auth] All sign in attempts exhausted:', finalMessage);
    
    return { success: false, user: null, error: finalMessage };
}

// ========== ВЫХОД ==========

export async function logout(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    try {
        localStorage.removeItem('sh_device_id');
        localStorage.removeItem('sb-bhdwniiyrrujeoubrvle-auth-token');
        sessionStorage.clear();
        
        if (isOnline()) {
            try {
                const supabase = await getSupabase();
                await supabase.auth.signOut();
            } catch {}
        }
        
        clientInstance = null;
        moduleLoadError = null;
        
    } catch (error) {
        console.error('[Auth] logout error:', error);
    } finally {
        const basePath = getBasePath();
        const fullPath = redirectTo.startsWith('/') 
            ? `${basePath}${redirectTo}` 
            : `${basePath}/${redirectTo}`;
        
        window.location.href = fullPath;
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ==========

export function getReturnUrl(defaultUrl = 'pages/inventory.html') {
    const url = sessionStorage.getItem('sh_auth_return_url');
    if (url) {
        sessionStorage.removeItem('sh_auth_return_url');
        return url;
    }
    const basePath = getBasePath();
    return defaultUrl.startsWith('/') ? `${basePath}${defaultUrl}` : `${basePath}/${defaultUrl}`;
}

export function setReturnUrl(url) {
    if (url && !url.includes('login.html')) {
        sessionStorage.setItem('sh_auth_return_url', url);
    }
}

// ========== ЭКСПОРТ ==========

export default {
    getSupabase,
    isSupabaseAvailable,
    getCurrentUser,
    isAuthenticated,
    requireAuth,
    signIn,
    logout,
    isOnline,
    getReturnUrl,
    setReturnUrl
};
