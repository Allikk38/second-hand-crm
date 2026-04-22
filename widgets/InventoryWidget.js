// ========================================
// FILE: ./widgets/InventoryWidget.js
// ========================================

/**
 * Inventory Widget - Виджет управления складом
 * 
 * Отвечает за отображение таблицы товаров, фильтрацию и выделение.
 * Полностью изолирован от остальных частей приложения.
 * 
 * Архитектурные решения:
 * - Наследуется от BaseWidget.
 * - Не импортирует сервисы напрямую (ProductService запрещен).
 * - Общение с внешним миром только через EventBus.
 * - Использует виртуальный скролл для работы с большими списками.
 * 
 * @module InventoryWidget
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { BaseWidget } from '../core-new/BaseWidget.js';
import { EventTypes, EventSource } from '../core-new/EventBus.js';

// Константы конфигурации виджета
const PAGE_SIZE = 30; // Количество товаров загружаемых за раз
const SCROLL_THRESHOLD = 0.8; // Порог срабатывания подгрузки

export class InventoryWidget extends BaseWidget {
    constructor(container) {
        super(container);
        
        // Локальное состояние виджета
        this.state = {
            products: [],          // Все загруженные товары
            filteredProducts: [],  // Товары после применения фильтров
            searchQuery: '',
            selectedCategory: '',
            selectedStatus: '',
            sortBy: 'created_at-desc',
            isLoading: false,
            hasMore: true,
            page: 0,
            selectedIds: new Set()
        };
        
        // Кэш элементов для виртуального скролла
        this.rowHeight = 64; // Высота строки в пикселях
        this.visibleRows = 15;
        this.scrollTop = 0;
        
        // Привязка методов
        this.handleScroll = this.handleScroll.bind(this);
        this.handleSearchInput = this.debounce(this.handleSearchInput.bind(this), 300);
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const products = this.state.filteredProducts;
        const { isLoading, hasMore, selectedIds, searchQuery } = this.state;
        
        // Вычисляем видимый диапазон
        const startIndex = Math.floor(this.scrollTop / this.rowHeight);
        const endIndex = Math.min(startIndex + this.visibleRows, products.length);
        const visibleProducts = products.slice(startIndex, endIndex);
        
        // Добавляем padding для правильной высоты скролла
        const topPadding = startIndex * this.rowHeight;
        const bottomPadding = (products.length - endIndex) * this.rowHeight;
        
        return `
            <div class="inventory-widget">
                <div class="widget-header">
                    <h2>📦 Склад</h2>
                    <div class="header-actions">
                        <div class="search-wrapper">
                            <input 
                                type="text" 
                                data-ref="searchInput"
                                class="search-input"
                                placeholder="Поиск по названию..."
                                value="${this.escapeHtml(searchQuery)}"
                            >
                            ${searchQuery ? `
                                <button class="clear-btn" data-ref="clearSearchBtn">✕</button>
                            ` : ''}
                        </div>
                        <button class="btn-primary" data-ref="addProductBtn">+ Добавить товар</button>
                    </div>
                </div>
                
                <div class="filters-bar">
                    <select data-ref="categoryFilter">
                        <option value="">Все категории</option>
                        <option value="clothes">Одежда</option>
                        <option value="toys">Игрушки</option>
                    </select>
                    <select data-ref="statusFilter">
                        <option value="">Все статусы</option>
                        <option value="in_stock">В наличии</option>
                        <option value="sold">Проданные</option>
                    </select>
                    <select data-ref="sortSelect">
                        <option value="created_at-desc">Новые сначала</option>
                        <option value="price-asc">Цена: по возрастанию</option>
                        <option value="price-desc">Цена: по убыванию</option>
                    </select>
                    
                    ${selectedIds.size > 0 ? `
                        <div class="bulk-actions">
                            <span>Выбрано: ${selectedIds.size}</span>
                            <button class="btn-secondary" data-ref="clearSelectionBtn">Снять</button>
                            <button class="btn-danger" data-ref="bulkDeleteBtn">Удалить</button>
                        </div>
                    ` : ''}
                </div>
                
                <div class="table-container" data-ref="tableContainer" style="max-height: 70vh; overflow-y: auto;">
                    <table class="products-table">
                        <thead>
                            <tr>
                                <th width="40">
                                    <input type="checkbox" data-ref="selectAllCheckbox">
                                </th>
                                <th>Фото</th>
                                <th>Название</th>
                                <th>Цена</th>
                                <th>Статус</th>
                                <th width="100">Действия</th>
                            </tr>
                        </thead>
                        <tbody data-ref="tableBody" style="position: relative;">
                            <tr style="height: ${topPadding}px;"></tr>
                            ${visibleProducts.map(p => this.renderRow(p)).join('')}
                            <tr style="height: ${bottomPadding}px;"></tr>
                        </tbody>
                    </table>
                    
                    ${isLoading ? `
                        <div class="loader-row">
                            <div class="loading-spinner small"></div>
                            <span>Загрузка...</span>
                        </div>
                    ` : ''}
                    
                    ${!hasMore && products.length > 0 ? `
                        <div class="end-of-list">Все товары загружены</div>
                    ` : ''}
                    
                    ${products.length === 0 && !isLoading ? `
                        <div class="empty-state">
                            <span>📭</span>
                            <p>Товары не найдены</p>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    renderRow(product) {
        const isSelected = this.state.selectedIds.has(product.id);
        
        return `
            <tr class="product-row ${product.status === 'sold' ? 'sold' : ''}" data-id="${product.id}">
                <td>
                    <input 
                        type="checkbox" 
                        class="row-checkbox" 
                        data-id="${product.id}"
                        ${isSelected ? 'checked' : ''}
                    >
                </td>
                <td>
                    <div class="product-thumb">
                        ${product.photo_url 
                            ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}">` 
                            : '📦'
                        }
                    </div>
                </td>
                <td>
                    <div class="product-name">${this.escapeHtml(product.name)}</div>
                    <div class="product-id">ID: ${product.id?.slice(0, 8)}</div>
                </td>
                <td class="price-cell">${this.formatMoney(product.price)}</td>
                <td>
                    <span class="status-badge status-${product.status}">
                        ${this.getStatusText(product.status)}
                    </span>
                </td>
                <td>
                    <div class="row-actions">
                        <button class="btn-icon" data-action="edit" data-id="${product.id}">✎</button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}">✕</button>
                    </div>
                </td>
            </tr>
        `;
    }

    async afterRender() {
        // Запрашиваем данные при первом монтировании
        if (this.state.products.length === 0) {
            this.loadProducts();
        }
    }

    attachEvents() {
        // Подписка на системные события ДО привязки DOM
        this.subscribe(EventTypes.DATA.PRODUCTS_FETCHED, (data) => {
            console.log('[InventoryWidget] Received products from adapter');
            
            // Проверяем, что данные пришли от адаптера
            if (data.source !== EventSource.ADAPTER_SUPABASE) return;
            
            const { products, hasMore, page } = data;
            
            if (page === 0) {
                this.state.products = products;
            } else {
                this.state.products = [...this.state.products, ...products];
            }
            
            this.state.hasMore = hasMore;
            this.state.page = page;
            this.state.isLoading = false;
            
            this.applyFilters();
        });
        
        this.subscribe(EventTypes.DATA.PRODUCT_CREATED, () => {
            console.log('[InventoryWidget] Product created, refreshing...');
            this.state.page = 0;
            this.state.products = [];
            this.loadProducts();
        });
        
        this.subscribe(EventTypes.DATA.PRODUCT_UPDATED, () => {
            this.state.page = 0;
            this.state.products = [];
            this.loadProducts();
        });
        
        this.subscribe(EventTypes.DATA.PRODUCT_DELETED, () => {
            this.state.selectedIds.clear();
            this.state.page = 0;
            this.state.products = [];
            this.loadProducts();
        });
        
        // DOM-события
        const tableContainer = this.refs.get('tableContainer');
        if (tableContainer) {
            tableContainer.addEventListener('scroll', this.handleScroll);
        }
        
        this.addDomListener('searchInput', 'input', this.handleSearchInput);
        this.addDomListener('clearSearchBtn', 'click', () => this.clearSearch());
        this.addDomListener('addProductBtn', 'click', () => this.openProductForm());
        this.addDomListener('categoryFilter', 'change', (e) => this.handleFilterChange('category', e));
        this.addDomListener('statusFilter', 'change', (e) => this.handleFilterChange('status', e));
        this.addDomListener('sortSelect', 'change', (e) => this.handleFilterChange('sort', e));
        this.addDomListener('selectAllCheckbox', 'change', (e) => this.handleSelectAll(e));
        this.addDomListener('clearSelectionBtn', 'click', () => this.clearSelection());
        this.addDomListener('bulkDeleteBtn', 'click', () => this.handleBulkDelete());
        
        // Делегирование событий таблицы
        const tbody = this.refs.get('tableBody');
        if (tbody) {
            tbody.addEventListener('change', (e) => {
                if (e.target.classList.contains('row-checkbox')) {
                    this.handleRowSelect(e.target);
                }
            });
            
            tbody.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                
                if (action === 'edit') this.handleEdit(id);
                if (action === 'delete') this.handleDelete(id);
            });
        }
    }
    
    beforeDestroy() {
        const tableContainer = this.refs.get('tableContainer');
        if (tableContainer) {
            tableContainer.removeEventListener('scroll', this.handleScroll);
        }
        
        console.log('[InventoryWidget] Cleaned up');
    }

    // ========== БИЗНЕС-ЛОГИКА ==========
    
    loadProducts() {
        if (this.state.isLoading || !this.state.hasMore) return;
        
        this.state.isLoading = true;
        this.update();
        
        // Отправляем запрос через EventBus
        // Адаптер SupabaseAdapter услышит это и выполнит запрос
        this.publish(EventTypes.DATA.PRODUCTS_FETCH, {
            page: this.state.page,
            limit: PAGE_SIZE,
            filters: {
                search: this.state.searchQuery,
                category: this.state.selectedCategory,
                status: this.state.selectedStatus
            },
            sort: this.state.sortBy
        });
    }
    
    applyFilters() {
        let filtered = [...this.state.products];
        
        // Поиск
        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase();
            filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
        }
        
        // Категория
        if (this.state.selectedCategory) {
            filtered = filtered.filter(p => p.category === this.state.selectedCategory);
        }
        
        // Статус
        if (this.state.selectedStatus) {
            filtered = filtered.filter(p => p.status === this.state.selectedStatus);
        }
        
        this.state.filteredProducts = filtered;
        this.update();
    }
    
    handleScroll() {
        const container = this.refs.get('tableContainer');
        if (!container) return;
        
        // Обновляем позицию скролла для виртуального рендеринга
        this.scrollTop = container.scrollTop;
        this.update();
        
        // Проверяем необходимость подгрузки
        const scrollPercentage = (container.scrollTop + container.clientHeight) / container.scrollHeight;
        
        if (scrollPercentage > SCROLL_THRESHOLD && !this.state.isLoading && this.state.hasMore) {
            this.state.page++;
            this.loadProducts();
        }
    }
    
    handleSearchInput(e) {
        this.state.searchQuery = e.target.value;
        this.state.page = 0;
        this.state.products = [];
        this.state.hasMore = true;
        this.loadProducts();
    }
    
    clearSearch() {
        this.state.searchQuery = '';
        const input = this.refs.get('searchInput');
        if (input) input.value = '';
        this.state.page = 0;
        this.state.products = [];
        this.state.hasMore = true;
        this.loadProducts();
    }
    
    handleFilterChange(type, e) {
        const value = e.target.value;
        
        if (type === 'category') this.state.selectedCategory = value;
        if (type === 'status') this.state.selectedStatus = value;
        if (type === 'sort') this.state.sortBy = value;
        
        this.state.page = 0;
        this.state.products = [];
        this.state.hasMore = true;
        this.loadProducts();
    }
    
    handleSelectAll(e) {
        if (e.target.checked) {
            this.state.filteredProducts.forEach(p => this.state.selectedIds.add(p.id));
        } else {
            this.state.selectedIds.clear();
        }
        this.update();
    }
    
    handleRowSelect(checkbox) {
        const id = checkbox.dataset.id;
        
        if (checkbox.checked) {
            this.state.selectedIds.add(id);
        } else {
            this.state.selectedIds.delete(id);
        }
        this.update();
    }
    
    clearSelection() {
        this.state.selectedIds.clear();
        this.update();
    }
    
    openProductForm() {
        // Отправляем событие на открытие модалки формы
        this.publish(EventTypes.UI.MODAL_OPENED, {
            type: 'product-form',
            product: null
        });
    }
    
    handleEdit(id) {
        const product = this.state.products.find(p => p.id === id);
        if (product) {
            this.publish(EventTypes.UI.MODAL_OPENED, {
                type: 'product-form',
                product
            });
        }
    }
    
    handleDelete(id) {
        this.publish(EventTypes.UI.MODAL_OPENED, {
            type: 'confirm-dialog',
            data: {
                title: 'Удаление товара',
                message: 'Вы уверены, что хотите удалить этот товар?',
                onConfirm: () => {
                    this.publish(EventTypes.DATA.PRODUCT_DELETED, { id });
                }
            }
        });
    }
    
    handleBulkDelete() {
        if (this.state.selectedIds.size === 0) return;
        
        this.publish(EventTypes.UI.MODAL_OPENED, {
            type: 'confirm-dialog',
            data: {
                title: 'Массовое удаление',
                message: `Удалить ${this.state.selectedIds.size} товаров?`,
                onConfirm: () => {
                    const ids = Array.from(this.state.selectedIds);
                    this.publish(EventTypes.DATA.PRODUCT_DELETED, { ids, bulk: true });
                }
            }
        });
    }

    // ========== УТИЛИТЫ ==========
    
    getStatusText(status) {
        const map = {
            'in_stock': 'В наличии',
            'sold': 'Продан',
            'reserved': 'Забронирован'
        };
        return map[status] || status;
    }
    
    debounce(fn, delay) {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
}

export default InventoryWidget;
