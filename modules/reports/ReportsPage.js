// ========================================
// FILE: ./modules/reports/ReportsPage.js
// ========================================

/**
 * Reports Page Controller
 * 
 * Контроллер страницы отчетов. Координирует работу компонентов:
 * - ReportsHeader (заголовок с фильтрами периода)
 * - ReportsTabs (вкладки)
 * - DashboardView, SalesView, ProductsView, SellersView, ProfitView
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Удалена зависимость от легаси `ReportsState`.
 * - Делегирование загрузки данных `ReportService`.
 * - Ленивая загрузка представлений.
 * 
 * @module ReportsPage
 * @version 6.0.0
 * @changes
 * - Полностью удален `ReportsState`.
 * - Подключение к `Store.state.reports`.
 * - Упрощена логика загрузки и кэширования.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { ReportsHeader } from './ReportsHeader.js';
import { ReportsTabs } from './ReportsTabs.js';
import { ReportService } from '../../services/ReportService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { Notification } from '../common/Notification.js';

// ========== КОНСТАНТЫ ==========
const TABS = [
    { id: 'dashboard', label: 'Дашборд', icon: '📊' },
    { id: 'sales', label: 'Продажи', icon: '💰' },
    { id: 'products', label: 'Товары', icon: '📦' },
    { id: 'sellers', label: 'Продавцы', icon: '👥' },
    { id: 'profit', label: 'Прибыль', icon: '📈' }
];

export class ReportsPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        this.header = null;
        this.tabs = null;
        this.currentView = null;
        
        this.permissions = {
            canViewFull: PermissionManager.can('reports:view'),
            canExport: PermissionManager.can('reports:export')
        };
        
        this.unsubscribers = [];
        this._loadingTab = null;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        return `
            <div class="reports-page">
                <div data-ref="headerContainer"></div>
                <div data-ref="tabsContainer"></div>
                <div class="reports-content" data-ref="contentContainer">
                    <div class="reports-loader">
                        <span class="loading-spinner"></span>
                        <span>Загрузка отчетов...</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    async afterRender() {
        try {
            // Монтируем хедер
            const headerContainer = this.refs.get('headerContainer');
            if (headerContainer) {
                this.header = new ReportsHeader(headerContainer, {
                    period: Store.state.reports.period,
                    compareWithPrevious: Store.state.reports.compareWithPrevious,
                    onPeriodChange: (preset) => this.handlePeriodPresetChange(preset),
                    onCustomPeriodChange: (start, end) => this.handleCustomPeriodChange(start, end),
                    onCompareToggle: (value) => this.handleCompareToggle(value),
                    onRefresh: () => this.refresh(true),
                    onExport: () => this.handleExport()
                });
                await this.header.mount();
            }
            
            // Монтируем вкладки
            const tabsContainer = this.refs.get('tabsContainer');
            if (tabsContainer) {
                this.tabs = new ReportsTabs(tabsContainer, {
                    tabs: TABS,
                    activeTab: Store.state.reports.activeTab,
                    onTabChange: (tabId) => this.switchTab(tabId)
                });
                await this.tabs.mount();
            }
            
            // Загружаем активную вкладку
            await this.loadCurrentTab();
            
        } catch (error) {
            console.error('[ReportsPage] Mount error:', error);
            this.showError('Ошибка при загрузке страницы отчетов');
        }
        
        this.subscribeToStore();
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    async loadCurrentTab() {
        const activeTab = Store.state.reports.activeTab;
        
        if (this._loadingTab === activeTab) return;
        this._loadingTab = activeTab;
        
        Store.state.reports.isLoading = true;
        
        const contentContainer = this.refs.get('contentContainer');
        if (contentContainer) {
            contentContainer.innerHTML = `
                <div class="reports-loader">
                    <span class="loading-spinner"></span>
                    <span>Загрузка ${this.getTabTitle(activeTab)}...</span>
                </div>
            `;
        }
        
        try {
            let data = Store.state.reports.reportData[activeTab];
            
            if (!data) {
                data = await this.fetchTabData(activeTab);
                Store.state.reports.reportData[activeTab] = data;
            }
            
            await this.renderView(activeTab, data);
            
        } catch (error) {
            console.error(`[ReportsPage] Load ${activeTab} error:`, error);
            this.showError(`Ошибка при загрузке отчета "${this.getTabTitle(activeTab)}"`);
        } finally {
            Store.state.reports.isLoading = false;
            this._loadingTab = null;
        }
    }
    
    async fetchTabData(tabId) {
        const { startDate, endDate } = Store.state.reports.period;
        
        switch (tabId) {
            case 'dashboard':
                return await ReportService.getDashboardData();
            case 'sales':
                return await ReportService.getSalesReport(startDate, endDate);
            case 'products':
                return await ReportService.getProductsReport();
            case 'sellers':
                return await ReportService.getSellersReport({ startDate, endDate });
            case 'profit':
                const dashboard = await ReportService.getDashboardData();
                return {
                    grossProfit: dashboard.overview?.sales?.profit || 0,
                    margin: dashboard.overview?.sales?.margin || 0,
                    roi: dashboard.overview?.financial?.roi || 0
                };
            default:
                throw new Error(`Unknown tab: ${tabId}`);
        }
    }
    
    async renderView(tabId, data) {
        const container = this.refs.get('contentContainer');
        if (!container) return;
        
        if (this.currentView) {
            this.currentView.destroy();
            this.currentView = null;
        }
        
        const ViewClass = await this.getViewClass(tabId);
        this.currentView = new ViewClass(container, {
            data,
            permissions: this.permissions
        });
        
        await this.currentView.mount();
    }
    
    async getViewClass(tabId) {
        switch (tabId) {
            case 'dashboard':
                const { DashboardView } = await import('./views/DashboardView.js');
                return DashboardView;
            case 'sales':
                const { SalesView } = await import('./views/SalesView.js');
                return SalesView;
            case 'products':
                const { ProductsView } = await import('./views/ProductsView.js');
                return ProductsView;
            case 'sellers':
                const { SellersView } = await import('./views/SellersView.js');
                return SellersView;
            case 'profit':
                const { ProfitView } = await import('./views/ProfitView.js');
                return ProfitView;
            default:
                throw new Error(`Unknown tab: ${tabId}`);
        }
    }
    
    getTabTitle(tabId) {
        const tab = TABS.find(t => t.id === tabId);
        return tab?.label || tabId;
    }
    
    // ========== ОБНОВЛЕНИЕ ==========
    
    async refresh(force = false) {
        if (force) {
            ReportService.clearCache();
            Store.state.reports.reportData = {
                dashboard: null,
                sales: null,
                products: null,
                sellers: null,
                profit: null
            };
        }
        
        const activeTab = Store.state.reports.activeTab;
        Store.state.reports.reportData[activeTab] = null;
        
        await this.loadCurrentTab();
        Notification.info('Данные обновлены');
    }
    
    // ========== ОБРАБОТЧИКИ ==========
    
    handlePeriodPresetChange(preset) {
        const range = this.getPresetDateRange(preset);
        Store.state.reports.period = {
            preset,
            startDate: range.start,
            endDate: range.end
        };
        this.refresh();
    }
    
    handleCustomPeriodChange(start, end) {
        Store.state.reports.period = {
            preset: 'custom',
            startDate: new Date(start),
            endDate: new Date(end)
        };
        this.refresh();
    }
    
    handleCompareToggle(value) {
        Store.state.reports.compareWithPrevious = value;
    }
    
    async switchTab(tabId) {
        Store.state.reports.activeTab = tabId;
        await this.loadCurrentTab();
    }
    
    async handleExport() {
        if (!this.permissions.canExport) {
            Notification.warning('У вас нет прав на экспорт');
            return;
        }
        
        try {
            Notification.info('Подготовка экспорта...');
            
            const activeTab = Store.state.reports.activeTab;
            const data = Store.state.reports.reportData[activeTab];
            
            if (!data) {
                Notification.warning('Нет данных для экспорта');
                return;
            }
            
            const csv = await ReportService.exportToCSV(activeTab, data);
            this.downloadCSV(csv, `report_${activeTab}_${this.formatDateForFilename()}.csv`);
            
            Notification.success('Отчет экспортирован');
        } catch (error) {
            console.error('[ReportsPage] Export error:', error);
            Notification.error('Ошибка при экспорте');
        }
    }
    
    downloadCSV(content, filename) {
        const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }
    
    formatDateForFilename() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }
    
    getPresetDateRange(preset) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (preset) {
            case 'today':
                return { start: today, end: now };
            case 'yesterday':
                const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                return { start: yesterday, end: today };
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay() + 1);
                return { start: weekStart, end: now };
            case 'month':
                return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
            case 'quarter':
                const quarter = Math.floor(now.getMonth() / 3);
                return { start: new Date(now.getFullYear(), quarter * 3, 1), end: now };
            case 'year':
                return { start: new Date(now.getFullYear(), 0, 1), end: now };
            default:
                return this.getPresetDateRange('week');
        }
    }
    
    // ========== ПОДПИСКИ ==========
    
    subscribeToStore() {
        this.unsubscribers.push(
            Store.subscribe('reports.activeTab', () => this.loadCurrentTab())
        );
    }
    
    // ========== ОШИБКИ ==========
    
    showError(message) {
        const container = this.refs.get('contentContainer');
        if (container) {
            container.innerHTML = `
                <div class="error-state">
                    <div class="error-state-icon">⚠️</div>
                    <h3>Ошибка загрузки</h3>
                    <p>${this.escapeHtml(message)}</p>
                    <button class="btn-primary" data-ref="retryBtn">Повторить</button>
                </div>
            `;
            
            const retryBtn = container.querySelector('[data-ref="retryBtn"]');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.loadCurrentTab());
            }
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        
        this.header?.destroy();
        this.tabs?.destroy();
        this.currentView?.destroy();
    }
}
