// ========================================
// FILE: ./modules/cashier/CashierApp.js
// ========================================

/**
 * Cashier Application
 * 
 * Главный контроллер кассового модуля.
 * Управляет сменой, товарами, корзиной и рендерингом UI.
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Удален кастомный `CashierStore`.
 * - Компонентная структура: рендерит весь UI, монтирует дочерние компоненты.
 * - Изоляция бизнес-логики в сервисах.
 * 
 * @module CashierApp
 * @version 6.0.0
 * @changes
 * - Перемещен из pages/cashier/.
 * - Полностью переписан под глобальный Store.
 * - Упрощен рендеринг и управление жизненным циклом.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { ShiftService } from '../../services/ShiftService.js';
import { ProductService } from '../../services/ProductService.js';
import { SaleService } from '../../services/SaleService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { formatMoney } from '../../utils/formatters.js';

// Ленивая загрузка компонентов UI
let ShiftPanel, CategoryNav, ProductGrid, Cart, PaymentModal;

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
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const cashier = Store.state.cashier;
        const hasOpenShift = cashier.currentShift !== null;
        const cartItemsCount = cashier.cartItems.reduce((sum, i) => sum + i.quantity, 0);
        const cartTotal = Store.getCartTotal();

        return `
            <div class="cashier-layout ${!hasOpenShift ? 'shift-closed-mode' : ''}">
                ${hasOpenShift ? this.renderMainLayout(cartTotal, cartItemsCount) : this.renderShiftClosed()}
            </div>
            <div id="modal-container"></div>
        `;
    }

    renderMainLayout(cartTotal, cartItemsCount) {
        return `
            <div class="products-panel">
                <div data-ref="shiftPanelContainer"></div>
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
        return `
            <div class="shift-closed-overlay">
                <div class="shift-closed-icon">🔒</div>
                <h2>Смена закрыта</h2>
                <p>Для начала работы откройте смену</p>
                <button class="open-shift-btn" data-ref="openShiftBtn">Открыть смену</button>
            </div>
        `;
    }

    // ========== МОНТИРОВАНИЕ КОМПОНЕНТОВ ==========
    
    async afterRender() {
        await this.loadComponents();
        
        if (Store.state.cashier.currentShift) {
            await this.mountShiftComponents();
        } else {
            this.addDomListener('openShiftBtn', 'click', () => this.handleOpenShift());
        }
        
        this.subscribeToStore();
        this.loadData();
    }

    async loadComponents() {
        if (!ShiftPanel) {
            const modules = await Promise.all([
                import('./ShiftPanel.js'),
                import('./CategoryNav.js'),
                import('./ProductGrid.js'),
                import('./Cart.js'),
                import('./PaymentPanel.js')
            ]);
            ShiftPanel = modules[0].ShiftPanel;
            CategoryNav = modules[1].CategoryNav;
            ProductGrid = modules[2].ProductGrid;
            Cart = modules[3].Cart;
            PaymentModal = modules[4].PaymentPanel;
        }
    }

    async mountShiftComponents() {
        // 1. Shift Panel
        const shiftContainer = this.refs.get('shiftPanelContainer');
        if (shiftContainer) {
            this.shiftPanel = new ShiftPanel(shiftContainer);
            await this.shiftPanel.mount();
        }

        // 2. Category Nav
        const navContainer = this.refs.get('categoryNavContainer');
        if (navContainer) {
            this.categoryNav = new CategoryNav(navContainer, {
                onCategorySelect: (cat) => this.handleCategorySelect(cat),
                onSearch: (query) => this.handleSearch(query)
            });
            await this.categoryNav.mount();
        }

        // 3. Product Grid
        const gridContainer = this.refs.get('productGridContainer');
        if (gridContainer) {
            this.productGrid = new ProductGrid(gridContainer, {
                onAddToCart: (product) => this.handleAddToCart(product)
            });
            await this.productGrid.mount();
        }

        // 4. Cart
        const cartContainer = this.refs.get('cartContainer');
        if (cartContainer) {
            this.cart = new Cart(cartContainer);
            await this.cart.mount();
        }

        // Кнопки в футере
        this.addDomListener('checkoutBtn', 'click', () => this.handleCheckout());
        this.addDomListener('clearCartBtn', 'click', () => this.handleClearCart());
    }

    // ========== ДАННЫЕ ==========
    
    async loadData() {
        if (!Store.state.cashier.currentShift) return;
        
        try {
            const products = await ProductService.getInStock();
            Store.state.cashier.products = products;
            
            const categories = this.buildCategories(products);
            Store.state.cashier.categories = categories;
            
            // Применяем фильтры
            this.applyFilters();
            
            // Статистика смены
            await this.updateShiftStats();
        } catch (error) {
            console.error('[CashierApp] Data loading error:', error);
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
            const stats = await ShiftService.getCurrentShiftStats(shiftId);
            Store.state.cashier.shiftStats = {
                revenue: stats.totalRevenue || 0,
                salesCount: stats.salesCount || 0,
                averageCheck: stats.averageCheck || 0,
                profit: stats.totalProfit || 0
            };
            this.shiftPanel?.update();
        } catch (error) {
            console.error('[CashierApp] Stats update error:', error);
        }
    }

    subscribeToStore() {
        this.unsubscribers.push(
            Store.subscribe('cashier.filteredProducts', () => this.productGrid?.update()),
            Store.subscribe('cashier.cartItems', () => this.updateCartUI()),
            Store.subscribe('cashier.cartTotalDiscount', () => this.updateCartUI())
        );
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

    // ========== ОБРАБОТЧИКИ ==========
    
    async handleOpenShift() {
        try {
            const shift = await ShiftService.openShift(this.user.id);
            Store.state.cashier.currentShift = shift;
            Store.state.cashier.shiftStats = { revenue: 0, salesCount: 0, averageCheck: 0, profit: 0 };
            
            await this.update();
            await this.mountShiftComponents();
            await this.loadData();
            
            Notification.success('Смена открыта');
        } catch (error) {
            Notification.error('Ошибка при открытии смены');
        }
    }

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
        
        // Триггерим обновление
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
        
        // Создаем модалку для выбора оплаты
        const modalContainer = document.getElementById('modal-container');
        this.paymentModal = new PaymentModal(modalContainer, {
            total: Store.getCartTotal(),
            onConfirm: async (method, received) => {
                await this.processCheckout(method, received);
            }
        });
        await this.paymentModal.mount();
    }

    async processCheckout(paymentMethod, receivedAmount) {
        try {
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
            
            // Очищаем корзину
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            // Обновляем статистику и товары
            await this.updateShiftStats();
            await this.loadData();
            
            Notification.success(`Продажа на ${formatMoney(total)}`);
            this.paymentModal?.destroy();
            
        } catch (error) {
            console.error('[CashierApp] Checkout error:', error);
            Notification.error('Ошибка при создании продажи');
        }
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        this.shiftPanel?.destroy();
        this.categoryNav?.destroy();
        this.productGrid?.destroy();
        this.cart?.destroy();
        this.paymentModal?.destroy();
    }
}
