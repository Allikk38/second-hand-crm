import { BaseComponent } from '../../core/BaseComponent.js';
import { ReportService } from '../../services/ReportService.js';
import { PermissionManager } from '../../core/PermissionManager.js';

export class ReportsPage extends BaseComponent {
    async render() {
        this.showLoader();
        
        const canViewFull = PermissionManager.can('reports:view');
        
        let stats = { inStock: 0, sold: 0, totalRevenue: 0, inventoryValue: 0 };
        let categoryStats = {};
        
        try {
            stats = await ReportService.getTotalStats();
            categoryStats = await ReportService.getSalesByCategory();
        } catch (error) {
            this.publish('app:error', error);
        }

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
                            <span>${this.getCategoryName(cat)}</span>
                            <span>${count} (${((count/total)*100).toFixed(1)}%)</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    getCategoryName(cat) {
        const names = {
            clothes: 'Одежда',
            toys: 'Игрушки',
            dishes: 'Посуда',
            other: 'Другое'
        };
        return names[cat] || cat;
    }

    attachEvents() {
        // Пока нет интерактива
    }
}
