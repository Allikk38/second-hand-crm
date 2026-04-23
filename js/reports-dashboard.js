// ========================================
// FILE: js/reports-dashboard.js
// ========================================

/**
 * Reports Dashboard Module
 * 
 * Рендеринг дашборда: KPI-карточки, графики, топ товаров и категорий.
 * 
 * Архитектурные решения:
 * - Чистые функции, отсутствие глобального состояния.
 * - Ленивая загрузка Chart.js.
 * - Все данные приходят извне (через параметры).
 * - Использование централизованных форматтеров.
 * 
 * @module reports-dashboard
 * @version 1.1.0
 * @changes
 * - Удалены локальные реализации getPaymentMethodName и getCategoryDisplayName.
 * - Добавлены импорты из formatters.js.
 */

import { formatMoney, formatNumber, formatPercent, formatDate, escapeHtml, getPaymentMethodName, getCategoryName } from '../utils/formatters.js';

// ========== КОНСТАНТЫ ==========

const CHART_COLORS = {
    primary: '#2563eb',
    success: '#16a34a',
    warning: '#ea580c',
    danger: '#dc2626',
    info: '#0284c7',
    purple: '#7c3aed'
};

// ========== РЕНДЕРИНГ KPI ==========

/**
 * Рендерит KPI-карточку
 * @param {Object} kpi - Данные KPI
 * @param {string} title - Заголовок
 * @param {string} value - Значение
 * @param {Object} trend - Тренд { direction, value }
 * @param {string} icon - Иконка
 * @returns {string} HTML карточки
 */
function renderKpiCard({ title, value, trend, icon }) {
    const trendHtml = trend ? `
        <span class="kpi-trend trend-${trend.direction}">
            ${trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
            ${trend.value}%
        </span>
    ` : '';
    
    return `
        <div class="kpi-card">
            <div class="kpi-header">
                <span class="kpi-icon">${icon}</span>
                <span class="kpi-title">${escapeHtml(title)}</span>
            </div>
            <div class="kpi-value">${value}</div>
            <div class="kpi-footer">${trendHtml}</div>
        </div>
    `;
}

/**
 * Рендерит все KPI карточки
 * @param {Object} overview - Данные обзора
 * @param {Object} trends - Тренды
 * @returns {string} HTML всех KPI
 */
function renderKpiGrid(overview, trends) {
    const kpis = [
        { title: '💰 Выручка', value: formatMoney(overview.revenue), trend: trends.revenue, icon: '💰' },
        { title: '🎯 Прибыль', value: formatMoney(overview.profit), trend: trends.profit, icon: '🎯' },
        { title: '📊 Маржа', value: formatPercent(overview.margin, { decimals: 1 }), trend: trends.margin, icon: '📊' },
        { title: '🛒 Продаж', value: formatNumber(overview.salesCount), trend: trends.salesCount, icon: '🛒' },
        { title: '💳 Средний чек', value: formatMoney(overview.averageCheck), trend: null, icon: '💳' },
        { title: '📦 Стоимость склада', value: formatMoney(overview.stockValue), trend: null, icon: '📦' }
    ];
    
    return `<div class="kpi-grid">${kpis.map(kpi => renderKpiCard(kpi)).join('')}</div>`;
}

// ========== РЕНДЕРИНГ ТОПОВ ==========

/**
 * Рендерит топ товаров
 * @param {Array} topProducts - Массив топ товаров
 * @returns {string} HTML списка
 */
