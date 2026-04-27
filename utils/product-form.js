// ========================================
// FILE: utils/product-form.js
// ========================================

/**
 * Product Form Module (Supabase Version)
 * 
 * Универсальное модальное окно для создания и редактирования товара.
 * Восстановлена работа через Supabase.
 * 
 * @module product-form
 * @version 3.0.0
 * @changes
 * - v3.0.0: Прямой импорт supabase из supabase-client.js (ES-модули).
 * - v2.0.0: Предыдущая версия с createClient.
 */

import { products as productsDb } from '../core/db.js';
import { supabase } from '../core/supabase-client.js';
import { formatMoney, escapeHtml } from './formatters.js';
import { showNotification } from './ui.js';
import { 
    getCategorySchema, 
    getCategoryOptions, 
    validateAttributes, 
    createEmptyAttributes,
    CATEGORY_KEYS 
} from './categorySchema.js';

// ========== КОНСТАНТЫ ==========

const SUPABASE_STORAGE_BUCKET = 'product-photos';
const MAX_PHOTO_SIZE_MB = 5;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

// ========== ПРИВАТНЫЕ ФУНКЦИИ ==========

/**
 * Загружает фото в Supabase Storage
 */
async function uploadPhoto(file) {
    console.log('[ProductForm] Uploading photo...');
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
        });
    
    if (uploadError) {
        console.error('[ProductForm] Upload error:', uploadError);
        throw new Error('Ошибка загрузки фото: ' + uploadError.message);
    }
    
    const { data: { publicUrl } } = supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .getPublicUrl(fileName);
    
    console.log('[ProductForm] Photo uploaded:', publicUrl);
    return publicUrl;
}

/**
 * Удаляет фото из Supabase Storage
 */
async function deletePhoto(photoUrl) {
    if (!photoUrl) return;
    
    try {
        const fileName = photoUrl.split('/').pop();
        if (fileName) {
            await supabase.storage
                .from(SUPABASE_STORAGE_BUCKET)
                .remove([fileName]);
            console.log('[ProductForm] Photo deleted:', fileName);
        }
    } catch (error) {
        console.warn('[ProductForm] Failed to delete photo:', error);
    }
}

/**
 * Сохраняет товар в базу данных
 */
async function saveProduct(formData, mode, productId = null) {
    console.log(`[ProductForm] Saving product (${mode})...`);
    
    // Подготавливаем данные
    const productData = {
        name: formData.name.trim(),
        category: formData.category,
        price: parseFloat(formData.price) || 0,
        cost_price: parseFloat(formData.costPrice) || 0,
        attributes: formData.attributes
    };
    
    // Добавляем фото если есть
    if (formData.photoUrl) {
        productData.photo_url = formData.photoUrl;
    }
    
    if (mode === 'create') {
        productData.created_by = formData.userId;
        return await productsDb.create(productData);
    } else {
        return await productsDb.update(productId, productData);
    }
}

/**
 * Генерирует HTML полей для выбранной категории
 */
function renderCategoryFields(category, initialAttributes = {}) {
    const schema = getCategorySchema(category);
    
    if (!schema.fields || schema.fields.length === 0) {
        return '<p class="text-muted" style="padding: var(--spacing-4);">Нет дополнительных полей для этой категории</p>';
    }
    
    return schema.fields.map(field => {
        const fieldId = `attr_${field.name}`;
        const value = initialAttributes[field.name] || '';
        
        if (field.type === 'select' && field.options) {
            return `
                <div class="form-group">
                    <label for="${fieldId}">
                        ${escapeHtml(field.label)}
                        ${field.required ? '<span class="required">*</span>' : ''}
                    </label>
                    <select id="${fieldId}" name="${field.name}" class="category-field" ${field.required ? 'required' : ''}>
                        <option value="">Выберите...</option>
                        ${field.options.map(opt => {
                            const selected = opt === value ? 'selected' : '';
                            return `<option value="${escapeHtml(opt)}" ${selected}>${escapeHtml(opt)}</option>`;
                        }).join('')}
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
                        placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}>${escapeHtml(value)}</textarea>
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
                        placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(value)}"
                        ${field.required ? 'required' : ''}>
                    <div class="field-error" id="${fieldId}_error"></div>
                </div>
            `;
        }
    }).join('');
}

/**
 * Создаёт HTML модального окна
 */
