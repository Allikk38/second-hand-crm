// ========================================
// FILE: js/inventory/products.js
// ========================================

/**
 * Products Module - Inventory
 * 
 * Управление товарами на складе.
 * Отвечает за загрузку, фильтрацию, сортировку, кэширование
 * и обновление статистики товаров.
 * 
 * Архитектурные решения:
 * - Кэширование товаров в sessionStorage с TTL 5 минут.
 * - Интеграция с categorySchema.js для работы с категориями.
 * - Уведомление подписчиков об изменении данных.
 * - Поддержка офлайн-режима с загрузкой из кэша.
 * 
 * @module inventory/products
 * @version 1.0.0
 */

import { getSupabase, isOnline } from '../../core/auth.js';
import { getCategoryName } from '../../utils/formatters.js';
import { showNotification } from '../../utils/ui.js';
import { 
    hasPendingOperations, 
    syncPendingOperations,
    getOperationsStats 
} from './operations.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_CACHE_KEY = 'sh_inventory_products';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// ========== СОСТОЯНИЕ ТОВАРОВ ==========

/**
 * Состояние товаров
 * @type {Object}
 */
export const productsState = {
    all: [],
    filtered: [],
    categories: [],
    isLoading: false,
    isOffline: false,
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

// ========== ПОДПИСЧИКИ НА ИЗМЕНЕНИЯ ==========

/** @type {Function|null} */
let onChangeCallback = null;

/**
 * Устанавливает колбэк для вызова при изменении товаров
 * @param {Function} callback - Функция для вызова
 */
export function setProductsChangeCallback(callback) {
    onChangeCallback = callback;
}

/**
 * Вызывает колбэк изменения товаров
 */
function notifyProductsChanged() {
    if (onChangeCallback) {
        onChangeCallback();
    }
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Сохраняет товары в кэш
 * @param {Array} products - Массив товаров
 */
function saveProductsToCache(products) {
    if (!products) return;
    
    try {
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            data: products,
            timestamp: Date.now()
        }));
        console.log('[Products] Cache saved:', products.length, 'products');
    } catch (e) {
        console.warn('[Products] Failed to cache products:', e);
    }
}

/**
 * Загружает товары из кэша
 * @returns {Array|null}
 */
function loadProductsFromCache() {
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) {
                console.log('[Products] Loaded from cache:', data.length, 'products');
                return data;
            }
            sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
        }
    } catch (e) {
        console.warn('[Products] Failed to load cached products:', e);
    }
    return null;
}

// ========== ОБРАБОТКА КАТЕГОРИЙ ==========

/**
 * Обновляет список категорий на основе товаров
 */
function updateCategoryFilter() {
    const categories = new Set();
    productsState.all.forEach(p => {
        if (p.category) categories.add(p.category);
    });
    
    productsState.categories = Array.from(categories).sort();
}

// ========== ФИЛЬТРАЦИЯ И СОРТИРОВКА ==========

/**
 * Применяет фильтры к списку товаров
 */
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

/**
 * Сортирует товары
 * @param {Array} products - Массив товаров
 * @param {string} sortBy - Критерий сортировки
 * @returns {Array}
 */
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

// ========== УСТАНОВКА ФИЛЬТРОВ ==========

/**
 * Устанавливает поисковый запрос
 * @param {string} query - Поисковый запрос
 */
export function setSearchQuery(query) {
    productsState.searchQuery = query || '';
    applyFilters();
    notifyProductsChanged();
}

/**
 * Устанавливает фильтр по статусу
 * @param {string} status - Статус товара
 */
export function setStatusFilter(status) {
    productsState.selectedStatus = status || '';
    applyFilters();
    notifyProductsChanged();
}

/**
 * Устанавливает фильтр по категории
 * @param {string} category - Категория
 */
export function setCategoryFilter(category) {
    productsState.selectedCategory = category || '';
    applyFilters();
    notifyProductsChanged();
}

