/**
 * Страница отчетов
 * Статистика по продажам, товарам и прибыли
 * 
 * @module ReportsPage
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ReportService } from '../../services/ReportService.js';
import { PermissionManager } from '../../core/PermissionManager.js';
import { getCategoryName } from '../../utils/categorySchema.js';

export class ReportsPage extends BaseComponent {
    async render() {
        this.showLoader();
        
        const canViewFull = PermissionManager.can('reports:view');
        
        let stats = { 
            inStock: 0, 
            sold: 0, 
            totalRevenue: 0, 
            inventoryValue: 0,
            totalCost: 0,
            totalProfit: 0
        };
        let categoryStats = {};
        
        try {
            stats = await ReportService.getTotalStats();
            categoryStats = await ReportService.getSalesByCategory();
        } catch (error) {
            this.publish('app:error', error);
        }

        const margin = stats.totalRevenue > 0 
            ? ((stats.totalProfit / stats.totalRevenue) * 100).toFixed(1)
            : 0;

        return `
            <div class="reports-page">
                <h2>Отчеты</h2>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>Товаров на складе</h3>
                        <div class="stat-value">${stats.inStock}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Продано товаров</h3>
                        <div class="stat-value">${stats.sold}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Выручка</h3>
                        <div class="stat-value">${this.formatMoney(stats.totalRevenue)}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Стоимость склада</h3>
                        <div class="stat-value">${this.formatMoney(stats.inventoryValue)}</div>
                    </div>
                </div>
                
                ${canViewFull ? `
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h3>Себестоимость продаж</h3>
                            <div class="stat-value">${this.formatMoney(stats.totalCost)}</div>
                        </div>
                        <div class="stat-card profit-card">
                            <h3>Чистая прибыль</h3>
                            <div class="stat-value ${stats.totalProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                                ${this.formatMoney(stats.totalProfit)}
                            </div>
                            <small>Маржа: ${margin}%</small>
                        </div>
                    </div>
                ` : ''}
                
                ${canViewFull ? this.renderCategories(categoryStats) : ''}
            </div>
        `;
    }

    renderCategories(stats) {
        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        
        return `
            <div class="categories-section">
                <h3>Продажи по категориям</h3>
                <div class="categories-list">
                    ${Object.entries(stats).map(([cat, count]) => `
                        <div class="category-item">
                            <span>${getCategoryName(cat)}</span>
                            <span>${count} (${((count/total)*100).toFixed(1)}%)</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    attachEvents() {
        // Пока нет интерактива
    }
}