function renderModalHtml(options) {
    const { mode, initialData = {} } = options;
    
    const title = mode === 'create' ? '➕ Добавление товара' : '✎ Редактирование товара';
    const submitText = mode === 'create' ? 'Сохранить товар' : 'Обновить товар';
    
    const initialCategory = initialData.category || CATEGORY_KEYS[0];
    const initialName = initialData.name || '';
    const initialPrice = initialData.price || '';
    const initialCost = initialData.cost_price || '';
    const initialPhotoUrl = initialData.photo_url || '';
    
    const categoryOptionsHtml = getCategoryOptions(true)
        .map(opt => {
            const selected = opt.value === initialCategory ? 'selected' : '';
            return `<option value="${opt.value}" ${selected}>${escapeHtml(opt.label)}</option>`;
        })
        .join('');
    
    const hasPhoto = !!initialPhotoUrl;
    
    return `
        <div class="modal product-form-modal">
            <div class="modal-header">
                <h3>${title}</h3>
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
                            <div class="photo-preview ${hasPhoto ? 'has-image' : ''}" id="photoPreview">
                                <div class="photo-placeholder-icon" id="photoPlaceholder" style="display: ${hasPhoto ? 'none' : 'flex'};">📸</div>
                                <img id="previewImg" src="${escapeHtml(initialPhotoUrl)}" alt="Превью" style="display: ${hasPhoto ? 'block' : 'none'};">
                            </div>
                            <div class="photo-upload-controls">
                                <input type="file" id="photoInput" accept="image/*" style="display: none;">
                                <button type="button" class="photo-upload-btn" id="uploadPhotoBtn">
                                    📁 Выбрать фото
                                </button>
                                <button type="button" class="photo-upload-btn photo-remove-btn" id="removePhotoBtn" style="display: ${hasPhoto ? 'inline-flex' : 'none'};">
                                    🗑️ Удалить
                                </button>
                                <span class="photo-upload-hint">JPG, PNG, WEBP до ${MAX_PHOTO_SIZE_MB}MB</span>
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
                            placeholder="Например: Джинсы Levi's 501" value="${escapeHtml(initialName)}" required>
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
                                    placeholder="0" min="0" step="1" value="${initialPrice}" required>
                            </div>
                            <div class="form-group">
                                <label for="productCost">
                                    Себестоимость (₽)
                                </label>
                                <input type="number" id="productCost" class="form-control" 
                                    placeholder="0" min="0" step="1" value="${initialCost}">
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
                            ${renderCategoryFields(initialCategory, initialData.attributes || {})}
                        </div>
                    </div>
                </form>
            </div>
            
            <div class="modal-footer">
                <button type="button" class="btn-secondary" id="cancelProductBtn">Отмена</button>
                <button type="button" class="btn-primary" id="submitProductBtn">${submitText}</button>
            </div>
        </div>
    `;
}

// ========== ПУБЛИЧНАЯ ФУНКЦИЯ ==========

/**
 * Открывает модальное окно для создания/редактирования товара
 */
