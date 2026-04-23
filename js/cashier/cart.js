// ========================================
// FILE: js/cashier/cart.js
// ========================================

/**
 * Cart Module - Cashier
 * 
 * Управление корзиной кассового модуля.
 * Отвечает за добавление/удаление товаров, изменение количества,
 * расчёт итогов, скидки и кэширование корзины.
 * 
 * Архитектурные решения:
 * - Чистые функции для расчётов (calculateCartCount, calculateItemTotal, calculateCartTotal).
 * - Кэширование корзины в localStorage с TTL 60 минут.
 * - Экспорт объекта cartState и функций для работы с ним.
 * - Интеграция с ui.js для диалогов подтверждения.
 * 
 * @module cashier/cart
 * @version 1.0.0
 */

import { showConfirmDialog } from '../../utils/ui.js';

// ========== КОНСТАНТЫ ==========

const CART_STORAGE_KEY = 'sh_cashier_cart';
const CART_CACHE_TTL = 60 * 60 * 1000; // 60 минут

// ========== СОСТОЯНИЕ КОРЗИНЫ ==========

/**
 * Состояние корзины
 * @type {Object}
 */
export const cartState = {
    items: [],
    totalDiscount: 0
};

// ========== ПОДПИСЧИКИ НА ИЗМЕНЕНИЯ ==========

/** @type {Function|null} */
let onChangeCallback = null;

/**
 * Устанавливает колбэк для вызова при изменении корзины
 * @param {Function} callback - Функция для вызова
 */
export function setCartChangeCallback(callback) {
    onChangeCallback = callback;
}

/**
 * Вызывает колбэк изменения корзины
 */
function notifyCartChanged() {
    if (onChangeCallback) {
        onChangeCallback();
    }
}

// ========== ВЫЧИСЛЕНИЯ (ЧИСТЫЕ ФУНКЦИИ) ==========

/**
 * Вычисляет количество товаров в корзине
 * @param {Array} items - Массив товаров
 * @returns {number}
 */
export function calculateCartCount(items) {
    return items.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

/**
 * Вычисляет итоговую сумму для конкретного товара
 * @param {Object} item - Товар в корзине
 * @returns {number}
 */
export function calculateItemTotal(item) {
    const price = item.price || 0;
    const discount = item.discount || 0;
    const quantity = item.quantity || 0;
    const discountedPrice = price * (1 - discount / 100);
    return Math.round(discountedPrice * quantity);
}

/**
 * Вычисляет итоговую сумму корзины
 * @param {Array} items - Массив товаров в корзине
 * @param {number} totalDiscount - Общая скидка в процентах
 * @returns {number}
 */
export function calculateCartTotal(items, totalDiscount = 0) {
    const subtotal = items.reduce((sum, item) => {
        const itemPrice = item.price || 0;
        const itemDiscount = item.discount || 0;
        const discountedPrice = itemPrice * (1 - itemDiscount / 100);
        return sum + (discountedPrice * (item.quantity || 0));
    }, 0);
    
    const total = subtotal * (1 - totalDiscount / 100);
    return Math.max(0, Math.round(total));
}

/**
 * Вычисляет количество уникальных товаров в корзине
 * @returns {number}
 */
export function getUniqueItemsCount() {
    return cartState.items.length;
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Сохраняет корзину в localStorage
 */
export function saveCartToCache() {
    try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
            items: cartState.items,
            totalDiscount: cartState.totalDiscount,
            cachedAt: Date.now()
        }));
    } catch (e) {
        console.warn('[Cart] Failed to cache cart:', e);
    }
}

/**
 * Загружает корзину из localStorage
 * @returns {boolean} true если корзина загружена
 */
export function loadCartFromCache() {
    try {
        const cached = localStorage.getItem(CART_STORAGE_KEY);
        if (cached) {
            const cart = JSON.parse(cached);
            if (Date.now() - cart.cachedAt < CART_CACHE_TTL) {
                cartState.items = cart.items || [];
                cartState.totalDiscount = cart.totalDiscount || 0;
                notifyCartChanged();
                return true;
            } else {
                localStorage.removeItem(CART_STORAGE_KEY);
            }
        }
    } catch (e) {
        console.warn('[Cart] Failed to load cached cart:', e);
    }
    return false;
}

/**
 * Очищает кэш корзины
 */
export function clearCartCache() {
    try {
        localStorage.removeItem(CART_STORAGE_KEY);
    } catch (e) {
        console.warn('[Cart] Failed to clear cart cache:', e);
    }
}

