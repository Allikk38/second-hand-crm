// ========================================
// FILE: js/reports.js
// ========================================

/**
 * Reports Page Module - MPA Edition
 * 
 * Точка входа для страницы отчетов. Управляет переключением вкладок,
 * загрузкой данных и динамической подгрузкой модулей-рендереров.
 * 
 * Архитектурные решения:
 * - Разделение на модули: dashboard, tables.
 * - Динамический импорт для уменьшения initial bundle.
 * - Кэширование данных в sessionStorage.
 * - Chart.js загружается только для дашборда.
 * - Использование централизованных утилит из core/auth.js и utils/ui.js.
 * - Поддержка офлайн-режима при отсутствии сети.
 * 
 * @module reports
 * @version 3.4.3
 * @changes
 * - Исправлен синтаксис фильтрации дат в Supabase запросах (использование .gte() и .lte()).
 * - Исправлен динамический импорт renderDashboard (правильное имя экспорта).
 * - Добавлена обработка ошибок при динамическом импорте.
 * - Улучшена отладка с console.warn при отсутствии функций.
 */

import { requireAuth, logout, getCurrentUser, isOnline, getSupabase } from '../core/auth.js';
import { formatMoney, formatDate, debounce, escapeHtml } from '../utils/formatters.js';
import { showNotification } from '../utils/ui.js';

// ========== КОНСТАНТЫ ==========

const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const CACHE_KEY_PREFIX = 'reports_cache_';

// ========== СОСТОЯНИЕ ==========

const state = {
    user: null,
    isOffline: false,
    activeTab: 'dashboard',
    period: 'week',
    isLoading: false,
    data: {
        dashboard: null,
        sales: null,
        products: null,
        shifts: null
    },
    cache: new Map()
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    content: null,
    skeletonLoader: null,
    periodSelect: null,
    refreshBtn: null,
    exportBtn: null,
    logoutBtn: null,
    userEmail: null,
    modalContainer: null,
    notificationContainer: null,
    offlineBanner: null,
    offlineRetryBtn: null
};

// ========== ОФЛАЙН-БАННЕР ==========

function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'flex';
    }
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'none';
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function showLoader() {
    if (DOM.skeletonLoader) {
        DOM.skeletonLoader.style.display = 'block';
    }
    if (DOM.content) {
        DOM.content.style.display = 'none';
    }
}

function hideLoader() {
    if (DOM.skeletonLoader) {
        DOM.skeletonLoader.style.display = 'none';
    }
    if (DOM.content) {
        DOM.content.style.display = 'block';
    }
}

// ========== КЭШИРОВАНИЕ ==========

function getCacheKey(tab, period) {
    return `${CACHE_KEY_PREFIX}${tab}_${period}`;
}

function getFromCache(key) {
    try {
        const cached = sessionStorage.getItem(key);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_TTL) {
            sessionStorage.removeItem(key);
            return null;
        }
        
        return data;
    } catch {
        return null;
    }
}

function setToCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('[Reports] Cache set error:', e);
    }
}

function clearCache() {
    Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith(CACHE_KEY_PREFIX)) {
            sessionStorage.removeItem(key);
        }
    });
}

// ========== ДИАПАЗОНЫ ДАТ ==========

function formatISODate(date) {
    return date.toISOString().split('.')[0] + 'Z';
}

function getDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    let previousStart = new Date(today);
    let previousEnd = new Date(today);
    
    switch (period) {
        case 'today':
            previousStart.setDate(today.getDate() - 1);
            previousEnd.setDate(today.getDate() - 1);
            break;
        case 'yesterday':
            start.setDate(today.getDate() - 1);
            previousStart.setDate(today.getDate() - 2);
            previousEnd.setDate(today.getDate() - 2);
            break;
        case 'week':
            start.setDate(today.getDate() - 7);
            previousStart.setDate(today.getDate() - 14);
            previousEnd.setDate(today.getDate() - 7);
            break;
        case 'month':
            start.setMonth(today.getMonth() - 1);
            previousStart.setMonth(today.getMonth() - 2);
            previousEnd.setMonth(today.getMonth() - 1);
            break;
        case 'quarter':
            start.setMonth(today.getMonth() - 3);
            previousStart.setMonth(today.getMonth() - 6);
            previousEnd.setMonth(today.getMonth() - 3);
            break;
        case 'year':
            start.setFullYear(today.getFullYear() - 1);
            previousStart.setFullYear(today.getFullYear() - 2);
            previousEnd.setFullYear(today.getFullYear() - 1);
            break;
        default:
            start.setDate(today.getDate() - 7);
            previousStart.setDate(today.getDate() - 14);
            previousEnd.setDate(today.getDate() - 7);
    }
    
    return {
        start: formatISODate(start),
        end: formatISODate(now),
        previousStart: formatISODate(previousStart),
        previousEnd: formatISODate(previousEnd)
    };
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function fetchSalesData(dateRange) {
    const supabase = await getSupabase();
    
    // ИСПРАВЛЕНО: Используем правильный синтаксис фильтрации с методами .gte() и .lte()
    const { data: sales, error } = await supabase
        .from('sales')
        .select('*')
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end)
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('[Reports] Sales query error:', error);
        throw error;
    }
    
    // Предыдущий период
    const { data: previousSales, error: prevError } = await supabase
        .from('sales')
        .select('total, profit')
        .gte('created_at', dateRange.previousStart)
        .lte('created_at', dateRange.previousEnd);
    
    if (prevError) {
        console.warn('[Reports] Previous sales query error:', prevError);
    }
    
    // Товары в наличии
    const { count: inStock, error: stockError } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'in_stock');
    
    if (stockError) {
        console.warn('[Reports] Stock count error:', stockError);
    }
    
    // Стоимость склада
    const { data: stockValue, error: valueError } = await supabase
        .from('products')
        .select('price, cost_price')
        .eq('status', 'in_stock');
    
    if (valueError) {
        console.warn('[Reports] Stock value error:', valueError);
    }
    
    // Смены для получения продавцов
    const { data: shifts, error: shiftsError } = await supabase
        .from('shifts')
        .select('user_id')
        .gte('opened_at', dateRange.start)
        .lte('opened_at', dateRange.end);
    
    if (shiftsError) {
        console.warn('[Reports] Shifts query error:', shiftsError);
    }
    
    // Профили пользователей
    let userMap = new Map();
    const userIds = [...new Set((shifts || []).map(s => s.user_id).filter(Boolean))];
    
    if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', userIds);
        
        if (!profilesError && profiles) {
            userMap = new Map(profiles.map(p => [p.id, p.full_name]));
        }
    }
    
    const salesData = sales || [];
    const prevSalesData = previousSales || [];
    
    const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    const prevRevenue = prevSalesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const prevProfit = prevSalesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;
    
    // Данные по дням
    const dailyMap = new Map();
    salesData.forEach(s => {
        const day = s.created_at.split('T')[0];
        if (!dailyMap.has(day)) {
            dailyMap.set(day, { date: day, revenue: 0, profit: 0, count: 0 });
        }
        const d = dailyMap.get(day);
        d.revenue += s.total || 0;
        d.profit += s.profit || 0;
        d.count++;
    });
    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    
    // Топ товаров
    const productStats = new Map();
    salesData.forEach(s => {
        if (!s.items) return;
        s.items.forEach(i => {
            const key = i.id;
            const cur = productStats.get(key) || { 
                id: i.id, 
                name: i.name, 
                quantity: 0, 
                revenue: 0 
            };
            cur.quantity += i.quantity || 1;
            cur.revenue += (i.price || 0) * (i.quantity || 1);
            productStats.set(key, cur);
        });
    });
    const topProducts = Array.from(productStats.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
    
    // Топ категорий
    const categoryStats = new Map();
    salesData.forEach(s => {
        if (!s.items) return;
        s.items.forEach(i => {
            const cat = i.category || 'other';
            const cur = categoryStats.get(cat) || { category: cat, revenue: 0, quantity: 0 };
            cur.revenue += (i.price || 0) * (i.quantity || 1);
            cur.quantity += i.quantity || 1;
            categoryStats.set(cat, cur);
        });
    });
    const topCategories = Array.from(categoryStats.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    
    // Способы оплаты
    const paymentStats = new Map();
    salesData.forEach(s => {
        const method = s.payment_method || 'unknown';
        const cur = paymentStats.get(method) || { method, count: 0, revenue: 0 };
        cur.count++;
        cur.revenue += s.total || 0;
        paymentStats.set(method, cur);
    });
    const paymentMethods = Array.from(paymentStats.values());
    
    // Залежавшиеся товары
    const { data: allProducts, error: allProductsError } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'in_stock');
    
    if (allProductsError) {
        console.warn('[Reports] All products error:', allProductsError);
    }
    
    const now = new Date();
    const slowMoving = (allProducts || [])
        .map(p => ({
            ...p,
            daysInStock: Math.floor((now - new Date(p.created_at)) / (1000 * 60 * 60 * 24))
        }))
        .filter(p => p.daysInStock > 30)
        .sort((a, b) => b.daysInStock - a.daysInStock)
        .slice(0, 20);
    
    // Данные смен
    const { data: shiftsData, error: shiftsDataError } = await supabase
        .from('shifts')
        .select('*')
        .gte('opened_at', dateRange.start)
        .lte('opened_at', dateRange.end)
        .order('opened_at', { ascending: false });
    
    if (shiftsDataError) {
        console.warn('[Reports] Shifts data error:', shiftsDataError);
    }
    
    const enrichedShifts = (shiftsData || []).map(shift => ({
        ...shift,
        seller_name: userMap.get(shift.user_id) || 'Неизвестно',
        duration: shift.closed_at 
            ? formatDuration(new Date(shift.closed_at) - new Date(shift.opened_at))
            : 'Активна'
    }));
    
    const totalStockValue = (stockValue || []).reduce((sum, p) => sum + (p.price || 0), 0);
    const totalCostValue = (stockValue || []).reduce((sum, p) => sum + (p.cost_price || 0), 0);
    
    const bySeller = {};
    enrichedShifts.forEach(shift => {
        const seller = shift.seller_name;
        if (!bySeller[seller]) {
            bySeller[seller] = { shifts: 0, salesCount: 0, revenue: 0, profit: 0 };
        }
        bySeller[seller].shifts++;
        bySeller[seller].salesCount += shift.sales_count || 0;
        bySeller[seller].revenue += shift.total_revenue || 0;
        bySeller[seller].profit += shift.total_profit || 0;
    });
    
    return {
        dashboard: {
            overview: {
                revenue: totalRevenue,
                profit: totalProfit,
                margin,
                salesCount: salesData.length,
                averageCheck: salesData.length > 0 ? totalRevenue / salesData.length : 0,
                inStock: inStock || 0,
                stockValue: totalStockValue,
                potentialProfit: totalStockValue - totalCostValue
            },
            trends: {
                revenue: calculateTrend(totalRevenue, prevRevenue),
                profit: calculateTrend(totalProfit, prevProfit),
                margin: calculateTrend(margin, prevMargin),
                salesCount: calculateTrend(salesData.length, prevSalesData.length)
            },
            daily,
            topProducts,
            topCategories,
            paymentMethods
        },
        sales: {
            summary: {
                count: salesData.length,
                revenue: totalRevenue,
                profit: totalProfit,
                averageCheck: salesData.length > 0 ? totalRevenue / salesData.length : 0
            },
            sales: salesData.map(sale => ({
                ...sale,
                seller_name: 'Система'
            })),
            byPaymentMethod: paymentMethods
        },
        products: {
            topProducts,
            slowMoving,
            inventoryValue: totalStockValue,
            inventoryCost: totalCostValue
        },
        shifts: {
            shifts: enrichedShifts,
            bySeller,
            summary: {
                totalShifts: enrichedShifts.length,
                activeShifts: enrichedShifts.filter(s => !s.closed_at).length,
                totalRevenue: enrichedShifts.reduce((sum, s) => sum + (s.total_revenue || 0), 0),
                totalProfit: enrichedShifts.reduce((sum, s) => sum + (s.total_profit || 0), 0)
            }
        }
    };
}

