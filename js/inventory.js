// ========================================
// FILE: js/inventory.js
// ========================================

/**
 * Inventory Page Module - MPA Edition
 * 
 * Логика страницы управления складом. Загружает и отображает список товаров
 * в виде таблицы с возможностью поиска, фильтрации и CRUD-операций.
 * 
 * Архитектурные решения:
 * - Прямое использование глобального клиента window.supabase через getSupabase из core/auth.js.
 * - Полная независимость от других страниц (MPA).
 * - Кэширование данных в sessionStorage.
 * - Использование централизованных UI-утилит из utils/ui.js.
 * - Поддержка офлайн-режима при отсутствии сети.
 * - Интеграция с categorySchema.js для динамических полей форм.
 * 
 * @module inventory
 * @version 3.5.0
 * @changes
 * - Реализована функция openAddProductForm() с полноценной формой.
 * - Добавлена функция saveProduct() для сохранения в Supabase.
 * - Интегрирована загрузка фото через Supabase Storage.
 * - Добавлена динамическая генерация полей на основе categorySchema.
 * - Реализована валидация в реальном времени.
 * - Добавлен расчёт маржи в форме.
 */

import { requireAuth, logout, getCurrentUser, isOnline, getSupabase } from '../core/auth.js';
import { formatMoney, escapeHtml, getStatusText, getCategoryName, debounce } from '../utils/formatters.js';
import { showNotification, showConfirmDialog } from '../utils/ui.js';
import { 
    getCategorySchema, 
    getCategoryOptions, 
    validateAttributes, 
    createEmptyAttributes,
    CATEGORY_KEYS 
} from '../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========

const PRODUCTS_CACHE_KEY = 'sh_inventory_products';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const SUPABASE_STORAGE_BUCKET = 'product-photos';

// ========== СОСТОЯНИЕ ==========

const state = {
    user: null,
    isOffline: false,
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
    modalContainer: null,
    offlineBanner: null,
    offlineRetryBtn: null
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Показывает офлайн-баннер
 */
function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'block';
    }
}

/**
 * Скрывает офлайн-баннер
 */
function hideOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.style.display = 'none';
    }
}

/**
 * Показывает ошибку в баннере или через уведомление
 * @param {string} message - Сообщение об ошибке
 * @param {string} type - Тип ошибки (error, success, warning, info)
 */
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

/**
 * Скрывает баннер ошибки
 */
