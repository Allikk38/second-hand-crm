/**
 * Cashier Page Component
 * 
 * Страница кассового модуля для проведения продаж.
 * 
 * Архитектурные решения:
 * - Виртуальный скролл для оптимальной работы с большим количеством товаров
 * - Группировка товаров по категориям с аккордеоном
 * - Лента быстрых товаров (часто продаваемые)
 * - Карточка быстрого просмотра товара
 * - Панель статистики смены в реальном времени
 * - Сохранение UI-состояния в sessionStorage
 * - Горячие клавиши для ускорения работы кассира
 * - Прямая интеграция с Cart компонентом
 * 
 * @module CashierPage
 * @extends BaseComponent
 * @requires ProductService
 * @requires ShiftService
 * @requires SaleService
 * @requires AuthManager
 * @requires Cart
 * @requires ShiftOpener
 * @requires Notification
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { ShiftService } from '../../services/ShiftService.js';
import { SaleService } from '../../services/SaleService.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Cart } from './Cart.js';
import { ShiftOpener } from './ShiftOpener.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { formatMoney, formatNumber, formatPercent } from '../../utils/formatters.js';
import { 
    CATEGORY_SCHEMA, 
    getCategoryName, 
    getCategoryOptions,
    formatAttributes 
} from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY = 'cashier_ui_state';
const STATS_UPDATE_INTERVAL = 30000; // 30 секунд
const QUICK_ITEMS_COUNT = 8;
const VIRTUAL_SCROLL_ITEM_HEIGHT = 80;
const VIRTUAL_SCROLL_BUFFER = 5;

/**
 * Горячие клавиши
 */
const HOTKEYS = {
    SEARCH: '/',
    CHECKOUT: 'Enter',
    CATEGORIES: ['F1', 'F2', 'F3', 'F4'],
    CLEAR_SEARCH: 'Escape'
};

