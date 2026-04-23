// ========================================
// FILE: js/inventory/products.js
// ========================================

/**
 * Products Module - Inventory
 * 
 * Сервис управления данными товаров на складе.
 * Отвечает за загрузку, кэширование, фильтрацию, сортировку и обновление состояния.
 * Не выполняет мутирующих операций с сервером — это зона ответственности operations.js.
 * 
 * Архитектурные решения:
 * - Загрузка данных через единый движок синхронизации sync-engine.
 * - Кэширование данных управляется внутри sync-engine (IndexedDB + Memory).
 * - Состояние модуля — единственный источник правды о товарах для UI контроллера.
 * - Уведомление подписчиков об изменении данных через callback.
 * 
 * @module inventory/products
 * @version 2.0.0
 * @changes
 * - Полный рефакторинг. Удалены прямые запросы к Supabase.
 * - Интегрирован sync-engine для загрузки данных.
 * - Удалена зависимость от operations.js.
 * - Упрощено управление состоянием.
 */

import { loadData, ENTITIES } from '../../core/sync-engine.js';
import { getSupabase } from '../../core/auth.js';

// ========== КОНСТАНТЫ ==========

const CACHE_KEY = 'all';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 минут

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

// ========== ОБРАБОТКА КАТЕГОРИЙ ==========

/**
 * Обновляет список категорий на основе товаров
 */
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

// ========== СТАТИСТИКА ==========

/**
 * Обновляет статистику склада
 */
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

// ========== ЗАГРУЗКА ТОВАРОВ ==========

/**
 * Загружает товары через Sync Engine
 * @param {boolean} [forceRefresh=false] - Игнорировать кэш
 * @returns {Promise<boolean>} true если загрузка успешна
 */
export async function loadProducts(forceRefresh = false) {
    if (productsState.isLoading) return false;
    
    productsState.isLoading = true;
    notifyProductsChanged();
    
    try {
        const result = await loadData(ENTITIES.PRODUCTS, {
            id: CACHE_KEY,
            maxAge: forceRefresh ? 0 : CACHE_MAX_AGE,
            fetcher: async () => {
                const supabase = await getSupabase();
                const { data, error } = await supabase
                    .from('products')
                    .select('*')
                    .order('created_at', { ascending: false });
                
                if (error) throw error;
                return data || [];
            }
        });
        
        productsState.all = result.data || [];
        
        // Логируем источник данных
        if (result.fromCache) {
            console.log('[Products] Loaded from cache:', productsState.all.length);
        } else {
            console.log('[Products] Loaded from server:', productsState.all.length);
        }
        
        updateCategoryFilter();
        applyFilters();
        updateStats();
        notifyProductsChanged();
        
        return true;
        
    } catch (error) {
        console.error('[Products] Load products error:', error);
        return false;
    } finally {
        productsState.isLoading = false;
        notifyProductsChanged();
    }
}

// ========== ОБНОВЛЕНИЕ СОСТОЯНИЯ (ВЫЗЫВАЕТСЯ ИЗВНЕ) ==========

/**
 * Полностью обновляет UI после изменения списка товаров
 */
export function refreshProductsList() {
    updateCategoryFilter();
    applyFilters();
    updateStats();
    notifyProductsChanged();
}

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
    const index = productsState.all.findIndex(p => p.id === productId);
    if (index !== -1) {
        productsState.all[index]._deleted = true;
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
    // Состояние и колбэки
    productsState,
    setProductsChangeCallback,
    
    // Загрузка данных
    loadProducts,
    refreshProductsList,
    
    // Управление фильтрами
    setSearchQuery,
    setStatusFilter,
    setCategoryFilter,
    setSortBy,
    resetFilters,
    
    // Обновление состояния (для operations)
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
    getSearchQuery,
    getSelectedStatus,
    getSelectedCategory,
    getSortBy
};
