// ========================================
// FILE: ./core-new/AppShell.js
// ========================================

/**
 * App Shell - Изолирующая оболочка приложения
 * 
 * Отвечает за рендеринг каркаса приложения и ленивую загрузку независимых виджетов.
 * Реализует принцип "Ошибка в одном виджете не ломает все приложение".
 * Управляет аутентификацией и защитой маршрутов.
 * 
 * Архитектурные решения:
 * - Сканирование DOM по атрибуту `data-widget`.
 * - Динамический импорт модулей виджетов.
 * - Оборачивание каждого виджета в Error Boundary (try/catch).
 * - Интеграция с AuthWidget для защиты маршрутов.
 * - Предотвращение повторной загрузки уже загруженных виджетов.
 * 
 * @module AppShell
 * @version 1.2.1
 * @changes
 * - Исправлен бесконечный цикл загрузки виджетов.
 * - Добавлена проверка на уже загруженные виджеты.
 * - Исправлено дублирование NotificationsWidget.
 */

import { EventBus, EventTypes, EventSource } from './EventBus.js';

export class AppShell {
    constructor(rootElement) {
        if (!rootElement) {
            throw new Error('AppShell: rootElement is required');
        }
        
        /** @type {HTMLElement} */
        this.root = rootElement;
        
        /** @type {Map<string, any>} Хранилище экземпляров виджетов */
        this.widgets = new Map();
        
        /** @type {Map<string, HTMLElement>} Контейнеры виджетов */
        this.containers = new Map();
        
        /** @type {boolean} Флаг инициализации */
        this.initialized = false;
        
        /** @type {string} Активная вкладка */
        this.activeTab = 'inventory';
        
        /** @type {boolean} Флаг аутентификации */
        this.isAuthenticated = false;
        
        /** @type {Object|null} Текущий пользователь */
        this.currentUser = null;
        
        /** @type {Set<string>} Виджеты, которые сейчас загружаются */
        this.loadingWidgets = new Set();
        
        // Привязка методов
        this.handleAuthSuccess = this.handleAuthSuccess.bind(this);
        this.handleAuthLogout = this.handleAuthLogout.bind(this);
    }

    /**
     * Регистрирует маппинг "название виджета -> путь к файлу".
     * @private
     */
    getWidgetRegistry() {
        return {
            'auth': '../widgets/AuthWidget.js',
            'inventory': '../widgets/InventoryWidget.js',
            'cashier': '../widgets/CashierWidget.js',
            'reports': '../widgets/ReportsWidget.js',
            'notifications': '../widgets/NotificationsWidget.js'
        };
    }
    
    /**
     * Список виджетов, требующих аутентификации.
     * @private
     */
    getProtectedWidgets() {
        return ['inventory', 'cashier', 'reports'];
    }

    /**
     * Рендерит базовый HTML каркас приложения.
     * @returns {string}
     */
    renderBaseLayout() {
        return `
            <div class="app-shell">
                <!-- Шапка с навигацией -->
                <header class="app-header">
                    <div class="header-left">
                        <h1>🔄 SH CRM 2.0</h1>
                        <span class="version-badge">v2.0</span>
                    </div>
                    <nav class="app-nav">
                        ${this.isAuthenticated ? `
                            <button data-nav="inventory" class="${this.activeTab === 'inventory' ? 'active' : ''}">
                                <span class="nav-icon">📦</span>
                                <span>Склад</span>
                            </button>
                            <button data-nav="cashier" class="${this.activeTab === 'cashier' ? 'active' : ''}">
                                <span class="nav-icon">💰</span>
                                <span>Касса</span>
                            </button>
                            <button data-nav="reports" class="${this.activeTab === 'reports' ? 'active' : ''}">
                                <span class="nav-icon">📊</span>
                                <span>Отчеты</span>
                            </button>
                        ` : ''}
                    </nav>
                    <div class="header-right">
                        <span data-widget="auth" style="display: contents;"></span>
                    </div>
                </header>

                <!-- Основная зона контента -->
                <main class="app-main">
                    ${this.isAuthenticated ? `
                        <!-- Склад -->
                        <div id="widget-inventory" data-widget="inventory" style="display: ${this.activeTab === 'inventory' ? 'block' : 'none'};"></div>
                        
                        <!-- Касса -->
                        <div id="widget-cashier" data-widget="cashier" style="display: ${this.activeTab === 'cashier' ? 'block' : 'none'};"></div>
                        
                        <!-- Отчеты -->
                        <div id="widget-reports" data-widget="reports" style="display: ${this.activeTab === 'reports' ? 'block' : 'none'};"></div>
                    ` : `
                        <!-- Сообщение для неавторизованных -->
                        <div class="auth-required-message">
                            <div class="auth-required-icon">🔐</div>
                            <h2>Требуется авторизация</h2>
                            <p>Войдите в систему, чтобы получить доступ к приложению</p>
                        </div>
                    `}
                    
                    <!-- Уведомления (всегда видимы) -->
                    <div data-widget="notifications"></div>
                </main>
            </div>
        `;
    }

