/**
 * Formatters Utility
 * 
 * Централизованный модуль форматирования данных для всего приложения.
 * Предоставляет функции для форматирования валют, дат, чисел и текста.
 * 
 * Архитектурные решения:
 * - Все форматтеры используют Intl API для локализации (ru-RU).
 * - EscapeHtml оптимизирован через кэширование DOM-элемента.
 * - Интеграция с categorySchema.js для единого источника названий категорий.
 * - Отсутствие побочных эффектов — все функции чистые.
 * 
 * @module formatters
 * @version 2.1.0
 * @changes
 * - Устранено дублирование getCategoryName (используется из categorySchema.js).
 * - Добавлена formatDateTimeWithSeconds.
 * - Улучшен debounce с корректным this.
 * - Перегруппированы функции для читаемости.
 */

import { getCategoryName as getCategoryNameFromSchema } from './categorySchema.js';

// ========== ПРИВАТНЫЕ УТИЛИТЫ ==========

/**
 * Кэшированный DOM-элемент для экранирования HTML.
 * @type {HTMLDivElement|null}
 */
let escapeDiv = null;

function getEscapeDiv() {
    if (!escapeDiv) {
        escapeDiv = document.createElement('div');
    }
    return escapeDiv;
}

// ========== ФОРМАТИРОВАНИЕ ВАЛЮТ ==========

/**
 * Форматирует число как денежную сумму в рублях.
 * 
 * @param {number|null|undefined} amount - Сумма для форматирования
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.showSymbol=true] - Показывать символ валюты (₽)
 * @param {boolean} [options.showKopecks=false] - Показывать копейки
 * @returns {string} Отформатированная строка (например "1 500 ₽")
 */
export function formatMoney(amount, options = {}) {
    const { showSymbol = true, showKopecks = false } = options;
    
    if (amount === null || amount === undefined || isNaN(amount)) {
        amount = 0;
    }
    
    const formatter = new Intl.NumberFormat('ru-RU', {
        style: showSymbol ? 'currency' : 'decimal',
        currency: 'RUB',
        minimumFractionDigits: showKopecks ? 2 : 0,
        maximumFractionDigits: showKopecks ? 2 : 0
    });
    
    let result = formatter.format(amount);
    
    if (showSymbol) {
        result = result.replace('RUB', '₽').trim();
    }
    
    return result;
}

// ========== ФОРМАТИРОВАНИЕ ЧИСЕЛ ==========

/**
 * Форматирует число с разделителями разрядов.
 * 
 * @param {number|null|undefined} num - Число для форматирования
 * @param {number} [decimals=0] - Количество знаков после запятой
 * @returns {string} Отформатированное число
 */
export function formatNumber(num, decimals = 0) {
    if (num === null || num === undefined || isNaN(num)) {
        num = 0;
    }
    
    return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(num);
}

/**
 * Форматирует число как процент.
 * 
 * @param {number|null|undefined} value - Значение (0-100 или доля 0-1)
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.isFraction=false] - true если значение в долях
 * @param {number} [options.decimals=1] - Количество знаков после запятой
 * @returns {string} Отформатированный процент
 */
export function formatPercent(value, options = {}) {
    const { isFraction = false, decimals = 1 } = options;
    
    if (value === null || value === undefined || isNaN(value)) {
        value = 0;
    }
    
    const percentValue = isFraction ? value * 100 : value;
    
    return `${percentValue.toFixed(decimals).replace('.', ',')}%`;
}

// ========== ФОРМАТИРОВАНИЕ ДАТ ==========

/**
 * Форматирует дату в читаемый вид.
 * 
 * @param {string|Date|null} date - Дата для форматирования
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.withTime=false] - Включать время
 * @param {boolean} [options.short=false] - Краткий формат (ДД.ММ)
 * @returns {string} Отформатированная дата
 */
export function formatDate(date, options = {}) {
    const { withTime = false, short = false } = options;
    
    if (!date) return '';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    if (short) {
        return d.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit'
        });
    }
    
    const dateOptions = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    };
    
    if (withTime) {
        dateOptions.hour = '2-digit';
        dateOptions.minute = '2-digit';
    }
    
    return d.toLocaleDateString('ru-RU', dateOptions).replace(',', '');
}

/**
 * Форматирует дату и время для отображения в отчетах.
 * 
 * @param {string|Date|null} datetime - Дата и время
 * @returns {string} Отформатированная дата и время
 */
export function formatDateTime(datetime) {
    if (!datetime) return '';
    
    const d = new Date(datetime);
    if (isNaN(d.getTime())) return '';
    
    const dateStr = d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    
    const timeStr = d.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    return `${dateStr} ${timeStr}`;
}

/**
 * Форматирует дату и время с секундами.
 * 
 * @param {string|Date|null} datetime - Дата и время
 * @returns {string} Отформатированная дата и время с секундами
 */
export function formatDateTimeWithSeconds(datetime) {
    if (!datetime) return '';
    
    const d = new Date(datetime);
    if (isNaN(d.getTime())) return '';
    
    const dateStr = d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    
    const timeStr = d.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    return `${dateStr} ${timeStr}`;
}

