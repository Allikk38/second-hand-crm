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
 * - Поддержка офлайн-режима с отображением кэшированных данных.
 * 
 * @module reports
 * @version 3.5.0
 * @changes
 * - Исправлена синтаксическая ошибка в fetchSalesData (функция была не завершена).
 * - Добавлена полноценная поддержка офлайн-режима.
 * - При потере соединения данные автоматически загружаются из кэша.
 * - Добавлен офлайн-баннер с информацией о последней синхронизации.
 */

import { requireAuth, logout, isOnline, getSupabase } from '../core/auth.js';
import { formatMoney, formatNumber, formatPercent, escapeHtml, getCategoryName } from '../utils/formatters.js';
import { showNotification } from '../utils/ui.js';

// ========== КОНСТАНТЫ ==========

const CACHE_TTL = 30 * 60 * 1000; // 30 минут
const CACHE_KEY_PREFIX = 'reports_cache_';
const CACHE_TIMESTAMP_KEY = 'reports_last_sync';

// ========== СОСТОЯНИЕ ==========

const state = {
    user: null,
    isOffline: false,
    activeTab: 'dashboard',
    period: 'week',
    isLoading: false,
    lastSyncTime: null,
    data: {
        dashboard: null,
        sales: null,
        products: null,
        shifts: null
    }
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
    offlineBanner: null,
    offlineRetryBtn: null,
    lastSyncSpan: null
};

// ========== ОФЛАЙН-БАННЕР ==========

/**
 * Показывает офлайн-баннер с информацией о последней синхронизации
 */
function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'flex';
        
        // Обновляем информацию о последней синхронизации
        const lastSyncSpan = document.getElementById('lastSyncTime');
        if (lastSyncSpan && state.lastSyncTime) {
            const timeStr = new Date(state.lastSyncTime).toLocaleString('ru-RU');
            lastSyncSpan.textContent = `Последняя синхронизация: ${timeStr}`;
        }
    }
}

/**
 * Скрывает офлайн-баннер
 */
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

/**
 * Получает ключ кэша для вкладки и периода
 */
function getCacheKey(tab, period) {
    return `${CACHE_KEY_PREFIX}${tab}_${period}`;
}

/**
 * Загружает данные из кэша
 */
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
    } catch (e) {
        console.warn('[Reports] Cache read error:', e);
        return null;
    }
}

/**
 * Сохраняет данные в кэш
 */
function setToCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
        
        // Сохраняем время последней синхронизации
        state.lastSyncTime = Date.now();
        sessionStorage.setItem(CACHE_TIMESTAMP_KEY, state.lastSyncTime);
    } catch (e) {
        console.warn('[Reports] Cache set error:', e);
    }
}

/**
 * Очищает весь кэш отчётов
 */
function clearCache() {
    Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith(CACHE_KEY_PREFIX)) {
            sessionStorage.removeItem(key);
        }
    });
}

/**
 * Загружает время последней синхронизации
 */
function loadLastSyncTime() {
    try {
        const timestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
        if (timestamp) {
            state.lastSyncTime = parseInt(timestamp, 10);
        }
    } catch (e) {
        console.warn('[Reports] Failed to load sync time:', e);
    }
}

// ========== ДИАПАЗОНЫ ДАТ ==========

/**
 * Форматирует дату в ISO строку
 */
function formatISODate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return new Date().toISOString().split('.')[0] + 'Z';
    }
    return date.toISOString().split('.')[0] + 'Z';
}

/**
 * Получает диапазон дат для выбранного периода
 */
function getDateRange(period) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let start = new Date(today);
    let previousStart = new Date(today);
    let previousEnd = new Date(today);
    
    switch (period) {
        case 'today':
            previousStart.setUTCDate(today.getUTCDate() - 1);
            previousEnd.setUTCDate(today.getUTCDate() - 1);
            break;
        case 'yesterday':
            start.setUTCDate(today.getUTCDate() - 1);
            previousStart.setUTCDate(today.getUTCDate() - 2);
            previousEnd.setUTCDate(today.getUTCDate() - 2);
            break;
        case 'week':
            start.setUTCDate(today.getUTCDate() - 7);
            previousStart.setUTCDate(today.getUTCDate() - 14);
            previousEnd.setUTCDate(today.getUTCDate() - 7);
            break;
        case 'month':
            start.setUTCMonth(today.getUTCMonth() - 1);
            previousStart.setUTCMonth(today.getUTCMonth() - 2);
            previousEnd.setUTCMonth(today.getUTCMonth() - 1);
            break;
        case 'quarter':
            start.setUTCMonth(today.getUTCMonth() - 3);
            previousStart.setUTCMonth(today.getUTCMonth() - 6);
            previousEnd.setUTCMonth(today.getUTCMonth() - 3);
            break;
        case 'year':
            start.setUTCFullYear(today.getUTCFullYear() - 1);
            previousStart.setUTCFullYear(today.getUTCFullYear() - 2);
            previousEnd.setUTCFullYear(today.getUTCFullYear() - 1);
            break;
        default:
            start.setUTCDate(today.getUTCDate() - 7);
            previousStart.setUTCDate(today.getUTCDate() - 14);
            previousEnd.setUTCDate(today.getUTCDate() - 7);
    }
    
    return {
        start: formatISODate(start),
        end: formatISODate(now),
        previousStart: formatISODate(previousStart),
        previousEnd: formatISODate(previousEnd)
    };
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