function hideError() {
    if (DOM.errorBanner) {
        DOM.errorBanner.style.display = 'none';
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
        console.warn('[Inventory] Failed to cache products:', e);
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
        console.warn('[Inventory] Failed to load cached products:', e);
    }
    return null;
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

/**
 * Загружает список товаров
 * @param {boolean} forceRefresh - Принудительно обновить без кэша
 */
async function loadProducts(forceRefresh = false) {
    if (state.isLoading) return;
    
    // Проверяем кэш при офлайн-режиме
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
        const supabase = await getSupabase();
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
        hideOfflineBanner();
        
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

/**
 * Обновляет список категорий в фильтре
 */
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

/**
 * Применяет фильтры к списку товаров
 */
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

/**
 * Обновляет панель статистики
 */
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
        <div class="stat-card-inline">
            <span class="stat-icon">📦</span>
            <div class="stat-content">
                <span class="stat-label">Всего товаров</span>
                <span class="stat-value">${total}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">✅</span>
            <div class="stat-content">
                <span class="stat-label">В наличии</span>
                <span class="stat-value" style="color: var(--color-success)">${inStock}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">💰</span>
            <div class="stat-content">
                <span class="stat-label">Продано</span>
                <span class="stat-value" style="color: var(--color-danger)">${sold}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">🔖</span>
            <div class="stat-content">
                <span class="stat-label">Забронировано</span>
                <span class="stat-value" style="color: var(--color-warning)">${reserved}</span>
            </div>
        </div>
        <div class="stat-card-inline">
            <span class="stat-icon">💵</span>
            <div class="stat-content">
                <span class="stat-label">Стоимость склада</span>
                <span class="stat-value">${formatMoney(totalValue)}</span>
            </div>
        </div>
    `;
}

// ========== CRUD ОПЕРАЦИИ ==========

/**
 * Удаляет товар
 * @param {string} id - ID товара
 */
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
        const supabase = await getSupabase();
        
        // Удаляем фото из storage если есть
        if (product.photo_url) {
            const photoPath = product.photo_url.split('/').pop();
            if (photoPath) {
                await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([photoPath]);
            }
        }
        
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

/**
 * Сохраняет новый товар в Supabase
 * @param {Object} formData - Данные формы
 * @returns {Promise<Object>} Сохранённый товар
 */
async function saveProduct(formData) {
    if (!isOnline()) {
        throw new Error('Отсутствует подключение к интернету');
    }
    
    const supabase = await getSupabase();
    
    // Загружаем фото если есть
    let photoUrl = null;
    if (formData.photoFile) {
        const fileExt = formData.photoFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(fileName, formData.photoFile);
        
        if (uploadError) throw uploadError;
        
        const { data: { publicUrl } } = supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .getPublicUrl(fileName);
        
        photoUrl = publicUrl;
    }
    
    // Подготавливаем данные для сохранения
    const productData = {
        name: formData.name.trim(),
        category: formData.category,
        price: parseFloat(formData.price) || 0,
        cost_price: parseFloat(formData.costPrice) || 0,
        status: 'in_stock',
        photo_url: photoUrl,
        attributes: formData.attributes,
        created_by: state.user?.id,
        created_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
        .from('products')
        .insert(productData)
        .select()
        .single();
    
    if (error) throw error;
    
    return data;
}

/**
 * Открывает форму добавления товара
 */
function openAddProductForm() {
    if (!isOnline()) {
        showError('Добавление товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    const modalContainer = DOM.modalContainer || document.getElementById('modalContainer');
    if (!modalContainer) return;
    
    // Создаём оверлей
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'productFormModal';
    
    // Начальное состояние формы
    let selectedCategory = CATEGORY_KEYS[0];
    let photoFile = null;
    let photoPreviewUrl = null;
    let isSubmitting = false;
    
    /**
     * Генерирует HTML полей для выбранной категории
     * @param {string} category - Ключ категории
     * @returns {string} HTML полей
     */
    function renderCategoryFields(category) {
        const schema = getCategorySchema(category);
        if (!schema.fields || schema.fields.length === 0) {
            return '<p class="text-muted">Нет дополнительных полей для этой категории</p>';
        }
        
        return schema.fields.map(field => {
            const fieldId = `attr_${field.name}`;
            
            if (field.type === 'select' && field.options) {
                return `
                    <div class="form-group">
                        <label for="${fieldId}">
                            ${escapeHtml(field.label)}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <select id="${fieldId}" name="${field.name}" class="category-field" ${field.required ? 'required' : ''}>
                            <option value="">Выберите...</option>
                            ${field.options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
                        </select>
                        <div class="field-error" id="${fieldId}_error"></div>
                    </div>
                `;
            } else if (field.type === 'textarea') {
                return `
                    <div class="form-group">
                        <label for="${fieldId}">
                            ${escapeHtml(field.label)}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <textarea id="${fieldId}" name="${field.name}" class="category-field" 
                            placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}></textarea>
                        <div class="field-error" id="${fieldId}_error"></div>
                    </div>
                `;
            } else {
                return `
                    <div class="form-group">
                        <label for="${fieldId}">
                            ${escapeHtml(field.label)}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <input type="${field.type || 'text'}" id="${fieldId}" name="${field.name}" class="category-field"
                            placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}>
                        <div class="field-error" id="${fieldId}_error"></div>
                    </div>
                `;
            }
        }).join('');
    }
    
    /**
     * Обновляет секцию с полями категории
     */
    function updateCategoryFields() {
        const fieldsContainer = document.getElementById('categoryFieldsContainer');
        if (fieldsContainer) {
            fieldsContainer.innerHTML = renderCategoryFields(selectedCategory);
        }
    }
    
    /**
     * Рассчитывает и обновляет индикатор маржи
     */
    function updateMarginIndicator() {
        const priceInput = document.getElementById('productPrice');
        const costInput = document.getElementById('productCost');
        const marginValueEl = document.getElementById('marginValue');
        
        if (!priceInput || !costInput || !marginValueEl) return;
        
        const price = parseFloat(priceInput.value) || 0;
        const cost = parseFloat(costInput.value) || 0;
        
        let margin = 0;
        let marginPercent = 0;
        
        if (price > 0) {
            margin = price - cost;
            marginPercent = (margin / price) * 100;
        }
        
        marginValueEl.textContent = formatMoney(margin);
        marginValueEl.className = 'margin-value';
        
        if (margin > 0) {
            marginValueEl.classList.add('positive');
        } else if (margin < 0) {
            marginValueEl.classList.add('negative');
        } else {
            marginValueEl.classList.add('warning');
        }
        
        // Показываем процент маржи
        const percentEl = document.getElementById('marginPercent');
        if (percentEl) {
            percentEl.textContent = `(${marginPercent.toFixed(1)}%)`;
        }
    }
    
    /**
     * Обработчик выбора фото
     */
    function handlePhotoSelect(file) {
        if (!file) return;
        
        // Проверяем тип файла
        if (!file.type.startsWith('image/')) {
            showNotification('Пожалуйста, выберите изображение', 'warning');
            return;
        }
        
        // Проверяем размер (макс 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Размер файла не должен превышать 5MB', 'warning');
            return;
        }
        
        photoFile = file;
        
        // Создаём превью
        const reader = new FileReader();
        reader.onload = (e) => {
            photoPreviewUrl = e.target.result;
            
            const previewContainer = document.getElementById('photoPreview');
            const placeholder = document.getElementById('photoPlaceholder');
            const previewImg = document.getElementById('previewImg');
            const removeBtn = document.getElementById('removePhotoBtn');
            
            if (previewContainer && previewImg) {
                previewImg.src = photoPreviewUrl;
                previewContainer.classList.add('has-image');
            }
            if (placeholder) placeholder.style.display = 'none';
            if (previewImg) previewImg.style.display = 'block';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        };
        reader.readAsDataURL(file);
    }
    
    /**
     * Удаляет выбранное фото
     */
    function removePhoto() {
        photoFile = null;
        photoPreviewUrl = null;
        
        const previewContainer = document.getElementById('photoPreview');
        const placeholder = document.getElementById('photoPlaceholder');
        const previewImg = document.getElementById('previewImg');
        const removeBtn = document.getElementById('removePhotoBtn');
        const fileInput = document.getElementById('photoInput');
        
        if (previewContainer) previewContainer.classList.remove('has-image');
        if (placeholder) placeholder.style.display = 'flex';
        if (previewImg) {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }
        if (removeBtn) removeBtn.style.display = 'none';
        if (fileInput) fileInput.value = '';
    }
    
    /**
     * Валидирует форму
     * @returns {Object} { valid, errors }
     */
    function validateForm() {
        const errors = [];
        
        // Название
        const nameInput = document.getElementById('productName');
        const name = nameInput?.value.trim();
        if (!name) {
            errors.push('Название товара обязательно');
            nameInput?.classList.add('error');
        } else {
            nameInput?.classList.remove('error');
        }
        
        // Категория
        const categorySelect = document.getElementById('productCategory');
        const category = categorySelect?.value;
        if (!category) {
            errors.push('Выберите категорию');
            categorySelect?.classList.add('error');
        } else {
            categorySelect?.classList.remove('error');
        }
        
        // Цена
        const priceInput = document.getElementById('productPrice');
        const price = parseFloat(priceInput?.value);
        if (isNaN(price) || price < 0) {
            errors.push('Укажите корректную цену');
            priceInput?.classList.add('error');
        } else {
            priceInput?.classList.remove('error');
        }
        
        // Валидация атрибутов категории
        if (category) {
            const attributes = {};
            document.querySelectorAll('.category-field').forEach(field => {
                if (field.name) {
                    attributes[field.name] = field.value;
                }
            });
            
            const validation = validateAttributes(category, attributes);
            if (!validation.valid) {
                errors.push(...validation.errors);
                
                // Подсвечиваем ошибочные поля
                validation.missingFields.forEach(fieldName => {
                    const field = document.querySelector(`[name="${fieldName}"]`);
                    if (field) {
                        field.classList.add('error');
                        const errorEl = document.getElementById(`attr_${fieldName}_error`);
                        if (errorEl) errorEl.textContent = 'Обязательное поле';
                    }
                });
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * Собирает данные формы
     * @returns {Object}
     */
    function collectFormData() {
        const name = document.getElementById('productName')?.value.trim() || '';
        const category = document.getElementById('productCategory')?.value || CATEGORY_KEYS[0];
        const price = parseFloat(document.getElementById('productPrice')?.value) || 0;
        const costPrice = parseFloat(document.getElementById('productCost')?.value) || 0;
        
        const attributes = {};
        document.querySelectorAll('.category-field').forEach(field => {
            if (field.name) {
                attributes[field.name] = field.value;
            }
        });
        
        return {
            name,
            category,
            price,
            costPrice,
            attributes,
            photoFile
        };
    }
    
    /**
     * Обработчик отправки формы
     */
    async function handleSubmit() {
        if (isSubmitting) return;
        
        // Валидация
        const validation = validateForm();
        if (!validation.valid) {
            showNotification(validation.errors[0] || 'Пожалуйста, заполните все обязательные поля', 'error');
            return;
        }
        
        const formData = collectFormData();
        
        isSubmitting = true;
        
        // Показываем лоадер
        const submitBtn = document.getElementById('submitProductBtn');
        const cancelBtn = document.getElementById('cancelProductBtn');
        const loadingOverlay = document.getElementById('formLoadingOverlay');
        
        if (submitBtn) submitBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        
        try {
            const newProduct = await saveProduct(formData);
            
            // Добавляем в локальный стейт
            state.products.unshift(newProduct);
            saveProductsToCache(state.products);
            updateCategoryFilter();
            applyFilters();
            updateStats();
            
            showNotification(`Товар "${newProduct.name}" добавлен`, 'success');
            
            // Закрываем модальное окно
            overlay.remove();
            
        } catch (error) {
            console.error('[Inventory] Save product error:', error);
            showNotification('Ошибка сохранения: ' + error.message, 'error');
            
            if (submitBtn) submitBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
        }
        
        isSubmitting = false;
    }
    
    // Собираем HTML модального окна
    const categoryOptionsHtml = getCategoryOptions(true)
        .map(opt => `<option value="${opt.value}">${escapeHtml(opt.label)}</option>`)
        .join('');
    
    overlay.innerHTML = `
        <div class="modal product-form-modal">
            <div class="modal-header">
                <h3>➕ Добавление товара</h3>
                <button class="btn-close" id="closeModalBtn">×</button>
            </div>
            
            <div class="modal-body">
                <div id="formLoadingOverlay" class="form-loading-overlay" style="display: none;">
                    <div class="form-loading-spinner"></div>
                </div>
                
                <form id="productForm" onsubmit="return false;">
                    <!-- Фото -->
                    <div class="photo-upload-section">
                        <label class="photo-upload-label">Фото товара</label>
                        <div class="photo-upload-container">
                            <div class="photo-preview" id="photoPreview">
                                <div class="photo-placeholder-icon" id="photoPlaceholder">📸</div>
                                <img id="previewImg" src="" alt="Превью" style="display: none;">
                            </div>
                            <div class="photo-upload-controls">
                                <input type="file" id="photoInput" accept="image/*" style="display: none;">
                                <button type="button" class="photo-upload-btn" id="uploadPhotoBtn">
                                    📁 Выбрать фото
                                </button>
                                <button type="button" class="photo-upload-btn photo-remove-btn" id="removePhotoBtn" style="display: none;">
                                    🗑️ Удалить
                                </button>
                                <span class="photo-upload-hint">JPG, PNG до 5MB</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Основные поля -->
                    <div class="form-group">
                        <label for="productName">
                            Название товара
                            <span class="required">*</span>
                        </label>
                        <input type="text" id="productName" class="form-control" 
                            placeholder="Например: Джинсы Levi's 501" required>
                        <div class="field-error" id="productName_error"></div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label for="productCategory">
                                Категория
                                <span class="required">*</span>
                            </label>
                            <select id="productCategory" class="form-control" required>
                                ${categoryOptionsHtml}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Секция ценообразования -->
                    <div class="pricing-section">
                        <div class="pricing-row">
                            <div class="form-group">
                                <label for="productPrice">
                                    Цена продажи (₽)
                                    <span class="required">*</span>
                                </label>
                                <input type="number" id="productPrice" class="form-control" 
                                    placeholder="0" min="0" step="1" required>
                            </div>
                            <div class="form-group">
                                <label for="productCost">
                                    Себестоимость (₽)
                                </label>
                                <input type="number" id="productCost" class="form-control" 
                                    placeholder="0" min="0" step="1">
                            </div>
                        </div>
                        
                        <div class="margin-indicator">
                            <span class="margin-label">Маржа:</span>
                            <span>
                                <span class="margin-value" id="marginValue">0 ₽</span>
                                <span id="marginPercent" class="text-muted"></span>
                            </span>
                        </div>
                    </div>
                    
                    <!-- Динамические поля категории -->
                    <div class="category-fields">
                        <h4 class="category-fields-title">Характеристики товара</h4>
                        <div id="categoryFieldsContainer">
                            ${renderCategoryFields(selectedCategory)}
                        </div>
                    </div>
                </form>
            </div>
            
            <div class="modal-footer">
                <button type="button" class="btn-secondary" id="cancelProductBtn">Отмена</button>
                <button type="button" class="btn-primary" id="submitProductBtn">Сохранить товар</button>
            </div>
        </div>
    `;
    
    modalContainer.appendChild(overlay);
    
    // Кэшируем элементы
    const closeBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelProductBtn');
    const submitBtn = document.getElementById('submitProductBtn');
    const categorySelect = document.getElementById('productCategory');
    const priceInput = document.getElementById('productPrice');
    const costInput = document.getElementById('productCost');
    const photoInput = document.getElementById('photoInput');
    const uploadPhotoBtn = document.getElementById('uploadPhotoBtn');
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    
    // Обработчики закрытия
    const closeModal = () => {
        if (!isSubmitting) {
            overlay.remove();
        }
    };
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    
    // Обработчик смены категории
    categorySelect?.addEventListener('change', (e) => {
        selectedCategory = e.target.value;
        updateCategoryFields();
    });
    
    // Обработчики расчёта маржи
    priceInput?.addEventListener('input', updateMarginIndicator);
    costInput?.addEventListener('input', updateMarginIndicator);
    
    // Обработчики фото
    uploadPhotoBtn?.addEventListener('click', () => {
        photoInput?.click();
    });
    
    photoInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handlePhotoSelect(file);
    });
    
    removePhotoBtn?.addEventListener('click', removePhoto);
    
    // Обработчик отправки
    submitBtn?.addEventListener('click', handleSubmit);
    
    // Закрытие по Escape
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Начальный расчёт маржи
    setTimeout(updateMarginIndicator, 50);
}

/**
 * Открывает форму редактирования товара
 * @param {string} id - ID товара
 */
function openEditProductForm(id) {
    if (!isOnline()) {
        showError('Редактирование товара недоступно в офлайн-режиме', 'warning');
        return;
    }
    
    const product = state.products.find(p => p.id === id);
    if (!product) {
        showNotification('Товар не найден', 'error');
        return;
    }
    
    // TODO: Реализовать редактирование (можно использовать ту же форму с предзаполнением)
    showNotification('Редактирование будет доступно в следующей версии', 'info');
}

// ========== РЕНДЕРИНГ ==========

/**
 * Отрисовывает состояние загрузки
 */
function renderLoadingState() {
    if (!DOM.tableBody) return;
    
    DOM.tableBody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <span style="margin-left: 12px;">Загрузка товаров...</span>
            </td>
        </tr>
    `;
}

