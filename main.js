// ========================================
// FILE: ./main.js
// ========================================

/**
 * Second Hand CRM - Application Entry Point
 * 
 * Точка входа приложения. Инициализирует ядро, регистрирует маршруты
 * и запускает приложение.
 * 
 * @module main
 * @version 4.2.0
 * @changes
 * - Исправлена проверка прав доступа для страниц: теперь доступ открывается при наличии любого права из семейства (view, create, edit, delete)
 * - Устранена проблема блокировки страницы склада при отсутствии явного права `products:view`
 * - Добавлена обработка ошибок загрузки модулей
 * - Добавлена проверка сети
 * - Вынесена регистрация маршрутов
 * - Добавлен graceful shutdown
 */

// ========== IMPORTS (Core) ==========
import { AppState } from './core/AppState.js';
import { Router } from './core/Router.js';
import { AppLayout } from './core/AppLayout.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';

// ========== IMPORTS (Services) ==========
import { AuthManager } from './modules/auth/AuthManager.js';
import { LoginForm } from './modules/auth/LoginForm.js';
import { Notification } from './modules/common/Notification.js';

// ========== CONSTANTS ==========
const LOAD_TIMEOUT = 10000; // 10 секунд
const RETRY_DELAY = 3000; // 3 секунды

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
        // Скрываем начальный лоадер
        this.hideInitialLoader();
        
        // Проверяем соединение
        if (!this.checkNetwork()) {
            this.showNetworkError();
            return;
        }
        
        // Устанавливаем таймаут загрузки
        this.setLoadTimeout();
        
        try {
            // Проверяем аутентификацию
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
    
    /**
     * Скрывает начальный лоадер
     */
    hideInitialLoader() {
        const loader = document.getElementById('initial-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    }
    
    /**
     * Проверка сетевого соединения
     */
    checkNetwork() {
        return navigator.onLine;
    }
    
    /**
     * Показывает ошибку сети
     */
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
    
    /**
     * Устанавливает таймаут загрузки
     */
    setLoadTimeout() {
        this.loadTimer = setTimeout(() => {
            console.error('[App] Load timeout');
            this.handleInitError(new Error('Timeout loading application'));
        }, LOAD_TIMEOUT);
    }
    
    /**
     * Очищает таймаут загрузки
     */
    clearLoadTimeout() {
        if (this.loadTimer) {
            clearTimeout(this.loadTimer);
            this.loadTimer = null;
        }
    }
    
    /**
     * Обработка ошибки инициализации
     */
    handleInitError(error) {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            console.log(`[App] Retry ${this.retryCount}/${this.maxRetries} in ${RETRY_DELAY}ms`);
            
            setTimeout(() => {
                this.init();
            }, RETRY_DELAY);
        } else {
            this.root.innerHTML = `
                <div class="error-state" style="padding: 40px; text-align: center;">
                    <div class="error-state-icon">⚠️</div>
                    <h3>Не удалось загрузить приложение</h3>
                    <p>${this.escapeHtml(error.message)}</p>
                    <button class="btn-primary" onclick="location.reload()">Обновить</button>
                </div>
            `;
        }
    }
    
    /**
     * Запускает приложение для аутентифицированного пользователя
     */
    async startAuthenticatedApp() {
        // Рендерим основной макет
        this.layout = new AppLayout(this.root);
        this.layout.render();
        
        // Регистрируем маршруты
        this.registerRoutes();
        
        // Добавляем middleware для проверки аутентификации
        Router.use(async (route) => {
            if (!this.isAuthenticated) {
                return '/login';
            }
            return true;
        });
        
        // Запускаем роутер
        Router.start();
        
        AppState.set('isInitialized', true);
    }
    
    /**
     * Регистрирует все маршруты приложения
     */
    registerRoutes() {
        // Страница склада (доступна при любых правах на товары)
        Router.register('/inventory', {
            title: 'Склад',
            loader: async (container) => {
                const { InventoryPage } = await import('./modules/inventory/InventoryPage.js');
                return new InventoryPage(container);
            },
            permissions: [
                'products:view',
                'products:create',
                'products:edit',
                'products:delete'
            ]
        });
        
        // Страница кассы (доступна при любых правах на продажи)
        Router.register('/cashier', {
            title: 'Касса',
            loader: async (container) => {
                const { CashierPage } = await import('./modules/cashier/CashierPage.js');
                return new CashierPage(container);
            },
            permissions: [
                'sales:view',
                'sales:create',
                'sales:delete',
                'sales:edit'
            ]
        });
        
        // Страница отчетов (доступна при любых правах на отчеты)
        Router.register('/reports', {
            title: 'Отчеты',
            loader: async (container) => {
                const { ReportsPage } = await import('./modules/reports/ReportsPage.js');
                return new ReportsPage(container);
            },
            permissions: [
                'reports:view',
                'reports:export'
            ]
        });
        
        // Редирект с корня на склад
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
    
    /**
     * Настраивает глобальные события
     */
    setupGlobalEvents() {
        // Выход из системы
        EventBus.on('auth:logout', () => {
            this.handleLogout();
        });
        
        // Ошибка доступа
        EventBus.on('router:access-denied', ({ route }) => {
            console.warn(`[App] Access denied to ${route.path}`);
            Notification.warning('У вас нет доступа к этому разделу');
        });
        
        // Ошибка загрузки страницы
        EventBus.on('router:error', ({ error, path }) => {
            console.error(`[App] Route error ${path}:`, error);
            
            const container = this.layout?.getPageContainer();
            if (container) {
                container.innerHTML = `
                    <div class="error-state">
                        <div class="error-state-icon">⚠️</div>
                        <h3>Ошибка загрузки страницы</h3>
                        <p>${this.escapeHtml(error.message)}</p>
                        <button class="btn-primary" onclick="location.reload()">Обновить</button>
                    </div>
                `;
            } else {
                Notification.error('Ошибка загрузки страницы');
            }
        });
        
        // Восстановление сети
        window.addEventListener('online', () => {
            Notification.info('Соединение восстановлено');
            this.refreshCurrentPage();
        });
        
        window.addEventListener('offline', () => {
            Notification.warning('Потеряно соединение с интернетом');
        });
        
        // Обработка ошибок
        window.addEventListener('unhandledrejection', (event) => {
            console.error('[App] Unhandled rejection:', event.reason);
            Notification.error('Произошла ошибка. Попробуйте обновить страницу.');
        });
        
        window.addEventListener('error', (event) => {
            console.error('[App] Global error:', event.error);
            // Не показываем уведомление на каждую ошибку
        });
    }
    
    /**
     * Обновляет текущую страницу
     */
    async refreshCurrentPage() {
        const currentPath = window.location.hash.slice(1) || '/inventory';
        await Router.navigate(currentPath, { replace: true });
    }
    
    /**
     * Обработчик выхода из системы
     */
    async handleLogout() {
        try {
            await AuthManager.signOut();
            this.isAuthenticated = false;
            AppState.reset();
            PermissionManager.clear();
            
            window.location.hash = '';
            this.showLoginPage();
            
            Notification.info('Вы вышли из системы');
        } catch (error) {
            console.error('[App] Logout error:', error);
            Notification.error('Ошибка при выходе');
        }
    }
    
    /**
     * Показывает страницу входа
     */
    showLoginPage() {
        this.root.innerHTML = '';
        new LoginForm(this.root).render();
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
    const app = new Application();
    await app.init();
});

// ========== EXPORTS ==========
export { Application };
