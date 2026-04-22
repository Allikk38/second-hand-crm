// ========================================
// FILE: ./modules/reports/views/DashboardView.js
// ========================================

/**
 * Dashboard View Component
 * 
 * Представление дашборда с KPI, графиками и алертами.
 * 
 * Архитектурные решения:
 * - Чистый презентационный компонент.
 * - Получает данные через пропсы.
 * - Ленивая загрузка Chart.js.
 * 
 * @module DashboardView
 * @version 1.0.1
 * @changes
 * - Исправлены пути импорта на относительные (../../../ вместо корневых).
 * - Добавлен именованный экспорт для совместимости.
 */

import { BaseComponent } from '../../../core/BaseComponent.js';
import { formatMoney, formatNumber, formatPercent } from '../../../utils/formatters.js';
import { getCategoryName } from '../../../utils/categorySchema.js';

const CHART_COLORS = [
    '#0070f3', '#2e7d32', '#f57c00', '#c62828', '#6a1b9a',
    '#00838f', '#e65100', '#1565c0', '#ad1457', '#2e7d32'
];

export class DashboardView extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            data: null,
            permissions: {},
            ...options
        };
        this.charts = new Map();
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const data = this.options.data;
        if (!data) return this.renderEmptyState();
        
        const trends = data.trends || {};
        const alerts = data.alerts || [];
        
        return `
            <div class="dashboard-view">
                <div class="kpi-grid">
                    ${this.renderKpiCard('Выручка', formatMoney(data.overview?.sales?.revenue || 0), trends.revenue, '💰')}
                    ${this.renderKpiCard('Прибыль', formatMoney(data.overview?.sales?.profit || 0), trends.profit, '📈')}
                    ${this.renderKpiCard('Маржа', formatPercent(data.overview?.sales?.margin || 0), null, '🎯')}
                    ${this.renderKpiCard('Продаж', formatNumber(data.overview?.sales?.count || 0), trends.salesCount, '🛒')}
                    ${this.renderKpiCard('Средний чек', formatMoney(data.overview?.sales?.averageCheck || 0), trends.averageCheck, '💳')}
                    ${this.renderKpiCard('В наличии', formatNumber(data.overview?.products?.inStock || 0), null, '📦')}
                </div>
                
                <div class="charts-row">
                    <div class="chart-card">
                        <h4>Выручка и прибыль по дням</h4>
                        <div class="chart-container">
                            <canvas data-ref="revenueChart" width="400" height="200"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <h4>Продажи по категориям</h4>
                        <div class="chart-container">
                            <canvas data-ref="categoriesChart" width="300" height="200"></canvas>
                        </div>
                    </div>
                </div>
                
                <div class="dashboard-bottom">
                    <div class="card">
                        <h4>🔥 Топ товаров</h4>
                        <div class="top-products-list">
                            ${(data.topProducts || []).slice(0, 5).map((p, i) => `
                                <div class="top-product-item">
                                    <span class="rank">#${i + 1}</span>
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="value">${formatNumber(p.quantity)} шт.</span>
                                    <span class="revenue">${formatMoney(p.revenue)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    ${alerts.length > 0 ? `
                        <div class="card alerts-card">
                            <h4>⚠️ Важное</h4>
                            <div class="alerts-list">
                                ${alerts.map(alert => `
                                    <div class="alert-item alert-${alert.type}">
                                        <span class="alert-icon">${this.getAlertIcon(alert.type)}</span>
                                        <span class="alert-message">${alert.message}</span>
                                        <span class="alert-value">${alert.value}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    renderKpiCard(title, value, trend, icon) {
        const trendHtml = trend ? `
            <span class="trend trend-${trend.direction}">
                ${trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
                ${trend.value}%
            </span>
        ` : '';
        
        return `
            <div class="kpi-card">
                <div class="kpi-header">
                    <span class="kpi-icon">${icon}</span>
                    <span class="kpi-title">${title}</span>
                </div>
                <div class="kpi-value">${value}</div>
                <div class="kpi-footer">${trendHtml}</div>
            </div>
        `;
    }
    
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>Нет данных за выбранный период</p>
            </div>
        `;
    }
    
    getAlertIcon(type) {
        const icons = { success: '✅', warning: '⚠️', danger: '🚨', info: 'ℹ️' };
        return icons[type] || 'ℹ️';
    }
    
    // ========== ГРАФИКИ ==========
    
    async afterRender() {
        await this.loadChartJS();
        this.renderCharts();
    }
    
    async loadChartJS() {
        if (window.Chart) return;
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    renderCharts() {
        if (!window.Chart) return;
        
        this.renderRevenueChart();
        this.renderCategoriesChart();
    }
    
    renderRevenueChart() {
        const canvas = this.refs.get('revenueChart');
        if (!canvas) return;
        
        const data = this.options.data?.sales?.daily || [];
        
        const chart = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })),
                datasets: [
                    {
                        label: 'Выручка',
                        data: data.map(d => d.revenue),
                        borderColor: CHART_COLORS[0],
                        backgroundColor: 'transparent',
                        tension: 0.3
                    },
                    {
                        label: 'Прибыль',
                        data: data.map(d => d.profit),
                        borderColor: CHART_COLORS[1],
                        backgroundColor: 'transparent',
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`
                        }
                    }
                }
            }
        });
        
        this.charts.set('revenue', chart);
    }
    
    renderCategoriesChart() {
        const canvas = this.refs.get('categoriesChart');
        if (!canvas) return;
        
        const categories = this.options.data?.overview?.categories || {};
        const labels = Object.keys(categories).map(cat => getCategoryName(cat));
        const values = Object.values(categories).map(cat => cat.sold || 0);
        
        const chart = new window.Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: CHART_COLORS,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
        
        this.charts.set('categories', chart);
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.charts.forEach(chart => chart.destroy());
        this.charts.clear();
    }
}

// Экспортируем и как default, и как именованный для совместимости
export default DashboardView;
