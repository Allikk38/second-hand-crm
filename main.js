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
 * 
 * @module main
 * @version 6.0.0
 * @changes
 * - Обновлены пути к компонентам после рефакторинга.
 * - Обновлена версия cache-busting.
 * - Упрощена регистрация маршрутов.
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

// ========== CONSTANTS ==========
const LOAD_TIMEOUT = 10000;
const RETRY_DELAY = 3000;
const CACHE_BUST = 'v=6.0.0';

// ========== APPLICATION CLASS ==========
class Application {
    constructor() {
        this.root = document.getElementById('app-root');
        this.layout = null;
        this.isAuthenticated = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.loadTimer = null;
    }
    
    /**
     * Инициализация приложения
     */
    async init() {
        this.hideInitialLoader();
        Store.enableDebug();
        
        if (!this.checkNetwork()) {
            this.showNetworkError();
            return;
        }
        
        this.setLoadTimeout();
        
        try {
            const user = await AuthManager.init();
            
            if (user) {
                this.isAuthenticated = true;
                AppState.set('user', user);
                await PermissionManager.loadUserPermissions(user.id);
                await this.startAuthenticatedApp();
            } else {
                this.showLoginPage();
            }
            
            this.setupGlobalEvents();
            this.clearLoadTimeout();
            
        } catch (error) {
            console.error('[App] Initialization error:', error);
            this.clearLoadTimeout();
            this.handleInitError(error);
        }
    }
    
    hideInitialLoader() {
        const loader = document.getElementById('initial-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    }
    
    checkNetwork() {
        return navigator.onLine;
    }
    
    showNetworkError() {
        this.root.innerHTML = `
            <div class="error-state" style="padding: 40px; text-align: center;">
                <div class="error-state-icon">🌐</div>
                <h3>Нет подключения к интернету</h3>
                <p>Проверьте подключение и обновите страницу</p>
                <button class="btn-primary" onclick="location.reload()">Обновить</button>
            </div>
        `;
    }
    
    setLoadTimeout() {
        this.loadTimer = setTimeout(() => {
            console.error('[App] Load timeout');
            this.handleInitError(new Error('Timeout loading application'));
        }, LOAD_TIMEOUT);
    }
    
    clearLoadTimeout() {
        if (this.loadTimer) {
            clearTimeout(this.loadTimer);
            this.loadTimer = null;
        }
    }
    
    handleInitError(error) {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            console.log(`[App] Retry ${this.retryCount}/${this.maxRetries} in ${RETRY_DELAY}ms`);
            
            setTimeout(() => this.init(), RETRY_DELAY);
        } else {
            this.root.innerHTML = `
                <div class="error-state" style="padding: 40px; text-align: center;">
                    <div class="error-state-icon">⚠️</div>
                    <h3>Не удалось загрузить приложение</h3>
                    <p>${this.escapeHtml(error.message)}</p>
                    <button class="btn-primary" onclick="location.reload(true)">Обновить (очистить кэш)</button>
                </div>
            `;
        }
    }
    
    async startAuthenticatedApp() {
        this.layout = new AppLayout(this.root);
        this.layout.render();
        
        this.registerRoutes();
        
        Router.use(async (route) => {
            if (!this.isAuthenticated) {
                return '/login';
            }
            return true;
        });
        
        Router.start();
        
        AppState.set('isInitialized', true);
    }
    
    registerRoutes() {
        // Страница склада
        Router.register('/inventory', {
            title: 'Склад',
            loader: async (container) => {
                const { InventoryPage } = await import(`./modules/inventory/InventoryPage.js?${CACHE_BUST}`);
                return new InventoryPage(container);
            },
            permissions: ['products:view', 'products:create', 'products:edit', 'products:delete']
        });
        
        // Страница кассы
        Router.register('/cashier', {
            title: 'Касса',
            loader: async (container) => {
                const { CashierPage } = await import(`./modules/cashier/CashierPage.js?${CACHE_BUST}`);
                return new CashierPage(container);
            },
            permissions: ['sales:view', 'sales:create', 'sales:delete', 'sales:edit']
        });
        
        // Страница отчетов
        Router.register('/reports', {
            title: 'Отчеты',
            loader: async (container) => {
                const { ReportsPage } = await import(`./modules/reports/ReportsPage.js?${CACHE_BUST}`);
                return new ReportsPage(container);
            },
            permissions: ['reports:view', 'reports:export']
        });
        
        // Редирект с корня
        Router.register('/', {
            title: 'Склад',
            loader: async () => {
                Router.navigate('/inventory');
                return null;
            }
        });
        
        // Страница входа
        Router.register('/login', {
            title: 'Вход',
            loader: async (container) => {
                new LoginForm(container).render();
                return null;
            }
        });
    }
    
    setupGlobalEvents() {
        EventBus.on('auth:logout', () => this.handleLogout());
        
        EventBus.on('router:access-denied', ({ route }) => {
            console.warn(`[App] Access denied to ${route.path}`);
            Notification.warning('У вас нет доступа к этому разделу');
        });
        
        EventBus.on('router:error', ({ error, path }) => {
            console.error(`[App] Route error ${path}:`, error);
            
            const container = this.layout?.getPageContainer();
            if (container) {
                container.innerHTML = `
                    <div class="error-state">
                        <div class="error-state-icon">⚠️</div>
                        <h3>Ошибка загрузки страницы</h3>
                        <p>${this.escapeHtml(error.message)}</p>
                        <button class="btn-primary" onclick="location.reload(true)">Обновить (очистить кэш)</button>
                    </div>
                `;
            } else {
                Notification.error('Ошибка загрузки страницы');
            }
        });
        
        window.addEventListener('online', () => {
            Notification.info('Соединение восстановлено');
            this.refreshCurrentPage();
        });
        
        window.addEventListener('offline', () => {
            Notification.warning('Потеряно соединение с интернетом');
        });
        
        window.addEventListener('unhandledrejection', (event) => {
            console.error('[App] Unhandled rejection:', event.reason);
        });
    }
    
    async refreshCurrentPage() {
        const currentPath = window.location.hash.slice(1) || '/inventory';
        await Router.navigate(currentPath, { replace: true });
    }
    
    async handleLogout() {
        try {
            await AuthManager.signOut();
            this.isAuthenticated = false;
            AppState.reset();
            PermissionManager.clear();
            Store.resetAll();
            
            window.location.hash = '';
            this.showLoginPage();
            
            Notification.info('Вы вышли из системы');
        } catch (error) {
            console.error('[App] Logout error:', error);
            Notification.error('Ошибка при выходе');
        }
    }
    
    showLoginPage() {
        this.root.innerHTML = '';
        new LoginForm(this.root).render();
    }
    
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// ========== START APPLICATION ==========
document.addEventListener('DOMContentLoaded', async () => {
    const app = new Application();
    await app.init();
});

export { Application };
