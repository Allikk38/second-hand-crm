// ========================================
// FILE: js/cashier/products.js
// ========================================

/**
 * Products Module - Cashier
 * 
 * Управление товарами в кассовом модуле.
 * Отвечает за загрузку товаров, фильтрацию, категории,
 * кэширование и быстрое добавление новых товаров.
 * 
 * @module cashier/products
 * @version 1.0.1
 * @changes
 * - v1.0.1: getSupabase() теперь с await (официальный SDK)
 */

import { getSupabase, isOnline } from '../../core/auth.js';
import { debounce, getCategoryName } from '../../utils/formatters.js';
import { showNotification } from '../../utils/ui.js';
import { openProductFormModal } from '../../utils/product-form.js';
import { addToCart } from './cart.js';
import { isShiftOpen } from './shift.js';

const PRODUCTS_CACHE_KEY = 'sh_cashier_products';
const CACHE_TTL = 5 * 60 * 1000;
const SCANNER_DEBOUNCE_MS = 300;

export const productsState = {
    all: [],
    filtered: [],
    categories: [],
    searchQuery: '',
    selectedCategory: null,
    isLoading: false
};

let onChangeCallback = null;

export function setProductsChangeCallback(callback) {
    onChangeCallback = callback;
}

function notifyProductsChanged() {
    if (onChangeCallback) onChangeCallback();
}

function saveProductsToCache(products) {
    try {
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            data: products,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('[Products] Failed to cache products:', e);
    }
}

function loadProductsFromCache() {
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) return data;
            sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
        }
    } catch (e) {
        console.warn('[Products] Failed to load cached products:', e);
    }
    return null;
}

function buildCategories() {
    const counts = new Map();
    productsState.all.forEach(p => {
        const cat = p.category || 'other';
        counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    productsState.categories = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
}

function applyFilters() {
    let filtered = [...productsState.all];
    
    if (productsState.searchQuery) {
        const q = productsState.searchQuery.toLowerCase();
        filtered = filtered.filter(p => 
            p.name?.toLowerCase().includes(q) || 
            p.id?.toLowerCase().includes(q)
        );
    }
    
    if (productsState.selectedCategory) {
        filtered = filtered.filter(p => p.category === productsState.selectedCategory);
    }
    
    productsState.filtered = filtered;
}

export function setSearchQuery(query) {
    productsState.searchQuery = query || '';
    applyFilters();
    notifyProductsChanged();
}

export function setSelectedCategory(category) {
    productsState.selectedCategory = category || null;
    applyFilters();
    notifyProductsChanged();
}

export function resetFilters() {
    productsState.searchQuery = '';
    productsState.selectedCategory = null;
    applyFilters();
    notifyProductsChanged();
}

export async function loadProducts(forceRefresh = false) {
    if (productsState.isLoading) return false;
    
    if (!forceRefresh) {
        const cached = loadProductsFromCache();
        if (cached) {
            productsState.all = cached;
            buildCategories();
            applyFilters();
            notifyProductsChanged();
        }
    }
    
    if (!isOnline()) {
        if (productsState.all.length === 0) {
            showNotification('Нет подключения к интернету и нет кэшированных данных', 'warning');
        }
        return false;
    }
    
    productsState.isLoading = true;
    notifyProductsChanged();
    
    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('status', 'in_stock')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        productsState.all = data || [];
        saveProductsToCache(productsState.all);
        buildCategories();
        applyFilters();
        return true;
        
    } catch (error) {
        console.error('[Products] Load products error:', error);
        if (productsState.all.length > 0) {
            showNotification('Ошибка загрузки. Используются кэшированные данные.', 'warning');
        } else {
            showNotification('Ошибка загрузки товаров', 'error');
        }
        return false;
    } finally {
        productsState.isLoading = false;
        notifyProductsChanged();
    }
}

export function findProductByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim();
    const byId = productsState.all.find(p => p.id === cleanCode);
    if (byId) return byId;
    const byBarcode = productsState.all.find(p => p.barcode === cleanCode);
    if (byBarcode) return byBarcode;
    return null;
}

export function createScannerHandler(onFind, onNotFound) {
    return debounce((code) => {
        if (!code) return;
        const product = findProductByCode(code);
        if (product) {
            onFind(product);
        } else {
            onNotFound?.(code);
        }
    }, SCANNER_DEBOUNCE_MS);
}

export async function openQuickAddProductForm(userId) {
    if (!isOnline()) {
        showNotification('Добавление товара недоступно в офлайн-режиме', 'warning');
        return null;
    }
    
    if (!isShiftOpen()) {
        showNotification('Откройте смену для добавления товаров', 'warning');
        return null;
    }
    
    if (!userId) {
        showNotification('Не удалось определить пользователя', 'error');
        return null;
    }
    
    try {
        const newProduct = await openProductFormModal({
            mode: 'create',
            userId: userId,
            onSuccess: (product) => {
                productsState.all.unshift(product);
                saveProductsToCache(productsState.all);
                buildCategories();
                
                if (productsState.selectedCategory && productsState.selectedCategory !== product.category) {
                    showNotification(
                        `Товар "${product.name}" добавлен в категорию "${getCategoryName(product.category)}". Сбросьте фильтр чтобы увидеть его.`,
                        'info'
                    );
                }
                
                applyFilters();
                notifyProductsChanged();
                addToCart(product);
                showNotification(`Товар "${product.name}" добавлен в корзину`, 'success');
            }
        });
        
        return newProduct;
        
    } catch (error) {
        console.error('[Products] Quick add error:', error);
        showNotification('Не удалось открыть форму добавления', 'error');
        return null;
    }
}

export function getAllProducts() { return [...productsState.all]; }
export function getFilteredProducts() { return [...productsState.filtered]; }
export function getCategories() { return [...productsState.categories]; }
export function isLoading() { return productsState.isLoading; }
export function getSearchQuery() { return productsState.searchQuery; }
export function getSelectedCategory() { return productsState.selectedCategory; }

export default {
    productsState,
    setProductsChangeCallback,
    loadProductsFromCache,
    loadProducts,
    setSearchQuery,
    setSelectedCategory,
    resetFilters,
    findProductByCode,
    createScannerHandler,
    openQuickAddProductForm,
    getAllProducts,
    getFilteredProducts,
    getCategories,
    isLoading,
    getSearchQuery,
    getSelectedCategory
};
