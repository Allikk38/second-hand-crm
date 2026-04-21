/**
 * Cashier Application
 * 
 * Главный контроллер кассового модуля.
 * Инициализирует хранилище, сервисы и компоненты.
 * Управляет жизненным циклом приложения.
 * 
 * Архитектурные решения:
 * - Полная изоляция от других модулей (MPA)
 * - Ленивая инициализация компонентов
 * - Приоритетная загрузка критических данных
 * - Офлайн-поддержка через SyncManager
 * 
 * @module CashierApp
 * @version 6.0.0
 * @changes
 * - Полная переработка под MPA архитектуру
 * - Удалены зависимости от общего Store и Router
 * - Добавлен KeyboardManager для горячих клавиш
 * - Добавлен SyncManager для офлайн-продаж
 */

import { AuthManager } from '../../modules/auth/AuthManager.js';
import { ShiftService } from '../../services/ShiftService.js';
import { ProductService } from '../../services/ProductService.js';
import { SaleService } from '../../services/SaleService.js';
import { Notification } from '../../shared/components/Notification.js';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog.js';
import { EventBus } from '../../core/EventBus.js';

// Ленивая загрузка компонентов кассы
let CashierStore = null;
let KeyboardManager = null;
let CartService = null;
let CheckoutService = null;
let ShiftPanel = null;
let SearchBar = null;
let CategoryBar = null;
let ProductGrid = null;
let CartPanel = null;
let PaymentModal = null;

// ========== КОНСТАНТЫ ==========
const CACHE_BUST = 'v=6.0.0';
const LOAD_TIMEOUT = 10000;
const STATS_UPDATE_INTERVAL = 30000;
const AUTO_SAVE_INTERVAL = 5000;

class CashierApp {
    constructor() {
        this.root = document.getElementById('cashier-root');
        this.skeleton = document.getElementById('cashier-skeleton');
        
        // Компоненты
        this.shiftPanel = null;
        this.searchBar = null;
        this.categoryBar = null;
        this.productGrid = null;
        this.cartPanel = null;
        this.paymentModal = null;
        
        // Состояние
        this.isInitialized = false;
        this.isLoading = false;
        this.user = null;
        
        // Таймеры
        this.statsTimer = null;
        this.autoSaveTimer = null;
        
        // Отписки
        this.unsubscribers = [];
        
        // Флаг для отметки загрузки
        window.__cashierAppLoaded = false;
    }
    
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    /**
     * Запускает приложение
     */
    async init() {
        console.log('[CashierApp] Initializing...');
        
        // Устанавливаем таймаут загрузки
        const loadTimeout = setTimeout(() => {
            if (!this.isInitialized) {
                this.showError('Превышено время загрузки. Проверьте подключение.');
            }
        }, LOAD_TIMEOUT);
        
        try {
            // 1. Проверяем авторизацию
            this.user = await this.checkAuth();
            if (!this.user) {
                this.redirectToLogin();
                return;
            }
            
            // 2. Загружаем критические модули параллельно
            await this.loadCoreModules();
            
            // 3. Инициализируем Store
            await this.initStore();
            
            // 4. Загружаем критические данные (смена)
            await this.loadShiftData();
            
            // 5. Скрываем скелет и рендерим интерфейс
            this.hideSkeleton();
            await this.renderComponents();
            
            // 6. Загружаем остальные данные в фоне
            this.loadBackgroundData();
            
            // 7. Настраиваем горячие клавиши
            this.initKeyboard();
            
            // 8. Запускаем автосохранение
            this.startAutoSave();
            
            // 9. Запускаем обновление статистики
            this.startStatsUpdate();
            
            // 10. Подписываемся на события
            this.subscribeToEvents();
            
            this.isInitialized = true;
            window.__cashierAppLoaded = true;
            
            console.log('[CashierApp] Initialized successfully');
            
        } catch (error) {
            console.error('[CashierApp] Init error:', error);
            this.showError('Ошибка при загрузке кассы');
        } finally {
            clearTimeout(loadTimeout);
        }
    }
    
    /**
     * Проверяет авторизацию пользователя
     */
    async checkAuth() {
        try {
            const user = await AuthManager.init();
            return user;
        } catch (error) {
            console.error('[CashierApp] Auth error:', error);
            return null;
        }
    }
    
