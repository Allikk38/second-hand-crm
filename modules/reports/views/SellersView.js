/**
 * Sellers View Component
 * 
 * Представление отчета по продавцам.
 * Включает сводку, график и рейтинг продавцов.
 * 
 * @module SellersView
 * @version 1.0.0
 */

import { BaseComponent } from '../../../core/BaseComponent.js';
import { formatMoney, formatNumber } from '../../../utils/formatters.js';

const CHART_COLORS = ['#0070f3', '#2e7d32', '#f57c00', '#c62828', '#6a1b9a'];

export class SellersView extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            data: null,
            ...options
        };
        this.chart = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const data = this.options.data;
        if (!data) return this.renderEmptyState();
        
        const sellers = data.sellers || [];
        
        return `
            <div class="sellers-report-view">
                <div class="report-summary">
                    <div class="summary-card">
                        <span class="label">Всего продавцов</span>
                        <span class="value">${formatNumber(data.totalSellers || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Общая выручка</span>
                        <span class="value">${formatMoney(data.totalRevenue || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Общая прибыль</span>
                        <span class="value">${formatMoney(data.totalProfit || 0)}</span>
                    </div>
                </div>
                
                <div class="chart-card full-width">
                    <h4>Выручка по продавцам</h4>
                    <div class="chart-container large">
                        <canvas data-ref="sellersChart" width="800" height="250"></canvas>
                    </div>
                </div>
                
                <div class="table-card">
                    <h4>Рейтинг продавцов</h4>
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Продавец</th>
                                    <th>Смен</th>
                                    <th>Продаж</th>
                                    <th>Выручка</th>
                                    <th>Прибыль</th>
                                    <th>Средний чек</th>
                                    <th>За смену</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sellers.map((s, i) => `
                                    <tr>
                                        <td>${i + 1}</td>
                                        <td>
                                            <div class="seller-info">
                                                <span class="seller-name">${this.escapeHtml(s.name)}</span>
                                                <span class="seller-email">${this.escapeHtml(s.email)}</span>
                                            </div>
                                        </td>
                                        <td>${s.shiftsCount}</td>
                                        <td>${formatNumber(s.totalSales)}</td>
                                        <td class="money">${formatMoney(s.totalRevenue)}</td>
                                        <td class="money ${s.totalProfit >= 0 ? 'positive' : 'negative'}">
                                            ${formatMoney(s.totalProfit)}
                                        </td>
                                        <td>${formatMoney(s.averageCheck)}</td>
                                        <td>${formatMoney(s.averageShiftRevenue)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <p>Нет данных о продавцах за выбранный период</p>
            </div>
        `;
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
        const canvas = this.refs.get('sellersChart');
        if (!canvas || !window.Chart) return;
        
        const sellers = this.options.data?.sellers || [];
        
        this.chart = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels: sellers.map(s => s.name.split(' ')[0]),
                datasets: [{
                    label: 'Выручка',
                    data: sellers.map(s => s.totalRevenue),
                    backgroundColor: CHART_COLORS[0]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `Выручка: ${formatMoney(ctx.raw)}`
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
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
}
