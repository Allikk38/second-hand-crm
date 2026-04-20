/**
 * Formatters Utility
 * 
 * Функции форматирования данных для отображения
 * 
 * @module formatters
 */

/**
 * Форматирует число как денежную сумму в рублях
 * @param {number} amount - Сумма
 * @param {Object} options - Дополнительные опции
 * @param {boolean} options.showSymbol - Показывать символ валюты
 * @param {number} options.minFractionDigits - Минимальное кол-во знаков после запятой
 * @param {number} options.maxFractionDigits - Максимальное кол-во знаков после запятой
 * @returns {string} Отформатированная строка
 */
export function formatMoney(amount, options = {}) {
    const {
        showSymbol = true,
        minFractionDigits = 0,
        maxFractionDigits = 0
    } = options;
    
    if (amount === null || amount === undefined || isNaN(amount)) {
        return showSymbol ? '0 ₽' : '0';
    }
    
    const formatter = new Intl.NumberFormat('ru-RU', {
        style: showSymbol ? 'currency' : 'decimal',
        currency: 'RUB',
        minimumFractionDigits: minFractionDigits,
        maximumFractionDigits: maxFractionDigits
    });
    
    let result = formatter.format(amount);
    
    // Intl добавляет символ "RUB" вместо "₽" в некоторых браузерах
    if (showSymbol && result.includes('RUB')) {
        result = result.replace('RUB', '₽').trim();
    }
    
    return result;
}

/**
 * Форматирует дату в локальный формат
 * @param {string|Date} date - Дата
 * @param {Object} options - Опции форматирования
 * @returns {string}
 */
export function formatDate(date, options = {}) {
    if (!date) return '';
    
    const {
        withTime = false,
        format = 'short'
    } = options;
    
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) return '';
    
    const dateOptions = {
        short: { day: '2-digit', month: '2-digit', year: 'numeric' },
        long: { day: 'numeric', month: 'long', year: 'numeric' },
        relative: undefined // Будет реализовано позже
    };
    
    const opts = dateOptions[format] || dateOptions.short;
    
    if (withTime) {
        opts.hour = '2-digit';
        opts.minute = '2-digit';
    }
    
    return dateObj.toLocaleDateString('ru-RU', opts);
}

/**
 * Форматирует число с разделителями разрядов
 * @param {number} num - Число
 * @returns {string}
 */
export function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return new Intl.NumberFormat('ru-RU').format(num);
}

/**
 * Форматирует процент
 * @param {number} value - Значение (0-100)
 * @param {number} decimals - Кол-во знаков после запятой
 * @returns {string}
 */
export function formatPercent(value, decimals = 1) {
    if (value === null || value === undefined || isNaN(value)) return '0%';
    return `${value.toFixed(decimals)}%`;
}

/**
 * Сокращает число (1.2K, 1.5M)
 * @param {number} num - Число
 * @returns {string}
 */
export function formatCompactNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    
    const formatter = new Intl.NumberFormat('ru-RU', {
        notation: 'compact',
        compactDisplay: 'short'
    });
    
    return formatter.format(num);
}
