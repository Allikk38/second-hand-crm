/**
 * Inventory Page Controller
 * 
 * Контроллер страницы склада. Координирует работу компонентов:
 * - InventoryTable (таблица)
 * - InventoryFilters (фильтры)
 * - InventoryStats (статистика)
 * 
 * В новой архитектуре:
 * - Использует единый Store вместо InventoryState
 * - Прямое реактивное связывание через Store.state
 * - Чистые функции для фильтрации и сортировки
 * - Автоматическое сохранение фильтров через Store плагин
 * 
 * @module InventoryPage
 * @version 5.0.0
 * @changes
 * - Полный переход на Store (удален InventoryState)
 * - Упрощена логика загрузки данных
 * - Фильтрация и сортировка вынесены в чистые функции
 * - Добавлена поддержка пакетных обновлений через Store.batch()
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { InventoryTable } from './InventoryTable.js';
import { InventoryFilters } from './InventoryFilters.js';
import { InventoryStats } from './InventoryStats.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { ProductForm } from './ProductForm.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { Notification } from '../common/Notification.js';
import { getCategoryName } from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const PAGE_SIZE = 20;
const STORAGE_KEY = 'inventory_filters';
const CACHE_BUST = 'v=5.0.0';

// Ленивая загрузка ProductService с cache-busting
let ProductService = null;
async function getProductService() {
    if (!ProductService) {
        const module = await import(`../../services/ProductService.js?${CACHE_BUST}`);
        ProductService = module.ProductService;
    }
    return ProductService;
}

// ========== ЧИСТЫЕ ФУНКЦИИ ФИЛЬТРАЦИИ И СОРТИРОВКИ ==========

/**
 * Применяет фильтры к массиву товаров
 * @param {Array} products - Массив товаров
 * @param {Object} filters - Объект фильтров
 * @returns {Array} Отфильтрованный массив
 */
function applyFilters(products, filters) {
    const { searchQuery, selectedCategory, selectedStatus } = filters;
    
    return products.filter(p => {
        // Поиск по названию и атрибутам
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const nameMatch = p.name.toLowerCase().includes(query);
            const attrMatch = p.attributes && Object.values(p.attributes).some(
                v => v && v.toString().toLowerCase().includes(query)
            );
            if (!nameMatch && !attrMatch) return false;
        }
        
        // Фильтр по категории
        if (selectedCategory && p.category !== selectedCategory) {
            return false;
        }
        
        // Фильтр по статусу
        if (selectedStatus && p.status !== selectedStatus) {
            return false;
        }
        
        return true;
    });
}

/**
 * Применяет сортировку к массиву товаров
 * @param {Array} products - Массив товаров
 * @param {string} sortBy - Строка сортировки ('created_at-desc')
 * @returns {Array} Отсортированный массив
 */
