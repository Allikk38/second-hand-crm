// ========================================
// FILE: ./js/inventory.js
// ========================================

/**
 * Inventory Page Module
 * 
 * Логика страницы управления складом. Управляет отображением,
 * фильтрацией, созданием, редактированием и удалением товаров.
 * 
 * Архитектурные решения:
 * - Полностью автономный модуль, работает только со своей страницей.
 * - Использует единый клиент из core/supabase.js.
 * - Пагинация для работы с большими объемами данных.
 * - Кэширование данных в sessionStorage.
 * - Дебаунс на поиск для оптимизации.
 * 
 * @module inventory
 * @version 2.0.0
 * @changes
 * - Добавлена пагинация.
 * - Переписаны модалки с правильными обработчиками событий.
 * - Добавлен дебаунс на поиск.
 * - Добавлена поддержка массовых операций.
 * - Интеграция с утилитами форматирования.
 */

import { supabase, paginate, softDelete, uploadProductPhoto } from '../core/supabase.js';
import { requireAuth, logout, getUserProfile } from '../core/auth.js';
import { 
    formatMoney, 
    formatNumber, 
    formatDate,
    escapeHtml, 
    getStatusText, 
    getCategoryName,
    getStatusClass,
    debounce 
} from '../utils/formatters.js';
import { 
    getCategoryOptions, 
    getCategoryFields, 
    validateAttributes,
    formatAttributes,
    createEmptyAttributes,
    groupByCategory 
} from '../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========

const PAGE_SIZE = 30;
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const CACHE_KEY = 'inventory_products_cache';

// ========== СОСТОЯНИЕ ==========

/**
 * Состояние страницы склада
 * @type {Object}
 */
const state = {
    // Данные
    products: [],
    categories: [],
    
    // Пагинация
    currentPage: 0,
    totalPages: 0,
    totalCount: 0,
    
    // Фильтры
    searchQuery: '',
    selectedCategory: '',
    selectedStatus: '',
    sortBy: 'created_at-desc',
    
    // Выделение
    selectedIds: new Set(),
    
    // UI
    isLoading: false,
    isInitialLoad: true,
    
    // Пользователь
    user: null,
    profile: null
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    // Контейнеры
    statsBar: null,
    tableBody: null,
    emptyState: null,
    skeletonLoader: null,
    paginationContainer: null,
    paginationInfo: null,
    pagination: null,
    modalContainer: null,
    notificationContainer: null,
    
    // Фильтры
    searchInput: null,
    categoryFilter: null,
    statusFilter: null,
    sortSelect: null,
    
    // Кнопки
    addProductBtn: null,
    clearFiltersBtn: null,
    refreshBtn: null,
    exportBtn: null,
    logoutBtn: null,
    selectAllCheckbox: null,
    
    // Отображение пользователя
    userEmail: null
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
    
    // Получаем профиль
    state.profile = await getUserProfile();
    
    // Кэшируем DOM элементы
    cacheElements();
    
    // Отображаем информацию о пользователе
    displayUserInfo();
    
    // Загружаем категории
    loadCategoryOptions();
    
    // Показываем скелетон-лоадер
    showLoader();
    
    // Загружаем товары
    await loadProducts();
    
    // Привязываем события
    attachEvents();
    
    // Скрываем лоадер
    hideLoader();
    
    state.isInitialLoad = false;
    
    console.log('[Inventory] Initialized');
}

/**
 * Кэширует DOM элементы
 */
