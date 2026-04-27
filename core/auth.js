// ========================================
// FILE: core/auth.js
// ========================================

/**
 * Authentication Module — официальный Supabase SDK
 * 
 * Использует @supabase/supabase-js через ES-модули.
 * Больше никакого самописного HTTP-клиента и прокси.
 * 
 * @module auth
 * @version 8.0.0
 * @changes
 * - v8.0.0: Прямой импорт supabase из supabase-client.js (ES-модули).
 * - v7.0.0: Переход на официальный Supabase SDK
 */

import { supabase } from './supabase-client.js';

let currentUser = null;

const log = (msg, data) => console.log(`[Auth] ${msg}`, data || '');
const logError = (msg, err) => console.error(`[Auth] ${msg}`, err?.message || err);

/**
 * Инициализирует модуль и проверяет сессию
 */
export async function initAuth() {
    log('InitAuth started...');
    
    try {
        const { data, error } = await supabase.auth.getUser();
        
        if (error) {
            logError('InitAuth error', error);
            if (error.status === 401 || error.code === 'unexpected_failure') {
                log('No valid session found, trying to refresh...');
                try {
                    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                    if (refreshError) throw refreshError;
                    if (refreshData?.user) {
                        currentUser = refreshData.user;
                        log('Session refreshed successfully');
                    }
                } catch (refreshError) {
                    logError('Session refresh failed', refreshError);
                }
            }
            return null;
        }
        
        if (data?.user) {
            currentUser = data.user;
            log('User session found:', data.user.email);
        }
    } catch (err) {
        logError('InitAuth failed', err);
    }
    
    return currentUser;
}

/**
 * Возвращает экземпляр Supabase-клиента.
 * Используется другими модулями для прямых запросов к БД.
 * 
 * @returns {Object} Supabase-клиент
 */
export function getSupabase() {
    return supabase;
}

/**
 * Вход по email и паролю
 */
export async function signIn(email, password) {
    log(`SignIn attempt: ${email}`);
    const startTime = Date.now();
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password
        });
        
        if (error) throw error;
        
        if (data?.user) {
            currentUser = data.user;
            log(`SignIn success in ${Date.now() - startTime}ms`);
            return { success: true, user: currentUser, error: null };
        }
        
        throw new Error('No user returned from Supabase');
        
    } catch (error) {
        logError('SignIn failed', error);
        return {
            success: false,
            user: null,
            error: error.message || 'Ошибка входа'
        };
    }
}

/**
 * Получает текущего пользователя
 */
export function getCurrentUser() {
    if (currentUser) {
        return { user: currentUser, error: null, errorType: null };
    }
    
    // Если нет в памяти, пробуем проверить сессию асинхронно
    supabase.auth.getUser().then(({ data }) => {
        if (data?.user) {
            currentUser = data.user;
        }
    }).catch(() => {});
    
    return {
        user: currentUser,
        error: currentUser ? null : 'No session',
        errorType: currentUser ? null : 'auth'
    };
}

/**
 * Проверяет авторизацию
 */
export function isAuthenticated() {
    return !!currentUser;
}

/**
 * Требует авторизацию, иначе показывает ошибку.
 * Асинхронно проверяет сессию если currentUser не в памяти.
 */
export async function requireAuth() {
    if (currentUser) {
        return { user: currentUser, offline: false, authError: false };
    }
    
    try {
        const { data, error } = await supabase.auth.getSession();
        
        if (data?.session) {
            log('Found session in storage, loading user...');
            try {
                const { data: userData } = await supabase.auth.getUser();
                if (userData?.user) {
                    currentUser = userData.user;
                    return { user: currentUser, offline: false, authError: false };
                }
            } catch (userError) {
                logError('Failed to get user from session', userError);
            }
            return { user: null, offline: false, authError: true };
        }
    } catch (sessionError) {
        logError('Failed to get session', sessionError);
    }
    
    return { user: null, offline: !navigator.onLine, authError: true };
}

/**
 * Выход
 */
export async function logout() {
    log('Logging out...');
    currentUser = null;
    try {
        await supabase.auth.signOut();
        log('SignOut completed');
    } catch (err) {
        logError('SignOut error', err);
    }
    
    window.location.href = 'pages/login.html';
}

/**
 * Проверка сети
 */
export function isOnline() {
    return navigator.onLine;
}

/**
 * URL для возврата
 */
export function getReturnUrl(path = 'pages/inventory.html') {
    return path;
}

export default {
    initAuth,
    signIn,
    getCurrentUser,
    isAuthenticated,
    requireAuth,
    logout,
    isOnline,
    getReturnUrl,
    getSupabase
};

console.log('[Auth] Module loaded (Supabase SDK ES Modules)');