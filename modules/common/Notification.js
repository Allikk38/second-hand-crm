/**
 * Notification Module
 * 
 * Показывает всплывающие уведомления.
 * Без анимаций, только статичные сообщения.
 * 
 * @module Notification
 * @version 2.0.0
 * @changes
 * - Использование CSS-классов вместо инлайн-стилей
 * - Убраны анимации
 * - Добавлена поддержка HTML в сообщениях
 * - Улучшена система очереди уведомлений
 */

import { EventBus } from '../../core/EventBus.js';

class NotificationClass {
    constructor() {
        this.container = null;
        this.defaultDuration = 4000;
        this.queue = [];
        this.isShowing = false;
        this.createContainer();
    }

    /**
     * Создает контейнер для уведомлений
     */
    createContainer() {
        if (document.getElementById('notification-container')) return;
        
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        document.body.appendChild(this.container);
    }

    /**
     * Показывает уведомление
     * @param {string|Object} message - Текст сообщения или объект с настройками
     * @param {string} type - Тип уведомления (success, error, warning, info)
     * @param {Object} options - Дополнительные опции
     */
    show(message, type = 'info', options = {}) {
        let config;
        
        if (typeof message === 'object') {
            config = message;
        } else {
            config = {
                message,
                type,
                title: options.title || this.getDefaultTitle(type),
                duration: options.duration || this.defaultDuration,
                html: options.html || false
            };
        }
        
        this.queue.push(config);
        this.processQueue();
    }

    /**
     * Получает заголовок по умолчанию для типа уведомления
     * @private
     */
    getDefaultTitle(type) {
        const titles = {
            success: 'Успешно',
            error: 'Ошибка',
            warning: 'Внимание',
            info: 'Информация'
        };
        return titles[type] || 'Уведомление';
    }

    /**
     * Обрабатывает очередь уведомлений
     * @private
     */
    async processQueue() {
        if (this.isShowing || this.queue.length === 0) return;
        
        this.isShowing = true;
        const notification = this.queue.shift();
        
        await this.render(notification);
        
        this.isShowing = false;
        this.processQueue();
    }

    /**
     * Рендерит уведомление
     * @private
     */
    render(config) {
        return new Promise((resolve) => {
            const notification = document.createElement('div');
            notification.className = `notification notification-${config.type}`;
            
            const iconHtml = this.getIconHtml(config.type);
            const contentHtml = config.html 
                ? config.message 
                : this.escapeHtml(config.message);
            
            notification.innerHTML = `
                <div class="notification-icon"></div>
                <div class="notification-content">
                    <div class="notification-title">${this.escapeHtml(config.title)}</div>
                    <div class="notification-message">${contentHtml}</div>
                </div>
                <button class="notification-close" aria-label="Закрыть">×</button>
            `;
            
            this.container.appendChild(notification);
            
            // Обработчик закрытия
            const closeBtn = notification.querySelector('.notification-close');
            closeBtn.addEventListener('click', () => {
                this.remove(notification);
                resolve();
            });
            
            // Авто-закрытие
            if (config.duration > 0) {
                setTimeout(() => {
                    if (notification.parentNode) {
                        this.remove(notification);
                        resolve();
                    }
                }, config.duration);
            }
        });
    }

    /**
     * Получает HTML иконки для типа уведомления
     * @private
     */
    getIconHtml(type) {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        return icons[type] || icons.info;
    }

    /**
     * Удаляет уведомление
     * @private
     */
    remove(notification) {
        if (notification && notification.parentNode) {
            notification.remove();
        }
    }

    /**
     * Экранирует HTML спецсимволы
     * @private
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Показывает успешное уведомление
     * @param {string} message - Сообщение
     * @param {Object} options - Опции
     */
    success(message, options = {}) {
        this.show(message, 'success', options);
    }

    /**
     * Показывает уведомление об ошибке
     * @param {string} message - Сообщение
     * @param {Object} options - Опции
     */
    error(message, options = {}) {
        this.show(message, 'error', options);
    }

    /**
     * Показывает предупреждение
     * @param {string} message - Сообщение
     * @param {Object} options - Опции
     */
    warning(message, options = {}) {
        this.show(message, 'warning', options);
    }

    /**
     * Показывает информационное уведомление
     * @param {string} message - Сообщение
     * @param {Object} options - Опции
     */
    info(message, options = {}) {
        this.show(message, 'info', options);
    }

    /**
     * Очищает все уведомления
     */
    clearAll() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.queue = [];
        this.isShowing = false;
    }
}

export const Notification = new NotificationClass();

// Подписываемся на ошибки приложения
EventBus.on('app:error', (error) => {
    const message = error.message || 'Произошла ошибка';
    Notification.error(message);
});
