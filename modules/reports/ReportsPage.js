/**
 * Reports Page Controller
 * 
 * Контроллер страницы отчетов. Координирует работу компонентов:
 * - ReportsState (состояние)
 * - ReportsHeader (заголовок с фильтрами периода)
 * - ReportsTabs (вкладки)
 * - DashboardView, SalesView, ProductsView, SellersView, ProfitView
 * 
 * @module ReportsPage
 * @version 4.0.0
 * @changes
 * - Полный рефакторинг: разделение на контроллер и компоненты
 * - Использование ReportsState для управления состоянием
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ReportsState, TABS } from './reportsState.js';
import { ReportsHeader } from './ReportsHeader.js';
import { ReportsTabs } from './ReportsTabs.js';
import { DashboardView } from './views/DashboardView.js';
import { SalesView } from './views/SalesView.js';
import { ProductsView } from './views/ProductsView.js';
import { SellersView } from './views/SellersView.js';
import { ProfitView } from './views/ProfitView.js';
import { ReportService } from '../../services/ReportService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { Notification } from '../common/Notification.js';

export class ReportsPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Компоненты
        this.header = null;
        this.tabs = null;
        this.currentView = null;
        
        // Права
        this.permissions = {
            canViewFull: PermissionManager.can('reports:view'),
            canExport: PermissionManager.can('reports:export')
        };
        
        // Отписки
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        await this.loadReportData();
        
        return `
            <div class="reports-page">
                <div data-ref="headerContainer"></div>
                <div data-ref="tabsContainer"></div>
                <div class="reports-content" data-ref="contentContainer">
                    ${this.renderLoader()}
                </div>
            </div>
        `;
    }
    
    renderLoader() {
        return `
            <div class="reports-loader">
                <span class="loading-spinner large"></span>
                <span>Загрузка отчетов...</span>
            </div>
        `;
    }
    
    async afterRender() {
        // Монтируем хедер
        const headerContainer = this.refs.get('headerContainer');
        this.header = new ReportsHeader(headerContainer, {
            onPeriodChange: (preset) => this.handlePeriodPresetChange(preset),
            onCustomPeriodChange: (start, end) => this.handleCustomPeriodChange(start, end),
            onCompareToggle: (value) => this.handleCompareToggle(value),
            onRefresh: () => this.refresh(),
            onExport: () => this.handleExport()
        });
        await this.header.mount();
        
        // Монтируем вкладки
        const tabsContainer = this.refs.get('tabsContainer');
        this.tabs = new ReportsTabs(tabsContainer, {
            tabs: TABS,
            activeTab: ReportsState.get('activeTab'),
            onTabChange: (tabId) => this.switchTab(tabId)
        });
        await this.tabs.mount();
        
        // Монтируем активную вкладку
        await this.mountActiveView();
        
        // Подписки
        this.unsubscribers.push(
            ReportsState.subscribe((changes) => {
                const periodChanged = changes.some(c => c.key === 'period');
                const tabChanged = changes.some(c => c.key === 'activeTab');
                
                if (periodChanged) {
                    this.refresh();
                }
                
                if (tabChanged) {
                    this.mountActiveView();
                }
            })
        );
    }
    
    async mountActiveView() {
        const container = this.refs.get('contentContainer');
        const activeTab = ReportsState.get('activeTab');
        const reportData = ReportsState.get('reportData');
        
        // Уничтожаем предыдущее представление
        if (this.currentView) {
            this.currentView.destroy();
        }
        
        // Создаем новое представление
        const ViewClass = this.getViewClass(activeTab);
        this.currentView = new ViewClass(container, {
            data: reportData[activeTab],
            permissions: this.permissions
        });
        
        await this.currentView.mount();
    }
    
    getViewClass(tabId) {
        const views = {
            dashboard: DashboardView,
            sales: SalesView,
            products: ProductsView,
            sellers: SellersView,
            profit: ProfitView
        };
        return views[tabId] || DashboardView;
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    async loadReportData() {
        const cacheKey = ReportsState.getCacheKey();
        const cached = ReportsState.getCachedData(cacheKey);
        
        if (cached) {
            ReportsState.setReportData(ReportsState.get('activeTab'), cached);
            return;
        }
        
        ReportsState.set('isLoading', true);
        
        try {
            const activeTab = ReportsState.get('activeTab');
            const { startDate, endDate } = ReportsState.get('period');
            
            let data;
            
            switch (activeTab) {
                case 'dashboard':
                    data = await ReportService.getDashboardData();
                    break;
                case 'sales':
                    data = await ReportService.getSalesReport(startDate, endDate);
                    break;
                case 'products':
                    data = await ReportService.getProductsReport();
                    break;
                case 'sellers':
                    data = await ReportService.getSellersReport({ startDate, endDate });
                    break;
                case 'profit':
                    const dashboard = await ReportService.getDashboardData();
                    data = {
                        grossProfit: dashboard.overview?.sales?.profit || 0,
                        margin: dashboard.overview?.sales?.margin || 0,
                        roi: dashboard.overview?.financial?.roi || 0
                    };
                    break;
            }
            
            ReportsState.setCachedData(cacheKey, data);
            ReportsState.setReportData(activeTab, data);
            
        } catch (error) {
            console.error('[ReportsPage] Load error:', error);
            Notification.error('Ошибка при загрузке отчетов');
        } finally {
            ReportsState.set('isLoading', false);
        }
    }
    
    async refresh() {
        ReportsState.clearCache();
        await this.loadReportData();
        await this.mountActiveView();
    }
    
    async switchTab(tabId) {
        ReportsState.set('activeTab', tabId);
        
        if (!ReportsState.get('reportData')[tabId]) {
            await this.loadReportData();
        }
    }
    
    // ========== ОБРАБОТЧИКИ ==========
    
    handlePeriodPresetChange(preset) {
        ReportsState.setPeriodPreset(preset);
    }
    
    handleCustomPeriodChange(start, end) {
        ReportsState.setCustomPeriod(start, end);
    }
    
    handleCompareToggle(value) {
        ReportsState.set('compareWithPrevious', value);
    }
    
    async handleExport() {
        try {
            Notification.info('Подготовка экспорта...');
            
            const activeTab = ReportsState.get('activeTab');
            const data = ReportsState.get('reportData')[activeTab];
            
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
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
    }
    
    formatDateForFilename() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(unsub => unsub());
        
        this.header?.destroy();
        this.tabs?.destroy();
        this.currentView?.destroy();
    }
}