/**
 * Отрисовывает пустое состояние
 */
function renderEmptyState() {
    if (!DOM.tableBody) return;
    
    let message = 'Товары не найдены';
    if (state.searchQuery || state.selectedStatus || state.selectedCategory) {
        message = 'По вашему запросу ничего не найдено';
    }
    
    DOM.tableBody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: 60px;">
                <div class="empty-state-icon">📦</div>
                <p style="margin-top: 16px; color: var(--color-text-muted);">${escapeHtml(message)}</p>
            </td>
        </tr>
    `;
}

/**
 * Получает CSS-класс для статуса
 * @param {string} status - Ключ статуса
 * @returns {string}
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
 * Главная функция рендеринга
 */
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
    
    const productsTable = document.getElementById('productsTable');
    if (productsTable) {
        productsTable.style.display = 'table';
    }
    
    DOM.tableBody.innerHTML = state.filteredProducts.map(product => {
        const statusText = getStatusText(product.status);
        const statusClass = getStatusClass(product.status);
        const safeName = escapeHtml(product.name || 'Без названия');
        const safeId = escapeHtml(product.id?.slice(0, 8) || '—');
        const safePhotoUrl = product.photo_url ? escapeHtml(product.photo_url) : null;
        
        return `
            <tr class="product-row" data-id="${product.id}">
                <td class="checkbox-cell">
                    <input type="checkbox" class="table-checkbox" data-id="${product.id}">
                </td>
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
                <td class="price-cell">
                    <div class="price-main">${formatMoney(product.price)}</div>
                    ${product.cost_price ? `<div class="price-cost">Себ.: ${formatMoney(product.cost_price)}</div>` : ''}
                </td>
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

/**
 * Привязывает обработчики к кнопкам в строках таблицы
 */
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

/**
 * Кэширует DOM элементы
 */
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
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.offlineRetryBtn = document.getElementById('offlineRetryBtn');
}

