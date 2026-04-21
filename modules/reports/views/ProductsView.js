/**
 * Products View Component
 * 
 * Представление отчета по товарам.
 * Включает сводку, топ продаваемых, высокомаржинальных и залежавшихся товаров.
 * 
 * @module ProductsView
 * @version 1.0.0
 */

import { BaseComponent } from '../../../core/BaseComponent.js';
import { formatMoney, formatNumber } from '../../../utils/formatters.js';

export class ProductsView extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            data: null,
            ...options
        };
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const data = this.options.data;
        if (!data) return this.renderEmptyState();
        
        const summary = data.summary || {};
        const topProducts = data.topProducts || [];
        const highMarginProducts = data.highMarginProducts || [];
        const slowMovingProducts = data.slowMovingProducts || [];
        
        return `
            <div class="products-report-view">
                <div class="report-summary">
                    <div class="summary-card">
                        <span class="label">Всего товаров</span>
                        <span class="value">${formatNumber(summary.total || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">В наличии</span>
                        <span class="value">${formatNumber(summary.inStock || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Продано</span>
                        <span class="value">${formatNumber(summary.sold || 0)}</span>
                    </div>
                    <div class="summary-card">
                        <span class="label">Стоимость склада</span>
                        <span class="value">${formatMoney(summary.totalValue || 0)}</span>
                    </div>
                </div>
                
                <div class="two-columns">
                    <div class="card">
                        <h4>🏆 Самые продаваемые</h4>
                        <div class="top-list">
                            ${topProducts.slice(0, 10).map((p, i) => `
                                <div class="top-item">
                                    <span class="rank">#${i + 1}</span>
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="value">${p.quantity} шт.</span>
                                    <span class="amount">${formatMoney(p.revenue)}</span>
                                </div>
                            `).join('')}
                            ${topProducts.length === 0 ? '<div class="empty-message">Нет данных</div>' : ''}
                        </div>
                    </div>
                    
                    <div class="card">
                        <h4>💎 Высокая маржинальность</h4>
                        <div class="top-list">
                            ${highMarginProducts.slice(0, 10).map((p, i) => `
                                <div class="top-item">
                                    <span class="rank">#${i + 1}</span>
                                    <span class="name">${this.escapeHtml(p.name)}</span>
                                    <span class="value">${p.margin?.toFixed(0) || 0}%</span>
                                    <span class="amount">${formatMoney(p.price)}</span>
                                </div>
                            `).join('')}
                            ${highMarginProducts.length === 0 ? '<div class="empty-message">Нет данных</div>' : ''}
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <h4>🐌 Залежавшиеся товары</h4>
                    <div class="slow-products">
                        ${slowMovingProducts.slice(0, 10).map(p => `
                            <div class="slow-item">
                                <span class="name">${this.escapeHtml(p.name)}</span>
                                <span class="days">${p.daysInStock} дней</span>
                                <span class="price">${formatMoney(p.price)}</span>
                            </div>
                        `).join('')}
                        ${slowMovingProducts.length === 0 ? '<div class="empty-message">Нет залежавшихся товаров</div>' : ''}
                    </div>
                </div>
            </div>
        `;
    }
    
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <p>Нет данных о товарах</p>
            </div>
        `;
    }
}
