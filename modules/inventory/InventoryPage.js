/**
 * Inventory Page Component
 * 
 * Страница управления складом: просмотр, фильтрация, сортировка, массовые операции.
 * 
 * Архитектурные решения:
 * - Бесконечный скролл с IntersectionObserver для оптимальной производительности
 * - Дебаунс поиска (300ms) для снижения нагрузки на БД
 * - Сохранение состояния фильтров в URL для восстановления после перезагрузки
 * - Массовые операции с визуальной обратной связью
 * - Экспорт в Excel (CSV с BOM и разделителем ;)
 * - Skeleton loader для улучшения UX
 * - Интеграция с ProductService для кэширования и пагинации
 * 
 * @module InventoryPage
 * @extends BaseComponent
 * @requires ProductService
 * @requires PermissionManager
 * @requires ProductForm
 * @requires ConfirmDialog
 * @requires Notification
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { ProductForm } from './ProductForm.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { Notification } from '../common/Notification.js';
import { 
    formatMoney, 
    formatDate, 
    formatCompactNumber 
} from '../../utils/formatters.js';
import { 
    CATEGORY_SCHEMA, 
    getCategoryName, 
    formatAttributes 
} from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const SCROLL_THRESHOLD = 0.8; // 80% высоты контейнера

/**
 * Тексты статусов товаров
 */
const STATUS_TEXTS = {
    in_stock: 'В наличии',
    sold: 'Продан',
    reserved: 'Забронирован'
};

/**
 * Опции сортировки
 */
const SORT_OPTIONS = [
    { value: 'created_at-desc', label: 'Новые сначала' },
    { value: 'created_at-asc', label: 'Старые сначала' },
    { value: 'price-desc', label: 'Цена: по убыванию' },
    { value: 'price-asc', label: 'Цена: по возрастанию' },
    { value: 'name-asc', label: 'Название: А-Я' },
    { value: 'name-desc', label: 'Название: Я-А' }
];

/**
 * Опции статусов для фильтра
 */
const STATUS_FILTERS = [
    { value: '', label: 'Все статусы' },
    { value: 'in_stock', label: 'В наличии' },
    { value: 'sold', label: 'Проданные' },
    { value: 'reserved', label: 'Забронированные' }
];

