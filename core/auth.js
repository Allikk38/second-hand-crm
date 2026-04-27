// ========================================
// FILE: core/auth.js
// ========================================

/**
 * Authentication Module - Локальная версия (SQLite)
 * 
 * Работает полностью автономно, без внешних сервисов.
 * Пользователи хранятся в SQLite.
 * 
 * @module auth
 * @version 5.0.0
 */

import sqlite from './sqlite-client.js';

let currentUser = null;

/**
 * Инициализирует базу данных и проверяет сессию
 */
export async function initAuth() {
    await sqlite.initDatabase();
    
    // Проверяем сохранённую сессию
    const savedUserId = localStorage.getItem('sh_current_user_id');
    if (savedUserId) {
        const user = sqlite.selectOne('SELECT * FROM users WHERE id = ?', [savedUserId]);
        if (user) {
            currentUser = user;
        }
    }
    
    return currentUser;
}

/**
 * Вход по email и паролю
 */
export async function signIn(email, password) {
    const user = sqlite.selectOne(
        'SELECT * FROM users WHERE email = ?',
        [email.trim().toLowerCase()]
    );
    
    if (!user) {
        return { success: false, user: null, error: 'Пользователь не найден' };
    }
    
    // В реальном приложении здесь проверка хеша пароля
    // Сейчас просто проверяем что пароль не пустой
    if (!password || password.length < 3) {
        return { success: false, user: null, error: 'Неверный пароль' };
    }
    
    currentUser = user;
    localStorage.setItem('sh_current_user_id', user.id);
    
    return { success: true, user, error: null };
}

/**
 * Получает текущего пользователя
 */
export function getCurrentUser() {
    if (currentUser) {
        return { user: currentUser, error: null, errorType: null };
    }
    return { user: null, error: null, errorType: null };
}

/**
 * Проверяет авторизацию
 */
export function isAuthenticated() {
    return !!currentUser;
}

/**
 * Требует авторизацию (без редиректа — всё локально)
 */
export function requireAuth() {
    if (currentUser) {
        return { user: currentUser };
    }
    return { user: null, offline: false, authError: false };
}

/**
 * Выход
 */
export function logout() {
    currentUser = null;
    localStorage.removeItem('sh_current_user_id');
    window.location.href = 'pages/login.html';
}

/**
 * Проверка сети (всегда online для локального режима)
 */
export function isOnline() {
    return true;
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
    getReturnUrl
};
