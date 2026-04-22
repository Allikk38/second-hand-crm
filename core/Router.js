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
 * @version 3.2.1
 * @changes
 * - Интегрирован централизованный логгер.
 * - Добавлены замеры времени выполнения loader'ов.
 * - Улучшена обработка и отображение ошибок с выводом полного стека.
 */

import { AppState } from './AppState.js';
import { EventBus } from './EventBus.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Router');

// Ленивый импорт PermissionManager (избегаем циклических зависимостей)
let PermissionManager = null;

async function getPermissionManager() {
    if (!PermissionManager) {
        logger.debug('Lazy loading PermissionManager');
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
        
        logger.info('Router initialized', { defaultRoute: this.defaultRoute });
        
        // Привязываем обработчик hashchange
        window.addEventListener('hashchange', () => this.handleRouteChange());
    }
    
    /**
     * Регистрирует маршрут
     * @param {string} path - Путь (например, '/inventory')
     * @param {Object} config - Конфигурация маршрута
     * @returns {RouterClass} Для цепочки вызовов
     */
    register(path, config) {
        if (!path || !config || !config.title) {
            logger.error('Invalid route registration', { path, config });
            return this;
        }
        
        logger.debug('Registering route', { path, title: config.title });
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
            logger.error('Middleware must be a function');
            return this;
        }
        
        logger.debug('Adding middleware');
        this.middlewares.push(middleware);
        return this;
    }
    
    /**
     * Обработчик изменения хэша
     */
    async handleRouteChange() {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const path = hash.startsWith('/') ? hash : `/${hash}`;
        
        logger.debug('Hash changed', { hash, path });
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
            logger.warn('Navigation to same path already pending', { path });
            return;
        }
        
        // Защита от параллельной навигации
        if (this._navigating) {
            logger.warn('Navigation already in progress, queuing', { path });
            this._pendingNavigation = path;
            return;
        }
        
        // Защита от слишком частой навигации
        const now = Date.now();
        if (now - this._lastNavigateTime < 100) {
            logger.warn('Navigation too frequent, skipping', { path });
            return;
        }
        
        this._navigating = true;
        this._pendingNavigation = path;
        this._lastNavigateTime = now;
        
        logger.time(`⏳ Navigation to ${path}`);
        
        try {
            await this._doNavigate(path, options);
        } catch (error) {
            logger.error('Navigation error', { error: error.message, stack: error.stack, path });
            EventBus.emit('router:error', { error, path });
        } finally {
            logger.timeEnd(`⏳ Navigation to ${path}`);
            this._navigating = false;
            
            // Проверяем, есть ли ожидающая навигация
            const pending = this._pendingNavigation;
            this._pendingNavigation = null;
            
            if (pending && pending !== path) {
                logger.debug('Processing pending navigation', { pending });
                setTimeout(() => this.navigate(pending, { replace: false }), 10);
            }
        }
    }
    
    /**
     * Внутренний метод навигации
     * @private
     */
    async _doNavigate(path, options) {
        logger.info(`Navigating to: ${path}`, { options });
        
        // Защита от циклических редиректов
        this._redirectCount++;
        if (this._redirectCount > 10) {
            logger.error('Too many redirects, stopping', { path });
            this._redirectCount = 0;
            EventBus.emit('router:error', { 
                error: new Error('Too many redirects'),
                path 
            });
            return;
        }
        
        const route = this.routes.get(path);
        
        if (!route) {
            logger.warn(`Route not found: ${path}, redirecting to ${this.defaultRoute}`);
            this._redirectCount = 0;
            return this.navigate(this.defaultRoute, { replace: true });
        }
        
        // Проверяем middleware
        logger.debug('Running middlewares');
        for (const middleware of this.middlewares) {
            try {
                const result = await middleware(route, path);
                if (result === false) {
                    logger.warn(`Middleware blocked route: ${path}`);
                    this._redirectCount = 0;
                    return;
                }
                if (typeof result === 'string') {
                    logger.info(`Middleware redirecting to: ${result}`);
                    return this.navigate(result, { replace: true });
                }
            } catch (error) {
                logger.error('Middleware error', { error: error.message, route, path });
                EventBus.emit('router:error', { error, route, path });
                this._redirectCount = 0;
                return;
            }
        }
        
        // Проверяем права доступа
        if (route.permissions && route.permissions.length > 0) {
            logger.debug('Checking permissions', { permissions: route.permissions });
            try {
                const permManager = await getPermissionManager();
                const hasPermission = route.permissions.some(p => permManager.can(p));
                
                if (!hasPermission) {
                    logger.warn(`Access denied to ${path}`, { permissions: route.permissions });
                    EventBus.emit('router:access-denied', { route, path });
                    this._redirectCount = 0;
                    return;
                }
            } catch (error) {
                logger.error('Permission check error', { error: error.message });
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
            
            if (!container) {
                throw new Error('page-container element not found in DOM');
            }
            
            if (route.loader) {
                logger.debug(`Executing loader for ${route.path}`);
                
                logger.time(`🖥️ Loader execution for ${route.path}`);
                const component = await route.loader(container);
                logger.timeEnd(`🖥️ Loader execution for ${route.path}`);
                
                if (!component) {
                    throw new Error(`Loader for ${route.path} returned null or undefined`);
                }
                
                if (typeof component.mount !== 'function') {
                    throw new Error(`Component for ${route.path} has no mount() method`);
                }
                
                logger.debug(`Mounting component for ${route.path}`);
                logger.time(`🧩 Mount component ${route.path}`);
                await component.mount();
                logger.timeEnd(`🧩 Mount component ${route.path}`);
                
                logger.info(`✅ Route loaded successfully: ${route.path}`);
            } else {
                logger.warn(`No loader defined for route: ${route.path}`);
                container.innerHTML = '<div class="empty-state">Страница в разработке</div>';
            }
            
            EventBus.emit('router:after-load', { route, path });
            this._redirectCount = 0;
            
        } catch (error) {
            logger.error('Failed to load route', { route: route.path, error: error.message, stack: error.stack });
            EventBus.emit('router:error', { route, path, error });
            
            // Показываем ошибку в контейнере
            const container = document.getElementById('page-container');
            if (container) {
                container.innerHTML = `
                    <div class="error-state">
                        <div class="error-state-icon">⚠️</div>
                        <h3>Ошибка загрузки страницы</h3>
                        <p>${this.escapeHtml(error.message)}</p>
                        <details style="margin-top: 16px; text-align: left;">
                            <summary>Техническая информация</summary>
                            <pre style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; overflow: auto; font-size: 12px;">${this.escapeHtml(error.stack || 'No stack trace')}</pre>
                        </details>
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
        logger.info('Router starting');
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
