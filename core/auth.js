// ========================================
// FILE: ./core/auth.js
// ========================================

/**
 * Auth Utilities - Проверка сессии и редиректы
 * 
 * @module auth
 * @version 1.0.0
 */

import { supabase } from './supabase.js';

/**
 * Проверяет сессию и редиректит на логин если не авторизован.
 * Вызывать в начале каждой защищенной страницы.
 */
export async function requireAuth() {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
        console.log('[Auth] No session, redirecting to login');
        window.location.href = 'login.html';
        return null;
    }
    
    return session.user;
}

/**
 * Проверяет, авторизован ли пользователь (без редиректа).
 */
export async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user || null;
}

/**
 * Выход из системы.
 */
export async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
}

/**
 * Получить текущего пользователя.
 */
export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}
