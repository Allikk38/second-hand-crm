/**
 * Router - Hash-based Routing
 * 
 * Управление маршрутизацией приложения через hash.
 * Поддерживает динамическую загрузку страниц и middleware (права доступа).
 * 
 * @module Router
 * @requires AppState
 * @requires EventBus
 * @requires PermissionManager
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
        this.middlewares.push(middleware);
        return this;
    }
    
    /**
     * Обработчик изменения хэша
     */
    async handleRouteChange() {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const path = hash.startsWith('/') ? hash : `/${hash}`;
        
        await this.navigate(path, { replace: false });
    }
    
    /**
     * Навигация на указанный путь
     */
    async navigate(path, options = { replace: false }) {
        const route = this.routes.get(path);
        
        if (!route) {
            console.warn(`[Router] Route not found: ${path}`);
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
                return this.navigate(result);
            }
        }
        
        // Проверяем права доступа
        if (route.permissions && route.permissions.length > 0) {
            const hasPermission = route.permissions.some(p => PermissionManager.can(p));
            if (!hasPermission) {
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
            if (container && route.loader) {
                const component = await route.loader(container);
                await component.mount();
            }
            EventBus.emit('router:after-load', { route });
        } catch (error) {
            console.error('[Router] Failed to load route:', error);
            EventBus.emit('router:error', { route, error });
        } finally {
            AppState.set('isLoading', false);
        }
    }
    
    /**
     * Запускает роутер
     */
    start() {
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
