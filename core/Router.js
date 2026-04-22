// ========================================
// FILE: ./core/Router.js
// ========================================

/**
 * Router - Hash-based Routing
 * 
 * Управление маршрутизацией приложения через hash.
 * Поддерживает динамическую загрузку страниц и middleware (права доступа).
 * 
 * @module Router
 * @version 3.2.0
 * @changes
 * - Исправлена ошибка зависания флага _navigating при ошибках загрузки.
 * - Добавлен сброс флага в finally блоке.
 * - Улучшена обработка параллельной навигации.
 */

import { AppState } from './AppState.js';
import { EventBus } from './EventBus.js';

// Ленивый импорт PermissionManager (избегаем циклических зависимостей)
let PermissionManager = null;

async function getPermissionManager() {
    if (!PermissionManager) {
        const module = await import('./PermissionManager.js');
        PermissionManager = module.PermissionManager;
    }
    return PermissionManager;
}

class RouterClass {
    constructor() {
        this.routes = new Map();
        this.middlewares = [];
        this.currentRoute = null;
        this.defaultRoute = '/inventory';
        this._navigating = false;
        this._lastNavigateTime = 0;
        this._redirectCount = 0;
        this._pendingNavigation = null;
        
        console.log('[Router] Initialized, default route:', this.defaultRoute);
        
        // Привязываем обработчик hashchange
        window.addEventListener('hashchange', () => this.handleRouteChange());
    }
    
    /**
     * Регистрирует маршрут
     * @param {string} path - Путь (например, '/inventory')
     * @param {Object} config - Конфигурация маршрута
     * @param {string} config.title - Заголовок страницы
     * @param {Function} config.loader - Функция загрузки компонента
     * @param {string[]} config.permissions - Требуемые права
     * @returns {RouterClass} Для цепочки вызовов
     */
    register(path, config) {
        if (!path || !config || !config.title) {
            console.error('[Router] Invalid route registration:', { path, config });
            return this;
        }
        
        console.log('[Router] Registering route:', path, config.title);
        this.routes.set(path, {
            ...config,
            path
        });
        return this;
    }
    
    /**
     * Добавляет middleware для проверки перед загрузкой маршрута
     * @param {Function} middleware - Функция middleware
     * @returns {RouterClass} Для цепочки вызовов
     */
    use(middleware) {
        if (typeof middleware !== 'function') {
            console.error('[Router] Middleware must be a function');
            return this;
        }
        
        console.log('[Router] Adding middleware');
        this.middlewares.push(middleware);
        return this;
    }
    
    /**
     * Обработчик изменения хэша
     */
    async handleRouteChange() {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const path = hash.startsWith('/') ? hash : `/${hash}`;
        
        console.log('[Router] Hash changed, navigating to:', path);
        await this.navigate(path, { replace: false });
    }
    
    /**
     * Навигация на указанный путь
     * @param {string} path - Путь для перехода
     * @param {Object} options - Опции { replace, silent }
     * @returns {Promise<void>}
     */
    async navigate(path, options = { replace: false, silent: false }) {
        // Если уже идет навигация на тот же путь, пропускаем
        if (this._pendingNavigation === path) {
            console.warn('[Router] Navigation to same path already pending:', path);
            return;
        }
        
        // Защита от параллельной навигации
        if (this._navigating) {
            console.warn('[Router] Navigation already in progress, queuing:', path);
            this._pendingNavigation = path;
            return;
        }
        
        // Защита от слишком частой навигации
        const now = Date.now();
        if (now - this._lastNavigateTime < 100) {
            console.warn('[Router] Navigation too frequent, skipping:', path);
            return;
        }
        
        this._navigating = true;
        this._pendingNavigation = path;
        this._lastNavigateTime = now;
        
        try {
            await this._doNavigate(path, options);
        } catch (error) {
            console.error('[Router] Navigation error:', error);
            EventBus.emit('router:error', { error, path });
        } finally {
            this._navigating = false;
            
            // Проверяем, есть ли ожидающая навигация
            const pending = this._pendingNavigation;
            this._pendingNavigation = null;
            
            if (pending && pending !== path) {
                console.log('[Router] Processing pending navigation:', pending);
                setTimeout(() => this.navigate(pending, { replace: false }), 10);
            }
        }
    }
    