/**
 * Возвращает относительное время (например "5 минут назад").
 * 
 * @param {string|Date} date - Дата для сравнения
 * @returns {string} Относительное время
 */
export function formatRelativeTime(date) {
    if (!date) return '';
    
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSec < 60) return 'только что';
    if (diffMin < 60) return `${diffMin} ${pluralize(diffMin, 'минуту', 'минуты', 'минут')} назад`;
    if (diffHours < 24) return `${diffHours} ${pluralize(diffHours, 'час', 'часа', 'часов')} назад`;
    if (diffDays < 7) return `${diffDays} ${pluralize(diffDays, 'день', 'дня', 'дней')} назад`;
    
    return formatDate(date);
}

// ========== ФОРМАТИРОВАНИЕ ТЕКСТА ==========

/**
 * Экранирует HTML-спецсимволы для безопасного вывода.
 * 
 * @param {string} str - Строка для экранирования
 * @returns {string} Экранированная строка
 */
export function escapeHtml(str) {
    if (!str && str !== 0) return '';
    
    const div = getEscapeDiv();
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Обрезает текст до указанной длины с добавлением многоточия.
 * 
 * @param {string} text - Исходный текст
 * @param {number} maxLength - Максимальная длина
 * @param {string} [ellipsis='...'] - Символ(ы) обрезания
 * @returns {string} Обрезанный текст
 */
export function truncateText(text, maxLength, ellipsis = '...') {
    if (!text || text.length <= maxLength) return text || '';
    return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Форматирует номер телефона в читаемый вид.
 * 
 * @param {string} phone - Номер телефона
 * @returns {string} Отформатированный номер
 */
export function formatPhone(phone) {
    if (!phone) return '';
    
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length === 11 && cleaned.startsWith('7')) {
        return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9, 11)}`;
    }
    
    return phone;
}

// ========== СКЛОНЕНИЕ ==========

/**
 * Склоняет существительное в зависимости от числа.
 * 
 * @param {number} count - Количество
 * @param {string} one - Форма для 1
 * @param {string} two - Форма для 2-4
 * @param {string} five - Форма для 5+
 * @returns {string} Правильная форма
 */
export function pluralize(count, one, two, five) {
    const n = Math.abs(count) % 100;
    const n1 = n % 10;
    
    if (n > 10 && n < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    
    return five;
}

// ========== СТАТУСЫ И КАТЕГОРИИ ==========

/**
 * Возвращает читаемое название статуса товара.
 * 
 * @param {string} status - Ключ статуса
 * @returns {string} Человекочитаемое название
 */
export function getStatusText(status) {
    const statusMap = {
        'in_stock': 'В наличии',
        'sold': 'Продан',
        'reserved': 'Забронирован',
        'draft': 'Черновик',
        'archived': 'В архиве'
    };
    
    return statusMap[status] || status || 'Неизвестно';
}

/**
 * Возвращает CSS-класс для статуса.
 * 
 * @param {string} status - Ключ статуса
 * @returns {string} CSS-класс
 */
export function getStatusClass(status) {
    return `status-${status || 'unknown'}`;
}

/**
 * Возвращает читаемое название категории.
 * Использует CATEGORY_SCHEMA как единый источник истины.
 * 
 * @param {string} category - Ключ категории
 * @returns {string} Человекочитаемое название
 */
export function getCategoryName(category) {
    return getCategoryNameFromSchema(category);
}

/**
 * Возвращает читаемое название способа оплаты.
 * 
 * @param {string} method - Ключ способа оплаты
 * @returns {string} Человекочитаемое название
 */
export function getPaymentMethodName(method) {
    const methodMap = {
        'cash': 'Наличные',
        'card': 'Карта',
        'transfer': 'Перевод',
        'qr': 'QR-код',
        'mixed': 'Смешанная'
    };
    
    return methodMap[method] || method || 'Не указано';
}

// ========== ВАЛИДАЦИЯ ==========

/**
 * Проверяет корректность email адреса.
 * 
 * @param {string} email - Email для проверки
 * @returns {boolean} true если email корректен
 */
export function isValidEmail(email) {
    if (!email) return false;
    
    const re = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
    return re.test(email);
}

/**
 * Проверяет, что строка не пустая после trim.
 * 
 * @param {string} str - Строка для проверки
 * @returns {boolean} true если строка содержит не только пробелы
 */
export function isNotEmpty(str) {
    return str && str.trim().length > 0;
}

// ========== ДЕБАУНС ==========

/**
 * Создает дебаунсированную версию функции.
 * 
 * @param {Function} fn - Исходная функция
 * @param {number} delay - Задержка в мс
 * @returns {Function} Дебаунсированная функция с правильным this
 */
export function debounce(fn, delay = 300) {
    let timer = null;
    
    return function debounced(...args) {
        const context = this;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(context, args), delay);
    };
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    formatMoney,
    formatNumber,
    formatPercent,
    formatDate,
    formatDateTime,
    formatDateTimeWithSeconds,
    formatRelativeTime,
    formatPhone,
    escapeHtml,
    truncateText,
    pluralize,
    getStatusText,
    getStatusClass,
    getCategoryName,
    getPaymentMethodName,
    isValidEmail,
    isNotEmpty,
    debounce
};