    /**
     * Загружает критические модули
     */
    async loadCoreModules() {
        console.log('[CashierApp] Loading core modules...');
        
        const [
            storeModule,
            keyboardModule,
            cartModule,
            checkoutModule
        ] = await Promise.all([
            import(`./core/CashierStore.js?${CACHE_BUST}`),
            import(`./core/KeyboardManager.js?${CACHE_BUST}`),
            import(`./services/CartService.js?${CACHE_BUST}`),
            import(`./services/CheckoutService.js?${CACHE_BUST}`)
        ]);
        
        CashierStore = storeModule.CashierStore;
        KeyboardManager = keyboardModule.KeyboardManager;
        CartService = cartModule.CartService;
        CheckoutService = checkoutModule.CheckoutService;
    }
    
    /**
     * Инициализирует хранилище
     */
    async initStore() {
        console.log('[CashierApp] Initializing Store...');
        
        CashierStore.init({
            userId: this.user.id,
            userName: this.user.user_metadata?.full_name || this.user.email
        });
        
        // Восстанавливаем состояние из localStorage
        CashierStore.restoreFromStorage();
    }
    
    /**
     * Загружает данные смены
     */
    async loadShiftData() {
        console.log('[CashierApp] Loading shift data...');
        
        try {
            const currentShift = await ShiftService.getCurrentShift(this.user.id);
            
            if (currentShift) {
                CashierStore.setCurrentShift(currentShift);
                
                // Загружаем статистику смены
                const stats = await ShiftService.getCurrentShiftStats(currentShift.id);
                CashierStore.setShiftStats(stats);
            }
        } catch (error) {
            console.error('[CashierApp] Shift load error:', error);
            // Не блокируем работу, если смена не загрузилась
        }
    }
    
    /**
     * Скрывает скелет загрузки
     */
    hideSkeleton() {
        if (this.skeleton) {
            this.skeleton.style.display = 'none';
        }
    }
    
    /**
     * Рендерит компоненты интерфейса
     */
    async renderComponents() {
        console.log('[CashierApp] Rendering components...');
        
        const hasOpenShift = CashierStore.hasOpenShift();
        
        if (!hasOpenShift) {
            this.renderShiftClosedState();
            return;
        }
        
        // Загружаем компоненты
        await this.loadComponents();
        
        // Монтируем компоненты
        await this.mountComponents();
    }
    
    /**
     * Рендерит состояние закрытой смены
     */
    renderShiftClosedState() {
        const overlay = document.getElementById('shift-closed-overlay');
        const skeleton = document.getElementById('cashier-skeleton');
        
        if (overlay) {
            overlay.classList.remove('hidden');
        }
        if (skeleton) {
            skeleton.style.display = 'none';
        }
        
        // Привязываем кнопку открытия смены
        const openBtn = document.getElementById('open-shift-overlay-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.handleOpenShift());
        }
    }
    
    /**
     * Загружает компоненты интерфейса
     */
    async loadComponents() {
        console.log('[CashierApp] Loading UI components...');
        
        const [
            shiftPanelModule,
            searchBarModule,
            categoryBarModule,
            productGridModule,
            cartPanelModule,
            paymentModalModule
        ] = await Promise.all([
            import(`./components/ShiftPanel.js?${CACHE_BUST}`),
            import(`./components/SearchBar.js?${CACHE_BUST}`),
            import(`./components/CategoryBar.js?${CACHE_BUST}`),
            import(`./components/ProductGrid.js?${CACHE_BUST}`),
            import(`./components/CartPanel.js?${CACHE_BUST}`),
            import(`./components/PaymentModal.js?${CACHE_BUST}`)
        ]);
        
        ShiftPanel = shiftPanelModule.ShiftPanel;
        SearchBar = searchBarModule.SearchBar;
        CategoryBar = categoryBarModule.CategoryBar;
        ProductGrid = productGridModule.ProductGrid;
        CartPanel = cartPanelModule.CartPanel;
        PaymentModal = paymentModalModule.PaymentModal;
    }
    
