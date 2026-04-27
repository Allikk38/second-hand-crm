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
 * - signIn корректно обрабатывает отсутствие data в ответе.
 * 
 * @module auth
 * @version 4.2.0
 * @changes
 * - v4.1.0: Динамический импорт supabase-client с try/catch.
 * - v4.2.0: Исправлена обработка ответа в signIn (ошибка "Cannot read properties of undefined").
 * - v4.2.0: Добавлена проверка наличия data перед обращением к data.user.
 * - v4.2.0: Улучшена диагностика — логируется тело ответа при ошибке.
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';

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

// ========== ПРОВЕРКИ ==========

export function isOnline() {
    return navigator.onLine;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

export async function getCurrentUser() {
    if (!isOnline()) {
        return { user: null, error: 'Нет подключения к интернету', errorType: 'network' };
    }
    
    try {
        const supabase = await getSupabase();
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) throw error;
        
        return { user, error: null, errorType: null };
        
    } catch (error) {
        console.error('[Auth] getCurrentUser error:', error);
        const errorType = error?.status === 401 ? 'auth' : 'network';
        return { user: null, error: error.message || 'Неизвестная ошибка', errorType };
    }
}

export async function isAuthenticated() {
    if (!isOnline()) return false;
    try {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        return !!session?.user;
    } catch {
        return false;
    }
}

export async function requireAuth(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    if (!isOnline()) return { user: null, offline: true };
    
    try {
        const { user, errorType } = await getCurrentUser();
        
        if (errorType === 'auth' || !user) {
            const basePath = getBasePath();
            const fullPath = redirectTo.startsWith('/') 
                ? `${basePath}${redirectTo}` 
                : `${basePath}/${redirectTo}`;
            
            console.log('[Auth] Redirecting to:', fullPath);
            window.location.href = fullPath;
            return { user: null, authError: true };
        }
        
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
 * Корректно обрабатывает случаи, когда ответ не содержит data.
 * 
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, user: Object|null, error: string|null}>}
 */
export async function signIn(email, password) {
    if (!isOnline()) {
        return { success: false, user: null, error: 'Нет подключения к интернету' };
    }
    
    try {
        const supabase = await getSupabase();
        const result = await supabase.auth.signInWithPassword({ email, password });
        
        // Проверяем, что ответ содержит ожидаемые данные
        if (!result) {
            console.error('[Auth] signIn: empty result from signInWithPassword');
            return { success: false, user: null, error: 'Пустой ответ от сервера' };
        }
        
        if (result.error) {
            console.error('[Auth] signIn: error in result:', result.error);
            return { success: false, user: null, error: result.error.message || 'Ошибка входа' };
        }
        
        // Безопасно извлекаем user
        const user = result.data?.user || result.user || null;
        
        if (!user) {
            console.error('[Auth] signIn: no user in response:', result);
            return { success: false, user: null, error: 'Сервер не вернул данные пользователя' };
        }
        
        return { success: true, user, error: null };
        
    } catch (error) {
        console.error('[Auth] signIn error:', error);
        
        let message = 'Ошибка входа';
        
        if (error.code === 'SUPABASE_CLIENT_LOAD_FAILED') {
            message = 'Не удалось загрузить модуль авторизации. Попробуйте обновить страницу.';
        } else if (error.message?.includes('Invalid login credentials')) {
            message = 'Неверный email или пароль';
        } else if (error.message?.includes('Email not confirmed')) {
            message = 'Email не подтверждён. Проверьте почту.';
        } else if (error.message) {
            message = error.message;
        }
        
        return { success: false, user: null, error: message };
    }
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
