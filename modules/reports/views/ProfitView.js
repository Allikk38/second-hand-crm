/**
 * Profit View Component
 * 
 * Представление отчета по прибыли.
 * Показывает валовую прибыль, маржинальность и ROI.
 * 
 * @module ProfitView
 * @version 1.0.0
 */

import { BaseComponent } from '../../../core/BaseComponent.js';
import { formatMoney, formatPercent } from '../../../utils/formatters.js';

export class ProfitView extends BaseComponent {
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
        
        const grossProfit = data.grossProfit || 0;
        const margin = data.margin || 0;
        const roi = data.roi || 0;
        
        return `
            <div class="profit-report-view">
                <div class="info-message">
                    <span>🔒 Детальный отчет по прибыли доступен в расширенной версии</span>
                </div>
                
                <div class="profit-summary">
                    <div class="profit-card">
                        <h4>Валовая прибыль</h4>
                        <div class="profit-value ${grossProfit >= 0 ? 'positive' : 'negative'}">
                            ${formatMoney(grossProfit)}
                        </div>
                    </div>
                    <div class="profit-card">
                        <h4>Маржинальность</h4>
                        <div class="profit-value ${margin >= 20 ? 'positive' : 'warning'}">
                            ${formatPercent(margin)}
                        </div>
                    </div>
                    <div class="profit-card">
                        <h4>ROI</h4>
                        <div class="profit-value ${roi >= 50 ? 'positive' : ''}">
                            ${formatPercent(roi)}
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <h4>Рекомендации по увеличению прибыли</h4>
                    <ul class="recommendations-list">
                        ${this.generateRecommendations(margin, roi)}
                    </ul>
                </div>
            </div>
        `;
    }
    
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📈</div>
                <p>Нет данных о прибыли за выбранный период</p>
            </div>
        `;
    }
    
    // ========== УТИЛИТЫ ==========
    
    generateRecommendations(margin, roi) {
        const recommendations = [];
        
        if (margin < 20) {
            recommendations.push('<li>Рассмотрите возможность повышения цен на товары с низкой маржинальностью</li>');
            recommendations.push('<li>Ищите поставщиков с более низкими закупочными ценами</li>');
        } else if (margin > 40) {
            recommendations.push('<li>✅ Отличная маржинальность! Продолжайте в том же духе</li>');
        }
        
        if (roi < 30) {
            recommendations.push('<li>Оптимизируйте складские запасы — избавьтесь от залежавшихся товаров</li>');
        } else if (roi > 100) {
            recommendations.push('<li>✅ Высокий ROI! Инвестируйте в расширение ассортимента</li>');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('<li>Стабильные показатели. Продолжайте мониторинг ключевых метрик</li>');
        }
        
        return recommendations.join('');
    }
}
