// ========================================
// FILE: ./js/cashier.js
// ========================================

import { supabase } from '../core/supabase.js';
import { requireAuth, logout } from '../core/auth.js';
import { formatMoney, escapeHtml, getCategoryName } from '../utils/formatters.js';

// Проверяем авторизацию
const user = await requireAuth();
if (!user) throw new Error('Not authenticated');

console.log('[Cashier] User:', user.email);

// Состояние
let currentShift = null;
let shiftStats = { revenue: 0, salesCount: 0, profit: 0 };
let products = [];
let filteredProducts = [];
let cartItems = [];
let searchQuery = '';
let selectedCategory = null;

// DOM элементы
const content = document.getElementById('cashierContent');

// Выход
document.getElementById('logoutBtn').addEventListener('click', logout);

// Инициализация
async function init() {
    await checkShift();
    await loadProducts();
}

async function checkShift() {
    try {
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('user_id', user.id)
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        currentShift = data || null;
        
        if (currentShift) {
            await loadShiftStats();
        }
        
        render();
    } catch (error) {
        console.error('[Cashier] Shift check error:', error);
        currentShift = null;
        render();
    }
}

async function loadShiftStats() {
    if (!currentShift) return;
    
    try {
        const { data, error } = await supabase
            .from('sales')
            .select('total, profit')
            .eq('shift_id', currentShift.id);
        
        if (error) throw error;
        
        const sales = data || [];
        shiftStats = {
            revenue: sales.reduce((sum, s) => sum + (s.total || 0), 0),
            salesCount: sales.length,
            profit: sales.reduce((sum, s) => sum + (s.profit || 0), 0)
        };
    } catch (error) {
        console.error('[Cashier] Stats error:', error);
    }
}

async function loadProducts() {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('status', 'in_stock')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        products = data || [];
        filteredProducts = products;
        render();
    } catch (error) {
        console.error('[Cashier] Products error:', error);
    }
}

async function openShift() {
    try {
        const { data, error } = await supabase
            .from('shifts')
            .insert({
                user_id: user.id,
                opened_at: new Date().toISOString(),
                initial_cash: 0,
                status: 'active'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        currentShift = data;
        shiftStats = { revenue: 0, salesCount: 0, profit: 0 };
        render();
    } catch (error) {
        alert('Ошибка открытия смены: ' + error.message);
    }
}

async function closeShift() {
    if (!currentShift) return;
    
    const confirmed = confirm(`Закрыть смену? Выручка: ${formatMoney(shiftStats.revenue)}`);
    if (!confirmed) return;
    
    try {
        const { error } = await supabase
            .from('shifts')
            .update({
                closed_at: new Date().toISOString(),
                final_cash: shiftStats.revenue,
                total_revenue: shiftStats.revenue,
                total_profit: shiftStats.profit,
                sales_count: shiftStats.salesCount,
                status: 'closed'
            })
            .eq('id', currentShift.id);
        
        if (error) throw error;
        
        currentShift = null;
        shiftStats = { revenue: 0, salesCount: 0, profit: 0 };
        cartItems = [];
        render();
    } catch (error) {
        alert('Ошибка закрытия смены: ' + error.message);
    }
}

function addToCart(product) {
    const existing = cartItems.find(i => i.id === product.id);
    
    if (existing) {
        existing.quantity += 1;
    } else {
        cartItems.push({ ...product, quantity: 1 });
    }
    
    render();
}

function updateQuantity(id, delta) {
    const item = cartItems.find(i => i.id === id);
    if (!item) return;
    
    const newQty = item.quantity + delta;
    
    if (newQty <= 0) {
        cartItems = cartItems.filter(i => i.id !== id);
    } else {
        item.quantity = newQty;
    }
    
    render();
}

function removeItem(id) {
    cartItems = cartItems.filter(i => i.id !== id);
    render();
}

function clearCart() {
    if (cartItems.length === 0) return;
    if (confirm('Очистить корзину?')) {
        cartItems = [];
        render();
    }
}

async function checkout() {
    if (cartItems.length === 0) return;
    if (!currentShift) return;
    
    const total = cartItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    
    // Простое окно выбора оплаты
    const paymentMethods = ['cash', 'card', 'transfer'];
    const methodNames = ['Наличные', 'Карта', 'Перевод'];
    
    const methodChoice = prompt(
        'Выберите способ оплаты:\n1 - Наличные\n2 - Карта\n3 - Перевод',
        '1'
    );
    
    const methodIndex = parseInt(methodChoice) - 1;
    const method = paymentMethods[methodIndex] || 'cash';
    
    try {
        const items = cartItems.map(i => ({
            id: i.id,
            name: i.name,
            price: i.price,
            cost_price: i.cost_price || 0,
            quantity: i.quantity
        }));
        
        const profit = items.reduce((sum, i) => sum + (i.price - i.cost_price) * i.quantity, 0);
        
        const { error } = await supabase
            .from('sales')
            .insert({
                shift_id: currentShift.id,
                items,
                total,
                profit,
                payment_method: method,
                created_at: new Date().toISOString()
            });
        
        if (error) throw error;
        
        // Обновляем статус товаров
        const ids = items.map(i => i.id);
        await supabase
            .from('products')
            .update({ status: 'sold', updated_at: new Date().toISOString() })
            .in('id', ids);
        
        cartItems = [];
        await loadShiftStats();
        await loadProducts();
        
        alert(`Продажа на ${formatMoney(total)}`);
    } catch (error) {
        alert('Ошибка: ' + error.message);
    }
}

function filterProducts() {
    let filtered = products;
    
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(q) || 
            p.id.toLowerCase().includes(q)
        );
    }
    
    if (selectedCategory) {
        filtered = filtered.filter(p => p.category === selectedCategory);
    }
    
    filteredProducts = filtered;
}

