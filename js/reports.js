// ========================================
// FILE: ./js/reports.js
// ========================================

/**
 * Reports Page Module
 * 
 * Логика страницы отчетов и аналитики. Отображает KPI, графики,
 * таблицы с данными о продажах, товарах и сменах.
 * 
 * Архитектурные решения:
 * - Полностью автономный модуль, работает только со своей страницей.
 * - Использует единый клиент из core/supabase.js.
 * - Кэширование данных в sessionStorage для быстрого переключения вкладок.
 * - Chart.js для визуализации данных.
 * - Расчет трендов по сравнению с предыдущим периодом.
 * 
 * @module reports
 * @version 2.0.0
 * @changes
 * - Добавлена полноценная визуализация графиков.
 * - Добавлена вкладка "Смены" с аналитикой по кассирам.
 * - Добавлено кэширование данных.
 * - Добавлен расчет трендов.
 * - Добавлен выбор кастомного диапазона дат.
 * - Улучшен экспорт данных.
 */

import { supabase } from '../core/supabase.js';
import { requireAuth, logout, getUserProfile } from '../core/auth.js';
import { 
    formatMoney, 
    formatNumber, 
    formatDate, 
    formatDateTime,
    formatPercent,
    escapeHtml, 
    getCategoryName, 
    getPaymentMethodName,
    debounce 
} from '../utils/formatters.js';

// ========== КОНСТАНТЫ ==========

const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const CACHE_KEY_PREFIX = 'reports_cache_';
const CHART_COLORS = {
    primary: '#2563eb',
    success: '#16a34a',
    warning: '#ea580c',
    danger: '#dc2626',
    info: '#0284c7',
    purple: '#7c3aed',
    gray: '#64748b'
};

// ========== СОСТОЯНИЕ ==========

/**
 * Состояние страницы отчетов
 * @type {Object}
 */
const state = {
    // UI
    activeTab: 'dashboard',
    period: 'week',
    customStartDate: null,
    customEndDate: null,
    isLoading: false,
    
    // Данные
    data: {
        dashboard: null,
        sales: null,
        products: null,
        shifts: null
    },
    
    // Кэш
    cache: new Map(),
    
    // Графики
    charts: new Map(),
    
    // Пользователь
    user: null,
    profile: null
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
    notificationContainer: null
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Reports] Initializing...');
    
    // Проверяем авторизацию
    state.user = await requireAuth();
    if (!state.user) return;
    
    // Получаем профиль
    state.profile = await getUserProfile();
    
    // Кэшируем DOM элементы
    cacheElements();
    
    // Отображаем информацию о пользователе
    displayUserInfo();
    
    // Привязываем события
    attachEvents();
    
    // Загружаем данные
    await loadData();
    
    console.log('[Reports] Initialized');
}

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
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.notificationContainer = document.getElementById('notificationContainer');
}

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.periodSelect) {
        DOM.periodSelect.addEventListener('change', () => {
            state.period = DOM.periodSelect.value;
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
    
    if (DOM.exportBtn) {
        DOM.exportBtn.addEventListener('click', exportCurrentTab);
    }
    
    // Переключение вкладок
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            document.querySelectorAll('[data-tab]').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            
            state.activeTab = tab;
            
            if (!state.data[tab]) {
                loadData();
            } else {
                render();
            }
        });
    });
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

/**
 * Загружает данные для активной вкладки
 */
async function loadData() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    showLoader();
    
    try {
        const dateRange = getDateRange();
        const cacheKey = getCacheKey(state.activeTab, dateRange);
        
        // Проверяем кэш
        const cached = getFromCache(cacheKey);
        if (cached) {
            console.log('[Reports] Using cached data for', state.activeTab);
            state.data[state.activeTab] = cached;
            hideLoader();
            render();
            return;
        }
        
        let data = null;
        
        switch (state.activeTab) {
            case 'dashboard':
                data = await loadDashboardData(dateRange);
                break;
            case 'sales':
                data = await loadSalesData(dateRange);
                break;
            case 'products':
                data = await loadProductsData(dateRange);
                break;
            case 'shifts':
                data = await loadShiftsData(dateRange);
                break;
        }
        
        state.data[state.activeTab] = data;
        
        // Сохраняем в кэш
        setToCache(cacheKey, data);
        
    } catch (error) {
        console.error('[Reports] Load data error:', error);
        showNotification('Ошибка загрузки данных: ' + error.message, 'error');
    } finally {
        state.isLoading = false;
        hideLoader();
        render();
    }
}