function calculateTrend(current, previous) {
    if (!previous || previous === 0) {
        return { direction: 'neutral', value: 0 };
    }
    const change = ((current - previous) / previous) * 100;
    return {
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        value: Math.abs(change).toFixed(1)
    };
}

function formatDuration(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours} ч ${minutes} мин`;
    return `${minutes} мин`;
}

async function loadData() {
    if (state.isLoading) return;
    
    if (!isOnline()) {
        const cacheKey = getCacheKey(state.activeTab, state.period);
        const cached = getFromCache(cacheKey);
        if (cached) {
            state.data[state.activeTab] = cached;
            render();
            showNotification('Работа в офлайн-режиме (данные из кэша)', 'warning');
        } else {
            showNotification('Нет данных для офлайн-режима', 'warning');
        }
        return;
    }
    
    state.isLoading = true;
    showLoader();
    
    const dateRange = getDateRange(state.period);
    const cacheKey = getCacheKey(state.activeTab, state.period);
    
    try {
        const allData = await fetchSalesData(dateRange);
        
        state.data.dashboard = allData.dashboard;
        state.data.sales = allData.sales;
        state.data.products = allData.products;
        state.data.shifts = allData.shifts;
        
        setToCache(cacheKey, state.data[state.activeTab]);
        hideOfflineBanner();
        
    } catch (error) {
        console.error('[Reports] Load data error:', error);
        
        const cached = getFromCache(cacheKey);
        if (cached) {
            state.data[state.activeTab] = cached;
            showNotification('Загружены данные из кэша', 'info');
        } else {
            showNotification('Ошибка загрузки данных: ' + error.message, 'error');
        }
    } finally {
        state.isLoading = false;
        hideLoader();
        render();
    }
}

// ========== ДИНАМИЧЕСКИЙ РЕНДЕРИНГ ==========

async function render() {
    if (!DOM.content) return;
    
    const data = state.data[state.activeTab];
    
    if (!data || state.isLoading) {
        DOM.content.innerHTML = '<div class="reports-loader">Загрузка...</div>';
        return;
    }
    
    try {
        switch (state.activeTab) {
            case 'dashboard': {
                const dashboardModule = await import('./reports-dashboard.js');
                
                // ИСПРАВЛЕНО: Проверяем наличие функций и используем правильные имена
                if (typeof dashboardModule.renderDashboard === 'function') {
                    DOM.content.innerHTML = dashboardModule.renderDashboard(data, state.period);
                    
                    if (typeof dashboardModule.renderCharts === 'function') {
                        setTimeout(() => dashboardModule.renderCharts(data.daily, data.paymentMethods), 100);
                    } else {
                        console.warn('[Reports] renderCharts not found in dashboard module');
                    }
                    
                    if (typeof dashboardModule.exportDashboardData === 'function') {
                        window.__currentReportsModule = { 
                            exportData: dashboardModule.exportDashboardData 
                        };
                    }
                } else {
                    console.error('[Reports] renderDashboard is not a function in dashboard module');
                    DOM.content.innerHTML = '<div class="error-state">Ошибка загрузки дашборда</div>';
                }
                break;
            }
            case 'sales': {
                const tablesModule = await import('./reports-tables.js');
                
                if (typeof tablesModule.renderSalesTable === 'function') {
                    DOM.content.innerHTML = tablesModule.renderSalesTable(data);
                    
                    if (typeof tablesModule.exportSalesData === 'function') {
                        window.__currentReportsModule = { 
                            exportData: tablesModule.exportSalesData 
                        };
                    }
                } else {
                    console.error('[Reports] renderSalesTable not found in tables module');
                    DOM.content.innerHTML = '<div class="error-state">Ошибка загрузки отчёта по продажам</div>';
                }
                break;
            }
            case 'products': {
                const tablesModule = await import('./reports-tables.js');
                
                if (typeof tablesModule.renderProductsTable === 'function') {
                    DOM.content.innerHTML = tablesModule.renderProductsTable(data);
                    
                    if (typeof tablesModule.exportProductsData === 'function') {
                        window.__currentReportsModule = { 
                            exportData: tablesModule.exportProductsData 
                        };
                    }
                } else {
                    console.error('[Reports] renderProductsTable not found in tables module');
                    DOM.content.innerHTML = '<div class="error-state">Ошибка загрузки отчёта по товарам</div>';
                }
                break;
            }
            case 'shifts': {
                const tablesModule = await import('./reports-tables.js');
                
                if (typeof tablesModule.renderShiftsTable === 'function') {
                    DOM.content.innerHTML = tablesModule.renderShiftsTable(data);
                    
                    if (typeof tablesModule.exportShiftsData === 'function') {
                        window.__currentReportsModule = { 
                            exportData: tablesModule.exportShiftsData 
                        };
                    }
                } else {
                    console.error('[Reports] renderShiftsTable not found in tables module');
                    DOM.content.innerHTML = '<div class="error-state">Ошибка загрузки отчёта по сменам</div>';
                }
                break;
            }
            default:
                DOM.content.innerHTML = '<div class="empty-state">Выберите отчет</div>';
        }
        
        // Привязываем экспорт
        if (DOM.exportBtn && window.__currentReportsModule?.exportData) {
            const exportHandler = () => {
                const csv = window.__currentReportsModule.exportData(data, state.activeTab);
                if (csv) {
                    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', `${state.activeTab}_${state.period}.csv`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            };
            DOM.exportBtn.removeEventListener('click', exportHandler);
            DOM.exportBtn.addEventListener('click', exportHandler);
        }
        
    } catch (error) {
        console.error('[Reports] Render error:', error);
        DOM.content.innerHTML = `<div class="error-state">Ошибка: ${error.message}</div>`;
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function cacheElements() {
    DOM.content = document.getElementById('reportsContent');
    DOM.skeletonLoader = document.getElementById('skeletonLoader');
    DOM.periodSelect = document.getElementById('periodSelect');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.exportBtn = document.getElementById('exportBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.notificationContainer = document.getElementById('notificationContainer');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
}

function displayUserInfo() {
    if (DOM.userEmail) {
        if (state.user) {
            const name = state.user.email?.split('@')[0] || 'Пользователь';
            DOM.userEmail.textContent = name;
        } else {
            DOM.userEmail.textContent = 'Офлайн-режим';
        }
    }
}

function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.periodSelect) {
        DOM.periodSelect.addEventListener('change', (e) => {
            state.period = e.target.value;
            clearCache();
            loadData();
        });
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            clearCache();
            loadData();
        });
    }
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => {
            loadData();
        });
    }
    
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            document.querySelectorAll('[data-tab]').forEach(b => {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            
            state.activeTab = tab;
            
            if (!state.data[tab]) {
                loadData();
            } else {
                render();
            }
        });
    });
    
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            location.reload();
        });
    }
    
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        loadData();
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

async function init() {
    console.log('[Reports] Initializing MPA page...');
    
    cacheElements();
    
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
        state.isOffline = false;
        hideOfflineBanner();
    } else if (authResult.offline || authResult.networkError) {
        state.isOffline = true;
        state.user = null;
        showOfflineBanner();
        showNotification('Работа в офлайн-режиме. Некоторые функции недоступны.', 'warning');
    } else if (authResult.authError) {
        return;
    }
    
    displayUserInfo();
    attachEvents();
    
    await loadData();
    
    console.log('[Reports] Page initialized');
}

document.addEventListener('DOMContentLoaded', init);

export { init };