function getCategories() {
    const counts = new Map();
    products.forEach(p => {
        const cat = p.category || 'other';
        counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
}

function render() {
    filterProducts();
    
    if (!currentShift) {
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: calc(100vh - 56px); text-align: center;">
                <h2 style="margin-bottom: 12px;">🔒 Смена закрыта</h2>
                <p style="margin-bottom: 20px; color: #64748b;">Для начала работы откройте смену</p>
                <button class="btn-primary" id="openShiftBtn">Открыть смену</button>
            </div>
        `;
        document.getElementById('openShiftBtn').addEventListener('click', openShift);
        return;
    }
    
    const categories = getCategories();
    const cartTotal = cartItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    const cartCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
    
    content.innerHTML = `
        <div class="cashier-layout">
            <div class="products-panel">
                <div class="shift-bar">
                    <div class="shift-status">
                        <span class="status-dot"></span>
                        <span>Смена открыта</span>
                        <span style="font-size: 12px; color: #64748b;">
                            ${new Date(currentShift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div class="shift-stats">
                        <div class="stat-item">
                            <span class="stat-label">Выручка</span>
                            <span class="stat-value">${formatMoney(shiftStats.revenue)}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Продаж</span>
                            <span class="stat-value">${shiftStats.salesCount}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Прибыль</span>
                            <span class="stat-value">${formatMoney(shiftStats.profit)}</span>
                        </div>
                    </div>
                    <button class="btn-secondary" id="closeShiftBtn">Закрыть смену</button>
                </div>
                
                <div class="products-toolbar">
                    <div class="search-wrapper">
                        <span class="search-icon">🔍</span>
                        <input 
                            type="text" 
                            class="search-input" 
                            placeholder="Поиск товара..." 
                            id="searchInput"
                            value="${escapeHtml(searchQuery)}"
                        >
                    </div>
                </div>
                
                <div class="category-bar">
                    <button class="category-tab ${!selectedCategory ? 'active' : ''}" data-category="">
                        Все (${products.length})
                    </button>
                    ${categories.map(c => `
                        <button class="category-tab ${selectedCategory === c.value ? 'active' : ''}" data-category="${c.value}">
                            ${getCategoryName(c.value)} (${c.count})
                        </button>
                    `).join('')}
                </div>
                
                <div class="products-grid">
                    ${filteredProducts.map(p => `
                        <div class="product-card" data-id="${p.id}">
                            <div class="product-photo">
                                ${p.photo_url 
                                    ? `<img src="${p.photo_url}" alt="${escapeHtml(p.name)}">` 
                                    : '📦'
                                }
                            </div>
                            <div class="product-info">
                                <div class="product-name">${escapeHtml(p.name)}</div>
                                <div class="product-price">${formatMoney(p.price)}</div>
                            </div>
                        </div>
                    `).join('')}
                    ${filteredProducts.length === 0 ? '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #94a3b8;">Товары не найдены</div>' : ''}
                </div>
            </div>
            
            <div class="cart-panel">
                <div class="cart-header">
                    <h3>🛒 Корзина</h3>
                    <span class="cart-count">${cartCount} поз.</span>
                    ${cartCount > 0 ? '<button class="btn-ghost" id="clearCartBtn">Очистить</button>' : ''}
                </div>
                
                <div class="cart-items">
                    ${cartItems.length === 0 ? `
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: #94a3b8;">
                            <div style="font-size: 48px; opacity: 0.3;">🛒</div>
                            <p>Корзина пуста</p>
                        </div>
                    ` : cartItems.map(item => `
                        <div class="cart-item">
                            <div class="cart-item-info">
                                <div class="cart-item-name">${escapeHtml(item.name)}</div>
                                <div class="cart-item-price">${formatMoney(item.price)} × ${item.quantity}</div>
                            </div>
                            <div class="cart-item-actions">
                                <button class="qty-btn" data-decrease="${item.id}">−</button>
                                <span class="item-qty">${item.quantity}</span>
                                <button class="qty-btn" data-increase="${item.id}">+</button>
                                <span class="item-total">${formatMoney(item.price * item.quantity)}</span>
                                <button class="remove-btn" data-remove="${item.id}">✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="cart-footer">
                    <div class="cart-total">
                        <span>ИТОГО</span>
                        <span>${formatMoney(cartTotal)}</span>
                    </div>
                    <button class="btn-checkout" id="checkoutBtn" ${cartCount === 0 ? 'disabled' : ''}>
                        Оформить продажу
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Привязка событий
    document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);
    document.getElementById('clearCartBtn')?.addEventListener('click', clearCart);
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
    
    const searchInputEl = document.getElementById('searchInput');
    if (searchInputEl) {
        searchInputEl.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            render();
        });
    }
    
    document.querySelectorAll('[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedCategory = btn.dataset.category || null;
            render();
        });
    });
    
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const product = products.find(p => p.id === id);
            if (product) addToCart(product);
        });
    });
    
    document.querySelectorAll('[data-decrease]').forEach(btn => {
        btn.addEventListener('click', () => updateQuantity(btn.dataset.decrease, -1));
    });
    
    document.querySelectorAll('[data-increase]').forEach(btn => {
        btn.addEventListener('click', () => updateQuantity(btn.dataset.increase, 1));
    });
    
    document.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => removeItem(btn.dataset.remove));
    });
}

// Запуск
init();
