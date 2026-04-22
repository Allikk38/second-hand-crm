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
 * @version 5.0.1
 * @changes
 * - Исправлен вызов метода mount() вместо init().
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
            const { CashierApp } = await import('./CashierApp.js');
            const rootElement = this.element.querySelector('#cashier-root');
            
            if (rootElement) {
                this.cashierApp = new CashierApp(rootElement);
                // Вызываем mount() вместо init()
                await this.cashierApp.mount();
                console.log('[CashierPage] CashierApp mounted successfully');
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
                    <button class="btn-primary" onclick="location.reload()">Обновить</button>
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