    /**
     * Монтирует компоненты в DOM
     */
    async mountComponents() {
        console.log('[CashierApp] Mounting components...');
        
        // 1. Панель смены (обновляем существующую)
        const shiftBar = document.querySelector('.shift-bar');
        if (shiftBar) {
            this.shiftPanel = new ShiftPanel(shiftBar, {
                onOpenShift: () => this.handleOpenShift(),
                onCloseShift: () => this.handleCloseShift()
            });
            await this.shiftPanel.mount();
        }
        
        // 2. Панель поиска
        const searchBar = document.querySelector('.search-bar');
        if (searchBar) {
            this.searchBar = new SearchBar(searchBar, {
                onSearch: (query) => this.handleSearch(query),
                onScan: (barcode) => this.handleScan(barcode)
            });
            await this.searchBar.mount();
        }
        
        // 3. Панель категорий
        const categoryBar = document.querySelector('.category-bar');
        if (categoryBar) {
            this.categoryBar = new CategoryBar(categoryBar, {
                onCategorySelect: (category) => this.handleCategorySelect(category)
            });
            await this.categoryBar.mount();
        }
        
        // 4. Сетка товаров
        const productsGrid = document.querySelector('.products-grid');
        if (productsGrid) {
            this.productGrid = new ProductGrid(productsGrid, {
                onAddToCart: (product) => this.handleAddToCart(product),
                onQuickView: (product) => this.handleQuickView(product)
            });
            await this.productGrid.mount();
        }
        
        // 5. Панель корзины
        const cartPanel = document.querySelector('.cart-panel');
        if (cartPanel) {
            this.cartPanel = new CartPanel(cartPanel, {
                onQuantityChange: (id, qty) => this.handleQuantityChange(id, qty),
                onRemove: (id) => this.handleRemoveFromCart(id),
                onDiscountChange: (id, discount) => this.handleItemDiscount(id, discount),
                onTotalDiscountChange: (discount) => this.handleTotalDiscount(discount),
                onPaymentMethodChange: (method) => this.handlePaymentMethod(method),
                onCheckout: () => this.handleCheckout(),
                onClear: () => this.handleClearCart()
            });
            await this.cartPanel.mount();
        }
        
        // 6. Модальное окно оплаты (создаем контейнер)
        const modalContainer = document.createElement('div');
        modalContainer.id = 'payment-modal-container';
        document.body.appendChild(modalContainer);
        
        this.paymentModal = new PaymentModal(modalContainer, {
            onConfirm: (paymentData) => this.handlePaymentConfirm(paymentData),
            onCancel: () => this.handlePaymentCancel()
        });
    }
    
