// ========================================
// FILE: ./js/inventory.js
// ========================================

import { supabase } from '../core/supabase.js';
import { requireAuth, logout } from '../core/auth.js';

// Проверяем авторизацию
const user = await requireAuth();
if (!user) throw new Error('Not authenticated');

console.log('[Inventory] User:', user.email);

// Выход
document.getElementById('logoutBtn').addEventListener('click', logout);

// Загружаем товары
async function loadProducts() {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="loading">Загрузка товаров...</div>';
    
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        renderProducts(data || []);
    } catch (error) {
        content.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
    }
}

function renderProducts(products) {
    const content = document.getElementById('content');
    
    if (products.length === 0) {
        content.innerHTML = '<div class="empty">Нет товаров</div>';
        return;
    }
    
    content.innerHTML = `
        <div class="products-header">
            <h2>Товары (${products.length})</h2>
            <button class="btn-primary" id="addProductBtn">+ Добавить</button>
        </div>
        <table class="products-table">
            <thead>
                <tr>
                    <th>Фото</th>
                    <th>Название</th>
                    <th>Категория</th>
                    <th>Цена</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${products.map(p => `
                    <tr>
                        <td>
                            ${p.photo_url 
                                ? `<img src="${p.photo_url}" width="50" height="50" style="object-fit: cover; border-radius: 4px;">` 
                                : '📦'
                            }
                        </td>
                        <td>
                            <strong>${escapeHtml(p.name)}</strong>
                            <br><small>ID: ${p.id.slice(0, 8)}</small>
                        </td>
                        <td>${p.category || '—'}</td>
                        <td>${formatMoney(p.price)}</td>
                        <td>
                            <span class="status-badge status-${p.status}">
                                ${getStatusText(p.status)}
                            </span>
                        </td>
                        <td>
                            <button class="btn-icon" data-edit="${p.id}">✎</button>
                            <button class="btn-icon btn-danger" data-delete="${p.id}">✕</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatMoney(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    }).format(amount);
}

function getStatusText(status) {
    return { in_stock: 'В наличии', sold: 'Продан', reserved: 'Забронирован' }[status] || status;
}

// Запускаем
loadProducts();