    /**
     * Инициализация оболочки.
     */
    async init() {
        if (this.initialized) return;
        
        console.log('[AppShell] Initializing...');
        
        // 1. Подписываемся на события аутентификации
        this.subscribeToAuthEvents();
        
        // 2. Определяем активную вкладку из хэша
        const hash = window.location.hash.slice(1);
        if (hash && ['inventory', 'cashier', 'reports'].includes(hash)) {
            this.activeTab = hash;
        }
        
        // 3. Рендерим HTML
        this.root.innerHTML = this.renderBaseLayout();
        
        // 4. Находим все контейнеры для виджетов
        this.scanWidgetContainers();
        
        // 5. Загружаем виджет аутентификации ПЕРВЫМ
        await this.loadWidget('auth');
        
        // 6. Загружаем виджет уведомлений (только если еще не загружен)
        if (!this.widgets.has('notifications')) {
            await this.loadWidget('notifications');
        }
        
        // 7. Привязываем события навигации (если есть кнопки)
        if (this.isAuthenticated) {
            this.attachNavigationEvents();
        }
        
        this.initialized = true;
        
        // 8. Сообщаем системе, что оболочка готова
        EventBus.emit(EventTypes.SYSTEM.APP_READY, { 
            timestamp: Date.now(),
            activeTab: this.activeTab,
            authenticated: this.isAuthenticated
        }, EventSource.KERNEL);
        
        // 9. Уведомляем внешний мир
        window.dispatchEvent(new CustomEvent('app:ready'));
        
        console.log('[AppShell] ✅ Initialization complete (Authenticated:', this.isAuthenticated, ')');
    }
    
    /**
     * Подписывается на события аутентификации.
     */
    subscribeToAuthEvents() {
        EventBus.on(EventTypes.AUTH.LOGIN_SUCCESS, this.handleAuthSuccess);
        EventBus.on(EventTypes.AUTH.LOGOUT, this.handleAuthLogout);
    }
    
    /**
     * Обработчик успешного входа.
     * @param {Object} data - Данные события
     */
    async handleAuthSuccess(data) {
        console.log('[AppShell] Auth success, reloading UI...');
        
        this.isAuthenticated = true;
        this.currentUser = data.user;
        
        // Сохраняем существующие виджеты, которые нужно сохранить
        const existingNotifications = this.widgets.get('notifications');
        const existingAuth = this.widgets.get('auth');
        
        // Очищаем контейнеры (но не уничтожаем виджеты)
        this.containers.clear();
        
        // Перерендериваем весь UI
        this.root.innerHTML = this.renderBaseLayout();
        this.scanWidgetContainers();
        
        // Восстанавливаем сохраненные виджеты
        if (existingNotifications) {
            this.widgets.set('notifications', existingNotifications);
            const container = this.containers.get('notifications');
            if (container && existingNotifications.element) {
                container.appendChild(existingNotifications.element);
            }
        }
        
        if (existingAuth) {
            this.widgets.set('auth', existingAuth);
            const container = this.containers.get('auth');
            if (container && existingAuth.element) {
                container.appendChild(existingAuth.element);
            }
        }
        
        // Загружаем виджет активной вкладки (если еще не загружен)
        if (!this.widgets.has(this.activeTab)) {
            await this.loadWidget(this.activeTab);
        } else {
            // Просто показываем контейнер
            const container = this.containers.get(this.activeTab);
            if (container) {
                container.style.display = 'block';
            }
        }
        
        // Привязываем навигацию
        this.attachNavigationEvents();
        
        console.log('[AppShell] UI reloaded for authenticated user');
    }
    
