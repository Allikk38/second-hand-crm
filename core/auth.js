// ========================================
// FILE: ./core/auth.js
// ========================================

/**
 * Authentication Utilities Module
 * 
 * Управление аутентификацией пользователей, сессиями и правами доступа.
 * Предоставляет функции для входа, выхода, проверки сессии и контроля доступа.
 * 
 * Архитектурные решения:
 * - Все функции используют единый клиент из core/supabase.js.
 * - Кэширование профиля пользователя в sessionStorage.
 * - Сохранение URL для возврата после логина.
 * - Система разрешений для будущей ролевой модели.
 * - Очистка всех кэшей при выходе.
 * 
 * @module auth
 * @version 2.0.0
 * @changes
 * - Добавлена полная JSDoc-документация.
 * - requireAuth сохраняет текущий URL для возврата после логина.
 * - Добавлена функция getUserProfile с кэшированием.
 * - logout очищает все кэши и уведомляет приложение.
 * - Добавлены функции проверки прав доступа.
 * - Добавлена обработка обновления токена.
 */

import { supabase } from './supabase.js';

// ========== КОНСТАНТЫ ==========

/**
 * Ключ для хранения URL возврата в sessionStorage.
 * @type {string}
 */
const RETURN_URL_KEY = 'sh_auth_return_url';

/**
 * Ключ для кэширования профиля в sessionStorage.
 * @type {string}
 */
const PROFILE_CACHE_KEY = 'sh_user_profile';

/**
 * Время жизни кэша профиля в миллисекундах (5 минут).
 * @type {number}
 */
const PROFILE_CACHE_TTL = 5 * 60 * 1000;

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
 * @param {boolean} [options.saveReturnUrl=true] - Сохранять ли URL для возврата
 * @returns {Promise<Object|null>} Объект пользователя или null (если произошел редирект)
 * 
 * @example
 * // На защищенной странице
 * const user = await requireAuth();
 * if (!user) return; // Произошел редирект на логин
 * 
 * // С кастомным URL входа
 * const user = await requireAuth({ redirectTo: '/login' });
 */
export async function requireAuth(options = {}) {
    const {
        redirectTo = '/pages/login.html',
        saveReturnUrl = true
    } = options;
    
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error || !session) {
            console.log('[Auth] No active session, redirecting to login');
            
            if (saveReturnUrl) {
                // Сохраняем текущий URL для возврата после логина
                const currentPath = window.location.pathname + window.location.search + window.location.hash;
                sessionStorage.setItem(RETURN_URL_KEY, currentPath);
                console.log('[Auth] Saved return URL:', currentPath);
            }
            
            window.location.href = redirectTo;
            return null;
        }
        
        return session.user;
        
    } catch (error) {
        console.error('[Auth] Require auth error:', error);
        
        if (saveReturnUrl) {
            const currentPath = window.location.pathname + window.location.search + window.location.hash;
            sessionStorage.setItem(RETURN_URL_KEY, currentPath);
        }
        
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

// ========== УПРАВЛЕНИЕ ПРОФИЛЕМ ==========

/**
 * Получает полный профиль пользователя из таблицы profiles.
 * Результат кэшируется в sessionStorage на 5 минут.
 * 
 * @param {string} [userId] - ID пользователя (если не указан, используется текущий)
 * @param {Object} options - Опции получения
 * @param {boolean} [options.forceRefresh=false] - Игнорировать кэш и запросить свежие данные
 * @returns {Promise<Object|null>} Объект профиля или null
 * 
 * @example
 * const profile = await getUserProfile();
 * console.log('User name:', profile?.full_name);
 */
export async function getUserProfile(userId = null, options = {}) {
    const { forceRefresh = false } = options;
    
    try {
        // Определяем ID пользователя
        let targetUserId = userId;
        if (!targetUserId) {
            const user = await getCurrentUser();
            if (!user) return null;
            targetUserId = user.id;
        }
        
        // Проверяем кэш
        const cacheKey = `${PROFILE_CACHE_KEY}_${targetUserId}`;
        
        if (!forceRefresh) {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { data, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < PROFILE_CACHE_TTL) {
                        console.log('[Auth] Returning cached profile for:', targetUserId);
                        return data;
                    }
                } catch (e) {
                    // Игнорируем ошибки парсинга кэша
                }
            }
        }
        
        // Запрашиваем профиль из БД
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetUserId)
            .single();
        
        if (error) {
            // Если профиля нет, создаем базовый
            if (error.code === 'PGRST116') {
                console.log('[Auth] Profile not found, creating default profile');
                return await createDefaultProfile(targetUserId);
            }
            throw error;
        }
        
        // Кэшируем результат
        sessionStorage.setItem(cacheKey, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
        
        return data;
        
    } catch (error) {
        console.error('[Auth] Get user profile error:', error);
        return null;
    }
}

