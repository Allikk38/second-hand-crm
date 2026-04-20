import { BaseComponent } from '../../core/BaseComponent.js';
import { ProductService } from '../../services/ProductService.js';
import { SupabaseClient } from '../../core/SupabaseClient.js';
import { AuthManager } from '../auth/AuthManager.js';

export class ProductForm extends BaseComponent {
    async render() {
        return `
            <div class="modal-overlay">
                <div class="modal">
                    <h3>Новый товар</h3>
                    <form id="product-form">
                        <input type="text" name="name" placeholder="Название" required>
                        <input type="number" name="price" placeholder="Цена" step="0.01" required>
                        <select name="category">
                            <option value="">Категория</option>
                            <option value="clothes">Одежда</option>
                            <option value="toys">Игрушки</option>
                            <option value="dishes">Посуда</option>
                            <option value="other">Другое</option>
                        </select>
                        <input type="file" name="photo" accept="image/*">
                        <div class="actions">
                            <button type="submit">Сохранить</button>
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

    async handleSubmit(form) {
        this.showLoader();
        
        try {
            const user = AuthManager.getUser();
            const file = form.photo.files[0];
            let photoUrl = null;

            if (file) {
                const fileName = `${Date.now()}_${file.name}`;
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
                name: form.name.value,
                price: parseFloat(form.price.value),
                category: form.category.value || null,
                photo_url: photoUrl,
                created_by: user.id,
                status: 'in_stock'
            };

            await ProductService.create(product);
            this.publish('product:created');
            this.destroy();
            
        } catch (error) {
            this.publish('app:error', error);
            alert('Ошибка: ' + error.message);
        }
        
        this.hideLoader();
    }
}
