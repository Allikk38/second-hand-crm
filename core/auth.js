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
 * - Динамический импорт supabase-client.js с try/catch для защиты от ошибок парсинга.
 * - Если supabase-client.js повреждён, выбрасывается понятная ошибка.
 * - Клиент создаётся один раз и кэшируется (синглтон).
 * 
 * @module auth
 * @version 4.1.0
 * @changes
 * - Полный переход на локальный supabase-client.js.
 * - Удалена загрузка @supabase/supabase-js с CDN.
 * - Исправлен редирект для GitHub Pages (учёт base href).
 * - Импорт createClient теперь динамический с try/catch.
 * - Добавлена isSupabaseAvailable() для диагностики.
 * - getSupabase() теперь async и может выбросить ошибку с деталями.
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';

// ========== БАЗОВЫЙ ПУТЬ ==========

/**
 * Определяет base URL для приложения.
 * На GitHub Pages это /second-hand-crm/
 * При локальной разработке — просто /
 * 
 * @returns {string} Базовый путь без завершающего слеша
 */
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

/**
 * Загружает модуль supabase-client.js и создаёт клиент.
 * Использует динамический импорт для защиты от ошибок парсинга.
 * 
 * @returns {Promise<Object>} Supabase-клиент
 * @throws {Error} Если модуль не может быть загружен
 */
export async function getSupabase() {
    if (clientInstance) {
        return clientInstance;
    }
    
    if (moduleLoadError) {
        throw moduleLoadError;
    }
    
    try {
        // Динамический импорт с try/catch
        // Если supabase-client.js имеет синтаксическую ошибку,
        // мы поймаем её здесь, а не при загрузке страницы
        const module = await import('./supabase-client.js');
        
        if (typeof module.createClient !== 'function') {
            const error = new Error(
                'supabase-client.js загружен, но не экспортирует createClient. ' +
                'Возможно, файл повреждён или изменена сигнатура экспорта.'
            );
            moduleLoadError = error;
            throw error;
        }
        
        clientInstance = module.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Auth] Supabase client created successfully');
        
        return clientInstance;
        
    } catch (error) {
        // Оборачиваем ошибку с понятным сообщением
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

/**
 * Проверяет, доступен ли модуль supabase-client.
 * Не выбрасывает ошибку.
 * 
 * @returns {Promise<boolean>} true если модуль может быть загружен
 */
export async function isSupabaseAvailable() {
    try {
        await getSupabase();
        return true;
    } catch {
        return false;
    }
}

// ========== ПРОВЕРКИ ==========

/**
 * Проверяет, есть ли подключение к интернету.
 * Использует navigator.onLine.
 * 
 * @returns {boolean}
 */
export function isOnline() {
    return navigator.onLine;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

/**
 * Получает текущего пользователя.
 * 
 * @returns {Promise<{user: Object|null, error: string|null, errorType: string|null}>}
 */
export async function getCurrentUser() {
    if (!isOnline()) {
        return { 
            user: null, 
            error: 'Нет подключения к интернету', 
            errorType: 'network' 
        };
    }
    
    try {
        const supabase = await getSupabase();
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) throw error;
        
        return { user, error: null, errorType: null };
        
    } catch (error) {
        console.error('[Auth] getCurrentUser error:', error);
        
        const errorType = error?.status === 401 ? 'auth' : 'network';
        return { 
            user: null, 
            error: error.message || 'Неизвестная ошибка', 
            errorType 
        };
    }
}

/**
 * Проверяет, аутентифицирован ли пользователь.
 * 
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

/**
 * Требует аутентификацию для доступа к странице.
 * Если пользователь не авторизован — перенаправляет на страницу входа.
 * 
 * @param {Object} options - Опции
 * @param {string} [options.redirectTo='pages/login.html'] - Путь для редиректа
 * @returns {Promise<{user: Object|null, offline?: boolean, authError?: boolean, networkError?: boolean}>}
 */
export async function requireAuth(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    if (!isOnline()) {
        return { user: null, offline: true };
    }
    
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
 * 
 * @param {string} email - Email пользователя
 * @param {string} password - Пароль
 * @returns {Promise<{success: boolean, user: Object|null, error: string|null}>}
 */
export async function signIn(email, password) {
    if (!isOnline()) {
        return { 
            success: false, 
            user: null, 
            error: 'Нет подключения к интернету' 
        };
    }
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({ 
            email, 
            password 
        });
        
        if (error) throw error;
        
        return { success: true, user: data.user, error: null };
        
    } catch (error) {
        console.error('[Auth] signIn error:', error);
        
        let message = 'Ошибка входа';
        
        if (error.code === 'SUPABASE_CLIENT_LOAD_FAILED') {
            message = 'Не удалось загрузить модуль авторизации. Попробуйте обновить страницу.';
        } else if (error.message?.includes('Invalid')) {
            message = 'Неверный email или пароль';
        } else if (error.message?.includes('Failed to fetch')) {
            message = 'Сервер недоступен. Проверьте подключение к интернету.';
        } else if (error.message) {
            message = error.message;
        }
        
        return { success: false, user: null, error: message };
    }
}

// ========== ВЫХОД ==========

/**
 * Выполняет выход из системы.
 * Очищает все локальные данные и перенаправляет на страницу входа.
 * 
 * @param {Object} options - Опции
 * @param {string} [options.redirectTo='pages/login.html'] - Путь для редиректа
 */
export async function logout(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    try {
        // Очищаем локальное хранилище
        localStorage.removeItem('sh_device_id');
        localStorage.removeItem('sb-bhdwniiyrrujeoubrvle-auth-token');
        sessionStorage.clear();
        
        // Пытаемся выйти на сервере если есть сеть
        if (isOnline()) {
            try {
                const supabase = await getSupabase();
                await supabase.auth.signOut();
            } catch {
                // Игнорируем ошибки при выходе
            }
        }
        
        // Сбрасываем экземпляр клиента
        clientInstance = null;
        moduleLoadError = null;
        
    } catch (error) {
        console.error('[Auth] logout error:', error);
    } finally {
        // Всегда перенаправляем на страницу входа
        const basePath = getBasePath();
        const fullPath = redirectTo.startsWith('/') 
            ? `${basePath}${redirectTo}` 
            : `${basePath}/${redirectTo}`;
        
        window.location.href = fullPath;
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ==========

/**
 * Получает URL для возврата после входа.
 * Если URL был сохранён через setReturnUrl, возвращает его.
 * Иначе возвращает URL по умолчанию.
 * 
 * @param {string} [defaultUrl='pages/inventory.html'] - URL по умолчанию
 * @returns {string} Полный URL с учётом base path
 */
export function getReturnUrl(defaultUrl = 'pages/inventory.html') {
    const url = sessionStorage.getItem('sh_auth_return_url');
    if (url) {
        sessionStorage.removeItem('sh_auth_return_url');
        return url;
    }
    const basePath = getBasePath();
    return defaultUrl.startsWith('/') 
        ? `${basePath}${defaultUrl}` 
        : `${basePath}/${defaultUrl}`;
}

/**
 * Сохраняет URL для возврата после входа.
 * Игнорирует URL страницы входа.
 * 
 * @param {string} url - URL для сохранения
 */
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
