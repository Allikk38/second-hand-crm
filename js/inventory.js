/**
 * Inventory Page Module
 * 
 * Логика страницы управления складом. Загрузка и отображение товаров.
 * 
 * Архитектурные решения:
 * - Минималистичный подход, только базовая функциональность.
 * - Использует единый клиент из core/supabase.js.
 * - Простой поиск без дебаунса.
 * 
 * @module inventory
 * @version 3.0.0
 * @changes
 * - Полный рефакторинг: удалена пагинация, модалки, массовые операции.
 * - Оставлена только загрузка и отображение списка товаров.
 * - Упрощена логика до минимально рабочей.
 */

import { supabase } from '../core/supabase.js';
import { requireAuth, logout } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText } from '../utils/formatters.js';

// ========== СОСТОЯНИЕ ==========

const state = {
    products: [],
    isLoading: false,
    searchQuery: '',
    user: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    tableBody: document.getElementById('tableBody'),
    searchInput: document.getElementById('searchInput'),
    addProductBtn: document.getElementById('addProductBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    userEmail: document.getElementById('userEmail'),
    statsBar: document.getElementById('statsBar'),
    emptyState: document.getElementById('emptyState'),
    skeletonLoader: document.getElementById('skeletonLoader')
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Inventory] Initializing...');
    
    // Проверяем авторизацию
    state.user = await requireAuth();
    if (!state.user) return;
    
    // Отображаем email пользователя
    if (DOM.userEmail) {
        DOM.userEmail.textContent = state.user.email;
    }
    
    // Привязываем события
    attachEvents();
    
    // Загружаем товары
    await loadProducts();
    
    console.log('[Inventory] Initialized');
}

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', loadProducts);
    }
    
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', () => {
            alert('Функция добавления товара в разработке');
        });
    }
    
    if (DOM.searchInput) {
        DOM.searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value.toLowerCase();
            renderTable();
        });
    }
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

/**
 * Загружает список товаров
 */
async function loadProducts() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    showLoader();
    
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        state.products = data || [];
        updateStats();
        renderTable();
        
    } catch (error) {
        console.error('[Inventory] Load products error:', error);
        alert('Ошибка загрузки товаров: ' + error.message);
        renderEmptyState('Ошибка загрузки данных');
    } finally {
        state.isLoading = false;
        hideLoader();
    }
}

// ========== РЕНДЕРИНГ ==========

/**
 * Обновляет статистику
 */
function updateStats() {
    if (!DOM.statsBar) return;
    
    const total = state.products.length;
    const inStock = state.products.filter(p => p.status === 'in_stock').length;
    const sold = state.products.filter(p => p.status === 'sold').length;
    const totalValue = state.products
        .filter(p => p.status === 'in_stock')
        .reduce((sum, p) => sum + (p.price || 0), 0);
    
    DOM.statsBar.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Всего товаров:</span>
            <span class="stat-value">${total}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">В наличии:</span>
            <span class="stat-value success">${inStock}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Продано:</span>
            <span class="stat-value danger">${sold}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Стоимость склада:</span>
            <span class="stat-value">${formatMoney(totalValue)}</span>
        </div>
    `;
}

/**
 * Отрисовывает таблицу товаров
 */
function renderTable() {
    if (!DOM.tableBody) return;
    
    let filteredProducts = state.products;
    
    // Применяем поиск
    if (state.searchQuery) {
        filteredProducts = state.products.filter(p => 
            p.name.toLowerCase().includes(state.searchQuery) ||
            p.id?.toLowerCase().includes(state.searchQuery)
        );
    }
    
    if (filteredProducts.length === 0) {
        const message = state.searchQuery 
            ? 'По вашему запросу ничего не найдено' 
            : 'Товары не найдены';
        renderEmptyState(message);
        DOM.tableBody.innerHTML = '';
        return;
    }
    
    if (DOM.emptyState) {
        DOM.emptyState.style.display = 'none';
    }
    
    DOM.tableBody.innerHTML = filteredProducts.map(product => `
        <tr data-id="${product.id}">
            <td>
                <div class="product-thumb">
                    ${product.photo_url 
                        ? `<img src="${escapeHtml(product.photo_url)}" alt="${escapeHtml(product.name)}">` 
                        : '<span class="placeholder">📦</span>'
                    }
                </div>
            </td>
            <td>
                <div class="product-name">${escapeHtml(product.name)}</div>
                <div class="product-id">ID: ${product.id?.slice(0, 8)}</div>
            </td>
            <td>${formatMoney(product.price)}</td>
            <td>
                <span class="status-badge ${product.status}">
                    ${getStatusText(product.status)}
                </span>
            </td>
            <td>
                <div class="row-actions">
                    <button class="btn-icon" data-action="edit" data-id="${product.id}" title="Редактировать">
                        ✎
                    </button>
                    <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" title="Удалить">
                        ✕
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    // Привязываем события к кнопкам
    DOM.tableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            alert(`Редактирование товара ${id} в разработке`);
        });
    });
    
    DOM.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            if (confirm('Удалить товар?')) {
                deleteProduct(id);
            }
        });
    });
}

/**
 * Отрисовывает пустое состояние
 */
function renderEmptyState(message = 'Товары не найдены') {
    if (DOM.emptyState) {
        DOM.emptyState.style.display = 'flex';
        const messageEl = DOM.emptyState.querySelector('p') || document.getElementById('emptyStateMessage');
        if (messageEl) messageEl.textContent = message;
    }
    if (DOM.tableBody) DOM.tableBody.innerHTML = '';
}

/**
 * Удаляет товар
 */
async function deleteProduct(id) {
    try {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        alert('Товар удален');
        await loadProducts();
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        alert('Ошибка удаления: ' + error.message);
    }
}

// ========== УПРАВЛЕНИЕ ЗАГРУЗКОЙ ==========

function showLoader() {
    if (DOM.skeletonLoader) DOM.skeletonLoader.style.display = 'block';
    if (DOM.tableBody) DOM.tableBody.style.display = 'none';
    if (DOM.emptyState) DOM.emptyState.style.display = 'none';
}

function hideLoader() {
    if (DOM.skeletonLoader) DOM.skeletonLoader.style.display = 'none';
    if (DOM.tableBody) DOM.tableBody.style.display = '';
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
