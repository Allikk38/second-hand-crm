/**
 * Auth Manager
 * 
 * Управление аутентификацией пользователя.
 * Вход, регистрация, выход, работа с сессией.
 * 
 * @module AuthManager
 * @version 2.0.0
 * @changes
 * - Исправлен импорт SupabaseClient
 * - Добавлен метод updateProfile()
 * - Добавлена обработка ошибок сессии
 * - Добавлен метод refreshSession()
 */

import { db, Auth } from '../../core/SupabaseClient.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { EventBus } from '../../core/EventBus.js';

class AuthManagerClass {
    constructor() {
        this.user = null;
        this.session = null;
        this._initialized = false;
    }

    /**
     * Инициализация: проверяем текущую сессию
     * @returns {Promise<Object|null>}
     */
    async init() {
        try {
            const session = await Auth.getSession();
            this.session = session;
            this.user = session?.user || null;
            
            if (this.user) {
                await PermissionManager.loadUserPermissions(this.user.id);
            }
            
            this._initialized = true;
            EventBus.emit('auth:initialized', { user: this.user });
            
            return this.user;
        } catch (error) {
            console.error('[AuthManager] Init error:', error);
            this._initialized = true;
            return null;
        }
    }

    /**
     * Регистрация нового пользователя
     * @param {string} email - Email
     * @param {string} password - Пароль
     * @param {string} fullName - Полное имя
     * @returns {Promise<Object>}
     */
    async signUp(email, password, fullName) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }
        
        try {
            const result = await Auth.signUp(email, password, {
                full_name: fullName
            });
            
            EventBus.emit('auth:signed-up', { email });
            return result;
        } catch (error) {
            console.error('[AuthManager] SignUp error:', error);
            throw error;
        }
    }

    /**
     * Вход в систему
     * @param {string} email - Email
     * @param {string} password - Пароль
     * @returns {Promise<Object>}
     */
    async signIn(email, password) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }
        
        try {
            const result = await Auth.signIn(email, password);
            this.session = result;
            this.user = result.user;
            
            await PermissionManager.loadUserPermissions(this.user.id);
            
            EventBus.emit('auth:signed-in', { user: this.user });
            return result;
        } catch (error) {
            console.error('[AuthManager] SignIn error:', error);
            throw error;
        }
    }

    /**
     * Выход из системы
     * @returns {Promise<void>}
     */
    async signOut() {
        try {
            await Auth.signOut();
            this.user = null;
            this.session = null;
            PermissionManager.clear();
            
            EventBus.emit('auth:signed-out');
        } catch (error) {
            console.error('[AuthManager] SignOut error:', error);
            throw error;
        }
    }

    /**
     * Обновление профиля пользователя
     * @param {Object} data - Данные для обновления
     * @returns {Promise<Object>}
     */
    async updateProfile(data) {
        if (!this.user) {
            throw new Error('No authenticated user');
        }
        
        try {
            const { error } = await db
                .from('profiles')
                .update({
                    ...data,
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.user.id);
            
            if (error) throw error;
            
            // Обновляем локальные данные
            if (data.full_name) {
                this.user.user_metadata = {
                    ...this.user.user_metadata,
                    full_name: data.full_name
                };
            }
            
            EventBus.emit('auth:profile-updated', { user: this.user });
            return this.user;
        } catch (error) {
            console.error('[AuthManager] UpdateProfile error:', error);
            throw error;
        }
    }

    /**
     * Обновление сессии
     * @returns {Promise<Object|null>}
     */
    async refreshSession() {
        try {
            const session = await Auth.getSession();
            this.session = session;
            this.user = session?.user || null;
            
            if (this.user) {
                await PermissionManager.loadUserPermissions(this.user.id, true);
            }
            
            EventBus.emit('auth:session-refreshed', { user: this.user });
            return this.user;
        } catch (error) {
            console.error('[AuthManager] RefreshSession error:', error);
            return null;
        }
    }

    /**
     * Получить текущего пользователя
     * @returns {Object|null}
     */
    getUser() {
        return this.user ? { ...this.user } : null;
    }

    /**
     * Получить ID текущего пользователя
     * @returns {string|null}
     */
    getUserId() {
        return this.user?.id || null;
    }

    /**
     * Проверить, аутентифицирован ли пользователь
     * @returns {boolean}
     */
    isAuthenticated() {
        return !!this.user;
    }

    /**
     * Проверить, инициализирован ли менеджер
     * @returns {boolean}
     */
    isInitialized() {
        return this._initialized;
    }

    /**
     * Получить токен доступа
     * @returns {string|null}
     */
    getAccessToken() {
        return this.session?.access_token || null;
    }
}

export const AuthManager = new AuthManagerClass();