/**
 * Загружает данные для дашборда
 */
async function loadDashboardData({ start, end, previousStart, previousEnd }) {
    // Текущий период
    const { data: sales, error } = await supabase
        .from('sales')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    // Предыдущий период для трендов
    const { data: previousSales } = await supabase
        .from('sales')
        .select('total, profit')
        .gte('created_at', previousStart)
        .lte('created_at', previousEnd);
    
    // Товары в наличии
    const { count: inStock } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'in_stock');
    
    // Общая себестоимость склада
    const { data: stockValue } = await supabase
        .from('products')
        .select('price, cost_price')
        .eq('status', 'in_stock');
    
    const salesData = sales || [];
    const prevSalesData = previousSales || [];
    
    // Статистика
    const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    const prevRevenue = prevSalesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const prevProfit = prevSalesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    
    // Тренды
    const revenueTrend = calculateTrend(totalRevenue, prevRevenue);
    const profitTrend = calculateTrend(totalProfit, prevProfit);
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;
    const marginTrend = calculateTrend(margin, prevMargin);
    
    // Группировка по дням
    const daily = groupByDay(salesData);
    
    // Топ товаров
    const topProducts = calculateTopProducts(salesData);
    
    // Топ категорий
    const topCategories = calculateTopCategories(salesData);
    
    // Способы оплаты
    const paymentMethods = calculatePaymentMethods(salesData);
    
    // Стоимость склада
    const totalStockValue = (stockValue || []).reduce((sum, p) => sum + (p.price || 0), 0);
    const totalCostValue = (stockValue || []).reduce((sum, p) => sum + (p.cost_price || 0), 0);
    
    return {
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
            revenue: revenueTrend,
            profit: profitTrend,
            margin: marginTrend,
            salesCount: calculateTrend(salesData.length, prevSalesData.length)
        },
        daily,
        topProducts,
        topCategories,
        paymentMethods
    };
}

/**
 * Загружает данные о продажах
 */
async function loadSalesData({ start, end }) {
    const { data: sales, error } = await supabase
        .from('sales')
        .select(`
            *,
            shifts (
                user_id
            )
        `)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const salesData = sales || [];
    
    // Получаем профили пользователей
    const userIds = [...new Set(salesData.map(s => s.shifts?.user_id).filter(Boolean))];
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
    
    const userMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
    
    // Обогащаем данные
    const enrichedSales = salesData.map(sale => ({
        ...sale,
        seller_name: userMap.get(sale.shifts?.user_id) || 'Неизвестно'
    }));
    
    const totalRevenue = enrichedSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = enrichedSales.reduce((sum, s) => sum + (s.profit || 0), 0);
    
    return {
        summary: {
            count: enrichedSales.length,
            revenue: totalRevenue,
            profit: totalProfit,
            averageCheck: enrichedSales.length > 0 ? totalRevenue / enrichedSales.length : 0
        },
        sales: enrichedSales,
        byPaymentMethod: calculatePaymentMethods(enrichedSales),
        bySeller: calculateBySeller(enrichedSales, userMap)
    };
}

/**
 * Загружает данные о товарах
 */
async function loadProductsData({ start, end }) {
    // Продажи за период
    const { data: sales } = await supabase
        .from('sales')
        .select('items, created_at')
        .gte('created_at', start)
        .lte('created_at', end);
    
    // Все товары в наличии
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'in_stock')
        .order('created_at', { ascending: true });
    
    // Топ продаваемых
    const topProducts = calculateTopProducts(sales || []);
    
    // Залежавшиеся товары
    const now = new Date();
    const slowMoving = (products || [])
        .map(p => ({
            ...p,
            daysInStock: Math.floor((now - new Date(p.created_at)) / (1000 * 60 * 60 * 24))
        }))
        .filter(p => p.daysInStock > 30)
        .sort((a, b) => b.daysInStock - a.daysInStock);
    
    // Товары с низкой маржой
    const lowMargin = (products || [])
        .filter(p => p.cost_price && p.price)
        .map(p => ({
            ...p,
            margin: ((p.price - p.cost_price) / p.price) * 100
        }))
        .filter(p => p.margin < 20)
        .sort((a, b) => a.margin - b.margin);
    
    return {
        topProducts,
        slowMoving: slowMoving.slice(0, 20),
        lowMargin: lowMargin.slice(0, 20),
        inventoryValue: (products || []).reduce((sum, p) => sum + (p.price || 0), 0),
        inventoryCost: (products || []).reduce((sum, p) => sum + (p.cost_price || 0), 0)
    };
}

