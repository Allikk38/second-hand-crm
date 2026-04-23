// ========================================
// FILE: utils/ui.js
// ========================================

/**
 * UI Utilities Module
 * 
 * Централизованные функции для отображения уведомлений и модальных окон.
 * Устраняет дублирование кода в страницах приложения.
 * 
 * Архитектурные решения:
 * - Ленивая инициализация контейнеров при первом вызове.
 * - Все модальные окна возвращают Promise для асинхронной обработки.
 * - Поддержка нескольких одновременных уведомлений.
 * - Автоматическое скрытие уведомлений через 4 секунды.
 * 
 * @module ui
 * @version 1.0.0
 */

import { escapeHtml } from './formatters.js';

// ========== КОНСТАНТЫ ==========

const NOTIFICATION_CONTAINER_ID = 'sh-notification-container';
const MODAL_CONTAINER_ID = 'sh-modal-container';
const NOTIFICATION_AUTO_HIDE_MS = 4000;
const NOTIFICATION_MAX_COUNT = 5;

// ========== ПРИВАТНЫЕ ФУНКЦИИ ==========

/**
 * Получает или создаёт контейнер для уведомлений
 * @returns {HTMLElement}
 */
function getNotificationContainer() {
    let container = document.getElementById(NOTIFICATION_CONTAINER_ID);
    
    if (!container) {
        container = document.createElement('div');
        container.id = NOTIFICATION_CONTAINER_ID;
        container.style.cssText = `
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-width: 360px;
            width: calc(100% - 32px);
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }
    
    return container;
}

/**
 * Получает или создаёт контейнер для модальных окон
 * @returns {HTMLElement}
 */
function getModalContainer() {
    let container = document.getElementById(MODAL_CONTAINER_ID);
    
    if (!container) {
        container = document.createElement('div');
        container.id = MODAL_CONTAINER_ID;
        document.body.appendChild(container);
    }
    
    return container;
}

/**
 * Удаляет старые уведомления при превышении лимита
 * @param {HTMLElement} container
 */
function trimOldNotifications(container) {
    const notifications = container.querySelectorAll('.sh-notification');
    if (notifications.length >= NOTIFICATION_MAX_COUNT) {
        for (let i = 0; i < notifications.length - NOTIFICATION_MAX_COUNT + 1; i++) {
            notifications[i]?.remove();
        }
    }
}

// ========== ПУБЛИЧНЫЕ ФУНКЦИИ ==========

/**
 * Показывает уведомление в правом верхнем углу
 * 
 * @param {string} message - Текст уведомления
 * @param {string} [type='info'] - Тип: 'success', 'error', 'warning', 'info'
 * @param {Object} [options] - Дополнительные опции
 * @param {number} [options.duration=4000] - Время показа в мс
 * @param {string} [options.title] - Заголовок уведомления
 * @returns {HTMLElement} Созданный элемент уведомления
 */
export function showNotification(message, type = 'info', options = {}) {
    const { duration = NOTIFICATION_AUTO_HIDE_MS, title = '' } = options;
    
    const container = getNotificationContainer();
    trimOldNotifications(container);
    
    // Иконки по типу
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    const icon = icons[type] || icons.info;
    
    const notification = document.createElement('div');
    notification.className = `sh-notification sh-notification-${type}`;
    notification.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 16px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        border-left: 4px solid;
        pointer-events: auto;
        animation: sh-slide-in 0.2s ease-out;
    `;
    
    // Цвета границы по типу
    const borderColors = {
        success: '#16a34a',
        error: '#dc2626',
        warning: '#ea580c',
        info: '#0284c7'
    };
    notification.style.borderLeftColor = borderColors[type] || borderColors.info;
    
    // Добавляем стили анимации если их ещё нет
    if (!document.getElementById('sh-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'sh-notification-styles';
        style.textContent = `
            @keyframes sh-slide-in {
                from { opacity: 0; transform: translateX(100%); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes sh-slide-out {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(100%); }
            }
        `;
        document.head.appendChild(style);
    }
    
    notification.innerHTML = `
        <div style="
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            font-weight: bold;
            font-size: 14px;
            flex-shrink: 0;
            background: ${borderColors[type]}15;
            color: ${borderColors[type]};
        ">${icon}</div>
        <div style="flex: 1; min-width: 0;">
            ${title ? `<div style="font-weight: 600; margin-bottom: 2px; color: #0f172a;">${escapeHtml(title)}</div>` : ''}
            <div style="font-size: 14px; color: #475569; word-break: break-word;">${escapeHtml(message)}</div>
        </div>
        <button style="
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 18px;
            cursor: pointer;
            border-radius: 4px;
            flex-shrink: 0;
            padding: 0;
        " onclick="this.closest('.sh-notification').remove()">×</button>
    `;
    
    container.appendChild(notification);
    
    // Автоматическое скрытие
    if (duration > 0) {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'sh-slide-out 0.2s ease-in';
                setTimeout(() => notification.remove(), 200);
            }
        }, duration);
    }
    
    return notification;
}