function applySort(products, sortBy) {
    const [field, direction] = sortBy.split('-');
    
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
 * Группирует товары по категориям и подсчитывает количество
 * @param {Array} products - Массив товаров
 * @returns {Array} Массив категорий с количеством
 */
function buildCategoriesFromProducts(products) {
    const categoryCounts = new Map();
    
    products.forEach(p => {
        const cat = p.category || 'other';
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    });
    
    return Array.from(categoryCounts.entries())
        .map(([value, count]) => ({
            value,
            label: getCategoryName(value),
            count
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export class InventoryPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        // Компоненты
        this.table = null;
        this.filters = null;
        this.stats = null;
        
        // Права (проверяем после загрузки)
        this.permissions = {
            canCreate: false,
            canEdit: false,
            canDelete: false
        };
        
        // Отписки
        this.unsubscribers = [];
        
        // Флаг первичной загрузки
        this.isFirstLoad = true;
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        // Ждем загрузку прав
        await this.waitForPermissions();
        
        // Восстанавливаем фильтры из localStorage
        this.restoreFilters();
        
        // Загружаем начальные данные
        await this.loadProducts(true);
        
        // Строим категории для фильтра
        await this.updateCategories();
        
        const inventory = Store.state.inventory;
        const selectedCount = inventory.selectedIds.size;
        const hasSelected = selectedCount > 0;
        
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
                            📊 Экспорт
                        </button>
                    </div>
                </div>
                
                <!-- Фильтры -->
                <div data-ref="filtersContainer"></div>
                
                <!-- Массовые действия -->
                ${hasSelected ? `
                    <div class="bulk-actions-panel" data-ref="bulkActions">
                        <span class="selected-count">Выбрано: ${selectedCount}</span>
                        <button class="btn-secondary" data-ref="selectAllBtn">
                            ${inventory.isAllSelected ? 'Снять выделение' : 'Выбрать все'}
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
    
    /**
     * Ожидает загрузки прав доступа
     */
    async waitForPermissions() {
        // Если права уже загружены
        if (PermissionManager.isLoaded()) {
            this.updatePermissions();
            return;
        }
        
        // Ждем события загрузки
        return new Promise((resolve) => {
            const unsubscribe = this.subscribe('permissions:loaded', () => {
                this.updatePermissions();
                unsubscribe();
                resolve();
            });
            
            // Таймаут на случай ошибки
            setTimeout(() => {
                unsubscribe();
                this.updatePermissions();
                resolve();
            }, 3000);
        });
    }
    
    /**
     * Обновляет права доступа
     */
    updatePermissions() {
        this.permissions = {
            canCreate: PermissionManager.can('products:create') || PermissionManager.can('products:2026-04-21'),
            canEdit: PermissionManager.can('products:edit'),
            canDelete: PermissionManager.can('products:delete')
        };
    }
    
    async attachEvents() {
        // Монтируем статистику
        const statsContainer = this.refs.get('statsContainer');
        if (statsContainer) {
            this.stats = new InventoryStats(statsContainer);
            await this.stats.mount();
        }
        
        // Монтируем фильтры
        const filtersContainer = this.refs.get('filtersContainer');
        if (filtersContainer) {
            this.filters = new InventoryFilters(filtersContainer, {
                onSearch: (query) => this.handleSearch(query),
                onCategoryChange: (category) => this.handleCategoryChange(category),
                onStatusChange: (status) => this.handleStatusChange(status),
                onSortChange: (sort) => this.handleSortChange(sort),
                onClearFilters: () => this.handleClearFilters()
            });
            await this.filters.mount();
        }
        
        // Монтируем таблицу
        const tableContainer = this.refs.get('tableContainer');
        if (tableContainer) {
            this.table = new InventoryTable(tableContainer, {
                onEdit: (id) => this.handleEdit(id),
                onDelete: (id) => this.handleDelete(id),
                onLoadMore: () => this.loadMore()
            });
            await this.table.mount();
        }
        
        // Кнопки
        this.addDomListener('addProductBtn', 'click', () => this.openProductForm());
        this.addDomListener('exportBtn', 'click', () => this.exportToExcel());
        this.addDomListener('selectAllBtn', 'click', () => this.handleSelectAll());
        this.addDomListener('clearSelectionBtn', 'click', () => this.handleClearSelection());
        this.addDomListener('bulkDeleteBtn', 'click', () => this.handleBulkDelete());
        
        // Подписка на события сервиса через EventBus
        this.unsubscribers.push(
            this.subscribe('product:created', () => this.refresh()),
            this.subscribe('product:updated', () => this.refresh()),
            this.subscribe('product:deleted', () => this.refresh()),
            this.subscribe('product:bulk-updated', () => this.refresh())
        );
        
        // Подписка на изменения Store для инвентаря
        this.unsubscribers.push(
            Store.subscribe('inventory.selectedIds', () => this.updateBulkActions()),
            Store.subscribe('inventory.isAllSelected', () => this.updateBulkActions())
        );
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    async loadProducts(reset = false) {
        const inventory = Store.state.inventory;
        
        // Предотвращаем параллельную загрузку
        if (inventory.isLoading) return;
        
        if (reset) {
            Store.batch(() => {
                inventory.page = 0;
                inventory.hasMore = true;
            });
            Store.clearInventorySelection();
        }
        
        inventory.isLoading = true;
        
        try {
            const ProductService = await getProductService();
            const options = {
                limit: PAGE_SIZE,
                offset: reset ? 0 : inventory.page * PAGE_SIZE
            };
            
            let products = await ProductService.getAll(options);
            
            // Применяем фильтрацию и сортировку (чистые функции)
            const filters = {
                searchQuery: inventory.searchQuery,
                selectedCategory: inventory.selectedCategory,
                selectedStatus: inventory.selectedStatus
            };
            
            products = applyFilters(products, filters);
            products = applySort(products, inventory.sortBy);
            
            if (reset) {
                inventory.products = products;
            } else {
                inventory.products = [...inventory.products, ...products];
            }
            
            inventory.hasMore = products.length === PAGE_SIZE;
            inventory.page = (reset ? 0 : inventory.page) + 1;
            
            // Обновляем счетчик отфильтрованных товаров
            await this.updateFilteredCount();
            
            // Если это первая загрузка, сохраняем фильтры
            if (this.isFirstLoad) {
                this.isFirstLoad = false;
            }
            
        } catch (error) {
            console.error('[InventoryPage] Load error:', error);
            Notification.error('Ошибка при загрузке товаров. Проверьте подключение.');
            throw error;
        } finally {
            inventory.isLoading = false;
        }
    }
    
    async loadMore() {
        await this.loadProducts(false);
    }
    
    async refresh() {
        try {
            await this.loadProducts(true);
            await this.stats?.update();
            await this.updateCategories();
        } catch (error) {
            console.error('[InventoryPage] Refresh error:', error);
        }
    }
    
    async updateCategories() {
        try {
            const ProductService = await getProductService();
            const products = await ProductService.getAll({ forceRefresh: false });
            
            const categories = buildCategoriesFromProducts(products);
            Store.state.inventory.categories = categories;
            
            this.filters?.updateCategories(categories);
        } catch (error) {
            console.error('[InventoryPage] Update categories error:', error);
        }
    }
    
    async updateFilteredCount() {
        try {
            const ProductService = await getProductService();
            const products = await ProductService.getAll({ forceRefresh: false });
            
            const filters = {
                searchQuery: Store.state.inventory.searchQuery,
                selectedCategory: Store.state.inventory.selectedCategory,
                selectedStatus: Store.state.inventory.selectedStatus
            };
            
            const filtered = applyFilters(products, filters);
            Store.state.inventory.filteredCount = filtered.length;
        } catch (error) {
            console.error('[InventoryPage] Update filtered count error:', error);
        }
    }
    
    // ========== ОБРАБОТЧИКИ ФИЛЬТРОВ ==========
    
    async handleSearch(query) {
        Store.state.inventory.searchQuery = query;
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    async handleCategoryChange(category) {
        Store.state.inventory.selectedCategory = category;
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    async handleStatusChange(status) {
        Store.state.inventory.selectedStatus = status;
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    async handleSortChange(sort) {
        Store.state.inventory.sortBy = sort;
        this.saveFilters();
        
        const inventory = Store.state.inventory;
        const sorted = applySort(inventory.products, sort);
        inventory.products = sorted;
    }
    
    async handleClearFilters() {
        Store.batch(() => {
            const inventory = Store.state.inventory;
            inventory.searchQuery = '';
            inventory.selectedCategory = '';
            inventory.selectedStatus = '';
            inventory.sortBy = 'created_at-desc';
        });
        
        this.saveFilters();
        await this.loadProducts(true);
    }
    
    // ========== ОБРАБОТЧИКИ ВЫДЕЛЕНИЯ ==========
    
    handleSelectAll() {
        const inventory = Store.state.inventory;
        
        if (inventory.isAllSelected) {
            Store.clearInventorySelection();
        } else {
            Store.selectAllInventory();
        }
    }
    
    handleClearSelection() {
        Store.clearInventorySelection();
    }
    
    updateBulkActions() {
        this.update();
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
        const product = Store.state.inventory.products.find(p => p.id === id);
        if (product) {
            this.openProductForm(product);
        }
    }
    
    async handleDelete(id) {
        const product = Store.state.inventory.products.find(p => p.id === id);
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
            const ProductService = await getProductService();
            ProductService.clearCache();
            
            await ProductService.delete(id);
            Notification.success(`Товар "${product.name}" удален`);
            
            ProductService.clearCache();
            
            await this.refresh();
        } catch (error) {
            console.error('[InventoryPage] Delete error:', error);
            Notification.error('Ошибка при удалении товара');
        }
    }
    
    async handleBulkDelete() {
        const selectedCount = Store.getInventorySelectedCount();
        if (selectedCount === 0) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Массовое удаление',
            message: `Вы уверены, что хотите удалить ${selectedCount} товар(ов)?`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'danger'
        });
        
        if (!confirmed) return;
        
        try {
            const ProductService = await getProductService();
            ProductService.clearCache();
            
            const ids = Store.getInventorySelectedIds();
            for (const id of ids) {
                await ProductService.delete(id);
            }
            
            Notification.success(`Удалено ${selectedCount} товаров`);
            Store.clearInventorySelection();
            
            ProductService.clearCache();
            
            await this.refresh();
        } catch (error) {
            console.error('[InventoryPage] Bulk delete error:', error);
            Notification.error('Ошибка при массовом удалении');
        }
    }
    
    // ========== ЭКСПОРТ ==========
    
    async exportToExcel() {
        try {
            Notification.info('Подготовка экспорта...');
            
            const ProductService = await getProductService();
            const products = await ProductService.getAll({ forceRefresh: false });
            
            const inventory = Store.state.inventory;
            const filters = {
                searchQuery: inventory.searchQuery,
                selectedCategory: inventory.selectedCategory,
                selectedStatus: inventory.selectedStatus
            };
            
            const filtered = applyFilters(products, filters);
            const sorted = applySort(filtered, inventory.sortBy);
            
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
        const inventory = Store.state.inventory;
        const filters = {
            searchQuery: inventory.searchQuery,
            selectedCategory: inventory.selectedCategory,
            selectedStatus: inventory.selectedStatus,
            sortBy: inventory.sortBy
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    }
    
    restoreFilters() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const filters = JSON.parse(stored);
                const inventory = Store.state.inventory;
                
                Store.batch(() => {
                    inventory.searchQuery = filters.searchQuery || '';
                    inventory.selectedCategory = filters.selectedCategory || '';
                    inventory.selectedStatus = filters.selectedStatus || '';
                    inventory.sortBy = filters.sortBy || 'created_at-desc';
                });
            }
        } catch (error) {
            console.error('[InventoryPage] Restore filters error:', error);
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        
        this.saveFilters();
        
        this.table?.destroy();
        this.filters?.destroy();
        this.stats?.destroy();
    }
}
