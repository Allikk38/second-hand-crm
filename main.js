/**
 * Second Hand CRM - Application Entry Point
 * 
 * Точка входа приложения. Инициализирует ядро, регистрирует маршруты
 * и запускает приложение. Вся логика вынесена в отдельные модули.
 * 
 * @module main
 * @version 4.0.0
 * @changes
 * - Полный архитектурный рефакторинг
 * - Разделение на Router, AppLayout, AppState
 * - Централизованная регистрация маршрутов
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

// ========== IMPORTS (Pages) ==========
import { InventoryPage } from './modules/inventory/InventoryPage.js';

// ========== APPLICATION CLASS ==========
class Application {
    constructor() {
        this.root = document.getElementById('app-root');
        this.layout = null;
        this.isAuthenticated = false;
    }
    
    /**
     * Инициализация приложения
     */
    async init() {
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
        } catch (error) {
            console.error('[App] Initialization error:', error);
            this.showLoginPage();
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
        // Страница склада (загружается сразу)
        Router.register('/inventory', {
            title: 'Склад',
            loader: async (container) => new InventoryPage(container),
            permissions: ['products:view']
        });
        
        // Страница кассы (ленивая загрузка)
        Router.register('/cashier', {
            title: 'Касса',
            loader: async (container) => {
                const { CashierPage } = await import('./modules/cashier/CashierPage.js');
                return new CashierPage(container);
            },
            permissions: ['sales:create']
        });
        
        // Страница отчетов (ленивая загрузка)
        Router.register('/reports', {
            title: 'Отчеты',
            loader: async (container) => {
                const { ReportsPage } = await import('./modules/reports/ReportsPage.js');
                return new ReportsPage(container);
            },
            permissions: ['reports:view']
        });
        
        // Редирект с корня на склад
        Router.register('/', {
            title: 'Склад',
            loader: async () => {
                Router.navigate('/inventory');
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
            EventBus.emit('notification:show', {
                type: 'error',
                message: 'У вас нет доступа к этому разделу'
            });
        });
        
        // Ошибка загрузки страницы
        EventBus.on('router:error', ({ error }) => {
            const container = this.layout?.getPageContainer();
            if (container) {
                container.innerHTML = `
                    <div class="error-state" style="padding: 40px; text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;">⚠️</div>
                        <h3 style="margin-bottom: 12px; color: var(--color-text);">Ошибка загрузки</h3>
                        <p style="color: var(--color-text-secondary); margin-bottom: 24px;">Не удалось загрузить страницу</p>
                        <button class="btn-primary" onclick="location.reload()">Обновить</button>
                    </div>
                `;
            }
        });
    }
    
    /**
     * Обработчик выхода из системы
     */
    async handleLogout() {
        await AuthManager.signOut();
        this.isAuthenticated = false;
        AppState.reset();
        PermissionManager.clear();
        
        window.location.hash = '';
        this.showLoginPage();
    }
    
    /**
     * Показывает страницу входа
     */
    showLoginPage() {
        new LoginForm(this.root).render();
    }
}

// ========== START APPLICATION ==========
document.addEventListener('DOMContentLoaded', async () => {
    const app = new Application();
    await app.init();
});

// ========== EXPORTS ==========
export { Application };
