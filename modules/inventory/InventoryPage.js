/**
 * Inventory Page Controller
 * 
 * Контроллер страницы склада. Координирует работу компонентов:
 * - InventoryState (состояние)
 * - InventoryTable (таблица)
 * - InventoryFilters (фильтры)
 * - InventoryStats (статистика)
 * 
 * Отвечает за загрузку данных, обработку действий пользователя
 * и координацию между компонентами.
 * 
 * @module InventoryPage
 * @version 4.0.0
 * @changes
 * - Полный рефакторинг: разделение на контроллер и компоненты
 * - Использование InventoryState для управления состоянием
 * - Вынесение таблицы и фильтров в отдельные классы
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { InventoryState } from './inventoryState.js';
import { InventoryTable } from './InventoryTable.js';
import { InventoryFilters } from './InventoryFilters.js';
import { InventoryStats } from './InventoryStats.js';
import { ProductService } from '../../services/ProductService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { ProductForm } from './ProductForm.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { Notification } from '../common/Notification.js';
import { getCategoryName } from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const STORAGE_KEY = 'inventory_filters';

export class InventoryPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Компоненты
        this.table = null;
        this.filters = null;
        this.stats = null;
        
        // Таймеры
        this.searchDebounceTimer = null;
        
        // Права
        this.permissions = {
            canCreate: PermissionManager.can('products:create'),
            canEdit: PermissionManager.can('products:edit'),
            canDelete: PermissionManager.can('products:delete')
        };
        
        // Отписки
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        // Восстанавливаем фильтры из localStorage
        this.restoreFilters();
        
        // Загружаем начальные данные
        await this.loadProducts(true);
        
        // Строим категории для фильтра
        await this.buildCategories();
        
        const state = InventoryState.getState();
        const hasSelected = state.getSelectedCount() > 0;
        
        return `
            <div class="inventory-page">
                <!-- Заголовок -->
                <div class="page-header">
                    <div class="header-left">
                        <h2>Склад</h2>
                        <div data-ref="statsContainer"></div>
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
                
                <!-- Фильтры -->
                <div data-ref="filtersContainer"></div>
                
                <!-- Массовые действия -->
                ${hasSelected ? `
                    <div class="bulk-actions-panel" data-ref="bulkActions">
                        <span class="selected-count">Выбрано: ${state.getSelectedCount()}</span>
                        <button class="btn-secondary" data-ref="selectAllBtn">
                            ${state.isAllSelected ? 'Снять выделение' : 'Выбрать все'}
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
                
                <!-- Таблица -->
                <div data-ref="tableContainer" class="table-container"></div>
            </div>
        `;
    }
    
    async attachEvents() {
        // Монтируем статистику
        const statsContainer = this.refs.get('statsContainer');
        this.stats = new InventoryStats(statsContainer);
        await this.stats.mount();
        
        // Монтируем фильтры
        const filtersContainer = this.refs.get('filtersContainer');
        this.filters = new InventoryFilters(filtersContainer, {
            onSearch: (query) => this.handleSearch(query),
            onCategoryChange: (category) => this.handleCategoryChange(category),
            onStatusChange: (status) => this.handleStatusChange(status),
            onSortChange: (sort) => this.handleSortChange(sort),
            onClearFilters: () => this.handleClearFilters()
        });
        await this.filters.mount();
        
        // Монтируем таблицу
        const tableContainer = this.refs.get('tableContainer');
        this.table = new InventoryTable(tableContainer, {
            onEdit: (id) => this.handleEdit(id),
            onDelete: (id) => this.handleDelete(id),
            onLoadMore: () => this.loadMore()
        });
        await this.table.mount();
        
        // Кнопки
        this.addDomListener('addProductBtn', 'click', () => this.openProductForm());
        this.addDomListener('exportBtn', 'click', () => this.exportToExcel());
        this.addDomListener('selectAllBtn', 'click', () => this.handleSelectAll());
        this.addDomListener('clearSelectionBtn', 'click', () => this.handleClearSelection());
        this.addDomListener('bulkDeleteBtn', 'click', () => this.handleBulkDelete());
        
        // Подписка на события сервиса
        this.unsubscribers.push(
            this.subscribe('product:created', () => this.refresh()),
            this.subscribe('product:updated', () => this.refresh()),
            this.subscribe('product:deleted', () => this.refresh()),
            this.subscribe('product:bulk-updated', () => this.refresh())
        );
        
        // Подписка на изменения состояния для обновления массовых действий
        this.unsubscribers.push(
            InventoryState.subscribe((changes) => {
                if (changes.some(c => c.key === 'selectedIds' || c.key === 'isAllSelected')) {
                    this.updateBulkActions();
                }
            })
        );
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    /**
     * Загружает товары
     */
    async loadProducts(reset = false) {
        const state = InventoryState.getState();
        
        if (state.isLoading) return;
        
        if (reset) {
            InventoryState.setMultiple({
                page: 0,
                products: [],
                hasMore: true
            });
            InventoryState.clearSelection();
        }
        
        InventoryState.set('isLoading', true);
        
        try {
            const options = {
                limit: PAGE_SIZE,
                offset: state.page * PAGE_SIZE
            };
            
            let products = await ProductService.getAll(options);
            
            // Применяем клиентскую фильтрацию и сортировку
            products = this.applyFilters(products);
            products = this.applySort(products);
            
            if (reset) {
                InventoryState.set('products', products);
            } else {
                const currentProducts = InventoryState.get('products');
                InventoryState.set('products', [...currentProducts, ...products]);
            }
            
            InventoryState.set('hasMore', products.length === PAGE_SIZE);
            InventoryState.set('page', state.page + 1);
            
            // Обновляем счетчик
            await this.updateFilteredCount();
            
        } catch (error) {
            console.error('[InventoryPage] Load error:', error);
            Notification.error('Ошибка при загрузке товаров');
        } finally {
            InventoryState.set('isLoading', false);
        }
    }
    
    /**
     * Применяет фильтры к списку товаров
     */
    applyFilters(products) {
        const state = InventoryState.getState();
        
        return products.filter(p => {
            // Поиск
            if (state.searchQuery) {
                const query = state.searchQuery.toLowerCase();
                const nameMatch = p.name.toLowerCase().includes(query);
                const attrMatch = p.attributes && Object.values(p.attributes).some(
                    v => v && v.toString().toLowerCase().includes(query)
                );
                if (!nameMatch && !attrMatch) return false;
            }
            
            // Категория
            if (state.selectedCategory && p.category !== state.selectedCategory) {
                return false;
            }
            
            // Статус
            if (state.selectedStatus && p.status !== state.selectedStatus) {
                return false;
            }
            
            return true;
        });
    }
    
    /**
     * Применяет сортировку
     */
    applySort(products) {
        const state = InventoryState.getState();
        const [field, direction] = state.sortBy.split('-');
        
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
     * Загружает следующую страницу
     */
    async loadMore() {
        await this.loadProducts(false);
    }
    
    /**
     * Обновляет страницу
     */
    async refresh() {
        await this.loadProducts(true);
        await this.stats?.update();
        await this.buildCategories();
    }
    
    /**
     * Строит список категорий для фильтра
     */
    async buildCategories() {
        const products = await ProductService.getAll({ forceRefresh: false });
        
        const categoryCounts = new Map();
        products.forEach(p => {
            const cat = p.category || 'other';
            categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
        });
        
        const categories = Array.from(categoryCounts.entries())
            .map(([value, count]) => ({
                value,
                label: getCategoryName(value),
                count
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
        
        InventoryState.set('categories', categories);
        this.filters?.updateCategories(categories);
    }
    
    /**
     * Обновляет счетчик отфильтрованных товаров
     */
    async updateFilteredCount() {
        const products = await ProductService.getAll({ forceRefresh: false });
        const filtered = this.applyFilters(products);
        InventoryState.set('filteredCount', filtered.length);
    }
    
    // ========== ОБРАБОТЧИКИ ФИЛЬТРОВ ==========
    
    async handleSearch(query) {
        InventoryState.set('searchQuery', query);
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    async handleCategoryChange(category) {
        InventoryState.set('selectedCategory', category);
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    async handleStatusChange(status) {
        InventoryState.set('selectedStatus', status);
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    async handleSortChange(sort) {
        InventoryState.set('sortBy', sort);
        this.saveFilters();
        
        const products = InventoryState.get('products');
        const sorted = this.applySort(products);
        InventoryState.set('products', sorted);
    }
    
    async handleClearFilters() {
        InventoryState.setMultiple({
            searchQuery: '',
            selectedCategory: '',
            selectedStatus: '',
            sortBy: 'created_at-desc'
        });
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    // ========== ОБРАБОТЧИКИ ВЫДЕЛЕНИЯ ==========
    
    handleSelectAll() {
        const state = InventoryState.getState();
        if (state.isAllSelected) {
            InventoryState.clearSelection();
        } else {
            InventoryState.selectAll();
        }
    }
    
    handleClearSelection() {
        InventoryState.clearSelection();
    }
    
    updateBulkActions() {
        const bulkContainer = this.refs.get('bulkActions');
        const filtersContainer = this.refs.get('filtersContainer');
        
        if (!filtersContainer) return;
        
        const state = InventoryState.getState();
        const hasSelected = state.getSelectedCount() > 0;
        
        if (hasSelected && !bulkContainer) {
            // Создаем панель массовых действий
            const panel = document.createElement('div');
            panel.className = 'bulk-actions-panel';
            panel.setAttribute('data-ref', 'bulkActions');
            panel.innerHTML = `
                <span class="selected-count">Выбрано: ${state.getSelectedCount()}</span>
                <button class="btn-secondary" data-ref="selectAllBtn">
                    ${state.isAllSelected ? 'Снять выделение' : 'Выбрать все'}
                </button>
                ${this.permissions.canDelete ? `
                    <button class="btn-danger" data-ref="bulkDeleteBtn">
                        Удалить выбранные
                    </button>
                ` : ''}
                <button class="btn-ghost" data-ref="clearSelectionBtn">
                    Отменить
                </button>
            `;
            filtersContainer.after(panel);
            
            // Привязываем события
            panel.querySelector('[data-ref="selectAllBtn"]')?.addEventListener('click', () => this.handleSelectAll());
            panel.querySelector('[data-ref="clearSelectionBtn"]')?.addEventListener('click', () => this.handleClearSelection());
            panel.querySelector('[data-ref="bulkDeleteBtn"]')?.addEventListener('click', () => this.handleBulkDelete());
            
        } else if (!hasSelected && bulkContainer) {
            bulkContainer.remove();
        } else if (hasSelected && bulkContainer) {
            // Обновляем счетчик
            const countSpan = bulkContainer.querySelector('.selected-count');
            if (countSpan) {
                countSpan.textContent = `Выбрано: ${state.getSelectedCount()}`;
            }
            const selectAllBtn = bulkContainer.querySelector('[data-ref="selectAllBtn"]');
            if (selectAllBtn) {
                selectAllBtn.textContent = state.isAllSelected ? 'Снять выделение' : 'Выбрать все';
            }
        }
    }
    
    // ========== ДЕЙСТВИЯ С ТОВАРАМИ ==========
    
    openProductForm(product = null) {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'modal-container';
        document.body.appendChild(modalContainer);
        
        const form = new ProductForm(modalContainer, product);
        form.mount();
    }
    
    async handleEdit(id) {
        const state = InventoryState.getState();
        const product = state.products.find(p => p.id === id);
        if (product) {
            this.openProductForm(product);
        }
    }
    
    async handleDelete(id) {
        const state = InventoryState.getState();
        const product = state.products.find(p => p.id === id);
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
            await this.refresh();
        } catch (error) {
            Notification.error('Ошибка при удалении товара');
        }
    }
    
    async handleBulkDelete() {
        const state = InventoryState.getState();
        const count = state.getSelectedCount();
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
            const ids = state.getSelectedIds();
            for (const id of ids) {
                await ProductService.delete(id);
            }
            
            Notification.success(`Удалено ${count} ${this.pluralize(count, 'товар', 'товара', 'товаров')}`);
            InventoryState.clearSelection();
            await this.refresh();
        } catch (error) {
            Notification.error('Ошибка при массовом удалении');
        }
    }
    
    // ========== ЭКСПОРТ ==========
    
    async exportToExcel() {
        try {
            Notification.info('Подготовка экспорта...');
            
            const products = await ProductService.getAll({ forceRefresh: false });
            const filtered = this.applyFilters(products);
            const sorted = this.applySort(filtered);
            
            const csv = this.generateCSV(sorted);
            this.downloadCSV(csv, `inventory_${new Date().toISOString().split('T')[0]}.csv`);
            
            Notification.success(`Экспортировано ${sorted.length} товаров`);
        } catch (error) {
            console.error('[InventoryPage] Export error:', error);
            Notification.error('Ошибка при экспорте');
        }
    }
    
    generateCSV(products) {
        const headers = ['ID', 'Название', 'Категория', 'Цена', 'Себестоимость', 'Статус', 'Дата создания'];
        const rows = products.map(p => [
            p.id,
            p.name,
            getCategoryName(p.category),
            p.price || 0,
            p.cost_price || 0,
            p.status,
            new Date(p.created_at).toLocaleDateString('ru-RU')
        ]);
        
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
        
        return '\uFEFF' + [headerRow, ...dataRows].join('\n');
    }
    
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
    
    // ========== ФИЛЬТРЫ В LOCALSTORAGE ==========
    
    saveFilters() {
        const state = InventoryState.getState();
        const filters = {
            searchQuery: state.searchQuery,
            selectedCategory: state.selectedCategory,
            selectedStatus: state.selectedStatus,
            sortBy: state.sortBy
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    }
    
    restoreFilters() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const filters = JSON.parse(stored);
                InventoryState.setMultiple(filters);
            }
        } catch (error) {
            console.error('[InventoryPage] Restore filters error:', error);
        }
    }
    
    // ========== УТИЛИТЫ ==========
    
    pluralize(count, one, two, five) {
        const n = Math.abs(count) % 100;
        const n1 = n % 10;
        
        if (n > 10 && n < 20) return five;
        if (n1 > 1 && n1 < 5) return two;
        if (n1 === 1) return one;
        return five;
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        
        this.saveFilters();
        
        this.table?.destroy();
        this.filters?.destroy();
        this.stats?.destroy();
    }
}
