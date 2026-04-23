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
 * Архитектурные решения:
 * - Кэширование товаров в sessionStorage с TTL 5 минут.
 * - Интеграция с product-form.js для быстрого добавления товаров.
 * - Экспорт объекта productsState и функций для работы с ним.
 * 
 * @module cashier/products
 * @version 1.0.0
 */

import { getSupabase, isOnline } from '../../core/auth.js';
import { debounce, getCategoryName } from '../../utils/formatters.js';
import { showNotification } from '../../utils/ui.js';
import { openProductFormModal } from '../../utils/product-form.js';
import { addToCart } from './cart.js';
import { isShiftOpen } from './shift.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_CACHE_KEY = 'sh_cashier_products';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const SCANNER_DEBOUNCE_MS = 300;

// ========== СОСТОЯНИЕ ТОВАРОВ ==========

/**
 * Состояние товаров
 * @type {Object}
 */
export const productsState = {
    all: [],
    filtered: [],
    categories: [],
    searchQuery: '',
    selectedCategory: null,
    isLoading: false
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
    try {
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            data: products,
            timestamp: Date.now()
        }));
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
 * Строит список категорий на основе товаров
 */
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

// ========== ФИЛЬТРАЦИЯ ==========

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
    
    // Категория
    if (productsState.selectedCategory) {
        filtered = filtered.filter(p => p.category === productsState.selectedCategory);
    }
    
    productsState.filtered = filtered;
}

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
 * Устанавливает выбранную категорию
 * @param {string|null} category - Категория или null для сброса
 */
export function setSelectedCategory(category) {
    productsState.selectedCategory = category || null;
    applyFilters();
    notifyProductsChanged();
}

/**
 * Сбрасывает все фильтры
 */
export function resetFilters() {
    productsState.searchQuery = '';
    productsState.selectedCategory = null;
    applyFilters();
    notifyProductsChanged();
}

// ========== ЗАГРУЗКА ТОВАРОВ ==========

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
            buildCategories();
            applyFilters();
            notifyProductsChanged();
        }
    }
    
    // Если офлайн - останавливаемся
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
        
        // Если есть кэш - используем его
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

// ========== ПОИСК ПО ШТРИХКОДУ/ID ==========

/**
 * Ищет товар по ID или штрихкоду
 * @param {string} code - ID или штрихкод
 * @returns {Object|null} Найденный товар или null
 */
export function findProductByCode(code) {
    if (!code) return null;
    
    const cleanCode = code.trim();
    
    // Ищем по ID
    const byId = productsState.all.find(p => p.id === cleanCode);
    if (byId) return byId;
    
    // Ищем по штрихкоду (если есть поле barcode)
    const byBarcode = productsState.all.find(p => p.barcode === cleanCode);
    if (byBarcode) return byBarcode;
    
    return null;
}

/**
 * Создаёт дебаунсированную функцию поиска
 * @param {Function} onFind - Колбэк при нахождении товара
 * @param {Function} onNotFound - Колбэк если товар не найден
 * @returns {Function} Дебаунсированная функция
 */
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

// ========== ДОБАВЛЕНИЕ ТОВАРА ==========

/**
 * Открывает форму быстрого добавления товара
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object|null>} Созданный товар или null
 */
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
                // Добавляем товар в список
                productsState.all.unshift(product);
                saveProductsToCache(productsState.all);
                buildCategories();
                
                // Если выбран фильтр, отличный от категории товара,
                // предупреждаем пользователя что товар скрыт
                if (productsState.selectedCategory && productsState.selectedCategory !== product.category) {
                    showNotification(
                        `Товар "${product.name}" добавлен в категорию "${getCategoryName(product.category)}". Сбросьте фильтр чтобы увидеть его.`,
                        'info'
                    );
                }
                
                applyFilters();
                notifyProductsChanged();
                
                // Автоматически добавляем в корзину
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

// ========== ПОЛУЧЕНИЕ ДАННЫХ ==========

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
 * Проверяет, идёт ли загрузка
 * @returns {boolean}
 */
export function isLoading() {
    return productsState.isLoading;
}

/**
 * Получает поисковый запрос
 * @returns {string}
 */
export function getSearchQuery() {
    return productsState.searchQuery;
}

/**
 * Получает выбранную категорию
 * @returns {string|null}
 */
export function getSelectedCategory() {
    return productsState.selectedCategory;
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    // Состояние
    productsState,
    
    // Колбэки
    setProductsChangeCallback,
    
    // Кэширование
    loadProductsFromCache,
    
    // Операции
    loadProducts,
    setSearchQuery,
    setSelectedCategory,
    resetFilters,
    findProductByCode,
    createScannerHandler,
    openQuickAddProductForm,
    
    // Геттеры
    getAllProducts,
    getFilteredProducts,
    getCategories,
    isLoading,
    getSearchQuery,
    getSelectedCategory
};
