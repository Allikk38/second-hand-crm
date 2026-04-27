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
 * - Единый синглтон клиента через window.__supabaseClient.
 * - Автоматический рефреш сессии при ошибках 401.
 * - Экспоненциальный retry при сетевых ошибках.
 * - Отсутствие роутинга — редиректы только через window.location.
 * 
 * @module auth
 * @version 3.5.0
 * @changes
 * - Добавлен автоматический рефреш сессии при ошибках 401
 * - Добавлен retry с экспоненциальной задержкой для сетевых ошибок
 * - Улучшена обработка протухших токенов
 * - Добавлена проверка валидности сессии перед запросами
 * - Добавлено логирование для диагностики проблем соединения
 */

// ========== КОНСТАНТЫ ==========

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000
};

// Состояние загрузки
let loadingPromise = null;
let isLoaded = false;
let sessionCheckPromise = null;

// ========== ЗАГРУЗКА SUPABASE SDK ==========

/**
 * Загружает Supabase SDK динамически
 * @returns {Promise<void>}
 */
function loadSupabaseSDK() {
    if (window.supabase) {
        return Promise.resolve();
    }
    
    if (loadingPromise) {
        return loadingPromise;
    }
    
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

// ========== ПОЛУЧЕНИЕ КЛИЕНТА SUPABASE ==========

/**
 * Получает клиент Supabase.
 * Создаёт клиент один раз после загрузки SDK.
 * Настраивает автоматический рефреш сессии.
 * 
 * @returns {Promise<Object>} Клиент Supabase
 * @throws {Error} Если не удалось загрузить SDK
 */
export async function getSupabase() {
    await loadSupabaseSDK();
    
    if (!window.supabase) {
        throw new Error('Supabase client not available after loading');
    }
    
    if (!window.__supabaseClient) {
        window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: false
            }
        });
        
        // Настраиваем автоматический рефреш при протухании токена
        window.__supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'TOKEN_REFRESHED') {
                console.log('[Auth] Token refreshed automatically');
            }
            if (event === 'SIGNED_OUT') {
                console.log('[Auth] User signed out');
                window.__supabaseClient = null;
            }
        });
    }
    
    return window.__supabaseClient;
}

// ========== RETRY ЛОГИКА ==========

/**
 * Выполняет функцию с автоматическим повтором при ошибках сети
 * @param {Function} fn - Асинхронная функция для выполнения
 * @param {Object} [options] - Опции retry
 * @param {number} [options.maxRetries=3] - Максимальное количество попыток
 * @param {number} [options.baseDelay=1000] - Базовая задержка в мс
 * @returns {Promise<any>} Результат функции
 */