    /**
     * Загружает данные в фоне
     */
    async loadBackgroundData() {
        console.log('[CashierApp] Loading background data...');
        
        try {
            // Загружаем товары
            const products = await ProductService.getInStock();
            CashierStore.setProducts(products);
            
            // Строим категории
            CashierStore.buildCategories();
            
            // Загружаем популярные товары
            const popularProducts = await SaleService.getTopProducts(8);
            const popularItems = popularProducts
                .map(tp => products.find(p => p.id === tp.id))
                .filter(Boolean);
            CashierStore.setPopularProducts(popularItems);
            
            // Загружаем недавние товары
            const recentProducts = [...products]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);
            CashierStore.setRecentProducts(recentProducts);
            
            // Обновляем UI
            this.productGrid?.refresh();
            this.categoryBar?.refresh();
            
        } catch (error) {
            console.error('[CashierApp] Background load error:', error);
            Notification.warning('Не удалось загрузить часть данных');
        }
    }
    
    /**
     * Инициализирует горячие клавиши
     */
    initKeyboard() {
        KeyboardManager.init({
            onSearch: () => this.searchBar?.focus(),
            onClearSearch: () => this.searchBar?.clear(),
            onCheckout: () => this.handleCheckout(),
            onClearCart: () => this.handleClearCart(),
            onAddQuantity: (id) => this.handleQuantityChange(id, 1, true),
            onRemoveQuantity: (id) => this.handleQuantityChange(id, -1, true)
        });
        
        console.log('[CashierApp] Keyboard initialized');
    }
    
    /**
     * Запускает автосохранение корзины
     */
    startAutoSave() {
        this.autoSaveTimer = setInterval(() => {
            if (CashierStore.hasOpenShift()) {
                CashierStore.saveToStorage();
            }
        }, AUTO_SAVE_INTERVAL);
    }
    
    /**
     * Запускает обновление статистики смены
     */
    startStatsUpdate() {
        this.statsTimer = setInterval(async () => {
            if (CashierStore.hasOpenShift()) {
                try {
                    const shiftId = CashierStore.getShiftId();
                    const stats = await ShiftService.getCurrentShiftStats(shiftId);
                    CashierStore.setShiftStats(stats);
                    this.shiftPanel?.refresh();
                } catch (error) {
                    console.error('[CashierApp] Stats update error:', error);
                }
            }
        }, STATS_UPDATE_INTERVAL);
    }
    
    /**
     * Подписывается на события
     */
    subscribeToEvents() {
        // Открытие смены
        this.unsubscribers.push(
            EventBus.on('shift:opened', (data) => {
                CashierStore.setCurrentShift(data.shift);
                Notification.success('Смена открыта');
                this.renderComponents();
            })
        );
        
        // Закрытие смены
        this.unsubscribers.push(
            EventBus.on('shift:closed', () => {
                CashierStore.clearShift();
                CashierStore.clearCart();
                Notification.info('Смена закрыта');
                this.renderShiftClosedState();
            })
        );
        
        // Продажа завершена
        this.unsubscribers.push(
            EventBus.on('sale:completed', async () => {
                await this.loadBackgroundData();
                this.shiftPanel?.refresh();
            })
        );
        
        // Товар создан/обновлен
        this.unsubscribers.push(
            EventBus.on('product:created', () => this.loadBackgroundData()),
            EventBus.on('product:updated', () => this.loadBackgroundData())
        );
    }
    
    // ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
    
    /**
     * Открытие смены
     */
    async handleOpenShift() {
        try {
            const shift = await ShiftService.openShift(this.user.id);
            CashierStore.setCurrentShift(shift);
            CashierStore.setShiftStats({
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            });
            
            EventBus.emit('shift:opened', { shift });
        } catch (error) {
            console.error('[CashierApp] Open shift error:', error);
            Notification.error('Ошибка при открытии смены');
        }
    }
    
    /**
     * Закрытие смены
     */
    async handleCloseShift() {
        const confirmed = await ConfirmDialog.show({
            title: 'Закрытие смены',
            message: 'Вы уверены, что хотите закрыть смену?',
            confirmText: 'Закрыть',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (!confirmed) return;
        
        try {
            const shiftId = CashierStore.getShiftId();
            await ShiftService.closeShift(shiftId);
            
            EventBus.emit('shift:closed', { shiftId });
        } catch (error) {
            console.error('[CashierApp] Close shift error:', error);
            Notification.error('Ошибка при закрытии смены');
        }
    }
    
    /**
     * Поиск товаров
     */
    handleSearch(query) {
        CashierStore.setSearchQuery(query);
        this.productGrid?.refresh();
    }
    
    /**
     * Сканирование штрихкода
     */
    async handleScan(barcode) {
        try {
            const product = await ProductService.getByBarcode(barcode);
            if (product) {
                this.handleAddToCart(product);
                Notification.success(`Добавлено: ${product.name}`);
            } else {
                Notification.warning('Товар не найден');
            }
        } catch (error) {
            console.error('[CashierApp] Scan error:', error);
            Notification.error('Ошибка при сканировании');
        }
    }
    
    /**
     * Выбор категории
     */
    handleCategorySelect(category) {
        CashierStore.setSelectedCategory(category);
        this.productGrid?.refresh();
    }
    
    /**
     * Добавление в корзину
     */
    handleAddToCart(product) {
        if (!CashierStore.hasOpenShift()) {
            Notification.warning('Сначала откройте смену');
            return;
        }
        
        if (product.status !== 'in_stock') {
            Notification.warning('Товар недоступен');
            return;
        }
        
        const added = CartService.addToCart(product);
        
        if (added) {
            this.cartPanel?.refresh();
            this.productGrid?.highlightProduct(product.id);
        }
    }
    
    /**
     * Быстрый просмотр товара
     */
    handleQuickView(product) {
        Notification.info(`${product.name} — ${this.formatMoney(product.price)}`);
    }
    
    /**
     * Изменение количества
     */
    handleQuantityChange(id, quantity, relative = false) {
        CartService.updateQuantity(id, quantity, relative);
        this.cartPanel?.refresh();
    }
    
    /**
     * Удаление из корзины
     */
    handleRemoveFromCart(id) {
        CartService.removeFromCart(id);
        this.cartPanel?.refresh();
    }
    
    /**
     * Скидка на товар
     */
    handleItemDiscount(id, discount) {
        CartService.setItemDiscount(id, discount);
        this.cartPanel?.refresh();
    }
    
    /**
     * Скидка на чек
     */
    handleTotalDiscount(discount) {
        CartService.setTotalDiscount(discount);
        this.cartPanel?.refresh();
    }
    
    /**
     * Выбор способа оплаты
     */
    handlePaymentMethod(method) {
        CartService.setPaymentMethod(method);
    }
    
    /**
     * Оформление продажи
     */
    async handleCheckout() {
        if (!CashierStore.hasOpenShift()) {
            Notification.warning('Смена закрыта');
            return;
        }
        
        const cartItems = CartService.getItems();
        
        if (cartItems.length === 0) {
            Notification.warning('Корзина пуста');
            return;
        }
        
        // Показываем модальное окно оплаты
        const total = CartService.getTotal();
        await this.paymentModal.show({ total });
    }
    
    /**
     * Подтверждение оплаты
     */
    async handlePaymentConfirm(paymentData) {
        try {
            const shiftId = CashierStore.getShiftId();
            const items = CartService.getItems();
            const total = CartService.getTotal();
            const discount = CartService.getTotalDiscount();
            
            // Создаем продажу (работает офлайн)
            const sale = await CheckoutService.createSale({
                shiftId,
                items,
                total,
                discount,
                paymentMethod: paymentData.method,
                receivedAmount: paymentData.received,
                change: paymentData.change
            });
            
            // Очищаем корзину
            CartService.clearCart();
            this.cartPanel?.refresh();
            
            // Обновляем данные
            await this.loadBackgroundData();
            
            // Показываем чек
            this.showReceipt(sale);
            
            Notification.success(`Продажа на ${this.formatMoney(total)}`);
            
            EventBus.emit('sale:completed', { sale });
            
        } catch (error) {
            console.error('[CashierApp] Checkout error:', error);
            Notification.error('Ошибка при создании продажи');
        }
    }
    
    /**
     * Отмена оплаты
     */
    handlePaymentCancel() {
        // Ничего не делаем, модальное окно закрывается само
    }
    
    /**
     * Очистка корзины
     */
    async handleClearCart() {
        if (CartService.getItems().length === 0) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Очистка корзины',
            message: 'Все товары будут удалены из корзины. Продолжить?',
            confirmText: 'Очистить',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (confirmed) {
            CartService.clearCart();
            this.cartPanel?.refresh();
            Notification.info('Корзина очищена');
        }
    }
    
    /**
     * Показывает чек
     */
    showReceipt(sale) {
        // TODO: Реализовать печать чека
        console.log('[CashierApp] Receipt:', sale);
    }
    
    // ========== УТИЛИТЫ ==========
    
    /**
     * Форматирует деньги
     */
    formatMoney(amount) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0
        }).format(amount);
    }
    
    /**
     * Показывает ошибку
     */
    showError(message) {
        if (this.root) {
            this.root.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 20px; text-align: center; font-family: system-ui, sans-serif;">
                    <div style="font-size: 64px; margin-bottom: 24px;">⚠️</div>
                    <h2 style="margin-bottom: 12px; color: #0f172a;">Ошибка загрузки</h2>
                    <p style="color: #64748b; margin-bottom: 24px;">${message}</p>
                    <button onclick="location.reload()" style="padding: 12px 32px; background: #0f172a; color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;">
                        Обновить
                    </button>
                </div>
            `;
        }
    }
    
    /**
     * Перенаправляет на страницу входа
     */
    redirectToLogin() {
        window.location.href = '/pages/login/login.html';
    }
    
    // ========== ОЧИСТКА ==========
    
    /**
     * Уничтожает приложение
     */
    destroy() {
        console.log('[CashierApp] Destroying...');
        
        // Очищаем таймеры
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
        }
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        // Отписываемся от событий
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        
        // Сохраняем состояние
        CashierStore?.saveToStorage();
        
        // Уничтожаем компоненты
        this.shiftPanel?.destroy();
        this.searchBar?.destroy();
        this.categoryBar?.destroy();
        this.productGrid?.destroy();
        this.cartPanel?.destroy();
        this.paymentModal?.destroy();
        
        // Удаляем KeyboardManager
        KeyboardManager?.destroy();
    }
}

// ========== ЗАПУСК ==========
document.addEventListener('DOMContentLoaded', async () => {
    const app = new CashierApp();
    await app.init();
    
    // Сохраняем экземпляр для отладки
    window.__cashierApp = app;
});

export { CashierApp };
