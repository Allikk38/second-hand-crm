/**
 * Permission Manager
 * 
 * Управление правами доступа пользователя.
 * Загружает права из БД и предоставляет методы проверки.
 * 
 * @module PermissionManager
 * @version 2.0.0
 * @changes
 * - Исправлен импорт SupabaseClient
 * - Добавлено кэширование прав в localStorage
 * - Добавлены методы hasAny(), hasAll()
 * - Улучшена обработка ошибок
 */

import { db } from './SupabaseClient.js';
import { EventBus } from './EventBus.js';

const CACHE_KEY = 'user_permissions';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

class PermissionManagerClass {
    constructor() {
        /** @type {Set<string>} */
        this.permissions = new Set();
        this.loaded = false;
        this.userId = null;
    }

    /**
     * Загружает права пользователя из БД или кэша
     * @param {string} userId - ID пользователя
     * @param {boolean} forceRefresh - Принудительно обновить из БД
     * @returns {Promise<void>}
     */
    async loadUserPermissions(userId, forceRefresh = false) {
        if (!userId) {
            console.warn('[PermissionManager] loadUserPermissions: userId is required');
            return;
        }

        this.userId = userId;

        // Пытаемся загрузить из кэша
        if (!forceRefresh) {
            const cached = this.loadFromCache(userId);
            if (cached) {
                this.permissions.clear();
                cached.forEach(p => this.permissions.add(p));
                this.loaded = true;
                console.log('[PermissionManager] Loaded from cache:', Array.from(this.permissions));
                EventBus.emit('permissions:loaded', { source: 'cache' });
                return;
            }
        }

        try {
            // Загружаем профиль пользователя
            const { data: profile, error: profileError } = await db
                .from('profiles')
                .select('role_id')
                .eq('id', userId)
                .single();

            if (profileError) {
                console.error('[PermissionManager] Profile load error:', profileError);
                return;
            }

            if (!profile || !profile.role_id) {
                console.warn('[PermissionManager] No role found for user:', userId);
                this.loaded = true;
                return;
            }

            // Загружаем права роли
            const { data: perms, error: permsError } = await db
                .from('role_permissions')
                .select('permission_id')
                .eq('role_id', profile.role_id);

            if (permsError) {
                console.error('[PermissionManager] Role permissions error:', permsError);
                return;
            }

            if (!perms || perms.length === 0) {
                this.loaded = true;
                this.saveToCache(userId, []);
                return;
            }

            const ids = perms.map(p => p.permission_id);
            
            const { data: permissions, error: permError } = await db
                .from('permissions')
                .select('slug')
                .in('id', ids);

            if (permError) {
                console.error('[PermissionManager] Permissions error:', permError);
                return;
            }

            this.permissions.clear();
            permissions?.forEach(p => {
                if (p.slug) this.permissions.add(p.slug);
            });
            
            this.loaded = true;
            
            // Сохраняем в кэш
            this.saveToCache(userId, Array.from(this.permissions));
            
            console.log('[PermissionManager] Loaded from DB:', Array.from(this.permissions));
            EventBus.emit('permissions:loaded', { source: 'db' });
            
        } catch (error) {
            console.error('[PermissionManager] Load error:', error);
            EventBus.emit('permissions:error', { error });
        }
    }

    /**
     * Сохраняет права в localStorage
     * @private
     */
    saveToCache(userId, permissions) {
        try {
            const cacheData = {
                userId,
                permissions,
                timestamp: Date.now()
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        } catch (error) {
            console.warn('[PermissionManager] Failed to save cache:', error);
        }
    }

    /**
     * Загружает права из localStorage
     * @private
     */
    loadFromCache(userId) {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) return null;
            
            const data = JSON.parse(cached);
            
            // Проверяем валидность кэша
            if (data.userId !== userId) return null;
            if (Date.now() - data.timestamp > CACHE_TTL) return null;
            
            return data.permissions;
        } catch (error) {
            console.warn('[PermissionManager] Failed to load cache:', error);
            return null;
        }
    }

    /**
     * Проверяет, есть ли у пользователя указанное право
     * @param {string} slug - Слаг права (например, 'products:view')
     * @returns {boolean}
     */
    can(slug) {
        if (!this.loaded) {
            console.warn('[PermissionManager] Permissions not loaded yet, returning false for:', slug);
            return false;
        }
        return this.permissions.has(slug);
    }

    /**
     * Проверяет, есть ли у пользователя хотя бы одно из указанных прав
     * @param {string[]} slugs - Массив слагов прав
     * @returns {boolean}
     */
    hasAny(slugs) {
        if (!this.loaded) return false;
        return slugs.some(slug => this.permissions.has(slug));
    }

    /**
     * Проверяет, есть ли у пользователя все указанные права
     * @param {string[]} slugs - Массив слагов прав
     * @returns {boolean}
     */
    hasAll(slugs) {
        if (!this.loaded) return false;
        return slugs.every(slug => this.permissions.has(slug));
    }

    /**
     * Получить все права пользователя
     * @returns {string[]}
     */
    getAll() {
        return Array.from(this.permissions);
    }

    /**
     * Очищает права (при выходе из системы)
     */
    clear() {
        this.permissions.clear();
        this.loaded = false;
        this.userId = null;
        
        try {
            localStorage.removeItem(CACHE_KEY);
        } catch (error) {
            // Игнорируем
        }
        
        EventBus.emit('permissions:cleared');
    }

    /**
     * Проверяет, загружены ли права
     * @returns {boolean}
     */
    isLoaded() {
        return this.loaded;
    }
}

export const PermissionManager = new PermissionManagerClass();
