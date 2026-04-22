// ========================================
// FILE: js/inventory.js
// ========================================

/**
 * Inventory Page Module - MPA Edition
 * 
 * Логика страницы управления складом. Загружает и отображает список товаров
 * в виде таблицы с возможностью поиска, фильтрации и базовых CRUD-операций.
 * 
 * Архитектурные решения:
 * - Прямое использование глобального клиента window.supabase.
 * - Полная независимость от других страниц (MPA).
 * - Встроенная обработка офлайн-режима и сетевых ошибок.
 * - Понятные сообщения пользователю через встроенный баннер.
 * 
 * @module inventory
 * @version 3.1.0
 * @changes
 * - Убрана зависимость от удаленного core/supabase.js (используется window.supabase).
 * - Заменены alert() на встроенный баннер ошибок.
 * - Добавлена обработка офлайн-режима.
 * - Полное экранирование пользовательских данных.
 * - Улучшен UX: состояния загрузки, пустого результата, ошибки с retry.
 * - Соответствие MPA-архитектуре.
 */

import { requireAuth, logout, isOnline } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText, debounce } from '../utils/formatters.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_PER_PAGE = 50; // Количество товаров за один запрос
const SEARCH_DEBOUNCE_MS = 300;

// ========== СОСТОЯНИЕ СТРАНИЦЫ ==========

/**
 * Локальное состояние страницы склада
 * @type {Object}
 */
const state = {
    // Данные
    products: [],
    filteredProducts: [],
    
    // UI состояние
    isLoading: false,
    searchQuery: '',
    selectedStatus: '',
    selectedCategory: '',
    sortBy: 'created_at-desc',
    
    // Пользователь
    user: null,
    
    // Кэш категорий для фильтра
    categories: []
};

// ========== DOM ЭЛЕМЕНТЫ ==========

/** @type {Object<string, HTMLElement>} */
const DOM = {
    // Основные контейнеры
    tableBody: null,
    statsBar: null,
    errorBanner: null,
    errorMessage: null,
    emptyState: null,
    skeletonLoader: null,
    
    // Элементы управления
    searchInput: null,
    statusFilter: null,
    categoryFilter: null,
    sortSelect: null,
    
    // Кнопки
    addProductBtn: null,
    refreshBtn: null,
    logoutBtn: null,
    retryBtn: null,
    
    // Информация о пользователе
    userEmail: null
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы склада
 */
async function init() {
    console.log('[Inventory] Initializing MPA page...');
    
    // 1. Кэшируем DOM элементы
    cacheElements();
    
    // 2. Проверяем авторизацию (если нет — редирект на логин)
    state.user = await requireAuth();
    if (!state.user) return; // Произошел редирект
    
    // 3. Отображаем email пользователя
    displayUserInfo();
    
    // 4. Привязываем обработчики событий
    attachEvents();
    
    // 5. Загружаем товары
    await loadProducts();
    
    console.log('[Inventory] Page initialized');
}

/**
 * Кэширует все необходимые DOM элементы
 */
function cacheElements() {
    DOM.tableBody = document.getElementById('tableBody');
    DOM.statsBar = document.getElementById('statsBar');
    DOM.errorBanner = document.getElementById('errorBanner');
    DOM.errorMessage = document.getElementById('errorMessage');
    DOM.emptyState = document.getElementById('emptyState');
    DOM.skeletonLoader = document.getElementById('skeletonLoader');
    
    DOM.searchInput = document.getElementById('searchInput');
    DOM.statusFilter = document.getElementById('statusFilter');
    DOM.categoryFilter = document.getElementById('categoryFilter');
    DOM.sortSelect = document.getElementById('sortSelect');
    
    DOM.addProductBtn = document.getElementById('addProductBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.retryBtn = document.getElementById('retryBtn');
    
    DOM.userEmail = document.getElementById('userEmail');
}

/**
 * Отображает email текущего пользователя в шапке
 */
function displayUserInfo() {
    if (DOM.userEmail && state.user) {
        DOM.userEmail.textContent = state.user.email || 'Пользователь';
    }
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

/**
 * Привязывает все обработчики событий к DOM элементам
 */
function attachEvents() {
    // Выход из системы
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    // Обновление данных
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            hideError();
            loadProducts();
        });
    }
    
    // Повторная попытка при ошибке
    if (DOM.retryBtn) {
        DOM.retryBtn.addEventListener('click', () => {
            hideError();
            loadProducts();
        });
    }
    
    // Добавление товара (заглушка)
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', () => {
            showError('Функция добавления товара находится в разработке', 'info');
        });
    }
    
    // Поиск с дебаунсом
    if (DOM.searchInput) {
        const debouncedSearch = debounce(() => {
            state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
            applyFilters();
        }, SEARCH_DEBOUNCE_MS);
        
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    // Фильтр по статусу
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            state.selectedStatus = e.target.value;
            applyFilters();
        });
    }
    
    // Фильтр по категории
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            state.selectedCategory = e.target.value;
            applyFilters();
        });
    }
    
    // Сортировка
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            applyFilters();
        });
    }
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