/**
 * Загружает данные о сменах
 */
async function loadShiftsData({ start, end }) {
    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .gte('opened_at', start)
        .lte('opened_at', end)
        .order('opened_at', { ascending: false });
    
    if (error) throw error;
    
    const shiftsData = shifts || [];
    
    // Получаем профили
    const userIds = [...new Set(shiftsData.map(s => s.user_id))];
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
    
    const userMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
    
    // Обогащаем данные
    const enrichedShifts = shiftsData.map(shift => ({
        ...shift,
        seller_name: userMap.get(shift.user_id) || 'Неизвестно',
        duration: shift.closed_at 
            ? formatDuration(new Date(shift.closed_at) - new Date(shift.opened_at))
            : 'Активна'
    }));
    
    // Статистика по продавцам
    const bySeller = {};
    enrichedShifts.forEach(shift => {
        const seller = shift.seller_name;
        if (!bySeller[seller]) {
            bySeller[seller] = {
                shifts: 0,
                revenue: 0,
                profit: 0,
                salesCount: 0
            };
        }
        bySeller[seller].shifts++;
        bySeller[seller].revenue += shift.total_revenue || 0;
        bySeller[seller].profit += shift.total_profit || 0;
        bySeller[seller].salesCount += shift.sales_count || 0;
    });
    
    return {
        shifts: enrichedShifts,
        bySeller,
        summary: {
            totalShifts: enrichedShifts.length,
            activeShifts: enrichedShifts.filter(s => !s.closed_at).length,
            totalRevenue: enrichedShifts.reduce((sum, s) => sum + (s.total_revenue || 0), 0),
            totalProfit: enrichedShifts.reduce((sum, s) => sum + (s.total_profit || 0), 0)
        }
    };
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДАННЫХ ==========

/**
 * Получает диапазон дат
 */
function getDateRange() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    let previousStart = new Date(today);
    let previousEnd = new Date(today);
    
    switch (state.period) {
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
    }
    
    return {
        start: start.toISOString(),
        end: now.toISOString(),
        previousStart: previousStart.toISOString(),
        previousEnd: previousEnd.toISOString()
    };
}

/**
 * Группирует продажи по дням
 */
