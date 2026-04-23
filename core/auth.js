// ========================================
// FILE: core/auth.js
// ========================================

/**
 * Authentication Module - MPA Edition
 * 
 * Управление аутентификацией пользователей в многостраничном приложении.
 * Каждая страница самостоятельно импортирует и использует этот модуль.
 * 
 * Архитектурные решения:
 * - Сам загружает Supabase SDK при необходимости.
 * - Прямое использование глобального клиента Supabase.
 * - Отсутствие роутинга — редиректы только через window.location.
 * - Экспортирует функцию getSupabase для централизованного доступа к БД.
 * 
 * @module auth
 * @version 3.4.1
 * @changes
 * - Добавлен export перед функцией getSupabase (исправление ошибки импорта).
 * - getSupabase добавлена в экспорт по умолчанию.
 */

// ========== КОНСТАНТЫ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

// Состояние загрузки
let loadingPromise = null;
let isLoaded = false;

// ========== ЗАГРУЗКА SUPABASE SDK ==========

/**
 * Загружает Supabase SDK динамически
 * @returns {Promise<void>}
 */
function loadSupabaseSDK() {
    // Если уже загружен
    if (window.supabase) {
        return Promise.resolve();
    }
    
    // Если уже идёт загрузка
    if (loadingPromise) {
        return loadingPromise;
    }
    
    // Загружаем
    loadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SUPABASE_CDN;
        script.onload = () => {
            isLoaded = true;
            loadingPromise = null;
            resolve();
        };
        script.onerror = () => {
            loadingPromise = null;
            reject(new Error('Failed to load Supabase SDK. Check your internet connection.'));
        };
        document.head.appendChild(script);
    });
    
    return loadingPromise;
}

/**
 * Получает клиент Supabase.
 * Создаёт клиент один раз после загрузки SDK.
 * 
 * @returns {Promise<Object>} Клиент Supabase
 * @throws {Error} Если не удалось загрузить SDK
 */
export async function getSupabase() {
    // Загружаем SDK если нужно
    await loadSupabaseSDK();
    
    if (!window.supabase) {
        throw new Error('Supabase client not available after loading');
    }
    
    // Создаём клиент один раз и кэшируем
    if (!window.__supabaseClient) {
        window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    
    return window.__supabaseClient;
}

// ========== ПРОВЕРКА СЕТИ ==========

/**
 * Проверяет наличие интернет-соединения.
 * @returns {boolean}
 */
export function isOnline() {
    return navigator.onLine;
}

// ========== ПОЛУЧЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ==========

/**
 * Получает текущего авторизованного пользователя.
 * @returns {Promise<{user: Object|null, error: string|null}>}
 */
export async function getCurrentUser() {
    if (!isOnline()) {
        console.warn('[Auth] Offline mode - cannot get user');
        return { user: null, error: 'Отсутствует подключение к интернету' };
    }
    
    try {
        const supabase = await getSupabase();
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) {
            console.error('[Auth] Get user error:', error);
            return { user: null, error: error.message || 'Ошибка получения пользователя' };
        }
        
        return { user, error: null };
        
    } catch (error) {
        console.error('[Auth] Unexpected error:', error);
        return { user: null, error: error.message || 'Неизвестная ошибка' };
    }
}

/**
 * Быстрая проверка авторизации.
 * @returns {Promise<boolean>}
 */
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

// ========== ЗАЩИТА СТРАНИЦ ==========

/**
 * Проверяет авторизацию и редиректит на страницу входа.
 * @param {Object} options
 * @param {string} [options.redirectTo='/pages/login.html']
 * @returns {Promise<Object|null>}
 */
export async function requireAuth(options = {}) {
    const { redirectTo = '/pages/login.html' } = options;
    
    if (!isOnline()) {
        console.warn('[Auth] Offline mode - cannot verify auth');
        alert('Нет подключения к интернету. Проверьте соединение и обновите страницу.');
        return null;
    }
    
    try {
        const { user, error } = await getCurrentUser();
        
        if (error || !user) {
            console.log('[Auth] No active session, redirecting to login');
            window.location.href = redirectTo;
            return null;
        }
        
        return user;
        
    } catch (error) {
        console.error('[Auth] Require auth error:', error);
        window.location.href = redirectTo;
        return null;
    }
}

// ========== ВХОД В СИСТЕМУ ==========

/**
 * Выполняет вход пользователя.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, user: Object|null, error: string|null}>}
 */
export async function signIn(email, password) {
    if (!isOnline()) {
        return {
            success: false,
            user: null,
            error: 'Отсутствует подключение к интернету. Проверьте соединение.'
        };
    }
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) {
            console.error('[Auth] Sign in error:', error);
            
            let errorMessage = 'Ошибка входа';
            if (error.message.includes('Invalid login credentials')) {
                errorMessage = 'Неверный email или пароль';
            } else if (error.message.includes('Email not confirmed')) {
                errorMessage = 'Email не подтвержден. Проверьте почту.';
            } else if (error.message.includes('rate limit')) {
                errorMessage = 'Слишком много попыток. Попробуйте позже.';
            } else {
                errorMessage = error.message;
            }
            
            return { success: false, user: null, error: errorMessage };
        }
        
        console.log('[Auth] Sign in successful:', data.user.email);
        return { success: true, user: data.user, error: null };
        
    } catch (error) {
        console.error('[Auth] Unexpected error:', error);
        return {
            success: false,
            user: null,
            error: 'Неизвестная ошибка при входе. Попробуйте позже.'
        };
    }
}

// ========== ВЫХОД ИЗ СИСТЕМЫ ==========

/**
 * Выполняет выход из системы.
 * @param {Object} options
 * @param {string} [options.redirectTo='/pages/login.html']
 * @returns {Promise<void>}
 */
export async function logout(options = {}) {
    const { redirectTo = '/pages/login.html' } = options;
    
    console.log('[Auth] Logging out...');
    
    try {
        // Очищаем локальные данные
        try {
            localStorage.removeItem('cached_shift');
            localStorage.removeItem('cached_cart');
            sessionStorage.clear();
        } catch (e) {
            // Игнорируем ошибки очистки
        }
        
        if (isOnline()) {
            const supabase = await getSupabase();
            await supabase.auth.signOut();
            console.log('[Auth] Logout successful (online)');
        } else {
            console.log('[Auth] Logout in offline mode (local only)');
        }
        
    } catch (error) {
        console.error('[Auth] Logout error:', error);
    } finally {
        window.location.href = redirectTo;
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Получает URL для возврата после входа.
 * @param {string} defaultUrl
 * @returns {string}
 */
export function getReturnUrl(defaultUrl = '/pages/inventory.html') {
    const returnUrl = sessionStorage.getItem('sh_auth_return_url');
    if (returnUrl) {
        sessionStorage.removeItem('sh_auth_return_url');
        return returnUrl;
    }
    return defaultUrl;
}

/**
 * Сохраняет URL для возврата.
 * @param {string} url
 */
export function setReturnUrl(url) {
    if (url && url !== '/pages/login.html') {
        sessionStorage.setItem('sh_auth_return_url', url);
    }
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    getSupabase,
    getCurrentUser,
    isAuthenticated,
    requireAuth,
    signIn,
    logout,
    isOnline,
    getReturnUrl,
    setReturnUrl
};
