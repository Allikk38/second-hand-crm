/**
 * Cart Component
 * 
 * Компонент корзины для кассового модуля.
 * Управление товарами перед продажей, скидками и способами оплаты.
 * 
 * Архитектурные решения:
 * - Сохранение корзины в localStorage с привязкой к смене
 * - Поддержка построчных скидок и общей скидки
 * - Кэширование вычислений для производительности
 * - Клавиатурные сокращения для быстрой работы
 * 
 * @module Cart
 * @version 2.0.0
 * @changes
 * - Разделение на компоненты: CartItem, CartSummary, PaymentPanel
 * - Использование CashierState для управления состоянием
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { CashierState } from './cashierState.js';
import { CartItem } from './CartItem.js';
import { CartSummary } from './CartSummary.js';
import { PaymentPanel } from './PaymentPanel.js';
import { ProductService } from '../../services/ProductService.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { formatMoney } from '../../utils/formatters.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY_PREFIX = 'cart_';
const STORAGE_TTL = 8 * 60 * 60 * 1000; // 8 часов

export class Cart extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Компоненты
        this.cartItems = new Map(); // id -> CartItem instance
        
        // Таймеры
        this.saveDebounceTimer = null;
        
        // Отписки
        this.unsubscribeState = null;
        
        // Обработчик клавиатуры
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const state = CashierState.getState();
        const items = state.cartItems;
        const hasItems = items.length > 0;
        const totalQuantity = CashierState.getCartTotalQuantity();
        const scannerInput = state.scannerInput;
        
        // Загружаем из хранилища если корзина пуста
        if (items.length === 0 && CashierState.hasOpenShift()) {
            this.loadFromStorage();
        }
        
        return `
            <div class="cart">
                <div class="cart-header">
                    <h3>
                        Корзина 
                        <span class="cart-count" data-ref="cartCount">${totalQuantity} поз.</span>
                    </h3>
                    <div class="cart-header-actions">
                        ${hasItems ? `
                            <button class="btn-ghost btn-sm" data-ref="clearCartBtn" title="Очистить корзину (Alt+C)">
                                🗑 Очистить
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <div class="scanner-section">
                    <div class="scanner-input-wrapper">
                        <input 
                            type="text" 
                            data-ref="scannerInput"
                            placeholder="Сканер / Быстрый поиск по ID или названию..."
                            value="${this.escapeHtml(scannerInput)}"
                            autocomplete="off"
                            autofocus
                        >
                        ${scannerInput ? `
                            <button class="btn-icon btn-clear-input" data-ref="clearScannerBtn" title="Очистить">
                                ✕
                            </button>
                        ` : ''}
                    </div>
                    <small class="scanner-hint">
                        Введите ID или название товара и нажмите Enter
                    </small>
                </div>
                
                <div class="cart-items" data-ref="cartItemsContainer">
                    ${hasItems 
                        ? items.map(item => `<div data-ref="cartItem-${item.id}"></div>`).join('')
                        : '<div class="cart-empty">🛒 Корзина пуста</div>'
                    }
                </div>
                
                ${hasItems ? `
                    <div data-ref="cartSummaryContainer"></div>
                    <div data-ref="paymentPanelContainer"></div>
                ` : ''}
            </div>
        `;
    }
    
    async afterRender() {
        // Монтируем компоненты для каждого товара
        const state = CashierState.getState();
        
        for (const item of state.cartItems) {
            await this.mountCartItem(item);
        }
        
        // Монтируем итоговую секцию
        if (state.cartItems.length > 0) {
            await this.mountSummary();
            await this.mountPaymentPanel();
        }
    }
    
    async mountCartItem(item) {
        const container = this.refs.get(`cartItem-${item.id}`);
        if (!container) return;
        
        const cartItem = new CartItem(container, {
            item,
            onQuantityChange: (id, quantity) => this.handleQuantityChange(id, quantity),
            onRemove: (id) => this.handleRemoveItem(id),
            onDiscountChange: (id, discount) => this.handleItemDiscountChange(id, discount)
        });
        
        await cartItem.mount();
        this.cartItems.set(item.id, cartItem);
    }
    
    async mountSummary() {
        const container = this.refs.get('cartSummaryContainer');
        if (!container) return;
        
        const summary = new CartSummary(container, {
            onTotalDiscountChange: (discount) => this.handleTotalDiscountChange(discount),
            onQuickDiscount: (discount) => this.handleTotalDiscountChange(discount)
        });
        
        await summary.mount();
        this.summary = summary;
    }
    
    async mountPaymentPanel() {
        const container = this.refs.get('paymentPanelContainer');
        if (!container) return;
        
        const payment = new PaymentPanel(container, {
            onPaymentMethodChange: (method) => this.handlePaymentMethodChange(method),
            onCheckout: () => this.handleCheckout()
        });
        
        await payment.mount();
        this.payment = payment;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Сканер/поиск
        const scannerInput = this.refs.get('scannerInput');
        if (scannerInput) {
            scannerInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleScannerSubmit(scannerInput.value);
                }
            });
            
            scannerInput.addEventListener('input', (e) => {
                CashierState.set('scannerInput', e.target.value);
            });
        }
        
        this.addDomListener('clearScannerBtn', 'click', () => {
            const input = this.refs.get('scannerInput');
            if (input) {
                input.value = '';
                CashierState.set('scannerInput', '');
            }
        });
        
        // Очистка корзины
        this.addDomListener('clearCartBtn', 'click', () => this.handleClearCart());
        
        // Клавиатурные сокращения
        document.addEventListener('keydown', this.handleKeyDown);
        
        // Подписка на состояние
        this.unsubscribeState = CashierState.subscribe(async (changes) => {
            const cartChanged = changes.some(c => 
                ['cartItems', 'cartTotalDiscount', 'cartPaymentMethod'].includes(c.key)
            );
            
            if (cartChanged) {
                const state = CashierState.getState();
                
                // Обновляем счетчик
                const countEl = this.refs.get('cartCount');
                if (countEl) {
                    countEl.textContent = `${CashierState.getCartTotalQuantity()} поз.`;
                }
                
                // Проверяем, нужно ли пересоздать компоненты
                const itemsChanged = changes.some(c => c.key === 'cartItems');
                if (itemsChanged) {
                    await this.syncCartItems(state.cartItems);
                    
                    // Показываем/скрываем summary и payment
                    const hasItems = state.cartItems.length > 0;
                    const summaryContainer = this.refs.get('cartSummaryContainer');
                    const paymentContainer = this.refs.get('paymentPanelContainer');
                    
                    if (hasItems && !summaryContainer?.children.length) {
                        await this.mountSummary();
                        await this.mountPaymentPanel();
                    }
                }
                
                this.saveToStorage();
            }
        });
        
        // Подписка на внешние события
        this.subscribe('cart:add-item', ({ product }) => this.addItem(product));
        this.subscribe('cart:clear', () => this.clear());
    }
    
    async syncCartItems(items) {
        // Удаляем компоненты для удаленных товаров
        for (const [id, component] of this.cartItems) {
            if (!items.find(i => i.id === id)) {
                component.destroy();
                this.cartItems.delete(id);
            }
        }
        
        // Создаем компоненты для новых товаров
        for (const item of items) {
            if (!this.cartItems.has(item.id)) {
                await this.mountCartItem(item);
            } else {
                // Обновляем существующий
                this.cartItems.get(item.id)?.updateItem(item);
            }
        }
    }
    
    // ========== ОБРАБОТЧИКИ ==========
    
    handleKeyDown(e) {
        if (e.altKey && e.code === 'KeyC') {
            e.preventDefault();
            this.handleClearCart();
        }
        
        if (e.altKey && e.code === 'Enter') {
            e.preventDefault();
            this.handleCheckout();
        }
        
        if (e.code === 'Slash' && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            this.refs.get('scannerInput')?.focus();
        }
    }
    
    async handleScannerSubmit(input) {
        const value = input.trim();
        if (!value) return;
        
        CashierState.set('scannerInput', '');
        
        try {
            let product = await ProductService.getById(value).catch(() => null);
            
            if (!product) {
                const products = await ProductService.getAll();
                product = products.find(p => 
                    p.name.toLowerCase().includes(value.toLowerCase()) ||
                    p.keywords?.toLowerCase().includes(value.toLowerCase())
                );
            }
            
            if (!product) {
                Notification.warning(`Товар не найден: ${value}`);
                return;
            }
            
            if (product.status !== 'in_stock') {
                Notification.warning(`Товар "${product.name}" уже продан`);
                return;
            }
            
            this.addItem(product);
            
            const scannerInput = this.refs.get('scannerInput');
            if (scannerInput) {
                scannerInput.value = '';
                scannerInput.focus();
            }
            
        } catch (error) {
            console.error('[Cart] Scanner error:', error);
            Notification.error('Ошибка при поиске товара');
        }
    }
    
    addItem(product) {
        if (product.status !== 'in_stock') {
            Notification.warning(`Товар "${product.name}" недоступен для продажи`);
            return false;
        }
        
        const added = CashierState.addToCart(product);
        
        if (added) {
            Notification.info(`Добавлено: ${product.name}`);
            this.publish('cart:updated', { items: CashierState.getState().cartItems });
        }
        
        return added;
    }
    
    handleQuantityChange(id, quantity) {
        CashierState.updateCartItemQuantity(id, quantity);
        this.publish('cart:updated', { items: CashierState.getState().cartItems });
    }
    
    async handleRemoveItem(id) {
        const state = CashierState.getState();
        const item = state.cartItems.find(i => i.id === id);
        if (!item) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Удаление товара',
            message: `Удалить "${item.name}" из корзины?`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (confirmed) {
            CashierState.removeFromCart(id);
            Notification.info(`Удалено: ${item.name}`);
            this.publish('cart:updated', { items: CashierState.getState().cartItems });
        }
    }
    
    handleItemDiscountChange(id, discount) {
        CashierState.setCartItemDiscount(id, discount);
    }
    
    handleTotalDiscountChange(discount) {
        CashierState.set('cartTotalDiscount', Math.min(discount, 50));
    }
    
    handlePaymentMethodChange(method) {
        CashierState.set('cartPaymentMethod', method);
    }
    
    async handleClearCart() {
        const state = CashierState.getState();
        if (state.cartItems.length === 0) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Очистка корзины',
            message: 'Все товары будут удалены из корзины. Продолжить?',
            confirmText: 'Очистить',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (confirmed) {
            this.clear();
        }
    }
    
    clear() {
        CashierState.clearCart();
        this.clearStorage();
        Notification.info('Корзина очищена');
        this.publish('cart:cleared', {});
    }
    
    handleCheckout() {
        const state = CashierState.getState();
        
        if (state.cartItems.length === 0) {
            Notification.warning('Корзина пуста');
            return;
        }
        
        const items = state.cartItems.map(item => ({
            ...item,
            discount: state.cartItemDiscounts.get(item.id) || 0
        }));
        
        const total = CashierState.getCartTotal();
        
        this.publish('cart:checkout', {
            items,
            total,
            discount: state.cartTotalDiscount,
            paymentMethod: state.cartPaymentMethod
        });
    }
    
    // ========== ХРАНИЛИЩЕ ==========
    
    getStorageKey() {
        const shiftId = CashierState.getShiftId();
        return `${STORAGE_KEY_PREFIX}${shiftId || 'default'}`;
    }
    
    saveToStorage() {
        if (!CashierState.hasOpenShift()) return;
        
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        
        this.saveDebounceTimer = setTimeout(() => {
            const state = CashierState.getState();
            
            const data = {
                items: state.cartItems,
                totalDiscount: state.cartTotalDiscount,
                paymentMethod: state.cartPaymentMethod,
                itemDiscounts: Array.from(state.cartItemDiscounts.entries()),
                savedAt: Date.now()
            };
            
            localStorage.setItem(this.getStorageKey(), JSON.stringify(data));
            this.saveDebounceTimer = null;
        }, 500);
    }
    
    loadFromStorage() {
        if (!CashierState.hasOpenShift()) return;
        
        try {
            const stored = localStorage.getItem(this.getStorageKey());
            if (!stored) return;
            
            const data = JSON.parse(stored);
            
            if (Date.now() - data.savedAt > STORAGE_TTL) {
                this.clearStorage();
                return;
            }
            
            CashierState.setMultiple({
                cartItems: data.items || [],
                cartTotalDiscount: data.totalDiscount || 0,
                cartPaymentMethod: data.paymentMethod || 'cash',
                cartItemDiscounts: new Map(data.itemDiscounts || [])
            });
            
            if (data.items?.length > 0) {
                Notification.info(`Корзина восстановлена (${data.items.length} поз.)`);
            }
        } catch (error) {
            console.error('[Cart] Load storage error:', error);
        }
    }
    
    clearStorage() {
        if (!CashierState.hasOpenShift()) return;
        localStorage.removeItem(this.getStorageKey());
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.saveToStorage();
        
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
        
        document.removeEventListener('keydown', this.handleKeyDown);
        
        // Уничтожаем дочерние компоненты
        this.cartItems.forEach(component => component.destroy());
        this.cartItems.clear();
        
        this.summary?.destroy();
        this.payment?.destroy();
    }
}