function groupByDay(sales) {
    const daily = {};
    
    sales.forEach(s => {
        const day = s.created_at.split('T')[0];
        if (!daily[day]) {
            daily[day] = { date: day, revenue: 0, profit: 0, count: 0 };
        }
        daily[day].revenue += s.total || 0;
        daily[day].profit += s.profit || 0;
        daily[day].count++;
    });
    
    return Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Рассчитывает топ товаров
 */
function calculateTopProducts(sales) {
    const stats = new Map();
    
    sales.forEach(s => {
        if (!s.items) return;
        s.items.forEach(i => {
            const key = i.id;
            const cur = stats.get(key) || { 
                id: i.id, 
                name: i.name, 
                quantity: 0, 
                revenue: 0 
            };
            cur.quantity += i.quantity || 1;
            cur.revenue += (i.price || 0) * (i.quantity || 1);
            stats.set(key, cur);
        });
    });
    
    return Array.from(stats.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
}

/**
 * Рассчитывает топ категорий
 */
function calculateTopCategories(sales) {
    const stats = new Map();
    
    sales.forEach(s => {
        if (!s.items) return;
        s.items.forEach(i => {
            const cat = i.category || 'other';
            const cur = stats.get(cat) || { category: cat, revenue: 0, quantity: 0 };
            cur.revenue += (i.price || 0) * (i.quantity || 1);
            cur.quantity += i.quantity || 1;
            stats.set(cat, cur);
        });
    });
    
    return Array.from(stats.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
}

/**
 * Рассчитывает статистику по способам оплаты
 */
function calculatePaymentMethods(sales) {
    const stats = new Map();
    
    sales.forEach(s => {
        const method = s.payment_method || 'unknown';
        const cur = stats.get(method) || { method, count: 0, revenue: 0 };
        cur.count++;
        cur.revenue += s.total || 0;
        stats.set(method, cur);
    });
    
    return Array.from(stats.values());
}

/**
 * Рассчитывает статистику по продавцам
 */
function calculateBySeller(sales, userMap) {
    const stats = new Map();
    
    sales.forEach(s => {
        const sellerId = s.shifts?.user_id;
        const sellerName = userMap.get(sellerId) || 'Неизвестно';
        
        const cur = stats.get(sellerName) || { 
            name: sellerName, 
            sales: 0, 
            revenue: 0, 
            profit: 0 
        };
        cur.sales++;
        cur.revenue += s.total || 0;
        cur.profit += s.profit || 0;
        stats.set(sellerName, cur);
    });
    
    return Array.from(stats.values()).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Рассчитывает тренд
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
 * Форматирует длительность
 */
function formatDuration(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return `${hours} ч ${minutes} мин`;
    }
    return `${minutes} мин`;
}

// ========== РЕНДЕРИНГ ==========

/**
 * Отрисовывает страницу
 */
function render() {
    if (!DOM.content) return;
    
    const data = state.data[state.activeTab];
    
    if (!data) {
        renderEmptyState();
        return;
    }
    
    switch (state.activeTab) {
        case 'dashboard':
            renderDashboard(data);
            break;
        case 'sales':
            renderSales(data);
            break;
        case 'products':
            renderProducts(data);
            break;
        case 'shifts':
            renderShifts(data);
            break;
    }
}

/**
 * Отрисовывает дашборд
 */
function renderDashboard(data) {
    const { overview, trends, daily, topProducts, topCategories, paymentMethods } = data;
    
    DOM.content.innerHTML = `
        <!-- KPI -->
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-title">💰 Выручка</div>
                <div class="kpi-value">${formatMoney(overview.revenue)}</div>
                ${renderTrend(trends.revenue)}
            </div>
            <div class="kpi-card">
                <div class="kpi-title">📈 Прибыль</div>
                <div class="kpi-value">${formatMoney(overview.profit)}</div>
                ${renderTrend(trends.profit)}
            </div>
            <div class="kpi-card">
                <div class="kpi-title">🎯 Маржа</div>
                <div class="kpi-value">${formatPercent(overview.margin, { decimals: 1 })}</div>
                ${renderTrend(trends.margin)}
            </div>
            <div class="kpi-card">
                <div class="kpi-title">🛒 Продаж</div>
                <div class="kpi-value">${formatNumber(overview.salesCount)}</div>
                ${renderTrend(trends.salesCount)}
            </div>
            <div class="kpi-card">
                <div class="kpi-title">💳 Средний чек</div>
                <div class="kpi-value">${formatMoney(overview.averageCheck)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">📦 Стоимость склада</div>
                <div class="kpi-value">${formatMoney(overview.stockValue)}</div>
            </div>
        </div>
        
        <!-- Графики -->
        <div class="charts-row">
            <div class="chart-card">
                <h3>Динамика продаж</h3>
                <div class="chart-container">
                    <canvas id="salesChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <h3>Способы оплаты</h3>
                <div class="chart-container">
                    <canvas id="paymentChart"></canvas>
                </div>
            </div>
        </div>
        
        <!-- Топ товары и категории -->
        <div class="charts-row">
            <div class="chart-card">
                <h3>🔥 Топ-5 товаров</h3>
                <div class="top-products-list">
                    ${topProducts.slice(0, 5).map((p, i) => `
                        <div class="top-product-item">
                            <span class="top-product-rank">#${i + 1}</span>
                            <div class="top-product-info">
                                <div class="top-product-name">${escapeHtml(p.name)}</div>
                                <div class="top-product-stats">${p.quantity} шт.</div>
                            </div>
                            <span class="top-product-revenue">${formatMoney(p.revenue)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="chart-card">
                <h3>📂 Топ категорий</h3>
                <div class="top-products-list">
                    ${topCategories.map((c, i) => `
                        <div class="top-product-item">
                            <span class="top-product-rank">#${i + 1}</span>
                            <div class="top-product-info">
                                <div class="top-product-name">${getCategoryName(c.category)}</div>
                                <div class="top-product-stats">${c.quantity} шт.</div>
                            </div>
                            <span class="top-product-revenue">${formatMoney(c.revenue)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    
    // Рендерим графики
    setTimeout(() => {
        renderSalesChart(daily);
        renderPaymentChart(paymentMethods);
    }, 100);
}

/**
 * Отрисовывает вкладку продаж
 */
function renderSales(data) {
    const { summary, sales, byPaymentMethod, bySeller } = data;
    
    DOM.content.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-title">Всего продаж</div>
                <div class="kpi-value">${formatNumber(summary.count)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Выручка</div>
                <div class="kpi-value">${formatMoney(summary.revenue)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Прибыль</div>
                <div class="kpi-value">${formatMoney(summary.profit)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Средний чек</div>
                <div class="kpi-value">${formatMoney(summary.averageCheck)}</div>
            </div>
        </div>
        
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>Продавец</th>
                        <th>Товаров</th>
                        <th>Сумма</th>
                        <th>Прибыль</th>
                        <th>Оплата</th>
                    </tr>
                </thead>
                <tbody>
                    ${sales.length === 0 ? `
                        <tr><td colspan="6" style="text-align: center; padding: 40px;">Нет продаж за период</td></tr>
                    ` : sales.slice(0, 50).map(s => `
                        <tr>
                            <td>${formatDateTime(s.created_at)}</td>
                            <td>${escapeHtml(s.seller_name)}</td>
                            <td>${s.items?.length || 0} поз.</td>
                            <td class="money">${formatMoney(s.total)}</td>
                            <td class="money">${formatMoney(s.profit)}</td>
                            <td>${getPaymentMethodName(s.payment_method)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Отрисовывает вкладку товаров
 */
function renderProducts(data) {
    const { topProducts, slowMoving, lowMargin, inventoryValue, inventoryCost } = data;
    
    DOM.content.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-title">Стоимость склада</div>
                <div class="kpi-value">${formatMoney(inventoryValue)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Себестоимость</div>
                <div class="kpi-value">${formatMoney(inventoryCost)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Потенциальная прибыль</div>
                <div class="kpi-value">${formatMoney(inventoryValue - inventoryCost)}</div>
            </div>
        </div>
        
        <div class="charts-row">
            <div class="chart-card">
                <h3>🏆 Самые продаваемые</h3>
                <div class="top-products-list">
                    ${topProducts.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--color-text-muted);">Нет данных</p>' : ''}
                    ${topProducts.slice(0, 10).map((p, i) => `
                        <div class="top-product-item">
                            <span class="top-product-rank">#${i + 1}</span>
                            <div class="top-product-info">
                                <div class="top-product-name">${escapeHtml(p.name)}</div>
                                <div class="top-product-stats">${p.quantity} шт.</div>
                            </div>
                            <span class="top-product-revenue">${formatMoney(p.revenue)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="chart-card">
                <h3>🐌 Залежавшиеся товары (>30 дней)</h3>
                <div class="top-products-list">
                    ${slowMoving.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--color-text-muted);">Нет залежавшихся товаров</p>' : ''}
                    ${slowMoving.slice(0, 10).map(p => `
                        <div class="slow-item">
                            <span class="top-product-name">${escapeHtml(p.name)}</span>
                            <span class="slow-days">${p.daysInStock} дн.</span>
                            <span class="top-product-revenue">${formatMoney(p.price)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        ${lowMargin.length > 0 ? `
            <div class="chart-card">
                <h3>⚠️ Товары с низкой маржой (<20%)</h3>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Название</th>
                                <th>Цена</th>
                                <th>Себестоимость</th>
                                <th>Маржа</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${lowMargin.slice(0, 10).map(p => `
                                <tr>
                                    <td>${escapeHtml(p.name)}</td>
                                    <td class="money">${formatMoney(p.price)}</td>
                                    <td class="money">${formatMoney(p.cost_price)}</td>
                                    <td class="money" style="color: var(--color-warning-dark);">${formatPercent(p.margin, { decimals: 1 })}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : ''}
    `;
}

/**
 * Отрисовывает вкладку смен
 */
function renderShifts(data) {
    const { shifts, bySeller, summary } = data;
    
    DOM.content.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-title">Всего смен</div>
                <div class="kpi-value">${formatNumber(summary.totalShifts)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Активных смен</div>
                <div class="kpi-value">${formatNumber(summary.activeShifts)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Выручка за период</div>
                <div class="kpi-value">${formatMoney(summary.totalRevenue)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Прибыль за период</div>
                <div class="kpi-value">${formatMoney(summary.totalProfit)}</div>
            </div>
        </div>
        
        <div class="charts-row">
            <div class="chart-card">
                <h3>👥 Статистика по продавцам</h3>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Продавец</th>
                                <th>Смен</th>
                                <th>Продаж</th>
                                <th>Выручка</th>
                                <th>Прибыль</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(bySeller).map(([name, stats]) => `
                                <tr>
                                    <td>${escapeHtml(name)}</td>
                                    <td>${stats.shifts}</td>
                                    <td>${stats.salesCount}</td>
                                    <td class="money">${formatMoney(stats.revenue)}</td>
                                    <td class="money">${formatMoney(stats.profit)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Открыта</th>
                        <th>Закрыта</th>
                        <th>Продавец</th>
                        <th>Длительность</th>
                        <th>Продаж</th>
                        <th>Выручка</th>
                        <th>Статус</th>
                    </tr>
                </thead>
                <tbody>
                    ${shifts.length === 0 ? `
                        <tr><td colspan="7" style="text-align: center; padding: 40px;">Нет смен за период</td></tr>
                    ` : shifts.map(s => `
                        <tr>
                            <td>${formatDateTime(s.opened_at)}</td>
                            <td>${s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                            <td>${escapeHtml(s.seller_name)}</td>
                            <td>${s.duration}</td>
                            <td>${s.sales_count || 0}</td>
                            <td class="money">${formatMoney(s.total_revenue || 0)}</td>
                            <td>
                                <span class="status-badge ${s.closed_at ? 'in_stock' : 'reserved'}">
                                    ${s.closed_at ? 'Закрыта' : 'Активна'}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Отрисовывает тренд
 */
function renderTrend(trend) {
    if (!trend || trend.value === 0) return '';
    
    const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
    
    return `
        <span class="kpi-trend trend-${trend.direction}">
            ${arrow} ${trend.value}%
        </span>
    `;
}

/**
 * Отрисовывает пустое состояние
 */
function renderEmptyState() {
    DOM.content.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <p>Нет данных для отображения</p>
        </div>
    `;
}

// ========== ГРАФИКИ ==========

/**
 * Отрисовывает график продаж
 */
function renderSalesChart(daily) {
    const canvas = document.getElementById('salesChart');
    if (!canvas || !window.Chart) return;
    
    // Уничтожаем старый график
    if (state.charts.has('sales')) {
        state.charts.get('sales').destroy();
    }
    
    const chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: daily.map(d => formatDate(d.date, { short: true })),
            datasets: [
                {
                    label: 'Выручка',
                    data: daily.map(d => d.revenue),
                    borderColor: CHART_COLORS.primary,
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Прибыль',
                    data: daily.map(d => d.profit),
                    borderColor: CHART_COLORS.success,
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            return `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: (val) => formatMoney(val, { showSymbol: false })
                    }
                }
            }
        }
    });
    
    state.charts.set('sales', chart);
}

/**
 * Отрисовывает график способов оплаты
 */
function renderPaymentChart(paymentMethods) {
    const canvas = document.getElementById('paymentChart');
    if (!canvas || !window.Chart) return;
    
    if (state.charts.has('payment')) {
        state.charts.get('payment').destroy();
    }
    
    const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: paymentMethods.map(p => getPaymentMethodName(p.method)),
            datasets: [{
                data: paymentMethods.map(p => p.revenue),
                backgroundColor: [
                    CHART_COLORS.primary,
                    CHART_COLORS.success,
                    CHART_COLORS.warning,
                    CHART_COLORS.purple
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const item = paymentMethods[ctx.dataIndex];
                            const percent = (item.revenue / paymentMethods.reduce((s, p) => s + p.revenue, 0) * 100).toFixed(1);
                            return `${item.count} продаж (${percent}%) - ${formatMoney(item.revenue)}`;
                        }
                    }
                }
            }
        }
    });
    
    state.charts.set('payment', chart);
}

// ========== ЭКСПОРТ ==========

/**
 * Экспортирует данные текущей вкладки
 */
function exportCurrentTab() {
    const data = state.data[state.activeTab];
    if (!data) {
        showNotification('Нет данных для экспорта', 'warning');
        return;
    }
    
    let csv = '';
    let filename = `report_${state.activeTab}_${formatDate(new Date())}.csv`;
    
    switch (state.activeTab) {
        case 'dashboard':
            csv = exportDashboard(data);
            break;
        case 'sales':
            csv = exportSales(data);
            break;
        case 'products':
            csv = exportProducts(data);
            break;
        case 'shifts':
            csv = exportShifts(data);
            break;
    }
    
    downloadCSV(csv, filename);
    showNotification('Экспорт завершен', 'success');
}

/**
 * Экспортирует дашборд
 */
function exportDashboard(data) {
    const { overview, daily } = data;
    
    let csv = 'Дашборд\n\n';
    csv += 'Показатель,Значение\n';
    csv += `Выручка,${overview.revenue}\n`;
    csv += `Прибыль,${overview.profit}\n`;
    csv += `Маржа,${overview.margin.toFixed(1)}%\n`;
    csv += `Продаж,${overview.salesCount}\n`;
    csv += `Средний чек,${overview.averageCheck}\n`;
    csv += `Товаров в наличии,${overview.inStock}\n`;
    
    csv += '\n\nДинамика по дням\n';
    csv += 'Дата,Выручка,Прибыль,Продаж\n';
    daily.forEach(d => {
        csv += `${d.date},${d.revenue},${d.profit},${d.count}\n`;
    });
    
    return csv;
}

/**
 * Экспортирует продажи
 */
function exportSales(data) {
    let csv = 'Дата,Продавец,Товаров,Сумма,Прибыль,Оплата\n';
    
    data.sales.forEach(s => {
        csv += `"${formatDateTime(s.created_at)}",`;
        csv += `"${s.seller_name}",`;
        csv += `${s.items?.length || 0},`;
        csv += `${s.total || 0},`;
        csv += `${s.profit || 0},`;
        csv += `"${getPaymentMethodName(s.payment_method)}"\n`;
    });
    
    return csv;
}

/**
 * Экспортирует товары
 */
function exportProducts(data) {
    let csv = 'Топ товаров\n';
    csv += 'Название,Количество,Выручка\n';
    data.topProducts.forEach(p => {
        csv += `"${p.name}",${p.quantity},${p.revenue}\n`;
    });
    
    csv += '\n\nЗалежавшиеся товары\n';
    csv += 'Название,Дней на складе,Цена\n';
    data.slowMoving.forEach(p => {
        csv += `"${p.name}",${p.daysInStock},${p.price}\n`;
    });
    
    return csv;
}

/**
 * Экспортирует смены
 */
function exportShifts(data) {
    let csv = 'Открыта,Закрыта,Продавец,Длительность,Продаж,Выручка,Прибыль,Статус\n';
    
    data.shifts.forEach(s => {
        csv += `"${formatDateTime(s.opened_at)}",`;
        csv += `"${s.closed_at ? formatDateTime(s.closed_at) : ''}",`;
        csv += `"${s.seller_name}",`;
        csv += `"${s.duration}",`;
        csv += `${s.sales_count || 0},`;
        csv += `${s.total_revenue || 0},`;
        csv += `${s.total_profit || 0},`;
        csv += `"${s.closed_at ? 'Закрыта' : 'Активна'}"\n`;
    });
    
    return csv;
}

/**
 * Скачивает CSV файл
 */
function downloadCSV(csv, filename) {
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Генерирует ключ кэша
 */
function getCacheKey(tab, dateRange) {
    return `${CACHE_KEY_PREFIX}${tab}_${state.period}_${dateRange.start}_${dateRange.end}`;
}

/**
 * Получает данные из кэша
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
    } catch {
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
    } catch (e) {
        console.warn('[Reports] Cache set error:', e);
    }
}

/**
 * Очищает кэш
 */
function clearCache() {
    Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith(CACHE_KEY_PREFIX)) {
            sessionStorage.removeItem(key);
        }
    });
}

// ========== UI ВСПОМОГАТЕЛЬНЫЕ ==========

/**
 * Отображает информацию о пользователе
 */
function displayUserInfo() {
    if (DOM.userEmail) {
        const name = state.profile?.full_name || state.user?.email?.split('@')[0] || 'Пользователь';
        DOM.userEmail.textContent = name;
    }
}

/**
 * Показывает лоадер
 */
function showLoader() {
    if (DOM.skeletonLoader) {
        DOM.skeletonLoader.style.display = 'block';
    }
}

/**
 * Скрывает лоадер
 */
function hideLoader() {
    if (DOM.skeletonLoader) {
        DOM.skeletonLoader.style.display = 'none';
    }
}

/**
 * Показывает уведомление
 */
function showNotification(message, type = 'info') {
    if (!DOM.notificationContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-left: 3px solid;
    `;
    
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    notification.style.borderLeftColor = colors[type] || colors.info;
    notification.textContent = message;
    
    DOM.notificationContainer.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