export class CashierPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Сервисы и компоненты
        this.cart = null;
        this.shiftOpener = null;
        this.currentShift = null;
        this.user = AuthManager.getUser();
        
        // Данные товаров
        this.products = [];
        this.filteredProducts = [];
        this.categories = [];
        this.popularProducts = [];
        this.recentlyAdded = [];
        
        // Состояние UI
        this._state = {
            searchQuery: '',
            selectedCategory: null,
            expandedCategories: new Set(),
            isSearching: false,
            viewMode: 'grid', // grid, list
            showSoldItems: false
        };
        
        // Виртуальный скролл
        this.virtualScroller = null;
        this.productsContainer = null;
        this.visibleRange = { start: 0, end: 0 };
        
        // Таймеры
        this.statsUpdateTimer = null;
        this.searchDebounceTimer = null;
        this.statsUpdateTimer = null;
        
        // Кэш статистики
        this.shiftStats = {
            revenue: 0,
            salesCount: 0,
            averageCheck: 0,
            profit: 0
        };
        
        // Состояние загрузки
        this.isLoading = false;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        // Восстанавливаем состояние UI
        this.restoreUIState();
        
        // Загружаем данные
        await this.loadInitialData();
        
        const hasOpenShift = this.currentShift !== null;
        const inStockCount = this.filteredProducts.length;
        const groupedProducts = this.groupProductsByCategory(this.filteredProducts);
        
        return `
            <div class="cashier-page ${!hasOpenShift ? 'shift-closed' : ''}">
                <!-- Шапка со сменой -->
                <div class="cashier-header">
                    <div data-ref="shiftContainer"></div>
                </div>
                
                ${hasOpenShift ? this.renderMainLayout(groupedProducts, inStockCount) : this.renderShiftClosedMessage()}
            </div>
        `;
    }

    /**
     * Рендерит основной макет кассы
     */
    renderMainLayout(groupedProducts, inStockCount) {
        return `
            <div class="cashier-layout">
                <!-- Левая панель - Товары -->
                <div class="products-panel">
                    <!-- Панель статистики смены -->
                    <div class="shift-stats-panel" data-ref="shiftStatsPanel">
                        ${this.renderShiftStats()}
                    </div>
                    
                    <!-- Поиск и фильтры -->
                    <div class="products-toolbar">
                        <div class="search-wrapper">
                            <input 
                                type="text" 
                                data-ref="searchInput"
                                placeholder="Поиск по названию, ID или ключевым словам... (нажмите /)"
                                value="${this.escapeHtml(this._state.searchQuery)}"
                                autocomplete="off"
                            >
                            ${this._state.searchQuery ? `
                                <button class="btn-icon btn-clear" data-ref="clearSearchBtn" title="Очистить (Esc)">
                                    ✕
                                </button>
                            ` : ''}
                            ${this._state.isSearching ? `
                                <span class="search-loader">
                                    <span class="loading-spinner small"></span>
                                </span>
                            ` : ''}
                        </div>
                        
                        <div class="view-controls">
                            <button 
                                class="btn-icon ${this._state.viewMode === 'grid' ? 'active' : ''}" 
                                data-ref="gridViewBtn"
                                title="Сетка"
                            >
                                ▦
                            </button>
                            <button 
                                class="btn-icon ${this._state.viewMode === 'list' ? 'active' : ''}" 
                                data-ref="listViewBtn"
                                title="Список"
                            >
                                ☰
                            </button>
                        </div>
                    </div>
                    
                    <!-- Лента быстрых товаров -->
                    ${this.popularProducts.length > 0 ? `
                        <div class="quick-items-section">
                            <h4>🔥 Часто продаваемые</h4>
                            <div class="quick-items-scroll" data-ref="quickItemsScroll">
                                ${this.popularProducts.slice(0, QUICK_ITEMS_COUNT).map(p => this.renderQuickItem(p)).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${this.recentlyAdded.length > 0 ? `
                        <div class="quick-items-section">
                            <h4>🆕 Недавние</h4>
                            <div class="quick-items-scroll" data-ref="recentItemsScroll">
                                ${this.recentlyAdded.map(p => this.renderQuickItem(p)).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <!-- Категории и товары -->
                    <div class="categories-header">
                        <h3>
                            Товары в наличии 
                            <span class="count-badge">${inStockCount}</span>
                        </h3>
                        <div class="category-tabs">
                            <button 
                                class="category-tab ${!this._state.selectedCategory ? 'active' : ''}"
                                data-category="all"
                            >
                                Все
                            </button>
                            ${this.categories.slice(0, 4).map(cat => `
                                <button 
                                    class="category-tab ${this._state.selectedCategory === cat.value ? 'active' : ''}"
                                    data-category="${cat.value}"
                                    title="${cat.label} (F${this.categories.indexOf(cat) + 1})"
                                >
                                    ${cat.label} (${cat.count})
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- Список товаров с группировкой -->
                    <div class="products-container" data-ref="productsContainer">
                        ${Object.entries(groupedProducts).map(([category, products]) => this.renderCategoryGroup(category, products)).join('')}
                        
                        ${this.filteredProducts.length === 0 ? `
                            <div class="empty-state">
                                <div class="empty-state-icon">🔍</div>
                                <p>${this.getEmptyStateMessage()}</p>
                                ${this._state.searchQuery ? `
                                    <button class="btn-secondary" data-ref="clearSearchEmptyBtn">
                                        Сбросить поиск
                                    </button>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                    
                    <!-- Индикатор загрузки -->
                    ${this.isLoading ? `
                        <div class="products-loader">
                            <span class="loading-spinner"></span>
                            <span>Загрузка товаров...</span>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Правая панель - Корзина -->
                <div class="cart-panel">
                    <div data-ref="cartContainer"></div>
                </div>
            </div>
            
            <!-- Модалка быстрого просмотра -->
            <div data-ref="quickViewModal" class="quick-view-modal hidden"></div>
        `;
    }

    /**
     * Рендерит сообщение о закрытой смене
     */
    renderShiftClosedMessage() {
        return `
            <div class="shift-closed-message">
                <div class="message-icon">🔒</div>
                <h2>Смена закрыта</h2>
                <p>Для работы с кассой необходимо открыть смену</p>
            </div>
        `;
    }

    /**
     * Рендерит статистику смены
     */
    renderShiftStats() {
        return `
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Выручка</span>
                    <span class="stat-value">${formatMoney(this.shiftStats.revenue)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Продаж</span>
                    <span class="stat-value">${formatNumber(this.shiftStats.salesCount)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Средний чек</span>
                    <span class="stat-value">${formatMoney(this.shiftStats.averageCheck)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Прибыль</span>
                    <span class="stat-value ${this.shiftStats.profit >= 0 ? 'text-success' : 'text-danger'}">
                        ${formatMoney(this.shiftStats.profit)}
                    </span>
                </div>
            </div>
            ${this.currentShift ? `
                <div class="shift-time">
                    <span>Смена открыта: ${new Date(this.currentShift.opened_at).toLocaleTimeString()}</span>
                </div>
            ` : ''}
        `;
    }

    /**
     * Рендерит группу товаров по категории
     */
    renderCategoryGroup(category, products) {
        const categoryName = getCategoryName(category);
        const isExpanded = this._state.expandedCategories.has(category) || this._state.searchQuery;
        const categoryId = `category-${category}`;
        
        return `
            <div class="category-group ${isExpanded ? 'expanded' : 'collapsed'}" data-category="${category}">
                <div class="category-header" data-ref="categoryHeader" data-category="${category}">
                    <button class="btn-icon btn-toggle" data-action="toggleCategory" data-category="${category}">
                        ${isExpanded ? '▼' : '▶'}
                    </button>
                    <span class="category-name">${categoryName}</span>
                    <span class="category-count">${products.length}</span>
                </div>
                <div class="category-products ${this._state.viewMode}" data-ref="categoryProducts" data-category="${category}">
                    ${isExpanded ? products.map(p => this.renderProductCard(p)).join('') : ''}
                </div>
            </div>
        `;
    }

    /**
     * Рендерит карточку товара
     */
    renderProductCard(product) {
        const isAvailable = product.status === 'in_stock';
        const attributesText = formatAttributes(product.category, product.attributes);
        const margin = product.cost_price && product.price 
            ? ((product.price - product.cost_price) / product.price * 100).toFixed(0)
            : null;
        
        return `
            <div class="product-card ${!isAvailable ? 'product-sold' : ''}" 
                 data-id="${product.id}"
                 data-ref="productCard"
                 title="${this.escapeHtml(product.name)}"
            >
                <div class="product-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}" loading="lazy">` 
                        : '<span class="photo-placeholder">📦</span>'
                    }
                    ${margin && margin > 30 ? `
                        <span class="product-badge profit-badge">🔥</span>
                    ` : ''}
                </div>
                <div class="product-info">
                    <h4 class="product-name">${this.escapeHtml(product.name)}</h4>
                    ${attributesText ? `
                        <span class="product-attributes">${this.escapeHtml(attributesText)}</span>
                    ` : ''}
                    <div class="product-footer">
                        <span class="product-price">${formatMoney(product.price)}</span>
                        ${isAvailable ? `
                            <button 
                                class="btn-add-to-cart" 
                                data-action="addToCart" 
                                data-id="${product.id}"
                                title="Добавить в корзину"
                            >
                                +
                            </button>
                        ` : `
                            <span class="status-badge sold">Продан</span>
                        `}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Рендерит быстрый товар
     */
    renderQuickItem(product) {
        const isAvailable = product.status === 'in_stock';
        
        return `
            <div class="quick-item ${!isAvailable ? 'sold' : ''}" 
                 data-id="${product.id}"
                 data-action="addToCart"
            >
                <div class="quick-item-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}">` 
                        : '📦'
                    }
                </div>
                <span class="quick-item-price">${formatMoney(product.price)}</span>
            </div>
        `;
    }

    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    /**
     * Загружает начальные данные
     */
    async loadInitialData() {
        try {
            // Проверяем смену
            this.currentShift = await ShiftService.getCurrentShift(this.user.id);
            
            if (this.currentShift) {
                // Загружаем товары и статистику параллельно
                const [products, topProducts] = await Promise.all([
                    ProductService.getInStock(),
                    SaleService.getTopProducts(QUICK_ITEMS_COUNT),
                    this.updateShiftStats()
                ]);
                
                this.products = products;
                this.popularProducts = topProducts.map(tp => products.find(p => p.id === tp.id)).filter(Boolean);
                
                // Последние добавленные
                this.recentlyAdded = [...products]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .slice(0, 5);
                
                // Строим категории
                this.buildCategories();
                
                // Применяем фильтры
                this.filterProducts();
            }
            
        } catch (error) {
            console.error('[CashierPage] Load data error:', error);
            Notification.error('Ошибка при загрузке данных');
        }
    }

    /**
     * Строит список категорий с количеством
     */
    buildCategories() {
        const categoryCounts = new Map();
        
        this.products.forEach(p => {
            if (p.status === 'in_stock') {
                const cat = p.category || 'other';
                categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
            }
        });
        
        this.categories = Array.from(categoryCounts.entries())
            .map(([value, count]) => ({
                value,
                label: getCategoryName(value),
                count
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Фильтрует товары
     */
    filterProducts() {
        let filtered = this.products.filter(p => p.status === 'in_stock');
        
        // Поиск
        if (this._state.searchQuery) {
            const query = this._state.searchQuery.toLowerCase();
            filtered = filtered.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(query);
                const idMatch = p.id.toLowerCase().includes(query);
                const keywordMatch = p.keywords && p.keywords.toLowerCase().includes(query);
                const attrMatch = p.attributes && Object.values(p.attributes).some(
                    v => v && v.toString().toLowerCase().includes(query)
                );
                return nameMatch || idMatch || keywordMatch || attrMatch;
            });
        }
        
        // Категория
        if (this._state.selectedCategory) {
            filtered = filtered.filter(p => p.category === this._state.selectedCategory);
        }
        
        this.filteredProducts = filtered;
        
        // Автоматически разворачиваем категории при поиске
        if (this._state.searchQuery) {
            const categories = new Set(filtered.map(p => p.category));
            this._state.expandedCategories = categories;
        }
    }

    /**
     * Группирует товары по категориям
     */
    groupProductsByCategory(products) {
        const groups = {};
        
        products.forEach(p => {
            const cat = p.category || 'other';
            if (!groups[cat]) {
                groups[cat] = [];
            }
            groups[cat].push(p);
        });
        
        // Сортируем категории по количеству товаров
        return Object.fromEntries(
            Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
        );
    }

    /**
     * Обновляет статистику смены
     */
    async updateShiftStats() {
        if (!this.currentShift) return;
        
        try {
            const stats = await ShiftService.getCurrentShiftStats(this.currentShift.id);
            this.shiftStats = {
                revenue: stats.totalRevenue || 0,
                salesCount: stats.salesCount || 0,
                averageCheck: stats.averageCheck || 0,
                profit: stats.totalProfit || 0
            };
            
            // Обновляем DOM
            const panel = this.refs.get('shiftStatsPanel');
            if (panel) {
                panel.innerHTML = this.renderShiftStats();
            }
        } catch (error) {
            console.error('[CashierPage] Stats update error:', error);
        }
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    async attachEvents() {
        // Монтируем ShiftOpener
        const shiftContainer = this.refs.get('shiftContainer');
        if (shiftContainer) {
            this.shiftOpener = new ShiftOpener(shiftContainer);
            await this.shiftOpener.mount();
        }
        
        // Монтируем Cart
        if (this.currentShift) {
            const cartContainer = this.refs.get('cartContainer');
            this.cart = new Cart(cartContainer, this.currentShift.id);
            await this.cart.mount();
        }
        
        // Поиск
        const searchInput = this.refs.get('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this._state.isSearching = true;
                this.update();
                
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.handleSearch(e.target.value);
                }, 300);
            });
            
            // Фокус при загрузке
            setTimeout(() => searchInput.focus(), 100);
        }
        
        this.addDomListener('clearSearchBtn', 'click', () => this.clearSearch());
        this.addDomListener('clearSearchEmptyBtn', 'click', () => this.clearSearch());
        
        // Переключение вида
        this.addDomListener('gridViewBtn', 'click', () => this.setViewMode('grid'));
        this.addDomListener('listViewBtn', 'click', () => this.setViewMode('list'));
        
        // Категории
        document.querySelectorAll('[data-category]').forEach(el => {
            el.addEventListener('click', (e) => {
                if (el.classList.contains('category-tab')) {
                    const category = el.dataset.category;
                    this.selectCategory(category === 'all' ? null : category);
                }
            });
        });
        
        // Переключение категорий
        this.addDomListener('categoryHeader', 'click', (e) => {
            const btn = e.target.closest('[data-action="toggleCategory"]');
            if (btn) {
                const category = btn.dataset.category;
                this.toggleCategory(category);
            }
        });
        
        // Делегирование событий для товаров
        const productsContainer = this.refs.get('productsContainer');
        if (productsContainer) {
            productsContainer.addEventListener('click', (e) => {
                // Добавление в корзину
                const addBtn = e.target.closest('[data-action="addToCart"]');
                if (addBtn) {
                    const id = addBtn.dataset.id;
                    this.handleAddToCart(id);
                    return;
                }
                
                // Быстрый просмотр
                const card = e.target.closest('[data-ref="productCard"]');
                if (card && !e.target.closest('[data-action]')) {
                    const id = card.dataset.id;
                    this.showQuickView(id);
                }
            });
        }
        
        // Быстрые товары
        const quickScroll = this.refs.get('quickItemsScroll');
        if (quickScroll) {
            quickScroll.addEventListener('click', (e) => {
                const item = e.target.closest('[data-action="addToCart"]');
                if (item) {
                    const id = item.dataset.id;
                    this.handleAddToCart(id);
                }
            });
        }
        
        // Подписки на события
        this.subscribe('shift:opened', (data) => this.handleShiftOpened(data));
        this.subscribe('shift:closed', () => this.handleShiftClosed());
        this.subscribe('sale:completed', () => this.handleSaleCompleted());
        this.subscribe('product:created', () => this.refreshProducts());
        this.subscribe('product:updated', () => this.refreshProducts());
        this.subscribe('cart:checkout', ({ items, total, discount, paymentMethod }) => {
            this.handleCheckout(items, total, discount, paymentMethod);
        });
        
        // Горячие клавиши
        document.addEventListener('keydown', this.handleHotkey.bind(this));
        
        // Запускаем обновление статистики
        this.startStatsUpdate();
        
        // Сохраняем UI состояние при уходе
        window.addEventListener('beforeunload', () => this.saveUIState());
    }

    /**
     * Обработчик горячих клавиш
     */
    handleHotkey(e) {
        // Фокус на поиск по /
        if (e.key === HOTKEYS.SEARCH && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const searchInput = this.refs.get('searchInput');
            if (searchInput && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
        }
        
        // Очистка поиска по Escape
        if (e.key === HOTKEYS.CLEAR_SEARCH && document.activeElement === this.refs.get('searchInput')) {
            this.clearSearch();
        }
        
        // Быстрые категории F1-F4
        if (e.key.startsWith('F') && !e.ctrlKey && !e.altKey) {
            const index = parseInt(e.key.slice(1)) - 1;
            if (index >= 0 && index < this.categories.length) {
                e.preventDefault();
                this.selectCategory(this.categories[index].value);
            }
        }
        
        // Оформление продажи Ctrl+Enter
        if (e.key === HOTKEYS.CHECKOUT && e.ctrlKey) {
            e.preventDefault();
            if (this.cart && this.cart.getTotalQuantity() > 0) {
                this.cart.handleCheckout();
            }
        }
    }

    // ========== ДЕЙСТВИЯ ==========
    
    /**
     * Обработчик поиска
     */
    async handleSearch(query) {
        this._state.searchQuery = query;
        this._state.isSearching = false;
        this.filterProducts();
        this.saveUIState();
        await this.update();
    }

    /**
     * Очищает поиск
     */
    clearSearch() {
        this._state.searchQuery = '';
        this._state.isSearching = false;
        this.filterProducts();
        this.saveUIState();
        this.update();
        
        const searchInput = this.refs.get('searchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
    }

    /**
     * Выбирает категорию
     */
    selectCategory(category) {
        this._state.selectedCategory = category;
        this.filterProducts();
        
        // Разворачиваем выбранную категорию
        if (category) {
            this._state.expandedCategories.add(category);
        }
        
        this.saveUIState();
        this.update();
    }

    /**
     * Переключает развертывание категории
     */
    toggleCategory(category) {
        if (this._state.expandedCategories.has(category)) {
            this._state.expandedCategories.delete(category);
        } else {
            this._state.expandedCategories.add(category);
            
            // Ленивая загрузка товаров категории
            const container = document.querySelector(`[data-ref="categoryProducts"][data-category="${category}"]`);
            if (container && !container.children.length) {
                const products = this.groupProductsByCategory(this.filteredProducts)[category] || [];
                container.innerHTML = products.map(p => this.renderProductCard(p)).join('');
            }
        }
        
        this.saveUIState();
        this.update();
    }

    /**
     * Устанавливает режим отображения
     */
    setViewMode(mode) {
        this._state.viewMode = mode;
        this.saveUIState();
        this.update();
    }

    /**
     * Добавляет товар в корзину
     */
    handleAddToCart(id) {
        if (!this.currentShift) {
            Notification.warning('Сначала откройте смену');
            return;
        }
        
        const product = this.products.find(p => p.id === id);
        if (!product) return;
        
        if (product.status !== 'in_stock') {
            Notification.warning('Товар уже продан');
            return;
        }
        
        // Добавляем в корзину
        if (this.cart) {
            const added = this.cart.addItem(product);
            
            if (added) {
                // Анимация добавления
                const card = document.querySelector(`[data-id="${id}"]`);
                if (card) {
                    card.classList.add('added-to-cart');
                    setTimeout(() => card.classList.remove('added-to-cart'), 300);
                }
                
                // Добавляем в недавние
                if (!this.recentlyAdded.find(p => p.id === id)) {
                    this.recentlyAdded.unshift(product);
                    if (this.recentlyAdded.length > 5) {
                        this.recentlyAdded.pop();
                    }
                }
            }
        }
    }

    /**
     * Показывает быстрый просмотр товара
     */
    async showQuickView(id) {
        const product = this.products.find(p => p.id === id);
        if (!product) return;
        
        const modal = this.refs.get('quickViewModal');
        if (!modal) return;
        
        const attributesText = formatAttributes(product.category, product.attributes);
        const margin = product.cost_price && product.price 
            ? ((product.price - product.cost_price) / product.price * 100).toFixed(0)
            : null;
        
        modal.innerHTML = `
            <div class="quick-view-overlay" data-action="closeQuickView"></div>
            <div class="quick-view-content">
                <button class="btn-icon btn-close" data-action="closeQuickView">✕</button>
                <div class="quick-view-photo">
                    ${product.photo_url 
                        ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}">` 
                        : '<span class="photo-placeholder large">📦</span>'
                    }
                </div>
                <div class="quick-view-info">
                    <h3>${this.escapeHtml(product.name)}</h3>
                    <p class="quick-view-category">${getCategoryName(product.category)}</p>
                    ${attributesText ? `<p class="quick-view-attributes">${this.escapeHtml(attributesText)}</p>` : ''}
                    <div class="quick-view-prices">
                        <span class="price-large">${formatMoney(product.price)}</span>
                        ${product.cost_price ? `
                            <span class="cost-price">Себестоимость: ${formatMoney(product.cost_price)}</span>
                        ` : ''}
                        ${margin ? `
                            <span class="margin-badge ${margin > 30 ? 'high' : ''}">Маржа: ${margin}%</span>
                        ` : ''}
                    </div>
                    <div class="quick-view-actions">
                        ${product.status === 'in_stock' ? `
                            <button class="btn-primary btn-large" data-action="addToCart" data-id="${product.id}">
                                Добавить в корзину
                            </button>
                        ` : `
                            <span class="status-badge sold large">Продан</span>
                        `}
                    </div>
                </div>
            </div>
        `;
        
        modal.classList.remove('hidden');
        
        // Привязываем события
        modal.querySelectorAll('[data-action="closeQuickView"]').forEach(el => {
            el.addEventListener('click', () => modal.classList.add('hidden'));
        });
        
        modal.querySelector('[data-action="addToCart"]')?.addEventListener('click', () => {
            this.handleAddToCart(id);
            modal.classList.add('hidden');
        });
    }

    /**
     * Обработчик открытия смены
     */
    async handleShiftOpened(data) {
        this.currentShift = data.shift;
        await this.loadInitialData();
        this.update();
        
        // Пересоздаем корзину с новым shiftId
        const cartContainer = this.refs.get('cartContainer');
        if (cartContainer) {
            this.cart = new Cart(cartContainer, this.currentShift.id);
            await this.cart.mount();
        }
    }

    /**
     * Обработчик закрытия смены
     */
    handleShiftClosed() {
        this.currentShift = null;
        this.update();
    }

    /**
     * Обработчик завершения продажи
     */
    async handleSaleCompleted() {
        await this.updateShiftStats();
        await this.refreshProducts();
        
        // Очищаем недавние товары
        this.recentlyAdded = [];
    }

    /**
     * Обработчик оформления заказа
     */
    async handleCheckout(items, total, discount, paymentMethod) {
        try {
            await SaleService.create({
                shiftId: this.currentShift.id,
                items: items.map(item => ({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    discount: item.discount || 0
                })),
                total,
                discount,
                paymentMethod
            });
            
            Notification.success(`Продажа на ${formatMoney(total)}`);
            
            // Обновляем популярные товары
            const topProducts = await SaleService.getTopProducts(QUICK_ITEMS_COUNT);
            this.popularProducts = topProducts
                .map(tp => this.products.find(p => p.id === tp.id))
                .filter(Boolean);
            
        } catch (error) {
            console.error('[CashierPage] Checkout error:', error);
            Notification.error('Ошибка при создании продажи');
        }
    }

    /**
     * Обновляет список товаров
     */
    async refreshProducts() {
        try {
            this.products = await ProductService.getInStock();
            this.buildCategories();
            this.filterProducts();
            this.update();
        } catch (error) {
            console.error('[CashierPage] Refresh error:', error);
        }
    }

    // ========== UI СОСТОЯНИЕ ==========
    
    /**
     * Сохраняет состояние UI
     */
    saveUIState() {
        const state = {
            searchQuery: this._state.searchQuery,
            selectedCategory: this._state.selectedCategory,
            expandedCategories: Array.from(this._state.expandedCategories),
            viewMode: this._state.viewMode
        };
        
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    /**
     * Восстанавливает состояние UI
     */
    restoreUIState() {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                const state = JSON.parse(stored);
                this._state.searchQuery = state.searchQuery || '';
                this._state.selectedCategory = state.selectedCategory || null;
                this._state.expandedCategories = new Set(state.expandedCategories || []);
                this._state.viewMode = state.viewMode || 'grid';
            }
        } catch (error) {
            console.error('[CashierPage] Restore UI state error:', error);
        }
    }

    // ========== УТИЛИТЫ ==========
    
    /**
     * Запускает периодическое обновление статистики
     */
    startStatsUpdate() {
        this.statsUpdateTimer = setInterval(() => {
            if (this.currentShift) {
                this.updateShiftStats();
            }
        }, STATS_UPDATE_INTERVAL);
    }

    /**
     * Возвращает сообщение для пустого состояния
     */
    getEmptyStateMessage() {
        if (this._state.searchQuery) {
            return 'Товары не найдены. Попробуйте изменить поисковый запрос.';
        }
        if (this._state.selectedCategory) {
            return 'В этой категории нет товаров в наличии.';
        }
        return 'Нет товаров в наличии. Добавьте товары на склад.';
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.statsUpdateTimer) {
            clearInterval(this.statsUpdateTimer);
        }
        
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        
        document.removeEventListener('keydown', this.handleHotkey);
        
        this.saveUIState();
    }
}
