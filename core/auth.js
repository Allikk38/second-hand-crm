// ========================================
// FILE: core/auth.js
// ========================================

/**
 * Authentication Module - MPA Edition
 * 
 * Использует локальный Supabase клиент без CDN-зависимостей.
 * HTTP/2 только, без QUIC.
 * 
 * @module auth
 * @version 4.0.1
 * @changes
 * - Полный переход на локальный supabase-client.js
 * - Удалена загрузка @supabase/supabase-js с CDN
 * - Исправлен редирект для GitHub Pages (учёт base href)
 */

import { createClient } from './supabase-client.js';

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';

// ========== БАЗОВЫЙ ПУТЬ ==========

/**
 * Определяет base URL для приложения.
 * На GitHub Pages это /second-hand-crm/
 * При локальной разработке — просто /
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

export async function getSupabase() {
    if (!clientInstance) {
        clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return clientInstance;
}

// ========== ПРОВЕРКИ ==========

export function isOnline() {
    return navigator.onLine;
}

// ========== АУТЕНТИФИКАЦИЯ ==========

export async function getCurrentUser() {
    if (!isOnline()) {
        return { user: null, error: 'Нет подключения к интернету', errorType: 'network' };
    }
    
    try {
        const supabase = await getSupabase();
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) throw error;
        
        return { user, error: null, errorType: null };
    } catch (error) {
        const errorType = error?.status === 401 ? 'auth' : 'network';
        return { user: null, error: error.message, errorType };
    }
}

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

export async function requireAuth(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    if (!isOnline()) return { user: null, offline: true };
    
    try {
        const { user, errorType } = await getCurrentUser();
        
        if (errorType === 'auth' || !user) {
            const basePath = getBasePath();
            // Правильный URL: /second-hand-crm/pages/login.html или /pages/login.html
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
    } catch {
        return { user: null, networkError: true };
    }
}

// ========== ВХОД ==========

export async function signIn(email, password) {
    if (!isOnline()) {
        return { success: false, user: null, error: 'Нет подключения к интернету' };
    }
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) throw error;
        
        return { success: true, user: data.user, error: null };
    } catch (error) {
        let message = 'Ошибка входа';
        if (error.message?.includes('Invalid')) message = 'Неверный email или пароль';
        else message = error.message;
        return { success: false, user: null, error: message };
    }
}

// ========== ВЫХОД ==========

export async function logout(options = {}) {
    const { redirectTo = 'pages/login.html' } = options;
    
    try {
        localStorage.removeItem('sh_device_id');
        localStorage.removeItem('sb-bhdwniiyrrujeoubrvle-auth-token');
        sessionStorage.clear();
        
        if (isOnline()) {
            try {
                const supabase = await getSupabase();
                await supabase.auth.signOut();
            } catch {}
        }
        
        clientInstance = null;
    } catch {} finally {
        const basePath = getBasePath();
        const fullPath = redirectTo.startsWith('/') 
            ? `${basePath}${redirectTo}` 
            : `${basePath}/${redirectTo}`;
        
        window.location.href = fullPath;
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ==========

export function getReturnUrl(defaultUrl = 'pages/inventory.html') {
    const url = sessionStorage.getItem('sh_auth_return_url');
    if (url) {
        sessionStorage.removeItem('sh_auth_return_url');
        return url;
    }
    const basePath = getBasePath();
    return defaultUrl.startsWith('/') ? `${basePath}${defaultUrl}` : `${basePath}/${defaultUrl}`;
}

export function setReturnUrl(url) {
    if (url && !url.includes('login.html')) {
        sessionStorage.setItem('sh_auth_return_url', url);
    }
}

// ========== ЭКСПОРТ ==========

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