/**
 * Показывает модальное окно подтверждения
 * 
 * @param {Object} options - Опции модального окна
 * @param {string} options.title - Заголовок
 * @param {string} options.message - Сообщение
 * @param {string} [options.confirmText='Да'] - Текст кнопки подтверждения
 * @param {string} [options.cancelText='Нет'] - Текст кнопки отмены
 * @param {string} [options.confirmClass='btn-primary'] - CSS класс кнопки подтверждения
 * @param {string} [options.cancelClass='btn-secondary'] - CSS класс кнопки отмены
 * @returns {Promise<boolean>} true если подтверждено, false если отменено
 */
export function showConfirmDialog(options = {}) {
    const {
        title = 'Подтверждение',
        message = 'Вы уверены?',
        confirmText = 'Да',
        cancelText = 'Нет',
        confirmClass = 'btn-primary',
        cancelClass = 'btn-secondary'
    } = options;
    
    return new Promise((resolve) => {
        const container = getModalContainer();
        
        const overlay = document.createElement('div');
        overlay.className = 'sh-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(15, 23, 42, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 16px;
        `;
        
        const modal = document.createElement('div');
        modal.className = 'sh-modal sh-confirm-dialog';
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            width: 100%;
            max-width: 440px;
            overflow: hidden;
        `;
        
        modal.innerHTML = `
            <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #0f172a;">${escapeHtml(title)}</h3>
            </div>
            <div style="padding: 24px; text-align: center;">
                <div style="margin-bottom: 16px; color: #475569; font-size: 15px; line-height: 1.5;">${escapeHtml(message)}</div>
            </div>
            <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; gap: 12px; justify-content: flex-end; background: #f8fafc;">
                <button class="sh-modal-cancel ${cancelClass}" style="
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    border: 1px solid #e2e8f0;
                    background: white;
                    color: #475569;
                ">${escapeHtml(cancelText)}</button>
                <button class="sh-modal-confirm ${confirmClass}" style="
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    border: none;
                    background: #2563eb;
                    color: white;
                ">${escapeHtml(confirmText)}</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        container.appendChild(overlay);
        
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        
        // Обработчики закрытия
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });
        
        modal.querySelector('.sh-modal-cancel').addEventListener('click', () => close(false));
        modal.querySelector('.sh-modal-confirm').addEventListener('click', () => close(true));
        
        // Закрытие по Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                close(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Фокус на кнопку подтверждения
        setTimeout(() => modal.querySelector('.sh-modal-confirm').focus(), 100);
    });
}

/**
 * Показывает модальное окно выбора способа оплаты
 * 
 * @param {number} total - Сумма к оплате
 * @returns {Promise<string|null>} Способ оплаты ('cash', 'card', 'transfer') или null при отмене
 */
export function showPaymentModal(total) {
    const formatMoney = (amount) => {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0
        }).format(amount).replace('RUB', '₽').trim();
    };
    
    return new Promise((resolve) => {
        const container = getModalContainer();
        
        const overlay = document.createElement('div');
        overlay.className = 'sh-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(15, 23, 42, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 16px;
        `;
        
        const modal = document.createElement('div');
        modal.className = 'sh-modal sh-payment-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            width: 100%;
            max-width: 400px;
            overflow: hidden;
        `;
        
        modal.innerHTML = `
            <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #0f172a;">Выберите способ оплаты</h3>
            </div>
            <div style="padding: 24px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 14px; color: #64748b;">Сумма к оплате</span>
                    <div style="font-size: 32px; font-weight: 700; color: #0f172a; margin-top: 4px;">${formatMoney(total)}</div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button class="sh-payment-option" data-method="cash" style="
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 8px;
                        padding: 16px;
                        background: white;
                        border: 2px solid #e2e8f0;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.15s;
                    ">
                        <span style="font-size: 32px;">💵</span>
                        <span style="font-size: 14px; font-weight: 500; color: #0f172a;">Наличные</span>
                    </button>
                    <button class="sh-payment-option" data-method="card" style="
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 8px;
                        padding: 16px;
                        background: white;
                        border: 2px solid #e2e8f0;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.15s;
                    ">
                        <span style="font-size: 32px;">💳</span>
                        <span style="font-size: 14px; font-weight: 500; color: #0f172a;">Карта</span>
                    </button>
                    <button class="sh-payment-option" data-method="transfer" style="
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 8px;
                        padding: 16px;
                        background: white;
                        border: 2px solid #e2e8f0;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.15s;
                    ">
                        <span style="font-size: 32px;">📱</span>
                        <span style="font-size: 14px; font-weight: 500; color: #0f172a;">Перевод</span>
                    </button>
                </div>
            </div>
            <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; background: #f8fafc;">
                <button class="sh-modal-cancel" style="
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    border: 1px solid #e2e8f0;
                    background: white;
                    color: #475569;
                ">Отмена</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        container.appendChild(overlay);
        
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        
        // Обработчики закрытия
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
        
        modal.querySelector('.sh-modal-cancel').addEventListener('click', () => close(null));
        
        // Обработчики выбора способа оплаты
        modal.querySelectorAll('.sh-payment-option').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.borderColor = '#2563eb';
                btn.style.background = '#eff6ff';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.borderColor = '#e2e8f0';
                btn.style.background = 'white';
            });
            btn.addEventListener('click', () => {
                close(btn.dataset.method);
            });
        });
        
        // Закрытие по Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                close(null);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Показывает модальное окно с формой ввода
 * 
 * @param {Object} options - Опции
 * @param {string} options.title - Заголовок
 * @param {string} options.label - Подпись поля ввода
 * @param {string} [options.placeholder] - Плейсхолдер
 * @param {string} [options.defaultValue=''] - Значение по умолчанию
 * @param {string} [options.type='text'] - Тип поля (text, number, email)
 * @param {string} [options.confirmText='OK'] - Текст кнопки подтверждения
 * @returns {Promise<string|null>} Введённое значение или null при отмене
 */