/**
 * Устанавливает сортировку
 * @param {string} sortBy - Критерий сортировки
 */
export function setSortBy(sortBy) {
    productsState.sortBy = sortBy || 'created_at-desc';
    applyFilters();
    notifyProductsChanged();
}

/**
 * Сбрасывает все фильтры
 */
export function resetFilters() {
    productsState.searchQuery = '';
    productsState.selectedStatus = '';
    productsState.selectedCategory = '';
    productsState.sortBy = 'created_at-desc';
    applyFilters();
    notifyProductsChanged();
}

// ========== СТАТИСТИКА ==========

/**
 * Обновляет статистику склада
 */
function updateStats() {
    const all = productsState.all;
    const inStock = all.filter(p => p.status === 'in_stock');
    
    productsState.stats = {
        total: all.length,
        inStock: inStock.length,
        sold: all.filter(p => p.status === 'sold').length,
        reserved: all.filter(p => p.status === 'reserved').length,
        stockValue: inStock.reduce((sum, p) => sum + (p.price || 0), 0),
        potentialProfit: inStock.reduce((sum, p) => sum + ((p.price || 0) - (p.cost_price || 0)), 0)
    };
}

// ========== ЗАГРУЗКА ТОВАРОВ ==========

/**
 * Проверяет доступность Supabase
 * @returns {Promise<boolean>}
 */
async function isSupabaseAvailable() {
    if (!isOnline()) return false;
    
    try {
        const supabase = await getSupabase();
        const { error } = await supabase.from('products').select('id', { count: 'exact', head: true });
        return !error;
    } catch {
        return false;
    }
}

/**
 * Загружает товары с сервера
 * @param {boolean} [forceRefresh=false] - Игнорировать кэш
 * @returns {Promise<boolean>} true если загрузка успешна
 */
export async function loadProducts(forceRefresh = false) {
    if (productsState.isLoading) return false;
    
    // Проверяем кэш если не принудительное обновление
    if (!forceRefresh) {
        const cached = loadProductsFromCache();
        if (cached) {
            productsState.all = cached;
            productsState.isOffline = false;
            updateCategoryFilter();
            applyFilters();
            updateStats();
            notifyProductsChanged();
        }
    }
    
    // Если офлайн - останавливаемся
    if (!isOnline()) {
        productsState.isOffline = true;
        if (productsState.all.length === 0) {
            showNotification('Нет подключения к интернету и нет кэшированных данных', 'warning');
        } else {
            showNotification('Работа в офлайн-режиме (данные из кэша)', 'warning');
        }
        notifyProductsChanged();
        return false;
    }
    
    productsState.isLoading = true;
    notifyProductsChanged();
    
    try {
        const supabaseAvailable = await isSupabaseAvailable();
        
        if (!supabaseAvailable) {
            productsState.isOffline = true;
            if (productsState.all.length > 0) {
                showNotification('Сервер недоступен. Работа с кэшированными данными.', 'warning');
            } else {
                showNotification('Сервер недоступен и нет кэшированных данных', 'error');
            }
            productsState.isLoading = false;
            notifyProductsChanged();
            return false;
        }
        
        const supabase = await getSupabase();
        
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        console.log('[Products] Loaded from server:', data?.length || 0, 'products');
        
        productsState.all = data || [];
        productsState.isOffline = false;
        
        saveProductsToCache(productsState.all);
        updateCategoryFilter();
        applyFilters();
        updateStats();
        
        // Если есть отложенные операции, синхронизируем их
        if (hasPendingOperations()) {
            const result = await syncPendingOperations();
            if (result.synced > 0) {
                // После синхронизации перезагружаем данные
                return await loadProducts(true);
            }
        }
        
        return true;
        
    } catch (error) {
        console.error('[Products] Load products error:', error);
        
        if (productsState.all.length > 0) {
            showNotification('Ошибка загрузки. Используются кэшированные данные.', 'warning');
        } else {
            showNotification('Ошибка загрузки товаров: ' + error.message, 'error');
        }
        return false;
    } finally {
        productsState.isLoading = false;
        notifyProductsChanged();
    }
}