async function withRetry(fn, options = {}) {
    const { maxRetries = RETRY_CONFIG.maxRetries, baseDelay = RETRY_CONFIG.baseDelay } = options;
    
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Не повторяем ошибки аутентификации
            if (error?.status === 401 || error?.status === 403) {
                throw error;
            }
            
            // Не повторяем ошибки валидации (4xx кроме 401/403/429)
            if (error?.status >= 400 && error?.status < 500 && error?.status !== 429) {
                throw error;
            }
            
            // Превышено количество попыток
            if (attempt >= maxRetries) {
                console.error('[Auth] Max retries exceeded:', error.message);
                throw error;
            }
            
            // Экспоненциальная задержка с jitter
            const delay = Math.min(
                baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
                RETRY_CONFIG.maxDelay
            );
            
            console.warn(`[Auth] Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

// ========== ПРОВЕРКА СЕТИ ==========

/**
 * Проверяет наличие интернет-соединения.
 * @returns {boolean}
 */
export function isOnline() {
    return navigator.onLine;
}

// ========== ПРОВЕРКА И РЕФРЕШ СЕССИИ ==========

/**
 * Проверяет валидность текущей сессии и при необходимости рефрешит её
 * @returns {Promise<boolean>} true если сессия валидна
 */
async function ensureValidSession() {
    if (!isOnline()) return false;
    
    try {
        const supabase = await getSupabase();
        
        // Проверяем текущую сессию
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
            console.warn('[Auth] Session check error:', sessionError.message);
            return false;
        }
        
        if (!session) {
            return false;
        }
        
        // Проверяем, не протух ли токен
        const expiresAt = session.expires_at;
        if (expiresAt) {
            const expiresAtDate = new Date(expiresAt * 1000);
            const now = new Date();
            const timeUntilExpiry = expiresAtDate - now;
            
            // Если токен истекает в ближайшие 5 минут — рефрешим
            if (timeUntilExpiry < 5 * 60 * 1000) {
                console.log('[Auth] Token expiring soon, refreshing...');
                const { data: { session: newSession }, error: refreshError } = await supabase.auth.refreshSession();
                
                if (refreshError) {
                    console.warn('[Auth] Token refresh failed:', refreshError.message);
                    return false;
                }
                
                if (newSession) {
                    console.log('[Auth] Token refreshed successfully');
                    return true;
                }
            }
        }
        
        return true;
        
    } catch (error) {
        console.error('[Auth] Session validation error:', error.message);
        return false;
    }
}

// ========== ПОЛУЧЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ==========

/**
 * Получает текущего авторизованного пользователя.
 * Автоматически проверяет и рефрешит сессию при необходимости.
 * 
 * @returns {Promise<{user: Object|null, error: string|null, errorType: string|null}>}
 */
export async function getCurrentUser() {
    if (!isOnline()) {
        return { 
            user: null, 
            error: 'Отсутствует подключение к интернету',
            errorType: 'network'
        };
    }
    
    try {
        const result = await withRetry(async () => {
            // Проверяем валидность сессии
            const isValid = await ensureValidSession();
            if (!isValid) {
                const error = new Error('Session invalid or expired');
                error.status = 401;
                throw error;
            }
            
            const supabase = await getSupabase();
            const { data: { user }, error } = await supabase.auth.getUser();
            
            if (error) {
                // Если ошибка 401 — пробуем рефреш сессии и повторяем
                if (error.status === 401 || error.message?.includes('session')) {
                    console.log('[Auth] Session error, attempting refresh...');
                    const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
                    
                    if (refreshError || !refreshedSession) {
                        error.status = 401;
                        throw error;
                    }
                    
                    // Повторяем запрос с обновлённой сессией
                    const { data: { user: refreshedUser }, error: retryError } = await supabase.auth.getUser();
                    
                    if (retryError) {
                        retryError.status = 401;
                        throw retryError;
                    }
                    
                    return { user: refreshedUser };
                }
                
                throw error;
            }
            
            return { user };
        });
        
        return { 
            user: result.user, 
            error: null, 
            errorType: null 
        };
        
    } catch (error) {
        const errorType = error?.status === 401 || error?.message?.includes('session') 
            ? 'auth' 
            : 'network';
        
        return { 
            user: null, 
            error: error.message || 'Ошибка получения пользователя',
            errorType
        };
    }
}

// ========== БЫСТРАЯ ПРОВЕРКА АВТОРИЗАЦИИ ==========

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
        return { user: null, offline: true };
    }
    
    try {
        const { user, error, errorType } = await getCurrentUser();
        
        if (errorType === 'auth' || (!user && errorType !== 'network')) {
            console.log('[Auth] Invalid session, redirecting to login');
            window.location.href = redirectTo;
            return { user: null, authError: true };
        }
        
        if (errorType === 'network') {
            console.warn('[Auth] Network error, allowing offline mode');
            return { user: null, networkError: true };
        }
        
        return { user };
        
    } catch (error) {
        console.error('[Auth] Require auth error:', error);
        return { user: null, networkError: true };
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
        
        const { data, error } = await withRetry(async () => {
            const result = await supabase.auth.signInWithPassword({ email, password });
            
            if (result.error) {
                throw result.error;
            }
            
            return result;
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
            
            return { success: false, user: null, error: errorMessage };
        }
        
        console.log('[Auth] Sign in successful:', data.user.email);
        return { success: true, user: data.user, error: null };
        
    } catch (error) {
        console.error('[Auth] Unexpected error:', error);
        return {
            success: false,
            user: null,
            error: 'Ошибка соединения с сервером. Проверьте интернет.'
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
            localStorage.removeItem('sh_device_id');
            localStorage.removeItem('sb-bhdwniiyrrujeoubrvle-auth-token');
            sessionStorage.clear();
        } catch (e) {
            // Игнорируем ошибки очистки
        }
        
        if (isOnline()) {
            try {
                const supabase = await getSupabase();
                await supabase.auth.signOut();
                console.log('[Auth] Logout successful (online)');
            } catch (error) {
                console.warn('[Auth] Server logout error (ignored):', error.message);
            }
        } else {
            console.log('[Auth] Logout in offline mode (local only)');
        }
        
        // Сбрасываем клиент
        window.__supabaseClient = null;
        
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
