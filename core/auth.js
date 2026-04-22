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
 * - Прямое использование глобального клиента Supabase (загружается в HTML).
 * - Отсутствие роутинга — редиректы только через window.location.
 * - Минималистичный API для простоты использования на любой странице.
 * - Полная обработка офлайн-режима и сетевых ошибок.
 * 
 * @module auth
 * @version 3.1.0
 * @changes
 * - Полный переход на MPA-архитектуру (убраны returnUrl и сложная логика редиректов).
 * - Прямое использование window.supabase вместо кастомного клиента.
 * - Устранено дублирование проверки сессии.
 * - Добавлена обработка офлайн-режима.
 * - Упрощен API до минимально необходимого.
 * 
 * @example
 * // На любой защищенной странице (inventory.html, cashier.html)
 * import { requireAuth, getCurrentUser, logout } from '../core/auth.js';
 * 
 * const user = await requireAuth(); // если нет сессии — улетит на /pages/login.html
 * console.log('Текущий пользователь:', user.email);
 */

// ========== ПОЛУЧЕНИЕ КЛИЕНТА SUPABASE ==========

/**
 * Получает глобальный клиент Supabase.
 * Ожидается, что Supabase CDN загружен в HTML страницы.
 * 
 * @returns {Object|null} Клиент Supabase или null если не загружен
 * @throws {Error} Если Supabase не загружен
 */
function getSupabase() {
    if (!window.supabase) {
        throw new Error('Supabase client not loaded. Ensure CDN script is included in HTML.');
    }
    
    // Используем те же credentials, что и в index.html
    const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';
    
    // Создаем клиент один раз и кэшируем
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
    // Проверяем сеть
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
        
        return { 
            user, 
            error: null 
        };
        
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
 * 
 * @example
 * if (await isAuthenticated()) {
 *     console.log('Пользователь авторизован');
 * }
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
 * // В начале любого защищенного скрипта:
 * const user = await requireAuth();
 * if (!user) return; // Произошел редирект на логин, дальше код не выполнится
 * 
 * console.log('Страница защищена, пользователь:', user.email);
 */
export async function requireAuth(options = {}) {
    const {
        redirectTo = '/pages/login.html'
    } = options;
    
    // Быстрая проверка без запроса к серверу
    if (!isOnline()) {
        console.warn('[Auth] Offline mode - cannot verify auth, redirecting to login');
        window.location.href = redirectTo;
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
 * 
 * @example
 * const result = await signIn('user@example.com', 'password123');
 * if (result.success) {
 *     window.location.href = '/pages/inventory.html';
 * } else {
 *     alert('Ошибка входа: ' + result.error);
 * }
 */
export async function signIn(email, password) {
    // Проверяем сеть
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
            
            // Человекочитаемые сообщения
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
 * 
 * @example
 * // В обработчике кнопки "Выход"
 * import { logout } from '../core/auth.js';
 * await logout();
 */
export async function logout(options = {}) {
    const { redirectTo = '/pages/login.html' } = options;
    
    console.log('[Auth] Logging out...');
    
    try {
        // Очищаем локальные данные (если есть)
        try {
            localStorage.removeItem('cached_shift');
            localStorage.removeItem('cached_cart');
            sessionStorage.clear();
        } catch (e) {
            // Игнорируем ошибки очистки
        }
        
        // Если онлайн — выходим из Supabase
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
        // Всегда редиректим
        window.location.href = redirectTo;
    }
}

// ========== РЕГИСТРАЦИЯ (ОПЦИОНАЛЬНО) ==========

/**
 * Выполняет регистрацию нового пользователя.
 * 
 * @param {string} email - Email
 * @param {string} password - Пароль (мин. 6 символов)
 * @param {Object} metadata - Дополнительные данные (full_name и т.д.)
 * @returns {Promise<Object>} Результат регистрации
 * @returns {boolean} .success - Успешно ли выполнена регистрация
 * @returns {Object|null} .user - Объект пользователя
 * @returns {string|null} .error - Сообщение об ошибке
 * 
 * @example
 * const result = await signUp('new@example.com', 'password123', { full_name: 'Иван Петров' });
 * if (result.success) {
 *     alert('Регистрация успешна! Проверьте email для подтверждения.');
 * }
 */
export async function signUp(email, password, metadata = {}) {
    if (!isOnline()) {
        return {
            success: false,
            user: null,
            error: 'Отсутствует подключение к интернету'
        };
    }
    
    try {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: metadata
            }
        });
        
        if (error) {
            console.error('[Auth] Sign up error:', error);
            
            let errorMessage = 'Ошибка регистрации';
            
            if (error.message.includes('User already registered')) {
                errorMessage = 'Пользователь с таким email уже существует';
            } else if (error.message.includes('Password should be')) {
                errorMessage = 'Пароль должен содержать не менее 6 символов';
            } else if (error.message.includes('valid email')) {
                errorMessage = 'Введите корректный email адрес';
            } else {
                errorMessage = error.message;
            }
            
            return {
                success: false,
                user: null,
                error: errorMessage
            };
        }
        
        console.log('[Auth] Sign up successful:', data.user?.email);
        
        return {
            success: true,
            user: data.user,
            error: null
        };
        
    } catch (error) {
        console.error('[Auth] Unexpected sign up error:', error);
        
        return {
            success: false,
            user: null,
            error: 'Неизвестная ошибка при регистрации'
        };
    }
}

// ========== ДЕПРЕКЕЙТИД / СТАРЫЕ МЕТОДЫ (для обратной совместимости) ==========

/**
 * @deprecated Используйте getCurrentUser()
 */
export async function checkAuth() {
    console.warn('[Auth] checkAuth() is deprecated, use getCurrentUser()');
    const { user } = await getCurrentUser();
    return user;
}

/**
 * @deprecated Используйте getCurrentUser()
 */
export async function getUserProfile() {
    console.warn('[Auth] getUserProfile() is deprecated, use getCurrentUser()');
    const { user } = await getCurrentUser();
    return user;
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    getCurrentUser,
    isAuthenticated,
    requireAuth,
    signIn,
    signUp,
    logout,
    isOnline,
    
    // Deprecated
    checkAuth,
    getUserProfile
};
