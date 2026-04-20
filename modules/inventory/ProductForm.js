/**
 * Product Form Component
 * 
 * Форма создания и редактирования товара с расширенными возможностями.
 * 
 * Архитектурные решения:
 * - Использование FormData API для автоматического сбора данных
 * - Динамические поля атрибутов на основе CATEGORY_SCHEMA
 * - Предпросмотр и сжатие изображений перед загрузкой
 * - Прогресс-бар загрузки с отменой
 * - Калькулятор маржи в реальном времени
 * - Автосохранение черновика в localStorage
 * - Валидация в реальном времени с подсветкой полей
 * - Быстрые кнопки ценообразования
 * - Подсказка рыночной цены по категории
 * 
 * @module ProductForm
 * @extends BaseComponent
 * @requires ProductService
 * @requires Storage
 * @requires AuthManager
 * @requires Notification
 * @requires ConfirmDialog
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { Storage } from '../../core/SupabaseClient.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { formatMoney, formatPercent } from '../../utils/formatters.js';
import { 
    CATEGORY_SCHEMA, 
    getCategorySchema, 
    getCategoryOptions,
    getCategoryName 
} from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const AUTO_SAVE_KEY = 'product_form_draft';
const AUTO_SAVE_INTERVAL = 10000; // 10 секунд
const MAX_PHOTO_SIZE_MB = 5;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const IMAGE_QUALITY = 0.85; // Качество сжатия JPEG

/**
 * Тексты ошибок валидации
 */
const VALIDATION_MESSAGES = {
    name: {
        required: 'Название обязательно',
        minLength: 'Название должно быть не менее 2 символов',
        maxLength: 'Название не должно превышать 100 символов',
        duplicate: 'Товар с таким названием уже существует'
    },
    price: {
        required: 'Цена продажи обязательна',
        min: 'Цена должна быть больше 0',
        max: 'Цена не должна превышать 10 000 000 ₽',
        lessThanCost: 'Цена продажи должна быть больше себестоимости'
    },
    cost_price: {
        min: 'Себестоимость не может быть отрицательной',
        max: 'Себестоимость не должна превышать 10 000 000 ₽'
    },
    category: {
        required: 'Выберите категорию'
    },
    photo: {
        size: `Файл не должен превышать ${MAX_PHOTO_SIZE_MB} МБ`,
        type: 'Неподдерживаемый формат. Разрешены: JPEG, PNG, WebP'
    }
};

/**
 * Быстрые наценки
 */
const MARKUP_PRESETS = [
    { label: '+30%', value: 1.3 },
    { label: '+50%', value: 1.5 },
    { label: 'x2', value: 2 },
    { label: 'x2.5', value: 2.5 },
    { label: 'x3', value: 3 }
];

