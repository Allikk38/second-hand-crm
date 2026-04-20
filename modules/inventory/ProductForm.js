/**
 * Форма добавления и редактирования товара
 * 
 * Архитектурные решения:
 * - Динамические поля на основе схемы категорий (CATEGORY_SCHEMA)
 * - Атрибуты хранятся в JSONB поле для гибкости
 * - Валидация по схеме категории
 * - Поддержка загрузки фото в Supabase Storage
 * - Учет себестоимости для расчета прибыли
 * 
 * @module ProductForm
 * @requires BaseComponent
 * @requires ProductService
 * @requires SupabaseClient
 * @requires AuthManager
 * @requires Notification
 * @requires categorySchema
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { SupabaseClient } from '../../core/SupabaseClient.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';
import { 
    CATEGORY_SCHEMA, 
    getCategorySchema, 
    getCategoryOptions 
} from '../../utils/categorySchema.js';

export class ProductForm extends BaseComponent {
    /**
     * @param {HTMLElement} container - Контейнер для формы
     * @param {Object} product - Товар для редактирования (опционально)
     */
    constructor(container, product = null) {
        super(container);
        this.product = product;
        this.selectedCategory = product?.category || '';
        this.isEditMode = !!product;
    }

    /**
     * Рендерит форму с динамическими полями
     */
    async render() {
        const categoryOptions = getCategoryOptions();
        const schema = this.selectedCategory ? getCategorySchema(this.selectedCategory) : null;
        
        return `
            <div class="modal-overlay">
                <div class="modal product-form-modal">
                    <h3>${this.isEditMode ? 'Редактирование товара' : 'Новый товар'}</h3>
                    
                    <form id="product-form">
                        <!-- Основные поля -->
                        <div class="form-group">
                            <label for="prod-name">Название *</label>
                            <input 
                                type="text" 
                                id="prod-name" 
                                name="name" 
                                value="${this.product?.name || ''}"
                                placeholder="Например: Детская куртка"
                                required
                            >
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="prod-price">Цена продажи (₽) *</label>
                                <input 
                                    type="number" 
                                    id="prod-price" 
                                    name="price" 
                                    value="${this.product?.price || ''}"
                                    step="0.01" 
                                    min="0" 
                                    placeholder="0.00"
                                    required
                                >
                            </div>
                            
                            <div class="form-group">
                                <label for="prod-cost">Себестоимость (₽)</label>
                                <input 
                                    type="number" 
                                    id="prod-cost" 
                                    name="cost_price" 
                                    value="${this.product?.cost_price || ''}"
                                    step="0.01" 
                                    min="0" 
                                    placeholder="0.00"
                                >
                                <small class="form-hint">Закупочная цена</small>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="prod-category">Категория *</label>
                            <select id="prod-category" name="category" required>
                                <option value="">Выберите категорию</option>
                                ${categoryOptions.map(opt => `
                                    <option value="${opt.value}" ${this.selectedCategory === opt.value ? 'selected' : ''}>
                                        ${opt.label}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        
                        <!-- Динамические поля атрибутов -->
                        <div id="dynamic-fields" class="dynamic-fields">
                            ${this.renderDynamicFields(schema)}
                        </div>
                        
                        <!-- Загрузка фото -->
                        <div class="form-group">
                            <label for="prod-photo">Фото товара</label>
                            ${this.product?.photo_url ? `
                                <div class="current-photo">
                                    <img src="${this.product.photo_url}" alt="Текущее фото">
                                    <span class="photo-hint">Выберите новое фото чтобы заменить</span>
                                </div>
                            ` : ''}
                            <input 
                                type="file" 
                                id="prod-photo" 
                                name="photo" 
                                accept="image/jpeg,image/png,image/webp"
                            >
                            <small class="form-hint">JPEG, PNG, WebP до 5 МБ</small>
                        </div>
                        
                        ${this.isEditMode && this.product?.cost_price && this.product?.price ? `
                            <div class="profit-preview">
                                <span>Ожидаемая прибыль:</span>
                                <strong class="profit-value">${this.formatMoney(this.product.price - this.product.cost_price)}</strong>
                                <small>(${this.calculateMargin(this.product.price, this.product.cost_price)}% маржи)</small>
                            </div>
                        ` : ''}
                        
                        <div class="actions">
                            <button type="submit" class="btn-primary">
                                <span class="btn-text">${this.isEditMode ? 'Сохранить' : 'Добавить товар'}</span>
                                <span class="btn-loader" style="display:none;">
                                    <span class="loading-spinner"></span>
                                </span>
                            </button>
                            <button type="button" class="btn-secondary" data-action="cancel">
                                Отмена
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    /**
     * Рендерит динамические поля на основе схемы категории
     * @param {Object} schema - Схема категории
     */
    renderDynamicFields(schema) {
        if (!schema) {
            return '<div class="form-hint">Выберите категорию для указания характеристик</div>';
        }
        
        const attributes = this.product?.attributes || {};
        
        return schema.fields.map(field => {
            const value = attributes[field.name] || '';
            
            switch (field.type) {
                case 'select':
                    return `
                        <div class="form-group">
                            <label for="attr-${field.name}">
                                ${field.label} ${field.required ? '*' : ''}
                            </label>
                            <select id="attr-${field.name}" name="attr_${field.name}" ${field.required ? 'required' : ''}>
                                <option value="">Выберите</option>
                                ${field.options.map(opt => `
                                    <option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>
                                `).join('')}
                            </select>
                        </div>
                    `;
                    
                case 'textarea':
                    return `
                        <div class="form-group">
                            <label for="attr-${field.name}">
                                ${field.label} ${field.required ? '*' : ''}
                            </label>
                            <textarea 
                                id="attr-${field.name}" 
                                name="attr_${field.name}" 
                                placeholder="${field.placeholder}"
                                ${field.required ? 'required' : ''}
                            >${value}</textarea>
                        </div>
                    `;
                    
                default:
                    return `
                        <div class="form-group">
                            <label for="attr-${field.name}">
                                ${field.label} ${field.required ? '*' : ''}
                            </label>
                            <input 
                                type="${field.type}" 
                                id="attr-${field.name}" 
                                name="attr_${field.name}" 
                                value="${value}"
                                placeholder="${field.placeholder}"
                                ${field.required ? 'required' : ''}
                            >
                        </div>
                    `;
            }
        }).join('');
    }

    /**
     * Привязывает события формы
     */
    attachEvents() {
        // Отмена
        this.element.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            this.destroy();
        });
        
        // Смена категории - перерисовываем динамические поля
        const categorySelect = this.element.querySelector('#prod-category');
        if (categorySelect) {
            categorySelect.addEventListener('change', (e) => {
                this.selectedCategory = e.target.value;
                this.updateDynamicFields();
            });
        }
        
        // Отправка формы
        this.element.querySelector('#product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit(e.target);
        });
    }

    /**
     * Обновляет блок динамических полей при смене категории
     */
    updateDynamicFields() {
        const schema = getCategorySchema(this.selectedCategory);
        const container = this.element.querySelector('#dynamic-fields');
        container.innerHTML = this.renderDynamicFields(schema);
    }

    /**
     * Валидация формы
     */
    validateForm(form) {
        const name = form.name.value.trim();
        const price = parseFloat(form.price.value);
        const costPrice = parseFloat(form.cost_price.value) || 0;
        const category = form.category.value;
        
        if (!name) {
            Notification.warning('Введите название товара');
            return false;
        }
        
        if (name.length < 2) {
            Notification.warning('Название должно быть не менее 2 символов');
            return false;
        }
        
        if (isNaN(price) || price <= 0) {
            Notification.warning('Введите корректную цену продажи');
            return false;
        }
        
        if (price > 1000000) {
            Notification.warning('Цена не может превышать 1 000 000 руб');
            return false;
        }
        
        if (costPrice < 0) {
            Notification.warning('Себестоимость не может быть отрицательной');
            return false;
        }
        
        if (costPrice >= price) {
            Notification.warning('Себестоимость должна быть меньше цены продажи');
            return false;
        }
        
        if (!category) {
            Notification.warning('Выберите категорию товара');
            return false;
        }
        
        return true;
    }

    /**
     * Собирает атрибуты из динамических полей
     */
    collectAttributes(form) {
        const schema = getCategorySchema(this.selectedCategory);
        const attributes = {};
        
        schema.fields.forEach(field => {
            const input = form.querySelector(`[name="attr_${field.name}"]`);
            if (input && input.value.trim()) {
                attributes[field.name] = input.value.trim();
            }
        });
        
        return attributes;
    }

    /**
     * Рассчитывает маржинальность в процентах
     */
    calculateMargin(price, cost) {
        if (!cost || cost === 0) return 100;
        return ((price - cost) / price * 100).toFixed(1);
    }

    /**
     * Управляет состоянием загрузки кнопки
     */
    setLoading(loading) {
        const btn = this.element.querySelector('button[type="submit"]');
        const text = btn.querySelector('.btn-text');
        const loader = btn.querySelector('.btn-loader');
        
        btn.disabled = loading;
        text.style.display = loading ? 'none' : 'inline';
        loader.style.display = loading ? 'inline' : 'none';
    }

    /**
     * Обработка отправки формы
     */
    async handleSubmit(form) {
        if (!this.validateForm(form)) return;
        
        this.setLoading(true);
        
        try {
            const user = AuthManager.getUser();
            const file = form.photo.files[0];
            let photoUrl = this.product?.photo_url || null;

            // Загрузка нового фото
            if (file) {
                if (file.size > 5 * 1024 * 1024) {
                    Notification.warning('Фото не должно превышать 5 МБ');
                    this.setLoading(false);
                    return;
                }
                
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
                
                const { error } = await SupabaseClient.storage
                    .from('product-photos')
                    .upload(fileName, file);
                
                if (error) throw error;
                
                const { data } = SupabaseClient.storage
                    .from('product-photos')
                    .getPublicUrl(fileName);
                
                photoUrl = data.publicUrl;
            }

            // Собираем данные товара
            const productData = {
                name: form.name.value.trim(),
                price: parseFloat(form.price.value),
                cost_price: parseFloat(form.cost_price.value) || 0,
                category: form.category.value,
                attributes: this.collectAttributes(form),
                photo_url: photoUrl,
                created_by: this.isEditMode ? this.product.created_by : user.id,
                status: this.product?.status || 'in_stock'
            };

            // Создание или обновление
            if (this.isEditMode) {
                await ProductService.update(this.product.id, productData);
                Notification.success('Товар обновлен');
            } else {
                await ProductService.create(productData);
                Notification.success('Товар успешно добавлен');
            }
            
            this.publish('product:created');
            this.publish('product:updated');
            this.destroy();
            
        } catch (error) {
            console.error('[ProductForm] Ошибка:', error);
            this.publish('app:error', error);
            Notification.error(this.isEditMode ? 'Ошибка при обновлении товара' : 'Ошибка при создании товара');
        } finally {
            this.setLoading(false);
        }
    }
}