export class InventoryPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Состояние
        this._state = {
            products: [],
            filteredCount: 0,
            page: 0,
            hasMore: true,
            isLoading: false,
            searchQuery: '',
            selectedCategory: '',
            selectedStatus: '',
            sortBy: 'created_at-desc',
            selectedIds: new Set(),
            isAllSelected: false
        };
        
        // Кэш категорий для фильтра
        this.categories = [];
        
        // Observer для бесконечного скролла
        this.intersectionObserver = null;
        this.loadMoreTrigger = null;
        
        // Таймер для дебаунса поиска
        this.searchDebounceTimer = null;
        
        // Права
        this.permissions = {
            canCreate: PermissionManager.can('products:create'),
            canEdit: PermissionManager.can('products:edit'),
            canDelete: PermissionManager.can('products:delete'),
            canManage: PermissionManager.can('products:create') || PermissionManager.can('products:delete')
        };
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        // Восстанавливаем состояние из URL
        this.restoreStateFromURL();
        
        // Загружаем начальные данные
        await this.loadProducts(true);
        
        // Строим список категорий для фильтра
        this.buildCategoryFilters();
        
        const stats = this.calculateStats();
        const hasSelected = this._state.selectedIds.size > 0;
        
        return `
            <div class="inventory-page">
                <!-- Заголовок и статистика -->
                <div class="page-header">
                    <div class="header-left">
                        <h2>Склад</h2>
                        <div class="stats-badge">
                            <span>${stats.total} всего</span>
                            <span class="badge-success">${stats.inStock} в наличии</span>
                            <span class="badge-secondary">${stats.sold} продано</span>
                        </div>
                    </div>
                    <div class="header-right">
                        ${this.permissions.canCreate ? `
                            <button class="btn-primary" data-ref="addProductBtn">
                                + Добавить товар
                            </button>
                        ` : ''}
                        <button class="btn-secondary" data-ref="exportBtn">
                            📊 Экспорт в Excel
                        </button>
                    </div>
                </div>
                
                <!-- Панель фильтров -->
                <div class="filters-panel">
                    <div class="search-wrapper">
                        <input 
                            type="text" 
                            data-ref="searchInput"
                            placeholder="Поиск по названию или характеристикам..." 
                            value="${this.escapeHtml(this._state.searchQuery)}"
                            autocomplete="off"
                        >
                        ${this._state.searchQuery ? `
                            <button class="btn-ghost btn-icon" data-ref="clearSearchBtn" title="Очистить">✕</button>
                        ` : ''}
                    </div>
                    
                    <div class="filters-group">
                        <select data-ref="categoryFilter">
                            <option value="">Все категории</option>
                            ${this.categories.map(cat => `
                                <option value="${cat.value}" ${this._state.selectedCategory === cat.value ? 'selected' : ''}>
                                    ${cat.label} (${cat.count})
                                </option>
                            `).join('')}
                        </select>
                        
                        <select data-ref="statusFilter">
                            ${STATUS_FILTERS.map(opt => `
                                <option value="${opt.value}" ${this._state.selectedStatus === opt.value ? 'selected' : ''}>
                                    ${opt.label}
                                </option>
                            `).join('')}
                        </select>
                        
                        <select data-ref="sortSelect">
                            ${SORT_OPTIONS.map(opt => `
                                <option value="${opt.value}" ${this._state.sortBy === opt.value ? 'selected' : ''}>
                                    ${opt.label}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    
                    ${hasSelected ? `
                        <div class="bulk-actions-panel">
                            <span class="selected-count">Выбрано: ${this._state.selectedIds.size}</span>
                            <button class="btn-secondary" data-ref="selectAllBtn">
                                ${this._state.isAllSelected ? 'Снять выделение' : 'Выбрать все'}
                            </button>
                            ${this.permissions.canDelete ? `
                                <button class="btn-danger" data-ref="bulkDeleteBtn">
                                    Удалить выбранные
                                </button>
                            ` : ''}
                            <button class="btn-ghost" data-ref="clearSelectionBtn">
                                Отменить
                            </button>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Таблица товаров -->
                <div class="products-table-wrapper" data-ref="tableWrapper">
                    <table class="products-table">
                        <thead>
                            <tr>
                                <th width="40">
                                    <input 
                                        type="checkbox" 
                                        data-ref="selectAllCheckbox"
                                        ${this._state.isAllSelected ? 'checked' : ''}
                                    >
                                </th>
                                <th width="80">Фото</th>
                                <th>Название</th>
                                <th>Категория</th>
                                <th>Характеристики</th>
                                <th>Цена</th>
                                <th>Статус</th>
                                <th width="100">Действия</th>
                            </tr>
                        </thead>
                        <tbody data-ref="productsTableBody">
                            ${this.renderProductRows()}
                        </tbody>
                    </table>
                    
                    <!-- Триггер для подгрузки -->
                    <div data-ref="loadMoreTrigger" class="load-more-trigger"></div>
                    
                    <!-- Индикатор загрузки -->
                    ${this._state.isLoading ? this.renderSkeletonRows() : ''}
                    
                    <!-- Сообщение о конце списка -->
                    ${!this._state.hasMore && this._state.products.length > 0 ? `
                        <div class="end-of-list">Все товары загружены (${this._state.products.length})</div>
                    ` : ''}
                    
                    <!-- Пустое состояние -->
                    ${this._state.products.length === 0 && !this._state.isLoading ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">📦</div>
                            <p>${this.getEmptyStateMessage()}</p>
                            ${this.permissions.canCreate ? `
                                <button class="btn-primary" data-ref="addProductEmptyBtn">
                                    Добавить первый товар
                                </button>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Рендерит строки таблицы с товарами
     */
    renderProductRows() {
        if (this._state.products.length === 0) {
            return '';
        }
        
        return this._state.products.map(product => {
            const attributesText = formatAttributes(product.category, product.attributes);
            const isSelected = this._state.selectedIds.has(product.id);
            
            return `
                <tr class="product-row ${product.status === 'sold' ? 'row-sold' : ''}" data-id="${product.id}">
                    <td class="checkbox-cell">
                        <input 
                            type="checkbox" 
                            class="product-checkbox"
                            data-id="${product.id}"
                            ${isSelected ? 'checked' : ''}
                        >
                    </td>
                    <td class="photo-cell">
                        <div class="product-thumb">
                            ${product.photo_url 
                                ? `<img src="${product.photo_url}" alt="${this.escapeHtml(product.name)}" loading="lazy">` 
                                : '<span class="thumb-placeholder">📦</span>'
                            }
                        </div>
                    </td>
                    <td class="name-cell">
                        <div class="product-name">${this.escapeHtml(product.name)}</div>
                        <div class="product-id">ID: ${product.id.slice(0, 8)}</div>
                    </td>
                    <td class="category-cell">
                        ${getCategoryName(product.category)}
                    </td>
                    <td class="attributes-cell">
                        <span class="attributes-text">${this.escapeHtml(attributesText) || '—'}</span>
                    </td>
                    <td class="price-cell">
                        <div class="price-main">${formatMoney(product.price)}</div>
                        ${product.cost_price ? `
                            <div class="price-cost">Себ: ${formatMoney(product.cost_price)}</div>
                        ` : ''}
                        ${product.cost_price && product.price ? `
                            <div class="price-margin ${product.price > product.cost_price ? 'positive' : 'negative'}">
                                Маржа: ${((product.price - product.cost_price) / product.price * 100).toFixed(0)}%
                            </div>
                        ` : ''}
                    </td>
                    <td class="status-cell">
                        <span class="status-badge status-${product.status}">
                            ${STATUS_TEXTS[product.status] || product.status}
                        </span>
                    </td>
                    <td class="actions-cell">
                        <div class="row-actions">
                            ${this.permissions.canEdit ? `
                                <button class="btn-icon" data-action="edit" data-id="${product.id}" title="Редактировать">
                                    ✎
                                </button>
                            ` : ''}
                            ${this.permissions.canDelete ? `
                                <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" title="Удалить">
                                    ✕
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Рендерит скелетон для загрузки
     */
    renderSkeletonRows() {
        return `
            <div class="skeleton-rows">
                ${Array(3).fill(0).map(() => `
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-checkbox"></div>
                        <div class="skeleton skeleton-image"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-badge"></div>
                        <div class="skeleton skeleton-actions"></div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * Привязывает события
     */
    attachEvents() {
        // Кнопка добавления
        this.addDomListener('addProductBtn', 'click', () => this.openProductForm());
        this.addDomListener('addProductEmptyBtn', 'click', () => this.openProductForm());
        
        // Экспорт
        this.addDomListener('exportBtn', 'click', () => this.exportToExcel());
        
        // Поиск с дебаунсом
        const searchInput = this.refs.get('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.handleSearch(e.target.value);
                }, SEARCH_DEBOUNCE_MS);
            });
        }
        
        // Кнопка очистки поиска
        this.addDomListener('clearSearchBtn', 'click', () => {
            const input = this.refs.get('searchInput');
            if (input) {
                input.value = '';
                this.handleSearch('');
            }
        });
        
        // Фильтры
        this.addDomListener('categoryFilter', 'change', (e) => {
            this.handleFilterChange('category', e.target.value);
        });
        
        this.addDomListener('statusFilter', 'change', (e) => {
            this.handleFilterChange('status', e.target.value);
        });
        
        this.addDomListener('sortSelect', 'change', (e) => {
            this.handleFilterChange('sort', e.target.value);
        });
        
        // Выделение товаров
        this.addDomListener('selectAllCheckbox', 'change', (e) => {
            this.handleSelectAll(e.target.checked);
        });
        
        this.addDomListener('selectAllBtn', 'click', () => {
            this.handleSelectAll(!this._state.isAllSelected);
        });
        
        this.addDomListener('clearSelectionBtn', 'click', () => {
            this.clearSelection();
        });
        
        this.addDomListener('bulkDeleteBtn', 'click', () => {
            this.handleBulkDelete();
        });
        
        // Чекбоксы товаров (делегирование)
        const tbody = this.refs.get('productsTableBody');
        if (tbody) {
            tbody.addEventListener('change', (e) => {
                if (e.target.classList.contains('product-checkbox')) {
                    const id = e.target.dataset.id;
                    this.handleProductSelect(id, e.target.checked);
                }
            });
        }
        
        // Действия с товарами (делегирование)
        if (tbody) {
            tbody.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                
                if (action === 'edit') {
                    this.handleEdit(id);
                } else if (action === 'delete') {
                    this.handleDelete(id);
                }
            });
        }
        
        // Бесконечный скролл
        this.setupInfiniteScroll();
        
        // Подписка на события
        this.subscribe('product:created', () => this.refresh());
        this.subscribe('product:updated', () => this.refresh());
        this.subscribe('product:deleted', () => this.refresh());
        this.subscribe('product:bulk-updated', () => this.refresh());
        
        // Синхронизация с URL
        window.addEventListener('popstate', () => {
            this.restoreStateFromURL();
            this.refresh();
        });
    }

    /**
     * Настраивает бесконечный скролл
     */
    setupInfiniteScroll() {
        this.loadMoreTrigger = this.refs.get('loadMoreTrigger');
        
        if (!this.loadMoreTrigger) return;
        
        this.intersectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && this._state.hasMore && !this._state.isLoading) {
                        this.loadMore();
                    }
                });
            },
            {
                root: this.refs.get('tableWrapper'),
                threshold: SCROLL_THRESHOLD
            }
        );
        
        this.intersectionObserver.observe(this.loadMoreTrigger);
    }

    /**
     * Очистка ресурсов
     */
    beforeDestroy() {
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
    }

    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    /**
     * Загружает товары
     */
    async loadProducts(reset = false) {
        if (this._state.isLoading) return;
        
        if (reset) {
            this._state.page = 0;
            this._state.products = [];
            this._state.hasMore = true;
            this._state.selectedIds.clear();
            this._state.isAllSelected = false;
        }
        
        this._state.isLoading = true;
        await this.update();
        
        try {
            const options = {
                limit: PAGE_SIZE,
                offset: this._state.page * PAGE_SIZE
            };
            
            let products;
            
            if (this._state.searchQuery || this._state.selectedCategory || this._state.selectedStatus) {
                // Используем поиск с фильтрами
                products = await this.searchProducts(options);
            } else {
                // Обычная загрузка
                products = await ProductService.getAll(options);
            }
            
            // Применяем сортировку на клиенте (если не используется серверная)
            products = this.applyClientSort(products);
            
            if (reset) {
                this._state.products = products;
            } else {
                this._state.products = [...this._state.products, ...products];
            }
            
            this._state.hasMore = products.length === PAGE_SIZE;
            this._state.page++;
            
            // Обновляем счетчик отфильтрованных
            await this.updateFilteredCount();
            
        } catch (error) {
            console.error('[InventoryPage] Load products error:', error);
            Notification.error('Ошибка при загрузке товаров');
        } finally {
            this._state.isLoading = false;
            await this.update();
        }
    }

    /**
     * Поиск товаров с фильтрами
     */
    async searchProducts(options) {
        // Здесь должна быть интеграция с ProductService.search()
        // Пока используем getAll с клиентской фильтрацией
        const allProducts = await ProductService.getAll({ forceRefresh: false });
        
        let filtered = allProducts.filter(p => {
            // Поиск по тексту
            if (this._state.searchQuery) {
                const query = this._state.searchQuery.toLowerCase();
                const nameMatch = p.name.toLowerCase().includes(query);
                const attrMatch = p.attributes && Object.values(p.attributes).some(
                    v => v && v.toString().toLowerCase().includes(query)
                );
                if (!nameMatch && !attrMatch) return false;
            }
            
            // Фильтр по категории
            if (this._state.selectedCategory && p.category !== this._state.selectedCategory) {
                return false;
            }
            
            // Фильтр по статусу
            if (this._state.selectedStatus && p.status !== this._state.selectedStatus) {
                return false;
            }
            
            return true;
        });
        
        // Применяем пагинацию
        const start = options.offset || 0;
        const end = start + (options.limit || PAGE_SIZE);
        
        return filtered.slice(start, end);
    }

    /**
     * Обновляет счетчик отфильтрованных товаров
     */
    async updateFilteredCount() {
        const allProducts = await ProductService.getAll({ forceRefresh: false });
        
        let filtered = allProducts;
        
        if (this._state.searchQuery) {
            const query = this._state.searchQuery.toLowerCase();
            filtered = filtered.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(query);
                const attrMatch = p.attributes && Object.values(p.attributes).some(
                    v => v && v.toString().toLowerCase().includes(query)
                );
                return nameMatch || attrMatch;
            });
        }
        
        if (this._state.selectedCategory) {
            filtered = filtered.filter(p => p.category === this._state.selectedCategory);
        }
        
        if (this._state.selectedStatus) {
            filtered = filtered.filter(p => p.status === this._state.selectedStatus);
        }
        
        this._state.filteredCount = filtered.length;
    }

    /**
     * Применяет клиентскую сортировку
     */
    applyClientSort(products) {
        const [field, direction] = this._state.sortBy.split('-');
        
        return [...products].sort((a, b) => {
            let aVal, bVal;
            
            switch (field) {
                case 'price':
                    aVal = a.price || 0;
                    bVal = b.price || 0;
                    break;
                case 'name':
                    aVal = a.name || '';
                    bVal = b.name || '';
                    break;
                case 'created_at':
                default:
                    aVal = new Date(a.created_at || 0).getTime();
                    bVal = new Date(b.created_at || 0).getTime();
            }
            
            if (direction === 'asc') {
                return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            } else {
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            }
        });
    }

    /**
     * Подгружает следующую страницу
     */
    async loadMore() {
        if (!this._state.hasMore || this._state.isLoading) return;
        await this.loadProducts(false);
    }

    /**
     * Обновляет страницу
     */
    async refresh() {
        await this.loadProducts(true);
    }

    // ========== ФИЛЬТРЫ ==========
    
    /**
     * Строит список категорий для фильтра
     */
    async buildCategoryFilters() {
        const products = await ProductService.getAll({ forceRefresh: false });
        
        const categoryCounts = new Map();
        products.forEach(p => {
            const cat = p.category || 'other';
            categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
        });
        
        this.categories = Array.from(categoryCounts.entries())
            .map(([value, count]) => ({
                value,
                label: getCategoryName(value),
                count
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Обработчик поиска
     */
    async handleSearch(query) {
        this._state.searchQuery = query;
        this.updateURL();
        await this.loadProducts(true);
    }

    /**
     * Обработчик изменения фильтра
     */
    async handleFilterChange(type, value) {
        switch (type) {
            case 'category':
                this._state.selectedCategory = value;
                break;
            case 'status':
                this._state.selectedStatus = value;
                break;
            case 'sort':
                this._state.sortBy = value;
                break;
        }
        
        this.updateURL();
        await this.loadProducts(true);
    }

    // ========== ВЫДЕЛЕНИЕ ТОВАРОВ ==========
    
    /**
     * Обработчик выделения товара
     */
    handleProductSelect(id, selected) {
        if (selected) {
            this._state.selectedIds.add(id);
        } else {
            this._state.selectedIds.delete(id);
            this._state.isAllSelected = false;
        }
        
        this.updateSelectAllCheckbox();
        this.update();
    }

    /**
     * Обработчик "Выбрать все"
     */
    handleSelectAll(select) {
        if (select) {
            this._state.products.forEach(p => {
                this._state.selectedIds.add(p.id);
            });
            this._state.isAllSelected = true;
        } else {
            this._state.selectedIds.clear();
            this._state.isAllSelected = false;
        }
        
        this.update();
    }

    /**
     * Очищает выделение
     */
    clearSelection() {
        this._state.selectedIds.clear();
        this._state.isAllSelected = false;
        this.update();
    }

    /**
     * Обновляет состояние чекбокса "Выбрать все"
     */
    updateSelectAllCheckbox() {
        const visibleIds = new Set(this._state.products.map(p => p.id));
        const selectedVisible = [...this._state.selectedIds].filter(id => visibleIds.has(id));
        
        this._state.isAllSelected = selectedVisible.length === this._state.products.length;
    }

    // ========== ДЕЙСТВИЯ С ТОВАРАМИ ==========
    
    /**
     * Открывает форму товара
     */
    openProductForm(product = null) {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'modal-container';
        document.body.appendChild(modalContainer);
        
        const form = new ProductForm(modalContainer, product);
        form.mount();
    }

    /**
     * Обработчик редактирования
     */
    async handleEdit(id) {
        const product = this._state.products.find(p => p.id === id);
        if (product) {
            this.openProductForm(product);
        }
    }

    /**
     * Обработчик удаления
     */
    async handleDelete(id) {
        const product = this._state.products.find(p => p.id === id);
        if (!product) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Удаление товара',
            message: `Вы уверены, что хотите удалить "${product.name}"?`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'danger'
        });
        
        if (!confirmed) return;
        
        try {
            await ProductService.delete(id);
            Notification.success(`Товар "${product.name}" удален`);
        } catch (error) {
            Notification.error('Ошибка при удалении товара');
        }
    }

    /**
     * Массовое удаление
     */
    async handleBulkDelete() {
        const count = this._state.selectedIds.size;
        if (count === 0) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Массовое удаление',
            message: `Вы уверены, что хотите удалить ${count} ${this.pluralize(count, 'товар', 'товара', 'товаров')}?`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'danger'
        });
        
        if (!confirmed) return;
        
        try {
            const ids = [...this._state.selectedIds];
            
            // Удаляем последовательно (можно заменить на массовое удаление в сервисе)
            for (const id of ids) {
                await ProductService.delete(id);
            }
            
            Notification.success(`Удалено ${count} ${this.pluralize(count, 'товар', 'товара', 'товаров')}`);
            this.clearSelection();
            await this.refresh();
        } catch (error) {
            Notification.error('Ошибка при массовом удалении');
        }
    }

    // ========== ЭКСПОРТ В EXCEL ==========
    
    /**
     * Экспортирует данные в Excel (CSV)
     */
    async exportToExcel() {
        try {
            Notification.info('Подготовка экспорта...');
            
            // Получаем все отфильтрованные товары
            const allProducts = await ProductService.getAll({ forceRefresh: false });
            
            let exportData = allProducts.filter(p => {
                if (this._state.searchQuery) {
                    const query = this._state.searchQuery.toLowerCase();
                    const nameMatch = p.name.toLowerCase().includes(query);
                    const attrMatch = p.attributes && Object.values(p.attributes).some(
                        v => v && v.toString().toLowerCase().includes(query)
                    );
                    if (!nameMatch && !attrMatch) return false;
                }
                
                if (this._state.selectedCategory && p.category !== this._state.selectedCategory) {
                    return false;
                }
                
                if (this._state.selectedStatus && p.status !== this._state.selectedStatus) {
                    return false;
                }
                
                return true;
            });
            
            // Применяем сортировку
            exportData = this.applyClientSort(exportData);
            
            // Формируем CSV
            const csv = this.generateExcelCSV(exportData);
            
            // Скачиваем файл
            this.downloadCSV(csv, `inventory_${new Date().toISOString().split('T')[0]}.csv`);
            
            Notification.success(`Экспортировано ${exportData.length} товаров`);
        } catch (error) {
            console.error('[InventoryPage] Export error:', error);
            Notification.error('Ошибка при экспорте');
        }
    }

    /**
     * Генерирует CSV для Excel
     */
    generateExcelCSV(products) {
        // Заголовки
        const headers = [
            'ID',
            'Название',
            'Категория',
            'Характеристики',
            'Цена продажи',
            'Себестоимость',
            'Прибыль',
            'Маржа %',
            'Статус',
            'Дата создания'
        ];
        
        // Строки данных
        const rows = products.map(p => {
            const attributesText = formatAttributes(p.category, p.attributes);
            const profit = (p.price || 0) - (p.cost_price || 0);
            const margin = p.price > 0 ? (profit / p.price * 100).toFixed(1) : 0;
            
            return [
                p.id,
                p.name,
                getCategoryName(p.category),
                attributesText,
                p.price || 0,
                p.cost_price || 0,
                profit,
                margin,
                STATUS_TEXTS[p.status] || p.status,
                formatDate(p.created_at, { withTime: true })
            ];
        });
        
        // Формируем CSV с разделителем ; для Excel
        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(';') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        
        const headerRow = headers.map(escape).join(';');
        const dataRows = rows.map(row => row.map(escape).join(';'));
        
        // Добавляем BOM для UTF-8
        return '\uFEFF' + [headerRow, ...dataRows].join('\n');
    }

    /**
     * Скачивает CSV файл
     */
    downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
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

    // ========== УТИЛИТЫ ==========
    
    /**
     * Рассчитывает статистику
     */
    calculateStats() {
        const all = this._state.products;
        
        return {
            total: all.length,
            inStock: all.filter(p => p.status === 'in_stock').length,
            sold: all.filter(p => p.status === 'sold').length,
            reserved: all.filter(p => p.status === 'reserved').length
        };
    }

    /**
     * Возвращает сообщение для пустого состояния
     */
    getEmptyStateMessage() {
        if (this._state.searchQuery || this._state.selectedCategory || this._state.selectedStatus) {
            return 'Товары не найдены. Попробуйте изменить фильтры.';
        }
        return 'На складе пока нет товаров.';
    }

    /**
     * Склоняет существительное
     */
    pluralize(count, one, two, five) {
        const n = Math.abs(count) % 100;
        const n1 = n % 10;
        
        if (n > 10 && n < 20) return five;
        if (n1 > 1 && n1 < 5) return two;
        if (n1 === 1) return one;
        return five;
    }

    // ========== URL СИНХРОНИЗАЦИЯ ==========
    
    /**
     * Обновляет URL с текущими фильтрами
     */
    updateURL() {
        const params = new URLSearchParams();
        
        if (this._state.searchQuery) {
            params.set('q', this._state.searchQuery);
        }
        if (this._state.selectedCategory) {
            params.set('category', this._state.selectedCategory);
        }
        if (this._state.selectedStatus) {
            params.set('status', this._state.selectedStatus);
        }
        if (this._state.sortBy !== 'created_at-desc') {
            params.set('sort', this._state.sortBy);
        }
        
        const newUrl = params.toString() 
            ? `${window.location.pathname}#inventory?${params.toString()}`
            : `${window.location.pathname}#inventory`;
        
        window.history.replaceState({}, '', newUrl);
    }

    /**
     * Восстанавливает состояние из URL
     */
    restoreStateFromURL() {
        const params = new URLSearchParams(window.location.search);
        
        this._state.searchQuery = params.get('q') || '';
        this._state.selectedCategory = params.get('category') || '';
        this._state.selectedStatus = params.get('status') || '';
        this._state.sortBy = params.get('sort') || 'created_at-desc';
    }
}
