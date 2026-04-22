// ========================================
// FILE: ./modules/reports/ReportsPage.js
// ========================================

/**
 * Reports Page Controller
 * 
 * Контроллер страницы отчетов. Координирует работу компонентов:
 * - ReportsHeader (выбор периода)
 * - ReportsTabs (переключение вкладок)
 * - DashboardView / SalesView / ProductsView / SellersView / ProfitView
 * 
 * Архитектурные решения:
 * - Использует глобальный Store для хранения состояния отчетов.
 * - Ленивая загрузка данных через ReportService.
 * - Кэширование данных для быстрого переключения между вкладками.
 * - Адаптивный дизайн с графиками (Chart.js).
 * 
 * @module ReportsPage
 * @version 6.0.1
 * @changes
 * - Исправлен экспорт: добавлен именованный экспорт для совместимости с Router.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { EventBus } from '../../core/EventBus.js';
import { ReportService } from '../../services/ReportService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { Notification } from '../common/Notification.js';
import { createLogger } from '../../utils/logger.js';

// ========== COMPONENTS ==========
import { ReportsHeader } from './ReportsHeader.js';
import { ReportsTabs } from './ReportsTabs.js';
import { DashboardView } from './views/DashboardView.js';
import { SalesView } from './views/SalesView.js';
import { ProductsView } from './views/ProductsView.js';
import { SellersView } from './views/SellersView.js';
import { ProfitView } from './views/ProfitView.js';

// ========== LOGGER ==========
const logger = createLogger('ReportsPage');

export class ReportsPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // UI Components
        this.header = null;
        this.tabs = null;
        this.currentView = null;
        
        // State
        this.permissions = {
            canView: false,
            canExport: false
        };
        
        this.unsubscribers = [];
        this.refreshTimer = null;
        
        logger.debug('ReportsPage constructed');
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        await this.waitForPermissions();
        
        logger.debug('Rendering ReportsPage');
        
        return `
            <div class="reports-page">
                <div data-ref="headerContainer"></div>
                <div data-ref="tabsContainer"></div>
                <div data-ref="contentContainer" class="reports-content">
                    <div class="loading-overlay">
                        <div class="loading-spinner"></div>
                        <span class="loading-text">Загрузка данных...</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    async afterRender() {
        logger.debug('afterRender started');
        
        // Header
        const headerContainer = this.refs.get('headerContainer');
        if (headerContainer) {
            const reports = Store.state.reports;
            
            this.header = new ReportsHeader(headerContainer, {
                period: reports.period,
                compareWithPrevious: reports.compareWithPrevious,
                onPeriodChange: (preset) => this.handlePeriodChange(preset),
                onCustomPeriodChange: (start, end) => this.handleCustomPeriodChange(start, end),
                onCompareToggle: (value) => this.handleCompareToggle(value),
                onRefresh: () => this.refresh(),
                onExport: () => this.exportData()
            });
            await this.header.mount();
        }
        
        // Tabs
        const tabsContainer = this.refs.get('tabsContainer');
        if (tabsContainer) {
            const reports = Store.state.reports;
            
            this.tabs = new ReportsTabs(tabsContainer, {
                activeTab: reports.activeTab,
                onTabChange: (tab) => this.handleTabChange(tab)
            });
            await this.tabs.mount();
        }
        
        // Load initial data
        await this.loadData();
        
        this.subscribeToStore();
        
        logger.debug('afterRender completed');
    }
    
    // ========== PERMISSIONS ==========
    
    async waitForPermissions() {
        if (PermissionManager.isLoaded()) {
            this.updatePermissions();
            return;
        }
        
        logger.debug('Waiting for permissions...');
        
        return new Promise((resolve) => {
            const unsubscribe = EventBus.on('permissions:loaded', () => {
                this.updatePermissions();
                unsubscribe();
                resolve();
            });
            
            // Таймаут на случай, если права не загрузятся
            setTimeout(() => {
                unsubscribe();
                this.updatePermissions();
                resolve();
            }, 3000);
        });
    }
    
    updatePermissions() {
        this.permissions = {
            canView: PermissionManager.hasAny(['reports:view', 'reports:export']),
            canExport: PermissionManager.can('reports:export')
        };
        
        logger.debug('Permissions updated', this.permissions);
    }
    
    // ========== DATA LOADING ==========
    
    async loadData() {
        const reports = Store.state.reports;
        
        if (reports.isLoading) {
            logger.debug('Already loading, skipping');
            return;
        }
        
        reports.isLoading = true;
        
        try {
            logger.debug('Loading report data', {
                tab: reports.activeTab,
                period: reports.period
            });
            
            let data = null;
            
            switch (reports.activeTab) {
                case 'dashboard':
                    data = await ReportService.getDashboardData();
                    reports.reportData.dashboard = data;
                    break;
                    
                case 'sales':
                    data = await ReportService.getSalesReport(
                        reports.period.startDate,
                        reports.period.endDate
                    );
                    reports.reportData.sales = data;
                    break;
                    
                case 'products':
                    data = await ReportService.getProductsReport();
                    reports.reportData.products = data;
                    break;
                    
                case 'sellers':
                    data = await ReportService.getSellersReport({
                        startDate: reports.period.startDate,
                        endDate: reports.period.endDate
                    });
                    reports.reportData.sellers = data;
                    break;
                    
                case 'profit':
                    data = await ReportService.getTotalStats();
                    reports.reportData.profit = {
                        grossProfit: data.sales?.profit || 0,
                        margin: data.sales?.margin || 0,
                        roi: data.financial?.roi || 0
                    };
                    break;
            }
            
            logger.debug('Data loaded successfully', { tab: reports.activeTab });
            
        } catch (error) {
            logger.error('Failed to load data', { error: error.message });
            Notification.error('Ошибка при загрузке данных отчета');
        } finally {
            reports.isLoading = false;
            await this.renderContentView();
        }
    }
    
    async renderContentView() {
        const container = this.refs.get('contentContainer');
        if (!container) return;
        
        const reports = Store.state.reports;
        const activeTab = reports.activeTab;
        const data = reports.reportData[activeTab];
        
        logger.debug('Rendering content view', { activeTab, hasData: !!data });
        
        // Destroy previous view
        if (this.currentView) {
            this.currentView.destroy();
            this.currentView = null;
        }
        
        // Create new view
        const ViewClass = this.getViewClass(activeTab);
        
        if (ViewClass) {
            this.currentView = new ViewClass(container, {
                data,
                permissions: this.permissions,
                onLoadMore: activeTab === 'sales' ? () => this.loadMoreSales() : null
            });
            await this.currentView.mount();
        } else {
            container.innerHTML = `<div class="empty-state">Вкладка в разработке</div>`;
        }
    }
    
    getViewClass(tab) {
        const views = {
            dashboard: DashboardView,
            sales: SalesView,
            products: ProductsView,
            sellers: SellersView,
            profit: ProfitView
        };
        return views[tab] || null;
    }
    
    async loadMoreSales() {
        logger.debug('Loading more sales');
        // Реализовано в SalesView
    }
    
    // ========== EVENT HANDLERS ==========
    
    async handlePeriodChange(preset) {
        logger.debug('Period changed', { preset });
        
        const reports = Store.state.reports;
        reports.period.preset = preset;
        
        // Вычисляем даты для пресета
        const range = this.getPresetDateRange(preset);
        reports.period.startDate = range.start;
        reports.period.endDate = range.end;
        
        await this.refresh();
    }
    
    async handleCustomPeriodChange(startDate, endDate) {
        logger.debug('Custom period changed', { startDate, endDate });
        
        const reports = Store.state.reports;
        reports.period.preset = 'custom';
        reports.period.startDate = startDate;
        reports.period.endDate = endDate;
        
        await this.refresh();
    }
    
    handleCompareToggle(value) {
        logger.debug('Compare toggle changed', { value });
        Store.state.reports.compareWithPrevious = value;
        this.refresh();
    }
    
    async handleTabChange(tab) {
        logger.debug('Tab changed', { tab });
        
        const reports = Store.state.reports;
        
        if (reports.activeTab === tab) return;
        
        reports.activeTab = tab;
        
        // Проверяем, есть ли уже данные для этой вкладки
        const hasData = reports.reportData[tab] !== null;
        
        if (!hasData) {
            await this.loadData();
        } else {
            await this.renderContentView();
        }
    }
    
    async refresh() {
        logger.debug('Refreshing data');
        
        // Очищаем кэш для текущей вкладки
        const reports = Store.state.reports;
        reports.reportData[reports.activeTab] = null;
        
        await this.loadData();
    }
    
    async exportData() {
        if (!this.permissions.canExport) {
            Notification.warning('У вас нет прав на экспорт отчетов');
            return;
        }
        
        logger.debug('Exporting data');
        
        try {
            const reports = Store.state.reports;
            const activeTab = reports.activeTab;
            const data = reports.reportData[activeTab];
            
            if (!data) {
                Notification.warning('Нет данных для экспорта');
                return;
            }
            
            let csv = '';
            let filename = '';
            
            switch (activeTab) {
                case 'sales':
                    csv = ReportService.exportToCSV('sales', data);
                    filename = `sales_${this.formatDateForFilename()}.csv`;
                    break;
                case 'products':
                    csv = ReportService.exportToCSV('products', data.topProducts || []);
                    filename = `products_${this.formatDateForFilename()}.csv`;
                    break;
                case 'sellers':
                    csv = ReportService.exportToCSV('sellers', data);
                    filename = `sellers_${this.formatDateForFilename()}.csv`;
                    break;
                default:
                    Notification.info('Экспорт для этого раздела в разработке');
                    return;
            }
            
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            URL.revokeObjectURL(link.href);
            
            Notification.success(`Отчет экспортирован: ${filename}`);
            
        } catch (error) {
            logger.error('Export error', { error: error.message });
            Notification.error('Ошибка при экспорте данных');
        }
    }
    
    // ========== UTILITIES ==========
    
    getPresetDateRange(preset) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let start = new Date(today);
        const end = new Date(now);
        
        switch (preset) {
            case 'today':
                // start уже today
                break;
            case 'yesterday':
                start.setDate(today.getDate() - 1);
                end.setTime(start.getTime() + 24 * 60 * 60 * 1000 - 1);
                break;
            case 'week':
                start.setDate(today.getDate() - 7);
                break;
            case 'month':
                start.setMonth(today.getMonth() - 1);
                break;
            case 'quarter':
                start.setMonth(today.getMonth() - 3);
                break;
            case 'year':
                start.setFullYear(today.getFullYear() - 1);
                break;
            default:
                start.setDate(today.getDate() - 7);
        }
        
        return { start, end };
    }
    
    formatDateForFilename() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    
    // ========== STORE SUBSCRIPTION ==========
    
    subscribeToStore() {
        this.unsubscribers.push(
            Store.subscribe('reports.activeTab', () => {
                logger.debug('Store: activeTab changed');
                this.renderContentView();
            }),
            
            Store.subscribe('reports.period', () => {
                logger.debug('Store: period changed');
                this.header?.setPeriod(Store.state.reports.period);
            })
        );
    }
    
    // ========== CLEANUP ==========
    
    beforeDestroy() {
        logger.debug('Destroying ReportsPage');
        
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        
        this.unsubscribers.forEach(unsub => unsub());
        
        this.header?.destroy();
        this.tabs?.destroy();
        this.currentView?.destroy();
    }
}

// Экспортируем и как default, и как именованный для совместимости
export default ReportsPage;
