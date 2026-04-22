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
 * @version 6.0.1
 * @changes
 * - Добавлена обработка ошибок сети.
 * - Приложение запускается даже при недоступности Supabase.
 * - Улучшена обработка таймаутов.
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
const LOAD_TIMEOUT = 15000; // Увеличено до 15 секунд
const RETRY_DELAY = 3000;
const CACHE_BUST = 'v=6.0.1';

// ========== APPLICATION CLASS ==========
class Application {
    constructor() {
        this.root = document.getElementById('app-root');
        this.layout = null;
        this.isAuthenticated = false;
        this.retryCount = 0;
        this.maxRetries = 2; // Уменьшено количество ретраев
        this.loadTimer = null;
        this.initStarted = false;
    }
    
    /**
     * Инициализация приложения
     */
    async init() {
        if (this.initStarted) return;
        this.initStarted = true;
        
        this.hideInitialLoader();
        
        // Включаем отладку Store только в development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            Store.enableDebug();
        }
        
        this.setLoadTimeout();
        
        try {
            // Пытаемся инициализировать аутентификацию с таймаутом
            const user = await this.initAuthWithTimeout();
            
            if (user) {
                this.isAuthenticated = true;
                AppState.set('user', user);
                
                // Права загружаем асинхронно, не блокируем запуск
                PermissionManager.loadUserPermissions(user.id).catch(err => {
                    console.warn('[App] Permissions load failed:', err);
                });
                
                await this.startAuthenticatedApp();
            } else {
                // Нет сессии - показываем логин
                this.showLoginPage();
            }
            
            this.setupGlobalEvents();
            this.clearLoadTimeout();
            
        } catch (error) {
            console.error('[App] Initialization error:', error);
            this.clearLoadTimeout();
            
            // Если ошибка сети - показываем логин с сообщением
            if (error.message.includes('timeout') || error.message.includes('network') || error.message.includes('fetch')) {
                console.warn('[App] Network error, showing offline login');
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
            return await Promise.race([AuthManager.init(), timeoutPromise]);
        } catch (error) {
            console.warn('[App] Auth init failed:', error.message);
            
            // Проверяем, есть ли кэшированная сессия в localStorage
            const cachedUser = this.getCachedUser();
            if (cachedUser) {
                console.log('[App] Using cached user data');
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
            // Игнорируем
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
        }
    }
    
    /**
     * Показывает ошибку сети
     */
    showNetworkError() {
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
        console.log('[App] Showing offline login');
        
        // Сначала показываем сообщение о проблемах с сетью
        Notification.warning('Проблемы с подключением к серверу. Работа в офлайн-режиме.');
        
        // Затем показываем форму входа
        this.showLoginPage();
    }
    
    /**
     * Устанавливает таймаут загрузки
     */
    setLoadTimeout() {
        this.loadTimer = setTimeout(() => {
            console.error('[App] Load timeout - forcing UI display');
            
            // Принудительно показываем логин при таймауте
            const loader = document.getElementById('initial-loader');
            if (loader) loader.style.display = 'none';
            
            if (!this.isAuthenticated) {
                this.showOfflineLogin();
            } else {
                // Пытаемся запустить приложение даже при таймауте
                this.startAuthenticatedApp().catch(err => {
                    console.error('[App] Force start failed:', err);
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
        }
    }
    
    /**
     * Обработка ошибки инициализации
     */
    handleInitError(error) {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            this.initStarted = false;
            console.log(`[App] Retry ${this.retryCount}/${this.maxRetries} in ${RETRY_DELAY}ms`);
            
            setTimeout(() => this.init(), RETRY_DELAY);
        } else {
            this.showNetworkError();
        }
    }
    
    /**
     * Запускает приложение для аутентифицированного пользователя
     */
    async startAuthenticatedApp() {
        try {
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
        } catch (error) {
            console.error('[App] Failed to start authenticated app:', error);
            throw error;
        }
    }
    
    /**
     * Регистрирует все маршруты приложения
     */
    registerRoutes() {
        // Страница склада
        Router.register('/inventory', {
            title: 'Склад',
            loader: async (container) => {
                try {
                    const { InventoryPage } = await import(`./modules/inventory/InventoryPage.js?${CACHE_BUST}`);
                    return new InventoryPage(container);
                } catch (error) {
                    console.error('[App] Failed to load InventoryPage:', error);
                    throw error;
                }
            },
            permissions: ['products:view', 'products:create', 'products:edit', 'products:delete']
        });
        
        // Страница кассы
        Router.register('/cashier', {
            title: 'Касса',
            loader: async (container) => {
                try {
                    const { CashierPage } = await import(`./modules/cashier/CashierPage.js?${CACHE_BUST}`);
                    return new CashierPage(container);
                } catch (error) {
                    console.error('[App] Failed to load CashierPage:', error);
                    throw error;
                }
            },
            permissions: ['sales:view', 'sales:create', 'sales:delete', 'sales:edit']
        });
        
        // Страница отчетов
        Router.register('/reports', {
            title: 'Отчеты',
            loader: async (container) => {
                try {
                    const { ReportsPage } = await import(`./modules/reports/ReportsPage.js?${CACHE_BUST}`);
                    return new ReportsPage(container);
                } catch (error) {
                    console.error('[App] Failed to load ReportsPage:', error);
                    throw error;
                }
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
    
    /**
     * Настраивает глобальные события
     */
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
                        <p>${this.escapeHtml(error?.message || 'Неизвестная ошибка')}</p>
                        <button class="btn-primary" onclick="location.reload(true)">Обновить</button>
                        <button class="btn-secondary" onclick="window.location.hash = '/inventory'">На склад</button>
                    </div>
                `;
            }
        });
        
        window.addEventListener('online', () => {
            Notification.info('Соединение восстановлено');
            this.refreshCurrentPage();
        });
        
        window.addEventListener('offline', () => {
            Notification.warning('Потеряно соединение с интернетом');
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
        } catch (error) {
            console.warn('[App] SignOut error:', error);
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
        this.root.innerHTML = '';
        
        // Добавляем сообщение о проблемах с сетью если нужно
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
    const app = new Application();
    await app.init();
});

// Экспортируем для отладки
export { Application };
