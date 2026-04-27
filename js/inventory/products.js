// ========================================
// FILE: js/inventory/products.js
// ========================================

/**
 * Products Module - Inventory (Supabase Version)
 * 
 * Сервис управления данными товаров на складе.
 * Восстановлена работа через Supabase через db.js.
 * 
 * @module inventory/products
 * @version 3.0.1
 * @changes
 * - v3.0.1: В функции getCategoryName используется categorySchema (единый источник).
 * - Убрана лишняя заглушка в sortProducts.
 */

import { products as productsDb } from '../../core/db.js';
import { getCategoryName } from '../../utils/formatters.js';

// ========== КОНСТАНТЫ ==========

const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 минут
const CACHE_KEY = 'inventory_products_cache';

// ========== СОСТОЯНИЕ ТОВАРОВ ==========

export const productsState = {
    all: [],
    filtered: [],
    categories: [],
    isLoading: false,
    searchQuery: '',
    selectedStatus: '',
    selectedCategory: '',
    sortBy: 'created_at-desc',
    stats: {
        total: 0,
        inStock: 0,
        sold: 0,
        reserved: 0,
        stockValue: 0,
        potentialProfit: 0
    }
};

// ========== ПОДПИСКА НА ИЗМЕНЕНИЯ ==========

/** @type {Function|null} */
let onChangeCallback = null;

export function setProductsChangeCallback(callback) {
    onChangeCallback = callback;
}

function notifyProductsChanged() {
    if (onChangeCallback) {
        onChangeCallback();
    }
}

// ========== ОБРАБОТКА КАТЕГОРИЙ ==========

function updateCategoryFilter() {
    const counts = new Map();
    
    productsState.all.forEach(p => {
        const cat = p.category || 'other';
        counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    
    productsState.categories = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
}

// ========== ФИЛЬТРАЦИЯ И СОРТИРОВКА ==========

function applyFilters() {
    let filtered = [...productsState.all];
    
    // Поиск
    if (productsState.searchQuery) {
        const q = productsState.searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name?.toLowerCase().includes(q) ||
            p.id?.toLowerCase().includes(q)
        );
    }
    
    // Статус
    if (productsState.selectedStatus) {
        filtered = filtered.filter(p => p.status === productsState.selectedStatus);
    }
    
    // Категория
    if (productsState.selectedCategory) {
        filtered = filtered.filter(p => p.category === productsState.selectedCategory);
    }
    
    // Сортировка
    filtered = sortProducts(filtered, productsState.sortBy);
    
    productsState.filtered = filtered;
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

// ========== СТАТИСТИКА ==========

function updateStats() {
    const all = productsState.all;
    const inStock = all.filter(p => p.status === 'in_stock' && !p._deleted);
    
    productsState.stats = {
        total: all.filter(p => !p._deleted).length,
        inStock: inStock.length,
        sold: all.filter(p => p.status === 'sold' && !p._deleted).length,
        reserved: all.filter(p => p.status === 'reserved' && !p._deleted).length,
        stockValue: inStock.reduce((sum, p) => sum + (p.price || 0), 0),
        potentialProfit: inStock.reduce((sum, p) => sum + ((p.price || 0) - (p.cost_price || 0)), 0)
    };
}

// ========== УСТАНОВКА ФИЛЬТРОВ ==========

export function setSearchQuery(query) {
    productsState.searchQuery = query || '';
    applyFilters();
    notifyProductsChanged();
}

export function setStatusFilter(status) {
    productsState.selectedStatus = status || '';
    applyFilters();
    notifyProductsChanged();
}

export function setCategoryFilter(category) {
    productsState.selectedCategory = category || '';
    applyFilters();
    notifyProductsChanged();
}

export function setSortBy(sortBy) {
    productsState.sortBy = sortBy || 'created_at-desc';
    applyFilters();
    notifyProductsChanged();
}

export function resetFilters() {
    productsState.searchQuery = '';
    productsState.selectedStatus = '';
    productsState.selectedCategory = '';
    productsState.sortBy = 'created_at-desc';
    applyFilters();
    notifyProductsChanged();
}

// ========== ЗАГРУЗКА ТОВАРОВ ==========

/**
 * Загружает товары через Supabase
 */
export async function loadProducts(forceRefresh = false) {
    if (productsState.isLoading) return false;
    
    console.log('[Products] Loading products...');
    productsState.isLoading = true;
    notifyProductsChanged();
    
    try {
        // Пробуем кэш (если не принудительное обновление)
        if (!forceRefresh) {
            const cached = loadFromCache();
            if (cached) {
                console.log('[Products] Using cached data');
                productsState.all = cached;
                updateCategoryFilter();
                applyFilters();
                updateStats();
                productsState.isLoading = false;
                notifyProductsChanged();
                return true;
            }
        }
        
        // Загружаем с сервера
        const data = await productsDb.getAll();
        productsState.all = data || [];
        
        console.log('[Products] Loaded from server:', productsState.all.length);
        
        // Сохраняем в кэш
        saveToCache(productsState.all);
        
        updateCategoryFilter();
        applyFilters();
        updateStats();
        notifyProductsChanged();
        
        return true;
        
    } catch (error) {
        console.error('[Products] Load error:', error);
        
        // При ошибке пробуем кэш
        const cached = loadFromCache();
        if (cached && cached.length > 0) {
            console.log('[Products] Falling back to cached data');
            productsState.all = cached;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            notifyProductsChanged();
        }
        
        return false;
    } finally {
        productsState.isLoading = false;
        notifyProductsChanged();
    }
}

// ========== КЭШИРОВАНИЕ ==========

function saveToCache(data) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('[Products] Failed to save cache:', e);
    }
}

