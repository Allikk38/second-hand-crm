// ========================================
// FILE: ./modules/reports/ReportsTabs.js
// ========================================

/**
 * Reports Tabs Component
 * 
 * Компонент вкладок для переключения между разными отчетами.
 * 
 * @module ReportsTabs
 * @version 1.0.1
 * @changes
 * - Исправлены пути импорта на относительные (../../ вместо корневых).
 * - Добавлен именованный экспорт.
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { formatNumber } from '../../utils/formatters.js';
import { getCategoryName } from '../../utils/categorySchema.js';

const TABS = [
    { id: 'dashboard', label: 'Дашборд', icon: '📊' },
    { id: 'sales', label: 'Продажи', icon: '💰' },
    { id: 'products', label: 'Товары', icon: '📦' },
    { id: 'sellers', label: 'Продавцы', icon: '👥' },
    { id: 'profit', label: 'Прибыль', icon: '📈' }
];

export class ReportsTabs extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            activeTab: 'dashboard',
            onTabChange: null,
            ...options
        };
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const activeTab = this.options.activeTab || 'dashboard';
        
        return `
            <div class="reports-tabs">
                ${TABS.map(tab => `
                    <button 
                        class="tab-btn ${activeTab === tab.id ? 'active' : ''}"
                        data-tab="${tab.id}"
                        data-ref="tab_${tab.id}"
                    >
                        <span class="tab-icon">${tab.icon}</span>
                        <span>${tab.label}</span>
                    </button>
                `).join('')}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        TABS.forEach(tab => {
            const btn = this.refs.get(`tab_${tab.id}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    this.setActiveTab(tab.id);
                });
            }
        });
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    setActiveTab(tabId) {
        // Обновляем активный класс
        TABS.forEach(tab => {
            const btn = this.refs.get(`tab_${tab.id}`);
            if (btn) {
                if (tab.id === tabId) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
        
        // Вызываем колбэк
        if (this.options.onTabChange) {
            this.options.onTabChange(tabId);
        }
    }
    
    getActiveTab() {
        const activeBtn = this.element?.querySelector('.tab-btn.active');
        return activeBtn?.dataset.tab || this.options.activeTab;
    }
}

// Экспортируем и как default, и как именованный для совместимости
export default ReportsTabs;
