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
 * @version 4.1.0
 * @changes
 * - Упрощена загрузка вкладок
 * - Добавлена обработка ошибок
 * - Улучшено кэширование
 * - Добавлено принудительное обновление
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ReportsState, TABS } from './reportsState.js';
import { ReportsHeader } from './ReportsHeader.js';
import { ReportsTabs } from './ReportsTabs.js';
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
        
        // Флаг загрузки
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
                    activeTab: ReportsState.get('activeTab'),
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
        
        // Подписки
        this.unsubscribers.push(
            ReportsState.subscribe((changes) => {
                const periodChanged = changes.some(c => c.key === 'period');
                const tabChanged = changes.some(c => c.key === 'activeTab');
                
                if (periodChanged) {
                    this.refresh();
                }
                
                if (tabChanged) {
                    this.loadCurrentTab();
                }
            })
        );
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    async loadCurrentTab() {
        const activeTab = ReportsState.get('activeTab');
        
        // Проверяем, не загружается ли уже эта вкладка
        if (this._loadingTab === activeTab) return;
        
        this._loadingTab = activeTab;
        
        // Показываем лоадер
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
            // Проверяем кэш
            let data = ReportsState.getCachedData(activeTab);
            
            if (!data) {
                data = await this.fetchTabData(activeTab);
                ReportsState.setCachedData(activeTab, data);
            }
            
            // Обновляем состояние
            ReportsState.setReportData(activeTab, data);
            
            // Рендерим представление
            await this.renderView(activeTab, data);
            
        } catch (error) {
            console.error(`[ReportsPage] Load ${activeTab} error:`, error);
            this.showError(`Ошибка при загрузке отчета "${this.getTabTitle(activeTab)}"`);
        } finally {
            this._loadingTab = null;
        }
    }
    
    async fetchTabData(tabId) {
        const { startDate, endDate } = ReportsState.get('period');
        
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
        
        // Уничтожаем предыдущее представление
        if (this.currentView) {
            this.currentView.destroy();
            this.currentView = null;
        }
        
        // Создаем новое представление
        const ViewClass = this.getViewClass(tabId);
        this.currentView = new ViewClass(container, {
            data,
            permissions: this.permissions,
            onLoadMore: () => this.loadMoreSales()
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
        return views[tabId];
    }
    
    getTabTitle(tabId) {
        const tab = TABS.find(t => t.id === tabId);
        return tab?.label || tabId;
    }
    
    // ========== ОБНОВЛЕНИЕ ==========
    
    async refresh(force = false) {
        if (force) {
            // Очищаем кэш
            ReportsState.clearCache();
            ReportService.clearCache();
        }
        
        const activeTab = ReportsState.get('activeTab');
        
        // Сбрасываем кэш для активной вкладки
        ReportsState.clearCacheForTab(activeTab);
        
        // Перезагружаем
        await this.loadCurrentTab();
        
        Notification.info('Данные обновлены');
    }
    
    async loadMoreSales() {
        // Для пагинации в SalesView
        // Можно добавить позже при необходимости
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
    
    async switchTab(tabId) {
        ReportsState.set('activeTab', tabId);
    }
    
    async handleExport() {
        if (!this.permissions.canExport) {
            Notification.warning('У вас нет прав на экспорт');
            return;
        }
        
        try {
            Notification.info('Подготовка экспорта...');
            
            const activeTab = ReportsState.get('activeTab');
            const data = ReportsState.get('reportData')[activeTab];
            
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
        this.unsubscribers.forEach(unsub => unsub());
        
        this.header?.destroy();
        this.tabs?.destroy();
        this.currentView?.destroy();
    }
}

// Импорты для представлений (ленивая загрузка)
let DashboardView, SalesView, ProductsView, SellersView, ProfitView;

// Функция для ленивой загрузки представлений
async function lazyLoadViews() {
    if (!DashboardView) {
        const module = await import('./views/DashboardView.js');
        DashboardView = module.DashboardView;
    }
    if (!SalesView) {
        const module = await import('./views/SalesView.js');
        SalesView = module.SalesView;
    }
    if (!ProductsView) {
        const module = await import('./views/ProductsView.js');
        ProductsView = module.ProductsView;
    }
    if (!SellersView) {
        const module = await import('./views/SellersView.js');
        SellersView = module.SellersView;
    }
    if (!ProfitView) {
        const module = await import('./views/ProfitView.js');
        ProfitView = module.ProfitView;
    }
}

// Вызываем ленивую загрузку при первом использовании
const originalGetViewClass = ReportsPage.prototype.getViewClass;
ReportsPage.prototype.getViewClass = async function(tabId) {
    await lazyLoadViews();
    return originalGetViewClass.call(this, tabId);
};
