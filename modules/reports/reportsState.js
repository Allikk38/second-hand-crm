/**
 * Reports State - Page State Manager
 * 
 * Управление состоянием страницы отчетов.
 * Хранит фильтры периода, активную вкладку и кэш данных.
 * 
 * @module reportsState
 * @version 1.0.0
 */

import { EventBus } from '../../core/EventBus.js';

// ========== КОНСТАНТЫ ==========
const STORAGE_KEY = 'reports_settings';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

const PERIOD_PRESETS = [
    { label: 'Сегодня', value: 'today' },
    { label: 'Вчера', value: 'yesterday' },
    { label: 'Неделя', value: 'week' },
    { label: 'Месяц', value: 'month' },
    { label: 'Квартал', value: 'quarter' },
    { label: 'Год', value: 'year' }
];

const TABS = [
    { id: 'dashboard', label: 'Дашборд', icon: '📊' },
    { id: 'sales', label: 'Продажи', icon: '💰' },
    { id: 'products', label: 'Товары', icon: '📦' },
    { id: 'sellers', label: 'Продавцы', icon: '👥' },
    { id: 'profit', label: 'Прибыль', icon: '📈' }
];

class ReportsStateClass {
    constructor() {
        this._state = {
            // UI состояние
            activeTab: 'dashboard',
            period: {
                preset: 'week',
                startDate: this.getPresetDateRange('week').start,
                endDate: this.getPresetDateRange('week').end
            },
            compareWithPrevious: true,
            isLoading: false,
            
            // Данные отчетов (кэш)
            reportData: {
                dashboard: null,
                sales: null,
                products: null,
                sellers: null,
                profit: null
            },
            
            // Кэш с timestamp
            _cache: new Map()
        };
        
        this._subscribers = new Set();
        
        // Восстанавливаем настройки
        this.restoreSettings();
    }
    
    // ========== ГЕТТЕРЫ / СЕТТЕРЫ ==========
    
    get(key) {
        return this._state[key];
    }
    
    set(key, value) {
        const oldValue = this._state[key];
        this._state[key] = value;
        this._notify([{ key, newValue: value, oldValue }]);
        
        if (key === 'period' || key === 'activeTab' || key === 'compareWithPrevious') {
            this.saveSettings();
        }
    }
    
    setMultiple(updates) {
        const changes = [];
        Object.entries(updates).forEach(([key, value]) => {
            const oldValue = this._state[key];
            this._state[key] = value;
            changes.push({ key, newValue: value, oldValue });
        });
        this._notify(changes);
        this.saveSettings();
    }
    
    getState() {
        return {
            ...this._state,
            reportData: { ...this._state.reportData }
        };
    }
    
    subscribe(callback) {
        this._subscribers.add(callback);
        return () => this._subscribers.delete(callback);
    }
    
    _notify(changes) {
        this._subscribers.forEach(callback => {
            callback(Array.isArray(changes) ? changes : [changes]);
        });
        
        changes.forEach(change => {
            EventBus.emit(`reports:${change.key}:changed`, {
                newValue: change.newValue,
                oldValue: change.oldValue
            });
        });
    }
    
    // ========== ПЕРИОДЫ ==========
    
    getPresetDateRange(preset) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (preset) {
            case 'today':
                return {
                    start: today,
                    end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
                };
            case 'yesterday':
                const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                return {
                    start: yesterday,
                    end: new Date(today.getTime() - 1)
                };
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay() + 1);
                return { start: weekStart, end: now };
            case 'month':
                return {
                    start: new Date(now.getFullYear(), now.getMonth(), 1),
                    end: now
                };
            case 'quarter':
                const quarter = Math.floor(now.getMonth() / 3);
                return {
                    start: new Date(now.getFullYear(), quarter * 3, 1),
                    end: now
                };
            case 'year':
                return {
                    start: new Date(now.getFullYear(), 0, 1),
                    end: now
                };
            default:
                return this.getPresetDateRange('week');
        }
    }
    
    setPeriodPreset(preset) {
        if (preset === 'custom') {
            this.set('period', { ...this._state.period, preset: 'custom' });
        } else {
            const range = this.getPresetDateRange(preset);
            this.set('period', {
                preset,
                startDate: range.start,
                endDate: range.end
            });
        }
    }
    
    setCustomPeriod(startDate, endDate) {
        this.set('period', {
            preset: 'custom',
            startDate: new Date(startDate),
            endDate: new Date(endDate)
        });
    }
    
    getPreviousPeriod() {
        const { startDate, endDate } = this._state.period;
        const duration = endDate.getTime() - startDate.getTime();
        
        return {
            start: new Date(startDate.getTime() - duration),
            end: new Date(endDate.getTime() - duration)
        };
    }
    
    // ========== КЭШ ==========
    
    getCacheKey() {
        const { startDate, endDate, preset } = this._state.period;
        return `${this._state.activeTab}_${preset}_${startDate.toISOString()}_${endDate.toISOString()}`;
    }
    
    getCachedData(key) {
        const cached = this._state._cache.get(key);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
        return null;
    }
    
    setCachedData(key, data) {
        this._state._cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
    
    clearCache() {
        this._state._cache.clear();
    }
    
    setReportData(tabId, data) {
        this._state.reportData[tabId] = data;
        this._notify([{ key: 'reportData', newValue: this._state.reportData, oldValue: null }]);
    }
    
    // ========== НАСТРОЙКИ ==========
    
    saveSettings() {
        const settings = {
            activeTab: this._state.activeTab,
            period: {
                preset: this._state.period.preset,
                startDate: this._state.period.startDate.toISOString(),
                endDate: this._state.period.endDate.toISOString()
            },
            compareWithPrevious: this._state.compareWithPrevious
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    
    restoreSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const settings = JSON.parse(stored);
                this._state.activeTab = settings.activeTab || 'dashboard';
                this._state.compareWithPrevious = settings.compareWithPrevious ?? true;
                
                if (settings.period) {
                    this._state.period = {
                        preset: settings.period.preset,
                        startDate: new Date(settings.period.startDate),
                        endDate: new Date(settings.period.endDate)
                    };
                }
            }
        } catch (error) {
            console.error('[ReportsState] Restore error:', error);
        }
    }
    
    // ========== КОНСТАНТЫ ==========
    
    static get PERIOD_PRESETS() {
        return PERIOD_PRESETS;
    }
    
    static get TABS() {
        return TABS;
    }
}

export const ReportsState = new ReportsStateClass();
export { PERIOD_PRESETS, TABS };
