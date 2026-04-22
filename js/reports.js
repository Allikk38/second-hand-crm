// ========================================
// FILE: ./js/reports.js
// ========================================

import { supabase } from '../core/supabase.js';
import { requireAuth, logout } from '../core/auth.js';
import { formatMoney, formatNumber, escapeHtml, getCategoryName, getPaymentMethodName } from '../utils/formatters.js';

// Проверяем авторизацию
const user = await requireAuth();
if (!user) throw new Error('Not authenticated');

console.log('[Reports] User:', user.email);

// Состояние
let activeTab = 'dashboard';
let period = 'week';
let reportData = { dashboard: null, sales: null, products: null };
let isLoading = false;

// DOM элементы
const content = document.getElementById('reportsContent');
const periodSelect = document.getElementById('periodSelect');
const refreshBtn = document.getElementById('refreshBtn');

// Выход
document.getElementById('logoutBtn').addEventListener('click', logout);

// Привязка событий
periodSelect.addEventListener('change', (e) => {
    period = e.target.value;
    loadData();
});

refreshBtn.addEventListener('click', () => loadData());

document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (!reportData[activeTab]) {
            loadData();
        } else {
            render();
        }
    });
});

// Загрузка данных
async function loadData() {
    if (isLoading) return;
    
    isLoading = true;
    render();
    
    const dateRange = getDateRange(period);
    
    try {
        let data = null;
        
        switch (activeTab) {
            case 'dashboard':
                data = await loadDashboardData(dateRange);
                break;
            case 'sales':
                data = await loadSalesData(dateRange);
                break;
            case 'products':
                data = await loadProductsData();
                break;
        }
        
        reportData[activeTab] = data;
    } catch (error) {
        console.error('[Reports] Load error:', error);
    } finally {
        isLoading = false;
        render();
    }
}

function getDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    
    switch (period) {
        case 'today': break;
        case 'yesterday':
            start.setDate(today.getDate() - 1);
            break;
        case 'week':
            start.setDate(today.getDate() - 7);
            break;
        case 'month':
            start.setMonth(today.getMonth() - 1);
            break;
        default:
            start.setDate(today.getDate() - 7);
    }
    
    return { start: start.toISOString(), end: now.toISOString() };
}

async function loadDashboardData({ start, end }) {
    // Продажи за период
    const { data: sales, error } = await supabase
        .from('sales')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    const salesData = sales || [];
    
    // Статистика
    const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    
    // Товары в наличии
    const { count: inStock } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'in_stock');
    
    // Группировка по дням
    const daily = {};
    salesData.forEach(s => {
        const day = s.created_at.split('T')[0];
        if (!daily[day]) daily[day] = { date: day, revenue: 0, profit: 0, count: 0 };
        daily[day].revenue += s.total || 0;
        daily[day].profit += s.profit || 0;
        daily[day].count++;
    });
    
    // Топ товаров
    const productStats = new Map();
    salesData.forEach(s => {
        if (!s.items) return;
        s.items.forEach(i => {
            const key = i.id;
            const cur = productStats.get(key) || { id: i.id, name: i.name, quantity: 0, revenue: 0 };
            cur.quantity += i.quantity || 1;
            cur.revenue += (i.price || 0) * (i.quantity || 1);
            productStats.set(key, cur);
        });
    });
    
    const topProducts = Array.from(productStats.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);
    
    return {
        overview: {
            revenue: totalRevenue,
            profit: totalProfit,
            margin,
            salesCount: salesData.length,
            averageCheck: salesData.length > 0 ? totalRevenue / salesData.length : 0,
            inStock: inStock || 0
        },
        daily: Object.values(daily),
        topProducts
    };
}

async function loadSalesData({ start, end }) {
    const { data: sales, error } = await supabase
        .from('sales')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const salesData = sales || [];
    const totalRevenue = salesData.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = salesData.reduce((sum, s) => sum + (s.profit || 0), 0);
    
    return {
        summary: {
            count: salesData.length,
            revenue: totalRevenue,
            profit: totalProfit,
            averageCheck: salesData.length > 0 ? totalRevenue / salesData.length : 0
        },
        sales: salesData
    };
}

