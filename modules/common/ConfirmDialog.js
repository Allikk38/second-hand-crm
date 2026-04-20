/**
 * Модальное окно подтверждения действия
 * Заменяет нативный confirm()
 * 
 * @module ConfirmDialog
 */

import { BaseComponent } from '../../core/BaseComponent.js';

export class ConfirmDialog extends BaseComponent {
    /**
     * @param {HTMLElement} container - Контейнер для диалога
     * @param {Object} options - Настройки
     * @param {string} options.title - Заголовок
     * @param {string} options.message - Сообщение
     * @param {string} options.confirmText - Текст кнопки подтверждения
     * @param {string} options.cancelText - Текст кнопки отмены
     * @param {string} options.type - Тип: 'danger', 'warning', 'info'
     */
    constructor(container, options = {}) {
        super(container);
        this.options = {
            title: 'Подтверждение',
            message: 'Вы уверены?',
            confirmText: 'Да',
            cancelText: 'Отмена',
            type: 'info',
            ...options
        };
        this.resolve = null;
    }

    render() {
        const typeClass = `confirm-${this.options.type}`;
        
        return `
            <div class="modal-overlay">
                <div class="modal confirm-dialog ${typeClass}">
                    <h3>${this.options.title}</h3>
                    <p class="confirm-message">${this.options.message}</p>
                    <div class="actions">
                        <button class="btn-secondary" data-action="cancel">
                            ${this.options.cancelText}
                        </button>
                        <button class="${this.getConfirmButtonClass()}" data-action="confirm">
                            ${this.options.confirmText}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    getConfirmButtonClass() {
        const classes = {
            danger: 'btn-danger',
            warning: 'btn-primary',
            info: 'btn-primary'
        };
        return classes[this.options.type] || 'btn-primary';
    }

    attachEvents() {
        this.element.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            this.close(false);
        });
        
        this.element.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            this.close(true);
        });
        
        // Закрытие по клику на оверлей
        this.element.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.close(false);
            }
        });
        
        // Закрытие по Escape
        this.handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                this.close(false);
            }
            if (e.key === 'Enter') {
                this.close(true);
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * Закрывает диалог и возвращает результат
     * @param {boolean} result - Результат (true - подтверждено)
     */
    close(result) {
        document.removeEventListener('keydown', this.handleKeyDown);
        this.destroy();
        if (this.resolve) {
            this.resolve(result);
        }
    }

    /**
     * Показывает диалог и возвращает Promise
     * @returns {Promise<boolean>}
     */
    async show() {
        await this.mount();
        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    }

    /**
     * Статический метод для быстрого показа диалога
     * @static
     * @param {Object} options - Настройки диалога
     * @returns {Promise<boolean>}
     */
    static async show(options) {
        const container = document.createElement('div');
        document.body.appendChild(container);
        
        const dialog = new ConfirmDialog(container, options);
        const result = await dialog.show();
        
        container.remove();
        return result;
    }
}
