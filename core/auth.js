/**
 * Authentication Utilities Module
 * 
 * Управление аутентификацией пользователей и сессиями.
 * Предоставляет функции для входа, выхода, проверки сессии и защиты маршрутов.
 * 
 * Архитектурные решения:
 * - Все функции используют единый клиент из core/supabase.js.
 * - Сохранение URL для возврата после логина.
 * - Минималистичный подход, только необходимые методы.
 * 
 * @module auth
 * @version 3.0.0
 * @changes
 * - Полный рефакторинг: удален EventBus, PermissionManager и неиспользуемый код.
 * - Упрощена логика проверки сессии.
 * - Добавлена поддержка сохранения returnUrl.
 */

import { supabase } from './supabase.js';

// ========== КОНСТАНТЫ ==========

/**
 * Ключ для хранения URL возврата в sessionStorage.
 * @type {string}
 */
const RETURN_URL_KEY = 'sh_auth_return_url';

// ========== БАЗОВЫЕ ФУНКЦИИ АУТЕНТИФИКАЦИИ ==========

/**
 * Проверяет наличие активной сессии и возвращает пользователя.
 * В отличие от requireAuth(), не выполняет редирект.
 * 
 * @returns {Promise<Object|null>} Объект пользователя или null
 * 
 * @example
 * const user = await checkAuth();
 * if (user) {
 *     console.log('User is logged in:', user.email);
 * }
 */
export async function checkAuth() {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('[Auth] Check session error:', error);
            return null;
        }
        
        return session?.user || null;
        
    } catch (error) {
        console.error('[Auth] Check auth error:', error);
        return null;
    }
}

/**
 * Проверяет сессию и редиректит на страницу входа, если пользователь не авторизован.
 * Сохраняет текущий URL для возврата после успешного входа.
 * 
 * @param {Object} options - Опции проверки
 * @param {string} [options.redirectTo='/pages/login.html'] - URL страницы входа
 * @returns {Promise<Object|null>} Объект пользователя или null (если произошел редирект)
 * 
 * @example
 * // На защищенной странице
 * const user = await requireAuth();
 * if (!user) return; // Произошел редирект на логин
 */
export async function requireAuth(options = {}) {
    const {
        redirectTo = '/pages/login.html'
    } = options;
    
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error || !session) {
            console.log('[Auth] No active session, redirecting to login');
            
            // Сохраняем текущий URL для возврата после логина
            const currentPath = window.location.pathname + window.location.search + window.location.hash;
            if (!currentPath.includes('/login')) {
                sessionStorage.setItem(RETURN_URL_KEY, currentPath);
                console.log('[Auth] Saved return URL:', currentPath);
            }
            
            window.location.href = redirectTo;
            return null;
        }
        
        return session.user;
        
    } catch (error) {
        console.error('[Auth] Require auth error:', error);
        window.location.href = redirectTo;
        return null;
    }
}

/**
 * Получает текущего пользователя (альтернативный метод через getUser).
 * 
 * @returns {Promise<Object|null>} Объект пользователя или null
 */
export async function getCurrentUser() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) {
            console.error('[Auth] Get user error:', error);
            return null;
        }
        
        return user;
        
    } catch (error) {
        console.error('[Auth] Get current user error:', error);
        return null;
    }
}

// ========== ВХОД И ВЫХОД ==========

/**
 * Выполняет вход пользователя.
 * 
 * @param {string} email - Email пользователя
 * @param {string} password - Пароль
 * @returns {Promise<Object>} Результат входа
 * @returns {boolean} .success - Успешно ли выполнен вход
 * @returns {Object|null} .user - Объект пользователя
 * @returns {Object|null} .session - Объект сессии
 * @returns {string|null} .error - Сообщение об ошибке
 */