/**
 * Загружает список товаров из Supabase
 */
async function loadProducts() {
    // Проверяем офлайн
    if (!isOnline()) {
        showError('Отсутствует подключение к интернету. Проверьте соединение.', 'warning');
        return;
    }
    
    // Предотвращаем повторную загрузку
    if (state.isLoading) return;
    
    state.isLoading = true;
    showLoader();
    hideError();
    hideEmptyState();
    
    try {
        const supabase = window.supabase;
        if (!supabase) {
            throw new Error('Supabase client not initialized');
        }
        
        // Запрос к Supabase
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(PRODUCTS_PER_PAGE);
        
        if (error) throw error;
        
        // Сохраняем данные
        state.products = data || [];
        
        // Обновляем список категорий для фильтра
        updateCategoryFilter(state.products);
        
        // Применяем фильтры и отображаем
        applyFilters();
        
        // Обновляем статистику
        updateStats(state.products);
        
    } catch (error) {
        console.error('[Inventory] Load products error:', error);
        showError(`Ошибка загрузки товаров: ${error.message || 'Неизвестная ошибка'}`, 'error');
        showEmptyState('Ошибка загрузки', 'Нажмите "Обновить" для повторной попытки');
    } finally {
        state.isLoading = false;
        hideLoader();
    }
}

/**
 * Обновляет выпадающий список категорий на основе загруженных товаров
 * @param {Array} products - Массив товаров
 */
function updateCategoryFilter(products) {
    if (!DOM.categoryFilter) return;
    
    // Собираем уникальные категории
    const categories = new Set();
    products.forEach(p => {
        if (p.category) categories.add(p.category);
    });
    
    state.categories = Array.from(categories).sort();
    
    // Обновляем DOM (сохраняем первый option "Все категории")
    const currentValue = DOM.categoryFilter.value;
    
    // Удаляем старые опции (кроме первой)
    while (DOM.categoryFilter.options.length > 1) {
        DOM.categoryFilter.remove(1);
    }
    
    // Добавляем новые опции
    state.categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = getCategoryDisplayName(cat);
        DOM.categoryFilter.appendChild(option);
    });
    
    // Восстанавливаем выбранное значение
    if (currentValue) {
        DOM.categoryFilter.value = currentValue;
    }
}

/**
 * Применяет все фильтры и сортировку к списку товаров
 */
function applyFilters() {
    let filtered = [...state.products];
    
    // Поиск по названию
    if (state.searchQuery) {
        filtered = filtered.filter(p => 
            p.name?.toLowerCase().includes(state.searchQuery) ||
            p.id?.toLowerCase().includes(state.searchQuery)
        );
    }
    
    // Фильтр по статусу
    if (state.selectedStatus) {
        filtered = filtered.filter(p => p.status === state.selectedStatus);
    }
    
    // Фильтр по категории
    if (state.selectedCategory) {
        filtered = filtered.filter(p => p.category === state.selectedCategory);
    }
    
    // Сортировка
    filtered = sortProducts(filtered, state.sortBy);
    
    state.filteredProducts = filtered;
    
    // Отрисовываем
    renderTable(filtered);
}

/**
 * Сортирует массив товаров
 * @param {Array} products - Массив товаров
 * @param {string} sortBy - Критерий сортировки
 * @returns {Array} Отсортированный массив
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

// ========== ОТРИСОВКА ==========

/**
 * Отрисовывает таблицу товаров
 * @param {Array} products - Массив товаров для отображения
 */