async function loadProductsData() {
    // Топ продаваемых
    const { data: sales } = await supabase.from('sales').select('items');
    
    const productStats = new Map();
    (sales || []).forEach(s => {
        if (!s.items) return;
        s.items.forEach(i => {
            const key = i.id;
            const cur = productStats.get(key) || { id: i.id, name: i.name, quantity: 0, revenue: 0 };
            cur.quantity += i.quantity || 1;
            cur.revenue += (i.price || 0) * (i.quantity || 1);
            productStats.set(key, cur);
        });
    });
    
    const topProducts = Array.from(productStats.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);
    
    // Залежавшиеся товары
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'in_stock')
        .order('created_at', { ascending: true });
    
    const now = new Date();
    const slowMoving = (products || [])
        .map(p => ({
            ...p,
            daysInStock: Math.floor((now - new Date(p.created_at)) / (1000 * 60 * 60 * 24))
        }))
        .filter(p => p.daysInStock > 30)
        .sort((a, b) => b.daysInStock - a.daysInStock)
        .slice(0, 10);
    
    return { topProducts, slowMoving };
}

function render() {
    if (isLoading) {
        content.innerHTML = '<div class="loading">Загрузка данных...</div>';
        return;
    }
    
    const data = reportData[activeTab];
    
    if (!data) {
        content.innerHTML = '<div class="empty-state">Нет данных</div>';
        return;
    }
    
    switch (activeTab) {
        case 'dashboard':
            renderDashboard(data);
            break;
        case 'sales':
            renderSales(data);
            break;
        case 'products':
            renderProducts(data);
            break;
    }
}

function renderDashboard(data) {
    const { overview, daily, topProducts } = data;
    
    content.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-title">💰 Выручка</div>
                <div class="kpi-value">${formatMoney(overview.revenue)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">📈 Прибыль</div>
                <div class="kpi-value">${formatMoney(overview.profit)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">🎯 Маржа</div>
                <div class="kpi-value">${overview.margin.toFixed(1)}%</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">🛒 Продаж</div>
                <div class="kpi-value">${formatNumber(overview.salesCount)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">💳 Средний чек</div>
                <div class="kpi-value">${formatMoney(overview.averageCheck)}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">📦 В наличии</div>
                <div class="kpi-value">${formatNumber(overview.inStock)}</div>
            </div>
        </div>
        
        <div class="chart-card">
            <h4>🔥 Топ-5 товаров</h4>
            <div style="margin-top: 16px;">
                ${topProducts.map((p, i) => `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                        <span><strong>#${i + 1}</strong> ${escapeHtml(p.name)}</span>
                        <span>${p.quantity} шт. · ${formatMoney(p.revenue)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="chart-card">
            <h4>📊 Динамика по дням</h4>
            <div class="table-container" style="margin-top: 16px;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Дата</th>
                            <th>Продаж</th>
                            <th>Выручка</th>
                            <th>Прибыль</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${daily.map(d => `
                            <tr>
                                <td>${new Date(d.date).toLocaleDateString('ru-RU')}</td>
                                <td>${d.count}</td>
                                <td>${formatMoney(d.revenue)}</td>
                                <td>${formatMoney(d.profit)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderSales(data) {
    const { summary, sales } = data;
    
    content.innerHTML = `
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
                        <th>Товаров</th>
                        <th>Сумма</th>
                        <th>Прибыль</th>
                        <th>Оплата</th>
                    </tr>
                </thead>
                <tbody>
                    ${sales.length === 0 ? '<tr><td colspan="5" style="text-align: center; padding: 40px;">Нет продаж за период</td></tr>' : ''}
                    ${sales.slice(0, 50).map(s => `
                        <tr>
                            <td>${new Date(s.created_at).toLocaleString('ru-RU')}</td>
                            <td>${s.items?.length || 0} поз.</td>
                            <td>${formatMoney(s.total)}</td>
                            <td>${formatMoney(s.profit)}</td>
                            <td>${getPaymentMethodName(s.payment_method)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderProducts(data) {
    const { topProducts, slowMoving } = data;
    
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <div class="chart-card">
                <h4>🏆 Самые продаваемые</h4>
                <div style="margin-top: 16px;">
                    ${topProducts.length === 0 ? '<p style="color: #94a3b8;">Нет данных</p>' : ''}
                    ${topProducts.map((p, i) => `
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                            <span><strong>#${i + 1}</strong> ${escapeHtml(p.name)}</span>
                            <span>${p.quantity} шт. · ${formatMoney(p.revenue)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="chart-card">
                <h4>🐌 Залежавшиеся товары</h4>
                <div style="margin-top: 16px;">
                    ${slowMoving.length === 0 ? '<p style="color: #94a3b8;">Нет залежавшихся товаров</p>' : ''}
                    ${slowMoving.map(p => `
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                            <span>${escapeHtml(p.name)}</span>
                            <span style="color: #ef4444;">${p.daysInStock} дн.</span>
                            <span>${formatMoney(p.price)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

// Запуск
loadData();
