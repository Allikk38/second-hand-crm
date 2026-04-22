// ========================================
// FILE: ./modules/cashier/CashierApp.js
// ========================================

/**
 * Cashier Application
 * 
 * Главный контроллер кассового модуля.
 * Управляет сменой, товарами, корзиной и рендерингом UI.
 * 
 * @module CashierApp
 * @version 7.1.2
 * @changes
 * - Добавлен cache-busting при импорте SaleService.
 * - Улучшена обработка ошибок статистики.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { EventBus } from '../../core/EventBus.js';
import { ShiftService } from '../../services/ShiftService.js';
import { ProductService } from '../../services/ProductService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { createLogger } from '../../utils/logger.js';
import { formatMoney } from '../../utils/formatters.js';

// ========== LOGGER ==========
const logger = createLogger('CashierApp');

// ========== КОНСТАНТЫ ==========
const CACHE_BUST = `v=${Date.now()}`;

// Ленивая загрузка компонентов UI
let ShiftPanel, CategoryNav, ProductGrid, Cart, PaymentModal, SaleService;

export class CashierApp extends BaseComponent {
    constructor(container) {
        super(container);
        
        // UI Components
        this.shiftPanel = null;
        this.categoryNav = null;
        this.productGrid = null;
        this.cart = null;
        this.paymentModal = null;
        
        // State
        this.user = AuthManager.getUser();
        this.unsubscribers = [];
        this.eventUnsubscribers = [];
        this._isInitialized = false;
        
        logger.info('CashierApp constructed', { userId: this.user?.id });
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const hasOpenShift = cashier.currentShift !== null;
        const cartItemsCount = cashier.cartItems.reduce((sum, i) => sum + i.quantity, 0);
        const cartTotal = Store.getCartTotal();
        const isLocalShift = cashier.currentShift?.is_local || false;
        const isLoadingShift = cashier.isLoadingShift || false;
        
        logger.debug('Rendering CashierApp', {
            hasOpenShift,
            isLocalShift,
            shiftId: cashier.currentShift?.id,
            isLoadingShift
        });

        if (isLoadingShift && !hasOpenShift) {
            return `
                <div class="cashier-layout shift-closed-mode">
                    <div class="shift-closed-overlay">
                        <div class="loading-spinner"></div>
                        <h2>Проверка смены...</h2>
                        <p>Синхронизация с сервером</p>
                    </div>
                </div>
                <div id="modal-container"></div>
            `;
        }

        return `
            <div class="cashier-layout ${!hasOpenShift ? 'shift-closed-mode' : ''}">
                ${hasOpenShift ? this.renderMainLayout(cartTotal, cartItemsCount, isLocalShift) : this.renderShiftClosed()}
            </div>
            <div id="modal-container"></div>
        `;
    }

    renderMainLayout(cartTotal, cartItemsCount, isLocalShift) {
        return `
            <div class="products-panel">
                <div data-ref="shiftPanelContainer"></div>
                ${isLocalShift ? `
                    <div class="offline-banner">
                        <span>📡 Работа в офлайн-режиме</span>
                    </div>
                ` : ''}
                <div data-ref="categoryNavContainer"></div>
                <div data-ref="productGridContainer" class="products-grid-container"></div>
            </div>
            <div class="cart-panel">
                <div class="cart-header">
                    <h2>Корзина</h2>
                    <span class="cart-count">${cartItemsCount} поз.</span>
                    ${cartItemsCount > 0 ? `<button class="btn-ghost btn-sm" data-ref="clearCartBtn">Очистить</button>` : ''}
                </div>
                <div data-ref="cartContainer" class="cart-items-container"></div>
                <div class="cart-footer">
                    <div class="cart-total-row">
                        <span>ИТОГО</span>
                        <span class="cart-total-value">${formatMoney(cartTotal)}</span>
                    </div>
                    <button class="btn-checkout" data-ref="checkoutBtn" ${cartItemsCount === 0 ? 'disabled' : ''}>
                        Оформить продажу
                    </button>
                    <div class="keyboard-hints">
                        <span><kbd>Ctrl</kbd>+<kbd>↵</kbd> Продать</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderShiftClosed() {
        const isShiftActionPending = Store.state.cashier.isShiftActionPending || false;
        
        return `
            <div class="shift-closed-overlay">
                <div class="shift-closed-icon">🔒</div>
                <h2>Смена закрыта</h2>
                <p>Для начала работы откройте смену</p>
                <button 
                    class="btn-primary" 
                    data-ref="openShiftBtn" 
                    ${isShiftActionPending ? 'disabled' : ''}
                >
                    ${isShiftActionPending ? 'Открытие...' : 'Открыть смену'}
                </button>
                <button 
                    class="btn-secondary" 
                    data-ref="refreshShiftStateBtn" 
                    style="margin-top: 8px;"
                >
                    🔄 Проверить смену
                </button>
            </div>
        `;
    }

    // ========== МОНТИРОВАНИЕ ==========
    
    async mount() {
        this._logger.group(`Mounting ${this._componentName}`, async () => {
            this._logger.debug('mount() started');
            
            if (this._isDestroyed) {
                this._logger.warn('Attempted to mount destroyed component');
                return;
            }
            
            this.container.innerHTML = '';
            
            try {
                this._logger.debug('Calling render()');
                const html = await this.render();
                
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html.trim();
                this.element = wrapper.firstChild;
                
                if (!this.element) {
                    throw new Error('Failed to create element from rendered HTML');
                }
                
                this.container.appendChild(this.element);
                this.cacheRefs();
                
                this.subscribeToShiftEvents();
                this.subscribeToStore();
                
                await this.initializeUI();
                
                this._isMounted = true;
                this._logger.info('Component mounted successfully');
                this.hideLoader();
                
            } catch (error) {
                this._logger.error('Mount failed', { error: error.message });
                this.container.innerHTML = `
                    <div class="error-state">
                        <div class="error-state-icon">⚠️</div>
                        <p>Ошибка загрузки кассы</p>
                        <small>${this.escapeHtml(error.message)}</small>
                        <button class="btn-primary" onclick="location.reload(true)">Обновить</button>
                    </div>
                `;
                throw error;
            }
        });
    }
    
    async initializeUI() {
        logger.debug('initializeUI started');
        
        await this.loadComponents();
        await this.loadSaleService();
        
        const hasShift = Store.state.cashier.currentShift !== null;
        
        if (hasShift) {
            logger.debug('Shift already in Store, mounting components');
            await this.mountShiftComponents();
            await this.loadData();
        } else {
            logger.debug('No shift in Store, checking server');
            await this.checkServerForShift();
        }
        
        this._isInitialized = true;
        logger.debug('initializeUI completed');
    }
    
    async checkServerForShift() {
        Store.state.cashier.isLoadingShift = true;
        
        try {
            logger.debug('Checking server for open shift');
            const serverShift = await ShiftService.getCurrentShift(this.user.id, true);
            
            if (serverShift) {
                logger.info('Found open shift on server', { shiftId: serverShift.id });
                
                Store.state.cashier.currentShift = serverShift;
                Store.state.cashier.isLoadingShift = false;
                
                await this.mountShiftComponents();
                await this.loadData();
                
                Notification.info('Найдена открытая смена');
            } else {
                logger.info('No open shift on server');
                Store.state.cashier.isLoadingShift = false;
            }
            
        } catch (error) {
            logger.error('Failed to check server for shift', { error: error.message });
            Store.state.cashier.isLoadingShift = false;
        }
    }

    async loadComponents() {
        if (!ShiftPanel) {
            const modules = await Promise.all([
                import(`./ShiftPanel.js?${CACHE_BUST}`),
                import(`./CategoryNav.js?${CACHE_BUST}`),
                import(`./ProductGrid.js?${CACHE_BUST}`),
                import(`./Cart.js?${CACHE_BUST}`),
                import(`./PaymentModal.js?${CACHE_BUST}`)
            ]);
            ShiftPanel = modules[0].ShiftPanel;
            CategoryNav = modules[1].CategoryNav;
            ProductGrid = modules[2].ProductGrid;
            Cart = modules[3].Cart;
            PaymentModal = modules[4].PaymentModal;
        }
    }
    
    async loadSaleService() {
        if (!SaleService) {
            const module = await import(`../../services/SaleService.js?${CACHE_BUST}`);
            SaleService = module.SaleService;
            logger.debug('SaleService loaded with cache busting');
        }
    }

    async mountShiftComponents() {
        logger.debug('Mounting shift components');
        
        const shiftContainer = this.refs.get('shiftPanelContainer');
        if (shiftContainer && !this.shiftPanel) {
            this.shiftPanel = new ShiftPanel(shiftContainer);
            await this.shiftPanel.mount();
        }

        const navContainer = this.refs.get('categoryNavContainer');
        if (navContainer && !this.categoryNav) {
            this.categoryNav = new CategoryNav(navContainer, {
                onCategorySelect: (cat) => this.handleCategorySelect(cat),
                onSearch: (query) => this.handleSearch(query),
                onScan: (product) => this.handleAddToCart(product)
            });
            await this.categoryNav.mount();
        }

        const gridContainer = this.refs.get('productGridContainer');
        if (gridContainer && !this.productGrid) {
            this.productGrid = new ProductGrid(gridContainer, {
                onAddToCart: (product) => this.handleAddToCart(product)
            });
            await this.productGrid.mount();
        }

        const cartContainer = this.refs.get('cartContainer');
        if (cartContainer && !this.cart) {
            this.cart = new Cart(cartContainer);
            await this.cart.mount();
        }

        this.addDomListener('checkoutBtn', 'click', () => this.handleCheckout());
        this.addDomListener('clearCartBtn', 'click', () => this.handleClearCart());
        
        const openBtn = this.refs.get('openShiftBtn');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.handleOpenShiftRequest());
        }
        
        const refreshBtn = this.refs.get('refreshShiftStateBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.checkServerForShift());
        }
    }

    // ========== ПОДПИСКИ ==========
    
    subscribeToShiftEvents() {
        const unsubOpen = EventBus.on('shift:open-requested', () => this.handleOpenShiftRequest());
        this.eventUnsubscribers.push(unsubOpen);
        
        const unsubClose = EventBus.on('shift:close-requested', (data) => this.handleCloseShiftRequest(data));
        this.eventUnsubscribers.push(unsubClose);
    }
    
    subscribeToStore() {
        this.unsubscribers.push(
            Store.subscribe('cashier.filteredProducts', () => this.productGrid?.update()),
            Store.subscribe('cashier.cartItems', () => this.updateCartUI()),
            Store.subscribe('cashier.cartTotalDiscount', () => this.updateCartUI()),
            Store.subscribe('cashier.isShiftActionPending', () => this.update()),
            Store.subscribe('cashier.isLoadingShift', () => this.update())
        );
    }

    // ========== ОБРАБОТЧИКИ СМЕНЫ ==========
    
    async handleOpenShiftRequest() {
        if (Store.state.cashier.currentShift) {
            Notification.warning('Смена уже открыта');
            return;
        }
        
        if (Store.state.cashier.isShiftActionPending) return;
        
        Store.state.cashier.isShiftActionPending = true;
        
        try {
            const shift = await ShiftService.openShift(this.user.id, {
                initialCash: 0,
                allowLocal: true
            });
            
            Store.state.cashier.currentShift = shift;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            
            if (shift.is_local) {
                Notification.warning('Смена открыта в офлайн-режиме');
            } else {
                Notification.success('Смена успешно открыта');
            }
            
            await this.update();
            await this.mountShiftComponents();
            await this.loadData();
            
        } catch (error) {
            logger.error('Failed to open shift', { error: error.message });
            
            if (error.code === 'SHIFT_ALREADY_OPEN') {
                Notification.warning('У вас уже есть открытая смена. Проверяем...');
                await this.checkServerForShift();
            } else {
                Notification.error('Ошибка при открытии смены: ' + error.message);
            }
        } finally {
            Store.state.cashier.isShiftActionPending = false;
        }
    }
    
    async handleCloseShiftRequest(data) {
        const { shiftId, currentStats } = data;
        
        if (Store.state.cashier.isShiftActionPending) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Закрытие смены',
            message: `Закрыть смену? Выручка: ${formatMoney(currentStats.revenue)}`,
            confirmText: 'Закрыть',
            type: 'warning'
        });
        
        if (!confirmed) return;
        
        Store.state.cashier.isShiftActionPending = true;
        
        try {
            const result = await ShiftService.closeShift(shiftId);
            
            Store.state.cashier.currentShift = null;
            Store.state.cashier.shiftStats = { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 };
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            Notification.success(`Смена закрыта. Выручка: ${formatMoney(result.total_revenue || 0)}`);
            
            await this.update();
            
        } catch (error) {
            logger.error('Failed to close shift', { error: error.message });
            Notification.error('Ошибка при закрытии смены: ' + error.message);
        } finally {
            Store.state.cashier.isShiftActionPending = false;
        }
    }

    // ========== ДАННЫЕ ==========
    
    async loadData() {
        if (!Store.state.cashier.currentShift) return;
        
        try {
            const products = await ProductService.getInStock();
            Store.state.cashier.products = products;
            
            const categories = this.buildCategories(products);
            Store.state.cashier.categories = categories;
            
            this.applyFilters();
            await this.updateShiftStats();
            
        } catch (error) {
            logger.error('Data loading error', { error: error.message });
            Notification.error('Ошибка загрузки данных');
        }
    }

    buildCategories(products) {
        const counts = new Map();
        products.forEach(p => {
            const cat = p.category || 'other';
            counts.set(cat, (counts.get(cat) || 0) + 1);
        });
        return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
    }

    applyFilters() {
        const cashier = Store.state.cashier;
        let filtered = cashier.products.filter(p => p.status === 'in_stock');
        
        if (cashier.searchQuery) {
            const q = cashier.searchQuery.toLowerCase();
            filtered = filtered.filter(p => 
                p.name.toLowerCase().includes(q) || 
                p.id.toLowerCase().includes(q)
            );
        }
        
        if (cashier.selectedCategory) {
            filtered = filtered.filter(p => p.category === cashier.selectedCategory);
        }
        
        cashier.filteredProducts = filtered;
    }

    async updateShiftStats() {
        const shiftId = Store.getShiftId();
        if (!shiftId) return;
        
        try {
            await this.loadSaleService();
            const stats = await SaleService.getStats({ shiftId });
            Store.state.cashier.shiftStats = {
                revenue: stats.totalRevenue || 0,
                salesCount: stats.count || 0,
                averageCheck: stats.averageCheck || 0,
                profit: stats.totalProfit || 0
            };
        } catch (error) {
            logger.error('Stats update error', { error: error.message });
        }
    }

    updateCartUI() {
        const total = Store.getCartTotal();
        const count = Store.getCartItemsCount();
        
        const totalEl = this.element?.querySelector('.cart-total-value');
        const countEl = this.element?.querySelector('.cart-count');
        const checkoutBtn = this.element?.querySelector('[data-ref="checkoutBtn"]');
        
        if (totalEl) totalEl.textContent = formatMoney(total);
        if (countEl) countEl.textContent = `${count} поз.`;
        if (checkoutBtn) checkoutBtn.disabled = count === 0;
        
        this.cart?.update();
    }

    // ========== UI HANDLERS ==========
    
    handleCategorySelect(category) {
        Store.state.cashier.selectedCategory = category === 'all' ? null : category;
        this.applyFilters();
    }

    handleSearch(query) {
        Store.state.cashier.searchQuery = query;
        this.applyFilters();
    }

    handleAddToCart(product) {
        if (product.status !== 'in_stock') {
            Notification.warning('Товар недоступен');
            return;
        }
        
        const items = Store.state.cashier.cartItems;
        const existing = items.find(i => i.id === product.id);
        
        if (existing) {
            existing.quantity += 1;
        } else {
            items.push({ ...product, quantity: 1 });
        }
        
        Store.state.cashier.cartItems = [...items];
        Notification.info(`Добавлено: ${product.name}`);
    }

    async handleClearCart() {
        if (Store.state.cashier.cartItems.length === 0) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Очистка корзины',
            message: 'Удалить все товары из корзины?',
            type: 'warning'
        });
        
        if (confirmed) {
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            Notification.info('Корзина очищена');
        }
    }

    async handleCheckout() {
        const items = Store.state.cashier.cartItems;
        if (items.length === 0) return;
        
        const modalContainer = document.getElementById('modal-container');
        this.paymentModal = new PaymentModal(modalContainer, {
            total: Store.getCartTotal(),
            onConfirm: async (method) => {
                await this.processCheckout(method);
            }
        });
        await this.paymentModal.mount();
    }

    async processCheckout(paymentMethod) {
        try {
            await this.loadSaleService();
            
            const shiftId = Store.getShiftId();
            const items = Store.state.cashier.cartItems.map(i => ({
                id: i.id,
                name: i.name,
                price: i.price,
                cost_price: i.cost_price,
                quantity: i.quantity
            }));
            
            const total = Store.getCartTotal();
            const discount = Store.state.cashier.cartTotalDiscount;
            
            const sale = await SaleService.create({
                shiftId,
                items,
                total,
                discount,
                paymentMethod
            });
            
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            await this.updateShiftStats();
            await this.loadData();
            
            Notification.success(`Продажа на ${formatMoney(total)}`);
            this.paymentModal?.destroy();
            
        } catch (error) {
            logger.error('Checkout error', { error: error.message });
            Notification.error('Ошибка при создании продажи');
        }
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers.forEach(unsub => unsub());
        
        this.shiftPanel?.destroy();
        this.categoryNav?.destroy();
        this.productGrid?.destroy();
        this.cart?.destroy();
        this.paymentModal?.destroy();
    }
}

export default CashierApp;
