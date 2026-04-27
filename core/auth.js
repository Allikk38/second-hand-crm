// ========================================
// FILE: core/auth.js
// ========================================

/**
 * Authentication Module - Версия Supabase
 * 
 * Восстановленная работа с Supabase Auth.
 * Использует нативный supabase-client.js для HTTP-запросов.
 * 
 * @module auth
 * @version 6.0.1
 * @changes
 * - v6.0.1: Добавлен экспорт getSupabase() для использования в других модулях
 */

import { createClient } from './supabase-client.js';
const supabaseClient = createClient(
    'https://bhdwniiyrrujeoubrvle.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM'
);

let currentUser = null;

const log = (msg, data) => console.log(`[Auth] ${msg}`, data || '');
const logError = (msg, err) => console.error(`[Auth] ${msg}`, err?.message || err);

/**
 * Инициализирует модуль и проверяет сессию
 */
export async function initAuth() {
    log('InitAuth started...');
    
    const { error } = await supabaseClient.auth.getUser();
    
    if (error) {
        logError('InitAuth error', error);
        if (error.status === 401) {
            log('No valid session found, trying to refresh...');
            try {
                await supabaseClient.auth.refreshSession();
                const { data } = await supabaseClient.auth.getUser();
                if (data?.user) {
                    currentUser = data.user;
                    log('Session refreshed successfully');
                }
            } catch (refreshError) {
                logError('Session refresh failed', refreshError);
                // Пользователю нужно будет войти заново
            }
        }
        return null;
    }
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        currentUser = user;
        log('User session found:', user.email);
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
    return supabaseClient;
}

/**
 * Вход по email и паролю
 */
export async function signIn(email, password) {
    log(`SignIn attempt: ${email}`);
    const startTime = Date.now();
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
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
    
    // Если нет в памяти, пробуем проверить сессию
    // Это асинхронно, но для старых вызовов возвращаем офлайн-статус
    supabaseClient.auth.getUser().then(({ data }) => {
        if (data?.user) {
            currentUser = data.user;
        }
    });
    
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
 * Требует авторизацию, иначе показывает ошибку
 */
export function requireAuth() {
    if (currentUser) {
        return { user: currentUser, offline: false, authError: false };
    }
    
    // Проверяем наличие токена в localStorage (даже если currentUser сброшен)
    const session = supabaseClient.auth.getSession();
    if (session?.data?.session) {
        log('Found session in storage but user not loaded, attempting refresh');
        supabaseClient.auth.getUser().then(({ data }) => {
            if (data?.user) currentUser = data.user;
        });
        return { user: null, offline: false, authError: true };
    }
    
    return { user: null, offline: !navigator.onLine, authError: true };
}

/**
 * Выход
 */
export function logout() {
    log('Logging out...');
    currentUser = null;
    supabaseClient.auth.signOut()
        .then(() => log('SignOut completed'))
        .catch(err => logError('SignOut error', err));
    
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
export function getReturnUrl() {
    return 'pages/inventory.html';
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

console.log('[Auth] Module loaded (Supabase Version)');
