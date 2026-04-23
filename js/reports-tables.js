// ========================================
// FILE: js/reports-tables.js
// ========================================

/**
 * Reports Tables Module
 * 
 * Рендеринг табличных отчетов: продажи, товары, смены.
 * Экспорт данных в CSV.
 * 
 * Архитектурные решения:
 * - Чистые функции, отсутствие глобального состояния.
 * - Каждая таблица рендерится отдельно.
 * - Экспорт через генерацию CSV.
 * - Использование централизованных форматтеров.
 * 
 * @module reports-tables
 * @version 1.2.0
 * @changes
 * - Удалено дублирование кода (файл был продублирован дважды).
 * - Исправлены экспорты для корректной работы с reports.js.
 * - Добавлены проверки на наличие данных.
 */

import { 
    formatMoney, 
    formatNumber, 
    formatDateTime, 
    formatDate, 
    escapeHtml, 
    getPaymentMethodName, 
    getCategoryName 
} from '../utils/formatters.js';

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Экранирует значение для CSV
 * @param {string} value - Значение
 * @returns {string}
 */
function escapeCsvValue(value) {
    if (!value && value !== 0) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// ========== ТАБЛИЦА ПРОДАЖ ==========

/**
 * Рендерит сводку продаж
 * @param {Object} summary - Сводка { count, revenue, profit, averageCheck }
 * @returns {string} HTML
 */
function renderSalesSummary(summary) {
    return `
        <div class="summary-cards">
            <div class="summary-card">
                <span class="label">Всего продаж</span>
                <span class="value">${formatNumber(summary?.count || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Выручка</span>
                <span class="value">${formatMoney(summary?.revenue || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Прибыль</span>
                <span class="value">${formatMoney(summary?.profit || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Средний чек</span>
                <span class="value">${formatMoney(summary?.averageCheck || 0)}</span>
            </div>
        </div>
    `;
}

/**
 * Рендерит таблицу продаж
 * @param {Object} data - Данные { summary, sales }
 * @returns {string} HTML
 */
export function renderSalesTable(data) {
    const { summary, sales } = data;
    
    if (!sales || sales.length === 0) {
        return `
            ${renderSalesSummary(summary)}
            <div class="empty-state">
                <div class="empty-state-icon">💰</div>
                <p>Нет продаж за выбранный период</p>
            </div>
        `;
    }
    
    return `
        ${renderSalesSummary(summary)}
        
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>Продавец</th>
                        <th>Товаров</th>
                        <th>Сумма</th>
                        <th>Прибыль</th>
                        <th>Оплата</th>
                    </tr>
                </thead>
                <tbody>
                    ${sales.slice(0, 50).map(sale => `
                        <tr>
                            <td>${formatDateTime(sale.created_at)}</td>
                            <td>${escapeHtml(sale.seller_name || 'Система')}</td>
                            <td>${sale.items?.length || 0} поз.</td>
                            <td class="money">${formatMoney(sale.total)}</td>
                            <td class="money">${formatMoney(sale.profit)}</td>
                            <td>${getPaymentMethodName(sale.payment_method)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${sales.length > 50 ? '<div class="table-footer">Показаны первые 50 записей</div>' : ''}
        </div>
    `;
}

/**
 * Экспорт таблицы продаж в CSV
 * @param {Object} data - Данные { sales }
 * @returns {string} CSV
 */
export function exportSalesData(data) {
    const { sales } = data;
    
    if (!sales || sales.length === 0) return '';
    
    let csv = 'Дата,Продавец,Товаров,Сумма,Прибыль,Оплата\n';
    
    sales.forEach(sale => {
        csv += `"${formatDateTime(sale.created_at)}",`;
        csv += `"${escapeCsvValue(sale.seller_name || 'Система')}",`;
        csv += `${sale.items?.length || 0},`;
        csv += `${sale.total || 0},`;
        csv += `${sale.profit || 0},`;
        csv += `"${getPaymentMethodName(sale.payment_method)}"\n`;
    });
    
    return csv;
}

// ========== ТАБЛИЦА ТОВАРОВ ==========

/**
 * Рендерит сводку товаров
 * @param {Object} data - Данные { inventoryValue, inventoryCost }
 * @returns {string} HTML
 */
function renderProductsSummary(data) {
    const potentialProfit = (data.inventoryValue || 0) - (data.inventoryCost || 0);
    
    return `
        <div class="summary-cards">
            <div class="summary-card">
                <span class="label">Стоимость склада</span>
                <span class="value">${formatMoney(data.inventoryValue || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Себестоимость</span>
                <span class="value">${formatMoney(data.inventoryCost || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Потенциальная прибыль</span>
                <span class="value ${potentialProfit >= 0 ? 'text-success' : 'text-danger'}">
                    ${formatMoney(potentialProfit)}
                </span>
            </div>
        </div>
    `;
}

/**
 * Рендерит топ продаваемых товаров
 * @param {Array} topProducts - Массив топ товаров
 * @returns {string} HTML
 */
function renderTopProductsTable(topProducts) {
    if (!topProducts || topProducts.length === 0) {
        return '<div class="empty-message">Нет данных</div>';
    }
    
    return `
        <div class="top-products-list">
            ${topProducts.slice(0, 10).map((p, i) => `
                <div class="top-product-item">
                    <span class="rank">#${i + 1}</span>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(p.name)}</div>
                        <div class="product-stats">${p.quantity} шт.</div>
                    </div>
                    <span class="product-revenue">${formatMoney(p.revenue)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Рендерит залежавшиеся товары
 * @param {Array} slowMoving - Массив залежавшихся товаров
 * @returns {string} HTML
 */
function renderSlowMovingTable(slowMoving) {
    if (!slowMoving || slowMoving.length === 0) {
        return '<div class="empty-message">Нет залежавшихся товаров</div>';
    }
    
    return `
        <div class="slow-list">
            ${slowMoving.slice(0, 10).map(p => `
                <div class="slow-item">
                    <span class="product-name">${escapeHtml(p.name)}</span>
                    <span class="days-badge">${p.daysInStock} дн.</span>
                    <span class="product-price">${formatMoney(p.price)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Рендерит таблицу товаров
 * @param {Object} data - Данные { topProducts, slowMoving, inventoryValue, inventoryCost }
 * @returns {string} HTML
 */
export function renderProductsTable(data) {
    const { topProducts, slowMoving, inventoryValue, inventoryCost } = data;
    
    return `
        ${renderProductsSummary({ inventoryValue, inventoryCost })}
        
        <div class="two-columns">
            <div class="card">
                <h4>🏆 Самые продаваемые</h4>
                ${renderTopProductsTable(topProducts)}
            </div>
            
            <div class="card">
                <h4>🐌 Залежавшиеся товары (>30 дней)</h4>
                ${renderSlowMovingTable(slowMoving)}
            </div>
        </div>
    `;
}

/**
 * Экспорт данных о товарах в CSV
 * @param {Object} data - Данные { topProducts, slowMoving }
 * @returns {string} CSV
 */
export function exportProductsData(data) {
    const { topProducts, slowMoving } = data;
    
    let csv = 'Топ продаваемых товаров\n';
    csv += 'Название,Количество,Выручка\n';
    
    (topProducts || []).forEach(p => {
        csv += `"${escapeCsvValue(p.name)}",${p.quantity},${p.revenue}\n`;
    });
    
    csv += '\n\nЗалежавшиеся товары\n';
    csv += 'Название,Дней на складе,Цена\n';
    
    (slowMoving || []).forEach(p => {
        csv += `"${escapeCsvValue(p.name)}",${p.daysInStock},${p.price}\n`;
    });
    
    return csv;
}

// ========== ТАБЛИЦА СМЕН ==========

/**
 * Рендерит сводку смен
 * @param {Object} summary - Сводка { totalShifts, activeShifts, totalRevenue, totalProfit }
 * @returns {string} HTML
 */
function renderShiftsSummary(summary) {
    return `
        <div class="summary-cards">
            <div class="summary-card">
                <span class="label">Всего смен</span>
                <span class="value">${formatNumber(summary?.totalShifts || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Активных смен</span>
                <span class="value">${formatNumber(summary?.activeShifts || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Выручка за период</span>
                <span class="value">${formatMoney(summary?.totalRevenue || 0)}</span>
            </div>
            <div class="summary-card">
                <span class="label">Прибыль за период</span>
                <span class="value">${formatMoney(summary?.totalProfit || 0)}</span>
            </div>
        </div>
    `;
}

/**
 * Рендерит статистику по продавцам
 * @param {Object} bySeller - Объект с данными по продавцам
 * @returns {string} HTML
 */
function renderBySellerTable(bySeller) {
    if (!bySeller || Object.keys(bySeller).length === 0) {
        return '<div class="empty-message">Нет данных по продавцам</div>';
    }
    
    return `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Продавец</th>
                        <th>Смен</th>
                        <th>Продаж</th>
                        <th>Выручка</th>
                        <th>Прибыль</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(bySeller).map(([name, stats]) => `
                        <tr>
                            <td>${escapeHtml(name)}</td>
                            <td>${stats.shifts}</td>
                            <td>${stats.salesCount}</td>
                            <td class="money">${formatMoney(stats.revenue)}</td>
                            <td class="money">${formatMoney(stats.profit)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Рендерит список смен
 * @param {Array} shifts - Массив смен
 * @returns {string} HTML
 */
function renderShiftsList(shifts) {
    if (!shifts || shifts.length === 0) {
        return '<div class="empty-message">Нет смен за период</div>';
    }
    
    return `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Открыта</th>
                        <th>Закрыта</th>
                        <th>Продавец</th>
                        <th>Длительность</th>
                        <th>Продаж</th>
                        <th>Выручка</th>
                        <th>Статус</th>
                    </tr>
                </thead>
                <tbody>
                    ${shifts.map(shift => `
                        <tr>
                            <td>${formatDateTime(shift.opened_at)}</td>
                            <td>${shift.closed_at ? formatDateTime(shift.closed_at) : '—'}</td>
                            <td>${escapeHtml(shift.seller_name)}</td>
                            <td>${shift.duration}</td>
                            <td>${shift.sales_count || 0}</td>
                            <td class="money">${formatMoney(shift.total_revenue || 0)}</td>
                            <td>
                                <span class="status-badge ${shift.closed_at ? 'status-in_stock' : 'status-reserved'}">
                                    ${shift.closed_at ? 'Закрыта' : 'Активна'}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Рендерит таблицу смен
 * @param {Object} data - Данные { shifts, bySeller, summary }
 * @returns {string} HTML
 */
export function renderShiftsTable(data) {
    const { shifts, bySeller, summary } = data;
    
    return `
        ${renderShiftsSummary(summary)}
        
        <div class="card" style="margin-bottom: 24px;">
            <h4>👥 Статистика по продавцам</h4>
            ${renderBySellerTable(bySeller)}
        </div>
        
        <div class="card">
            <h4>📋 Список смен</h4>
            ${renderShiftsList(shifts)}
        </div>
    `;
}

/**
 * Экспорт данных о сменах в CSV
 * @param {Object} data - Данные { shifts }
 * @returns {string} CSV
 */
export function exportShiftsData(data) {
    const { shifts } = data;
    
    if (!shifts || shifts.length === 0) return '';
    
    let csv = 'Открыта,Закрыта,Продавец,Длительность,Продаж,Выручка,Прибыль,Статус\n';
    
    shifts.forEach(shift => {
        csv += `"${formatDateTime(shift.opened_at)}",`;
        csv += `"${shift.closed_at ? formatDateTime(shift.closed_at) : ''}",`;
        csv += `"${escapeCsvValue(shift.seller_name)}",`;
        csv += `"${shift.duration}",`;
        csv += `${shift.sales_count || 0},`;
        csv += `${shift.total_revenue || 0},`;
        csv += `${shift.total_profit || 0},`;
        csv += `"${shift.closed_at ? 'Закрыта' : 'Активна'}"\n`;
    });
    
    return csv;
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    renderSalesTable,
    renderProductsTable,
    renderShiftsTable,
    exportSalesData,
    exportProductsData,
    exportShiftsData
};