function renderTopProducts(topProducts) {
    if (!topProducts || topProducts.length === 0) {
        return '<div class="empty-message">Нет данных</div>';
    }
    
    return `
        <div class="top-products-list">
            ${topProducts.slice(0, 5).map((p, i) => `
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
 * Рендерит топ категорий
 * @param {Array} topCategories - Массив топ категорий
 * @returns {string} HTML списка
 */
function renderTopCategories(topCategories) {
    if (!topCategories || topCategories.length === 0) {
        return '<div class="empty-message">Нет данных</div>';
    }
    
    return `
        <div class="top-products-list">
            ${topCategories.map((c, i) => `
                <div class="top-product-item">
                    <span class="rank">#${i + 1}</span>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(getCategoryName(c.category))}</div>
                        <div class="product-stats">${c.quantity} шт.</div>
                    </div>
                    <span class="product-revenue">${formatMoney(c.revenue)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// ========== ГРАФИКИ ==========

let chartsInstance = { sales: null, payment: null };

/**
 * Уничтожает существующие графики
 */
function destroyCharts() {
    if (chartsInstance.sales) {
        chartsInstance.sales.destroy();
        chartsInstance.sales = null;
    }
    if (chartsInstance.payment) {
        chartsInstance.payment.destroy();
        chartsInstance.payment = null;
    }
}

/**
 * Рендерит график продаж (линия)
 * @param {Array} daily - Данные по дням
 */
function renderSalesChart(daily) {
    const canvas = document.getElementById('salesChart');
    if (!canvas || !window.Chart) return;
    
    if (chartsInstance.sales) {
        chartsInstance.sales.destroy();
    }
    
    chartsInstance.sales = new window.Chart(canvas, {
        type: 'line',
        data: {
            labels: daily.map(d => formatDate(d.date, { short: true })),
            datasets: [
                {
                    label: 'Выручка',
                    data: daily.map(d => d.revenue),
                    borderColor: CHART_COLORS.primary,
                    backgroundColor: `rgba(37, 99, 235, 0.1)`,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Прибыль',
                    data: daily.map(d => d.profit),
                    borderColor: CHART_COLORS.success,
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: (val) => formatMoney(val, { showSymbol: false })
                    }
                }
            }
        }
    });
}

/**
 * Рендерит круговую диаграмму способов оплаты
 * @param {Array} paymentMethods - Данные по способам оплаты
 */
function renderPaymentChart(paymentMethods) {
    const canvas = document.getElementById('paymentChart');
    if (!canvas || !window.Chart) return;
    
    if (chartsInstance.payment) {
        chartsInstance.payment.destroy();
    }
    
    const totalRevenue = paymentMethods.reduce((sum, p) => sum + p.revenue, 0);
    
    chartsInstance.payment = new window.Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: paymentMethods.map(p => getPaymentMethodName(p.method)),
            datasets: [{
                data: paymentMethods.map(p => p.revenue),
                backgroundColor: [
                    CHART_COLORS.primary,
                    CHART_COLORS.success,
                    CHART_COLORS.warning,
                    CHART_COLORS.purple
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const item = paymentMethods[ctx.dataIndex];
                            const percent = totalRevenue > 0 
                                ? ((item.revenue / totalRevenue) * 100).toFixed(1) 
                                : '0';
                            return `${item.count} продаж (${percent}%) - ${formatMoney(item.revenue)}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Загружает Chart.js если ещё не загружен
 * @returns {Promise<void>}
 */
async function loadChartJs() {
    if (window.Chart) return;
    
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        script.onload = () => resolve();
        document.head.appendChild(script);
    });
}

/**
 * Рендерит все графики (основная функция)
 * @param {Array} daily - Данные по дням
 * @param {Array} paymentMethods - Данные по оплате
 */
async function renderCharts(daily, paymentMethods) {
    await loadChartJs();
    
    if (!window.Chart) {
        console.warn('[Dashboard] Chart.js not loaded');
        return;
    }
    
    destroyCharts();
    
    if (daily && daily.length > 0) {
        renderSalesChart(daily);
    }
    
    if (paymentMethods && paymentMethods.length > 0) {
        renderPaymentChart(paymentMethods);
    }
}

// ========== ОСНОВНАЯ ФУНКЦИЯ РЕНДЕРИНГА ==========

/**
 * Рендерит полный дашборд
 * @param {Object} data - Данные дашборда
 * @param {string} period - Текущий период (для отображения)
 * @returns {string} HTML дашборда
 */
export function renderDashboard(data, period) {
    const { overview, trends, daily, topProducts, topCategories, paymentMethods } = data;
    
    return `
        <div class="dashboard-view">
            ${renderKpiGrid(overview, trends)}
            
            <div class="charts-row">
                <div class="chart-card">
                    <h3>Динамика продаж</h3>
                    <div class="chart-container">
                        <canvas id="salesChart" width="400" height="200"></canvas>
                    </div>
                </div>
                
                <div class="chart-card">
                    <h3>Способы оплаты</h3>
                    <div class="chart-container">
                        <canvas id="paymentChart" width="200" height="200"></canvas>
                    </div>
                </div>
            </div>
            
            <div class="charts-row">
                <div class="chart-card">
                    <h3>🔥 Топ-5 товаров</h3>
                    ${renderTopProducts(topProducts)}
                </div>
                
                <div class="chart-card">
                    <h3>📂 Топ категорий</h3>
                    ${renderTopCategories(topCategories)}
                </div>
            </div>
        </div>
    `;
}

/**
 * Экспорт данных дашборда в CSV
 * @param {Object} data - Данные дашборда
 * @returns {string} CSV строка
 */
export function exportDashboardData(data) {
    const { overview, daily } = data;
    
    let csv = 'Дашборд\n\n';
    csv += 'Показатель,Значение\n';
    csv += `Выручка,${overview.revenue}\n`;
    csv += `Прибыль,${overview.profit}\n`;
    csv += `Маржа,${overview.margin.toFixed(1)}%\n`;
    csv += `Продаж,${overview.salesCount}\n`;
    csv += `Средний чек,${overview.averageCheck}\n`;
    csv += `Товаров в наличии,${overview.inStock}\n`;
    csv += `Стоимость склада,${overview.stockValue}\n`;
    
    csv += '\n\nДинамика по дням\n';
    csv += 'Дата,Выручка,Прибыль,Продаж\n';
    daily.forEach(d => {
        csv += `${d.date},${d.revenue},${d.profit},${d.count}\n`;
    });
    
    return csv;
}

// Экспорт функций для динамического импорта
export { renderCharts, destroyCharts };
