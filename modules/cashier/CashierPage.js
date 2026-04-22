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
 * @version 6.0.1
 * @changes
 * - Исправлен вызов метода mount() вместо init().
 * - Добавлена проверка существования метода.
 * - Обновлен cache-busting.
 */

import { BaseComponent } from '../../core/BaseComponent.js';

export class CashierPage extends BaseComponent {
    constructor(container) {
        super(container);
        this.cashierApp = null;
    }

    /**
     * Рендерит чистый контейнер для кассового модуля.
     * @returns {Promise<string>}
     */
    async render() {
        return `
            <div class="cashier-page-container">
                <div id="cashier-root" class="cashier-app-wrapper"></div>
            </div>
        `;
    }

    /**
     * Монтирует компонент и запускает CashierApp.
     */
    async mount() {
        await super.mount();
        
        // Ленивая загрузка основного приложения кассы
        try {
            // Принудительно обновляем кэш модуля
            const cacheBust = `v=${Date.now()}`;
            const { CashierApp } = await import(`./CashierApp.js?${cacheBust}`);
            const rootElement = this.element.querySelector('#cashier-root');
            
            if (rootElement) {
                this.cashierApp = new CashierApp(rootElement);
                
                // Проверяем, какой метод доступен
                if (typeof this.cashierApp.mount === 'function') {
                    await this.cashierApp.mount();
                    console.log('[CashierPage] CashierApp mounted successfully via mount()');
                } else if (typeof this.cashierApp.init === 'function') {
                    await this.cashierApp.init();
                    console.log('[CashierPage] CashierApp initialized successfully via init()');
                } else {
                    throw new Error('CashierApp has neither mount() nor init() method');
                }
            } else {
                console.error('[CashierPage] Root element #cashier-root not found');
                this.container.innerHTML = `<div class="error-state">Ошибка загрузки интерфейса кассы</div>`;
            }
        } catch (error) {
            console.error('[CashierPage] Failed to load CashierApp:', error);
            this.container.innerHTML = `
                <div class="error-state">
                    <div class="error-state-icon">⚠️</div>
                    <h3>Ошибка загрузки модуля кассы</h3>
                    <p>${this.escapeHtml(error.message)}</p>
                    <button class="btn-primary" onclick="location.reload(true)">Обновить (очистить кэш)</button>
                </div>
            `;
        }
    }

    /**
     * Очистка ресурсов при уничтожении страницы.
     */
    beforeDestroy() {
        if (this.cashierApp && typeof this.cashierApp.destroy === 'function') {
            this.cashierApp.destroy();
        }
        this.cashierApp = null;
    }
}