export async function openProductFormModal(options = {}) {
    const {
        mode = 'create',
        initialData = {},
        userId = null,
        onSuccess = null
    } = options;
    
    const productId = mode === 'edit' ? initialData.id : null;
    
    return new Promise((resolve) => {
        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) {
            console.error('[ProductForm] modalContainer not found');
            resolve(null);
            return;
        }
        
        // Состояние формы
        let selectedCategory = initialData.category || CATEGORY_KEYS[0];
        let photoFile = null;
        let photoPreviewUrl = initialData.photo_url || null;
        let isSubmitting = false;
        
        // Создаём оверлей
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'productFormModal';
        overlay.innerHTML = renderModalHtml(options);
        
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
        const loadingOverlay = document.getElementById('formLoadingOverlay');
        
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
            const marginValueEl = document.getElementById('marginValue');
            const percentEl = document.getElementById('marginPercent');
            
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
            
            if (percentEl) {
                percentEl.textContent = `(${marginPercent.toFixed(1)}%)`;
            }
        }
        
        /**
         * Обработчик выбора фото
         */
        function handlePhotoSelect(file) {
            if (!file) return;
            
            if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
                showNotification('Пожалуйста, выберите изображение (JPG, PNG, WEBP)', 'warning');
                return;
            }
            
            if (file.size > MAX_PHOTO_SIZE_MB * 1024 * 1024) {
                showNotification(`Размер файла не должен превышать ${MAX_PHOTO_SIZE_MB}MB`, 'warning');
                return;
            }
            
            photoFile = file;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                photoPreviewUrl = e.target.result;
                
                const previewContainer = document.getElementById('photoPreview');
                const placeholder = document.getElementById('photoPlaceholder');
                const previewImg = document.getElementById('previewImg');
                
                if (previewContainer) previewContainer.classList.add('has-image');
                if (placeholder) placeholder.style.display = 'none';
                if (previewImg) {
                    previewImg.src = photoPreviewUrl;
                    previewImg.style.display = 'block';
                }
                if (removePhotoBtn) removePhotoBtn.style.display = 'inline-flex';
            };
            reader.readAsDataURL(file);
        }
        
        /**
         * Удаляет выбранное фото
         */
        async function removePhoto() {
            // Если редактируем и есть старое фото, удаляем из storage
            if (mode === 'edit' && initialData.photo_url && !photoFile) {
                await deletePhoto(initialData.photo_url);
            }
            
            photoFile = null;
            photoPreviewUrl = null;
            
            const previewContainer = document.getElementById('photoPreview');
            const placeholder = document.getElementById('photoPlaceholder');
            const previewImg = document.getElementById('previewImg');
            
            if (previewContainer) previewContainer.classList.remove('has-image');
            if (placeholder) placeholder.style.display = 'flex';
            if (previewImg) {
                previewImg.src = '';
                previewImg.style.display = 'none';
            }
            if (removePhotoBtn) removePhotoBtn.style.display = 'none';
            if (photoInput) photoInput.value = '';
        }
        
        /**
         * Валидирует форму
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
            const category = categorySelect?.value;
            if (!category) {
                errors.push('Выберите категорию');
                categorySelect?.classList.add('error');
            } else {
                categorySelect?.classList.remove('error');
            }
            
            // Цена
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
         */
        function collectFormData() {
            const name = document.getElementById('productName')?.value.trim() || '';
            const category = categorySelect?.value || CATEGORY_KEYS[0];
            const price = parseFloat(priceInput?.value) || 0;
            const costPrice = parseFloat(costInput?.value) || 0;
            
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
                photoUrl: photoPreviewUrl,
                photoFile,
                userId
            };
        }
        
        /**
         * Обработчик отправки формы
         */
        async function handleSubmit() {
            if (isSubmitting) return;
            
            const validation = validateForm();
            if (!validation.valid) {
                showNotification(validation.errors[0] || 'Пожалуйста, заполните все обязательные поля', 'error');
                return;
            }
            
            const formData = collectFormData();
            
            isSubmitting = true;
            
            if (submitBtn) submitBtn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            if (loadingOverlay) loadingOverlay.style.display = 'flex';
            
            try {
                // Загружаем новое фото если есть
                if (formData.photoFile) {
                    if (mode === 'edit' && initialData.photo_url) {
                        await deletePhoto(initialData.photo_url);
                    }
                    
                    const publicUrl = await uploadPhoto(formData.photoFile);
                    formData.photoUrl = publicUrl;
                }
                
                // Сохраняем товар
                const savedProduct = await saveProduct(formData, mode, productId);
                
                showNotification(
                    mode === 'create' ? `Товар "${savedProduct.name}" добавлен` : `Товар "${savedProduct.name}" обновлён`,
                    'success'
                );
                
                if (onSuccess) {
                    onSuccess(savedProduct);
                }
                
                overlay.remove();
                resolve(savedProduct);
                
            } catch (error) {
                console.error('[ProductForm] Submit error:', error);
                
                let errorMessage = 'Ошибка сохранения товара';
                if (error.message) {
                    errorMessage = error.message;
                }
                
                showNotification(errorMessage, 'error');
                
                if (submitBtn) submitBtn.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                
                isSubmitting = false;
            }
        }
        
        /**
         * Закрывает модальное окно
         */
        function closeModal() {
            if (!isSubmitting) {
                overlay.remove();
                resolve(null);
            }
        }
        
        // Привязываем обработчики
        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        
        categorySelect?.addEventListener('change', (e) => {
            selectedCategory = e.target.value;
            updateCategoryFields();
        });
        
        priceInput?.addEventListener('input', updateMarginIndicator);
        costInput?.addEventListener('input', updateMarginIndicator);
        
        uploadPhotoBtn?.addEventListener('click', () => photoInput?.click());
        
        photoInput?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) handlePhotoSelect(file);
        });
        
        removePhotoBtn?.addEventListener('click', removePhoto);
        
        submitBtn?.addEventListener('click', handleSubmit);
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Начальный расчёт маржи
        setTimeout(updateMarginIndicator, 50);
        
        console.log('[ProductForm] Modal opened');
    });
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    openProductFormModal
};

console.log('[ProductForm] Module loaded (Supabase Version)');