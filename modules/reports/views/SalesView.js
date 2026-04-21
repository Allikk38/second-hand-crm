/**
 * Sales View Component
 * 
 * Представление отчета по продажам.
 * Включает сводку, график динамики и таблицу продаж.
 * 
 * @module SalesView
 * @version 1.0.0
 */

import { BaseComponent } from '../../../core/BaseComponent.js';
import { formatMoney, formatNumber, formatDate } from '../../../utils/formatters.js';

const CHART_COLORS = ['#0070f3', '#2e7d32', '#f57c00'];

export class SalesView extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            data: null,
            onLoadMore: null,
            ...options
        };
        this.chart = null;
        this.displayLimit = 50;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const data = this.options.data;
        if (!data) return this.renderEmptyState();
        
        const summary = data.summary || {};
        const sales = data.sales || [];
        const displayedSales = sales.slice(0, this.displayLimit);
        const hasMore = sales.length > this.displayLimit;
        
        return `
            <div class="sales-report-view">
                <div class="report-summary">
                    <div class="summary-card">
                        <span class="label">Всего продаж</span>
                        <span class="value">${formatNumber(summary.count || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Выручка</span>
                        <span class="value">${formatMoney(summary.revenue || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Прибыль</span>
                        <span class="value">${formatMoney(summary.profit || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Средний чек</span>
                        <span class="value">${formatMoney(summary.averageCheck || 0)}</span>
                    </div>
                </div>
                
                <div class="chart-card full-width">
                    <h4>Динамика продаж</h4>
                    <div class="chart-container large">
                        <canvas data-ref="salesChart" width="800" height="250"></canvas>
                    </div>
                </div>
                
                <div class="table-card">
                    <h4>Детализация продаж</h4>
                    <div class="table-container">
                        ${this.renderSalesTable(displayedSales)}
                    </div>
                    ${hasMore ? `
                        <div class="table-footer">
                            <button class="btn-secondary" data-ref="loadMoreBtn">
                                Загрузить еще (${sales.length - this.displayLimit})
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    renderSalesTable(sales) {
        if (!sales.length) {
            return '<div class="empty-message">Нет данных за выбранный период</div>';
        }
        
        return `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>Товары</th>
                        <th>Сумма</th>
                        <th>Скидка</th>
                        <th>Прибыль</th>
                        <th>Оплата</th>
                    </tr>
                </thead>
                <tbody>
                    ${sales.map(sale => `
                        <tr>
                            <td>${formatDate(sale.created_at, { withTime: true })}</td>
                            <td>${sale.items?.length || 0} поз.</td>
                            <td class="money">${formatMoney(sale.total)}</td>
                            <td>${sale.discount || 0}%</td>
                            <td class="money ${sale.profit >= 0 ? 'positive' : 'negative'}">
                                ${formatMoney(sale.profit || 0)}
                            </td>
                            <td>${this.getPaymentMethodName(sale.payment_method)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
    
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">💰</div>
                <p>Нет данных о продажах за выбранный период</p>
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        this.addDomListener('loadMoreBtn', 'click', () => {
            this.displayLimit += 50;
            this.update();
        });
    }
    
    // ========== ГРАФИКИ ==========
    
    async afterRender() {
        await this.loadChartJS();
        this.renderChart();
    }
    
    async loadChartJS() {
        if (window.Chart) return;
        
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
    }
    
    renderChart() {
        const canvas = this.refs.get('salesChart');
        if (!canvas || !window.Chart) return;
        
        const data = this.options.data?.daily || [];
        
        this.chart = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.map(d => formatDate(d.date, { format: 'short' })),
                datasets: [
                    {
                        label: 'Количество продаж',
                        data: data.map(d => d.count),
                        backgroundColor: CHART_COLORS[0],
                        yAxisID: 'y'
                    },
                    {
                        label: 'Выручка',
                        data: data.map(d => d.revenue),
                        type: 'line',
                        borderColor: CHART_COLORS[1],
                        backgroundColor: 'transparent',
                        yAxisID: 'y1',
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
                            label: (ctx) => {
                                if (ctx.dataset.label === 'Выручка') {
                                    return `Выручка: ${formatMoney(ctx.raw)}`;
                                }
                                return `${ctx.dataset.label}: ${ctx.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        title: { display: true, text: 'Количество' }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Выручка (₽)' },
                        ticks: {
                            callback: (val) => formatMoney(val, { showSymbol: false })
                        }
                    }
                }
            }
        });
    }
    
    // ========== УТИЛИТЫ ==========
    
    getPaymentMethodName(method) {
        const names = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' };
        return names[method] || method;
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
}
