/**
 * Router - Hash-based Routing
 * 
 * Управление маршрутизацией приложения через hash.
 * Поддерживает динамическую загрузку страниц и middleware (права доступа).
 * 
 * @module Router
 * @version 3.0.1
 * @changes
 * - Добавлены отладочные логи и обработка случая, когда loader возвращает null.
 * - Улучшена обработка ошибок при загрузке страницы.
 */

import { AppState } from './AppState.js';
import { EventBus } from './EventBus.js';
import { PermissionManager } from './PermissionManager.js';

class RouterClass {
    constructor() {
        this.routes = new Map();
        this.middlewares = [];
        this.currentRoute = null;
        this.defaultRoute = '/inventory';
        
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
     */
    register(path, config) {
        console.log('[Router] Registering route:', path, config.title);
        this.routes.set(path, {
            ...config,
            path
        });
        return this;
    }
    
    /**
     * Добавляет middleware для проверки перед загрузкой маршрута
     */
    use(middleware) {
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
     */
    async navigate(path, options = { replace: false }) {
        console.log('[Router] navigate() called with path:', path);
        
        const route = this.routes.get(path);
        
        if (!route) {
            console.warn(`[Router] Route not found: ${path}, redirecting to ${this.defaultRoute}`);
            return this.navigate(this.defaultRoute);
        }
        
        // Проверяем middleware
        for (const middleware of this.middlewares) {
            const result = await middleware(route);
            if (result === false) {
                console.warn(`[Router] Middleware blocked route: ${path}`);
                return;
            }
            if (typeof result === 'string') {
                console.log(`[Router] Middleware redirecting to: ${result}`);
                return this.navigate(result);
            }
        }
        
        // Проверяем права доступа
        if (route.permissions && route.permissions.length > 0) {
            const hasPermission = route.permissions.some(p => PermissionManager.can(p));
            if (!hasPermission) {
                console.warn(`[Router] Access denied to ${path}, missing permissions:`, route.permissions);
                EventBus.emit('router:access-denied', { route, path });
                return;
            }
        }
        
        // Обновляем URL если нужно
        const hashPath = path.startsWith('/') ? path.slice(1) : path;
        if (options.replace) {
            window.location.replace(`#${hashPath}`);
        } else if (window.location.hash.slice(1) !== hashPath) {
            window.location.hash = hashPath;
        }
        
        // Обновляем состояние
        this.currentRoute = route;
        AppState.set('currentPage', route.path);
        document.title = `${route.title} | SH CRM`;
        
        // Загружаем страницу
        AppState.set('isLoading', true);
        EventBus.emit('router:before-load', { route });
        
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
                
                console.log('[Router] Mounting component...');
                await component.mount();
                console.log('[Router] Component mounted successfully');
            } else {
                console.warn('[Router] No loader defined for route:', route.path);
            }
            
            EventBus.emit('router:after-load', { route });
        } catch (error) {
            console.error('[Router] Failed to load route:', error);
            EventBus.emit('router:error', { route, error });
            
            // Показываем ошибку в контейнере
            const container = document.getElementById('page-container');
            if (container) {
                container.innerHTML = `
                    <div class="error-state" style="padding: 40px; text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;">⚠️</div>
                        <h3 style="margin-bottom: 12px; color: var(--color-text);">Ошибка загрузки страницы</h3>
                        <p style="color: var(--color-text-secondary); margin-bottom: 8px;">${error.message}</p>
                        <button class="btn-primary" onclick="location.reload()" style="margin-top: 16px;">Обновить</button>
                    </div>
                `;
            }
        } finally {
            AppState.set('isLoading', false);
        }
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
     */
    getCurrentRoute() {
        return this.currentRoute;
    }
    
    /**
     * Получить все зарегистрированные маршруты
     */
    getRoutes() {
        return Array.from(this.routes.values());
    }
}

export const Router = new RouterClass();
