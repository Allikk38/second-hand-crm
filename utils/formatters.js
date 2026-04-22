// ========================================
// FILE: ./utils/formatters.js
// ========================================

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
 * @version 2.0.0
 * @changes
 * - Добавлена JSDoc-документация для всех функций.
 * - Устранено дублирование с categorySchema.js.
 * - Добавлены новые функции: formatDateTime, formatPercent, truncateText.
 * - Оптимизирована escapeHtml через замыкание с кэшированным элементом.
 * - Исправлен баг в formatMoney при showSymbol = false.
 */

import { CATEGORY_SCHEMA } from './categorySchema.js';

// ========== ПРИВАТНЫЕ УТИЛИТЫ ==========

/**
 * Кэшированный DOM-элемент для экранирования HTML.
 * Создается один раз при первом вызове escapeHtml.
 * @type {HTMLDivElement|null}
 */
let escapeDiv = null;

/**
 * Ленивая инициализация элемента для экранирования.
 * @returns {HTMLDivElement}
 */
function getEscapeDiv() {
    if (!escapeDiv) {
        escapeDiv = document.createElement('div');
    }
    return escapeDiv;
}

// ========== ФОРМАТИРОВАНИЕ ВАЛЮТ ==========

/**
 * Форматирует число как денежную сумму в рублях.
 * Использует Intl.NumberFormat для корректного отображения разрядов.
 * 
 * @param {number|null|undefined} amount - Сумма для форматирования
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.showSymbol=true] - Показывать символ валюты (₽)
 * @param {boolean} [options.showKopecks=false] - Показывать копейки
 * @returns {string} Отформатированная строка (например "1 500 ₽" или "1 500")
 * 
 * @example
 * formatMoney(1500)                    // "1 500 ₽"
 * formatMoney(1500, { showSymbol: false }) // "1 500"
 * formatMoney(1500.50, { showKopecks: true }) // "1 500,50 ₽"
 * formatMoney(null)                    // "0 ₽"
 */