    /**
     * Обработчик выхода из системы.
     */
    async handleAuthLogout() {
        console.log('[AppShell] Auth logout, clearing UI...');
        
        this.isAuthenticated = false;
        this.currentUser = null;
        this.activeTab = 'inventory';
        
        // Выгружаем защищенные виджеты
        for (const widgetName of this.getProtectedWidgets()) {
            await this.unloadWidget(widgetName);
        }
        
        // Очищаем контейнеры
        this.containers.clear();
        
        // Перерендериваем UI
        this.root.innerHTML = this.renderBaseLayout();
        this.scanWidgetContainers();
        
        // Восстанавливаем auth и notifications
        const existingAuth = this.widgets.get('auth');
        const existingNotifications = this.widgets.get('notifications');
        
        if (existingAuth) {
            const container = this.containers.get('auth');
            if (container && existingAuth.element) {
                container.appendChild(existingAuth.element);
            }
        }
        
        if (existingNotifications) {
            const container = this.containers.get('notifications');
            if (container && existingNotifications.element) {
                container.appendChild(existingNotifications.element);
            }
        }
        
        console.log('[AppShell] UI cleared after logout');
    }

    /**
     * Сканирует DOM и сохраняет ссылки на контейнеры виджетов.
     */
    scanWidgetContainers() {
        const elements = this.root.querySelectorAll('[data-widget]');
        
        elements.forEach(el => {
            const widgetName = el.dataset.widget;
            if (!widgetName) return;
            
            this.containers.set(widgetName, el);
            console.log(`[AppShell] Found container for widget: ${widgetName}`);
        });
    }

