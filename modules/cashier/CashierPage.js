/**
 * Cashier Page Controller
 * 
 * Контроллер страницы кассы. Координирует работу компонентов:
 * - CashierState (состояние)
 * - ShiftPanel (статистика смены)
 * - CategoryNav (навигация по категориям)
 * - ProductGrid (сетка товаров)
 * - Cart (корзина)
 * 
 * @module CashierPage
 * @version 4.0.0
 * @changes
 * - Полный рефакторинг: разделение на контроллер и компоненты
 * - Использование CashierState для управления состоянием
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { ShiftPanel } from './ShiftPanel.js';
import { CategoryNav } from './CategoryNav.js';
import { ProductGrid } from './ProductGrid.js';
import { Cart } from './Cart.js';
import { ShiftOpener } from './ShiftOpener.js';
import { ProductService } from '../../services/ProductService.js';
import { ShiftService } from '../../services/ShiftService.js';
import { SaleService } from '../../services/SaleService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { getCategoryName } from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY = 'cashier_ui_state';
const STATS_UPDATE_INTERVAL = 30000;
const QUICK_ITEMS_COUNT = 8;

const HOTKEYS = {
    SEARCH: '/',
    CHECKOUT: 'Enter',
    CLEAR_SEARCH: 'Escape'
};

export class CashierPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Компоненты
        this.shiftPanel = null;
        this.categoryNav = null;
        this.productGrid = null;
        this.cart = null;
        this.shiftOpener = null;
        
        // Пользователь
        this.user = AuthManager.getUser();
        
        // Таймеры
        this.statsUpdateTimer = null;
        
        // Отписки
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        // Восстанавливаем UI состояние
        this.restoreUIState();
        
        // Загружаем данные
        await this.loadInitialData();
        
        const hasOpenShift = CashierState.hasOpenShift();
        
        return `
            <div class="cashier-page ${!hasOpenShift ? 'shift-closed' : ''}">
                <div class="cashier-header">
                    <div data-ref="shiftContainer"></div>
                </div>
                
                ${hasOpenShift ? this.renderMainLayout() : this.renderShiftClosedMessage()}
            </div>
        `;
    }
    
    renderMainLayout() {
        return `
            <div class="cashier-layout">
                <div class="products-panel">
                    <div data-ref="shiftStatsContainer"></div>
                    <div data-ref="searchContainer"></div>
                    <div data-ref="categoryNavContainer"></div>
                    <div data-ref="productGridContainer" class="products-container"></div>
                </div>
                
                <div class="cart-panel">
                    <div data-ref="cartContainer"></div>
                </div>
            </div>
            
            <div data-ref="quickViewModal" class="quick-view-modal hidden"></div>
        `;
    }
    
    renderShiftClosedMessage() {
        return `
            <div class="shift-closed-message">
                <div class="message-icon">🔒</div>
                <h2>Смена закрыта</h2>
                <p>Для работы с кассой необходимо открыть смену</p>
            </div>
        `;
    }
    
    async attachEvents() {
        // Монтируем ShiftOpener
        const shiftContainer = this.refs.get('shiftContainer');
        this.shiftOpener = new ShiftOpener(shiftContainer);
        await this.shiftOpener.mount();
        
        if (CashierState.hasOpenShift()) {
            await this.mountCashierComponents();
        }
        
        // Подписки на события
        this.unsubscribers.push(
            this.subscribe('shift:opened', (data) => this.handleShiftOpened(data)),
            this.subscribe('shift:closed', () => this.handleShiftClosed()),
            this.subscribe('sale:completed', () => this.handleSaleCompleted()),
            this.subscribe('product:created', () => this.refreshProducts()),
            this.subscribe('product:updated', () => this.refreshProducts())
        );
        
        // Подписка на события корзины
        this.unsubscribers.push(
            this.subscribe('cart:checkout', ({ items, total, discount, paymentMethod }) => {
                this.handleCheckout(items, total, discount, paymentMethod);
            })
        );
        
        // Горячие клавиши
        document.addEventListener('keydown', this.handleHotkey.bind(this));
        
        // Сохранение UI состояния
        window.addEventListener('beforeunload', () => this.saveUIState());
    }
    
    async mountCashierComponents() {
        // Панель статистики
        const statsContainer = this.refs.get('shiftStatsContainer');
        this.shiftPanel = new ShiftPanel(statsContainer);
        await this.shiftPanel.mount();
        
        // Навигация по категориям
        const categoryNavContainer = this.refs.get('categoryNavContainer');
        this.categoryNav = new CategoryNav(categoryNavContainer, {
            onCategorySelect: (category) => this.handleCategorySelect(category),
            onSearch: (query) => this.handleSearch(query),
            onViewModeChange: (mode) => this.handleViewModeChange(mode)
        });
        await this.categoryNav.mount();
        
        // Сетка товаров
        const productGridContainer = this.refs.get('productGridContainer');
        this.productGrid = new ProductGrid(productGridContainer, {
            onAddToCart: (id) => this.handleAddToCart(id),
            onQuickView: (id) => this.showQuickView(id)
        });
        await this.productGrid.mount();
        
        // Корзина
        const cartContainer = this.refs.get('cartContainer');
        this.cart = new Cart(cartContainer);
        await this.cart.mount();
        
        // Запускаем обновление статистики
        this.startStatsUpdate();
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    async loadInitialData() {
        try {
            const currentShift = await ShiftService.getCurrentShift(this.user.id);
            
            if (currentShift) {
                CashierState.set('currentShift', currentShift);
                
                const [products, topProducts, stats] = await Promise.all([
                    ProductService.getInStock(),
                    SaleService.getTopProducts(QUICK_ITEMS_COUNT),
                    ShiftService.getCurrentShiftStats(currentShift.id)
                ]);
                
                CashierState.setMultiple({
                    products,
                    popularProducts: topProducts.map(tp => products.find(p => p.id === tp.id)).filter(Boolean),
                    recentlyAdded: [...products].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5),
                    shiftStats: {
                        revenue: stats.totalRevenue || 0,
                        salesCount: stats.salesCount || 0,
                        averageCheck: stats.averageCheck || 0,
                        profit: stats.totalProfit || 0
                    }
                });
                
                CashierState.buildCategories();
                CashierState.filterProducts();
            }
            
        } catch (error) {
            console.error('[CashierPage] Load error:', error);
            Notification.error('Ошибка при загрузке данных');
        }
    }
    
    async refreshProducts() {
        try {
            const products = await ProductService.getInStock();
            CashierState.set('products', products);
            CashierState.buildCategories();
            CashierState.filterProducts();
        } catch (error) {
            console.error('[CashierPage] Refresh error:', error);
        }
    }
    
    async updateShiftStats() {
        const shiftId = CashierState.getShiftId();
        if (!shiftId) return;
        
        try {
            const stats = await ShiftService.getCurrentShiftStats(shiftId);
            CashierState.set('shiftStats', {
                revenue: stats.totalRevenue || 0,
                salesCount: stats.salesCount || 0,
                averageCheck: stats.averageCheck || 0,
                profit: stats.totalProfit || 0
            });
        } catch (error) {
            console.error('[CashierPage] Stats error:', error);
        }
    }
    
    // ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
    
    handleHotkey(e) {
        if (e.key === HOTKEYS.SEARCH && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.categoryNav?.focusSearch();
        }
        
        if (e.key === HOTKEYS.CLEAR_SEARCH && document.activeElement?.tagName === 'INPUT') {
            this.categoryNav?.clearSearch();
        }
        
        if (e.key === HOTKEYS.CHECKOUT && e.ctrlKey) {
            e.preventDefault();
            if (CashierState.getCartTotalQuantity() > 0) {
                this.cart?.handleCheckout();
            }
        }
    }
    
    handleCategorySelect(category) {
        CashierState.set('selectedCategory', category);
        CashierState.filterProducts();
        this.saveUIState();
    }
    
    handleSearch(query) {
        CashierState.set('searchQuery', query);
        CashierState.filterProducts();
        this.saveUIState();
    }
    
    handleViewModeChange(mode) {
        CashierState.set('viewMode', mode);
        this.saveUIState();
    }
    
    handleAddToCart(id) {
        if (!CashierState.hasOpenShift()) {
            Notification.warning('Сначала откройте смену');
            return;
        }
        
        const state = CashierState.getState();
        const product = state.products.find(p => p.id === id);
        
        if (!product) return;
        
        if (product.status !== 'in_stock') {
            Notification.warning('Товар уже продан');
            return;
        }
        
        CashierState.addToCart(product);
    }
    
    showQuickView(id) {
        const state = CashierState.getState();
        const product = state.products.find(p => p.id === id);
        if (!product) return;
        
        // TODO: Реализовать QuickView компонент
        Notification.info(`Быстрый просмотр: ${product.name}`);
    }
    
    async handleShiftOpened(data) {
        CashierState.set('currentShift', data.shift);
        await this.loadInitialData();
        await this.update();
        await this.mountCashierComponents();
    }
    
    handleShiftClosed() {
        CashierState.set('currentShift', null);
        CashierState.reset();
        this.update();
    }
    
    async handleSaleCompleted() {
        await this.updateShiftStats();
        await this.refreshProducts();
        CashierState.set('recentlyAdded', []);
    }
    
    async handleCheckout(items, total, discount, paymentMethod) {
        try {
            await SaleService.create({
                shiftId: CashierState.getShiftId(),
                items,
                total,
                discount,
                paymentMethod
            });
            
            Notification.success(`Продажа на ${this.formatMoney(total)}`);
            CashierState.clearCart();
            
            const topProducts = await SaleService.getTopProducts(QUICK_ITEMS_COUNT);
            const state = CashierState.getState();
            CashierState.set('popularProducts', 
                topProducts.map(tp => state.products.find(p => p.id === tp.id)).filter(Boolean)
            );
            
        } catch (error) {
            console.error('[CashierPage] Checkout error:', error);
            Notification.error('Ошибка при создании продажи');
        }
    }
    
    // ========== УТИЛИТЫ ==========
    
    startStatsUpdate() {
        this.statsUpdateTimer = setInterval(() => {
            if (CashierState.hasOpenShift()) {
                this.updateShiftStats();
            }
        }, STATS_UPDATE_INTERVAL);
    }
    
    saveUIState() {
        const state = CashierState.getState();
        const uiState = {
            searchQuery: state.searchQuery,
            selectedCategory: state.selectedCategory,
            expandedCategories: Array.from(state.expandedCategories),
            viewMode: state.viewMode
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(uiState));
    }
    
    restoreUIState() {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                const uiState = JSON.parse(stored);
                CashierState.setMultiple({
                    searchQuery: uiState.searchQuery || '',
                    selectedCategory: uiState.selectedCategory || null,
                    expandedCategories: new Set(uiState.expandedCategories || []),
                    viewMode: uiState.viewMode || 'grid'
                });
            }
        } catch (error) {
            console.error('[CashierPage] Restore UI error:', error);
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.statsUpdateTimer) {
            clearInterval(this.statsUpdateTimer);
        }
        
        this.unsubscribers.forEach(unsub => unsub());
        
        document.removeEventListener('keydown', this.handleHotkey);
        
        this.saveUIState();
        
        this.shiftPanel?.destroy();
        this.categoryNav?.destroy();
        this.productGrid?.destroy();
        this.cart?.destroy();
        this.shiftOpener?.destroy();
    }
}
