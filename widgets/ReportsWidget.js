// ========================================
// FILE: ./widgets/ReportsWidget.js
// ========================================

/**
 * Reports Widget - Виджет отчетов и аналитики
 * 
 * Отображает дашборд с KPI, графики продаж и таблицы с данными.
 * Поддерживает выбор периода и переключение между разными отчетами.
 * 
 * Архитектурные решения:
 * - Наследуется от BaseWidget.
 * - Ленивая загрузка Chart.js через CDN.
 * - Все данные запрашиваются через EventBus.
 * - Адаптивные карточки KPI с трендами.
 * 
 * @module ReportsWidget
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { BaseWidget } from '../core-new/BaseWidget.js';
import { EventTypes, EventSource } from '../core-new/EventBus.js';

// Константы периодов
const PERIODS = [
    { value: 'today', label: 'Сегодня' },
    { value: 'yesterday', label: 'Вчера' },
    { value: 'week', label: 'Неделя' },
    { value: 'month', label: 'Месяц' }
];

const TABS = [
    { id: 'dashboard', label: '📊 Дашборд' },
    { id: 'sales', label: '💰 Продажи' },
    { id: 'products', label: '📦 Товары' }
];

export class ReportsWidget extends BaseWidget {
    constructor(container) {
        super(container);
        
        // Состояние виджета
        this.state = {
            activeTab: 'dashboard',
            period: 'week',
            customStartDate: null,
            customEndDate: null,
            isLoading: false,
            data: {
                dashboard: null,
                sales: null,
                products: null
            }
        };
        
        // Кэш графиков
        this.charts = new Map();
        
        // Флаг загрузки Chart.js
        this.chartJsLoaded = false;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const { activeTab, period, isLoading, data } = this.state;
        
        return `
            <div class="reports-widget">
                <div class="reports-header">
                    <h2>📈 Отчеты и аналитика</h2>
                    
                    <div class="period-selector">
                        <select data-ref="periodSelect" class="period-select">
                            ${PERIODS.map(p => `
                                <option value="${p.value}" ${period === p.value ? 'selected' : ''}>
                                    ${p.label}
                                </option>
                            `).join('')}
                        </select>
                        
                        <button class="btn-secondary btn-sm" data-ref="refreshBtn" ${isLoading ? 'disabled' : ''}>
                            ${isLoading ? '🔄 Загрузка...' : '🔄 Обновить'}
                        </button>
                    </div>
                </div>
                
                <div class="reports-tabs">
                    ${TABS.map(tab => `
                        <button 
                            class="tab-btn ${activeTab === tab.id ? 'active' : ''}"
                            data-tab="${tab.id}"
                        >
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>
                
                <div class="reports-content" data-ref="contentContainer">
                    ${isLoading ? this.renderLoader() : this.renderActiveTab()}
                </div>
            </div>
        `;
    }
    
    renderLoader() {
        return `
            <div class="reports-loader">
                <div class="loading-spinner large"></div>
                <span>Загрузка данных...</span>
            </div>
        `;
    }
    
    renderActiveTab() {
        const { activeTab, data } = this.state;
        
        switch (activeTab) {
            case 'dashboard':
                return this.renderDashboard(data.dashboard);
            case 'sales':
                return this.renderSalesReport(data.sales);
            case 'products':
                return this.renderProductsReport(data.products);
            default:
                return '<div class="empty-state">Выберите отчет</div>';
        }
    }
    
    renderDashboard(dashboardData) {
        if (!dashboardData) {
            return this.renderEmptyState('Нет данных для отображения');
        }
        
        const { overview, trends, topProducts, alerts } = dashboardData;
        
        return `
            <div class="dashboard-view">
                <div class="kpi-grid">
                    ${this.renderKpiCard('💰 Выручка', this.formatMoney(overview?.revenue || 0), trends?.revenue, '📈')}
                    ${this.renderKpiCard('🎯 Прибыль', this.formatMoney(overview?.profit || 0), trends?.profit, '💎')}
                    ${this.renderKpiCard('📊 Маржа', this.formatPercent(overview?.margin || 0), null, '📐')}
                    ${this.renderKpiCard('🛒 Продаж', this.formatNumber(overview?.salesCount || 0), trends?.salesCount, '📦')}
                    ${this.renderKpiCard('💳 Средний чек', this.formatMoney(overview?.averageCheck || 0), trends?.averageCheck, '🧾')}
                    ${this.renderKpiCard('🏪 В наличии', this.formatNumber(overview?.inStock || 0), null, '📋')}
                </div>
                
                <div class="charts-row">
                    <div class="chart-card">
                        <h4>Динамика продаж</h4>
                        <div class="chart-container">
                            <canvas data-ref="salesChart" width="400" height="200"></canvas>
                        </div>
                    </div>
                    
                    ${topProducts && topProducts.length > 0 ? `
                        <div class="chart-card">
                            <h4>🔥 Топ-5 товаров</h4>
                            <div class="top-products-list">
                                ${topProducts.slice(0, 5).map((p, i) => `
                                    <div class="top-item">
                                        <span class="rank">#${i + 1}</span>
                                        <span class="name">${this.escapeHtml(p.name)}</span>
                                        <span class="value">${p.quantity} шт.</span>
                                        <span class="amount">${this.formatMoney(p.revenue)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                ${alerts && alerts.length > 0 ? `
                    <div class="alerts-section">
                        <h4>⚠️ Важные уведомления</h4>
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
        `;
    }
    
    renderSalesReport(salesData) {
        if (!salesData) {
            return this.renderEmptyState('Нет данных о продажах');
        }
        
        const { summary, sales } = salesData;
        
        return `
            <div class="sales-report">
                <div class="summary-cards">
                    <div class="summary-card">
                        <span class="label">Всего продаж</span>
                        <span class="value">${this.formatNumber(summary?.count || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Выручка</span>
                        <span class="value">${this.formatMoney(summary?.revenue || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Прибыль</span>
                        <span class="value">${this.formatMoney(summary?.profit || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Средний чек</span>
                        <span class="value">${this.formatMoney(summary?.averageCheck || 0)}</span>
                    </div>
                </div>
                
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Дата</th>
                                <th>Товаров</th>
                                <th>Сумма</th>
                                <th>Оплата</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sales && sales.length > 0 ? sales.slice(0, 20).map(sale => `
                                <tr>
                                    <td>${this.formatDate(sale.created_at)}</td>
                                    <td>${sale.items?.length || 0} поз.</td>
                                    <td class="money">${this.formatMoney(sale.total)}</td>
                                    <td>${this.getPaymentMethodName(sale.payment_method)}</td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="4" class="empty-message">Нет продаж за выбранный период</td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    renderProductsReport(productsData) {
        if (!productsData) {
            return this.renderEmptyState('Нет данных о товарах');
        }
        
        const { topProducts, slowMoving } = productsData;
        
        return `
            <div class="products-report">
                <div class="two-columns">
                    <div class="card">
                        <h4>🏆 Самые продаваемые</h4>
                        <div class="top-list">
                            ${topProducts && topProducts.length > 0 ? topProducts.slice(0, 10).map((p, i) => `
                                <div class="top-item">
                                    <span class="rank">#${i + 1}</span>
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="value">${p.quantity} шт.</span>
                                    <span class="amount">${this.formatMoney(p.revenue)}</span>
                                </div>
                            `).join('') : '<div class="empty-message">Нет данных</div>'}
                        </div>
                    </div>
                    
                    <div class="card">
                        <h4>🐌 Залежавшиеся товары</h4>
                        <div class="slow-list">
                            ${slowMoving && slowMoving.length > 0 ? slowMoving.slice(0, 10).map(p => `
                                <div class="slow-item">
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="days">${p.daysInStock} дн.</span>
                                    <span class="price">${this.formatMoney(p.price)}</span>
                                </div>
                            `).join('') : '<div class="empty-message">Нет залежавшихся товаров</div>'}
                        </div>
                    </div>
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
    
    renderEmptyState(message = 'Нет данных') {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>${message}</p>
            </div>
        `;
    }

    // ========== ПОСЛЕ РЕНДЕРА ==========
    
    async afterRender() {
        // Загружаем данные при первом рендере
        if (!this.state.data.dashboard) {
            this.loadData();
        }
        
        // Загружаем графики если активен дашборд
        if (this.state.activeTab === 'dashboard' && this.state.data.dashboard) {
            await this.renderCharts();
        }
    }
    
    attachEvents() {
        // Подписка на события данных
        this.subscribe(EventTypes.DATA.REPORTS_FETCHED, (data) => {
            if (data.source !== EventSource.ADAPTER_SUPABASE) return;
            
            this.state.data[data.reportType] = data.payload;
            this.state.isLoading = false;
            this.update();
            
            // Рендерим графики после обновления
            if (data.reportType === 'dashboard') {
                this.setTimeout(() => this.renderCharts(), 100);
            }
        });
        
        // DOM события
        this.addDomListener('periodSelect', 'change', (e) => {
            this.state.period = e.target.value;
            this.loadData();
        });
        
        this.addDomListener('refreshBtn', 'click', () => {
            this.loadData();
        });
        
        // Переключение вкладок
        this.container.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                this.state.activeTab = tab;
                
                // Обновляем активный класс
                this.container.querySelectorAll('[data-tab]').forEach(btn => {
                    btn.classList.remove('active');
                });
                tabBtn.classList.add('active');
                
                // Загружаем данные если их нет
                if (!this.state.data[tab]) {
                    this.loadData();
                } else {
                    this.update();
                }
                
                // Рендерим графики для дашборда
                if (tab === 'dashboard') {
                    this.setTimeout(() => this.renderCharts(), 100);
                }
            }
        });
    }

    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    loadData() {
        if (this.state.isLoading) return;
        
        this.state.isLoading = true;
        this.update();
        
        const { activeTab, period } = this.state;
        const dateRange = this.getDateRange(period);
        
        // Запрашиваем данные через EventBus
        this.publish(EventTypes.DATA.REPORTS_FETCH, {
            reportType: activeTab,
            period,
            startDate: dateRange.start,
            endDate: dateRange.end
        });
    }

    // ========== ГРАФИКИ ==========
    
    async loadChartJS() {
        if (this.chartJsLoaded) return;
        if (window.Chart) {
            this.chartJsLoaded = true;
            return;
        }
        
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
            script.onload = () => {
                this.chartJsLoaded = true;
                resolve();
            };
            document.head.appendChild(script);
        });
    }
    
    async renderCharts() {
        await this.loadChartJS();
        
        if (!window.Chart) return;
        
        // Уничтожаем старые графики
        this.charts.forEach(chart => chart.destroy());
        this.charts.clear();
        
        const canvas = this.refs.get('salesChart');
        if (!canvas) return;
        
        const dashboardData = this.state.data.dashboard;
        if (!dashboardData?.daily) return;
        
        const daily = dashboardData.daily;
        
        const chart = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels: daily.map(d => this.formatDate(d.date, { short: true })),
                datasets: [
                    {
                        label: 'Выручка',
                        data: daily.map(d => d.revenue),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Прибыль',
                        data: daily.map(d => d.profit),
                        borderColor: '#10b981',
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
                            label: (ctx) => {
                                const value = ctx.raw;
                                return `${ctx.dataset.label}: ${this.formatMoney(value)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: (val) => this.formatMoney(val, { showSymbol: false })
                        }
                    }
                }
            }
        });
        
        this.charts.set('sales', chart);
    }

    // ========== УТИЛИТЫ ==========
    
    getDateRange(period) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let start = new Date(today);
        
        switch (period) {
            case 'today':
                break;
            case 'yesterday':
                start.setDate(today.getDate() - 1);
                break;
            case 'week':
                start.setDate(today.getDate() - 7);
                break;
            case 'month':
                start.setMonth(today.getMonth() - 1);
                break;
            default:
                start.setDate(today.getDate() - 7);
        }
        
        return { start, end: now };
    }
    
    getAlertIcon(type) {
        const icons = { success: '✅', warning: '⚠️', danger: '🚨', info: 'ℹ️' };
        return icons[type] || 'ℹ️';
    }
    
    getPaymentMethodName(method) {
        const names = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' };
        return names[method] || method;
    }
    
    formatDate(date, options = {}) {
        if (!date) return '';
        const d = new Date(date);
        if (options.short) {
            return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        }
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    
    formatNumber(num) {
        if (num === null || isNaN(num)) return '0';
        return new Intl.NumberFormat('ru-RU').format(num);
    }
    
    formatPercent(value) {
        if (value === null || isNaN(value)) return '0%';
        return `${value.toFixed(1)}%`;
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.charts.forEach(chart => chart.destroy());
        this.charts.clear();
        
        console.log('[ReportsWidget] Cleaned up');
    }
}

export default ReportsWidget;