// ========== ОПЕРАЦИИ С КОРЗИНОЙ ==========

/**
 * Добавляет товар в корзину
 * @param {Object} product - Товар для добавления
 * @returns {boolean} true если товар добавлен
 */
export function addToCart(product) {
    if (!product || !product.id) {
        console.warn('[Cart] Invalid product:', product);
        return false;
    }
    
    const existing = cartState.items.find(i => i.id === product.id);
    
    if (existing) {
        existing.quantity += 1;
    } else {
        cartState.items.push({ 
            ...product, 
            quantity: 1, 
            discount: 0 
        });
    }
    
    saveCartToCache();
    notifyCartChanged();
    return true;
}

/**
 * Изменяет количество товара в корзине
 * @param {string} productId - ID товара
 * @param {number} delta - Изменение (+1 или -1)
 * @returns {boolean} true если количество изменено
 */
export function updateQuantity(productId, delta) {
    const item = cartState.items.find(i => i.id === productId);
    if (!item) return false;
    
    const newQty = item.quantity + delta;
    
    if (newQty <= 0) {
        return removeFromCart(productId);
    } else {
        item.quantity = newQty;
        saveCartToCache();
        notifyCartChanged();
        return true;
    }
}

/**
 * Удаляет товар из корзины
 * @param {string} productId - ID товара
 * @returns {boolean} true если товар удалён
 */
export function removeFromCart(productId) {
    const initialLength = cartState.items.length;
    cartState.items = cartState.items.filter(i => i.id !== productId);
    
    if (cartState.items.length !== initialLength) {
        saveCartToCache();
        notifyCartChanged();
        return true;
    }
    
    return false;
}

/**
 * Устанавливает скидку на конкретный товар
 * @param {string} productId - ID товара
 * @param {number} discountPercent - Процент скидки
 * @returns {boolean} true если скидка установлена
 */
export function setItemDiscount(productId, discountPercent) {
    const item = cartState.items.find(i => i.id === productId);
    if (!item) return false;
    
    item.discount = Math.min(100, Math.max(0, discountPercent || 0));
    saveCartToCache();
    notifyCartChanged();
    return true;
}

/**
 * Устанавливает общую скидку на корзину
 * @param {number} discountPercent - Процент скидки
 */
export function setTotalDiscount(discountPercent) {
    cartState.totalDiscount = Math.min(100, Math.max(0, discountPercent || 0));
    saveCartToCache();
    notifyCartChanged();
}

/**
 * Очищает корзину
 * @returns {Promise<boolean>} true если корзина очищена
 */
export async function clearCart() {
    if (cartState.items.length === 0) return true;
    
    const confirmed = await showConfirmDialog({
        title: 'Очистка корзины',
        message: `Вы уверены, что хотите удалить все товары (${calculateCartCount(cartState.items)} поз.) из корзины?`,
        confirmText: 'Очистить',
        confirmClass: 'btn-danger'
    });
    
    if (!confirmed) return false;
    
    cartState.items = [];
    cartState.totalDiscount = 0;
    saveCartToCache();
    notifyCartChanged();
    return true;
}

/**
 * Сбрасывает корзину (без подтверждения)
 */
export function resetCart() {
    cartState.items = [];
    cartState.totalDiscount = 0;
    saveCartToCache();
    notifyCartChanged();
}

/**
 * Проверяет, пуста ли корзина
 * @returns {boolean}
 */
export function isCartEmpty() {
    return cartState.items.length === 0;
}

/**
 * Получает итоговую сумму корзины
 * @returns {number}
 */
export function getCartTotal() {
    return calculateCartTotal(cartState.items, cartState.totalDiscount);
}

/**
 * Получает общее количество товаров
 * @returns {number}
 */
export function getCartCount() {
    return calculateCartCount(cartState.items);
}

/**
 * Получает копию товаров корзины
 * @returns {Array}
 */
export function getCartItems() {
    return [...cartState.items];
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    // Состояние
    cartState,
    
    // Колбэки
    setCartChangeCallback,
    
    // Вычисления
    calculateCartCount,
    calculateItemTotal,
    calculateCartTotal,
    getUniqueItemsCount,
    getCartTotal,
    getCartCount,
    getCartItems,
    isCartEmpty,
    
    // Кэширование
    saveCartToCache,
    loadCartFromCache,
    clearCartCache,
    
    // Операции
    addToCart,
    updateQuantity,
    removeFromCart,
    setItemDiscount,
    setTotalDiscount,
    clearCart,
    resetCart
};
