/**
 * Product Form Component
 * 
 * Форма создания и редактирования товара.
 * 
 * В новой архитектуре:
 * - Публикует события product:created и product:updated через EventBus
 * - Store автоматически реагирует на эти события через InventoryPage
 * - Не зависит от InventoryState (чистый компонент)
 * - Использует централизованные утилиты форматирования
 * 
 * @module ProductForm
 * @version 5.0.0
 * @changes
 * - Удалены ссылки на старые стейты
 * - Добавлена публикация событий для синхронизации со Store
 * - Упрощена логика закрытия и очистки
 * - Обновлены импорты в соответствии с новой структурой
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { Storage } from '../../core/SupabaseClient.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { EventBus } from '../../core/EventBus.js';
import { formatMoney } from '../../utils/formatters.js';
import { CATEGORY_SCHEMA, getCategorySchema, getCategoryOptions, getCategoryName } from '../../utils/categorySchema.js';

// ========== КОНСТАНТЫ ==========
const AUTO_SAVE_KEY = 'product_form_draft';
const AUTO_SAVE_INTERVAL = 10000;
const MAX_PHOTO_SIZE_MB = 5;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const VALIDATION_RULES = {
    name: {
        required: true,
        minLength: 2,
        maxLength: 100,
        message: {
            required: 'Название обязательно',
            minLength: 'Название должно быть не менее 2 символов',
            maxLength: 'Название не должно превышать 100 символов'
        }
    },
    price: {
        required: true,
        min: 0.01,
        max: 10000000,
        message: {
            required: 'Цена продажи обязательна',
            min: 'Цена должна быть больше 0',
            max: 'Цена не должна превышать 10 000 000 ₽'
        }
    },
    cost_price: {
        min: 0,
        max: 10000000,
        message: {
            min: 'Себестоимость не может быть отрицательной',
            max: 'Себестоимость не должна превышать 10 000 000 ₽'
        }
    },
    category: {
        required: true,
        message: {
            required: 'Выберите категорию'
        }
    }
};

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
        
        // Состояние
        this.photoFile = null;
        this.photoPreview = product?.photo_url || null;
        this.isUploading = false;
        this.validationErrors = new Map();
        this.isNameUnique = true;
        this.isDirty = false;
        this.marketPrice = null;
        
        // Таймеры и контроллеры
        this.autoSaveTimer = null;
        this.nameCheckController = null;
        
        // Черновик
        this.draft = !this.isEditMode ? this.loadDraft() : null;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const categoryOptions = getCategoryOptions();
        const schema = getCategorySchema(this.selectedCategory);
        
        const name = this.draft?.name || this.product?.name || '';
        const price = this.draft?.price || this.product?.price || '';
        const costPrice = this.draft?.cost_price || this.product?.cost_price || '';
        const keywords = this.draft?.keywords || this.product?.keywords || '';
        
        const profit = this.calculateProfit(price, costPrice);
        const margin = this.calculateMargin(price, costPrice);
        
        return `
            <div class="modal-overlay" data-ref="overlay">
                <div class="modal product-form-modal" data-ref="modal">
                    <div class="modal-header">
                        <h3>${this.isEditMode ? 'Редактирование товара' : 'Новый товар'}</h3>
                        <button class="btn-icon btn-close" data-ref="closeBtn">✕</button>
                    </div>
                    
                    <div class="modal-body">
                        <form id="product-form" data-ref="form">
                            <!-- Название -->
                            <div class="form-group ${this.hasError('name') ? 'has-error' : ''}">
                                <label>Название <span class="required">*</span></label>
                                <input type="text" name="name" data-ref="nameInput" 
                                       value="${this.escapeHtml(name)}" placeholder="Например: Детская куртка">
                                ${this.renderError('name')}
                                ${!this.isNameUnique ? '<div class="validation-warning">Товар с таким названием уже существует</div>' : ''}
                            </div>
                            
                            <!-- Категория -->
                            <div class="form-group ${this.hasError('category') ? 'has-error' : ''}">
                                <label>Категория <span class="required">*</span></label>
                                <select name="category" data-ref="categorySelect">
                                    <option value="">Выберите категорию</option>
                                    ${categoryOptions.map(opt => `
                                        <option value="${opt.value}" ${(this.draft?.category || this.selectedCategory) === opt.value ? 'selected' : ''}>
                                            ${opt.label}
                                        </option>
                                    `).join('')}
                                </select>
                                ${this.renderError('category')}
                            </div>
                            
                            <!-- Цены -->
                            <div class="pricing-section">
                                <div class="form-row">
                                    <div class="form-group">
                                        <label>Себестоимость (₽)</label>
                                        <input type="number" name="cost_price" data-ref="costInput" 
                                               value="${costPrice}" step="0.01" min="0" placeholder="0.00">
                                    </div>
                                    <div class="form-group ${this.hasError('price') ? 'has-error' : ''}">
                                        <label>Цена продажи (₽) <span class="required">*</span></label>
                                        <input type="number" name="price" data-ref="priceInput" 
                                               value="${price}" step="0.01" min="0" placeholder="0.00">
                                        ${this.renderError('price')}
                                    </div>
                                </div>
                                
                                <!-- Быстрые наценки -->
                                <div class="markup-presets">
                                    <span class="markup-label">Наценка:</span>
                                    ${MARKUP_PRESETS.map(p => `
                                        <button type="button" class="btn-ghost btn-sm markup-btn" data-markup="${p.value}">${p.label}</button>
                                    `).join('')}
                                </div>
                                
                                <!-- Калькулятор -->
                                <div class="margin-calculator">
                                    <div class="margin-row"><span>Прибыль:</span> <strong class="${profit >= 0 ? 'text-success' : 'text-danger'}">${formatMoney(profit)}</strong></div>
                                    <div class="margin-row"><span>Маржа:</span> <strong class="${margin >= 0 ? 'text-success' : 'text-danger'}">${margin.toFixed(1)}%</strong></div>
                                    ${this.marketPrice ? `
                                        <div class="margin-row market-hint">
                                            <span>Средняя цена в категории:</span>
                                            <strong>${formatMoney(this.marketPrice)}</strong>
                                            <button type="button" class="btn-ghost btn-xs" data-ref="applyMarketPrice">Применить</button>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            
                            <!-- Ключевые слова -->
                            <div class="form-group">
                                <label>Ключевые слова <span class="label-hint">через запятую</span></label>
                                <input type="text" name="keywords" data-ref="keywordsInput" 
                                       value="${this.escapeHtml(keywords)}" placeholder="бренд, цвет, материал">
                            </div>
                            
                            <!-- Динамические поля -->
                            <div data-ref="dynamicFieldsContainer">
                                ${this.renderDynamicFields(schema, this.draft?.attributes || this.product?.attributes)}
                            </div>
                            
                            <!-- Фото -->
                            <div class="form-group">
                                <label>Фото товара</label>
                                <div class="photo-upload-area" data-ref="photoUploadArea">
                                    ${this.renderPhotoPreview()}
                                    <div class="upload-controls">
                                        <label class="btn-secondary upload-btn">
                                            <input type="file" name="photo" data-ref="photoInput" accept="${ALLOWED_PHOTO_TYPES.join(',')}" style="display: none;">
                                            ${this.photoPreview ? 'Заменить фото' : 'Выбрать фото'}
                                        </label>
                                        ${this.photoPreview ? `<button type="button" class="btn-ghost" data-ref="removePhotoBtn">Удалить</button>` : ''}
                                    </div>
                                    ${this.isUploading ? `<div class="upload-progress">Загрузка...</div>` : ''}
                                </div>
                            </div>
                            
                            <!-- Черновик -->
                            ${!this.isEditMode && this.draft ? `
                                <div class="draft-notice">
                                    <span>📄 Найден черновик</span>
                                    <button type="button" class="btn-ghost btn-sm" data-ref="restoreDraftBtn">Восстановить</button>
                                    <button type="button" class="btn-ghost btn-sm" data-ref="clearDraftBtn">Очистить</button>
                                </div>
                            ` : ''}
                        </form>
                    </div>
                    
                    <div class="modal-footer">
                        <div class="form-actions">
                            <button type="submit" class="btn-primary" data-ref="submitBtn" form="product-form">
                                ${this.isEditMode ? 'Сохранить' : 'Добавить товар'}
                            </button>
                            <button type="button" class="btn-secondary" data-ref="cancelBtn">Отмена</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderPhotoPreview() {
        if (!this.photoPreview) {
            return `<div class="photo-preview empty"><span>📷 Нет фото</span></div>`;
        }
        return `<div class="photo-preview"><img src="${this.photoPreview}" alt="Превью"></div>`;
    }

    renderDynamicFields(schema, attributes = {}) {
        if (!schema) {
            return '<div class="form-hint text-center">Выберите категорию</div>';
        }
        
        return `
            <div class="attributes-section">
                <h4>Характеристики</h4>
                ${schema.fields.map(field => this.renderAttributeField(field, attributes[field.name] || '')).join('')}
            </div>
        `;
    }

    renderAttributeField(field, value) {
        const error = this.hasError(`attr_${field.name}`);
        const fieldId = `attr-${field.name}`;
        
        if (field.type === 'select') {
            return `
                <div class="form-group ${error ? 'has-error' : ''}">
                    <label for="${fieldId}">${field.label} ${field.required ? '<span class="required">*</span>' : ''}</label>
                    <select id="${fieldId}" name="attr_${field.name}" ${field.required ? 'required' : ''}>
                        <option value="">Выберите</option>
                        ${field.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                    ${this.renderError(`attr_${field.name}`)}
                </div>
            `;
        }
        
        return `
            <div class="form-group ${error ? 'has-error' : ''}">
                <label for="${fieldId}">${field.label} ${field.required ? '<span class="required">*</span>' : ''}</label>
                <input type="${field.type}" id="${fieldId}" name="attr_${field.name}" value="${this.escapeHtml(value)}" 
                       placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>
                ${this.renderError(`attr_${field.name}`)}
            </div>
        `;
    }

    renderError(fieldName) {
        const error = this.validationErrors.get(fieldName);
        return error ? `<div class="validation-error">${error}</div>` : '';
    }

    hasError(fieldName) {
        return this.validationErrors.has(fieldName);
    }

    // ========== ПРИВЯЗКА СОБЫТИЙ ==========
    
    attachEvents() {
        // Закрытие
        this.addDomListener('closeBtn', 'click', () => this.handleClose());
        this.addDomListener('cancelBtn', 'click', () => this.handleClose());
        this.addDomListener('overlay', 'click', (e) => {
            if (e.target === this.refs.get('overlay')) this.handleClose();
        });
        
        // Валидация
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
            this.markAsDirty();
        });
        this.addDomListener('categorySelect', 'change', (e) => this.handleCategoryChange(e));
        
        // Наценки
        document.querySelectorAll('[data-markup]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const markup = parseFloat(e.target.dataset.markup);
                this.applyMarkup(markup);
            });
        });
        
        // Фото
        this.addDomListener('photoInput', 'change', (e) => this.handlePhotoSelect(e));
        this.addDomListener('removePhotoBtn', 'click', () => this.handlePhotoRemove());
        
        // Черновик
        this.addDomListener('restoreDraftBtn', 'click', () => this.restoreDraft());
        this.addDomListener('clearDraftBtn', 'click', () => this.clearDraft());
        
        // Отправка
        this.refs.get('form')?.addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.handleClose();
        });
        
        // Автосохранение
        if (!this.isEditMode) {
            this.autoSaveTimer = setInterval(() => this.saveDraft(), AUTO_SAVE_INTERVAL);
        }
    }

    // ========== ВАЛИДАЦИЯ ==========
    
    validateField(fieldName) {
        const form = this.refs.get('form');
        const value = form[fieldName]?.value;
        const rule = VALIDATION_RULES[fieldName];
        
        if (!rule) return true;
        
        let error = null;
        
        if (rule.required && (!value || !value.trim())) {
            error = rule.message.required;
        } else if (value && rule.minLength && value.trim().length < rule.minLength) {
            error = rule.message.minLength;
        } else if (value && rule.maxLength && value.trim().length > rule.maxLength) {
            error = rule.message.maxLength;
        } else if (fieldName === 'price' || fieldName === 'cost_price') {
            const num = parseFloat(value);
            if (value && (isNaN(num) || num < rule.min)) {
                error = rule.message.min;
            } else if (value && num > rule.max) {
                error = rule.message.max;
            } else if (fieldName === 'price') {
                const costPrice = parseFloat(form['cost_price']?.value) || 0;
                if (costPrice > 0 && num <= costPrice) {
                    error = 'Цена продажи должна быть больше себестоимости';
                }
            }
        }
        
        if (error) {
            this.validationErrors.set(fieldName, error);
        } else {
            this.validationErrors.delete(fieldName);
        }
        
        this.update();
        return !error;
    }

    validateForm() {
        const fields = ['name', 'price', 'category'];
        let isValid = true;
        
        fields.forEach(field => {
            if (!this.validateField(field)) isValid = false;
        });
        
        // Валидация атрибутов
        const schema = getCategorySchema(this.selectedCategory);
        schema.fields.forEach(field => {
            if (field.required) {
                const input = this.refs.get('form')?.querySelector(`[name="attr_${field.name}"]`);
                if (!input?.value?.trim()) {
                    this.validationErrors.set(`attr_${field.name}`, `Поле "${field.label}" обязательно`);
                    isValid = false;
                }
            }
        });
        
        return isValid && this.isNameUnique;
    }

    async checkNameUniqueness() {
        const nameInput = this.refs.get('nameInput');
        const name = nameInput?.value?.trim();
        
        if (!name || name.length < 2) return;
        if (this.isEditMode && name === this.product.name) {
            this.isNameUnique = true;
            return;
        }
        
        // Отменяем предыдущий запрос
        if (this.nameCheckController) {
            this.nameCheckController.abort();
        }
        
        this.nameCheckController = new AbortController();
        
        try {
            const exists = await ProductService.exists(name, this.isEditMode ? this.product.id : null);
            this.isNameUnique = !exists;
            
            if (!this.isNameUnique) {
                this.validationErrors.set('name', 'Товар с таким названием уже существует');
            } else {
                this.validationErrors.delete('name');
            }
            this.update();
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[ProductForm] Name check error:', error);
            }
        } finally {
            this.nameCheckController = null;
        }
    }

    // ========== ЦЕНООБРАЗОВАНИЕ ==========
    
    calculateProfit(price, costPrice) {
        return (parseFloat(price) || 0) - (parseFloat(costPrice) || 0);
    }

    calculateMargin(price, costPrice) {
        const p = parseFloat(price) || 0;
        const c = parseFloat(costPrice) || 0;
        if (p <= 0) return 0;
        return ((p - c) / p) * 100;
    }

    applyMarkup(multiplier) {
        const costInput = this.refs.get('costInput');
        const priceInput = this.refs.get('priceInput');
        const costPrice = parseFloat(costInput?.value) || 0;
        
        if (costPrice <= 0) {
            Notification.warning('Сначала укажите себестоимость');
            costInput?.focus();
            return;
        }
        
        priceInput.value = Math.round(costPrice * multiplier);
        this.validateField('price');
        this.updateMarginDisplay();
        this.markAsDirty();
    }

    updateMarginDisplay() {
        const form = this.refs.get('form');
        const price = form?.price?.value;
        const costPrice = form?.cost_price?.value;
        
        const profit = this.calculateProfit(price, costPrice);
        const margin = this.calculateMargin(price, costPrice);
        
        const calculator = this.element?.querySelector('.margin-calculator');
        if (calculator) {
            calculator.innerHTML = `
                <div class="margin-row"><span>Прибыль:</span> <strong class="${profit >= 0 ? 'text-success' : 'text-danger'}">${formatMoney(profit)}</strong></div>
                <div class="margin-row"><span>Маржа:</span> <strong class="${margin >= 0 ? 'text-success' : 'text-danger'}">${margin.toFixed(1)}%</strong></div>
                ${this.marketPrice ? `
                    <div class="margin-row market-hint">
                        <span>Средняя цена в категории:</span>
                        <strong>${formatMoney(this.marketPrice)}</strong>
                        <button type="button" class="btn-ghost btn-xs" data-ref="applyMarketPrice">Применить</button>
                    </div>
                ` : ''}
            `;
            
            const applyBtn = calculator.querySelector('[data-ref="applyMarketPrice"]');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    if (this.marketPrice) {
                        const priceInput = this.refs.get('priceInput');
                        priceInput.value = this.marketPrice;
                        this.validateField('price');
                        this.updateMarginDisplay();
                    }
                });
            }
        }
    }

    // ========== КАТЕГОРИЯ ==========
    
    async handleCategoryChange(e) {
        this.selectedCategory = e.target.value;
        this.validateField('category');
        
        const container = this.refs.get('dynamicFieldsContainer');
        const schema = getCategorySchema(this.selectedCategory);
        if (container) {
            container.innerHTML = this.renderDynamicFields(schema);
        }
        
        await this.updateMarketPriceHint();
        this.markAsDirty();
    }

    async updateMarketPriceHint() {
        const costInput = this.refs.get('costInput');
        const costPrice = parseFloat(costInput?.value);
        
        if (!this.selectedCategory || !costPrice || costPrice <= 0) {
            this.marketPrice = null;
            return;
        }
        
        try {
            const products = await ProductService.getAll();
            const categoryProducts = products.filter(p => p.category === this.selectedCategory && p.cost_price > 0);
            
            if (categoryProducts.length > 0) {
                const avgMarkup = categoryProducts.reduce((sum, p) => sum + (p.price / p.cost_price), 0) / categoryProducts.length;
                this.marketPrice = Math.round(costPrice * avgMarkup);
            }
            this.updateMarginDisplay();
        } catch (error) {
            console.error('[ProductForm] Market price error:', error);
        }
    }

    // ========== ФОТО ==========
    
    async handlePhotoSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
            Notification.warning('Неподдерживаемый формат. Разрешены: JPEG, PNG, WebP');
            return;
        }
        
        if (file.size > MAX_PHOTO_SIZE_MB * 1024 * 1024) {
            Notification.warning(`Файл не должен превышать ${MAX_PHOTO_SIZE_MB} МБ`);
            return;
        }
        
        this.photoFile = file;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            this.photoPreview = event.target.result;
            this.update();
        };
        reader.readAsDataURL(file);
        
        this.markAsDirty();
    }

    handlePhotoRemove() {
        this.photoFile = null;
        this.photoPreview = null;
        const photoInput = this.refs.get('photoInput');
        if (photoInput) photoInput.value = '';
        this.update();
        this.markAsDirty();
    }

    async uploadPhoto() {
        if (!this.photoFile) return this.photoPreview;
        
        this.isUploading = true;
        this.update();
        
        try {
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
            const url = await Storage.upload('product-photos', fileName, this.photoFile);
            this.photoPreview = url;
            this.photoFile = null;
            return url;
        } catch (error) {
            console.error('[ProductForm] Upload error:', error);
            Notification.error('Ошибка при загрузке фото');
            throw error;
        } finally {
            this.isUploading = false;
            this.update();
        }
    }

    // ========== ЧЕРНОВИК ==========
    
    loadDraft() {
        try {
            const draft = localStorage.getItem(AUTO_SAVE_KEY);
            return draft ? JSON.parse(draft) : null;
        } catch {
            return null;
        }
    }

    saveDraft() {
        if (this.isEditMode || !this.isDirty) return;
        
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
        
        const schema = getCategorySchema(this.selectedCategory);
        schema.fields.forEach(field => {
            const value = formData.get(`attr_${field.name}`);
            if (value) draft.attributes[field.name] = value;
        });
        
        localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(draft));
    }

    restoreDraft() {
        const draft = this.loadDraft();
        if (!draft) return;
        
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
            
            const container = this.refs.get('dynamicFieldsContainer');
            const schema = getCategorySchema(this.selectedCategory);
            container.innerHTML = this.renderDynamicFields(schema, draft.attributes);
        }
        
        this.isDirty = true;
        this.updateMarginDisplay();
        Notification.info('Черновик восстановлен');
    }

    clearDraft() {
        localStorage.removeItem(AUTO_SAVE_KEY);
        this.draft = null;
        this.update();
        Notification.info('Черновик удален');
    }

    markAsDirty() {
        this.isDirty = true;
    }

    // ========== ОТПРАВКА ==========
    
    async handleSubmit(e) {
        e.preventDefault();
        
        if (!this.validateForm()) {
            const firstError = this.validationErrors.values().next().value;
            Notification.warning(firstError || 'Проверьте заполнение формы');
            return;
        }
        
        if (this.isUploading) {
            Notification.warning('Дождитесь загрузки фото');
            return;
        }
        
        await this.saveProduct();
    }

    async saveProduct() {
        const form = this.refs.get('form');
        const submitBtn = this.refs.get('submitBtn');
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Сохранение...';
        
        try {
            const user = AuthManager.getUser();
            let photoUrl = this.product?.photo_url || null;
            
            if (this.photoFile) {
                photoUrl = await this.uploadPhoto();
            } else if (this.photoPreview === null && this.product?.photo_url) {
                photoUrl = null;
            }
            
            const attributes = {};
            const schema = getCategorySchema(this.selectedCategory);
            schema.fields.forEach(field => {
                const value = form.querySelector(`[name="attr_${field.name}"]`)?.value;
                if (value?.trim()) attributes[field.name] = value.trim();
            });
            
            const productData = {
                name: form.name.value.trim(),
                price: parseFloat(form.price.value),
                cost_price: parseFloat(form.cost_price?.value) || 0,
                category: form.category.value,
                keywords: form.keywords?.value?.trim() || null,
                attributes,
                photo_url: photoUrl,
                created_by: this.isEditMode ? this.product.created_by : user.id,
                status: this.product?.status || 'in_stock'
            };
            
            if (this.isEditMode) {
                await ProductService.update(this.product.id, productData);
                Notification.success('Товар обновлен');
                EventBus.emit('product:updated', { id: this.product.id, product: productData });
            } else {
                const newProduct = await ProductService.create(productData);
                Notification.success('Товар добавлен');
                localStorage.removeItem(AUTO_SAVE_KEY);
                EventBus.emit('product:created', { product: newProduct });
            }
            
            this.close();
            
        } catch (error) {
            console.error('[ProductForm] Save error:', error);
            Notification.error(this.isEditMode ? 'Ошибка при обновлении' : 'Ошибка при создании');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = this.isEditMode ? 'Сохранить' : 'Добавить товар';
        }
    }

    // ========== ЗАКРЫТИЕ ==========
    
    async handleClose() {
        if (this.isDirty && !this.isEditMode) {
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

    close() {
        this.destroy();
        this.container.remove();
    }

    beforeDestroy() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        if (this.nameCheckController) {
            this.nameCheckController.abort();
        }
    }
}
