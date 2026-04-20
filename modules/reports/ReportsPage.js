/**
 * Reports Page Component
 * 
 * Страница отчетов и аналитики с визуализацией данных.
 * 
 * Архитектурные решения:
 * - Ленивая загрузка Chart.js для графиков
 * - Кэширование данных отчетов (5 минут)
 * - Фильтры по периоду с быстрыми пресетами
 * - Вкладки для переключения между отчетами
 * - Сравнение с предыдущим периодом
 * - Экспорт в Excel с настройкой полей
 * - Сохранение пользовательских настроек в localStorage
 * - Адаптивные графики с ресайзом
 * 
 * @module ReportsPage
 * @extends BaseComponent
 * @requires ReportService
 * @requires ProductService
 * @requires SaleService
 * @requires ShiftService
 * @requires PermissionManager
 * @requires Notification
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ReportService } from '../../services/ReportService.js';
import { ProductService } from '../../services/ProductService.js';
import { SaleService } from '../../services/SaleService.js';
import { ShiftService } from '../../services/ShiftService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { Notification } from '../common/Notification.js';
import { 
    formatMoney, 
    formatNumber, 
    formatPercent, 
    formatDate,
    formatCompactNumber 
} from '../../utils/formatters.js';
import { getCategoryName, getCategoryOptions } from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY = 'reports_settings';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const CHART_COLORS = [
    '#0070f3', '#2e7d32', '#f57c00', '#c62828', '#6a1b9a',
    '#00838f', '#e65100', '#1565c0', '#ad1457', '#2e7d32'
];

/**
 * Быстрые пресеты периодов
 */
const PERIOD_PRESETS = [
    { label: 'Сегодня', value: 'today' },
    { label: 'Вчера', value: 'yesterday' },
    { label: 'Неделя', value: 'week' },
    { label: 'Месяц', value: 'month' },
    { label: 'Квартал', value: 'quarter' },
    { label: 'Год', value: 'year' }
];

/**
 * Вкладки отчетов
 */
const TABS = [
    { id: 'dashboard', label: '📊 Дашборд', icon: '📊' },
    { id: 'sales', label: '💰 Продажи', icon: '💰' },
    { id: 'products', label: '📦 Товары', icon: '📦' },
    { id: 'sellers', label: '👥 Продавцы', icon: '👥' },
    { id: 'profit', label: '📈 Прибыль', icon: '📈' }
];