function cacheElements() {
    DOM.statsBar = document.getElementById('statsBar');
    DOM.tableBody = document.getElementById('tableBody');
    DOM.emptyState = document.getElementById('emptyState');
    DOM.skeletonLoader = document.getElementById('skeletonLoader');
    DOM.paginationContainer = document.getElementById('paginationContainer');
    DOM.paginationInfo = document.getElementById('paginationInfo');
    DOM.pagination = document.getElementById('pagination');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.notificationContainer = document.getElementById('notificationContainer');
    
    DOM.searchInput = document.getElementById('searchInput');
    DOM.categoryFilter = document.getElementById('categoryFilter');
    DOM.statusFilter = document.getElementById('statusFilter');
    DOM.sortSelect = document.getElementById('sortSelect');
    
    DOM.addProductBtn = document.getElementById('addProductBtn');
    DOM.clearFiltersBtn = document.getElementById('clearFiltersBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');
    DOM.exportBtn = document.getElementById('exportBtn');
    DOM.logoutBtn = document.getElementById('logoutBtn');
    DOM.selectAllCheckbox = document.getElementById('selectAllCheckbox');
    
    DOM.userEmail = document.getElementById('userEmail');
}

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    // Поиск с дебаунсом
    if (DOM.searchInput) {
        const debouncedSearch = debounce(() => {
            state.searchQuery = DOM.searchInput.value.trim();
            state.currentPage = 0;
            loadProducts();
        }, 300);
        
        DOM.searchInput.addEventListener('input', debouncedSearch);
    }
    
    // Фильтры
    if (DOM.categoryFilter) {
        DOM.categoryFilter.addEventListener('change', (e) => {
            state.selectedCategory = e.target.value;
            state.currentPage = 0;
            loadProducts();
        });
    }
    
    if (DOM.statusFilter) {
        DOM.statusFilter.addEventListener('change', (e) => {
            state.selectedStatus = e.target.value;
            state.currentPage = 0;
            loadProducts();
        });
    }
    
    if (DOM.sortSelect) {
        DOM.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            state.currentPage = 0;
            loadProducts();
        });
    }
    
    // Кнопки
    if (DOM.addProductBtn) {
        DOM.addProductBtn.addEventListener('click', () => openProductModal());
    }
    
    if (DOM.clearFiltersBtn) {
        DOM.clearFiltersBtn.addEventListener('click', clearAllFilters);
    }
    
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            state.currentPage = 0;
            clearCache();
            loadProducts();
        });
    }
    
    if (DOM.exportBtn) {
        DOM.exportBtn.addEventListener('click', exportToCSV);
    }
    
    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', () => logout());
    }
    
    // Выделение
    if (DOM.selectAllCheckbox) {
        DOM.selectAllCheckbox.addEventListener('change', handleSelectAll);
    }
    
    // Делегирование событий таблицы
    if (DOM.tableBody) {
        DOM.tableBody.addEventListener('click', handleTableClick);
        DOM.tableBody.addEventListener('change', handleTableChange);
    }
    
    // Клавиатурные сокращения
    document.addEventListener('keydown', handleKeyboard);
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

/**
 * Загружает список товаров
 */
async function loadProducts() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    
    try {
        // Проверяем кэш
        const cacheKey = getCacheKey();
        const cached = getFromCache(cacheKey);
        
        if (cached && state.currentPage === 0) {
            console.log('[Inventory] Using cached data');
            state.products = cached.data;
            state.totalCount = cached.count;
            state.totalPages = Math.ceil(state.totalCount / PAGE_SIZE);
            render();
            state.isLoading = false;
            return;
        }
        
        // Строим фильтры
        const filters = [];
        
        if (state.selectedCategory) {
            filters.push({ column: 'category', operator: 'eq', value: state.selectedCategory });
        }
        
        if (state.selectedStatus) {
            filters.push({ column: 'status', operator: 'eq', value: state.selectedStatus });
        }
        
        if (state.searchQuery) {
            // Для поиска используем отдельный запрос
            const result = await searchProducts();
            state.products = result.data;
            state.totalCount = result.count;
        } else {
            // Пагинированный запрос
            const [sortField, sortDirection] = state.sortBy.split('-');
            
            const result = await paginate('products', {
                page: state.currentPage,
                limit: PAGE_SIZE,
                filters,
                orderBy: sortField,
                ascending: sortDirection === 'asc'
            });
            
            state.products = result.data;
            state.totalCount = result.count;
        }
        
        state.totalPages = Math.ceil(state.totalCount / PAGE_SIZE);
        
        // Кэшируем результат
        if (state.currentPage === 0 && !state.searchQuery) {
            setToCache(cacheKey, {
                data: state.products,
                count: state.totalCount,
                timestamp: Date.now()
            });
        }
        
        render();
        
    } catch (error) {
        console.error('[Inventory] Load products error:', error);
        showNotification('Ошибка загрузки товаров', 'error');
        renderEmptyState('Ошибка загрузки. Попробуйте обновить страницу.');
    } finally {
        state.isLoading = false;
    }
}

/**
 * Поиск товаров
 */