/**
 * Отображает email пользователя в шапке
 */
function displayUserInfo() {
    if (DOM.userEmail) {
        if (state.user) {
            const name = state.user.email?.split('@')[0] || 'Пользователь';
            DOM.userEmail.textContent = name;
        } else {
            DOM.userEmail.textContent = 'Офлайн-режим';
        }
    }
}

/**
 * Привязывает обработчики событий
 */
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
    
    if (DOM.offlineRetryBtn) {
        DOM.offlineRetryBtn.addEventListener('click', () => {
            loadProducts(true);
        });
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
    
    // Закрытие баннера ошибки
    const closeErrorBtn = document.getElementById('closeErrorBtn');
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', hideError);
    }
    
    // Выделение всех чекбоксов
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.table-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
    }
    
    // Слушатели сети
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
        if (!state.user) {
            location.reload();
        }
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Отсутствует подключение к интернету', 'warning');
    });
}

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Inventory] Initializing MPA page...');
    
    cacheElements();
    
    const authResult = await requireAuth();
    
    if (authResult.user) {
        state.user = authResult.user;
        state.isOffline = false;
        hideOfflineBanner();
    } else if (authResult.offline || authResult.networkError) {
        state.isOffline = true;
        state.user = null;
        showOfflineBanner();
        showNotification('Работа в офлайн-режиме. Некоторые функции недоступны.', 'warning');
    } else if (authResult.authError) {
        return;
    }
    
    displayUserInfo();
    attachEvents();
    
    await loadProducts();
    
    console.log('[Inventory] Page initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