export class ProductForm extends BaseComponent {
    constructor(container, product = null) {
        super(container);
        this.product = product;
        this.isEditMode = !!product;
        this.selectedCategory = product?.category || '';
        
        // Состояние формы
        this._state = {
            photoFile: null,
            photoPreview: product?.photo_url || null,
            isUploading: false,
            uploadProgress: 0,
            validationErrors: new Map(),
            marketPrice: null,
            isCheckingName: false,
            isNameUnique: true,
            isDirty: false
        };
        
        // Таймеры
        this.autoSaveTimer = null;
        this.nameCheckTimer = null;
        
        // Контроллер для отмены загрузки
        this.abortController = null;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const categoryOptions = getCategoryOptions();
        const schema = this.selectedCategory ? getCategorySchema(this.selectedCategory) : null;
        
        // Восстанавливаем черновик если это новый товар
        const draft = !this.isEditMode ? this.loadDraft() : null;
        
        const name = draft?.name || this.product?.name || '';
        const price = draft?.price || this.product?.price || '';
        const costPrice = draft?.cost_price || this.product?.cost_price || '';
        const keywords = draft?.keywords || this.product?.keywords || '';
        
        // Рассчитываем маржу
        const margin = this.calculateMargin(price, costPrice);
        const profit = this.calculateProfit(price, costPrice);
        
        return `
            <div class="modal-overlay" data-ref="overlay">
                <div class="modal product-form-modal" data-ref="modal">
                    <div class="modal-header">
                        <h3>${this.isEditMode ? 'Редактирование товара' : 'Новый товар'}</h3>
                        <button class="btn-icon btn-close" data-ref="closeBtn" title="Закрыть">✕</button>
                    </div>
                    
                    <div class="modal-body">
                        <form id="product-form" data-ref="form">
                            <!-- Основные поля -->
                            <div class="form-row">
                                <div class="form-group ${this.hasError('name') ? 'has-error' : ''}">
                                    <label for="prod-name">
                                        Название <span class="required">*</span>
                                    </label>
                                    <div class="input-wrapper">
                                        <input 
                                            type="text" 
                                            id="prod-name" 
                                            name="name" 
                                            data-ref="nameInput"
                                            value="${this.escapeHtml(name)}"
                                            placeholder="Например: Детская куртка"
                                            autocomplete="off"
                                        >
                                        ${this._state.isCheckingName ? `
                                            <span class="input-loader">
                                                <span class="loading-spinner small"></span>
                                            </span>
                                        ` : ''}
                                        ${!this._state.isNameUnique && !this.hasError('name') ? `
                                            <span class="input-error-icon">⚠</span>
                                        ` : ''}
                                    </div>
                                    ${this.renderError('name')}
                                    ${!this._state.isNameUnique ? `
                                        <div class="validation-warning">
                                            ${VALIDATION_MESSAGES.name.duplicate}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group ${this.hasError('category') ? 'has-error' : ''}">
                                    <label for="prod-category">
                                        Категория <span class="required">*</span>
                                    </label>
                                    <select 
                                        id="prod-category" 
                                        name="category" 
                                        data-ref="categorySelect"
                                    >
                                        <option value="">Выберите категорию</option>
                                        ${categoryOptions.map(opt => `
                                            <option value="${opt.value}" 
                                                ${(draft?.category || this.selectedCategory) === opt.value ? 'selected' : ''}>
                                                ${opt.label}
                                            </option>
                                        `).join('')}
                                    </select>
                                    ${this.renderError('category')}
                                </div>
                            </div>
                            
                            <!-- Цены и калькулятор -->
                            <div class="pricing-section">
                                <div class="form-row">
                                    <div class="form-group ${this.hasError('cost_price') ? 'has-error' : ''}">
                                        <label for="prod-cost">Себестоимость (₽)</label>
                                        <input 
                                            type="number" 
                                            id="prod-cost" 
                                            name="cost_price" 
                                            data-ref="costInput"
                                            value="${costPrice}"
                                            step="0.01" 
                                            min="0" 
                                            placeholder="0.00"
                                        >
                                        ${this.renderError('cost_price')}
                                    </div>
                                    
                                    <div class="form-group ${this.hasError('price') ? 'has-error' : ''}">
                                        <label for="prod-price">
                                            Цена продажи (₽) <span class="required">*</span>
                                        </label>
                                        <input 
                                            type="number" 
                                            id="prod-price" 
                                            name="price" 
                                            data-ref="priceInput"
                                            value="${price}"
                                            step="0.01" 
                                            min="0" 
                                            placeholder="0.00"
                                        >
                                        ${this.renderError('price')}
                                    </div>
                                </div>
                                
                                <!-- Быстрые наценки -->
                                <div class="markup-presets">
                                    <span class="markup-label">Наценка:</span>
                                    ${MARKUP_PRESETS.map(preset => `
                                        <button 
                                            type="button" 
                                            class="btn-ghost btn-sm markup-btn"
                                            data-markup="${preset.value}"
                                            title="Установить цену с наценкой ${preset.label}"
                                        >
                                            ${preset.label}
                                        </button>
                                    `).join('')}
                                </div>
                                
                                <!-- Калькулятор маржи -->
                                <div class="margin-calculator">
                                    <div class="margin-row">
                                        <span>Прибыль:</span>
                                        <strong class="${profit >= 0 ? 'text-success' : 'text-danger'}">
                                            ${formatMoney(profit)}
                                        </strong>
                                    </div>
                                    <div class="margin-row">
                                        <span>Маржа:</span>
                                        <strong class="${margin >= 0 ? 'text-success' : 'text-danger'}">
                                            ${margin.toFixed(1)}%
                                        </strong>
                                    </div>
                                    ${this._state.marketPrice ? `
                                        <div class="margin-row market-hint">
                                            <span>Средняя цена в категории:</span>
                                            <strong>${formatMoney(this._state.marketPrice)}</strong>
                                            <button 
                                                type="button" 
                                                class="btn-ghost btn-xs" 
                                                data-ref="applyMarketPrice"
                                                title="Применить рыночную цену"
                                            >
                                                Применить
                                            </button>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            
                            <!-- Ключевые слова (теги) -->
                            <div class="form-group">
                                <label for="prod-keywords">
                                    Ключевые слова
                                    <span class="label-hint">через запятую</span>
                                </label>
                                <input 
                                    type="text" 
                                    id="prod-keywords" 
                                    name="keywords" 
                                    data-ref="keywordsInput"
                                    value="${this.escapeHtml(keywords)}"
                                    placeholder="бренд, цвет, материал, сезон"
                                    autocomplete="off"
                                >
                                <small class="form-hint">
                                    Помогает найти товар при поиске
                                </small>
                            </div>
                            
                            <!-- Динамические поля атрибутов -->
                            <div data-ref="dynamicFieldsContainer" class="dynamic-fields">
                                ${this.renderDynamicFields(schema, draft?.attributes || this.product?.attributes)}
                            </div>
                            
                            <!-- Загрузка фото -->
                            <div class="form-group">
                                <label>Фото товара</label>
                                
                                <div class="photo-upload-area" data-ref="photoUploadArea">
                                    ${this.renderPhotoPreview()}
                                    
                                    <div class="upload-controls">
                                        <label class="btn-secondary upload-btn">
                                            <input 
                                                type="file" 
                                                name="photo" 
                                                data-ref="photoInput"
                                                accept="${ALLOWED_PHOTO_TYPES.join(',')}"
                                                style="display: none;"
                                            >
                                            ${this._state.photoPreview ? 'Заменить фото' : 'Выбрать фото'}
                                        </label>
                                        
                                        ${this._state.photoPreview ? `
                                            <button 
                                                type="button" 
                                                class="btn-ghost" 
                                                data-ref="removePhotoBtn"
                                            >
                                                Удалить
                                            </button>
                                        ` : ''}
                                    </div>
                                    
                                    <!-- Прогресс-бар загрузки -->
                                    ${this._state.isUploading ? `
                                        <div class="upload-progress">
                                            <div class="progress-bar">
                                                <div 
                                                    class="progress-fill" 
                                                    style="width: ${this._state.uploadProgress}%"
                                                ></div>
                                            </div>
                                            <span class="progress-text">${this._state.uploadProgress}%</span>
                                            <button 
                                                type="button" 
                                                class="btn-ghost btn-sm" 
                                                data-ref="cancelUploadBtn"
                                            >
                                                Отмена
                                            </button>
                                        </div>
                                    ` : ''}
                                    
                                    <small class="form-hint">
                                        JPEG, PNG, WebP до ${MAX_PHOTO_SIZE_MB} МБ
                                    </small>
                                </div>
                            </div>
                            
                            <!-- Черновик (только для нового товара) -->
                            ${!this.isEditMode && this.hasDraft() ? `
                                <div class="draft-notice">
                                    <span>🔄 Найден сохраненный черновик</span>
                                    <button type="button" class="btn-ghost btn-sm" data-ref="restoreDraftBtn">
                                        Восстановить
                                    </button>
                                    <button type="button" class="btn-ghost btn-sm" data-ref="clearDraftBtn">
                                        Очистить
                                    </button>
                                </div>
                            ` : ''}
                        </form>
                    </div>
                    
                    <div class="modal-footer">
                        <div class="form-actions">
                            <button 
                                type="submit" 
                                class="btn-primary" 
                                data-ref="submitBtn"
                                form="product-form"
                                ${this._state.isUploading ? 'disabled' : ''}
                            >
                                <span class="btn-text">
                                    ${this.isEditMode ? 'Сохранить' : 'Добавить товар'}
                                </span>
                                <span class="btn-loader" style="display: none;">
                                    <span class="loading-spinner small"></span>
                                </span>
                            </button>
                            <button 
                                type="button" 
                                class="btn-secondary" 
                                data-ref="cancelBtn"
                            >
                                Отмена
                            </button>
                        </div>
                        
                        <div class="form-hint text-right">
                            <span class="required">*</span> Обязательные поля
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Рендерит превью фото
     */
    renderPhotoPreview() {
        if (!this._state.photoPreview) {
            return `
                <div class="photo-preview empty">
                    <span class="preview-placeholder">📷</span>
                    <span class="preview-text">Нет фото</span>
                </div>
            `;
        }
        
        return `
            <div class="photo-preview">
                <img src="${this._state.photoPreview}" alt="Превью товара">
            </div>
        `;
    }

    /**
     * Рендерит динамические поля атрибутов
     */
    renderDynamicFields(schema, attributes = {}) {
        if (!schema) {
            return '<div class="form-hint text-center">Выберите категорию для указания характеристик</div>';
        }
        
        return `
            <div class="attributes-section">
                <h4>Характеристики</h4>
                ${schema.fields.map(field => this.renderAttributeField(field, attributes[field.name])).join('')}
            </div>
        `;
    }

    /**
     * Рендерит одно поле атрибута
     */
    renderAttributeField(field, value = '') {
        const error = this.hasError(`attr_${field.name}`);
        const fieldId = `attr-${field.name}`;
        
        switch (field.type) {
            case 'select':
                return `
                    <div class="form-group ${error ? 'has-error' : ''}">
                        <label for="${fieldId}">
                            ${field.label} ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <select 
                            id="${fieldId}" 
                            name="attr_${field.name}" 
                            ${field.required ? 'required' : ''}
                        >
                            <option value="">Выберите</option>
                            ${field.options.map(opt => `
                                <option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>
                            `).join('')}
                        </select>
                        ${this.renderError(`attr_${field.name}`)}
                    </div>
                `;
                
            case 'textarea':
                return `
                    <div class="form-group ${error ? 'has-error' : ''}">
                        <label for="${fieldId}">
                            ${field.label} ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <textarea 
                            id="${fieldId}" 
                            name="attr_${field.name}" 
                            placeholder="${field.placeholder || ''}"
                            rows="3"
                            ${field.required ? 'required' : ''}
                        >${this.escapeHtml(value)}</textarea>
                        ${this.renderError(`attr_${field.name}`)}
                    </div>
                `;
                
            default:
                return `
                    <div class="form-group ${error ? 'has-error' : ''}">
                        <label for="${fieldId}">
                            ${field.label} ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <input 
                            type="${field.type}" 
                            id="${fieldId}" 
                            name="attr_${field.name}" 
                            value="${this.escapeHtml(value)}"
                            placeholder="${field.placeholder || ''}"
                            ${field.required ? 'required' : ''}
                        >
                        ${this.renderError(`attr_${field.name}`)}
                    </div>
                `;
        }
    }

    /**
     * Рендерит ошибку валидации
     */
    renderError(fieldName) {
        const error = this._state.validationErrors.get(fieldName);
        if (!error) return '';
        
        return `<div class="validation-error">${error}</div>`;
    }

    /**
     * Проверяет, есть ли ошибка для поля
     */
    hasError(fieldName) {
        return this._state.validationErrors.has(fieldName);
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        const form = this.refs.get('form');
        
        // Закрытие модалки
        this.addDomListener('closeBtn', 'click', () => this.handleClose());
        this.addDomListener('cancelBtn', 'click', () => this.handleClose());
        this.addDomListener('overlay', 'click', (e) => {
            if (e.target === this.refs.get('overlay')) {
                this.handleClose();
            }
        });
        
        // Escape
        document.addEventListener('keydown', this.handleEscape);
        
        // Валидация в реальном времени
        this.addDomListener('nameInput', 'input', () => this.validateField('name'));
        this.addDomListener('nameInput', 'blur', () => this.checkNameUniqueness());
        this.addDomListener('priceInput', 'input', () => {
            this.validateField('price');
            this.updateMarginDisplay();
            this.markAsDirty();
        });
        this.addDomListener('costInput', 'input', () => {
            this.validateField('cost_price');
            this.updateMarginDisplay();
            this.updateMarketPriceHint();
            this.markAsDirty();
        });
        this.addDomListener('categorySelect', 'change', (e) => this.handleCategoryChange(e));
        this.addDomListener('keywordsInput', 'input', () => this.markAsDirty());
        
        // Кнопки быстрой наценки
        document.querySelectorAll('[data-markup]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const markup = parseFloat(e.target.dataset.markup);
                this.applyMarkup(markup);
            });
        });
        
        // Применить рыночную цену
        this.addDomListener('applyMarketPrice', 'click', () => {
            if (this._state.marketPrice) {
                const priceInput = this.refs.get('priceInput');
                priceInput.value = this._state.marketPrice;
                this.validateField('price');
                this.updateMarginDisplay();
                this.markAsDirty();
            }
        });
        
        // Фото
        this.addDomListener('photoInput', 'change', (e) => this.handlePhotoSelect(e));
        this.addDomListener('removePhotoBtn', 'click', () => this.handlePhotoRemove());
        this.addDomListener('cancelUploadBtn', 'click', () => this.handleCancelUpload());
        
        // Черновик
        this.addDomListener('restoreDraftBtn', 'click', () => this.restoreDraft());
        this.addDomListener('clearDraftBtn', 'click', () => this.clearDraft());
        
        // Отправка формы
        form.addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Автосохранение (только для нового товара)
        if (!this.isEditMode) {
            this.startAutoSave();
        }
    }

    /**
     * Обработчик Escape
     */
    handleEscape = (e) => {
        if (e.key === 'Escape') {
            this.handleClose();
        }
    };

    // ========== ВАЛИДАЦИЯ ==========
    
    /**
     * Валидирует отдельное поле
     */
    validateField(fieldName) {
        const form = this.refs.get('form');
        const value = form[fieldName]?.value;
        
        let error = null;
        
        switch (fieldName) {
            case 'name':
                if (!value || !value.trim()) {
                    error = VALIDATION_MESSAGES.name.required;
                } else if (value.trim().length < 2) {
                    error = VALIDATION_MESSAGES.name.minLength;
                } else if (value.trim().length > 100) {
                    error = VALIDATION_MESSAGES.name.maxLength;
                }
                break;
                
            case 'price':
                const price = parseFloat(value);
                const costPrice = parseFloat(form['cost_price']?.value) || 0;
                
                if (!value) {
                    error = VALIDATION_MESSAGES.price.required;
                } else if (isNaN(price) || price <= 0) {
                    error = VALIDATION_MESSAGES.price.min;
                } else if (price > 10000000) {
                    error = VALIDATION_MESSAGES.price.max;
                } else if (costPrice > 0 && price <= costPrice) {
                    error = VALIDATION_MESSAGES.price.lessThanCost;
                }
                break;
                
            case 'cost_price':
                const cost = parseFloat(value);
                if (value && (isNaN(cost) || cost < 0)) {
                    error = VALIDATION_MESSAGES.cost_price.min;
                } else if (cost > 10000000) {
                    error = VALIDATION_MESSAGES.cost_price.max;
                }
                break;
                
            case 'category':
                if (!value) {
                    error = VALIDATION_MESSAGES.category.required;
                }
                break;
        }
        
        if (error) {
            this._state.validationErrors.set(fieldName, error);
        } else {
            this._state.validationErrors.delete(fieldName);
        }
        
        this.update();
    }

    /**
     * Валидирует всю форму
     */
    validateForm() {
        const form = this.refs.get('form');
        
        this.validateField('name');
        this.validateField('price');
        this.validateField('cost_price');
        this.validateField('category');
        
        // Валидация атрибутов
        const schema = getCategorySchema(this.selectedCategory);
        schema.fields.forEach(field => {
            if (field.required) {
                const value = form[`attr_${field.name}`]?.value;
                if (!value || !value.trim()) {
                    this._state.validationErrors.set(
                        `attr_${field.name}`,
                        `Поле "${field.label}" обязательно`
                    );
                }
            }
        });
        
        return this._state.validationErrors.size === 0 && this._state.isNameUnique;
    }

    /**
     * Проверяет уникальность названия
     */
    async checkNameUniqueness() {
        const nameInput = this.refs.get('nameInput');
        const name = nameInput?.value?.trim();
        
        if (!name || name.length < 2) return;
        
        // Не проверяем если название не изменилось при редактировании
        if (this.isEditMode && name === this.product.name) {
            this._state.isNameUnique = true;
            return;
        }
        
        this._state.isCheckingName = true;
        this.update();
        
        try {
            const exists = await ProductService.exists(
                name,
                this.isEditMode ? this.product.id : null
            );
            
            this._state.isNameUnique = !exists;
            
            if (!this._state.isNameUnique) {
                this._state.validationErrors.set('name', VALIDATION_MESSAGES.name.duplicate);
            } else {
                this._state.validationErrors.delete('name');
            }
        } catch (error) {
            console.error('[ProductForm] Name check error:', error);
            this._state.isNameUnique = true;
        } finally {
            this._state.isCheckingName = false;
            this.update();
        }
    }

    // ========== КАТЕГОРИЯ ==========
    
    /**
     * Обработчик смены категории
     */
    async handleCategoryChange(e) {
        this.selectedCategory = e.target.value;
        this.validateField('category');
        
        // Обновляем динамические поля
        const container = this.refs.get('dynamicFieldsContainer');
        const schema = getCategorySchema(this.selectedCategory);
        container.innerHTML = this.renderDynamicFields(schema);
        
        // Обновляем подсказку рыночной цены
        await this.updateMarketPriceHint();
        
        this.markAsDirty();
    }

    /**
     * Обновляет подсказку рыночной цены
     */
    async updateMarketPriceHint() {
        const costInput = this.refs.get('costInput');
        const costPrice = parseFloat(costInput?.value);
        
        if (!this.selectedCategory || !costPrice || costPrice <= 0) {
            this._state.marketPrice = null;
            this.update();
            return;
        }
        
        try {
            // Получаем среднюю наценку по категории
            const products = await ProductService.getAll();
            const categoryProducts = products.filter(p => 
                p.category === this.selectedCategory && 
                p.cost_price > 0
            );
            
            if (categoryProducts.length > 0) {
                const avgMarkup = categoryProducts.reduce((sum, p) => {
                    return sum + (p.price / p.cost_price);
                }, 0) / categoryProducts.length;
                
                this._state.marketPrice = Math.round(costPrice * avgMarkup);
            }
        } catch (error) {
            console.error('[ProductForm] Market price error:', error);
        }
        
        this.update();
    }

    // ========== ЦЕНООБРАЗОВАНИЕ ==========
    
    /**
     * Применяет наценку
     */
    applyMarkup(multiplier) {
        const costInput = this.refs.get('costInput');
        const priceInput = this.refs.get('priceInput');
        
        const costPrice = parseFloat(costInput?.value) || 0;
        
        if (costPrice <= 0) {
            Notification.warning('Сначала укажите себестоимость');
            costInput?.focus();
            return;
        }
        
        const newPrice = Math.round(costPrice * multiplier);
        priceInput.value = newPrice;
        
        this.validateField('price');
        this.updateMarginDisplay();
        this.markAsDirty();
        
        Notification.info(`Установлена цена ${formatMoney(newPrice)}`);
    }

    /**
     * Рассчитывает прибыль
     */
    calculateProfit(price, costPrice) {
        const p = parseFloat(price) || 0;
        const c = parseFloat(costPrice) || 0;
        return p - c;
    }

    /**
     * Рассчитывает маржу в процентах
     */
    calculateMargin(price, costPrice) {
        const p = parseFloat(price) || 0;
        const c = parseFloat(costPrice) || 0;
        
        if (p <= 0) return 0;
        return ((p - c) / p) * 100;
    }

    /**
     * Обновляет отображение маржи
     */
    updateMarginDisplay() {
        const form = this.refs.get('form');
        const price = form['price']?.value;
        const costPrice = form['cost_price']?.value;
        
        const profit = this.calculateProfit(price, costPrice);
        const margin = this.calculateMargin(price, costPrice);
        
        // Обновляем DOM
        const calculator = this.element.querySelector('.margin-calculator');
        if (calculator) {
            calculator.innerHTML = `
                <div class="margin-row">
                    <span>Прибыль:</span>
                    <strong class="${profit >= 0 ? 'text-success' : 'text-danger'}">
                        ${formatMoney(profit)}
                    </strong>
                </div>
                <div class="margin-row">
                    <span>Маржа:</span>
                    <strong class="${margin >= 0 ? 'text-success' : 'text-danger'}">
                        ${margin.toFixed(1)}%
                    </strong>
                </div>
                ${this._state.marketPrice ? `
                    <div class="margin-row market-hint">
                        <span>Средняя цена в категории:</span>
                        <strong>${formatMoney(this._state.marketPrice)}</strong>
                        <button 
                            type="button" 
                            class="btn-ghost btn-xs" 
                            data-ref="applyMarketPrice"
                            title="Применить рыночную цену"
                        >
                            Применить
                        </button>
                    </div>
                ` : ''}
            `;
            
            // Перепривязываем событие
            const applyBtn = calculator.querySelector('[data-ref="applyMarketPrice"]');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    if (this._state.marketPrice) {
                        const priceInput = this.refs.get('priceInput');
                        priceInput.value = this._state.marketPrice;
                        this.validateField('price');
                        this.updateMarginDisplay();
                    }
                });
            }
        }
    }

    // ========== ФОТО ==========
    
    /**
     * Обработчик выбора фото
     */
    async handlePhotoSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Валидация
        const validation = Storage.validateImage(file, {
            maxSizeMB: MAX_PHOTO_SIZE_MB,
            allowedTypes: ALLOWED_PHOTO_TYPES
        });
        
        if (!validation.valid) {
            Notification.warning(validation.error);
            e.target.value = '';
            return;
        }
        
        this._state.photoFile = file;
        
        // Создаем превью
        const reader = new FileReader();
        reader.onload = (event) => {
            this._state.photoPreview = event.target.result;
            this.update();
        };
        reader.readAsDataURL(file);
        
        this.markAsDirty();
    }

    /**
     * Обработчик удаления фото
     */
    handlePhotoRemove() {
        this._state.photoFile = null;
        this._state.photoPreview = null;
        
        const photoInput = this.refs.get('photoInput');
        if (photoInput) photoInput.value = '';
        
        this.update();
        this.markAsDirty();
    }

    /**
     * Отмена загрузки
     */
    handleCancelUpload() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        this._state.isUploading = false;
        this._state.uploadProgress = 0;
        this.update();
    }

    /**
     * Загружает фото в Storage
     */
    async uploadPhoto(file) {
        this._state.isUploading = true;
        this._state.uploadProgress = 0;
        this.update();
        
        this.abortController = new AbortController();
        
        try {
            // Сжатие изображения (опционально)
            let fileToUpload = file;
            
            if (file.type.startsWith('image/') && file.size > 1024 * 1024) {
                fileToUpload = await this.compressImage(file);
            }
            
            const fileName = Storage.generateFileName(fileToUpload);
            
            // Имитация прогресса (Supabase не дает прогресс из коробки)
            const progressInterval = setInterval(() => {
                this._state.uploadProgress = Math.min(this._state.uploadProgress + 10, 90);
                this.update();
            }, 100);
            
            const url = await Storage.upload('product-photos', fileName, fileToUpload);
            
            clearInterval(progressInterval);
            
            this._state.uploadProgress = 100;
            this._state.photoPreview = url;
            this._state.photoFile = null;
            
            this.update();
            
            return url;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('[ProductForm] Upload cancelled');
            } else {
                console.error('[ProductForm] Upload error:', error);
                Notification.error('Ошибка при загрузке фото');
            }
            throw error;
        } finally {
            this._state.isUploading = false;
            this.abortController = null;
        }
    }

    /**
     * Сжимает изображение
     */
    async compressImage(file) {
        return new Promise((resolve) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            img.onload = () => {
                // Максимальные размеры
                const maxWidth = 1200;
                const maxHeight = 1200;
                
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth || height > maxHeight) {
                    if (width > height) {
                        height = (height / width) * maxWidth;
                        width = maxWidth;
                    } else {
                        width = (width / height) * maxHeight;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob((blob) => {
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', IMAGE_QUALITY);
            };
            
            img.src = URL.createObjectURL(file);
        });
    }

    // ========== ЧЕРНОВИК ==========
    
    /**
     * Загружает черновик
     */
    loadDraft() {
        try {
            const draft = localStorage.getItem(AUTO_SAVE_KEY);
            return draft ? JSON.parse(draft) : null;
        } catch {
            return null;
        }
    }

    /**
     * Сохраняет черновик
     */
    saveDraft() {
        if (this.isEditMode || !this._state.isDirty) return;
        
        const form = this.refs.get('form');
        const formData = new FormData(form);
        
        const draft = {
            name: formData.get('name'),
            price: formData.get('price'),
            cost_price: formData.get('cost_price'),
            category: formData.get('category'),
            keywords: formData.get('keywords'),
            attributes: {},
            savedAt: new Date().toISOString()
        };
        
        // Сохраняем атрибуты
        const schema = getCategorySchema(this.selectedCategory);
        schema.fields.forEach(field => {
            const value = formData.get(`attr_${field.name}`);
            if (value) {
                draft.attributes[field.name] = value;
            }
        });
        
        localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(draft));
    }

    /**
     * Проверяет наличие черновика
     */
    hasDraft() {
        return !!this.loadDraft();
    }

    /**
     * Восстанавливает черновик
     */
    async restoreDraft() {
        const draft = this.loadDraft();
        if (!draft) return;
        
        // Заполняем поля
        const nameInput = this.refs.get('nameInput');
        const priceInput = this.refs.get('priceInput');
        const costInput = this.refs.get('costInput');
        const categorySelect = this.refs.get('categorySelect');
        const keywordsInput = this.refs.get('keywordsInput');
        
        if (nameInput) nameInput.value = draft.name || '';
        if (priceInput) priceInput.value = draft.price || '';
        if (costInput) costInput.value = draft.cost_price || '';
        if (keywordsInput) keywordsInput.value = draft.keywords || '';
        
        if (categorySelect && draft.category) {
            categorySelect.value = draft.category;
            this.selectedCategory = draft.category;
            
            // Обновляем динамические поля
            const container = this.refs.get('dynamicFieldsContainer');
            const schema = getCategorySchema(this.selectedCategory);
            container.innerHTML = this.renderDynamicFields(schema, draft.attributes);
        }
        
        this._state.isDirty = true;
        this.updateMarginDisplay();
        
        Notification.info('Черновик восстановлен');
    }

    /**
     * Очищает черновик
     */
    clearDraft() {
        localStorage.removeItem(AUTO_SAVE_KEY);
        this.update();
        Notification.info('Черновик удален');
    }

    /**
     * Запускает автосохранение
     */
    startAutoSave() {
        this.autoSaveTimer = setInterval(() => {
            this.saveDraft();
        }, AUTO_SAVE_INTERVAL);
    }

    /**
     * Помечает форму как измененную
     */
    markAsDirty() {
        this._state.isDirty = true;
    }

    // ========== ОТПРАВКА ФОРМЫ ==========
    
    /**
     * Обработчик отправки
     */
    async handleSubmit(e) {
        e.preventDefault();
        
        // Валидация
        if (!this.validateForm()) {
            const firstError = this._state.validationErrors.values().next().value;
            Notification.warning(firstError || 'Пожалуйста, проверьте заполнение формы');
            return;
        }
        
        if (this._state.isUploading) {
            Notification.warning('Дождитесь завершения загрузки фото');
            return;
        }
        
        await this.saveProduct();
    }

    /**
     * Сохраняет товар
     */
    async saveProduct() {
        const form = this.refs.get('form');
        const submitBtn = this.refs.get('submitBtn');
        
        this.setLoading(true);
        
        try {
            const user = AuthManager.getUser();
            const formData = new FormData(form);
            
            let photoUrl = this.product?.photo_url || null;
            
            // Загружаем новое фото если есть
            if (this._state.photoFile) {
                try {
                    photoUrl = await this.uploadPhoto(this._state.photoFile);
                } catch (error) {
                    this.setLoading(false);
                    return;
                }
            } else if (this._state.photoPreview === null && this.product?.photo_url) {
                // Фото было удалено
                photoUrl = null;
            }
            
            // Собираем атрибуты
            const attributes = {};
            const schema = getCategorySchema(this.selectedCategory);
            schema.fields.forEach(field => {
                const value = formData.get(`attr_${field.name}`);
                if (value && value.trim()) {
                    attributes[field.name] = value.trim();
                }
            });
            
            // Данные товара
            const productData = {
                name: formData.get('name').trim(),
                price: parseFloat(formData.get('price')),
                cost_price: parseFloat(formData.get('cost_price')) || 0,
                category: formData.get('category'),
                keywords: formData.get('keywords')?.trim() || null,
                attributes,
                photo_url: photoUrl,
                created_by: this.isEditMode ? this.product.created_by : user.id,
                status: this.product?.status || 'in_stock'
            };
            
            if (this.isEditMode) {
                await ProductService.update(this.product.id, productData);
                Notification.success('Товар успешно обновлен');
            } else {
                await ProductService.create(productData);
                Notification.success('Товар успешно добавлен');
                localStorage.removeItem(AUTO_SAVE_KEY);
            }
            
            this.publish('product:created');
            this.publish('product:updated');
            this.close();
            
        } catch (error) {
            console.error('[ProductForm] Save error:', error);
            Notification.error(
                this.isEditMode 
                    ? 'Ошибка при обновлении товара' 
                    : 'Ошибка при создании товара'
            );
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Управляет состоянием загрузки кнопки
     */
    setLoading(loading) {
        const btn = this.refs.get('submitBtn');
        if (!btn) return;
        
        const text = btn.querySelector('.btn-text');
        const loader = btn.querySelector('.btn-loader');
        
        btn.disabled = loading;
        
        if (text) text.style.display = loading ? 'none' : 'inline';
        if (loader) loader.style.display = loading ? 'inline' : 'none';
    }

    // ========== ЗАКРЫТИЕ ==========
    
    /**
     * Обработчик закрытия
     */
    async handleClose() {
        if (this._state.isDirty && !this.isEditMode) {
            const confirmed = await ConfirmDialog.show({
                title: 'Несохраненные изменения',
                message: 'У вас есть несохраненные изменения. Закрыть форму?',
                confirmText: 'Закрыть',
                cancelText: 'Продолжить',
                type: 'warning'
            });
            
            if (!confirmed) return;
        }
        
        this.close();
    }

    /**
     * Закрывает форму
     */
    close() {
        this.destroy();
        this.container.remove();
    }

    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        
        if (this.nameCheckTimer) {
            clearTimeout(this.nameCheckTimer);
            this.nameCheckTimer = null;
        }
        
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        document.removeEventListener('keydown', this.handleEscape);
    }
}
