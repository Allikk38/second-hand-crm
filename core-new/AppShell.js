// ========================================
// FILE: ./core-new/AppShell.js
// ========================================

/**
 * App Shell - Изолирующая оболочка приложения
 * 
 * Отвечает за рендеринг каркаса приложения и ленивую загрузку независимых виджетов.
 * Реализует принцип "Ошибка в одном виджете не ломает все приложение".
 * 
 * Архитектурные решения:
 * - Сканирование DOM по атрибуту `data-widget`.
 * - Динамический импорт модулей виджетов.
 * - Оборачивание каждого виджета в Error Boundary (try/catch).
 * - Полная изоляция: виджеты не импортируют друг друга, общение только через EventBus.
 * 
 * @module AppShell
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
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
    }

    /**
     * Регистрирует маппинг "название виджета -> путь к файлу".
     * Это единственное место, где прописаны пути к модулям.
     * @private
     */
    getWidgetRegistry() {
        return {
            // Пути относительно корня проекта (где лежит index.html)
            'auth': '../widgets/AuthWidget.js',
            'inventory': '../widgets/InventoryWidget.js',
            'cashier': '../widgets/CashierWidget.js',
            'reports': '../widgets/ReportsWidget.js',
            'notifications': '../widgets/NotificationsWidget.js'
        };
    }

    /**
     * Рендерит базовый HTML каркас приложения.
     * @returns {string}
     */
    renderBaseLayout() {
        return `
            <div class="app-shell">
                <!-- Шапка с навигацией (статическая часть) -->
                <header class="app-header">
                    <h1>SH CRM 2.0</h1>
                    <nav class="app-nav">
                        <button data-nav="inventory">📦 Склад</button>
                        <button data-nav="cashier">💰 Касса</button>
                        <button data-nav="reports">📊 Отчеты</button>
                    </nav>
                    <div class="user-actions">
                        <span data-widget="auth"></span>
                    </div>
                </header>

                <!-- Основная зона контента -->
                <main class="app-main">
                    <!-- Здесь будут рендериться виджеты через data-widget -->
                    <div id="widget-inventory" data-widget="inventory" style="display: none;"></div>
                    <div id="widget-cashier" data-widget="cashier" style="display: none;"></div>
                    <div id="widget-reports" data-widget="reports" style="display: none;"></div>
                    
                    <!-- Общая зона для уведомлений -->
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
        
        // 1. Рендерим HTML
        this.root.innerHTML = this.renderBaseLayout();
        
        // 2. Находим все контейнеры для виджетов
        this.scanWidgetContainers();
        
        // 3. Привязываем базовые события навигации
        this.attachNavigationEvents();
        
        // 4. Автоматически загружаем виджеты, которые видны на старте
        await this.loadVisibleWidgets();
        
        this.initialized = true;
        
        // 5. Сообщаем системе, что оболочка готова
        EventBus.emit(EventTypes.SYSTEM.APP_READY, { timestamp: Date.now() }, EventSource.KERNEL);
        
        console.log('[AppShell] Initialization complete');
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
                
                // Скрываем все виджеты
                this.containers.forEach((container, name) => {
                    if (name !== 'notifications') {
                        container.style.display = 'none';
                    }
                });
                
                // Показываем выбранный
                const targetContainer = this.containers.get(targetWidget);
                if (targetContainer) {
                    targetContainer.style.display = 'block';
                    
                    // Если виджет еще не загружен - загружаем его
                    if (!this.widgets.has(targetWidget)) {
                        await this.loadWidget(targetWidget);
                    }
                }
                
                // Уведомляем систему о смене вкладки
                EventBus.emit(EventTypes.UI.TAB_CHANGED, { tab: targetWidget }, EventSource.KERNEL);
            });
        });
        
        // Активируем первую вкладку по умолчанию (если нет хэша)
        const defaultTab = window.location.hash.slice(1) || 'inventory';
        const defaultBtn = this.root.querySelector(`[data-nav="${defaultTab}"]`);
        if (defaultBtn) {
            defaultBtn.click();
        }
    }

    /**
     * Загружает виджеты, которые сейчас видны пользователю.
     */
    async loadVisibleWidgets() {
        const promises = [];
        
        this.containers.forEach((container, name) => {
            if (container.style.display !== 'none' && !this.widgets.has(name)) {
                promises.push(this.loadWidget(name));
            }
        });
        
        await Promise.allSettled(promises);
    }

    /**
     * Загружает конкретный виджет по имени.
     * @param {string} widgetName - Имя виджета (например, 'inventory')
     */
    async loadWidget(widgetName) {
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
        
        // Показываем скелетон загрузки
        container.innerHTML = `
            <div class="widget-loader">
                <div class="loader-spinner"></div>
                <span>Загрузка модуля ${widgetName}...</span>
            </div>
        `;
        
        console.log(`[AppShell] Loading widget: ${widgetName} from ${modulePath}`);
        
        try {
            // Динамический импорт модуля
            // Используем cache-busting только в dev режиме
            const cacheBust = window.location.hostname === 'localhost' ? `?v=${Date.now()}` : '';
            const module = await import(modulePath + cacheBust);
            
            // Ищем экспортированный класс (обычно совпадает с именем или называется Widget)
            const WidgetClass = module.default || module[`${widgetName.charAt(0).toUpperCase() + widgetName.slice(1)}Widget`];
            
            if (!WidgetClass) {
                throw new Error(`Widget class not found in module ${modulePath}`);
            }
            
            // Создаем экземпляр виджета
            const widgetInstance = new WidgetClass(container);
            
            // Вызываем метод mount() если он есть
            if (typeof widgetInstance.mount === 'function') {
                await widgetInstance.mount();
            } else {
                console.warn(`[AppShell] Widget ${widgetName} has no mount() method`);
            }
            
            // Сохраняем экземпляр
            this.widgets.set(widgetName, widgetInstance);
            
            console.log(`[AppShell] ✅ Widget ${widgetName} loaded successfully`);
            
        } catch (error) {
            console.error(`[AppShell] ❌ Failed to load widget ${widgetName}:`, error);
            
            // Показываем красивую ошибку вместо белого экрана
            container.innerHTML = `
                <div class="widget-error">
                    <div class="error-icon">⚠️</div>
                    <h4>Не удалось загрузить модуль</h4>
                    <p>${this.escapeHtml(error.message)}</p>
                    <button class="retry-btn" onclick="window.location.reload()">Обновить</button>
                </div>
            `;
            
            // Отправляем системное событие об ошибке
            EventBus.emit(EventTypes.SYSTEM.ERROR, {
                source: EventSource.KERNEL,
                widget: widgetName,
                error: error.message
            }, EventSource.KERNEL);
        }
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
     * Выгружает виджет и очищает ресурсы.
     * @param {string} widgetName
     */
    async unloadWidget(widgetName) {
        const widget = this.widgets.get(widgetName);
        if (widget && typeof widget.destroy === 'function') {
            await widget.destroy();
        }
        this.widgets.delete(widgetName);
        
        // Очищаем подписки EventBus для этого виджета
        EventBus.clearSource(widgetName);
        
        console.log(`[AppShell] Widget ${widgetName} unloaded`);
    }

    /**
     * Полное уничтожение оболочки.
     */
    async destroy() {
        console.log('[AppShell] Destroying...');
        
        // Выгружаем все виджеты
        const promises = [];
        this.widgets.forEach((_, name) => {
            promises.push(this.unloadWidget(name));
        });
        
        await Promise.allSettled(promises);
        
        this.widgets.clear();
        this.containers.clear();
        this.root.innerHTML = '';
        this.initialized = false;
    }
}

// Экспортируем для использования в main.js
export default AppShell;
