/**
 * Модуль уведомлений
 * Показывает красивые всплывающие сообщения вместо alert()
 * 
 * @module Notification
 */

import { EventBus } from '../../core/EventBus.js';

class NotificationClass {
    constructor() {
        this.container = null;
        this.timeout = 3000;
        this.createContainer();
    }

    createContainer() {
        if (document.getElementById('notification-container')) return;
        
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(this.container);
    }

    show(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            padding: 12px 20px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-width: 280px;
            animation: slideIn 0.3s ease;
            border-left: 4px solid ${this.getBorderColor(type)};
        `;
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="flex: 1;">${message}</span>
                <button style="background: none; border: none; cursor: pointer; font-size: 18px; opacity: 0.5;">×</button>
            </div>
        `;
        
        this.container.appendChild(notification);
        
        const closeBtn = notification.querySelector('button');
        closeBtn.addEventListener('click', () => this.remove(notification));
        
        setTimeout(() => this.remove(notification), this.timeout);
    }

    getBorderColor(type) {
        const colors = {
            success: '#2e7d32',
            error: '#c62828',
            warning: '#f57c00',
            info: '#0070f3'
        };
        return colors[type] || colors.info;
    }

    remove(notification) {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }

    success(message) {
        this.show(message, 'success');
    }

    error(message) {
        this.show(message, 'error');
    }

    warning(message) {
        this.show(message, 'warning');
    }

    info(message) {
        this.show(message, 'info');
    }
}

export const Notification = new NotificationClass();

// Подписываемся на ошибки приложения
EventBus.on('app:error', (error) => {
    const message = error.message || 'Произошла ошибка';
    Notification.error(message);
});
