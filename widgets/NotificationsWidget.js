// ========================================
// FILE: ./widgets/NotificationsWidget.js
// ========================================

/**
 * Notifications Widget - Виджет всплывающих уведомлений
 * 
 * Отображает тосты (всплывающие сообщения) в ответ на системные события.
 * Поддерживает очередь сообщений и автоматическое скрытие.
 * 
 * Архитектурные решения:
 * - Наследуется от BaseWidget.
 * - Слушает EventTypes.UI.NOTIFICATION_SHOW.
 * - Сам управляет DOM-контейнером для уведомлений.
 * - Поддерживает очередь (до 5 сообщений одновременно).
 * 
 * @module NotificationsWidget
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { BaseWidget } from '../core-new/BaseWidget.js';
import { EventTypes } from '../core-new/EventBus.js';

// Константы конфигурации
const DEFAULT_DURATION = 4000; // 4 секунды
const MAX_QUEUE_SIZE = 5;

export class NotificationsWidget extends BaseWidget {
    constructor(container) {
        super(container);
        
        /** @type {Array<Object>} Очередь уведомлений */
        this.queue = [];
        
        /** @type {boolean} Показывается ли сейчас уведомление */
        this.isShowing = false;
        
        /** @type {number|null} Таймер авто-скрытия */
        this.hideTimer = null;
        
        /** @type {HTMLElement|null} Контейнер для уведомлений */
        this.notificationContainer = null;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        // Этот виджет не имеет видимого HTML до появления уведомлений
        return `
            <div class="notifications-widget" data-ref="container" style="position: fixed; top: 20px; right: 20px; z-index: 9999; width: 360px; max-width: calc(100vw - 40px); pointer-events: none;">
                <!-- Уведомления будут добавляться сюда динамически -->
            </div>
        `;
    }
    
    async afterRender() {
        // Сохраняем ссылку на контейнер
        this.notificationContainer = this.refs.get('container');
        
        // Настраиваем стили контейнера
        if (this.notificationContainer) {
            this.notificationContainer.style.display = 'flex';
            this.notificationContainer.style.flexDirection = 'column';
            this.notificationContainer.style.gap = '12px';
        }
    }
    
    attachEvents() {
        // Подписываемся на события показа уведомлений
        this.subscribe(EventTypes.UI.NOTIFICATION_SHOW, (data) => {
            this.addNotification(data);
        });
        
        // Также слушаем системные ошибки для автоматического показа
        this.subscribe(EventTypes.SYSTEM.ERROR, (data) => {
            // Не показываем дублирующие уведомления для ошибок, которые уже обработаны
            if (data.source === 'adapter:supabase' && !data.silent) {
                this.addNotification({
                    type: 'error',
                    title: 'Ошибка сервера',
                    message: data.error || 'Не удалось выполнить операцию',
                    duration: 6000
                });
            }
        });
    }
    
    beforeDestroy() {
        // Очищаем таймеры
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        
        // Очищаем очередь
        this.queue = [];
        this.isShowing = false;
        
        // Удаляем контейнер
        if (this.notificationContainer) {
            this.notificationContainer.remove();
            this.notificationContainer = null;
        }
        
        console.log('[NotificationsWidget] Cleaned up');
    }

    // ========== УПРАВЛЕНИЕ ОЧЕРЕДЬЮ ==========
    
    /**
     * Добавляет уведомление в очередь.
     * @param {Object} notification - Данные уведомления
     */
    addNotification(notification) {
        // Нормализуем данные
        const item = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            type: notification.type || 'info',
            title: notification.title || this.getDefaultTitle(notification.type),
            message: notification.message || '',
            duration: notification.duration || DEFAULT_DURATION,
            timestamp: Date.now()
        };
        
        // Ограничиваем размер очереди
        if (this.queue.length >= MAX_QUEUE_SIZE) {
            // Удаляем самое старое уведомление того же типа или первое в очереди
            const sameTypeIndex = this.queue.findIndex(n => n.type === item.type);
            if (sameTypeIndex !== -1) {
                this.queue.splice(sameTypeIndex, 1);
            } else {
                this.queue.shift();
            }
        }
        
        this.queue.push(item);
        
        console.log('[NotificationsWidget] Added to queue:', item.title);
        
        // Запускаем обработку очереди
        this.processQueue();
    }
    
    /**
     * Обрабатывает очередь уведомлений.
     */
    processQueue() {
        // Если уже показываем уведомление или очередь пуста — выходим
        if (this.isShowing || this.queue.length === 0) return;
        
        // Берем следующее уведомление
        const notification = this.queue.shift();
        
        // Показываем его
        this.showNotification(notification);
    }
    
    /**
     * Показывает конкретное уведомление.
     * @param {Object} notification - Уведомление для показа
     */
    showNotification(notification) {
        if (!this.notificationContainer) return;
        
        this.isShowing = true;
        
        // Создаем элемент уведомления
        const element = this.createNotificationElement(notification);
        
        // Добавляем в контейнер
        this.notificationContainer.appendChild(element);
        
        // Делаем элемент кликабельным для уведомлений
        element.style.pointerEvents = 'auto';
        
        // Анимируем появление
        requestAnimationFrame(() => {
            element.style.opacity = '1';
            element.style.transform = 'translateX(0)';
        });
        
        // Настраиваем авто-скрытие
        if (notification.duration > 0) {
            this.hideTimer = setTimeout(() => {
                this.hideNotification(element, notification.id);
            }, notification.duration);
        }
        
        console.log('[NotificationsWidget] Showing:', notification.title);
    }
    
    /**
     * Скрывает уведомление.
     * @param {HTMLElement} element - DOM-элемент уведомления
     * @param {string} id - ID уведомления
     */
    hideNotification(element, id) {
        if (!element || !element.parentNode) {
            this.finishHide();
            return;
        }
        
        // Анимируем скрытие
        element.style.opacity = '0';
        element.style.transform = 'translateX(100%)';
        
        // Удаляем после анимации
        setTimeout(() => {
            if (element.parentNode) {
                element.remove();
            }
            this.finishHide();
        }, 300);
    }
    
    /**
     * Завершает процесс скрытия и запускает следующее уведомление.
     */
    finishHide() {
        this.isShowing = false;
        
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        
        // Запускаем обработку следующего уведомления в очереди
        setTimeout(() => {
            this.processQueue();
        }, 100);
    }
    
    // ========== СОЗДАНИЕ DOM ==========
    
    /**
     * Создает DOM-элемент уведомления.
     * @param {Object} notification - Данные уведомления
     * @returns {HTMLElement}
     */
    createNotificationElement(notification) {
        const element = document.createElement('div');
        element.className = `notification notification-${notification.type}`;
        element.dataset.id = notification.id;
        
        // Базовые стили
        element.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 16px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.02);
            border-left: 4px solid;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: auto;
            cursor: pointer;
            backdrop-filter: blur(10px);
            background: rgba(255, 255, 255, 0.95);
        `;
        
        // Цвета для разных типов
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };
        
        element.style.borderLeftColor = colors[notification.type] || colors.info;
        
        // Иконка
        const icon = document.createElement('div');
        icon.className = 'notification-icon';
        icon.style.cssText = `
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            font-size: 14px;
            font-weight: 600;
        `;
        
        const iconColors = {
            success: { bg: '#d1fae5', color: '#065f46' },
            error: { bg: '#fee2e2', color: '#991b1b' },
            warning: { bg: '#fef3c7', color: '#92400e' },
            info: { bg: '#dbeafe', color: '#1e40af' }
        };
        
        const colorSet = iconColors[notification.type] || iconColors.info;
        icon.style.background = colorSet.bg;
        icon.style.color = colorSet.color;
        icon.textContent = this.getIconSymbol(notification.type);
        
        // Контент
        const content = document.createElement('div');
        content.className = 'notification-content';
        content.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        
        // Заголовок
        const title = document.createElement('div');
        title.className = 'notification-title';
        title.style.cssText = `
            font-weight: 600;
            font-size: 14px;
            color: #1f2937;
            margin-bottom: 4px;
        `;
        title.textContent = notification.title;
        
        // Сообщение
        const message = document.createElement('div');
        message.className = 'notification-message';
        message.style.cssText = `
            font-size: 13px;
            color: #6b7280;
            line-height: 1.4;
            word-break: break-word;
        `;
        message.textContent = notification.message;
        
        // Кнопка закрытия
        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.style.cssText = `
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            color: #9ca3af;
            font-size: 18px;
            cursor: pointer;
            border-radius: 6px;
            transition: background 0.15s;
        `;
        closeBtn.innerHTML = '×';
        closeBtn.setAttribute('aria-label', 'Закрыть');
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = '#f3f4f6';
            closeBtn.style.color = '#4b5563';
        });
        
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'transparent';
            closeBtn.style.color = '#9ca3af';
        });
        
        // Собираем элемент
        content.appendChild(title);
        content.appendChild(message);
        
        element.appendChild(icon);
        element.appendChild(content);
        element.appendChild(closeBtn);
        
        // Обработчики событий
        const handleClose = () => {
            if (this.hideTimer) {
                clearTimeout(this.hideTimer);
                this.hideTimer = null;
            }
            this.hideNotification(element, notification.id);
        };
        
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleClose();
        });
        
        element.addEventListener('click', () => {
            handleClose();
        });
        
        return element;
    }
    
    // ========== УТИЛИТЫ ==========
    
    /**
     * Возвращает символ иконки для типа уведомления.
     * @param {string} type - Тип уведомления
     * @returns {string}
     */
    getIconSymbol(type) {
        const symbols = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        return symbols[type] || symbols.info;
    }
    
    /**
     * Возвращает заголовок по умолчанию для типа уведомления.
     * @param {string} type - Тип уведомления
     * @returns {string}
     */
    getDefaultTitle(type) {
        const titles = {
            success: 'Успешно',
            error: 'Ошибка',
            warning: 'Внимание',
            info: 'Информация'
        };
        return titles[type] || titles.info;
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    /**
     * Очищает все уведомления.
     */
    clearAll() {
        this.queue = [];
        
        if (this.notificationContainer) {
            this.notificationContainer.innerHTML = '';
        }
        
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        
        this.isShowing = false;
        
        console.log('[NotificationsWidget] All notifications cleared');
    }
    
    /**
     * Показывает успешное уведомление (удобный хелпер).
     * @param {string} message - Сообщение
     * @param {string} title - Заголовок
     */
    success(message, title = 'Успешно') {
        this.addNotification({ type: 'success', title, message });
    }
    
    /**
     * Показывает уведомление об ошибке.
     * @param {string} message - Сообщение
     * @param {string} title - Заголовок
     */
    error(message, title = 'Ошибка') {
        this.addNotification({ type: 'error', title, message, duration: 6000 });
    }
    
    /**
     * Показывает предупреждение.
     * @param {string} message - Сообщение
     * @param {string} title - Заголовок
     */
    warning(message, title = 'Внимание') {
        this.addNotification({ type: 'warning', title, message });
    }
    
    /**
     * Показывает информационное уведомление.
     * @param {string} message - Сообщение
     * @param {string} title - Заголовок
     */
    info(message, title = 'Информация') {
        this.addNotification({ type: 'info', title, message });
    }
}

export default NotificationsWidget;
