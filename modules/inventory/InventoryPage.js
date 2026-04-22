// ========================================
// FILE: ./modules/inventory/InventoryPage.js
// ========================================

/**
 * Inventory Page Controller
 * 
 * Контроллер страницы склада. Координирует работу компонентов:
 * - InventoryTable (таблица)
 * - InventoryFilters (фильтры)
 * - InventoryStats (статистика)
 * 
 * Архитектурные решения:
 * - Полный переход на глобальный `Store`.
 * - Удалена зависимость от легаси `InventoryState`.
 * - Чистые функции для фильтрации и сортировки.
 * - Делегирование загрузки данных `ProductService`.
 * 
 * @module InventoryPage
 * @version 6.0.0
 * @changes
 * - Полностью удален `InventoryState`.
 * - Упрощена логика загрузки и фильтрации.
 * - Убраны методы сохранения фильтров (доверие плагину Store).
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

// Ленивая загрузка ProductService
let ProductService = null;
async function getProductService() {
    if (!ProductService) {
        const module = await import('../../services/ProductService.js');
        ProductService = module.ProductService;
    }
    return ProductService;
}

// ========== ЧИСТЫЕ ФУНКЦИИ ==========

function applyFilters(products, filters) {
    const { searchQuery, selectedCategory, selectedStatus } = filters;
    
    return products.filter(p => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const nameMatch = p.name.toLowerCase().includes(q);
            const attrMatch = p.attributes && Object.values(p.attributes).some(
                v => v && v.toString().toLowerCase().includes(q)
            );
            if (!nameMatch && !attrMatch) return false;
        }
        
        if (selectedCategory && p.category !== selectedCategory) return false;
        if (selectedStatus && p.status !== selectedStatus) return false;
        
        return true;
    });
}

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
            default:
                aVal = new Date(a.created_at || 0).getTime();
                bVal = new Date(b.created_at || 0).getTime();
        }
        
        return direction === 'asc' 
            ? (aVal > bVal ? 1 : aVal < bVal ? -1 : 0)
            : (aVal < bVal ? 1 : aVal > bVal ? -1 : 0);
    });
}

export class InventoryPage extends BaseComponent {
    constructor(container) {
        super(container);
        
        this.table = null;
        this.filters = null;
        this.stats = null;
        
        this.permissions = {
            canCreate: false,
            canEdit: false,
            canDelete: false
        };
        
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        this.showLoader();
        
        await this.waitForPermissions();
        await this.loadProducts();
        await this.updateCategories();
        
        const inventory = Store.state.inventory;
        const selectedCount = inventory.selectedIds.size;
        
        return `
            <div class="inventory-page">
                <div class="page-header">
                    <div class="header-left">
                        <h2>Склад</h2>
                        <div data-ref="statsContainer"></div>
                    </div>
                    <div class="header-right">
                        ${this.permissions.canCreate ? `
                            <button class="btn-primary" data-ref="addProductBtn">+ Добавить товар</button>
                        ` : ''}
                        <button class="btn-secondary" data-ref="exportBtn">📊 Экспорт</button>
                    </div>
                </div>
                
                <div data-ref="filtersContainer"></div>
                
                ${selectedCount > 0 ? `
                    <div class="bulk-actions-panel" data-ref="bulkActions">
                        <span class="selected-count">Выбрано: ${selectedCount}</span>
                        <button class="btn-secondary" data-ref="selectAllBtn">
                            ${inventory.isAllSelected ? 'Снять выделение' : 'Выбрать все'}
                        </button>
                        ${this.permissions.canDelete ? `
                            <button class="btn-danger" data-ref="bulkDeleteBtn">Удалить выбранные</button>
                        ` : ''}
                        <button class="btn-ghost" data-ref="clearSelectionBtn">Отменить</button>
                    </div>
                ` : ''}
                
                <div data-ref="tableContainer" class="table-container"></div>
            </div>
        `;
    }
    
    async afterRender() {
        // Статистика
        const statsContainer = this.refs.get('statsContainer');
        if (statsContainer) {
            this.stats = new InventoryStats(statsContainer);
            await this.stats.mount();
        }
        
        // Фильтры
        const filtersContainer = this.refs.get('filtersContainer');
        if (filtersContainer) {
            this.filters = new InventoryFilters(filtersContainer, {
                onSearch: (q) => this.handleFilterChange('searchQuery', q),
                onCategoryChange: (c) => this.handleFilterChange('selectedCategory', c),
                onStatusChange: (s) => this.handleFilterChange('selectedStatus', s),
                onSortChange: (s) => this.handleFilterChange('sortBy', s),
                onClearFilters: () => this.handleClearFilters()
            });
            await this.filters.mount();
        }
        
        // Таблица
        const tableContainer = this.refs.get('tableContainer');
        if (tableContainer) {
            this.table = new InventoryTable(tableContainer, {
                onEdit: (id) => this.handleEdit(id),
                onDelete: (id) => this.handleDelete(id),
                onLoadMore: () => this.loadMore()
            });
            await this.table.mount();
        }
        
        this.attachEvents();
        this.subscribeToEvents();
    }
    
    // ========== ЗАГРУЗКА ДАННЫХ ==========
    
    async waitForPermissions() {
        if (PermissionManager.isLoaded()) {
            this.updatePermissions();
            return;
        }
        
        return new Promise((resolve) => {
            const unsubscribe = this.subscribe('permissions:loaded', () => {
                this.updatePermissions();
                unsubscribe();
                resolve();
            });
            
            setTimeout(() => {
                unsubscribe();
                this.updatePermissions();
                resolve();
            }, 3000);
        });
    }
    
    updatePermissions() {
        this.permissions = {
            canCreate: PermissionManager.can('products:create'),
            canEdit: PermissionManager.can('products:edit'),
            canDelete: PermissionManager.can('products:delete')
        };
    }
    
    async loadProducts(reset = true) {
        const inventory = Store.state.inventory;
        
        if (inventory.isLoading) return;
        inventory.isLoading = true;
        
        try {
            const ProductService = await getProductService();
            const options = {
                limit: PAGE_SIZE,
                offset: reset ? 0 : inventory.page * PAGE_SIZE
            };
            
            let products = await ProductService.getAll(options);
            
            const filters = {
                searchQuery: inventory.searchQuery,
                selectedCategory: inventory.selectedCategory,
                selectedStatus: inventory.selectedStatus
            };
            
            products = applyFilters(products, filters);
            products = applySort(products, inventory.sortBy);
            
            if (reset) {
                inventory.products = products;
                inventory.page = 1;
            } else {
                inventory.products = [...inventory.products, ...products];
                inventory.page++;
            }
            
            inventory.hasMore = products.length === PAGE_SIZE;
            inventory.filteredCount = products.length;
            
        } catch (error) {
            console.error('[InventoryPage] Load error:', error);
            Notification.error('Ошибка при загрузке товаров');
        } finally {
            inventory.isLoading = false;
        }
    }
    
    async loadMore() {
        await this.loadProducts(false);
    }
    
    async updateCategories() {
        try {
            const ProductService = await getProductService();
            const products = await ProductService.getAll({ forceRefresh: false });
            
            const counts = new Map();
            products.forEach(p => {
                const cat = p.category || 'other';
                counts.set(cat, (counts.get(cat) || 0) + 1);
            });
            
            const categories = Array.from(counts.entries())
                .map(([value, count]) => ({
                    value,
                    label: getCategoryName(value),
                    count
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
            
            Store.state.inventory.categories = categories;
            
        } catch (error) {
            console.error('[InventoryPage] Categories error:', error);
        }
    }
    
    // ========== ОБРАБОТЧИКИ ФИЛЬТРОВ ==========
    
    async handleFilterChange(key, value) {
        Store.state.inventory[key] = value;
        await this.loadProducts(true);
        this.table?.clearSelection();
    }
    
    async handleClearFilters() {
        Store.batch(() => {
            const inv = Store.state.inventory;
            inv.searchQuery = '';
            inv.selectedCategory = '';
            inv.selectedStatus = '';
            inv.sortBy = 'created_at-desc';
        });
        
        await this.loadProducts(true);
        this.table?.clearSelection();
    }
    
    // ========== ДЕЙСТВИЯ С ТОВАРАМИ ==========
    
    openProductForm(product = null) {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'modal-container';
        document.body.appendChild(modalContainer);
        
        const form = new ProductForm(modalContainer, product);
        form.mount();
    }
    
    handleEdit(id) {
        const product = Store.state.inventory.products.find(p => p.id === id);
        if (product) this.openProductForm(product);
    }
    
    async handleDelete(id) {
        const product = Store.state.inventory.products.find(p => p.id === id);
        if (!product) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Удаление товара',
            message: `Удалить "${product.name}"?`,
            confirmText: 'Удалить',
            type: 'danger'
        });
        
        if (!confirmed) return;
        
        try {
            const ProductService = await getProductService();
            await ProductService.delete(id);
            ProductService.clearCache();
            
            Notification.success(`Товар "${product.name}" удален`);
            await this.loadProducts(true);
            await this.stats?.update();
            
        } catch (error) {
            Notification.error('Ошибка при удалении товара');
        }
    }
    
    async handleBulkDelete() {
        const ids = Store.getInventorySelectedIds();
        if (ids.length === 0) return;
        
        const confirmed = await ConfirmDialog.show({
            title: 'Массовое удаление',
            message: `Удалить ${ids.length} товаров?`,
            confirmText: 'Удалить',
            type: 'danger'
        });
        
        if (!confirmed) return;
        
        try {
            const ProductService = await getProductService();
            
            for (const id of ids) {
                await ProductService.delete(id);
            }
            
            ProductService.clearCache();
            Store.clearInventorySelection();
            
            Notification.success(`Удалено ${ids.length} товаров`);
            await this.loadProducts(true);
            await this.stats?.update();
            
        } catch (error) {
            Notification.error('Ошибка при массовом удалении');
        }
    }
    
    async exportToExcel() {
        try {
            const ProductService = await getProductService();
            const products = await ProductService.getAll();
            
            const filters = {
                searchQuery: Store.state.inventory.searchQuery,
                selectedCategory: Store.state.inventory.selectedCategory,
                selectedStatus: Store.state.inventory.selectedStatus
            };
            
            let filtered = applyFilters(products, filters);
            filtered = applySort(filtered, Store.state.inventory.sortBy);
            
            const csv = this.generateCSV(filtered);
            const filename = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
            
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            URL.revokeObjectURL(link.href);
            
            Notification.success(`Экспортировано ${filtered.length} товаров`);
            
        } catch (error) {
            Notification.error('Ошибка при экспорте');
        }
    }
    
    generateCSV(products) {
        const headers = ['ID', 'Название', 'Категория', 'Цена', 'Себестоимость', 'Статус'];
        const rows = products.map(p => [
            p.id,
            p.name,
            getCategoryName(p.category),
            p.price || 0,
            p.cost_price || 0,
            p.status
        ]);
        
        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(';') || str.includes('"')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        
        return [headers.map(escape).join(';'), ...rows.map(r => r.map(escape).join(';'))].join('\n');
    }
    
    // ========== ПОДПИСКИ ==========
    
    attachEvents() {
        this.addDomListener('addProductBtn', 'click', () => this.openProductForm());
        this.addDomListener('exportBtn', 'click', () => this.exportToExcel());
        this.addDomListener('selectAllBtn', 'click', () => this.handleSelectAll());
        this.addDomListener('clearSelectionBtn', 'click', () => this.handleClearSelection());
        this.addDomListener('bulkDeleteBtn', 'click', () => this.handleBulkDelete());
    }
    
    handleSelectAll() {
        const inventory = Store.state.inventory;
        if (inventory.isAllSelected) {
            Store.clearInventorySelection();
        } else {
            Store.selectAllInventory();
        }
        this.updateBulkActions();
    }
    
    handleClearSelection() {
        Store.clearInventorySelection();
        this.updateBulkActions();
    }
    
    updateBulkActions() {
        this.update();
    }
    
    subscribeToEvents() {
        this.unsubscribers.push(
            this.subscribe('product:created', () => this.refresh()),
            this.subscribe('product:updated', () => this.refresh()),
            this.subscribe('product:deleted', () => this.refresh()),
            
            Store.subscribe('inventory.selectedIds', () => this.updateBulkActions()),
            Store.subscribe('inventory.isAllSelected', () => this.updateBulkActions())
        );
    }
    
    async refresh() {
        await this.loadProducts(true);
        await this.stats?.update();
        await this.updateCategories();
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(u => u());
        
        this.table?.destroy();
        this.filters?.destroy();
        this.stats?.destroy();
    }
}
