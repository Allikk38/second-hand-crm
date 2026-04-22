// ========================================
// FILE: ./main.js
// ========================================

/**
 * Second Hand CRM - Application Entry Point
 * 
 * Точка входа приложения. Инициализирует ядро, регистрирует маршруты
 * и запускает приложение.
 * 
 * Архитектурные решения:
 * - MPA архитектура с кастомным роутером.
 * - Ленивая загрузка модулей.
 * - Централизованное управление состоянием через Store.
 * - Защита маршрутов через PermissionManager.
 * - Офлайн-режим при недоступности бэкенда.
 * 
 * @module main
 * @version 6.0.3
 * @changes
 * - Исправлен импорт модулей страниц: использование module.default вместо именованного экспорта.
 * - Добавлено детальное логирование каждого этапа инициализации для диагностики.
 */

// ========== IMPORTS (Core) ==========
import { AppState } from './core/AppState.js';
import { Router } from './core/Router.js';
import { AppLayout } from './core/AppLayout.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';
import { Store } from './core/Store.js';

// ========== IMPORTS (Services) ==========
import { AuthManager } from './modules/auth/AuthManager.js';
import { LoginForm } from './modules/auth/LoginForm.js';
import { Notification } from './modules/common/Notification.js';
import { createLogger } from './utils/logger.js';

// ========== CONSTANTS ==========
const LOAD_TIMEOUT = 15000;
const CACHE_BUST = `v=${Date.now()}`;
const logger = createLogger('App');

// ========== APPLICATION CLASS ==========
class Application {
    constructor() {
        this.root = document.getElementById('app-root');
        this.layout = null;
        this.isAuthenticated = false;
        this.loadTimer = null;
        this.initStarted = false;
        
        logger.info('Application instance created');
    }
    
    /**
     * Инициализация приложения
     */
    async init() {
        if (this.initStarted) {
            logger.warn('Init already started, skipping');
            return;
        }
        this.initStarted = true;
        
        logger.group('🚀 Application Initialization', () => {
            logger.info('Environment:', window.location.hostname);
            logger.info('Cache bust key:', CACHE_BUST);
        });
        
        this.hideInitialLoader();
        
        // Включаем отладку Store только в development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            logger.debug('Enabling Store debug mode');
            Store.enableDebug();
        }
        
        this.setLoadTimeout();
        