async function searchProducts() {
    const { data, error, count } = await supabase
        .from('products')
        .select('*', { count: 'exact' })
        .or(`name.ilike.%${state.searchQuery}%,id.ilike.%${state.searchQuery}%`)
        .range(state.currentPage * PAGE_SIZE, (state.currentPage + 1) * PAGE_SIZE - 1)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return { data: data || [], count: count || 0 };
}

/**
 * Загружает опции категорий
 */
function loadCategoryOptions() {
    const options = getCategoryOptions();
    
    if (DOM.categoryFilter) {
        options.forEach(({ value, label }) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            DOM.categoryFilter.appendChild(option);
        });
    }
}

// ========== РЕНДЕРИНГ ==========

/**
 * Отрисовывает страницу
 */
function render() {
    updateStats();
    
    if (state.products.length === 0) {
        renderEmptyState(getEmptyStateMessage());
        DOM.paginationContainer.style.display = 'none';
    } else {
        renderTable();
        renderPagination();
        DOM.emptyState.style.display = 'none';
        DOM.paginationContainer.style.display = 'flex';
    }
    
    // Обновляем чекбокс "Выбрать все"
    updateSelectAllCheckbox();
}

/**
 * Обновляет статистику
 */
function updateStats() {
    if (!DOM.statsBar) return;
    
    const totalProducts = state.totalCount;
    const inStock = state.products.filter(p => p.status === 'in_stock').length;
    const sold = state.products.filter(p => p.status === 'sold').length;
    const totalValue = state.products
        .filter(p => p.status === 'in_stock')
        .reduce((sum, p) => sum + (p.price || 0), 0);
    
    DOM.statsBar.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Всего товаров:</span>
            <span class="stat-value">${formatNumber(totalProducts)}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">В наличии:</span>
            <span class="stat-value success">${formatNumber(inStock)}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Продано:</span>
            <span class="stat-value danger">${formatNumber(sold)}</span>
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
    
    DOM.tableBody.innerHTML = state.products.map(product => `
        <tr data-id="${product.id}" class="${state.selectedIds.has(product.id) ? 'selected' : ''}">
            <td onclick="event.stopPropagation()">
                <input 
                    type="checkbox" 
                    class="row-checkbox" 
                    data-id="${product.id}"
                    ${state.selectedIds.has(product.id) ? 'checked' : ''}
                >
            </td>
            <td>
                <div class="product-thumb">
                    ${product.photo_url 
                        ? `<img src="${escapeHtml(product.photo_url)}" alt="${escapeHtml(product.name)}" loading="lazy">` 
                        : '<span class="placeholder">📦</span>'
                    }
                </div>
            </td>
            <td>
                <div class="product-name">${escapeHtml(product.name)}</div>
                <div class="product-id">ID: ${product.id?.slice(0, 8)}</div>
                ${product.attributes ? `
                    <div class="product-attributes" style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px;">
                        ${escapeHtml(formatAttributes(product.category, product.attributes, { showLabels: false }))}
                    </div>
                ` : ''}
            </td>
            <td>${getCategoryName(product.category)}</td>
            <td>
                <div class="product-price">${formatMoney(product.price)}</div>
                ${product.cost_price ? `
                    <div class="product-cost">Себ.: ${formatMoney(product.cost_price)}</div>
                ` : ''}
            </td>
            <td>
                ${product.cost_price ? formatMoney(product.cost_price) : '—'}
            </td>
            <td>
                <span class="status-badge ${product.status}">
                    ${getStatusText(product.status)}
                </span>
            </td>
            <td onclick="event.stopPropagation()">
                <div class="row-actions">
                    <button class="btn-icon" data-action="edit" data-id="${product.id}" title="Редактировать">
                        ✎
                    </button>
                    <button class="btn-icon" data-action="duplicate" data-id="${product.id}" title="Дублировать">
                        📋
                    </button>
                    <button class="btn-icon btn-danger" data-action="delete" data-id="${product.id}" title="Удалить">
                        ✕
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Отрисовывает пагинацию
 */
function renderPagination() {
    if (!DOM.paginationInfo || !DOM.pagination) return;
    
    const start = state.currentPage * PAGE_SIZE + 1;
    const end = Math.min((state.currentPage + 1) * PAGE_SIZE, state.totalCount);
    
    DOM.paginationInfo.textContent = `Показано ${start}-${end} из ${formatNumber(state.totalCount)}`;
    
    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(0, state.currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(state.totalPages - 1, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(0, endPage - maxVisiblePages + 1);
    }
    
    // Кнопка "Назад"
    pages.push(`
        <button class="pagination-btn" data-page="${state.currentPage - 1}" ${state.currentPage === 0 ? 'disabled' : ''}>
            ←
        </button>
    `);
    
    // Первая страница
    if (startPage > 0) {
        pages.push(`<button class="pagination-btn" data-page="0">1</button>`);
        if (startPage > 1) {
            pages.push(`<span class="pagination-ellipsis">...</span>`);
        }
    }
    
    // Страницы
    for (let i = startPage; i <= endPage; i++) {
        pages.push(`
            <button class="pagination-btn ${i === state.currentPage ? 'active' : ''}" data-page="${i}">
                ${i + 1}
            </button>
        `);
    }
    
    // Последняя страница
    if (endPage < state.totalPages - 1) {
        if (endPage < state.totalPages - 2) {
            pages.push(`<span class="pagination-ellipsis">...</span>`);
        }
        pages.push(`<button class="pagination-btn" data-page="${state.totalPages - 1}">${state.totalPages}</button>`);
    }
    
    // Кнопка "Вперед"
    pages.push(`
        <button class="pagination-btn" data-page="${state.currentPage + 1}" ${state.currentPage >= state.totalPages - 1 ? 'disabled' : ''}>
            →
        </button>
    `);
    
    DOM.pagination.innerHTML = pages.join('');
    
    // Привязываем события
    DOM.pagination.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (!isNaN(page) && page >= 0 && page < state.totalPages) {
                state.currentPage = page;
                loadProducts();
                DOM.tableWrapper?.scrollTo({ top: 0, behavior: 'smooth' });
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
        const messageEl = document.getElementById('emptyStateMessage');
        if (messageEl) messageEl.textContent = message;
    }
    if (DOM.tableBody) DOM.tableBody.innerHTML = '';
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

/**
 * Обработчик кликов в таблице
 */
function handleTableClick(e) {
    const row = e.target.closest('tr[data-id]');
    const btn = e.target.closest('[data-action]');
    
    if (btn) {
        const action = btn.dataset.action;
        const id = btn.dataset.id || row?.dataset.id;
        
        switch (action) {
            case 'edit':
                openProductModal(id);
                break;
            case 'duplicate':
                duplicateProduct(id);
                break;
            case 'delete':
                deleteProduct(id);
                break;
        }
        return;
    }
    
    if (row && !e.target.closest('input[type="checkbox"]')) {
        const id = row.dataset.id;
        openProductModal(id);
    }
}

/**
 * Обработчик изменений в таблице
 */
function handleTableChange(e) {
    if (e.target.classList.contains('row-checkbox')) {
        const id = e.target.dataset.id;
        
        if (e.target.checked) {
            state.selectedIds.add(id);
        } else {
            state.selectedIds.delete(id);
        }
        
        updateSelectAllCheckbox();
        showBulkActions();
    }
}

/**
 * Обработчик "Выбрать все"
 */
function handleSelectAll(e) {
    if (e.target.checked) {
        state.products.forEach(p => state.selectedIds.add(p.id));
    } else {
        state.selectedIds.clear();
    }
    
    renderTable();
    showBulkActions();
}

/**
 * Обработчик клавиатуры
 */
function handleKeyboard(e) {
    // Ctrl+F - фокус на поиск
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        DOM.searchInput?.focus();
    }
    
    // Ctrl+N - новый товар
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        openProductModal();
    }
    
    // Escape - снять выделение
    if (e.key === 'Escape') {
        state.selectedIds.clear();
        renderTable();
        hideBulkActions();
    }
}

// ========== ОПЕРАЦИИ С ТОВАРАМИ ==========

/**
 * Открывает модальное окно товара
 */
function openProductModal(productId = null) {
    const product = productId ? state.products.find(p => p.id === productId) : null;
    const isEdit = !!product;
    
    const categories = getCategoryOptions();
    const currentCategory = product?.category || 'other';
    const fields = getCategoryFields(currentCategory);
    const attributes = product?.attributes || createEmptyAttributes(currentCategory);
    
    const modalHtml = `
        <div class="modal-overlay" id="productModalOverlay">
            <div class="modal product-modal">
                <div class="modal-header">
                    <h3>${isEdit ? 'Редактирование товара' : 'Новый товар'}</h3>
                    <button class="btn-close" id="closeProductModal" aria-label="Закрыть">✕</button>
                </div>
                <div class="modal-body">
                    <form id="productForm">
                        <!-- Основные поля -->
                        <div class="form-row">
                            <div class="form-group">
                                <label for="prodName">Название *</label>
                                <input type="text" id="prodName" name="name" class="form-control" 
                                       value="${escapeHtml(product?.name || '')}" required>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="prodCategory">Категория *</label>
                                <select id="prodCategory" name="category" class="form-control" required>
                                    ${categories.map(c => `
                                        <option value="${c.value}" ${c.value === currentCategory ? 'selected' : ''}>
                                            ${c.label}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="prodStatus">Статус *</label>
                                <select id="prodStatus" name="status" class="form-control" required>
                                    <option value="in_stock" ${product?.status === 'in_stock' ? 'selected' : ''}>В наличии</option>
                                    <option value="sold" ${product?.status === 'sold' ? 'selected' : ''}>Продан</option>
                                    <option value="reserved" ${product?.status === 'reserved' ? 'selected' : ''}>Забронирован</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="prodPrice">Цена продажи *</label>
                                <input type="number" id="prodPrice" name="price" class="form-control" 
                                       value="${product?.price || ''}" step="0.01" min="0" required>
                            </div>
                            <div class="form-group">
                                <label for="prodCost">Себестоимость</label>
                                <input type="number" id="prodCost" name="cost_price" class="form-control" 
                                       value="${product?.cost_price || ''}" step="0.01" min="0">
                            </div>
                        </div>
                        
                        <!-- Динамические поля категории -->
                        <div id="categoryFieldsContainer">
                            ${renderCategoryFields(fields, attributes)}
                        </div>
                        
                        <div class="form-group">
                            <label for="prodPhoto">Фото (URL)</label>
                            <input type="url" id="prodPhoto" name="photo_url" class="form-control" 
                                   value="${escapeHtml(product?.photo_url || '')}" placeholder="https://...">
                        </div>
                        
                        <div class="form-error" id="productFormError"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cancelProductBtn">Отмена</button>
                    <button class="btn-primary" id="saveProductBtn">
                        <span class="btn-text">${isEdit ? 'Сохранить' : 'Создать'}</span>
                        <span class="btn-loader" style="display: none;">
                            <span class="loading-spinner small"></span>
                            Сохранение...
                        </span>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    DOM.modalContainer.innerHTML = modalHtml;
    
    // Привязываем события
    const overlay = document.getElementById('productModalOverlay');
    const closeBtn = document.getElementById('closeProductModal');
    const cancelBtn = document.getElementById('cancelProductBtn');
    const saveBtn = document.getElementById('saveProductBtn');
    const form = document.getElementById('productForm');
    const categorySelect = document.getElementById('prodCategory');
    
    const closeModal = () => {
        DOM.modalContainer.innerHTML = '';
    };
    
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    
    // Обновление полей при смене категории
    categorySelect?.addEventListener('change', (e) => {
        const newCategory = e.target.value;
        const newFields = getCategoryFields(newCategory);
        const container = document.getElementById('categoryFieldsContainer');
        if (container) {
            container.innerHTML = renderCategoryFields(newFields, createEmptyAttributes(newCategory));
        }
    });
    
    // Сохранение
    saveBtn?.addEventListener('click', () => saveProduct(product?.id, closeModal));
    
    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveProduct(product?.id, closeModal);
    });
    
    // Escape
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

/**
 * Рендерит поля категории
 */
function renderCategoryFields(fields, attributes = {}) {
    return fields.map(field => {
        const value = attributes[field.name] || '';
        
        if (field.type === 'select') {
            return `
                <div class="form-group">
                    <label for="field_${field.name}">${field.label}${field.required ? ' *' : ''}</label>
                    <select id="field_${field.name}" name="attr_${field.name}" class="form-control" ${field.required ? 'required' : ''}>
                        <option value="">Выберите</option>
                        ${field.options?.map(opt => `
                            <option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>
                        `).join('')}
                    </select>
                </div>
            `;
        } else if (field.type === 'textarea') {
            return `
                <div class="form-group">
                    <label for="field_${field.name}">${field.label}${field.required ? ' *' : ''}</label>
                    <textarea id="field_${field.name}" name="attr_${field.name}" class="form-control" 
                              placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>${escapeHtml(value)}</textarea>
                </div>
            `;
        } else {
            return `
                <div class="form-group">
                    <label for="field_${field.name}">${field.label}${field.required ? ' *' : ''}</label>
                    <input type="${field.type}" id="field_${field.name}" name="attr_${field.name}" class="form-control" 
                           value="${escapeHtml(value)}" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>
                </div>
            `;
        }
    }).join('');
}

/**
 * Сохраняет товар
 */
async function saveProduct(productId, closeModal) {
    const form = document.getElementById('productForm');
    const formData = new FormData(form);
    
    // Собираем основные данные
    const data = {
        name: formData.get('name')?.trim(),
        category: formData.get('category'),
        status: formData.get('status'),
        price: parseFloat(formData.get('price')) || 0,
        cost_price: parseFloat(formData.get('cost_price')) || 0,
        photo_url: formData.get('photo_url')?.trim() || null,
        attributes: {}
    };
    
    // Валидация
    if (!data.name) {
        showProductFormError('Название обязательно');
        return;
    }
    
    if (data.price <= 0) {
        showProductFormError('Цена должна быть больше 0');
        return;
    }
    
    // Собираем атрибуты категории
    const fields = getCategoryFields(data.category);
    fields.forEach(field => {
        const value = formData.get(`attr_${field.name}`);
        if (value) {
            data.attributes[field.name] = value.trim();
        }
    });
    
    // Валидируем атрибуты
    const validation = validateAttributes(data.category, data.attributes);
    if (!validation.valid) {
        showProductFormError(validation.errors[0]);
        return;
    }
    
    // Показываем лоадер
    const saveBtn = document.getElementById('saveProductBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    const btnLoader = saveBtn?.querySelector('.btn-loader');
    
    if (btnText) btnText.style.display = 'none';
    if (btnLoader) btnLoader.style.display = 'inline-flex';
    if (saveBtn) saveBtn.disabled = true;
    
    try {
        if (productId) {
            // Обновление
            const { error } = await supabase
                .from('products')
                .update({
                    ...data,
                    updated_at: new Date().toISOString()
                })
                .eq('id', productId);
            
            if (error) throw error;
            
            showNotification('Товар обновлен', 'success');
        } else {
            // Создание
            const { error } = await supabase
                .from('products')
                .insert({
                    ...data,
                    created_at: new Date().toISOString(),
                    created_by: state.user?.id
                });
            
            if (error) throw error;
            
            showNotification('Товар создан', 'success');
        }
        
        closeModal();
        clearCache();
        await loadProducts();
        
    } catch (error) {
        console.error('[Inventory] Save product error:', error);
        showProductFormError(error.message || 'Ошибка сохранения');
    } finally {
        if (btnText) btnText.style.display = 'inline';
        if (btnLoader) btnLoader.style.display = 'none';
        if (saveBtn) saveBtn.disabled = false;
    }
}

/**
 * Дублирует товар
 */
async function duplicateProduct(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    
    const { id, created_at, updated_at, ...productData } = product;
    
    try {
        const { error } = await supabase
            .from('products')
            .insert({
                ...productData,
                name: `${productData.name} (копия)`,
                created_at: new Date().toISOString(),
                created_by: state.user?.id
            });
        
        if (error) throw error;
        
        showNotification('Товар дублирован', 'success');
        clearCache();
        await loadProducts();
        
    } catch (error) {
        console.error('[Inventory] Duplicate error:', error);
        showNotification('Ошибка дублирования', 'error');
    }
}

/**
 * Удаляет товар(ы)
 */
async function deleteProduct(productId = null) {
    const ids = productId ? [productId] : Array.from(state.selectedIds);
    
    if (ids.length === 0) return;
    
    const confirmed = confirm(`Удалить ${ids.length} товар(ов)?`);
    if (!confirmed) return;
    
    try {
        const { error } = await supabase
            .from('products')
            .delete()
            .in('id', ids);
        
        if (error) throw error;
        
        state.selectedIds.clear();
        showNotification(`Удалено товаров: ${ids.length}`, 'success');
        clearCache();
        await loadProducts();
        
    } catch (error) {
        console.error('[Inventory] Delete error:', error);
        showNotification('Ошибка удаления', 'error');
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Очищает все фильтры
 */
function clearAllFilters() {
    state.searchQuery = '';
    state.selectedCategory = '';
    state.selectedStatus = '';
    state.sortBy = 'created_at-desc';
    state.currentPage = 0;
    
    if (DOM.searchInput) DOM.searchInput.value = '';
    if (DOM.categoryFilter) DOM.categoryFilter.value = '';
    if (DOM.statusFilter) DOM.statusFilter.value = '';
    if (DOM.sortSelect) DOM.sortSelect.value = 'created_at-desc';
    
    loadProducts();
}

/**
 * Экспорт в CSV
 */
function exportToCSV() {
    const headers = ['ID', 'Название', 'Категория', 'Цена', 'Себестоимость', 'Статус', 'Создан'];
    const rows = state.products.map(p => [
        p.id,
        p.name,
        getCategoryName(p.category),
        p.price,
        p.cost_price || '',
        getStatusText(p.status),
        formatDate(p.created_at)
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `products_${formatDate(new Date())}.csv`;
    link.click();
    
    showNotification('Экспорт завершен', 'success');
}

/**
 * Отображает информацию о пользователе
 */
function displayUserInfo() {
    if (DOM.userEmail) {
        const name = state.profile?.full_name || state.user?.email?.split('@')[0] || 'Пользователь';
        DOM.userEmail.textContent = name;
    }
}

/**
 * Показывает скелетон-лоадер
 */
function showLoader() {
    if (DOM.skeletonLoader) DOM.skeletonLoader.style.display = 'block';
    if (DOM.tableBody) DOM.tableBody.style.display = 'none';
    if (DOM.emptyState) DOM.emptyState.style.display = 'none';
}

/**
 * Скрывает скелетон-лоадер
 */
function hideLoader() {
    if (DOM.skeletonLoader) DOM.skeletonLoader.style.display = 'none';
    if (DOM.tableBody) DOM.tableBody.style.display = '';
}

/**
 * Обновляет состояние чекбокса "Выбрать все"
 */
function updateSelectAllCheckbox() {
    if (!DOM.selectAllCheckbox) return;
    
    const allSelected = state.products.length > 0 && 
                        state.products.every(p => state.selectedIds.has(p.id));
    const someSelected = state.products.some(p => state.selectedIds.has(p.id));
    
    DOM.selectAllCheckbox.checked = allSelected;
    DOM.selectAllCheckbox.indeterminate = someSelected && !allSelected;
}

/**
 * Показывает панель массовых действий
 */
function showBulkActions() {
    // TODO: Реализовать панель массовых действий
}

/**
 * Скрывает панель массовых действий
 */
function hideBulkActions() {
    // TODO: Реализовать скрытие панели
}

/**
 * Показывает ошибку в форме товара
 */
function showProductFormError(message) {
    const errorEl = document.getElementById('productFormError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

/**
 * Показывает уведомление
 */
function showNotification(message, type = 'info') {
    if (!DOM.notificationContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-left: 3px solid;
    `;
    
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    notification.style.borderLeftColor = colors[type] || colors.info;
    notification.textContent = message;
    
    DOM.notificationContainer.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

/**
 * Возвращает сообщение для пустого состояния
 */
function getEmptyStateMessage() {
    if (state.searchQuery) return 'По вашему запросу ничего не найдено';
    if (state.selectedCategory) return 'В этой категории нет товаров';
    if (state.selectedStatus) return 'Нет товаров с таким статусом';
    return 'Товары не найдены';
}

// ========== КЭШИРОВАНИЕ ==========

/**
 * Генерирует ключ кэша
 */
function getCacheKey() {
    return `${CACHE_KEY}_${state.selectedCategory}_${state.selectedStatus}_${state.sortBy}`;
}

/**
 * Получает данные из кэша
 */
function getFromCache(key) {
    try {
        const cached = sessionStorage.getItem(key);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_TTL) {
            sessionStorage.removeItem(key);
            return null;
        }
        
        return data;
    } catch {
        return null;
    }
}

/**
 * Сохраняет данные в кэш
 */
function setToCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify({
            ...data,
            timestamp: Date.now()
        }));
    } catch (e) {
        // Игнорируем ошибки кэширования
    }
}

/**
 * Очищает кэш
 */
function clearCache() {
    Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith(CACHE_KEY)) {
            sessionStorage.removeItem(key);
        }
    });
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