export class ReportsPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Состояние
        this._state = {
            activeTab: 'dashboard',
            period: {
                preset: 'week',
                startDate: this.getPresetDateRange('week').start,
                endDate: this.getPresetDateRange('week').end
            },
            compareWithPrevious: true,
            chartType: 'bar',
            isLoading: false
        };
        
        // Данные отчетов
        this.reportData = {
            dashboard: null,
            sales: null,
            products: null,
            sellers: null,
            profit: null
        };
        
        // Кэш
        this.cache = new Map();
        
        // Права
        this.permissions = {
            canViewFull: PermissionManager.can('reports:view'),
            canViewProfit: PermissionManager.can('reports:view'),
            canExport: PermissionManager.can('reports:view')
        };
        
        // Chart.js инстансы
        this.charts = new Map();
        
        // Таймер ресайза
        this.resizeTimer = null;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.restoreSettings();
        this.showLoader();
        
        await this.loadReportData();
        
        const periodLabel = this.getPeriodLabel();
        const canViewFull = this.permissions.canViewFull;
        
        return `
            <div class="reports-page">
                <!-- Заголовок и фильтры -->
                <div class="reports-header">
                    <div class="header-left">
                        <h2>Отчеты и аналитика</h2>
                        <span class="period-label">${periodLabel}</span>
                    </div>
                    <div class="header-right">
                        <div class="period-selector">
                            <select data-ref="periodPreset" class="period-preset">
                                ${PERIOD_PRESETS.map(p => `
                                    <option value="${p.value}" ${this._state.period.preset === p.value ? 'selected' : ''}>
                                        ${p.label}
                                    </option>
                                `).join('')}
                            </select>
                            
                            <div class="custom-period ${this._state.period.preset === 'custom' ? 'visible' : ''}">
                                <input 
                                    type="date" 
                                    data-ref="startDate"
                                    value="${this.formatDateForInput(this._state.period.startDate)}"
                                >
                                <span>—</span>
                                <input 
                                    type="date" 
                                    data-ref="endDate"
                                    value="${this.formatDateForInput(this._state.period.endDate)}"
                                >
                            </div>
                        </div>
                        
                        <label class="checkbox-label">
                            <input 
                                type="checkbox" 
                                data-ref="compareToggle"
                                ${this._state.compareWithPrevious ? 'checked' : ''}
                            >
                            Сравнить с предыдущим периодом
                        </label>
                        
                        ${this.permissions.canExport ? `
                            <button class="btn-secondary" data-ref="exportBtn">
                                📥 Экспорт в Excel
                            </button>
                        ` : ''}
                        
                        <button class="btn-ghost" data-ref="refreshBtn" title="Обновить">
                            🔄
                        </button>
                    </div>
                </div>
                
                <!-- Вкладки -->
                <div class="reports-tabs">
                    ${TABS.map(tab => `
                        <button 
                            class="tab-btn ${this._state.activeTab === tab.id ? 'active' : ''}"
                            data-tab="${tab.id}"
                        >
                            <span class="tab-icon">${tab.icon}</span>
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Контент вкладок -->
                <div class="reports-content" data-ref="reportsContent">
                    ${this._state.isLoading ? this.renderLoader() : this.renderActiveTab()}
                </div>
            </div>
        `;
    }

    /**
     * Рендерит активную вкладку
     */
    renderActiveTab() {
        switch (this._state.activeTab) {
            case 'dashboard':
                return this.renderDashboard();
            case 'sales':
                return this.renderSalesReport();
            case 'products':
                return this.renderProductsReport();
            case 'sellers':
                return this.renderSellersReport();
            case 'profit':
                return this.renderProfitReport();
            default:
                return this.renderDashboard();
        }
    }

    /**
     * Рендерит дашборд
     */
    renderDashboard() {
        const data = this.reportData.dashboard;
        if (!data) return this.renderEmptyState();
        
        const trends = data.trends || {};
        const alerts = data.alerts || [];
        
        return `
            <div class="dashboard-view">
                <!-- KPI Карточки -->
                <div class="kpi-grid">
                    ${this.renderKpiCard(
                        'Выручка',
                        formatMoney(data.overview?.sales?.revenue || 0),
                        trends.revenue,
                        '💰'
                    )}
                    ${this.renderKpiCard(
                        'Прибыль',
                        formatMoney(data.overview?.sales?.profit || 0),
                        trends.profit,
                        '📈'
                    )}
                    ${this.renderKpiCard(
                        'Маржа',
                        formatPercent(data.overview?.sales?.margin || 0),
                        null,
                        '🎯'
                    )}
                    ${this.renderKpiCard(
                        'Продаж',
                        formatNumber(data.overview?.sales?.count || 0),
                        trends.salesCount,
                        '🛒'
                    )}
                    ${this.renderKpiCard(
                        'Средний чек',
                        formatMoney(data.overview?.sales?.averageCheck || 0),
                        trends.averageCheck,
                        '💳'
                    )}
                    ${this.renderKpiCard(
                        'Товаров в наличии',
                        formatNumber(data.overview?.products?.inStock || 0),
                        null,
                        '📦'
                    )}
                </div>
                
                <!-- Графики -->
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
                
                <!-- Топ товары и алерты -->
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

    /**
     * Рендерит отчет по продажам
     */
    renderSalesReport() {
        const data = this.reportData.sales;
        if (!data) return this.renderEmptyState();
        
        return `
            <div class="sales-report-view">
                <!-- Сводка -->
                <div class="report-summary">
                    <div class="summary-card">
                        <span class="label">Всего продаж</span>
                        <span class="value">${formatNumber(data.summary?.count || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Выручка</span>
                        <span class="value">${formatMoney(data.summary?.revenue || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Прибыль</span>
                        <span class="value">${formatMoney(data.summary?.profit || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Средний чек</span>
                        <span class="value">${formatMoney(data.summary?.averageCheck || 0)}</span>
                    </div>
                </div>
                
                <!-- График по дням -->
                <div class="chart-card full-width">
                    <h4>Динамика продаж</h4>
                    <div class="chart-container large">
                        <canvas data-ref="salesChart" width="800" height="250"></canvas>
                    </div>
                </div>
                
                <!-- Таблица продаж -->
                <div class="table-card">
                    <h4>Детализация продаж</h4>
                    <div class="table-container" data-ref="salesTableContainer">
                        ${this.renderSalesTable(data.sales || [])}
                    </div>
                    ${(data.sales || []).length >= 100 ? `
                        <div class="table-footer">
                            <button class="btn-secondary" data-ref="loadMoreSalesBtn">
                                Загрузить еще
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Рендерит отчет по товарам
     */
    renderProductsReport() {
        const data = this.reportData.products;
        if (!data) return this.renderEmptyState();
        
        return `
            <div class="products-report-view">
                <!-- Сводка -->
                <div class="report-summary">
                    <div class="summary-card">
                        <span class="label">Всего товаров</span>
                        <span class="value">${formatNumber(data.summary?.total || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">В наличии</span>
                        <span class="value">${formatNumber(data.summary?.inStock || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Продано</span>
                        <span class="value">${formatNumber(data.summary?.sold || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Стоимость склада</span>
                        <span class="value">${formatMoney(data.summary?.totalValue || 0)}</span>
                    </div>
                </div>
                
                <!-- Топ товары -->
                <div class="two-columns">
                    <div class="card">
                        <h4>🏆 Самые продаваемые</h4>
                        <div class="top-list">
                            ${(data.topProducts || []).slice(0, 10).map((p, i) => `
                                <div class="top-item">
                                    <span class="rank">#${i + 1}</span>
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="value">${p.quantity} шт.</span>
                                    <span class="amount">${formatMoney(p.revenue)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="card">
                        <h4>💎 Высокая маржинальность</h4>
                        <div class="top-list">
                            ${(data.highMarginProducts || []).slice(0, 10).map((p, i) => `
                                <div class="top-item">
                                    <span class="rank">#${i + 1}</span>
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="value">${p.margin.toFixed(0)}%</span>
                                    <span class="amount">${formatMoney(p.price)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- Медленно продаваемые -->
                <div class="card">
                    <h4>🐌 Залежавшиеся товары</h4>
                    <div class="slow-products">
                        ${(data.slowMovingProducts || []).slice(0, 5).map(p => `
                            <div class="slow-item">
                                <span class="name">${this.escapeHtml(p.name)}</span>
                                <span class="days">${p.daysInStock} дней</span>
                                <span class="price">${formatMoney(p.price)}</span>
                            </div>
                        `).join('')}
                        ${(data.slowMovingProducts || []).length === 0 ? `
                            <div class="empty-message">Нет залежавшихся товаров</div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Рендерит отчет по продавцам
     */
    renderSellersReport() {
        const data = this.reportData.sellers;
        if (!data) return this.renderEmptyState();
        
        return `
            <div class="sellers-report-view">
                <!-- Сводка -->
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
                
                <!-- График по продавцам -->
                <div class="chart-card full-width">
                    <h4>Выручка по продавцам</h4>
                    <div class="chart-container large">
                        <canvas data-ref="sellersChart" width="800" height="250"></canvas>
                    </div>
                </div>
                
                <!-- Таблица продавцов -->
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
                                ${(data.sellers || []).map((s, i) => `
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

    /**
     * Рендерит отчет по прибыли
     */
    renderProfitReport() {
        const data = this.reportData.profit;
        if (!data) return this.renderEmptyState();
        
        return `
            <div class="profit-report-view">
                <div class="info-message">
                    <span>🔒 Детальный отчет по прибыли доступен в расширенной версии</span>
                </div>
                
                <div class="profit-summary">
                    <div class="profit-card">
                        <h4>Валовая прибыль</h4>
                        <div class="profit-value ${data.grossProfit >= 0 ? 'positive' : 'negative'}">
                            ${formatMoney(data.grossProfit || 0)}
                        </div>
                    </div>
                    <div class="profit-card">
                        <h4>Маржинальность</h4>
                        <div class="profit-value ${data.margin >= 20 ? 'positive' : 'warning'}">
                            ${formatPercent(data.margin || 0)}
                        </div>
                    </div>
                    <div class="profit-card">
                        <h4>ROI</h4>
                        <div class="profit-value ${data.roi >= 50 ? 'positive' : ''}">
                            ${formatPercent(data.roi || 0)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Рендерит KPI карточку
     */
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
                <div class="kpi-footer">
                    ${trendHtml}
                </div>
            </div>
        `;
    }

    /**
     * Рендерит таблицу продаж
     */
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
                    ${sales.slice(0, 50).map(sale => `
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

    /**
     * Рендерит лоадер
     */
    renderLoader() {
        return `
            <div class="reports-loader">
                <span class="loading-spinner large"></span>
                <span>Загрузка отчетов...</span>
            </div>
        `;
    }

    /**
     * Рендерит пустое состояние
     */
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>Нет данных за выбранный период</p>
            </div>
        `;
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Период
        this.addDomListener('periodPreset', 'change', (e) => this.handlePeriodPresetChange(e));
        this.addDomListener('startDate', 'change', () => this.handleCustomPeriodChange());
        this.addDomListener('endDate', 'change', () => this.handleCustomPeriodChange());
        
        // Сравнение
        this.addDomListener('compareToggle', 'change', (e) => {
            this._state.compareWithPrevious = e.target.checked;
            this.saveSettings();
            this.refresh();
        });
        
        // Вкладки
        document.querySelectorAll('[data-tab]').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.currentTarget.dataset.tab;
                this.switchTab(tabId);
            });
        });
        
        // Экспорт
        this.addDomListener('exportBtn', 'click', () => this.handleExport());
        
        // Обновление
        this.addDomListener('refreshBtn', 'click', () => this.refresh());
        
        // Загрузить еще
        this.addDomListener('loadMoreSalesBtn', 'click', () => this.loadMoreSales());
        
        // Ресайз
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Инициализируем графики после рендеринга
        setTimeout(() => this.initializeCharts(), 100);
    }

    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    /**
     * Загружает данные отчетов
     */
    async loadReportData() {
        const cacheKey = this.getCacheKey();
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            this.reportData = cached.data;
            return;
        }
        
        this._state.isLoading = true;
        
        try {
            const { startDate, endDate } = this._state.period;
            const prevPeriod = this._state.compareWithPrevious 
                ? this.getPreviousPeriod() 
                : null;
            
            // Загружаем данные для активной вкладки и дашборда
            const promises = [
                ReportService.getDashboardData(),
                ReportService.getSalesReport(startDate, endDate)
            ];
            
            if (this._state.activeTab === 'products' || !this.reportData.products) {
                promises.push(ReportService.getProductsReport());
            }
            
            if (this._state.activeTab === 'sellers' || !this.reportData.sellers) {
                promises.push(ReportService.getSellersReport({ startDate, endDate }));
            }
            
            const [dashboard, sales, products, sellers] = await Promise.all(promises);
            
            this.reportData = {
                dashboard,
                sales,
                products: products || this.reportData.products,
                sellers: sellers || this.reportData.sellers,
                profit: {
                    grossProfit: dashboard.overview?.sales?.profit || 0,
                    margin: dashboard.overview?.sales?.margin || 0,
                    roi: dashboard.overview?.financial?.roi || 0
                }
            };
            
            // Кэшируем
            this.cache.set(cacheKey, {
                data: this.reportData,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('[ReportsPage] Load data error:', error);
            Notification.error('Ошибка при загрузке отчетов');
        } finally {
            this._state.isLoading = false;
        }
    }

    /**
     * Обновляет отчет
     */
    async refresh() {
        this.cache.clear();
        await this.loadReportData();
        this.update();
    }

    /**
     * Переключает вкладку
     */
    async switchTab(tabId) {
        this._state.activeTab = tabId;
        this.saveSettings();
        
        // Подгружаем данные если нужно
        if (!this.reportData[tabId] && tabId !== 'dashboard') {
            await this.loadReportData();
        }
        
        this.update();
    }

    // ========== ПЕРИОДЫ ==========
    
    /**
     * Обработчик изменения пресета периода
     */
    handlePeriodPresetChange(e) {
        const preset = e.target.value;
        
        if (preset === 'custom') {
            this._state.period.preset = 'custom';
        } else {
            const range = this.getPresetDateRange(preset);
            this._state.period = {
                preset,
                startDate: range.start,
                endDate: range.end
            };
        }
        
        this.saveSettings();
        this.refresh();
    }

    /**
     * Обработчик изменения произвольного периода
     */
    handleCustomPeriodChange() {
        const startInput = this.refs.get('startDate');
        const endInput = this.refs.get('endDate');
        
        if (startInput && endInput) {
            this._state.period = {
                preset: 'custom',
                startDate: new Date(startInput.value),
                endDate: new Date(endInput.value)
            };
        }
        
        this.saveSettings();
        this.refresh();
    }

    /**
     * Получает диапазон дат для пресета
     */
    getPresetDateRange(preset) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (preset) {
            case 'today':
                return {
                    start: today,
                    end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
                };
            case 'yesterday':
                const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                return {
                    start: yesterday,
                    end: new Date(today.getTime() - 1)
                };
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay() + 1);
                return {
                    start: weekStart,
                    end: now
                };
            case 'month':
                return {
                    start: new Date(now.getFullYear(), now.getMonth(), 1),
                    end: now
                };
            case 'quarter':
                const quarter = Math.floor(now.getMonth() / 3);
                return {
                    start: new Date(now.getFullYear(), quarter * 3, 1),
                    end: now
                };
            case 'year':
                return {
                    start: new Date(now.getFullYear(), 0, 1),
                    end: now
                };
            default:
                return this.getPresetDateRange('week');
        }
    }

    /**
     * Получает предыдущий период для сравнения
     */
    getPreviousPeriod() {
        const { startDate, endDate } = this._state.period;
        const duration = endDate.getTime() - startDate.getTime();
        
        return {
            start: new Date(startDate.getTime() - duration),
            end: new Date(endDate.getTime() - duration)
        };
    }

    /**
     * Получает метку периода для отображения
     */
    getPeriodLabel() {
        const { startDate, endDate } = this._state.period;
        return `${formatDate(startDate)} — ${formatDate(endDate)}`;
    }

    // ========== ГРАФИКИ ==========
    
    /**
     * Инициализирует графики
     */
    async initializeCharts() {
        // Ленивая загрузка Chart.js
        if (!window.Chart) {
            await this.loadChartJS();
        }
        
        this.destroyCharts();
        
        switch (this._state.activeTab) {
            case 'dashboard':
                this.renderRevenueChart();
                this.renderCategoriesChart();
                break;
            case 'sales':
                this.renderSalesChart();
                break;
            case 'sellers':
                this.renderSellersChart();
                break;
        }
    }

    /**
     * Загружает Chart.js динамически
     */
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

    /**
     * Рендерит график выручки и прибыли
     */
    renderRevenueChart() {
        const canvas = this.refs.get('revenueChart');
        if (!canvas || !window.Chart) return;
        
        const data = this.reportData.sales?.daily || [];
        
        const chart = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels: data.map(d => formatDate(d.date, { format: 'short' })),
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
                },
                scales: {
                    y: {
                        ticks: {
                            callback: (val) => formatCompactNumber(val)
                        }
                    }
                }
            }
        });
        
        this.charts.set('revenue', chart);
    }

    /**
     * Рендерит круговую диаграмму по категориям
     */
    renderCategoriesChart() {
        const canvas = this.refs.get('categoriesChart');
        if (!canvas || !window.Chart) return;
        
        const categories = this.reportData.dashboard?.overview?.categories || {};
        const labels = Object.keys(categories).map(cat => getCategoryName(cat));
        const data = Object.values(categories).map(cat => cat.sold || 0);
        
        const chart = new window.Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: CHART_COLORS,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = data.reduce((a, b) => a + b, 0);
                                const percent = ((ctx.raw / total) * 100).toFixed(1);
                                return `${ctx.label}: ${ctx.raw} (${percent}%)`;
                            }
                        }
                    }
                }
            }
        });
        
        this.charts.set('categories', chart);
    }

    /**
     * Рендерит график продаж
     */
    renderSalesChart() {
        const canvas = this.refs.get('salesChart');
        if (!canvas || !window.Chart) return;
        
        const data = this.reportData.sales?.daily || [];
        
        const chart = new window.Chart(canvas, {
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
                        borderColor: CHART_COLORS[2],
                        backgroundColor: 'transparent',
                        yAxisID: 'y1'
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
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            callback: (val) => formatCompactNumber(val)
                        }
                    }
                }
            }
        });
        
        this.charts.set('sales', chart);
    }

    /**
     * Рендерит график по продавцам
     */
    renderSellersChart() {
        const canvas = this.refs.get('sellersChart');
        if (!canvas || !window.Chart) return;
        
        const sellers = this.reportData.sellers?.sellers || [];
        
        const chart = new window.Chart(canvas, {
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
                            callback: (val) => formatCompactNumber(val)
                        }
                    }
                }
            }
        });
        
        this.charts.set('sellers', chart);
    }

    /**
     * Уничтожает все графики
     */
    destroyCharts() {
        this.charts.forEach(chart => chart.destroy());
        this.charts.clear();
    }

    /**
     * Обработчик ресайза
     */
    handleResize() {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
            this.charts.forEach(chart => chart.resize());
        }, 100);
    }

    // ========== ЭКСПОРТ ==========
    
    /**
     * Обработчик экспорта
     */
    async handleExport() {
        try {
            Notification.info('Подготовка экспорта...');
            
            const csv = await this.generateExportCSV();
            this.downloadCSV(csv, `report_${this._state.activeTab}_${this.formatDateForFilename()}.csv`);
            
            Notification.success('Отчет экспортирован');
        } catch (error) {
            console.error('[ReportsPage] Export error:', error);
            Notification.error('Ошибка при экспорте');
        }
    }

    /**
     * Генерирует CSV для экспорта
     */
    async generateExportCSV() {
        switch (this._state.activeTab) {
            case 'sales':
                return this.exportSalesToCSV();
            case 'products':
                return this.exportProductsToCSV();
            case 'sellers':
                return this.exportSellersToCSV();
            default:
                return this.exportDashboardToCSV();
        }
    }

    /**
     * Экспорт продаж в CSV
     */
    exportSalesToCSV() {
        const data = this.reportData.sales?.sales || [];
        
        const headers = ['Дата', 'Товаров', 'Сумма', 'Скидка %', 'Прибыль', 'Способ оплаты'];
        const rows = data.map(sale => [
            formatDate(sale.created_at, { withTime: true }),
            sale.items?.length || 0,
            sale.total || 0,
            sale.discount || 0,
            sale.profit || 0,
            this.getPaymentMethodName(sale.payment_method)
        ]);
        
        return this.formatCSV(headers, rows);
    }

    /**
     * Экспорт товаров в CSV
     */
    exportProductsToCSV() {
        const topProducts = this.reportData.products?.topProducts || [];
        
        const headers = ['Название', 'Продано', 'Выручка', 'Прибыль'];
        const rows = topProducts.map(p => [
            p.name,
            p.quantity,
            p.revenue,
            p.profit
        ]);
        
        return this.formatCSV(headers, rows);
    }

    /**
     * Экспорт продавцов в CSV
     */
    exportSellersToCSV() {
        const sellers = this.reportData.sellers?.sellers || [];
        
        const headers = ['Продавец', 'Смен', 'Продаж', 'Выручка', 'Прибыль', 'Средний чек'];
        const rows = sellers.map(s => [
            s.name,
            s.shiftsCount,
            s.totalSales,
            s.totalRevenue,
            s.totalProfit,
            s.averageCheck
        ]);
        
        return this.formatCSV(headers, rows);
    }

    /**
     * Экспорт дашборда в CSV
     */
    exportDashboardToCSV() {
        const overview = this.reportData.dashboard?.overview || {};
        
        const headers = ['Показатель', 'Значение'];
        const rows = [
            ['Выручка', overview.sales?.revenue || 0],
            ['Прибыль', overview.sales?.profit || 0],
            ['Маржа %', overview.sales?.margin || 0],
            ['Продаж', overview.sales?.count || 0],
            ['Средний чек', overview.sales?.averageCheck || 0],
            ['Товаров в наличии', overview.products?.inStock || 0]
        ];
        
        return this.formatCSV(headers, rows);
    }

    /**
     * Форматирует данные в CSV для Excel
     */
    formatCSV(headers, rows) {
        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(';') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        
        const headerRow = headers.map(escape).join(';');
        const dataRows = rows.map(row => row.map(escape).join(';'));
        
        return '\uFEFF' + [headerRow, ...dataRows].join('\n');
    }

    /**
     * Скачивает CSV файл
     */
    downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
    }

    // ========== УТИЛИТЫ ==========
    
    /**
     * Форматирует дату для input[type="date"]
     */
    formatDateForInput(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Форматирует дату для имени файла
     */
    formatDateForFilename() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }

    /**
     * Получает ключ кэша
     */
    getCacheKey() {
        const { startDate, endDate, preset } = this._state.period;
        return `${this._state.activeTab}_${preset}_${startDate.toISOString()}_${endDate.toISOString()}`;
    }

    /**
     * Получает название способа оплаты
     */
    getPaymentMethodName(method) {
        const names = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' };
        return names[method] || method;
    }

    /**
     * Получает иконку для алерта
     */
    getAlertIcon(type) {
        const icons = {
            success: '✅',
            warning: '⚠️',
            danger: '🚨',
            info: 'ℹ️'
        };
        return icons[type] || 'ℹ️';
    }

    /**
     * Сохраняет настройки
     */
    saveSettings() {
        const settings = {
            activeTab: this._state.activeTab,
            period: this._state.period,
            compareWithPrevious: this._state.compareWithPrevious
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    /**
     * Восстанавливает настройки
     */
    restoreSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const settings = JSON.parse(stored);
                this._state.activeTab = settings.activeTab || 'dashboard';
                this._state.compareWithPrevious = settings.compareWithPrevious ?? true;
                
                if (settings.period) {
                    this._state.period = {
                        ...settings.period,
                        startDate: new Date(settings.period.startDate),
                        endDate: new Date(settings.period.endDate)
                    };
                }
            }
        } catch (error) {
            console.error('[ReportsPage] Restore settings error:', error);
        }
    }

    /**
     * Загружает еще продажи
     */
    async loadMoreSales() {
        Notification.info('Загрузка дополнительных данных...');
        // TODO: Реализовать пагинацию
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.destroyCharts();
        
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
        }
        
        window.removeEventListener('resize', this.handleResize);
        
        this.saveSettings();
    }
}
