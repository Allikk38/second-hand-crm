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
 * - Единый координатор бизнес-логики кассы.
 * - Слушает события от dumb-компонентов через EventBus.
 * - Управляет глобальным состоянием через Store.
 * - Интегрирован с логгером для полного трейсинга операций.
 * - Поддерживает офлайн-режим с автоматической синхронизацией.
 * 
 * @module CashierApp
 * @version 7.1.0
 * @changes
 * - Добавлен метод syncShiftState() для принудительной синхронизации с БД.
 * - Исправлена проблема: UI показывал "Смена закрыта" при наличии открытой смены в БД.
 * - Улучшена обработка ошибок при загрузке состояния смены.
 * - Добавлена кнопка "Обновить" при ошибке загрузки смены.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { EventBus } from '../../core/EventBus.js';
import { ShiftService } from '../../services/ShiftService.js';
import { ProductService } from '../../services/ProductService.js';
import { SaleService } from '../../services/SaleService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { createLogger } from '../../utils/logger.js';
import { formatMoney } from '../../utils/formatters.js';

// ========== LOGGER ==========
const logger = createLogger('CashierApp');

// ========== КОНСТАНТЫ ==========
const AUTO_SYNC_ATTEMPTS = 3;
const AUTO_SYNC_DELAY = 2000;

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
        this.eventUnsubscribers = [];
        this.syncAttempts = 0;
        this.syncTimer = null;
        this.isInitialized = false;
        
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
            cartItemsCount,
            cartTotal,
            isLoadingShift
        });

        return `
            <div class="cashier-layout ${!hasOpenShift ? 'shift-closed-mode' : ''}">
                ${hasOpenShift ? this.renderMainLayout(cartTotal, cartItemsCount, isLocalShift) : this.renderShiftClosed(isLoadingShift)}
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
                        <span>📡 Работа в офлайн-режиме. Данные будут синхронизированы при подключении к сети.</span>
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

    renderShiftClosed(isLoadingShift = false) {
        const isShiftActionPending = Store.state.cashier.isShiftActionPending || false;
        
        if (isLoadingShift) {
            return `
                <div class="shift-closed-overlay">
                    <div class="loading-spinner"></div>
                    <h2>Проверка состояния смены...</h2>
                    <p>Синхронизация с сервером</p>
                </div>
            `;
        }
        
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
                    title="Проверить состояние смены на сервере"
                >
                    🔄 Проверить смену
                </button>
            </div>
        `;
    }

    // ========== МОНТИРОВАНИЕ КОМПОНЕНТОВ ==========
    
    async afterRender() {
        logger.debug('afterRender started');
        
        await this.loadComponents();
        
        // Подписываемся на события смены
        this.subscribeToShiftEvents();
        
        // Подписываемся на изменения Store
        this.subscribeToStore();
        
        // Синхронизируем состояние смены с БД
        await this.syncShiftState();
        
        this.isInitialized = true;
    }

    /**
     * Синхронизирует состояние смены с сервером
     * Принудительно проверяет наличие открытой смены в БД
     */
    async syncShiftState() {
        logger.group('syncShiftState', async () => {
            logger.debug('Starting shift state synchronization');
            
            // Устанавливаем флаг загрузки
            Store.state.cashier.isLoadingShift = true;
            await this.update();
            
            try {
                // Принудительно запрашиваем смену с сервера (игнорируем кэш)
                logger.debug('Fetching current shift from server (force refresh)');
                const serverShift = await ShiftService.getCurrentShift(this.user.id, true);
                
                const currentStoreShift = Store.state.cashier.currentShift;
                
                logger.debug('Shift state comparison', {
                    serverShift: serverShift ? { id: serverShift.id, isLocal: serverShift.is_local } : null,
                    storeShift: currentStoreShift ? { id: currentStoreShift.id, isLocal: currentStoreShift.is_local } : null
                });
                
                if (serverShift) {
                    // На сервере есть открытая смена
                    logger.info('Found open shift on server', { shiftId: serverShift.id });
                    
                    if (!currentStoreShift || currentStoreShift.id !== serverShift.id) {
                        // Обновляем Store
                        Store.state.cashier.currentShift = serverShift;
                        
                        // Загружаем статистику смены
                        try {
                            const stats = await ShiftService.getCurrentShiftStats(serverShift.id);
                            Store.state.cashier.shiftStats = {
                                revenue: stats.totalRevenue || 0,
                                salesCount: stats.salesCount || 0,
                                averageCheck: stats.averageCheck || 0,
                                profit: stats.totalProfit || 0
                            };
                            logger.debug('Shift stats loaded', Store.state.cashier.shiftStats);
                        } catch (statsError) {
                            logger.warn('Failed to load shift stats', { error: statsError.message });
                        }
                        
                        // Монтируем компоненты смены
                        await this.mountShiftComponents();
                        await this.loadData();
                        
                        Notification.info('Найдена открытая смена');
                    } else {
                        logger.debug('Store already has correct shift');
                    }
                } else {
                    // На сервере нет открытой смены
                    logger.info('No open shift on server');
                    
                    if (currentStoreShift?.is_local) {
                        // У нас есть локальная смена, оставляем её
                        logger.debug('Keeping local shift');
                    } else if (currentStoreShift) {
                        // В Store есть смена, но на сервере её нет - очищаем
                        logger.warn('Store has shift but server does not, clearing');
                        Store.state.cashier.currentShift = null;
                        Store.state.cashier.shiftStats = {
                            revenue: 0,
                            salesCount: 0,
                            averageCheck: 0,
                            profit: 0
                        };
                    }
                }
                
            } catch (error) {
                logger.error('Failed to sync shift state', { error: error.message });
                
                // При ошибке сети сохраняем текущее состояние
                if (error.code === 'SHIFT_OFFLINE' || error.message?.includes('fetch')) {
                    logger.warn('Network error during sync, keeping current state');
                    Notification.warning('Нет подключения к серверу. Работа в офлайн-режиме.');
                } else {
                    Notification.error('Ошибка при проверке состояния смены');
                }
                
            } finally {
                // Сбрасываем флаг загрузки
                Store.state.cashier.isLoadingShift = false;
                
                // Перерисовываем UI
                await this.update();
                
                // Если смена открыта, монтируем компоненты (если ещё не смонтированы)
                if (Store.state.cashier.currentShift && !this.shiftPanel) {
                    await this.mountShiftComponents();
                    await this.loadData();
                }
                
                logger.debug('Shift state synchronization completed');
            }
        });
    }

    async loadComponents() {
        logger.debug('Loading UI components');
        
        if (!ShiftPanel) {
            const modules = await Promise.all([
                import('./ShiftPanel.js'),
                import('./CategoryNav.js'),
                import('./ProductGrid.js'),
                import('./Cart.js'),
                import('./PaymentModal.js')
            ]);
            ShiftPanel = modules[0].ShiftPanel;
            CategoryNav = modules[1].CategoryNav;
            ProductGrid = modules[2].ProductGrid;
            Cart = modules[3].Cart;
            PaymentModal = modules[4].PaymentModal;
            logger.debug('UI components loaded');
        }
    }

    async mountShiftComponents() {
        logger.debug('Mounting shift components');
        
        // 1. Shift Panel
        const shiftContainer = this.refs.get('shiftPanelContainer');
        if (shiftContainer && !this.shiftPanel) {
            this.shiftPanel = new ShiftPanel(shiftContainer);
            await this.shiftPanel.mount();
            logger.debug('ShiftPanel mounted');
        }

        // 2. Category Nav
        const navContainer = this.refs.get('categoryNavContainer');
        if (navContainer && !this.categoryNav) {
            this.categoryNav = new CategoryNav(navContainer, {
                onCategorySelect: (cat) => this.handleCategorySelect(cat),
                onSearch: (query) => this.handleSearch(query),
                onScan: (product) => this.handleAddToCart(product)
            });
            await this.categoryNav.mount();
            logger.debug('CategoryNav mounted');
        }

        // 3. Product Grid
        const gridContainer = this.refs.get('productGridContainer');
        if (gridContainer && !this.productGrid) {
            this.productGrid = new ProductGrid(gridContainer, {
                onAddToCart: (product) => this.handleAddToCart(product)
            });
            await this.productGrid.mount();
            logger.debug('ProductGrid mounted');
        }

        // 4. Cart
        const cartContainer = this.refs.get('cartContainer');
        if (cartContainer && !this.cart) {
            this.cart = new Cart(cartContainer);
            await this.cart.mount();
            logger.debug('Cart mounted');
        }

        // Кнопки в футере
        this.addDomListener('checkoutBtn', 'click', () => this.handleCheckout());
        this.addDomListener('clearCartBtn', 'click', () => this.handleClearCart());
        
        // Кнопка проверки смены (на экране закрытой смены)
        this.addDomListener('refreshShiftStateBtn', 'click', () => this.syncShiftState());
    }

    // ========== ПОДПИСКИ НА СОБЫТИЯ ==========
    
    /**
     * Подписывается на события смены от ShiftPanel
     */
    subscribeToShiftEvents() {
        logger.debug('Subscribing to shift events');
        
        // Запрос на открытие смены
        const unsubOpen = EventBus.on('shift:open-requested', () => {
            logger.info('Received shift:open-requested event');
            this.handleOpenShiftRequest();
        });
        this.eventUnsubscribers.push(unsubOpen);
        
        // Запрос на закрытие смены
        const unsubClose = EventBus.on('shift:close-requested', (data) => {
            logger.info('Received shift:close-requested event', data);
            this.handleCloseShiftRequest(data);
        });
        this.eventUnsubscribers.push(unsubClose);
        
        // Событие успешной синхронизации
        const unsubSynced = EventBus.on('shift:synced', (data) => {
            logger.info('Received shift:synced event', data);
            this.handleShiftSynced(data);
        });
        this.eventUnsubscribers.push(unsubSynced);
    }
    
    /**
     * Подписывается на изменения Store
     */
    subscribeToStore() {
        logger.debug('Subscribing to Store changes');
        
        this.unsubscribers.push(
            Store.subscribe('cashier.filteredProducts', () => {
                logger.debug('Store: filteredProducts changed');
                this.productGrid?.update();
            }),
            
            Store.subscribe('cashier.cartItems', () => {
                logger.debug('Store: cartItems changed');
                this.updateCartUI();
            }),
            
            Store.subscribe('cashier.cartTotalDiscount', () => {
                logger.debug('Store: cartTotalDiscount changed');
                this.updateCartUI();
            }),
            
            Store.subscribe('cashier.isShiftActionPending', (change) => {
                logger.debug('Store: isShiftActionPending changed', { 
                    oldValue: change.oldValue, 
                    newValue: change.newValue 
                });
                this.update();
            }),
            
            Store.subscribe('cashier.isLoadingShift', (change) => {
                logger.debug('Store: isLoadingShift changed', { 
                    oldValue: change.oldValue, 
                    newValue: change.newValue 
                });
                this.update();
            })
        );
    }

    // ========== ОБРАБОТЧИКИ СМЕНЫ ==========
    
    /**
     * Обработчик запроса на открытие смены
     */
    async handleOpenShiftRequest() {
        logger.group('handleOpenShiftRequest', () => {
            logger.debug('Starting shift open process');
        });
        
        // Проверяем, не открыта ли уже смена
        if (Store.state.cashier.currentShift) {
            logger.warn('Shift already open, ignoring request', { 
                shiftId: Store.state.cashier.currentShift.id 
            });
            Notification.warning('Смена уже открыта');
            return;
        }
        
        // Проверяем, не выполняется ли уже операция
        if (Store.state.cashier.isShiftActionPending) {
            logger.warn('Shift action already pending, ignoring request');
            return;
        }
        
        // Устанавливаем флаг загрузки
        Store.state.cashier.isShiftActionPending = true;
        
        try {
            logger.info('Calling ShiftService.openShift', { userId: this.user.id });
            
            // Пытаемся открыть смену
            const shift = await ShiftService.openShift(this.user.id, {
                initialCash: 0,
                allowLocal: true // Разрешаем офлайн
            });
            
            logger.info('Shift opened successfully', { 
                shiftId: shift.id, 
                isLocal: shift.is_local || false 
            });
            
            // Сохраняем смену в Store
            Store.state.cashier.currentShift = shift;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            
            // Показываем уведомление
            if (shift.is_local) {
                Notification.warning('Смена открыта в офлайн-режиме. Данные будут синхронизированы при подключении к сети.');
            } else {
                Notification.success('Смена успешно открыта');
            }
            
            // Перерисовываем UI и монтируем компоненты
            await this.update();
            await this.mountShiftComponents();
            await this.loadData();
            
            EventBus.emit('shift:opened', { shift });
            
        } catch (error) {
            logger.error('Failed to open shift', { error: error.message, code: error.code });
            
            let errorMessage = 'Ошибка при открытии смены';
            
            if (error.code === 'SHIFT_ALREADY_OPEN') {
                errorMessage = 'У вас уже есть открытая смена. Обновите страницу.';
                // Пробуем синхронизировать состояние
                await this.syncShiftState();
            } else if (error.code === 'PROFILE_NOT_FOUND') {
                errorMessage = 'Профиль пользователя не найден. Обратитесь к администратору.';
            } else if (error.code === 'SHIFT_TIMEOUT') {
                errorMessage = 'Превышено время ожидания ответа от сервера';
            } else if (error.code === 'SHIFT_OFFLINE') {
                errorMessage = 'Нет подключения к серверу';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            Notification.error(errorMessage);
            
        } finally {
            // Сбрасываем флаг загрузки
            Store.state.cashier.isShiftActionPending = false;
            logger.debug('Shift action completed, pending flag cleared');
        }
    }
    
    /**
     * Обработчик запроса на закрытие смены
     */
    async handleCloseShiftRequest(data) {
        const { shiftId, isLocal, currentStats } = data;
        
        logger.group('handleCloseShiftRequest', () => {
            logger.debug('Starting shift close process', { shiftId, isLocal, currentStats });
        });
        
        // Проверяем, не выполняется ли уже операция
        if (Store.state.cashier.isShiftActionPending) {
            logger.warn('Shift action already pending, ignoring request');
            return;
        }
        
        // Подтверждение
        const confirmMessage = isLocal 
            ? 'Вы работаете в офлайн-режиме. Смена будет закрыта локально. Продолжить?'
            : `Закрыть смену? Выручка: ${formatMoney(currentStats.revenue)}, продаж: ${currentStats.salesCount}`;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Закрытие смены',
            message: confirmMessage,
            confirmText: 'Закрыть смену',
            cancelText: 'Отмена',
            type: 'warning'
        });
        
        if (!confirmed) {
            logger.debug('Shift close cancelled by user');
            return;
        }
        
        // Устанавливаем флаг загрузки
        Store.state.cashier.isShiftActionPending = true;
        
        try {
            logger.info('Calling ShiftService.closeShift', { shiftId });
            
            const result = await ShiftService.closeShift(shiftId);
            
            logger.info('Shift closed successfully', { 
                shiftId, 
                revenue: result.total_revenue,
                isLocal: result.is_local || false
            });
            
            // Очищаем состояние
            Store.state.cashier.currentShift = null;
            Store.state.cashier.shiftStats = {
                revenue: 0,
                salesCount: 0,
                averageCheck: 0,
                profit: 0
            };
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            // Уведомление
            if (result.is_local) {
                Notification.warning(`Смена закрыта локально. Выручка: ${formatMoney(result.total_revenue || 0)}`);
            } else {
                Notification.success(`Смена закрыта. Выручка: ${formatMoney(result.total_revenue || 0)}`);
            }
            
            // Перерисовываем UI
            await this.update();
            
            EventBus.emit('shift:closed', { shift: result });
            
        } catch (error) {
            logger.error('Failed to close shift', { shiftId, error: error.message });
            
            let errorMessage = 'Ошибка при закрытии смены';
            if (error.message) {
                errorMessage = error.message;
            }
            
            Notification.error(errorMessage);
            
        } finally {
            // Сбрасываем флаг загрузки
            Store.state.cashier.isShiftActionPending = false;
            logger.debug('Shift action completed, pending flag cleared');
        }
    }
    
    /**
     * Обработчик успешной синхронизации смены
     */
    handleShiftSynced(data) {
        logger.info('Shift synced with server', data);
        
        const { localId, serverId } = data;
        
        // Обновляем смену в Store
        const currentShift = Store.state.cashier.currentShift;
        if (currentShift && currentShift.id === localId) {
            Store.state.cashier.currentShift = {
                ...currentShift,
                ...data.shift,
                is_local: false,
                synced_at: new Date().toISOString()
            };
            
            Notification.success('Смена синхронизирована с сервером');
            this.update();
        }
        
        // Обновляем статистику
        this.updateShiftStats();
    }
    
    /**
     * Пытается синхронизировать локальную смену
     */
    async attemptSyncLocalShift() {
        const currentShift = Store.state.cashier.currentShift;
        
        if (!currentShift?.is_local) {
            logger.debug('No local shift to sync');
            return;
        }
        
        logger.info('Attempting to sync local shift', { 
            shiftId: currentShift.id, 
            attempt: this.syncAttempts + 1 
        });
        
        try {
            EventBus.emit('shift:sync:started', { shiftId: currentShift.id });
            
            // Пытаемся синхронизировать
            const syncedShifts = await ShiftService.syncLocalShifts();
            
            if (syncedShifts > 0) {
                logger.info('Local shift synced successfully');
                this.syncAttempts = 0;
                
                // Обновляем смену в Store
                const serverShift = await ShiftService.getCurrentShift(this.user.id, true);
                if (serverShift) {
                    Store.state.cashier.currentShift = serverShift;
                    Notification.success('Смена синхронизирована с сервером');
                    await this.update();
                }
                
                EventBus.emit('shift:sync:completed', { syncedCount: syncedShifts });
            } else {
                // Пробуем ещё раз
                this.scheduleRetrySync();
            }
            
        } catch (error) {
            logger.error('Failed to sync local shift', { error: error.message });
            EventBus.emit('shift:sync:failed', { error });
            
            this.scheduleRetrySync();
        }
    }
    
    /**
     * Планирует повторную попытку синхронизации
     */
    scheduleRetrySync() {
        this.syncAttempts++;
        
        if (this.syncAttempts < AUTO_SYNC_ATTEMPTS) {
            logger.debug('Scheduling retry sync', { 
                attempt: this.syncAttempts, 
                maxAttempts: AUTO_SYNC_ATTEMPTS,
                delay: AUTO_SYNC_DELAY
            });
            
            this.syncTimer = setTimeout(() => {
                this.attemptSyncLocalShift();
            }, AUTO_SYNC_DELAY * this.syncAttempts);
        } else {
            logger.warn('Max sync attempts reached, giving up');
            Notification.warning('Не удалось синхронизировать смену. Попробуйте позже.');
        }
    }

    // ========== ДАННЫЕ ==========
    
    async loadData() {
        logger.debug('Loading cashier data');
        
        if (!Store.state.cashier.currentShift) {
            logger.debug('No shift open, skipping data load');
            return;
        }
        
        try {
            const products = await ProductService.getInStock();
            Store.state.cashier.products = products;
            
            const categories = this.buildCategories(products);
            Store.state.cashier.categories = categories;
            
            // Применяем фильтры
            this.applyFilters();
            
            // Статистика смены
            await this.updateShiftStats();
            
            logger.info('Cashier data loaded', { 
                productsCount: products.length,
                categoriesCount: categories.length
            });
            
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
        
        logger.debug('Filters applied', { 
            total: cashier.products.length,
            filtered: filtered.length,
            searchQuery: cashier.searchQuery,
            category: cashier.selectedCategory
        });
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
            
            logger.debug('Shift stats updated', Store.state.cashier.shiftStats);
            
        } catch (error) {
            logger.error('Stats update error', { shiftId, error: error.message });
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

    // ========== ОБРАБОТЧИКИ UI ==========
    
    handleCategorySelect(category) {
        logger.debug('Category selected', { category });
        Store.state.cashier.selectedCategory = category === 'all' ? null : category;
        this.applyFilters();
    }

    handleSearch(query) {
        logger.debug('Search query changed', { query });
        Store.state.cashier.searchQuery = query;
        this.applyFilters();
    }

    handleAddToCart(product) {
        if (product.status !== 'in_stock') {
            logger.warn('Attempted to add unavailable product', { productId: product.id });
            Notification.warning('Товар недоступен');
            return;
        }
        
        logger.debug('Adding to cart', { productId: product.id, name: product.name });
        
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
        
        logger.debug('Clear cart requested');
        
        const confirmed = await ConfirmDialog.show({
            title: 'Очистка корзины',
            message: 'Удалить все товары из корзины?',
            type: 'warning'
        });
        
        if (confirmed) {
            logger.info('Cart cleared');
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            Notification.info('Корзина очищена');
        }
    }

    async handleCheckout() {
        const items = Store.state.cashier.cartItems;
        if (items.length === 0) return;
        
        logger.debug('Checkout requested', { itemsCount: items.length });
        
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
        logger.group('processCheckout', () => {
            logger.debug('Processing checkout', { paymentMethod, receivedAmount });
        });
        
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
            
            logger.debug('Creating sale', { shiftId, itemsCount: items.length, total, discount });
            
            const sale = await SaleService.create({
                shiftId,
                items,
                total,
                discount,
                paymentMethod
            });
            
            logger.info('Sale created successfully', { saleId: sale.id });
            
            // Очищаем корзину
            Store.state.cashier.cartItems = [];
            Store.state.cashier.cartTotalDiscount = 0;
            
            // Обновляем статистику и товары
            await this.updateShiftStats();
            await this.loadData();
            
            Notification.success(`Продажа на ${formatMoney(total)}`);
            this.paymentModal?.destroy();
            
            EventBus.emit('sale:completed', { sale });
            
        } catch (error) {
            logger.error('Checkout error', { error: error.message });
            Notification.error('Ошибка при создании продажи: ' + (error.message || 'Неизвестная ошибка'));
        }
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        logger.debug('Destroying CashierApp');
        
        // Очищаем таймеры
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        
        // Отписываемся от Store
        this.unsubscribers.forEach(unsub => {
            try {
                unsub();
            } catch (error) {
                logger.warn('Error during Store unsubscribe', { error });
            }
        });
        this.unsubscribers = [];
        
        // Отписываемся от EventBus
        this.eventUnsubscribers.forEach(unsub => {
            try {
                unsub();
            } catch (error) {
                logger.warn('Error during EventBus unsubscribe', { error });
            }
        });
        this.eventUnsubscribers = [];
        
        // Уничтожаем дочерние компоненты
        this.shiftPanel?.destroy();
        this.categoryNav?.destroy();
        this.productGrid?.destroy();
        this.cart?.destroy();
        this.paymentModal?.destroy();
        
        logger.info('CashierApp destroyed');
    }
}

export default CashierApp;
