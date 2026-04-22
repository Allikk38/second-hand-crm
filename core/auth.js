/**
 * Authentication Module - MPA Edition
 * 
 * Управление аутентификацией пользователей в многостраничном приложении.
 * Каждая страница самостоятельно импортирует и использует этот модуль.
 * 
 * Архитектурные решения:
 * - Прямое использование глобального клиента Supabase.
 * - Отсутствие роутинга — редиректы только через window.location.
 * - Минималистичный API для простоты использования на любой странице.
 * - Полная обработка офлайн-режима и сетевых ошибок.
 * 
 * @module auth
 * @version 3.2.0
 * @changes
 * - Убраны депрекейтед методы (checkAuth, getUserProfile).
 * - Убрана функция signUp (не используется в MPA).
 * - Упрощена инициализация Supabase клиента.
 * - Добавлен экспорт getReturnUrl для обратной совместимости.
 */

// ========== КОНСТАНТЫ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// ========== ПОЛУЧЕНИЕ КЛИЕНТА SUPABASE ==========

/**
 * Получает глобальный клиент Supabase.
 * Создаёт клиент один раз и кэширует.
 * 
 * @returns {Object} Клиент Supabase
 * @throws {Error} Если Supabase не загружен
 */
function getSupabase() {
    if (!window.supabase) {
        throw new Error('Supabase client not loaded. Ensure CDN script is included in HTML.');
    }
    
    if (!window.__supabaseClient) {
        window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    
    return window.__supabaseClient;
}

// ========== ПРОВЕРКА СЕТИ ==========

/**
 * Проверяет наличие интернет-соединения.
 * 
 * @returns {boolean} true если есть соединение
 */
export function isOnline() {
    return navigator.onLine;
}

// ========== ПОЛУЧЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ==========

/**
 * Получает текущего авторизованного пользователя.
 * В отличие от requireAuth(), не выполняет редирект.
 * 
 * @returns {Promise<Object>} Результат проверки
 * @returns {Object|null} .user - Объект пользователя или null
 * @returns {string|null} .error - Сообщение об ошибке или null
 * 
 * @example
 * const { user, error } = await getCurrentUser();
 * if (error) {
 *     console.error('Ошибка получения пользователя:', error);
 * } else if (user) {
 *     console.log('Пользователь авторизован:', user.email);
 * }
 */
export async function getCurrentUser() {
    if (!isOnline()) {
        console.warn('[Auth] Offline mode - cannot get user');
        return { 
            user: null, 
            error: 'Отсутствует подключение к интернету' 
        };
    }
    
    try {
        const supabase = getSupabase();
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) {
            console.error('[Auth] Get user error:', error);
            return { 
                user: null, 
                error: error.message || 'Ошибка получения пользователя' 
            };
        }
        
        return { user, error: null };
        
    } catch (error) {
        console.error('[Auth] Unexpected error getting user:', error);
        return { 
            user: null, 
            error: error.message || 'Неизвестная ошибка' 
        };
    }
}

/**
 * Быстрая проверка авторизации (без получения полного объекта пользователя).
 * 
 * @returns {Promise<boolean>} true если пользователь авторизован
 */
export async function isAuthenticated() {
    if (!isOnline()) return false;
    
    try {
        const supabase = getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        return !!session?.user;
    } catch {
        return false;
    }
}

// ========== ЗАЩИТА СТРАНИЦ ==========

/**
 * Проверяет авторизацию и редиректит на страницу входа, если её нет.
 * Это ОСНОВНАЯ функция для защиты MPA-страниц.
 * 
 * @param {Object} options - Опции проверки
 * @param {string} [options.redirectTo='/pages/login.html'] - URL страницы входа
 * @returns {Promise<Object|null>} Объект пользователя или null (если произошел редирект)
 * 
 * @example
 * const user = await requireAuth();
 * if (!user) return;
 * console.log('Страница защищена, пользователь:', user.email);
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
 * Выполняет вход пользователя по email и паролю.
 * 
 * @param {string} email - Email пользователя
 * @param {string} password - Пароль
 * @returns {Promise<Object>} Результат входа
 * @returns {boolean} .success - Успешно ли выполнен вход
 * @returns {Object|null} .user - Объект пользователя
 * @returns {string|null} .error - Сообщение об ошибке
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
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
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
            
            return {
                success: false,
                user: null,
                error: errorMessage
            };
        }
        
        console.log('[Auth] Sign in successful:', data.user.email);
        
        return {
            success: true,
            user: data.user,
            error: null
        };
        
    } catch (error) {
        console.error('[Auth] Unexpected sign in error:', error);
        
        return {
            success: false,
            user: null,
            error: 'Неизвестная ошибка при входе. Попробуйте позже.'
        };
    }
}

// ========== ВЫХОД ИЗ СИСТЕМЫ ==========

/**
 * Выполняет выход из системы и редиректит на страницу входа.
 * 
 * @param {Object} options - Опции выхода
 * @param {string} [options.redirectTo='/pages/login.html'] - URL для редиректа после выхода
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
            const supabase = getSupabase();
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
 * Сохраняет текущий URL в sessionStorage перед редиректом на логин.
 * 
 * @param {string} defaultUrl - URL по умолчанию
 * @returns {string} URL для возврата
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
 * Сохраняет URL для возврата после входа.
 * 
 * @param {string} url - URL для сохранения
 */
export function setReturnUrl(url) {
    if (url && url !== '/pages/login.html') {
        sessionStorage.setItem('sh_auth_return_url', url);
    }
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    getCurrentUser,
    isAuthenticated,
    requireAuth,
    signIn,
    logout,
    isOnline,
    getReturnUrl,
    setReturnUrl
};
