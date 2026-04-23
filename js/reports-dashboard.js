// ========================================
// FILE: js/reports-dashboard.js
// ========================================

/**
 * Reports Dashboard Module
 * 
 * Рендеринг дашборда с KPI, графиками и аналитикой.
 * Использует Chart.js для визуализации данных.
 * 
 * Архитектурные решения:
 * - Chart.js загружается динамически только при рендеринге дашборда.
 * - Все функции экспортируются для использования в reports.js.
 * - Поддерживается экспорт данных в CSV.
 * 
 * @module reports-dashboard
 * @version 1.0.0
 * @changes
 * - Создан с нуля для исправления ошибки "renderDashboard is not a function".
 * - Реализован рендеринг KPI, графиков и топ-товаров.
 * - Добавлена загрузка Chart.js через CDN.
 */

import { formatMoney, formatNumber, formatPercent, escapeHtml, getCategoryName } from '../utils/formatters.js';

// ========== ПЕРЕМЕННЫЕ ДЛЯ ГРАФИКОВ ==========

let revenueChart = null;
let categoryChart = null;
let chartJsLoaded = false;

// ========== ЗАГРУЗКА CHART.JS ==========

/**
 * Динамически загружает Chart.js
 * @returns {Promise<void>}
 */
async function loadChartJs() {
    if (chartJsLoaded) return;
    
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        script.onload = () => {
            chartJsLoaded = true;
            resolve();
        };
        script.onerror = () => reject(new Error('Failed to load Chart.js'));
        document.head.appendChild(script);
    });
}

// ========== РЕНДЕРИНГ KPI ==========

/**
 * Рендерит карточки KPI
 * @param {Object} data - Данные дашборда
 * @returns {string} HTML
 */
function renderKpiCards(data) {
    const { overview, trends } = data;
    
    const kpis = [
        {
            title: 'Выручка',
            value: formatMoney(overview.revenue),
            trend: trends.revenue,
            icon: '💰',
            formatValue: (v) => formatMoney(v)
        },
        {
            title: 'Прибыль',
            value: formatMoney(overview.profit),
            trend: trends.profit,
            icon: '📈',
            formatValue: (v) => formatMoney(v)
        },
        {
            title: 'Маржинальность',
            value: formatPercent(overview.margin, { isFraction: false, decimals: 1 }),
            trend: trends.margin,
            icon: '🎯',
            formatValue: (v) => formatPercent(v, { isFraction: false })
        },
        {
            title: 'Количество продаж',
            value: formatNumber(overview.salesCount),
            trend: trends.salesCount,
            icon: '🛒',
            formatValue: (v) => formatNumber(v)
        }
    ];
    
    return `
        <div class="kpi-grid">
            ${kpis.map(kpi => {
                const trendIcon = kpi.trend.direction === 'up' ? '↑' : 
                                  kpi.trend.direction === 'down' ? '↓' : '→';
                const trendClass = kpi.trend.direction === 'up' ? 'trend-up' : 
                                   kpi.trend.direction === 'down' ? 'trend-down' : 'trend-neutral';
                
                return `
                    <div class="kpi-card">
                        <div class="kpi-header">
                            <span class="kpi-icon">${kpi.icon}</span>
                            <span class="kpi-title">${kpi.title}</span>
                        </div>
                        <div class="kpi-value">${kpi.value}</div>
                        <div class="kpi-footer">
                            <span class="trend ${trendClass}">
                                ${trendIcon} ${kpi.trend.value}%
                            </span>
                            <span class="trend-period">vs предыдущий период</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ========== РЕНДЕРИНГ ДОПОЛНИТЕЛЬНЫХ ПОКАЗАТЕЛЕЙ ==========

/**
 * Рендерит дополнительные показатели склада
 * @param {Object} overview - Данные overview
 * @returns {string} HTML
 */
function renderInventoryKpis(overview) {
    return `
        <div class="kpi-grid" style="margin-top: var(--spacing-4);">
            <div class="kpi-card">
                <div class="kpi-header">
                    <span class="kpi-icon">📦</span>
                    <span class="kpi-title">Товаров в наличии</span>
                </div>
                <div class="kpi-value">${formatNumber(overview.inStock)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-header">
                    <span class="kpi-icon">💵</span>
                    <span class="kpi-title">Стоимость склада</span>
                </div>
                <div class="kpi-value">${formatMoney(overview.stockValue)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-header">
                    <span class="kpi-icon">✨</span>
                    <span class="kpi-title">Потенциальная прибыль</span>
                </div>
                <div class="kpi-value ${overview.potentialProfit >= 0 ? 'text-success' : 'text-danger'}">
                    ${formatMoney(overview.potentialProfit)}
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-header">
                    <span class="kpi-icon">🧾</span>
                    <span class="kpi-title">Средний чек</span>
                </div>
                <div class="kpi-value">${formatMoney(overview.averageCheck)}</div>
            </div>
        </div>
    `;
}

// ========== РЕНДЕРИНГ ТОП-ТОВАРОВ ==========

/**
 * Рендерит список топ-товаров
 * @param {Array} topProducts - Массив топ-товаров
 * @returns {string} HTML
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
                    <div class="name">${escapeHtml(p.name)}</div>
                    <div class="value">${p.quantity} шт.</div>
                    <div class="revenue">${formatMoney(p.revenue)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

// ========== РЕНДЕРИНГ ТОП-КАТЕГОРИЙ ==========

/**
 * Рендерит список топ-категорий
 * @param {Array} topCategories - Массив топ-категорий
 * @returns {string} HTML
 */
function renderTopCategories(topCategories) {
    if (!topCategories || topCategories.length === 0) {
        return '<div class="empty-message">Нет данных</div>';
    }
    
    return `
        <div class="top-products-list">
            ${topCategories.slice(0, 5).map((c, i) => `
                <div class="top-product-item">
                    <span class="rank">#${i + 1}</span>
                    <div class="name">${getCategoryName(c.category)}</div>
                    <div class="value">${c.quantity} шт.</div>
                    <div class="revenue">${formatMoney(c.revenue)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

// ========== РЕНДЕРИНГ ГРАФИКОВ (КАНВАСЫ) ==========

/**
 * Рендерит контейнеры для графиков
 * @returns {string} HTML
 */
function renderChartContainers() {
    return `
        <div class="charts-row">
            <div class="chart-card">
                <h4>📊 Выручка и прибыль по дням</h4>
                <div class="chart-container">
                    <canvas id="revenueChart"></canvas>
                </div>
            </div>
            <div class="chart-card">
                <h4>🥧 Распределение по категориям</h4>
                <div class="chart-container">
                    <canvas id="categoryChart"></canvas>
                </div>
            </div>
        </div>
    `;
}

// ========== ОТРИСОВКА ГРАФИКОВ ==========

/**
 * Отрисовывает график выручки и прибыли
 * @param {Array} dailyData - Данные по дням
 */
function drawRevenueChart(dailyData) {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return;
    
    // Уничтожаем предыдущий график если есть
    if (revenueChart) {
        revenueChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    const labels = dailyData.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    });
    
    const revenueData = dailyData.map(d => d.revenue);
    const profitData = dailyData.map(d => d.profit);
    
    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Выручка',
                    data: revenueData,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Прибыль',
                    data: profitData,
                    borderColor: '#16a34a',
                    backgroundColor: 'rgba(22, 163, 74, 0.1)',
                    tension: 0.3,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatMoney(context.raw);
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => formatMoney(value)
                    }
                }
            }
        }
    });
}