export async function signIn(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) {
            let errorMessage = 'Ошибка входа';
            
            if (error.message.includes('Invalid login credentials')) {
                errorMessage = 'Неверный email или пароль';
            } else if (error.message.includes('Email not confirmed')) {
                errorMessage = 'Email не подтвержден';
            } else {
                errorMessage = error.message;
            }
            
            return {
                success: false,
                user: null,
                session: null,
                error: errorMessage
            };
        }
        
        return {
            success: true,
            user: data.user,
            session: data.session,
            error: null
        };
        
    } catch (error) {
        console.error('[Auth] Sign in error:', error);
        
        return {
            success: false,
            user: null,
            session: null,
            error: 'Неизвестная ошибка при входе'
        };
    }
}

/**
 * Выполняет регистрацию нового пользователя.
 * 
 * @param {string} email - Email
 * @param {string} password - Пароль
 * @param {Object} metadata - Дополнительные данные (full_name и т.д.)
 * @returns {Promise<Object>} Результат регистрации
 */
export async function signUp(email, password, metadata = {}) {
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: metadata
            }
        });
        
        if (error) {
            let errorMessage = 'Ошибка регистрации';
            
            if (error.message.includes('User already registered')) {
                errorMessage = 'Пользователь с таким email уже существует';
            } else if (error.message.includes('Password should be')) {
                errorMessage = 'Пароль должен содержать не менее 6 символов';
            } else {
                errorMessage = error.message;
            }
            
            return {
                success: false,
                user: null,
                error: errorMessage
            };
        }
        
        return {
            success: true,
            user: data.user,
            error: null
        };
        
    } catch (error) {
        console.error('[Auth] Sign up error:', error);
        
        return {
            success: false,
            user: null,
            error: 'Неизвестная ошибка при регистрации'
        };
    }
}

/**
 * Выполняет выход из системы.
 * Очищает все кэши, сессию и перенаправляет на страницу входа.
 * 
 * @param {Object} options - Опции выхода
 * @param {string} [options.redirectTo='/pages/login.html'] - URL для редиректа после выхода
 * @returns {Promise<void>}
 */
export async function logout(options = {}) {
    const { redirectTo = '/pages/login.html' } = options;
    
    console.log('[Auth] Logging out...');
    
    try {
        // Очищаем URL возврата
        sessionStorage.removeItem(RETURN_URL_KEY);
        
        // Очищаем другие кэши приложения (если есть)
        const cacheKeys = ['cached_shift', 'cached_cart'];
        cacheKeys.forEach(key => {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                // Игнорируем ошибки
            }
        });
        
        // Выходим из Supabase
        await supabase.auth.signOut();
        
        console.log('[Auth] Logout successful');
        
    } catch (error) {
        console.error('[Auth] Logout error:', error);
    } finally {
        // Редиректим на страницу входа
        window.location.href = redirectTo;
    }
}

// ========== УПРАВЛЕНИЕ URL ВОЗВРАТА ==========

/**
 * Сохраняет URL для возврата после логина.
 * 
 * @param {string} url - URL для сохранения
 */
export function saveReturnUrl(url) {
    if (url && !url.includes('/login')) {
        sessionStorage.setItem(RETURN_URL_KEY, url);
        console.log('[Auth] Return URL saved:', url);
    }
}

/**
 * Получает сохраненный URL возврата и удаляет его из хранилища.
 * 
 * @param {string} [defaultUrl='/pages/inventory.html'] - URL по умолчанию
 * @returns {string} URL для возврата
 */
export function getReturnUrl(defaultUrl = '/pages/inventory.html') {
    const returnUrl = sessionStorage.getItem(RETURN_URL_KEY);
    
    if (returnUrl) {
        sessionStorage.removeItem(RETURN_URL_KEY);
        console.log('[Auth] Return URL retrieved:', returnUrl);
        return returnUrl;
    }
    
    return defaultUrl;
}

// ========== ДЕПРЕКЕЙТИД / СТАРЫЕ МЕТОДЫ (для обратной совместимости) ==========

/**
 * @deprecated Используйте checkAuth()
 */
export async function getUserProfile() {
    console.warn('[Auth] getUserProfile is deprecated, use checkAuth() or getCurrentUser()');
    return await getCurrentUser();
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    checkAuth,
    requireAuth,
    getCurrentUser,
    getUserProfile,
    signIn,
    signUp,
    logout,
    saveReturnUrl,
    getReturnUrl
};