function loadFromCache() {
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_MAX_AGE) {
                return data;
            }
        }
    } catch (e) {
        console.warn('[Products] Failed to load cache:', e);
    }
    return null;
}

// ========== ОБНОВЛЕНИЕ СОСТОЯНИЯ ==========

export function refreshProductsList() {
    updateCategoryFilter();
    applyFilters();
    updateStats();
    notifyProductsChanged();
}

export function addProductToState(product) {
    productsState.all.unshift(product);
    refreshProductsList();
}

export function updateProductInState(productId, updatedProduct) {
    const index = productsState.all.findIndex(p => p.id === productId);
    if (index !== -1) {
        productsState.all[index] = updatedProduct;
        refreshProductsList();
        return true;
    }
    return false;
}

export function removeProductFromState(productId) {
    const index = productsState.all.findIndex(p => p.id === productId);
    if (index !== -1) {
        productsState.all[index]._deleted = true;
        refreshProductsList();
        return true;
    }
    return false;
}

// ========== ГЕТТЕРЫ ==========

export function getAllProducts() { return [...productsState.all]; }
export function getFilteredProducts() { return [...productsState.filtered]; }
export function getCategories() { return [...productsState.categories]; }
export function getStats() { return { ...productsState.stats }; }

export function getProductById(id) {
    return productsState.all.find(p => p.id === id) || null;
}

export function isLoading() { return productsState.isLoading; }
export function getSearchQuery() { return productsState.searchQuery; }
export function getSelectedStatus() { return productsState.selectedStatus; }
export function getSelectedCategory() { return productsState.selectedCategory; }
export function getSortBy() { return productsState.sortBy; }

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    productsState,
    setProductsChangeCallback,
    loadProducts,
    refreshProductsList,
    setSearchQuery,
    setStatusFilter,
    setCategoryFilter,
    setSortBy,
    resetFilters,
    addProductToState,
    updateProductInState,
    removeProductFromState,
    getAllProducts,
    getFilteredProducts,
    getCategories,
    getStats,
    getProductById,
    isLoading,
    getSearchQuery,
    getSelectedStatus,
    getSelectedCategory,
    getSortBy
};

console.log('[Products] Module loaded (Supabase Version)');