/**
 * Создает профиль пользователя по умолчанию.
 * 
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object>} Созданный профиль
 * @private
 */
async function createDefaultProfile(userId) {
    const user = await getCurrentUser();
    
    const defaultProfile = {
        id: userId,
        full_name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Пользователь',
        email: user?.email || '',
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
        .from('profiles')
        .upsert(defaultProfile)
        .select()
        .single();
    
    if (error) {
        console.error('[Auth] Failed to create default profile:', error);
        return defaultProfile;
    }
    
    return data;
}

/**
 * Обновляет профиль пользователя.
 * 
 * @param {string} userId - ID пользователя
 * @param {Object} updates - Поля для обновления
 * @returns {Promise<Object|null>} Обновленный профиль
 */
export async function updateUserProfile(userId, updates) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();
        
        if (error) throw error;
        
        // Очищаем кэш
        const cacheKey = `${PROFILE_CACHE_KEY}_${userId}`;
        sessionStorage.removeItem(cacheKey);
        
        return data;
        
    } catch (error) {
        console.error('[Auth] Update profile error:', error);
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
        
        // Очищаем кэш профиля
        if (data.user) {
            const cacheKey = `${PROFILE_CACHE_KEY}_${data.user.id}`;
            sessionStorage.removeItem(cacheKey);
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
 * Очищает все кэши, сессию и уведомляет приложение.
 * 
 * @param {Object} options - Опции выхода
 * @param {string} [options.redirectTo='/pages/login.html'] - URL для редиректа после выхода
 * @returns {Promise<void>}
 */
export async function logout(options = {}) {
    const { redirectTo = '/pages/login.html' } = options;
    
    console.log('[Auth] Logging out...');
    
    try {
        // Очищаем кэш профиля
        const user = await getCurrentUser();
        if (user) {
            const cacheKey = `${PROFILE_CACHE_KEY}_${user.id}`;
            sessionStorage.removeItem(cacheKey);
        }
        
        // Очищаем URL возврата
        sessionStorage.removeItem(RETURN_URL_KEY);
        
        // Очищаем другие кэши приложения
        clearAppCaches();
        
        // Выходим из Supabase
        await supabase.auth.signOut();
        
        // Отправляем событие о выходе
        window.dispatchEvent(new CustomEvent('auth:logout', {
            detail: { timestamp: Date.now() }
        }));
        
        console.log('[Auth] Logout successful');
        
    } catch (error) {
        console.error('[Auth] Logout error:', error);
    } finally {
        // Редиректим на страницу входа
        window.location.href = redirectTo;
    }
}

/**
 * Очищает все кэши приложения при выходе.
 * 
 * @private
 */
function clearAppCaches() {
    const cacheKeys = [
        'cached_shift',
        'cached_cart',
        'cached_products',
        'cached_stats'
    ];
    
    cacheKeys.forEach(key => {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            // Игнорируем ошибки
        }
    });
    
    console.log('[Auth] Application caches cleared');
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

// ========== ПРОВЕРКА ПРАВ ДОСТУПА ==========

/**
 * Роли пользователей в системе.
 * @enum {string}
 */
export const UserRole = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    CASHIER: 'cashier',
    USER: 'user'
};

/**
 * Проверяет, имеет ли пользователь указанное разрешение.
 * 
 * @param {string} permission - Ключ разрешения (например 'products:create')
 * @returns {Promise<boolean>} true если разрешение есть
 */
export async function hasPermission(permission) {
    const profile = await getUserProfile();
    
    if (!profile) return false;
    
    const role = profile.role || UserRole.USER;
    
    // Администратор имеет все права
    if (role === UserRole.ADMIN) return true;
    
    // Проверяем права роли
    const permissions = getRolePermissions(role);
    return permissions.includes(permission) || permissions.includes('*');
}

/**
 * Проверяет, имеет ли пользователь хотя бы одно из указанных разрешений.
 * 
 * @param {Array<string>} permissions - Массив разрешений
 * @returns {Promise<boolean>} true если есть хотя бы одно
 */
export async function hasAnyPermission(permissions) {
    for (const permission of permissions) {
        if (await hasPermission(permission)) {
            return true;
        }
    }
    return false;
}

/**
 * Проверяет, имеет ли пользователь все указанные разрешения.
 * 
 * @param {Array<string>} permissions - Массив разрешений
 * @returns {Promise<boolean>} true если есть все
 */
export async function hasAllPermissions(permissions) {
    for (const permission of permissions) {
        if (!(await hasPermission(permission))) {
            return false;
        }
    }
    return true;
}

/**
 * Возвращает список разрешений для роли.
 * 
 * @param {string} role - Роль пользователя
 * @returns {Array<string>} Массив разрешений
 * @private
 */
function getRolePermissions(role) {
    const permissionMap = {
        [UserRole.ADMIN]: ['*'],
        [UserRole.MANAGER]: [
            'products:view', 'products:create', 'products:edit', 'products:delete',
            'sales:view', 'sales:create', 'sales:delete',
            'reports:view', 'reports:export',
            'shifts:view', 'shifts:manage'
        ],
        [UserRole.CASHIER]: [
            'products:view',
            'sales:view', 'sales:create',
            'shifts:view', 'shifts:open', 'shifts:close'
        ],
        [UserRole.USER]: [
            'products:view',
            'sales:view'
        ]
    };
    
    return permissionMap[role] || [];
}

// ========== СЛУШАТЕЛИ АУТЕНТИФИКАЦИИ ==========

/**
 * Подписывается на изменения состояния аутентификации.
 * 
 * @param {Function} callback - Функция обратного вызова (event, session)
 * @returns {Object} Объект подписки с методом unsubscribe
 */
export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Auth] State changed:', event);
        
        // При выходе очищаем кэш
        if (event === 'SIGNED_OUT') {
            const cacheKeys = Object.keys(sessionStorage).filter(k => k.startsWith(PROFILE_CACHE_KEY));
            cacheKeys.forEach(k => sessionStorage.removeItem(k));
        }
        
        callback(event, session);
    });
}

/**
 * Проверяет и восстанавливает сессию из URL (для OAuth и подтверждения email).
 * 
 * @returns {Promise<Object|null>} Объект пользователя или null
 */
export async function handleAuthRedirect() {
    try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('[Auth] Redirect handler error:', error);
            return null;
        }
        
        return data.session?.user || null;
        
    } catch (error) {
        console.error('[Auth] Handle redirect error:', error);
        return null;
    }
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    checkAuth,
    requireAuth,
    getCurrentUser,
    getUserProfile,
    updateUserProfile,
    signIn,
    signUp,
    logout,
    saveReturnUrl,
    getReturnUrl,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    onAuthStateChange,
    handleAuthRedirect,
    UserRole
};