        try {
            logger.time('🔐 Auth Initialization');
            const user = await this.initAuthWithTimeout();
            logger.timeEnd('🔐 Auth Initialization');
            
            if (user) {
                logger.info('✅ User authenticated:', { id: user.id, email: user.email });
                this.isAuthenticated = true;
                AppState.set('user', user);
                
                // Права загружаем асинхронно, не блокируем запуск
                logger.debug('Loading permissions in background');
                PermissionManager.loadUserPermissions(user.id).catch(err => {
                    logger.warn('Permissions load failed:', err);
                });
                
                logger.time('🖥️ Start Authenticated App');
                await this.startAuthenticatedApp();
                logger.timeEnd('🖥️ Start Authenticated App');
            } else {
                logger.info('ℹ️ No active session, showing login page');
                this.showLoginPage();
            }
            
            this.setupGlobalEvents();
            this.clearLoadTimeout();
            
            logger.info('🎉 Application initialization completed successfully');
            
        } catch (error) {
            logger.error('❌ Fatal initialization error:', error);
            this.clearLoadTimeout();
            
            if (error.message.includes('timeout') || error.message.includes('network') || error.message.includes('fetch')) {
                logger.warn('Network error detected, showing offline login');
                this.showOfflineLogin();
            } else {
                this.handleInitError(error);
            }
        }
    }
    
    /**
     * Инициализация аутентификации с таймаутом
     */
    async initAuthWithTimeout() {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Auth initialization timeout')), 8000);
        });
        
        try {
            logger.debug('Calling AuthManager.init()');
            return await Promise.race([AuthManager.init(), timeoutPromise]);
        } catch (error) {
            logger.warn('Auth init failed:', error.message);
            
            const cachedUser = this.getCachedUser();
            if (cachedUser) {
                logger.info('Using cached user data from localStorage');
                return cachedUser;
            }
            
            return null;
        }
    }
    
    /**
     * Получает кэшированного пользователя
     */
    getCachedUser() {
        try {
            const stored = localStorage.getItem('supabase.auth.token');
            if (!stored) return null;
            
            const parsed = JSON.parse(stored);
            if (parsed?.currentSession?.user) {
                return parsed.currentSession.user;
            }
        } catch (e) {
            logger.warn('Failed to parse cached user');
        }
        return null;
    }
    
    /**
     * Скрывает начальный лоадер
     */
    hideInitialLoader() {
        const loader = document.getElementById('initial-loader');
        if (loader) {
            loader.style.display = 'none';
            logger.debug('Initial loader hidden');
        }
    }
    
    /**
     * Устанавливает таймаут загрузки
     */
    setLoadTimeout() {
        this.loadTimer = setTimeout(() => {
            logger.error('❌ Load timeout reached! Forcing UI display.');
            
            const loader = document.getElementById('initial-loader');
            if (loader) loader.style.display = 'none';
            
            if (!this.isAuthenticated) {
                this.showOfflineLogin();
            } else {
                this.startAuthenticatedApp().catch(err => {
                    logger.error('Force start failed:', err);
                    this.showLoginPage();
                });
            }
        }, LOAD_TIMEOUT);
    }
    
    /**
     * Очищает таймаут загрузки
     */
    clearLoadTimeout() {
        if (this.loadTimer) {
            clearTimeout(this.loadTimer);
            this.loadTimer = null;
            logger.debug('Load timeout cleared');
        }
    }
    
    /**
     * Обработка ошибки инициализации
     */
    handleInitError(error) {
        logger.error('Handling init error:', error);
        this.showNetworkError();
    }
    
    /**
     * Показывает ошибку сети
     */
    showNetworkError() {
        logger.warn('Displaying network error screen');
        this.root.innerHTML = `
            <div class="error-state" style="padding: 40px; text-align: center;">
                <div class="error-state-icon">🌐</div>
                <h3>Нет подключения к серверу</h3>
                <p>Проверьте подключение к интернету или попробуйте позже</p>
                <button class="btn-primary" onclick="location.reload()">Обновить</button>
                <button class="btn-secondary" onclick="localStorage.clear();location.reload()" style="margin-left: 10px;">
                    Очистить кэш
                </button>
            </div>
        `;
    }
    
    /**
     * Показывает офлайн-логин
     */
    showOfflineLogin() {
        logger.info('Showing offline login');
        Notification.warning('Проблемы с подключением к серверу. Работа в офлайн-режиме.');
        this.showLoginPage();
    }
    
    /**
     * Запускает приложение для аутентифицированного пользователя
     */
    async startAuthenticatedApp() {
        logger.group('🖥️ Starting Authenticated App', () => {
            logger.debug('User is authenticated');
        });
        
        try {
            logger.time('Layout Creation');
            this.layout = new AppLayout(this.root);
            this.layout.render();
            logger.timeEnd('Layout Creation');
            
            logger.time('Routes Registration');
            this.registerRoutes();
            logger.timeEnd('Routes Registration');
            
            Router.use(async (route) => {
                if (!this.isAuthenticated) {
                    logger.warn(`Route ${route.path} requires auth, redirecting to /login`);
                    return '/login';
                }
                return true;
            });
            
            logger.time('Router Start');
            Router.start();
            logger.timeEnd('Router Start');
            
            AppState.set('isInitialized', true);
            
            logger.info('✅ Authenticated app started successfully');
        } catch (error) {
            logger.error('❌ Failed to start authenticated app:', error);
            throw error;
        }
    }
    
    /**
     * Регистрирует все маршруты приложения
     */
    registerRoutes() {
        logger.info('Registering application routes...');
        
        // Страница склада
        Router.register('/inventory', {
            title: 'Склад',
            loader: async (container) => {
                logger.group('📦 Loading InventoryPage', async () => {
                    logger.debug('Container ready:', !!container);
                    try {
                        const start = performance.now();
                        const module = await import(`./modules/inventory/InventoryPage.js?${CACHE_BUST}`);
                        const InventoryPage = module.default;
                        logger.debug(`Module loaded in ${(performance.now() - start).toFixed(0)}ms`);
                        return new InventoryPage(container);
                    } catch (error) {
                        logger.error('Failed to load InventoryPage:', error);
                        throw error;
                    }
                });
            },
            permissions: ['products:view', 'products:create', 'products:edit', 'products:delete']
        });
        
        // Страница кассы
        Router.register('/cashier', {
            title: 'Касса',
            loader: async (container) => {
                logger.group('💰 Loading CashierPage', async () => {
                    logger.debug('Container ready:', !!container);
                    try {
                        const start = performance.now();
                        const module = await import(`./modules/cashier/CashierPage.js?${CACHE_BUST}`);
                        const CashierPage = module.default;
                        logger.debug(`Module loaded in ${(performance.now() - start).toFixed(0)}ms`);
                        return new CashierPage(container);
                    } catch (error) {
                        logger.error('Failed to load CashierPage:', error);
                        throw error;
                    }
                });
            },
            permissions: ['sales:view', 'sales:create', 'sales:delete', 'sales:edit']
        });
        
        // Страница отчетов
        Router.register('/reports', {
            title: 'Отчеты',
            loader: async (container) => {
                logger.group('📊 Loading ReportsPage', async () => {
                    logger.debug('Container ready:', !!container);
                    try {
                        const start = performance.now();
                        const module = await import(`./modules/reports/ReportsPage.js?${CACHE_BUST}`);
                        const ReportsPage = module.default;
                        logger.debug(`Module loaded in ${(performance.now() - start).toFixed(0)}ms`);
                        return new ReportsPage(container);
                    } catch (error) {
                        logger.error('Failed to load ReportsPage:', error);
                        throw error;
                    }
                });
            },
            permissions: ['reports:view', 'reports:export']
        });
        
        // Редирект с корня
        Router.register('/', {
            title: 'Склад',
            loader: async () => {
                logger.debug('Root route accessed, redirecting to /inventory');
                Router.navigate('/inventory');
                return null;
            }
        });
        
        // Страница входа
        Router.register('/login', {
            title: 'Вход',
            loader: async (container) => {
                logger.debug('Rendering LoginForm');
                new LoginForm(container).render();
                return null;
            }
        });
        
        logger.info(`Registered ${Router.getRoutes().length} routes`);
    }
    
    /**
     * Настраивает глобальные события
     */
    setupGlobalEvents() {
        logger.debug('Setting up global events');
        
        EventBus.on('auth:logout', () => this.handleLogout());
        
        EventBus.on('router:access-denied', ({ route }) => {
            logger.warn(`Access denied to ${route.path}`);
            Notification.warning('У вас нет доступа к этому разделу');
        });
        
        EventBus.on('router:error', ({ error, path }) => {
            logger.error(`Route error for ${path}:`, error);
            
            const container = this.layout?.getPageContainer();
            if (container) {
                container.innerHTML = `
                    <div class="error-state">
                        <div class="error-state-icon">⚠️</div>
                        <h3>Ошибка загрузки страницы</h3>
                        <p>${this.escapeHtml(error?.message || 'Неизвестная ошибка')}</p>
                        <details style="margin-top: 16px; text-align: left;">
                            <summary>Техническая информация</summary>
                            <pre style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; overflow: auto; font-size: 12px;">${this.escapeHtml(error?.stack || 'No stack trace')}</pre>
                        </details>
                        <button class="btn-primary" onclick="location.reload(true)">Обновить</button>
                        <button class="btn-secondary" onclick="window.location.hash = '/inventory'">На склад</button>
                    </div>
                `;
            }
        });
        
        window.addEventListener('online', () => {
            logger.info('Network connection restored');
            Notification.info('Соединение восстановлено');
            this.refreshCurrentPage();
        });
        
        window.addEventListener('offline', () => {
            logger.warn('Network connection lost');
            Notification.warning('Потеряно соединение с интернетом');
        });
    }
    
    /**
     * Обновляет текущую страницу
     */
    async refreshCurrentPage() {
        const currentPath = window.location.hash.slice(1) || '/inventory';
        logger.debug(`Refreshing current page: ${currentPath}`);
        await Router.navigate(currentPath, { replace: true });
    }
    
    /**
     * Обработчик выхода из системы
     */
    async handleLogout() {
        logger.info('Handling logout');
        try {
            await AuthManager.signOut();
        } catch (error) {
            logger.warn('SignOut error:', error);
        } finally {
            this.isAuthenticated = false;
            AppState.reset();
            PermissionManager.clear();
            Store.resetAll();
            
            window.location.hash = '';
            this.showLoginPage();
            
            Notification.info('Вы вышли из системы');
        }
    }
    
    /**
     * Показывает страницу входа
     */
    showLoginPage() {
        logger.info('Showing login page');
        this.root.innerHTML = '';
        
        if (!navigator.onLine) {
            const banner = document.createElement('div');
            banner.style.cssText = 'background: #fef3c7; color: #92400e; padding: 12px; text-align: center; font-size: 14px;';
            banner.textContent = '⚠️ Нет подключения к интернету. Работа в офлайн-режиме.';
            this.root.appendChild(banner);
        }
        
        const loginContainer = document.createElement('div');
        loginContainer.id = 'login-container';
        this.root.appendChild(loginContainer);
        
        new LoginForm(loginContainer).render();
    }
    
    /**
     * Экранирует HTML спецсимволы
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// ========== START APPLICATION ==========
document.addEventListener('DOMContentLoaded', async () => {
    logger.info('📄 DOMContentLoaded event fired');
    const app = new Application();
    await app.init();
});

// Экспортируем для отладки
export { Application };
