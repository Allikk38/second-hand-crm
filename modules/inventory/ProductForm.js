/**
 * Форма добавления и редактирования товара
 * Поддерживает загрузку фото, валидацию полей
 * 
 * @module ProductForm
 */

import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { SupabaseClient } from '../../core/SupabaseClient.js';
import { AuthManager } from '../auth/AuthManager.js';
import { Notification } from '../common/Notification.js';

export class ProductForm extends BaseComponent {
    async render() {
        return `
            <div class="modal-overlay">
                <div class="modal">
                    <h3>Новый товар</h3>
                    <form id="product-form">
                        <input type="text" name="name" placeholder="Название" required>
                        <input type="number" name="price" placeholder="Цена" step="0.01" min="0" required>
                        <select name="category">
                            <option value="">Категория</option>
                            <option value="clothes">Одежда</option>
                            <option value="toys">Игрушки</option>
                            <option value="dishes">Посуда</option>
                            <option value="other">Другое</option>
                        </select>
                        <input type="text" name="size" placeholder="Размер (например: 104, M, 42)">
                        <input type="file" name="photo" accept="image/*">
                        <div class="actions">
                            <button type="submit" class="btn-primary">
                                <span class="btn-text">Сохранить</span>
                                <span class="btn-loader" style="display:none;">Загрузка...</span>
                            </button>
                            <button type="button" data-action="cancel">Отмена</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    attachEvents() {
        this.element.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            this.destroy();
        });

        this.element.querySelector('#product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit(e.target);
        });
    }

    validateForm(form) {
        const name = form.name.value.trim();
        const price = parseFloat(form.price.value);
        
        if (!name) {
            Notification.warning('Введите название товара');
            return false;
        }
        
        if (name.length < 2) {
            Notification.warning('Название должно быть не менее 2 символов');
            return false;
        }
        
        if (isNaN(price) || price <= 0) {
            Notification.warning('Введите корректную цену');
            return false;
        }
        
        if (price > 1000000) {
            Notification.warning('Цена не может превышать 1 000 000 руб');
            return false;
        }
        
        return true;
    }

    setLoading(loading) {
        const btn = this.element.querySelector('button[type="submit"]');
        const text = btn.querySelector('.btn-text');
        const loader = btn.querySelector('.btn-loader');
        
        btn.disabled = loading;
        text.style.display = loading ? 'none' : 'inline';
        loader.style.display = loading ? 'inline' : 'none';
    }

    async handleSubmit(form) {
        if (!this.validateForm(form)) return;
        
        this.setLoading(true);
        
        try {
            const user = AuthManager.getUser();
            const file = form.photo.files[0];
            let photoUrl = null;

            if (file) {
                if (file.size > 5 * 1024 * 1024) {
                    Notification.warning('Фото не должно превышать 5 МБ');
                    this.setLoading(false);
                    return;
                }
                
                const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                const { error } = await SupabaseClient.storage
                    .from('product-photos')
                    .upload(fileName, file);
                
                if (error) throw error;
                
                const { data } = SupabaseClient.storage
                    .from('product-photos')
                    .getPublicUrl(fileName);
                
                photoUrl = data.publicUrl;
            }

            const product = {
                name: form.name.value.trim(),
                price: parseFloat(form.price.value),
                category: form.category.value || null,
                size: form.size.value.trim() || null,
                photo_url: photoUrl,
                created_by: user.id,
                status: 'in_stock'
            };

            await ProductService.create(product);
            Notification.success('Товар успешно добавлен');
            this.publish('product:created');
            this.destroy();
            
        } catch (error) {
            this.publish('app:error', error);
            Notification.error('Ошибка при создании товара');
        } finally {
            this.setLoading(false);
        }
    }
}
