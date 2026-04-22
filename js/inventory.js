// ========================================
// FILE: ./js/inventory.js
// ========================================

import { supabase } from '../core/supabase.js';
import { requireAuth, logout } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText, getCategoryName } from '../utils/formatters.js';

// Проверяем авторизацию
const user = await requireAuth();
if (!user) throw new Error('Not authenticated');

console.log('[Inventory] User:', user.email);

// Состояние
let products = [];
let filteredProducts = [];
let categories = [];
let searchQuery = '';
let selectedCategory = '';
let selectedStatus = '';

// DOM элементы
const content = document.getElementById('content');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const statusFilter = document.getElementById('statusFilter');
const statsBar = document.getElementById('statsBar');

// Выход
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('addProductBtn').addEventListener('click', openProductForm);
document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

// Загрузка товаров
async function loadProducts() {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        products = data || [];
        buildCategories();
        applyFilters();
        renderStats();
        render();
    } catch (error) {
        content.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
    }
}

function buildCategories() {
    const counts = new Map();
    products.forEach(p => {
        const cat = p.category || 'other';
        counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    
    categories = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
    
    categoryFilter.innerHTML = '<option value="">Все категории</option>';
    categories.forEach(c => {
        const option = document.createElement('option');
        option.value = c.value;
        option.textContent = `${getCategoryName(c.value)} (${c.count})`;
        categoryFilter.appendChild(option);
    });
}

function applyFilters() {
    filteredProducts = products.filter(p => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (!p.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) {
                return false;
            }
        }
        if (selectedCategory && p.category !== selectedCategory) return false;
        if (selectedStatus && p.status !== selectedStatus) return false;
        return true;
    });
}

function renderStats() {
    const inStock = products.filter(p => p.status === 'in_stock').length;
    const sold = products.filter(p => p.status === 'sold').length;
    const totalValue = products
        .filter(p => p.status === 'in_stock')
        .reduce((sum, p) => sum + (p.price || 0), 0);
    
    statsBar.innerHTML = `
        <div class="stats">
            <span>Всего: ${products.length}</span>
            <span class="success">В наличии: ${inStock}</span>
            <span class="danger">Продано: ${sold}</span>
            <span>Стоимость: ${formatMoney(totalValue)}</span>
        </div>
    `;
}

function render() {
    if (filteredProducts.length === 0) {
        content.innerHTML = '<div class="empty-state">📭 Товары не найдены</div>';
        return;
    }
    
    content.innerHTML = `
        <table class="products-table">
            <thead>
                <tr>
                    <th width="80">Фото</th>
                    <th>Название</th>
                    <th>Категория</th>
                    <th>Цена</th>
                    <th>Себестоимость</th>
                    <th>Статус</th>
                    <th width="100">Действия</th>
                </tr>
            </thead>
            <tbody>
                ${filteredProducts.map(p => `
                    <tr>
                        <td>
                            ${p.photo_url 
                                ? `<img src="${p.photo_url}" width="50" height="50" style="object-fit: cover; border-radius: 6px;">` 
                                : '<span style="font-size: 24px;">📦</span>'
                            }
                        </td>
                        <td>
                            <strong>${escapeHtml(p.name)}</strong>
                            <br><small style="color: #94a3b8;">ID: ${p.id.slice(0, 8)}</small>
                        </td>
                        <td>${getCategoryName(p.category)}</td>
                        <td><strong>${formatMoney(p.price)}</strong></td>
                        <td style="color: #64748b;">${formatMoney(p.cost_price)}</td>
                        <td>
                            <span class="status-badge status-${p.status}">
                                ${getStatusText(p.status)}
                            </span>
                        </td>
                        <td>
                            <div class="row-actions">
                                <button class="btn-icon" data-edit="${p.id}">✎</button>
                                <button class="btn-icon btn-danger" data-delete="${p.id}">✕</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    // Привязка событий
    document.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => editProduct(btn.dataset.edit));
    });
    
    document.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteProduct(btn.dataset.delete));
    });
}

function openProductForm(product = null) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${product ? 'Редактирование' : 'Новый товар'}</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
            </div>
            <div class="modal-body">
                <form id="productForm">
                    <div class="form-group">
                        <label>Название *</label>
                        <input type="text" name="name" class="form-control" value="${escapeHtml(product?.name || '')}" required>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Цена *</label>
                            <input type="number" name="price" class="form-control" value="${product?.price || ''}" step="0.01" min="0" required>
                        </div>
                        <div class="form-group">
                            <label>Себестоимость</label>
                            <input type="number" name="cost_price" class="form-control" value="${product?.cost_price || ''}" step="0.01" min="0">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Категория</label>
                        <select name="category" class="form-control">
                            <option value="">Выберите</option>
                            <option value="clothes" ${product?.category === 'clothes' ? 'selected' : ''}>Одежда</option>
                            <option value="toys" ${product?.category === 'toys' ? 'selected' : ''}>Игрушки</option>
                            <option value="dishes" ${product?.category === 'dishes' ? 'selected' : ''}>Посуда</option>
                            <option value="other" ${product?.category === 'other' ? 'selected' : ''}>Другое</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Статус</label>
                        <select name="status" class="form-control">
                            <option value="in_stock" ${product?.status === 'in_stock' ? 'selected' : ''}>В наличии</option>
                            <option value="sold" ${product?.status === 'sold' ? 'selected' : ''}>Продан</option>
                            <option value="reserved" ${product?.status === 'reserved' ? 'selected' : ''}>Забронирован</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Отмена</button>
                <button class="btn-primary" id="saveProductBtn">${product ? 'Сохранить' : 'Создать'}</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    document.getElementById('saveProductBtn').addEventListener('click', async () => {
        const form = document.getElementById('productForm');
        const formData = new FormData(form);
        
        const data = {
            name: formData.get('name'),
            price: parseFloat(formData.get('price')),
            cost_price: parseFloat(formData.get('cost_price')) || 0,
            category: formData.get('category') || 'other',
            status: formData.get('status')
        };
        
        try {
            if (product) {
                const { error } = await supabase
                    .from('products')
                    .update({ ...data, updated_at: new Date().toISOString() })
                    .eq('id', product.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('products')
                    .insert({ ...data, created_at: new Date().toISOString(), created_by: user.id });
                if (error) throw error;
            }
            
            modal.remove();
            loadProducts();
        } catch (error) {
            alert('Ошибка: ' + error.message);
        }
    });
}

function editProduct(id) {
    const product = products.find(p => p.id === id);
    if (product) openProductForm(product);
}

async function deleteProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;
    
    if (!confirm(`Удалить "${product.name}"?`)) return;
    
    try {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
        loadProducts();
    } catch (error) {
        alert('Ошибка: ' + error.message);
    }
}

function clearFilters() {
    searchQuery = '';
    selectedCategory = '';
    selectedStatus = '';
    searchInput.value = '';
    categoryFilter.value = '';
    statusFilter.value = '';
    applyFilters();
    render();
}

// Привязка фильтров
searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
    render();
});

categoryFilter.addEventListener('change', (e) => {
    selectedCategory = e.target.value;
    applyFilters();
    render();
});

statusFilter.addEventListener('change', (e) => {
    selectedStatus = e.target.value;
    applyFilters();
    render();
});

// Запуск
loadProducts();
