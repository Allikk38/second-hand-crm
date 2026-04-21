/**
 * Inventory Stats Component
 * 
 * Компонент отображения статистики склада.
 * Показывает общее количество товаров, в наличии, продано и общую стоимость.
 * 
 * @module InventoryStats
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { InventoryState } from './inventoryState.js';
import { ProductService } from '../../services/ProductService.js';
import { formatMoney, formatNumber } from '../../utils/formatters.js';

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
        this.unsubscribeState = null;
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
        // Подписка на изменения состояния
        this.unsubscribeState = InventoryState.subscribe(async (changes) => {
            const shouldUpdate = changes.some(c => 
                ['products', 'filteredCount'].includes(c.key)
            );
            if (shouldUpdate) {
                await this.update();
            }
        });
    }
    
    // ========== ВЫЧИСЛЕНИЕ СТАТИСТИКИ ==========
    
    /**
     * Рассчитывает статистику
     */
    async calculateStats() {
        try {
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
            
            // Fallback на локальные данные
            const state = InventoryState.getState();
            const products = state.products;
            
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
     * Принудительно обновляет статистику
     */
    async update() {
        await this.calculateStats();
        this.updateDisplay();
    }
    
    /**
     * Получает текущую статистику
     */
    getStats() {
        return { ...this.stats };
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.unsubscribeState) {
            this.unsubscribeState();
        }
    }
}
