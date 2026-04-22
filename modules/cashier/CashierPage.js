// ========================================
// FILE: ./modules/cashier/CashierPage.js
// ========================================

/**
 * Cashier Page Controller
 * 
 * Тонкий контроллер страницы кассы. 
 * Отвечает только за создание контейнера и запуск основного приложения кассы.
 * 
 * Архитектурные решения:
 * - Полный переход на CashierApp и глобальный Store.
 * - Удалена вся бизнес-логика и работа со стейтом.
 * - Соответствует паттерну MPA (точка входа).
 * 
 * @module CashierPage
 * @version 6.0.3
 * @changes
 * - Исправлен экспорт: добавлен именованный экспорт для совместимости с Router.
 * - Добавлено детальное логирование для диагностики проблем монтирования.
 * - Добавлена обработка ошибок с выводом в консоль и UI.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { createLogger } from '../../utils/logger.js';

// ========== LOGGER ==========
const logger = createLogger('CashierPage');

export class CashierPage extends BaseComponent {
    constructor(container) {
        super(container);
        this.cashierApp = null;
        
        logger.debug('CashierPage constructed', { 
            containerExists: !!container,
            containerId: container?.id 
        });
    }

    /**
     * Рендерит чистый контейнер для кассового модуля.
     * @returns {Promise<string>}
     */
    async render() {
        logger.debug('CashierPage render() called');
        
        const html = `
            <div class="cashier-page-container">
                <div id="cashier-root" class="cashier-app-wrapper"></div>
            </div>
        `;
        
        logger.debug('CashierPage render() completed');
        return html;
    }

    /**
     * Монтирует компонент и запускает CashierApp.
     */
    async mount() {
        logger.debug('CashierPage mount() started');
        
        try {
            // Вызываем родительский mount (рендерит HTML)
            logger.debug('Calling super.mount()');
            await super.mount();
            logger.debug('super.mount() completed, element exists:', !!this.element);
            
            // Проверяем, что элемент создан
            if (!this.element) {
                throw new Error('CashierPage: element is null after super.mount()');
            }
            
            // Находим root-элемент для CashierApp
            const rootElement = this.element.querySelector('#cashier-root');
            
            if (!rootElement) {
                logger.error('Root element #cashier-root not found', { 
                    elementHTML: this.element.innerHTML.substring(0, 200) 
                });
                throw new Error('Root element #cashier-root not found in rendered HTML');
            }
            
            logger.debug('Found root element for CashierApp', { 
                rootExists: !!rootElement,
                rootId: rootElement.id 
            });
            
            // Ленивая загрузка основного приложения кассы
            logger.debug('Importing CashierApp module');
            const cacheBust = `v=${Date.now()}`;
            const module = await import(`./CashierApp.js?${cacheBust}`);
            const { CashierApp } = module;
            
            logger.debug('CashierApp module loaded', { 
                CashierAppExists: !!CashierApp 
            });
            
            // Создаём экземпляр
            this.cashierApp = new CashierApp(rootElement);
            logger.debug('CashierApp instance created');
            
            // Проверяем наличие метода mount
            if (typeof this.cashierApp.mount !== 'function') {
                logger.error('CashierApp has no mount() method', {
                    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(this.cashierApp))
                });
                throw new Error('CashierApp instance has no mount() method');
            }
            
            // Монтируем
            logger.debug('Calling cashierApp.mount()');
            await this.cashierApp.mount();
            logger.info('CashierApp mounted successfully');
            
        } catch (error) {
            logger.error('Failed to mount CashierPage', {
                error: error.message,
                stack: error.stack,
                name: error.name
            });
            
            // Показываем ошибку в UI
            this.container.innerHTML = `
                <div class="error-state">
                    <div class="error-state-icon">⚠️</div>
                    <h3>Ошибка загрузки кассы</h3>
                    <p>${this.escapeHtml(error.message)}</p>
                    <details style="margin-top: 16px; text-align: left;">
                        <summary>Техническая информация</summary>
                        <pre style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; overflow: auto; font-size: 12px;">${this.escapeHtml(error.stack || 'No stack trace')}</pre>
                    </details>
                    <button class="btn-primary" onclick="location.reload(true)" style="margin-top: 16px;">
                        Обновить страницу (очистить кэш)
                    </button>
                    <button class="btn-secondary" onclick="window.location.hash = '/inventory'" style="margin-left: 8px; margin-top: 16px;">
                        На склад
                    </button>
                </div>
            `;
            
            throw error;
        }
    }

    /**
     * Очистка ресурсов при уничтожении страницы.
     */
    beforeDestroy() {
        logger.debug('CashierPage beforeDestroy() called');
        
        if (this.cashierApp) {
            if (typeof this.cashierApp.destroy === 'function') {
                this.cashierApp.destroy();
            }
            this.cashierApp = null;
        }
        
        logger.debug('CashierPage destroyed');
    }
}

// Экспортируем и как default, и как именованный для совместимости
export default CashierPage;