export function showPromptDialog(options = {}) {
    const {
        title = 'Ввод',
        label = 'Значение',
        placeholder = '',
        defaultValue = '',
        type = 'text',
        confirmText = 'OK'
    } = options;
    
    return new Promise((resolve) => {
        const container = getModalContainer();
        
        const overlay = document.createElement('div');
        overlay.className = 'sh-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(15, 23, 42, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 16px;
        `;
        
        const modal = document.createElement('div');
        modal.className = 'sh-modal sh-prompt-dialog';
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            width: 100%;
            max-width: 400px;
            overflow: hidden;
        `;
        
        modal.innerHTML = `
            <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #0f172a;">${escapeHtml(title)}</h3>
            </div>
            <div style="padding: 24px;">
                <label style="display: block; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(label)}</label>
                <input type="${type}" class="sh-prompt-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 15px;
                    box-sizing: border-box;
                ">
            </div>
            <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; gap: 12px; justify-content: flex-end; background: #f8fafc;">
                <button class="sh-modal-cancel" style="
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    border: 1px solid #e2e8f0;
                    background: white;
                    color: #475569;
                ">Отмена</button>
                <button class="sh-modal-confirm" style="
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    border: none;
                    background: #2563eb;
                    color: white;
                ">${escapeHtml(confirmText)}</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        container.appendChild(overlay);
        
        const input = modal.querySelector('.sh-prompt-input');
        
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
        
        modal.querySelector('.sh-modal-cancel').addEventListener('click', () => close(null));
        modal.querySelector('.sh-modal-confirm').addEventListener('click', () => close(input.value));
        
        // Отправка по Enter
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                close(input.value);
            }
        });
        
        // Закрытие по Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                close(null);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Фокус на поле ввода
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    });
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    showNotification,
    showConfirmDialog,
    showPaymentModal,
    showPromptDialog
};