export function formatMoney(amount, options = {}) {
    const { showSymbol = true, showKopecks = false } = options;
    
    // Обработка некорректных значений
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
    
    // Intl возвращает "RUB" вместо "₽", заменяем на символ
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
 * @returns {string} Отформатированное число (например "1 234 567")
 * 
 * @example
 * formatNumber(1234567)     // "1 234 567"
 * formatNumber(1234.56, 2)  // "1 234,56"
 * formatNumber(null)        // "0"
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
 * @param {boolean} [options.isFraction=false] - true если значение в долях (0.15 = 15%)
 * @param {number} [options.decimals=1] - Количество знаков после запятой
 * @returns {string} Отформатированный процент (например "15,5%")
 * 
 * @example
 * formatPercent(15.5)                   // "15,5%"
 * formatPercent(0.155, { isFraction: true }) // "15,5%"
 * formatPercent(33.333, { decimals: 2 })     // "33,33%"
 */
export function formatPercent(value, options = {}) {
    const { isFraction = false, decimals = 1 } = options;
    
    if (value === null || value === undefined || isNaN(value)) {
        value = 0;
    }
    
    const percentValue = isFraction ? value * 100 : value;
    
    return `${percentValue.toFixed(decimals).replace('.', ',')}%`;
}

// ========== ФОРМАТИРОВАНИЕ ДАТ И ВРЕМЕНИ ==========

/**
 * Форматирует дату в читаемый вид.
 * 
 * @param {string|Date|null} date - Дата для форматирования
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.withTime=false] - Включать время
 * @param {boolean} [options.short=false] - Краткий формат (ДД.ММ)
 * @returns {string} Отформатированная дата
 * 
 * @example
 * formatDate('2024-01-15')                          // "15.01.2024"
 * formatDate('2024-01-15T14:30:00', { withTime: true }) // "15.01.2024 14:30"
 * formatDate('2024-01-15', { short: true })          // "15.01"
 */
export function formatDate(date, options = {}) {
    const { withTime = false, short = false } = options;
    
    if (!date) return '';
    
    const d = new Date(date);
    
    // Проверка валидности даты
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
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.includeSeconds=false] - Включать секунды
 * @returns {string} Отформатированная дата и время (например "15.01.2024 14:30")
 * 
 * @example
 * formatDateTime('2024-01-15T14:30:25')                    // "15.01.2024 14:30"
 * formatDateTime('2024-01-15T14:30:25', { includeSeconds: true }) // "15.01.2024 14:30:25"
 */
export function formatDateTime(datetime, options = {}) {
    const { includeSeconds = false } = options;
    
    if (!datetime) return '';
    
    const d = new Date(datetime);
    
    if (isNaN(d.getTime())) return '';
    
    const dateStr = d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    
    const timeOptions = {
        hour: '2-digit',
        minute: '2-digit'
    };
    
    if (includeSeconds) {
        timeOptions.second = '2-digit';
    }
    
    const timeStr = d.toLocaleTimeString('ru-RU', timeOptions);
    
    return `${dateStr} ${timeStr}`;
}

/**
 * Возвращает относительное время (например "5 минут назад").
 * 
 * @param {string|Date} date - Дата для сравнения
 * @returns {string} Относительное время на русском
 * 
 * @example
 * formatRelativeTime('2024-01-15T14:00:00') // "2 часа назад"
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
 * Экранирует HTML-спецсимволы для безопасного вывода пользовательских данных.
 * Оптимизировано через кэширование DOM-элемента.
 * 
 * @param {string} str - Строка для экранирования
 * @returns {string} Экранированная строка
 * 
 * @example
 * escapeHtml('<script>alert("xss")</script>') 
 * // "&lt;script&gt;alert("xss")&lt;/script&gt;"
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
 * 
 * @example
 * truncateText('Очень длинное название товара', 15) // "Очень длинное..."
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
 * 
 * @example
 * formatPhone('+79161234567') // "+7 (916) 123-45-67"
 */
export function formatPhone(phone) {
    if (!phone) return '';
    
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length === 11 && cleaned.startsWith('7')) {
        return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9, 11)}`;
    }
    
    return phone;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Склоняет существительное в зависимости от числа.
 * 
 * @param {number} count - Количество
 * @param {string} one - Форма для 1 (например "товар")
 * @param {string} two - Форма для 2-4 (например "товара")
 * @param {string} five - Форма для 5+ (например "товаров")
 * @returns {string} Правильная форма
 * 
 * @example
 * pluralize(1, 'товар', 'товара', 'товаров')  // "товар"
 * pluralize(3, 'товар', 'товара', 'товаров')  // "товара"
 * pluralize(5, 'товар', 'товара', 'товаров')  // "товаров"
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
 * @param {string} status - Ключ статуса (in_stock, sold, reserved)
 * @returns {string} Человекочитаемое название
 * 
 * @example
 * getStatusText('in_stock') // "В наличии"
 * getStatusText('unknown')  // "unknown"
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
 * 
 * @example
 * getStatusClass('in_stock') // "status-in_stock"
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
 * 
 * @example
 * getCategoryName('clothes') // "Одежда"
 * getCategoryName('unknown') // "unknown"
 */
export function getCategoryName(category) {
    return CATEGORY_SCHEMA[category]?.name || category || 'Другое';
}

/**
 * Возвращает читаемое название способа оплаты.
 * 
 * @param {string} method - Ключ способа оплаты
 * @returns {string} Человекочитаемое название
 * 
 * @example
 * getPaymentMethodName('cash') // "Наличные"
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
 * 
 * @example
 * isValidEmail('user@example.com') // true
 * isValidEmail('invalid-email')    // false
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

// ========== ДЕБАУНС И ТРОТТЛИНГ ==========

/**
 * Создает дебаунсированную версию функции.
 * 
 * @param {Function} fn - Исходная функция
 * @param {number} delay - Задержка в мс
 * @returns {Function} Дебаунсированная функция
 * 
 * @example
 * const debouncedSearch = debounce(searchProducts, 300);
 * searchInput.addEventListener('input', debouncedSearch);
 */
export function debounce(fn, delay = 300) {
    let timer = null;
    
    return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ========== ЭКСПОРТ ВСЕХ ФУНКЦИЙ ДЛЯ УДОБСТВА ==========

export default {
    formatMoney,
    formatNumber,
    formatPercent,
    formatDate,
    formatDateTime,
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