    /**
     * Внутренний метод навигации
     * @private
     */
    async _doNavigate(path, options) {
        console.log('[Router] Navigating to:', path);
        
        // Защита от циклических редиректов
        this._redirectCount++;
        if (this._redirectCount > 10) {
            console.error('[Router] Too many redirects, stopping at:', path);
            this._redirectCount = 0;
            EventBus.emit('router:error', { 
                error: new Error('Too many redirects'),
                path 
            });
            return;
        }
        
        const route = this.routes.get(path);
        
        if (!route) {
            console.warn(`[Router] Route not found: ${path}, redirecting to ${this.defaultRoute}`);
            this._redirectCount = 0;
            return this.navigate(this.defaultRoute, { replace: true });
        }
        
        // Проверяем middleware
        for (const middleware of this.middlewares) {
            try {
                const result = await middleware(route, path);
                if (result === false) {
                    console.warn(`[Router] Middleware blocked route: ${path}`);
                    this._redirectCount = 0;
                    return;
                }
                if (typeof result === 'string') {
                    console.log(`[Router] Middleware redirecting to: ${result}`);
                    return this.navigate(result, { replace: true });
                }
            } catch (error) {
                console.error('[Router] Middleware error:', error);
                EventBus.emit('router:error', { error, route, path });
                this._redirectCount = 0;
                return;
            }
        }
        
        // Проверяем права доступа
        if (route.permissions && route.permissions.length > 0) {
            try {
                const permManager = await getPermissionManager();
                const hasPermission = route.permissions.some(p => permManager.can(p));
                
                if (!hasPermission) {
                    console.warn(`[Router] Access denied to ${path}, missing permissions:`, route.permissions);
                    EventBus.emit('router:access-denied', { route, path });
                    this._redirectCount = 0;
                    return;
                }
            } catch (error) {
                console.error('[Router] Permission check error:', error);
                // В случае ошибки проверки прав — не блокируем навигацию
            }
        }
        
        // Обновляем URL если нужно
        const hashPath = path.startsWith('/') ? path.slice(1) : path;
        if (options.replace) {
            window.location.replace(`#${hashPath}`);
        } else if (window.location.hash.slice(1) !== hashPath && !options.silent) {
            window.location.hash = hashPath;
        }
        
        // Обновляем состояние
        this.currentRoute = route;
        AppState.set('currentPage', route.path);
        document.title = `${route.title} | SH CRM`;
        
        // Загружаем страницу
        AppState.set('isLoading', true);
        EventBus.emit('router:before-load', { route, path });
        
        try {
            const container = document.getElementById('page-container');
            console.log('[Router] page-container element:', container ? 'found' : 'NOT FOUND');
            
            if (!container) {
                throw new Error('page-container element not found in DOM');
            }
            
            if (route.loader) {
                console.log('[Router] Calling loader for route:', route.path);
                const component = await route.loader(container);
                console.log('[Router] Loader returned component:', component ? component.constructor.name : 'null');
                
                if (!component) {
                    throw new Error(`Loader for ${route.path} returned null or undefined`);
                }
                
                if (typeof component.mount !== 'function') {
                    throw new Error(`Component for ${route.path} has no mount() method`);
                }
                
                console.log('[Router] Mounting component...');
                await component.mount();
                console.log('[Router] Component mounted successfully');
            } else {
                console.warn('[Router] No loader defined for route:', route.path);
                container.innerHTML = '<div class="empty-state">Страница в разработке</div>';
            }
            
            EventBus.emit('router:after-load', { route, path });
            this._redirectCount = 0;
            
        } catch (error) {
            console.error('[Router] Failed to load route:', error);
            EventBus.emit('router:error', { route, path, error });
            
            // Показываем ошибку в контейнере
            const container = document.getElementById('page-container');
            if (container) {
                container.innerHTML = `
                    <div class="error-state">
                        <div class="error-state-icon">⚠️</div>
                        <h3>Ошибка загрузки страницы</h3>
                        <p>${this.escapeHtml(error.message)}</p>
                        <button class="btn-primary" onclick="location.reload(true)">Обновить</button>
                    </div>
                `;
            }
            
            this._redirectCount = 0;
            throw error; // Пробрасываем ошибку для сброса флага
        } finally {
            AppState.set('isLoading', false);
        }
    }
    
    /**
     * Экранирует HTML спецсимволы
     * @private
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    /**
     * Перейти назад в истории
     */
    back() {
        window.history.back();
    }
    
    /**
     * Перейти вперед в истории
     */
    forward() {
        window.history.forward();
    }
    
    /**
     * Запускает роутер
     */
    start() {
        console.log('[Router] Starting router');
        this.handleRouteChange();
    }
    
    /**
     * Получить текущий маршрут
     * @returns {Object|null}
     */
    getCurrentRoute() {
        return this.currentRoute ? { ...this.currentRoute } : null;
    }
    
    /**
     * Получить все зарегистрированные маршруты
     * @returns {Array}
     */
    getRoutes() {
        return Array.from(this.routes.values()).map(r => ({ ...r }));
    }
    
    /**
     * Проверить, существует ли маршрут
     * @param {string} path
     * @returns {boolean}
     */
    hasRoute(path) {
        return this.routes.has(path);
    }
}

export const Router = new RouterClass();
