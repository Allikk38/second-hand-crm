/**
 * Inventory Page Module - MPA Edition
 * 
 * Логика страницы управления складом. Загружает и отображает список товаров
 * в виде таблицы с возможностью поиска, фильтрации и CRUD-операций.
 * 
 * Архитектурные решения:
 * - Прямое использование глобального клиента window.supabase.
 * - Полная независимость от других страниц (MPA).
 * - Кэширование данных в sessionStorage.
 * - Кастомные модальные окна для подтверждения действий.
 * 
 * @module inventory
 * @version 3.2.0
 * @changes
 * - Убрана зависимость от core/supabase.js (используется window.supabase).
 * - Добавлено кэширование в sessionStorage.
 * - Заменен confirm() на кастомное модальное окно.
 * - Улучшена обработка офлайн-режима.
 */

import { requireAuth, logout, getCurrentUser, isOnline } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText, getCategoryName, debounce } from '../utils/formatters.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_CACHE_KEY = 'sh_inventory_products';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// ========== СОСТОЯНИЕ ==========

const state = {
    user: null,
    products: [],
    filteredProducts: [],
    isLoading: false,
    searchQuery: '',
    selectedStatus: '',
    selectedCategory: '',
    sortBy: 'created_at-desc',
    categories: []
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    tableBody: null,
    statsBar: null,
    errorBanner: null,
    errorMessage: null,
    emptyState: null,
    searchInput: null,
    statusFilter: null,
    categoryFilter: null,
    sortSelect: null,
    addProductBtn: null,
    refreshBtn: null,
    logoutBtn: null,
    userEmail: null,
    modalContainer: null
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getSupabase() {
    if (!window.supabase) {
        throw new Error('Supabase client not loaded');
    }
    
    if (!window.__supabaseClient) {
        window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    
    return window.__supabaseClient;
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-icon"></div>
        <div class="notification-content">
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
        <button class="notification-close">×</button>
    `;
    
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.remove();
    });
    
    container.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }
    }, 4000);
}

function showConfirmDialog({ title, message, confirmText = 'Да', cancelText = 'Нет' }) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal confirm-dialog">
                <div class="modal-header">
                    <h3>${escapeHtml(title)}</h3>
                    <button class="btn-close">×</button>
                </div>
                <div class="modal-body">
                    <div class="confirm-message">${escapeHtml(message)}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
                    <button class="btn-primary" data-action="confirm">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const close = () => {
            modal.remove();
            resolve(false);
        };
        
        modal.querySelector('.btn-close').addEventListener('click', close);
        modal.querySelector('[data-action="cancel"]').addEventListener('click', close);
        modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });
    });
}

function showError(message, type = 'error') {
    if (DOM.errorBanner && DOM.errorMessage) {
        DOM.errorMessage.textContent = message;
        DOM.errorBanner.style.display = 'flex';
        DOM.errorBanner.className = `error-banner error-banner-${type}`;
        
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                DOM.errorBanner.style.display = 'none';
            }, 3000);
        }
    } else {
        showNotification(message, type);
    }
}

function hideError() {
    if (DOM.errorBanner) {
        DOM.errorBanner.style.display = 'none';
    }
}

// ========== КЭШИРОВАНИЕ ==========

function saveProductsToCache(products) {
    try {
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            data: products,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('[Inventory] Failed to cache products:', e);
    }
}

function loadProductsFromCache() {
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) {
                return data;
            }
            sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
        }
    } catch (e) {
        console.warn('[Inventory] Failed to load cached products:', e);
    }
    return null;
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function loadProducts(forceRefresh = false) {
    if (state.isLoading) return;
    
    // Проверяем кэш
    if (!forceRefresh && !isOnline()) {
        const cached = loadProductsFromCache();
        if (cached) {
            state.products = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            showNotification('Работа в офлайн-режиме (данные из кэша)', 'warning');
            return;
        }
    }
    
    if (!isOnline()) {
        showError('Отсутствует подключение к интернету', 'warning');
        return;
    }
    
    state.isLoading = true;
    renderLoadingState();
    
    try {
        const supabase = getSupabase();
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        state.products = data || [];
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        
    } catch (error) {
        console.error('[Inventory] Load products error:', error);
        showError('Ошибка загрузки товаров: ' + error.message);
        
        // Пробуем загрузить из кэша
        const cached = loadProductsFromCache();
        if (cached) {
            state.products = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            showNotification('Загружены данные из кэша', 'info');
        }
    } finally {
        state.isLoading = false;
        render();
    }
}

function updateCategoryFilter() {
    const categories = new Set();
    state.products.forEach(p => {
        if (p.category) categories.add(p.category);
    });
    
    state.categories = Array.from(categories).sort();
    
    if (DOM.categoryFilter) {
        const currentValue = DOM.categoryFilter.value;
        
        while (DOM.categoryFilter.options.length > 1) {
            DOM.categoryFilter.remove(1);
        }
        
        state.categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = getCategoryName(cat);
            DOM.categoryFilter.appendChild(option);
        });
        
        if (currentValue) {
            DOM.categoryFilter.value = currentValue;
        }
    }
}

function applyFilters() {
    let filtered = [...state.products];
    
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name?.toLowerCase().includes(q) ||
            p.id?.toLowerCase().includes(q)
        );
    }
    
    if (state.selectedStatus) {
        filtered = filtered.filter(p => p.status === state.selectedStatus);
    }
    
    if (state.selectedCategory) {
        filtered = filtered.filter(p => p.category === state.selectedCategory);
    }
    
    filtered = sortProducts(filtered, state.sortBy);
    state.filteredProducts = filtered;
    render();
}

function sortProducts(products, sortBy) {
    const sorted = [...products];
    
    switch (sortBy) {
        case 'price-asc':
            return sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
        case 'price-desc':
            return sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
        case 'name-asc':
            return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        case 'created_at-desc':
        default:
            return sorted.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
            });
    }
}

function updateStats() {
    if (!DOM.statsBar) return;
    
    const total = state.products.length;
    const inStock = state.products.filter(p => p.status === 'in_stock').length;
    const sold = state.products.filter(p => p.status === 'sold').length;
    const reserved = state.products.filter(p => p.status === 'reserved').length;
    const totalValue = state.products
        .filter(p => p.status === 'in_stock')
        .reduce((sum, p) => sum + (p.price || 0), 0);
    
    DOM.statsBar.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Всего товаров</span>
            <span class="stat-value">${total}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">В наличии</span>
            <span class="stat-value text-success">${inStock}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Продано</span>
            <span class="stat-value text-danger">${sold}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Забронировано</span>
            <span class="stat-value text-warning">${reserved}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Стоимость склада</span>
            <span class="stat-value">${formatMoney(totalValue)}</span>
        </div>
    `;
}

// ========== CRUD ОПЕРАЦИИ ==========

async function deleteProduct(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    
    const confirmed = await showConfirmDialog({
        title: 'Удаление товара',
        message: `Вы уверены, что хотите удалить товар "${product.name}"? Это действие нельзя отменить.`,
        confirmText: 'Удалить'
    });
    
    if (!confirmed) return;
    
    if (!isOnline()) {
        showError('Отсутствует подключение к интернету', 'warning');
        return;
    }
    
    try {
        const supabase = getSupabase();
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        state.products = state.products.filter(p => p.id !== id);
        saveProductsToCache(state.products);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        
        showNotification('Товар удален', 'success');
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        showError('Ошибка удаления: ' + error.message);
    }
}

function openAddProductForm() {
    showNotification('Функция добавления товара в разработке', 'info');
}

function openEditProductForm(id) {
    showNotification(`Редактирование товара ${id} в разработке`, 'info');
}

// ========== РЕНДЕРИНГ ==========

function renderLoadingState() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.innerHTML = `
        <tr class="skeleton-row">
            <td colspan="6">
                <div class="loading-spinner"></div>
                <span style="margin-left: 12px;">Загрузка товаров...</span>
            </td>
        </tr>
    `;
}

function renderEmptyState() {
    if (!DOM.tableBody) return;
    
    let message = 'Товары не найдены';
    if (state.searchQuery || state.selectedStatus || state.selectedCategory) {
        message = 'По вашему запросу ничего не найдено';
    }
    
    DOM.tableBody.innerHTML = `
        <tr class="empty-row">
            <td colspan="6">
                <div class="empty-state-icon">📦</div>
                <p>${escapeHtml(message)}</p>
            </td>
        </tr>
    `;
}

function getStatusClass(status) {
    const classes = {
        'in_stock': 'status-in_stock',
        'sold': 'status-sold',
        'reserved': 'status-reserved',
        'draft': 'status-draft'
    };
    return classes[status] || 'status-unknown';
}

function render() {
    if (!DOM.tableBody) return;
    
    if (state.isLoading && state.products.length === 0) {
        renderLoadingState();
        return;
    }
    
    if (state.filteredProducts.length === 0) {
        renderEmptyState();
        return;
    }
    
    DOM.tableBody.innerHTML = state.filteredProducts.map(product => {
        const statusText = getStatusText(product.status);
        const statusClass = getStatusClass(product.status);
        const safeName = escapeHtml(product.name || 'Без названия');
        const safeId = escapeHtml(product.id?.slice(0, 8) || '—');
        const safePhotoUrl = product.photo_url ? escapeHtml(product.photo_url) : null;
        
        return `
            <tr class="product-row" data-id="${product.id}">
                <td class="photo-cell">
                    <div class="product-thumb">
                        ${safePhotoUrl 
                            ? `<img src="${safePhotoUrl}" alt="${safeName}" loading="lazy">` 
                            : '<span class="thumb-placeholder">📦</span>'
                        }
                    </div>
                </td>
                <td class="name-cell">
                    <div class="product-name">${safeName}</div>
                    <div class="product-id">ID: ${safeId}</div>
                </td>
                <td class="category-cell">${getCategoryName(product.category)}</td>
                <td class="price-cell">${formatMoney(product.price)}</td>
                <td class="status-cell">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td class="actions-cell">
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
        `;
    }).join('');
    
    attachRowEvents();
}

function attachRowEvents() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditProductForm(btn.dataset.id);
        });
    });
    
    DOM.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProduct(btn.dataset.id);
        });
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function cacheElements() {
    DOM.tableBody = document.getElementById('tableBody');
    DOM.statsBar = document.getElementById('statsBar');
    DOM.errorBanner = document.getElementById('errorBanner');
    DOM.errorMessage = document.getElementById('errorMessage');
    DOM.emptyState = document.getElementById('emptyState');
    DOM.searchInput = document.getElementById('searchInput');
    DOM.statusFilter = document.getElementById('statusFilter');
    DOM.categoryFilter = document.getElementById('categoryFilter');
    DOM.sortSelect = document.getElementById('sortSelect');
    DOM.addProductBtn = document.getElementById('addProductBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.userEmail = document.getElementById('userEmail');
    DOM.modalContainer = document.getElementById('modalContainer');
}

function displayUserInfo() {
    if (DOM.userEmail && state.user) {
        DOM.userEmail.textContent = state.user.email || 'Пользователь';
    }
}

function attachEvents() {
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            hideError();
            loadProducts(true);
        });
    }
    
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', openAddProductForm);
    }
    
    if (DOM.searchInput) {
        const debouncedSearch = debounce(() => {
            state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
            applyFilters();
        }, 300);
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            state.selectedStatus = e.target.value;
            applyFilters();
        });
    }
    
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            state.selectedCategory = e.target.value;
            applyFilters();
        });
    }
    
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            applyFilters();
        });
    }
}

async function init() {
    console.log('[Inventory] Initializing MPA page...');
    
    cacheElements();
    
    state.user = await requireAuth();
    if (!state.user) return;
    
    displayUserInfo();
    attachEvents();
    
    await loadProducts();
    
    console.log('[Inventory] Page initialized');
}

document.addEventListener('DOMContentLoaded', init);

export { init };