// ========== ОБНОВЛЕНИЕ ПОСЛЕ ИЗМЕНЕНИЙ ==========

/**
 * Полностью обновляет UI после изменения списка товаров
 */
export function refreshProductsList() {
    saveProductsToCache(productsState.all);
    updateCategoryFilter();
    applyFilters();
    updateStats();
    notifyProductsChanged();
}

// ========== CRUD ОПЕРАЦИИ НАД STATE ==========

/**
 * Добавляет товар в начало списка
 * @param {Object} product - Товар
 */
export function addProductToState(product) {
    productsState.all.unshift(product);
    refreshProductsList();
}

/**
 * Обновляет товар в списке
 * @param {string} productId - ID товара
 * @param {Object} updatedProduct - Обновлённые данные
 */
export function updateProductInState(productId, updatedProduct) {
    const index = productsState.all.findIndex(p => p.id === productId);
    if (index !== -1) {
        productsState.all[index] = updatedProduct;
        refreshProductsList();
        return true;
    }
    return false;
}

/**
 * Удаляет товар из списка
 * @param {string} productId - ID товара
 */
export function removeProductFromState(productId) {
    const initialLength = productsState.all.length;
    productsState.all = productsState.all.filter(p => p.id !== productId);
    
    if (productsState.all.length !== initialLength) {
        refreshProductsList();
        return true;
    }
    return false;
}

// ========== ГЕТТЕРЫ ==========

/**
 * Получает все товары
 * @returns {Array}
 */
export function getAllProducts() {
    return [...productsState.all];
}

/**
 * Получает отфильтрованные товары
 * @returns {Array}
 */
export function getFilteredProducts() {
    return [...productsState.filtered];
}

/**
 * Получает список категорий
 * @returns {Array}
 */
export function getCategories() {
    return [...productsState.categories];
}

/**
 * Получает статистику
 * @returns {Object}
 */
export function getStats() {
    return { ...productsState.stats };
}

/**
 * Получает товар по ID
 * @param {string} id - ID товара
 * @returns {Object|null}
 */
export function getProductById(id) {
    return productsState.all.find(p => p.id === id) || null;
}

/**
 * Проверяет, идёт ли загрузка
 * @returns {boolean}
 */
export function isLoading() {
    return productsState.isLoading;
}

/**
 * Проверяет, в офлайн-режиме ли страница
 * @returns {boolean}
 */
export function isOffline() {
    return productsState.isOffline;
}

/**
 * Получает текущий поисковый запрос
 * @returns {string}
 */
export function getSearchQuery() {
    return productsState.searchQuery;
}

/**
 * Получает выбранный статус
 * @returns {string}
 */
export function getSelectedStatus() {
    return productsState.selectedStatus;
}

/**
 * Получает выбранную категорию
 * @returns {string}
 */
export function getSelectedCategory() {
    return productsState.selectedCategory;
}

/**
 * Получает текущую сортировку
 * @returns {string}
 */
export function getSortBy() {
    return productsState.sortBy;
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    productsState,
    setProductsChangeCallback,
    
    // Загрузка
    loadProducts,
    refreshProductsList,
    
    // Фильтры
    setSearchQuery,
    setStatusFilter,
    setCategoryFilter,
    setSortBy,
    resetFilters,
    
    // CRUD над state
    addProductToState,
    updateProductInState,
    removeProductFromState,
    
    // Геттеры
    getAllProducts,
    getFilteredProducts,
    getCategories,
    getStats,
    getProductById,
    isLoading,
    isOffline,
    getSearchQuery,
    getSelectedStatus,
    getSelectedCategory,
    getSortBy
};
