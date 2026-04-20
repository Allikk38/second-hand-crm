/**
 * Cart Component
 * 
 * Компонент корзины для кассового модуля.
 * Управление товарами перед продажей с расширенными возможностями.
 * 
 * Архитектурные решения:
 * - Сохранение корзины в localStorage с привязкой к смене
 * - Поддержка построчных скидок и общей скидки
 * - Кэширование вычислений для производительности
 * - Валидация остатков в реальном времени
 * - Подготовка к работе со сканером штрихкодов
 * - Клавиатурные сокращения для быстрой работы
 * 
 * @module Cart
 * @extends BaseComponent
 * @requires ProductService
 * @requires Notification
 * @requires ConfirmDialog
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { formatMoney, formatPercent } from '../../utils/formatters.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY_PREFIX = 'cart_';
const MAX_TOTAL_DISCOUNT = 50; // Максимальная общая скидка в процентах
const MAX_ITEM_DISCOUNT = 30; // Максимальная скидка на товар
const QUICK_DISCOUNTS = [5, 10, 15, 20, 25];
const STORAGE_TTL = 8 * 60 * 60 * 1000; // 8 часов

export class Cart extends BaseComponent {
    constructor(container, shiftId = null) {
        super(container);
        
        // ID смены для сохранения корзины
        this.shiftId = shiftId;
        
        // Состояние
        this._state = {
            items: [],
            totalDiscount: 0,
            paymentMethod: 'cash',
            itemDiscounts: new Map(), // id -> discount percent
            scannerInput: '',
            isCheckingStock: false
        };
        
        // Кэш вычислений
        this._cache = {
            subtotal: 0,
            itemsDiscount: 0,
            total: 0,
            timestamp: 0
        };
        
        // Таймер для автосохранения
        this.saveDebounceTimer = null;
        
        // Обработчик клавиатуры
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    /**
     * Устанавливает ID смены
     */
    setShiftId(shiftId) {
        this.shiftId = shiftId;
        this.loadFromStorage();
        this.update();
    }

    async render() {
        // Восстанавливаем из хранилища
        if (this.shiftId) {
            this.loadFromStorage();
        }
        
        const subtotal = this.getSubtotal();
        const itemsDiscount = this.getItemsDiscountAmount();
        const totalDiscountAmount = this.getTotalDiscountAmount();
        const total = this.getTotal();
        
        const hasItems = this._state.items.length > 0;
        const totalQuantity = this.getTotalQuantity();
        
        return `
            <div class="cart">
                <div class="cart-header">
                    <h3>
                        Корзина 
                        <span class="cart-count">${totalQuantity} поз.</span>
                    </h3>
                    <div class="cart-header-actions">
                        ${hasItems ? `
                            <button class="btn-ghost btn-sm" data-ref="clearCartBtn" title="Очистить корзину (Alt+C)">
                                🗑 Очистить
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <!-- Поле сканера/быстрого поиска -->
                <div class="scanner-section">
                    <div class="scanner-input-wrapper">
                        <input 
                            type="text" 
                            data-ref="scannerInput"
                            placeholder="Сканер / Быстрый поиск по ID или названию..."
                            value="${this.escapeHtml(this._state.scannerInput)}"
                            autocomplete="off"
                            autofocus
                        >
                        ${this._state.scannerInput ? `
                            <button class="btn-icon btn-clear-input" data-ref="clearScannerBtn" title="Очистить">
                                ✕
                            </button>
                        ` : ''}
                    </div>
                    <small class="scanner-hint">
                        Введите ID или название товара и нажмите Enter
                    </small>
                </div>
                
                <!-- Список товаров -->
                <div class="cart-items" data-ref="cartItemsContainer">
                    ${hasItems 
                        ? this._state.items.map(item => this.renderCartItem(item)).join('')
                        : '<div class="cart-empty">🛒 Корзина пуста</div>'
                    }
                </div>
                
                ${hasItems ? this.renderSummary(subtotal, itemsDiscount, totalDiscountAmount, total) : ''}
            </div>
        `;
    }

    /**
     * Рендерит один товар в корзине
     */
    renderCartItem(item) {
        const itemDiscount = this._state.itemDiscounts.get(item.id) || 0;
        const originalPrice = item.price;
        const discountedPrice = itemDiscount > 0 
            ? originalPrice * (1 - itemDiscount / 100) 
            : originalPrice;
        const itemTotal = discountedPrice * item.quantity;
        const savings = itemDiscount > 0 
            ? (originalPrice - discountedPrice) * item.quantity 
            : 0;
        
        const stockWarning = item.quantity >= (item.maxStock || Infinity) * 0.8;
        const isMaxReached = item.quantity >= (item.maxStock || Infinity);
        
        return `
            <div class="cart-item ${stockWarning ? 'stock-warning' : ''}" data-id="${item.id}">
                <div class="cart-item-main">
                    <div class="cart-item-info">
                        <span class="cart-item-name">${this.escapeHtml(item.name)}</span>
                        ${item.size ? `
                            <span class="cart-item-size">Размер: ${item.size}</span>
                        ` : ''}
                        <div class="cart-item-prices">
                            ${itemDiscount > 0 ? `
                                <span class="original-price">${formatMoney(originalPrice)}</span>
                                <span class="discounted-price">${formatMoney(discountedPrice)}</span>
                            ` : `
                                <span class="item-price">${formatMoney(originalPrice)}</span>
                            `}
                        </div>
                    </div>
                    
                    <div class="cart-item-actions">
                        <div class="quantity-control">
                            <button 
                                class="btn-icon btn-qty" 
                                data-action="decrease" 
                                data-id="${item.id}"
                                ${item.quantity <= 1 ? 'disabled' : ''}
                            >
                                −
                            </button>
                            <input 
                                type="number" 
                                class="qty-input" 
                                data-id="${item.id}"
                                value="${item.quantity}" 
                                min="1" 
                                max="${item.maxStock || 999}"
                                step="1"
                            >
                            <button 
                                class="btn-icon btn-qty" 
                                data-action="increase" 
                                data-id="${item.id}"
                                ${isMaxReached ? 'disabled' : ''}
                            >
                                +
                            </button>
                        </div>
                        
                        <div class="item-total">
                            ${formatMoney(itemTotal)}
                        </div>
                        
                        <button 
                            class="btn-icon btn-remove" 
                            data-action="remove" 
                            data-id="${item.id}"
                            title="Удалить"
                        >
                            ✕
                        </button>
                    </div>
                </div>
                
                <!-- Построчная скидка -->
                <div class="cart-item-discount">
                    <div class="discount-row">
                        <label>Скидка на товар:</label>
                        <div class="discount-input-group">
                            <input 
                                type="number" 
                                class="item-discount-input" 
                                data-id="${item.id}"
                                value="${itemDiscount}" 
                                min="0" 
                                max="${MAX_ITEM_DISCOUNT}" 
                                step="1"
                            >
                            <span>%</span>
                            ${itemDiscount > 0 ? `
                                <button 
                                    class="btn-ghost btn-xs" 
                                    data-action="clearItemDiscount" 
                                    data-id="${item.id}"
                                >
                                    Сбросить
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${itemDiscount > 0 ? `
                        <div class="discount-info">
                            <span>Экономия: ${formatMoney(savings)}</span>
                            <span class="discount-badge">-${itemDiscount}%</span>
                        </div>
                    ` : ''}
                    
                    ${stockWarning ? `
                        <div class="stock-warning-message">
                            ⚠ Осталось всего ${item.maxStock - item.quantity} шт.
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Рендерит итоговую секцию
     */
    renderSummary(subtotal, itemsDiscount, totalDiscountAmount, total) {
        const quickDiscounts = QUICK_DISCOUNTS.map(d => `
            <button 
                class="btn-ghost btn-xs quick-discount" 
                data-discount="${d}"
                title="Применить скидку ${d}%"
            >
                ${d}%
            </button>
        `).join('');
        
        return `
            <div class="cart-summary">
                <div class="summary-row">
                    <span>Сумма без скидок:</span>
                    <span>${formatMoney(subtotal)}</span>
                </div>
                
                ${itemsDiscount > 0 ? `
                    <div class="summary-row text-success">
                        <span>Скидка на товары:</span>
                        <span>−${formatMoney(itemsDiscount)}</span>
                    </div>
                ` : ''}
                
                <div class="summary-row discount-row">
                    <span>Общая скидка:</span>
                    <div class="discount-control">
                        <div class="discount-input-wrapper">
                            <input 
                                type="number" 
                                data-ref="totalDiscountInput"
                                value="${this._state.totalDiscount}" 
                                min="0" 
                                max="${MAX_TOTAL_DISCOUNT}" 
                                step="1"
                            >
                            <span>%</span>
                        </div>
                        <div class="quick-discounts">
                            ${quickDiscounts}
                            ${this._state.totalDiscount > 0 ? `
                                <button 
                                    class="btn-ghost btn-xs" 
                                    data-ref="clearTotalDiscountBtn"
                                >
                                    Сбросить
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                ${totalDiscountAmount > 0 ? `
                    <div class="summary-row text-success">
                        <span>Сумма скидки:</span>
                        <span>−${formatMoney(totalDiscountAmount)}</span>
                    </div>
                ` : ''}
                
                <div class="summary-row total-row">
                    <span>ИТОГО:</span>
                    <span class="total-amount">${formatMoney(total)}</span>
                </div>
                
                <div class="payment-methods">
                    <label class="payment-option ${this._state.paymentMethod === 'cash' ? 'active' : ''}">
                        <input 
                            type="radio" 
                            name="payment" 
                            value="cash" 
                            data-ref="paymentCash"
                            ${this._state.paymentMethod === 'cash' ? 'checked' : ''}
                        >
                        <span class="payment-icon">💵</span>
                        Наличные
                    </label>
                    <label class="payment-option ${this._state.paymentMethod === 'card' ? 'active' : ''}">
                        <input 
                            type="radio" 
                            name="payment" 
                            value="card" 
                            data-ref="paymentCard"
                            ${this._state.paymentMethod === 'card' ? 'checked' : ''}
                        >
                        <span class="payment-icon">💳</span>
                        Карта
                    </label>
                    <label class="payment-option ${this._state.paymentMethod === 'transfer' ? 'active' : ''}">
                        <input 
                            type="radio" 
                            name="payment" 
                            value="transfer" 
                            data-ref="paymentTransfer"
                            ${this._state.paymentMethod === 'transfer' ? 'checked' : ''}
                        >
                        <span class="payment-icon">📱</span>
                        Перевод
                    </label>
                </div>
                
                <button class="btn-checkout" data-ref="checkoutBtn">
                    💰 Продать (${formatMoney(total)})
                </button>
                
                <div class="keyboard-hints">
                    <small>Alt+C — очистить | Alt+Enter — продать</small>
                </div>
            </div>
        `;
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
                this._state.scannerInput = e.target.value;
            });
        }
        
        this.addDomListener('clearScannerBtn', 'click', () => {
            const input = this.refs.get('scannerInput');
            if (input) {
                input.value = '';
                this._state.scannerInput = '';
            }
        });
        
        // Делегирование событий для товаров
        const container = this.refs.get('cartItemsContainer');
        if (container) {
            container.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                
                switch (action) {
                    case 'increase':
                        this.increaseQuantity(id);
                        break;
                    case 'decrease':
                        this.decreaseQuantity(id);
                        break;
                    case 'remove':
                        this.handleRemoveItem(id);
                        break;
                    case 'clearItemDiscount':
                        this.setItemDiscount(id, 0);
                        break;
                }
            });
            
            container.addEventListener('change', (e) => {
                if (e.target.classList.contains('qty-input')) {
                    const id = e.target.dataset.id;
                    const quantity = parseInt(e.target.value) || 1;
                    this.setQuantity(id, quantity);
                }
                
                if (e.target.classList.contains('item-discount-input')) {
                    const id = e.target.dataset.id;
                    const discount = parseFloat(e.target.value) || 0;
                    this.setItemDiscount(id, Math.min(discount, MAX_ITEM_DISCOUNT));
                }
            });
        }
        
        // Общая скидка
        const discountInput = this.refs.get('totalDiscountInput');
        if (discountInput) {
            discountInput.addEventListener('input', (e) => {
                let discount = parseFloat(e.target.value) || 0;
                discount = Math.min(discount, MAX_TOTAL_DISCOUNT);
                this._state.totalDiscount = discount;
                this.invalidateCache();
                this.update();
                this.saveToStorage();
            });
        }
        
        this.addDomListener('clearTotalDiscountBtn', 'click', () => {
            this._state.totalDiscount = 0;
            this.invalidateCache();
            this.update();
            this.saveToStorage();
        });
        
        // Быстрые скидки
        document.querySelectorAll('[data-discount]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const discount = parseFloat(e.target.dataset.discount);
                this._state.totalDiscount = discount;
                this.invalidateCache();
                this.update();
                this.saveToStorage();
            });
        });
        
        // Способ оплаты
        this.addDomListener('paymentCash', 'change', (e) => {
            if (e.target.checked) this._state.paymentMethod = 'cash';
            this.saveToStorage();
        });
        this.addDomListener('paymentCard', 'change', (e) => {
            if (e.target.checked) this._state.paymentMethod = 'card';
            this.saveToStorage();
        });
        this.addDomListener('paymentTransfer', 'change', (e) => {
            if (e.target.checked) this._state.paymentMethod = 'transfer';
            this.saveToStorage();
        });
        
        // Очистка корзины
        this.addDomListener('clearCartBtn', 'click', () => this.handleClearCart());
        
        // Оформление продажи
        this.addDomListener('checkoutBtn', 'click', () => this.handleCheckout());
        
        // Клавиатурные сокращения
        document.addEventListener('keydown', this.handleKeyDown);
        
        // Подписка на события извне
        this.subscribe('cart:add-item', ({ product }) => this.addItem(product));
        this.subscribe('cart:clear', () => this.clear());
    }

    /**
     * Обработчик клавиатуры
     */
    handleKeyDown(e) {
        // Alt + C = очистить корзину
        if (e.altKey && e.code === 'KeyC') {
            e.preventDefault();
            this.handleClearCart();
        }
        
        // Alt + Enter = оформить продажу
        if (e.altKey && e.code === 'Enter') {
            e.preventDefault();
            this.handleCheckout();
        }
        
        // Фокус на сканер по /
        if (e.code === 'Slash' && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            this.refs.get('scannerInput')?.focus();
        }
    }

    // ========== УПРАВЛЕНИЕ ТОВАРАМИ ==========
    
    /**
     * Обработчик сканера/поиска
     */
    async handleScannerSubmit(input) {
        const value = input.trim();
        if (!value) return;
        
        this._state.isCheckingStock = true;
        this.update();
        
        try {
            // Пробуем найти по ID
            let product = await ProductService.getById(value).catch(() => null);
            
            // Если не нашли по ID, ищем по названию
            if (!product) {
                const products = await ProductService.getAll();
                product = products.find(p => 
                    p.name.toLowerCase().includes(value.toLowerCase()) ||
                    (p.keywords && p.keywords.toLowerCase().includes(value.toLowerCase()))
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
            
            // Очищаем поле
            const scannerInput = this.refs.get('scannerInput');
            if (scannerInput) {
                scannerInput.value = '';
                this._state.scannerInput = '';
            }
            
        } catch (error) {
            console.error('[Cart] Scanner error:', error);
            Notification.error('Ошибка при поиске товара');
        } finally {
            this._state.isCheckingStock = false;
            this.update();
        }
    }

    /**
     * Добавляет товар в корзину
     */
    addItem(product) {
        if (product.status !== 'in_stock') {
            Notification.warning(`Товар "${product.name}" недоступен для продажи`);
            return false;
        }
        
        const existing = this._state.items.find(i => i.id === product.id);
        
        if (existing) {
            // Проверяем, не превышает ли количество
            if (existing.quantity >= 999) {
                Notification.warning('Достигнуто максимальное количество');
                return false;
            }
            
            existing.quantity += 1;
            Notification.info(`Добавлено: ${product.name} (${existing.quantity} шт.)`);
        } else {
            this._state.items.push({
                ...product,
                quantity: 1,
                maxStock: 999 // По умолчанию
            });
            Notification.info(`Добавлено: ${product.name}`);
        }
        
        this.invalidateCache();
        this.update();
        this.saveToStorage();
        this.publish('cart:updated', { items: this._state.items });
        
        return true;
    }

    /**
     * Увеличивает количество товара
     */
    increaseQuantity(id) {
        const item = this._state.items.find(i => i.id === id);
        if (!item) return;
        
        if (item.quantity >= 999) {
            Notification.warning('Достигнуто максимальное количество');
            return;
        }
        
        item.quantity += 1;
        
        this.invalidateCache();
        this.update();
        this.saveToStorage();
        this.publish('cart:updated', { items: this._state.items });
    }

    /**
     * Уменьшает количество товара
     */
    decreaseQuantity(id) {
        const item = this._state.items.find(i => i.id === id);
        if (!item) return;
        
        if (item.quantity > 1) {
            item.quantity -= 1;
        }
        
        this.invalidateCache();
        this.update();
        this.saveToStorage();
        this.publish('cart:updated', { items: this._state.items });
    }

    /**
     * Устанавливает количество товара
     */
    setQuantity(id, quantity) {
        const item = this._state.items.find(i => i.id === id);
        if (!item) return;
        
        quantity = Math.max(1, Math.min(quantity, 999));
        item.quantity = quantity;
        
        this.invalidateCache();
        this.update();
        this.saveToStorage();
        this.publish('cart:updated', { items: this._state.items });
    }

    /**
     * Устанавливает скидку на товар
     */
    setItemDiscount(id, discount) {
        discount = Math.max(0, Math.min(discount, MAX_ITEM_DISCOUNT));
        
        if (discount === 0) {
            this._state.itemDiscounts.delete(id);
        } else {
            this._state.itemDiscounts.set(id, discount);
        }
        
        this.invalidateCache();
        this.update();
        this.saveToStorage();
    }

    /**
     * Обработчик удаления товара
     */
    async handleRemoveItem(id) {
        const item = this._state.items.find(i => i.id === id);
        if (!item) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Удаление товара',
            message: `Удалить "${item.name}" из корзины?`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (confirmed) {
            this.removeItem(id);
        }
    }

    /**
     * Удаляет товар из корзины
     */
    removeItem(id) {
        const item = this._state.items.find(i => i.id === id);
        
        this._state.items = this._state.items.filter(i => i.id !== id);
        this._state.itemDiscounts.delete(id);
        
        this.invalidateCache();
        this.update();
        this.saveToStorage();
        
        if (item) {
            Notification.info(`Удалено: ${item.name}`);
        }
        
        this.publish('cart:updated', { items: this._state.items });
    }

    /**
     * Обработчик очистки корзины
     */
    async handleClearCart() {
        if (this._state.items.length === 0) return;
        
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

    /**
     * Очищает корзину
     */
    clear() {
        this._state.items = [];
        this._state.totalDiscount = 0;
        this._state.itemDiscounts.clear();
        this._state.paymentMethod = 'cash';
        
        this.invalidateCache();
        this.update();
        this.clearStorage();
        
        Notification.info('Корзина очищена');
        this.publish('cart:cleared', {});
    }

    // ========== РАСЧЕТЫ ==========
    
    /**
     * Инвалидирует кэш вычислений
     */
    invalidateCache() {
        this._cache.timestamp = 0;
    }

    /**
     * Получает общее количество товаров
     */
    getTotalQuantity() {
        return this._state.items.reduce((sum, item) => sum + item.quantity, 0);
    }

    /**
     * Получает сумму без скидок
     */
    getSubtotal() {
        if (this._cache.timestamp && this._cache.subtotal) {
            return this._cache.subtotal;
        }
        
        this._cache.subtotal = this._state.items.reduce(
            (sum, item) => sum + (item.price * item.quantity), 
            0
        );
        this._cache.timestamp = Date.now();
        
        return this._cache.subtotal;
    }

    /**
     * Получает сумму построчных скидок
     */
    getItemsDiscountAmount() {
        return this._state.items.reduce((sum, item) => {
            const discount = this._state.itemDiscounts.get(item.id) || 0;
            if (discount > 0) {
                const itemTotal = item.price * item.quantity;
                return sum + (itemTotal * discount / 100);
            }
            return sum;
        }, 0);
    }

    /**
     * Получает сумму общей скидки
     */
    getTotalDiscountAmount() {
        const subtotalAfterItems = this.getSubtotal() - this.getItemsDiscountAmount();
        return subtotalAfterItems * (this._state.totalDiscount / 100);
    }

    /**
     * Получает итоговую сумму
     */
    getTotal() {
        if (this._cache.timestamp && this._cache.total) {
            return this._cache.total;
        }
        
        const subtotal = this.getSubtotal();
        const itemsDiscount = this.getItemsDiscountAmount();
        const subtotalAfterItems = subtotal - itemsDiscount;
        const totalDiscount = subtotalAfterItems * (this._state.totalDiscount / 100);
        
        this._cache.total = Math.max(0, subtotalAfterItems - totalDiscount);
        
        return this._cache.total;
    }

    // ========== ОФОРМЛЕНИЕ ПРОДАЖИ ==========
    
    /**
     * Обработчик оформления продажи
     */
    async handleCheckout() {
        if (this._state.items.length === 0) {
            Notification.warning('Корзина пуста');
            return;
        }
        
        const total = this.getTotal();
        const items = this._state.items.map(item => ({
            ...item,
            discount: this._state.itemDiscounts.get(item.id) || 0
        }));
        
        const confirmed = await ConfirmDialog.show({
            title: 'Подтверждение продажи',
            message: `
                Товаров: ${this.getTotalQuantity()} поз.
                Сумма: ${formatMoney(total)}
                Способ оплаты: ${this.getPaymentMethodName()}
            `,
            confirmText: 'Продать',
            cancelText: 'Отмена',
            type: 'info'
        });
        
        if (!confirmed) return;
        
        this.publish('cart:checkout', {
            items,
            total,
            discount: this._state.totalDiscount,
            itemDiscounts: Array.from(this._state.itemDiscounts.entries()),
            paymentMethod: this._state.paymentMethod
        });
    }

    /**
     * Получает название способа оплаты
     */
    getPaymentMethodName() {
        const names = {
            cash: 'Наличные',
            card: 'Карта',
            transfer: 'Перевод'
        };
        return names[this._state.paymentMethod] || this._state.paymentMethod;
    }

    // ========== ХРАНИЛИЩЕ ==========
    
    /**
     * Получает ключ для localStorage
     */
    getStorageKey() {
        return `${STORAGE_KEY_PREFIX}${this.shiftId || 'default'}`;
    }

    /**
     * Сохраняет корзину в localStorage
     */
    saveToStorage() {
        if (!this.shiftId) return;
        
        // Дебаунс сохранения
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        
        this.saveDebounceTimer = setTimeout(() => {
            const data = {
                items: this._state.items,
                totalDiscount: this._state.totalDiscount,
                paymentMethod: this._state.paymentMethod,
                itemDiscounts: Array.from(this._state.itemDiscounts.entries()),
                savedAt: Date.now()
            };
            
            localStorage.setItem(this.getStorageKey(), JSON.stringify(data));
            this.saveDebounceTimer = null;
        }, 500);
    }

    /**
     * Загружает корзину из localStorage
     */
    loadFromStorage() {
        if (!this.shiftId) return;
        
        try {
            const stored = localStorage.getItem(this.getStorageKey());
            if (!stored) return;
            
            const data = JSON.parse(stored);
            
            // Проверяем TTL
            if (Date.now() - data.savedAt > STORAGE_TTL) {
                this.clearStorage();
                return;
            }
            
            this._state.items = data.items || [];
            this._state.totalDiscount = data.totalDiscount || 0;
            this._state.paymentMethod = data.paymentMethod || 'cash';
            this._state.itemDiscounts = new Map(data.itemDiscounts || []);
            
            this.invalidateCache();
            
            Notification.info(`Корзина восстановлена (${this._state.items.length} поз.)`);
        } catch (error) {
            console.error('[Cart] Load storage error:', error);
        }
    }

    /**
     * Очищает хранилище
     */
    clearStorage() {
        if (!this.shiftId) return;
        localStorage.removeItem(this.getStorageKey());
    }

    // ========== ПОЛУЧЕНИЕ ДАННЫХ ==========
    
    /**
     * Возвращает товары для продажи
     */
    getItemsForSale() {
        return this._state.items.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            discount: this._state.itemDiscounts.get(item.id) || 0
        }));
    }

    /**
     * Возвращает состояние корзины
     */
    getState() {
        return {
            items: [...this._state.items],
            totalDiscount: this._state.totalDiscount,
            paymentMethod: this._state.paymentMethod,
            itemDiscounts: new Map(this._state.itemDiscounts),
            isEmpty: this._state.items.length === 0
        };
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        // Сохраняем перед уничтожением
        this.saveToStorage();
        
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        
        document.removeEventListener('keydown', this.handleKeyDown);
    }
}