    /**
     * Настройка навигации между виджетами.
     */
    attachNavigationEvents() {
        const navButtons = this.root.querySelectorAll('[data-nav]');
        
        navButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetWidget = e.currentTarget.dataset.nav;
                
                // Проверяем аутентификацию для защищенных виджетов
                if (this.getProtectedWidgets().includes(targetWidget) && !this.isAuthenticated) {
                    EventBus.emit(EventTypes.UI.NOTIFICATION_SHOW, {
                        type: 'warning',
                        message: 'Требуется авторизация'
                    }, EventSource.KERNEL);
                    return;
                }
                
                // Обновляем хэш
                window.location.hash = targetWidget;
                
                // Обновляем активный класс кнопок
                navButtons.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                // Скрываем все виджеты
                this.containers.forEach((container, name) => {
                    if (name !== 'notifications' && name !== 'auth') {
                        container.style.display = 'none';
                    }
                });
                
                // Показываем выбранный
                const targetContainer = this.containers.get(targetWidget);
                if (targetContainer) {
                    targetContainer.style.display = 'block';
                    
                    // Если виджет еще не загружен и не в процессе загрузки - загружаем его
                    if (!this.widgets.has(targetWidget) && !this.loadingWidgets.has(targetWidget)) {
                        await this.loadWidget(targetWidget);
                    }
                }
                
                this.activeTab = targetWidget;
                
                // Уведомляем систему о смене вкладки
                EventBus.emit(EventTypes.UI.TAB_CHANGED, { 
                    tab: targetWidget,
                    previousTab: this.activeTab
                }, EventSource.KERNEL);
            });
        });
        
        // Слушаем изменения хэша
        window.addEventListener('hashchange', async () => {
            const hash = window.location.hash.slice(1);
            if (hash && hash !== this.activeTab && ['inventory', 'cashier', 'reports'].includes(hash)) {
                const targetBtn = this.root.querySelector(`[data-nav="${hash}"]`);
                if (targetBtn) {
                    targetBtn.click();
                }
            }
        });
    }

    /**
     * Загружает конкретный виджет по имени.
     * @param {string} widgetName - Имя виджета
     */
    async loadWidget(widgetName) {
        // Предотвращаем повторную загрузку
        if (this.widgets.has(widgetName)) {
            console.log(`[AppShell] Widget ${widgetName} already loaded, skipping`);
            return;
        }
        
        // Предотвращаем параллельную загрузку одного виджета
        if (this.loadingWidgets.has(widgetName)) {
            console.log(`[AppShell] Widget ${widgetName} is already loading, skipping`);
            return;
        }
        
        const registry = this.getWidgetRegistry();
        const modulePath = registry[widgetName];
        
        if (!modulePath) {
            console.error(`[AppShell] No path registered for widget: ${widgetName}`);
            return;
        }
        
        const container = this.containers.get(widgetName);
        if (!container) {
            console.error(`[AppShell] Container not found for widget: ${widgetName}`);
            return;
        }
        
        // Проверяем аутентификацию для защищенных виджетов
        if (this.getProtectedWidgets().includes(widgetName) && !this.isAuthenticated) {
            container.innerHTML = `
                <div class="auth-required-placeholder">
                    <span>🔐</span>
                    <p>Требуется авторизация</p>
                </div>
            `;
            console.warn(`[AppShell] Cannot load protected widget "${widgetName}" without auth`);
            return;
        }
        
        this.loadingWidgets.add(widgetName);
        
        // Особый случай для виджета уведомлений — не показываем лоадер
        if (widgetName !== 'notifications' && widgetName !== 'auth') {
            container.innerHTML = `
                <div class="widget-loader">
                    <div class="loader-spinner"></div>
                    <span>Загрузка модуля ${widgetName}...</span>
                </div>
            `;
        }
        
        console.log(`[AppShell] Loading widget: ${widgetName} from ${modulePath}`);
        
        try {
            const cacheBust = window.location.hostname === 'localhost' ? `?v=${Date.now()}` : '';
            const module = await import(modulePath + cacheBust);
            
            let WidgetClass = module.default;
            
            if (!WidgetClass) {
                const className = widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + 'Widget';
                WidgetClass = module[className];
            }
            
            if (!WidgetClass) {
                throw new Error(`Widget class not found in module ${modulePath}`);
            }
            
            const widgetInstance = new WidgetClass(container);
            
            if (typeof widgetInstance.mount === 'function') {
                await widgetInstance.mount();
            }
            
            this.widgets.set(widgetName, widgetInstance);
            
            console.log(`[AppShell] ✅ Widget ${widgetName} loaded successfully`);
            
        } catch (error) {
            console.error(`[AppShell] ❌ Failed to load widget ${widgetName}:`, error);
            
            if (widgetName === 'notifications') {
                console.warn('[AppShell] Notifications widget failed, continuing without notifications');
                this.loadingWidgets.delete(widgetName);
                return;
            }
            
            container.innerHTML = `
                <div class="widget-error">
                    <div class="error-icon">⚠️</div>
                    <h4>Не удалось загрузить модуль "${widgetName}"</h4>
                    <p>${this.escapeHtml(error.message)}</p>
                    <button class="retry-btn" data-retry="${widgetName}">🔄 Попробовать снова</button>
                </div>
            `;
            
            const retryBtn = container.querySelector('.retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    this.loadingWidgets.delete(widgetName);
                    this.loadWidget(widgetName);
                });
            }
            
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.KERNEL,
                widget: widgetName,
                error: error.message,
                stack: error.stack
            }, EventSource.KERNEL);
        } finally {
            this.loadingWidgets.delete(widgetName);
        }
    }

    /**
     * Выгружает виджет и очищает ресурсы.
     * @param {string} widgetName
     */
    async unloadWidget(widgetName) {
        const widget = this.widgets.get(widgetName);
        if (widget && typeof widget.destroy === 'function') {
            await widget.destroy();
        }
        this.widgets.delete(widgetName);
        
        EventBus.clearSource(widgetName);
        
        console.log(`[AppShell] Widget ${widgetName} unloaded`);
    }

    /**
     * Полное уничтожение оболочки.
     */
    async destroy() {
        console.log('[AppShell] Destroying...');
        
        EventBus.off(EventTypes.AUTH.LOGIN_SUCCESS, this.handleAuthSuccess);
        EventBus.off(EventTypes.AUTH.LOGOUT, this.handleAuthLogout);
        
        const promises = [];
        this.widgets.forEach((_, name) => {
            promises.push(this.unloadWidget(name));
        });
        
        await Promise.allSettled(promises);
        
        this.widgets.clear();
        this.containers.clear();
        this.loadingWidgets.clear();
        this.root.innerHTML = '';
        this.initialized = false;
        
        console.log('[AppShell] 💀 Destroyed');
    }
    
    /**
     * Экранирование HTML
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    /**
     * Получить экземпляр виджета по имени.
     * @param {string} name - Имя виджета
     * @returns {any|null}
     */
    getWidget(name) {
        return this.widgets.get(name) || null;
    }
    
    /**
     * Проверить, загружен ли виджет.
     * @param {string} name - Имя виджета
     * @returns {boolean}
     */
    isWidgetLoaded(name) {
        return this.widgets.has(name);
    }
    
    /**
     * Получить ID текущего пользователя.
     * @returns {string|null}
     */
    getCurrentUserId() {
        return this.currentUser?.id || null;
    }
    
    /**
     * Получить текущего пользователя.
     * @returns {Object|null}
     */
    getCurrentUser() {
        return this.currentUser ? { ...this.currentUser } : null;
    }
    
    /**
     * Проверить, аутентифицирован ли пользователь.
     * @returns {boolean}
     */
    isUserAuthenticated() {
        return this.isAuthenticated;
    }
}

// Экспортируем для использования в main.js
export default AppShell;
