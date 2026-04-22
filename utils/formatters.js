// ========================================
// FILE: ./utils/formatters.js
// ========================================

/**
 * Форматирует число как денежную сумму
 */
export function formatMoney(amount, showSymbol = true) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return showSymbol ? '0 ₽' : '0';
    }
    
    const formatter = new Intl.NumberFormat('ru-RU', {
        style: showSymbol ? 'currency' : 'decimal',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    
    return formatter.format(amount).replace('RUB', '₽');
}

/**
 * Форматирует число с разделителями
 */
export function formatNumber(num) {
    if (num === null || isNaN(num)) return '0';
    return new Intl.NumberFormat('ru-RU').format(num);
}

/**
 * Форматирует дату
 */
export function formatDate(date, withTime = false) {
    if (!date) return '';
    const d = new Date(date);
    
    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    };
    
    if (withTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    
    return d.toLocaleDateString('ru-RU', options);
}

/**
 * Экранирует HTML
 */
export function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Получает текст статуса
 */
export function getStatusText(status) {
    const map = {
        in_stock: 'В наличии',
        sold: 'Продан',
        reserved: 'Забронирован'
    };
    return map[status] || status;
}

/**
 * Получает название категории
 */
export function getCategoryName(cat) {
    const names = {
        clothes: 'Одежда',
        toys: 'Игрушки',
        dishes: 'Посуда',
        other: 'Другое'
    };
    return names[cat] || cat;
}

/**
 * Получает название способа оплаты
 */
export function getPaymentMethodName(method) {
    const names = {
        cash: 'Наличные',
        card: 'Карта',
        transfer: 'Перевод'
    };
    return names[method] || method;
}
