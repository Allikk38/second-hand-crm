/**
 * Reports Tabs Component
 * 
 * Компонент вкладок для переключения между отчетами.
 * 
 * @module ReportsTabs
 * @version 1.0.0
 */

import { BaseComponent } from '../../core/BaseComponent.js';

export class ReportsTabs extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            tabs: [],
            activeTab: null,
            onTabChange: null,
            ...options
        };
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const { tabs, activeTab } = this.options;
        
        return `
            <div class="reports-tabs">
                ${tabs.map(tab => `
                    <button 
                        class="tab-btn ${activeTab === tab.id ? 'active' : ''}"
                        data-tab="${tab.id}"
                    >
                        <span class="tab-icon">${tab.icon}</span>
                        ${tab.label}
                    </button>
                `).join('')}
            </div>
        `;
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tab]');
            if (!btn) return;
            
            const tabId = btn.dataset.tab;
            
            // Обновляем активный класс
            this.container.querySelectorAll('[data-tab]').forEach(b => {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            
            if (this.options.onTabChange) {
                this.options.onTabChange(tabId);
            }
        });
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    setActiveTab(tabId) {
        this.options.activeTab = tabId;
        this.update();
    }
}