/**
 * Рассчитывает тренд (изменение в процентах)
 */
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

/**
 * Форматирует длительность в читаемый вид
 */
function formatDuration(ms) {
    if (!ms || ms < 0) return '—';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours} ч ${minutes} мин`;
    return `${minutes} мин`;
}

/**
 * Загружает все данные для отчётов
 */
async function fetchSalesData(dateRange) {
    console.log('[Reports] Fetching data for range:', dateRange);
    
    const supabase = await getSupabase();
    
    // Основной запрос продаж
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
    const { data: previousSales } = await supabase
        .from('sales')
        .select('total, profit')
        .gte('created_at', dateRange.previousStart)
        .lte('created_at', dateRange.previousEnd);
    
    // Товары в наличии
    const { count: inStock } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'in_stock');
    
    // Стоимость склада
    const { data: stockValue } = await supabase
        .from('products')
        .select('price, cost_price')
        .eq('status', 'in_stock');
    
    // Смены для получения продавцов
    const { data: shifts } = await supabase
        .from('shifts')
        .select('user_id')
        .gte('opened_at', dateRange.start)
        .lte('opened_at', dateRange.end);
    
    // Профили пользователей
    let userMap = new Map();
    const userIds = [...new Set((shifts || []).map(s => s.user_id).filter(Boolean))];
    
    if (userIds.length > 0) {
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', userIds);
        
        if (profiles) {
            userMap = new Map(profiles.map(p => [p.id, p.full_name]));
        }
    }
    
    const salesData = sales || [];
    const prevSalesData = previousSales || [];
    
    // Расчёт основных показателей
    const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    const prevRevenue = prevSalesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const prevProfit = prevSalesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;
    
    // Данные по дням
    const dailyMap = new Map();
    salesData.forEach(s => {
        if (!s.created_at) return;
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
    const { data: allProducts } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'in_stock');
    
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
    const { data: shiftsData } = await supabase
        .from('shifts')
        .select('*')
        .gte('opened_at', dateRange.start)
        .lte('opened_at', dateRange.end)
        .order('opened_at', { ascending: false });
    
    const enrichedShifts = (shiftsData || []).map(shift => ({
        ...shift,
        seller_name: userMap.get(shift.user_id) || 'Неизвестно',
        duration: shift.closed_at 
            ? formatDuration(new Date(shift.closed_at) - new Date(shift.opened_at))
            : 'Активна'
    }));
    
    const totalStockValue = (stockValue || []).reduce((sum, p) => sum + (p.price || 0), 0);
    const totalCostValue = (stockValue || []).reduce((sum, p) => sum + (p.cost_price || 0), 0);
    
    // Статистика по продавцам
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

/**
 * Загружает данные с учётом офлайн-режима
 */
async function loadData() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    showLoader();
    
    const cacheKey = getCacheKey(state.activeTab, state.period);
    
    try {
        // Проверяем наличие сети
        if (!isOnline()) {
            console.log('[Reports] Offline mode, loading from cache');
            state.isOffline = true;
            showOfflineBanner();
            
            // Пробуем загрузить все данные из кэша
            const cachedDashboard = getFromCache(getCacheKey('dashboard', state.period));
            const cachedSales = getFromCache(getCacheKey('sales', state.period));
            const cachedProducts = getFromCache(getCacheKey('products', state.period));
            const cachedShifts = getFromCache(getCacheKey('shifts', state.period));
            
            if (cachedDashboard) {
                state.data.dashboard = cachedDashboard;
                state.data.sales = cachedSales;
                state.data.products = cachedProducts;
                state.data.shifts = cachedShifts;
                showNotification('Работа в офлайн-режиме (данные из кэша)', 'warning');
            } else {
                showNotification('Нет кэшированных данных для офлайн-режима', 'warning');
            }
            
            hideLoader();
            render();
            return;
        }
        
        // Онлайн-режим: загружаем свежие данные
        state.isOffline = false;
        hideOfflineBanner();
        
        const dateRange = getDateRange(state.period);
        const allData = await fetchSalesData(dateRange);
        
        state.data.dashboard = allData.dashboard;
        state.data.sales = allData.sales;
        state.data.products = allData.products;
        state.data.shifts = allData.shifts;
        
        // Кэшируем все данные
        setToCache(getCacheKey('dashboard', state.period), allData.dashboard);
        setToCache(getCacheKey('sales', state.period), allData.sales);
        setToCache(getCacheKey('products', state.period), allData.products);
        setToCache(getCacheKey('shifts', state.period), allData.shifts);
        
    } catch (error) {
        console.error('[Reports] Load data error:', error);
        
        // При ошибке пробуем загрузить из кэша
        const cached = getFromCache(cacheKey);
        if (cached) {
            state.data[state.activeTab] = cached;
            showNotification('Загружены данные из кэша (сервер недоступен)', 'info');
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

/**
 * Главная функция рендеринга
 */
async function render() {
    if (!DOM.content) return;
    
    const data = state.data[state.activeTab];
    
    if (!data || state.isLoading) {
        DOM.content.innerHTML = `
            <div class="reports-loader">
                <div class="loading-spinner large"></div>
                <p>Загрузка данных...</p>
            </div>
        `;
        return;
    }
    
    try {
        switch (state.activeTab) {
            case 'dashboard': {
                const dashboardModule = await import('./reports-dashboard.js');
                
                if (typeof dashboardModule.renderDashboard === 'function') {
                    DOM.content.innerHTML = dashboardModule.renderDashboard(data, state.period);
                    
                    if (typeof dashboardModule.renderCharts === 'function') {
                        setTimeout(() => dashboardModule.renderCharts(data.daily, data.paymentMethods), 100);
                    }
                    
                    window.__currentReportsModule = { 
                        exportData: dashboardModule.exportDashboardData 
                    };
                } else {
                    throw new Error('renderDashboard not found');
                }
                break;
            }
            case 'sales': {
                const tablesModule = await import('./reports-tables.js');
                
                if (typeof tablesModule.renderSalesTable === 'function') {
                    DOM.content.innerHTML = tablesModule.renderSalesTable(data);
                    window.__currentReportsModule = { 
                        exportData: tablesModule.exportSalesData 
                    };
                } else {
                    throw new Error('renderSalesTable not found');
                }
                break;
            }
            case 'products': {
                const tablesModule = await import('./reports-tables.js');
                
                if (typeof tablesModule.renderProductsTable === 'function') {
                    DOM.content.innerHTML = tablesModule.renderProductsTable(data);
                    window.__currentReportsModule = { 
                        exportData: tablesModule.exportProductsData 
                    };
                } else {
                    throw new Error('renderProductsTable not found');
                }
                break;
            }
            case 'shifts': {
                const tablesModule = await import('./reports-tables.js');
                
                if (typeof tablesModule.renderShiftsTable === 'function') {
                    DOM.content.innerHTML = tablesModule.renderShiftsTable(data);
                    window.__currentReportsModule = { 
                        exportData: tablesModule.exportShiftsData 
                    };
                } else {
                    throw new Error('renderShiftsTable not found');
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
        DOM.content.innerHTML = `
            <div class="error-state">
                <div class="empty-state-icon">⚠️</div>
                <h3>Ошибка загрузки модуля</h3>
                <p>${escapeHtml(error.message)}</p>
                <button class="btn-primary" onclick="location.reload()">Обновить страницу</button>
            </div>
        `;
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Кэширует DOM элементы
 */
function cacheElements() {
    DOM.content = document.getElementById('reportsContent');
    DOM.skeletonLoader = document.getElementById('skeletonLoader');
    DOM.periodSelect = document.getElementById('periodSelect');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.exportBtn = document.getElementById('exportBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
    DOM.lastSyncSpan = document.getElementById('lastSyncTime');
}

/**
 * Отображает email пользователя
 */
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

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.periodSelect) {
        DOM.periodSelect.addEventListener('change', (e) => {
            state.period = e.target.value;
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
    
    // Переключение вкладок
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
    
    // Слушатели сети
    window.addEventListener('online', () => {
        console.log('[Reports] Online detected');
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        loadData();
    });
    
    window.addEventListener('offline', () => {
        console.log('[Reports] Offline detected');
        state.isOffline = true;
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету. Работа в офлайн-режиме.', 'warning');
    });
}

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Reports] Initializing MPA page...');
    
    cacheElements();
    loadLastSyncTime();
    
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
        state.isOffline = !isOnline();
        
        if (state.isOffline) {
            showOfflineBanner();
        } else {
            hideOfflineBanner();
        }
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

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