function renderTable(products) {
    if (!DOM.tableBody) return;
    
    // Скрываем пустое состояние
    hideEmptyState();
    
    // Если товаров нет — показываем пустое состояние
    if (products.length === 0) {
        const message = state.searchQuery || state.selectedStatus || state.selectedCategory
            ? 'По вашему запросу ничего не найдено'
            : 'Товары не найдены';
        showEmptyState('Нет товаров', message);
        DOM.tableBody.innerHTML = '';
        return;
    }
    
    // Генерируем HTML строк таблицы
    DOM.tableBody.innerHTML = products.map(product => {
        const statusText = getStatusText(product.status);
        const statusClass = getStatusClass(product.status);
        
        // Экранируем все пользовательские данные
        const safeName = escapeHtml(product.name || 'Без названия');
        const safeId = escapeHtml(product.id?.slice(0, 8) || '—');
        const safePhotoUrl = product.photo_url ? escapeHtml(product.photo_url) : null;
        
        return `
            <tr data-id="${safeId}" class="product-row">
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
                <td class="category-cell">${getCategoryDisplayName(product.category)}</td>
                <td class="price-cell">${formatMoney(product.price)}</td>
                <td class="status-cell">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td class="actions-cell">
                    <div class="row-actions">
                        <button class="btn-icon" data-action="edit" data-id="${safeId}" title="Редактировать">
                            ✎
                        </button>
                        <button class="btn-icon btn-danger" data-action="delete" data-id="${safeId}" title="Удалить">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // Привязываем обработчики к кнопкам действий
    attachRowEvents();
}

/**
 * Привязывает обработчики к кнопкам в строках таблицы
 */
function attachRowEvents() {
    if (!DOM.tableBody) return;
    
    // Кнопки редактирования
    DOM.tableBody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            showError(`Редактирование товара ${id} в разработке`, 'info');
        });
    });
    
    // Кнопки удаления
    DOM.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            deleteProduct(id);
        });
    });
}

/**
 * Удаляет товар по ID
 * @param {string} id - ID товара
 */
async function deleteProduct(id) {
    if (!confirm('Вы уверены, что хотите удалить этот товар? Это действие нельзя отменить.')) {
        return;
    }
    
    if (!isOnline()) {
        showError('Отсутствует подключение к интернету', 'warning');
        return;
    }
    
    try {
        const supabase = window.supabase;
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        // Удаляем из локального состояния
        state.products = state.products.filter(p => p.id !== id);
        state.filteredProducts = state.filteredProducts.filter(p => p.id !== id);
        
        // Обновляем отображение
        renderTable(state.filteredProducts);
        updateStats(state.products);
        
        showError('Товар успешно удален', 'success');
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        showError(`Ошибка удаления: ${error.message}`, 'error');
    }
}

/**
 * Обновляет панель статистики
 * @param {Array} products - Массив товаров
 */
function updateStats(products) {
    if (!DOM.statsBar) return;
    
    const total = products.length;
    const inStock = products.filter(p => p.status === 'in_stock').length;
    const sold = products.filter(p => p.status === 'sold').length;
    const reserved = products.filter(p => p.status === 'reserved').length;
    
    const totalValue = products
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

// ========== UI СОСТОЯНИЯ ==========

/**
 * Показывает скелетон-лоадер
 */
function showLoader() {
    if (DOM.skeletonLoader) {
        DOM.skeletonLoader.style.display = 'block';
    }
    if (DOM.tableBody) {
        DOM.tableBody.style.display = 'none';
    }
}

/**
 * Скрывает скелетон-лоадер
 */
function hideLoader() {
    if (DOM.skeletonLoader) {
        DOM.skeletonLoader.style.display = 'none';
    }
    if (DOM.tableBody) {
        DOM.tableBody.style.display = '';
    }
}

/**
 * Показывает баннер с ошибкой
 * @param {string} message - Сообщение об ошибке
 * @param {string} type - Тип ошибки ('error', 'warning', 'info', 'success')
 */
function showError(message, type = 'error') {
    if (!DOM.errorBanner || !DOM.errorMessage) return;
    
    const typeClasses = {
        error: 'error-banner-danger',
        warning: 'error-banner-warning',
        info: 'error-banner-info',
        success: 'error-banner-success'
    };
    
    // Удаляем старые классы типа
    Object.values(typeClasses).forEach(cls => {
        DOM.errorBanner.classList.remove(cls);
    });
    
    // Добавляем новый класс
    DOM.errorBanner.classList.add(typeClasses[type] || typeClasses.error);
    
    DOM.errorMessage.textContent = message;
    DOM.errorBanner.style.display = 'flex';
    
    // Автоматически скрываем success/info через 3 секунды
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            hideError();
        }, 3000);
    }
}

/**
 * Скрывает баннер ошибки
 */
function hideError() {
    if (DOM.errorBanner) {
        DOM.errorBanner.style.display = 'none';
    }
}

/**
 * Показывает пустое состояние
 * @param {string} title - Заголовок
 * @param {string} message - Сообщение
 */
function showEmptyState(title, message) {
    if (!DOM.emptyState) return;
    
    const titleEl = DOM.emptyState.querySelector('.empty-state-title');
    const messageEl = DOM.emptyState.querySelector('.empty-state-message');
    
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    
    DOM.emptyState.style.display = 'flex';
}

/**
 * Скрывает пустое состояние
 */
function hideEmptyState() {
    if (DOM.emptyState) {
        DOM.emptyState.style.display = 'none';
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Возвращает CSS-класс для статуса товара
 * @param {string} status - Статус товара
 * @returns {string} CSS-класс
 */
function getStatusClass(status) {
    const classes = {
        'in_stock': 'status-in_stock',
        'sold': 'status-sold',
        'reserved': 'status-reserved',
        'draft': 'status-draft'
    };
    return classes[status] || 'status-unknown';
}

/**
 * Возвращает отображаемое имя категории
 * @param {string} category - Ключ категории
 * @returns {string} Отображаемое имя
 */
function getCategoryDisplayName(category) {
    const names = {
        'clothes': 'Одежда',
        'toys': 'Игрушки',
        'dishes': 'Посуда',
        'other': 'Другое',
        'electronics': 'Электроника',
        'books': 'Книги',
        'furniture': 'Мебель'
    };
    return names[category] || category || '—';
}

// ========== ЗАПУСК ==========

// Запускаем инициализацию после загрузки DOM
document.addEventListener('DOMContentLoaded', init);

// Экспорт для возможного использования в других модулях (не обязательно)
export { init };
