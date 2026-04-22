// ========================================
// FILE: ./modules/reports/ReportsHeader.js
// ========================================

/**
 * Reports Header Component
 * 
 * Компонент заголовка отчетов с выбором периода.
 * Поддерживает пресеты периода, кастомный диапазон и экспорт.
 * 
 * Архитектурные решения:
 * - Получает начальные значения через пропсы из `Store.state.reports`.
 * - Не зависит от легаси стейтов.
 * - Колбэки для взаимодействия с родительским контроллером.
 * 
 * @module ReportsHeader
 * @version 6.0.0
 * @changes
 * - Обновлена документация.
 * - Добавлена поддержка пропсов из Store.
 * - Упрощена обработка кастомного периода.
 */

import { BaseComponent } from '../../core/BaseComponent.js';

const PERIOD_PRESETS = [
    { value: 'today', label: 'Сегодня' },
    { value: 'yesterday', label: 'Вчера' },
    { value: 'week', label: 'Неделя' },
    { value: 'month', label: 'Месяц' },
    { value: 'quarter', label: 'Квартал' },
    { value: 'year', label: 'Год' },
    { value: 'custom', label: 'Свой период' }
];

export class ReportsHeader extends BaseComponent {
    constructor(container, options = {}) {
        super(container);
        this.options = {
            period: { preset: 'week', startDate: null, endDate: null },
            compareWithPrevious: true,
            onPeriodChange: null,
            onCustomPeriodChange: null,
            onCompareToggle: null,
            onRefresh: null,
            onExport: null,
            ...options
        };
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const { period, compareWithPrevious } = this.options;
        const { preset, startDate, endDate } = period;
        
        const startDateStr = startDate ? this.formatDateForInput(startDate) : '';
        const endDateStr = endDate ? this.formatDateForInput(endDate) : '';
        const showCustom = preset === 'custom';
        
        return `
            <div class="reports-header">
                <div class="period-selector">
                    <select class="period-preset" data-ref="periodPreset">
                        ${PERIOD_PRESETS.map(p => `
                            <option value="${p.value}" ${preset === p.value ? 'selected' : ''}>
                                ${p.label}
                            </option>
                        `).join('')}
                    </select>
                    
                    <div class="custom-period ${showCustom ? 'visible' : ''}" data-ref="customPeriod">
                        <input type="date" data-ref="startDate" value="${startDateStr}" placeholder="С">
                        <span>—</span>
                        <input type="date" data-ref="endDate" value="${endDateStr}" placeholder="По">
                        <button class="btn-secondary btn-sm" data-ref="applyCustomBtn">Применить</button>
                    </div>
                </div>
                
                <div class="header-actions">
                    <label class="checkbox-label">
                        <input type="checkbox" data-ref="compareToggle" ${compareWithPrevious ? 'checked' : ''}>
                        Сравнить с прошлым периодом
                    </label>
                    
                    <button class="btn-secondary btn-sm" data-ref="refreshBtn" title="Обновить">
                        🔄
                    </button>
                    
                    <button class="btn-secondary btn-sm" data-ref="exportBtn" title="Экспорт">
                        📥
                    </button>
                </div>
            </div>
        `;
    }
    
    formatDateForInput(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toISOString().split('T')[0];
    }
    
    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Выбор пресета периода
        this.addDomListener('periodPreset', 'change', (e) => {
            const preset = e.target.value;
            
            if (preset === 'custom') {
                this.refs.get('customPeriod')?.classList.add('visible');
            } else {
                this.refs.get('customPeriod')?.classList.remove('visible');
                if (this.options.onPeriodChange) {
                    this.options.onPeriodChange(preset);
                }
            }
        });
        
        // Применение кастомного периода
        this.addDomListener('applyCustomBtn', 'click', () => {
            const startDate = this.refs.get('startDate')?.value;
            const endDate = this.refs.get('endDate')?.value;
            
            if (startDate && endDate && this.options.onCustomPeriodChange) {
                this.options.onCustomPeriodChange(new Date(startDate), new Date(endDate));
            }
        });
        
        // Чекбокс сравнения
        this.addDomListener('compareToggle', 'change', (e) => {
            if (this.options.onCompareToggle) {
                this.options.onCompareToggle(e.target.checked);
            }
        });
        
        // Кнопка обновления
        this.addDomListener('refreshBtn', 'click', () => {
            if (this.options.onRefresh) {
                this.options.onRefresh();
            }
        });
        
        // Кнопка экспорта
        this.addDomListener('exportBtn', 'click', () => {
            if (this.options.onExport) {
                this.options.onExport();
            }
        });
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    setPeriod(period) {
        this.options.period = period;
        this.update();
    }
    
    setCompareWithPrevious(value) {
        this.options.compareWithPrevious = value;
        const checkbox = this.refs.get('compareToggle');
        if (checkbox) checkbox.checked = value;
    }
}