/**
 * Отрисовывает круговую диаграмму по категориям
 * @param {Array} categoriesData - Данные по категориям
 */
function drawCategoryChart(categoriesData) {
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;
    
    if (categoryChart) {
        categoryChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    const labels = categoriesData.map(c => getCategoryName(c.category));
    const data = categoriesData.map(c => c.revenue);
    
    const colors = [
        '#2563eb', '#16a34a', '#ea580c', '#0284c7', '#7c3aed',
        '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#475569'
    ];
    
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 12,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = formatMoney(context.raw);
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = ((context.raw / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percent}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ========== ПУБЛИЧНЫЕ ФУНКЦИИ ==========

/**
 * Рендерит дашборд
 * @param {Object} data - Данные дашборда
 * @param {string} period - Выбранный период
 * @returns {string} HTML
 */
export function renderDashboard(data, period) {
    const { overview, topProducts, topCategories } = data;
    
    const periodNames = {
        today: 'Сегодня',
        yesterday: 'Вчера',
        week: 'Неделя',
        month: 'Месяц',
        quarter: 'Квартал',
        year: 'Год'
    };
    
    const periodName = periodNames[period] || period;
    
    return `
        <div class="dashboard-content">
            <div style="margin-bottom: var(--spacing-4);">
                <span class="period-label">Период: ${periodName}</span>
            </div>
            
            ${renderKpiCards(data)}
            ${renderInventoryKpis(overview)}
            ${renderChartContainers()}
            
            <div class="dashboard-bottom">
                <div class="card">
                    <h4>🏆 Топ-5 товаров</h4>
                    ${renderTopProducts(topProducts)}
                </div>
                <div class="card">
                    <h4>📂 Топ-5 категорий</h4>
                    ${renderTopCategories(topCategories)}
                </div>
            </div>
        </div>
    `;
}

/**
 * Отрисовывает графики (вызывается после рендеринга HTML)
 * @param {Array} dailyData - Данные по дням
 * @param {Array} paymentMethods - Данные по способам оплаты
 */
export async function renderCharts(dailyData, paymentMethods) {
    try {
        await loadChartJs();
        
        if (dailyData && dailyData.length > 0) {
            drawRevenueChart(dailyData);
        }
        
        if (paymentMethods && paymentMethods.length > 0) {
            drawCategoryChart(paymentMethods);
        }
    } catch (error) {
        console.error('[Dashboard] Failed to render charts:', error);
    }
}

/**
 * Экспорт данных дашборда в CSV
 * @param {Object} data - Данные дашборда
 * @returns {string} CSV
 */
export function exportDashboardData(data) {
    const { overview, daily, topProducts } = data;
    
    let csv = 'Показатель,Значение\n';
    csv += `Выручка,${overview.revenue}\n`;
    csv += `Прибыль,${overview.profit}\n`;
    csv += `Маржинальность,${overview.margin.toFixed(1)}%\n`;
    csv += `Количество продаж,${overview.salesCount}\n`;
    csv += `Товаров в наличии,${overview.inStock}\n`;
    csv += `Стоимость склада,${overview.stockValue}\n`;
    csv += `Средний чек,${overview.averageCheck.toFixed(2)}\n`;
    
    csv += '\n\nДата,Выручка,Прибыль,Количество продаж\n';
    daily.forEach(d => {
        csv += `${d.date},${d.revenue},${d.profit},${d.count}\n`;
    });
    
    csv += '\n\nТоп товаров\n';
    csv += 'Название,Количество,Выручка\n';
    topProducts.forEach(p => {
        csv += `"${p.name}",${p.quantity},${p.revenue}\n`;
    });
    
    return csv;
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    renderDashboard,
    renderCharts,
    exportDashboardData
};
