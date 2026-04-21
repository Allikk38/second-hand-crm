/**
 * Inventory Stats Component
 * 
 * Компонент отображения статистики склада.
 * Показывает общее количество товаров, в наличии, продано и общую стоимость.
 * 
 * В новой архитектуре:
 * - Использует единый Store вместо InventoryState
 * - Реактивное обновление через Store.subscribe
 * - Прямой доступ к данным через Store.state.inventory
 * - Статистика автоматически обновляется при изменении товаров
 * 
 * @module InventoryStats
 * @version 5.0.0
 * @changes
 * - Полный переход на Store (удален InventoryState)
 * - Упрощена логика обновления через реактивные подписки
 * - Добавлена поддержка принудительного обновления из ProductService
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { Store } from '../../core/Store.js';
import { formatMoney, formatNumber } from '../../utils/formatters.js';

// Ленивая загрузка ProductService
let ProductService = null;
async function getProductService() {
    if (!ProductService) {
        const module = await import('../../services/ProductService.js');
        ProductService = module.ProductService;
    }
    return ProductService;
}

export class InventoryStats extends BaseComponent {
    constructor(container) {
        super(container);
        this.stats = {
            total: 0,
            inStock: 0,
            sold: 0,
            reserved: 0,
            totalValue: 0
        };
        this.unsubscribers = [];
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        await this.calculateStats();
        
        return `
            <div class="stats-badge">
                <span data-ref="totalCount">${formatNumber(this.stats.total)} всего</span>
                <span class="badge-success" data-ref="inStockCount">${formatNumber(this.stats.inStock)} в наличии</span>
                <span class="badge-secondary" data-ref="soldCount">${formatNumber(this.stats.sold)} продано</span>
                <span class="badge-value" data-ref="totalValue">${formatMoney(this.stats.totalValue)}</span>
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Подписка на изменения товаров и счетчика в Store
        this.unsubscribers.push(
            Store.subscribe('inventory.products', () => this.refreshFromStore()),
            Store.subscribe('inventory.filteredCount', () => this.refreshFromStore())
        );
    }
    
    // ========== ВЫЧИСЛЕНИЕ СТАТИСТИКИ ==========
    
    /**
     * Рассчитывает статистику из ProductService (точные данные)
     */
    async calculateStats() {
        try {
            const ProductService = await getProductService();
            const stats = await ProductService.getStats();
            
            this.stats = {
                total: stats.total,
                inStock: stats.inStock,
                sold: stats.sold,
                reserved: stats.reserved,
                totalValue: stats.totalValue
            };
        } catch (error) {
            console.error('[InventoryStats] Calculate error:', error);
            
            // Fallback на локальные данные из Store
            this.calculateStatsFromStore();
        }
    }
    
    /**
     * Рассчитывает статистику на основе данных в Store (быстро, но может быть неполным)
     */
    calculateStatsFromStore() {
        const products = Store.state.inventory.products;
        
        this.stats = {
            total: products.length,
            inStock: products.filter(p => p.status === 'in_stock').length,
            sold: products.filter(p => p.status === 'sold').length,
            reserved: products.filter(p => p.status === 'reserved').length,
            totalValue: products
                .filter(p => p.status === 'in_stock')
                .reduce((sum, p) => sum + (p.price || 0), 0)
        };
    }
    
    /**
     * Обновляет статистику из Store (без запроса к серверу)
     */
    refreshFromStore() {
        this.calculateStatsFromStore();
        this.updateDisplay();
    }
    
    /**
     * Обновляет отображение статистики
     */
    updateDisplay() {
        const totalEl = this.refs.get('totalCount');
        const inStockEl = this.refs.get('inStockCount');
        const soldEl = this.refs.get('soldCount');
        const valueEl = this.refs.get('totalValue');
        
        if (totalEl) totalEl.textContent = `${formatNumber(this.stats.total)} всего`;
        if (inStockEl) inStockEl.textContent = `${formatNumber(this.stats.inStock)} в наличии`;
        if (soldEl) soldEl.textContent = `${formatNumber(this.stats.sold)} продано`;
        if (valueEl) valueEl.textContent = formatMoney(this.stats.totalValue);
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    /**
     * Принудительно обновляет статистику (запрос к серверу)
     */
    async update() {
        await this.calculateStats();
        this.updateDisplay();
    }
    
    /**
     * Получает текущую статистику
     * @returns {Object}
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Сбрасывает статистику к нулю
     */
    reset() {
        this.stats = {
            total: 0,
            inStock: 0,
            sold: 0,
            reserved: 0,
            totalValue: 0
        };
        this.updateDisplay();
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
    }
}
