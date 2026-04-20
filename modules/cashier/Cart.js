import { BaseComponent } from '../../core/BaseComponent.js';

export class Cart extends BaseComponent {
    constructor(container) {
        super(container);
        this.items = [];
    }

    render() {
        const total = this.items.reduce((sum, item) => sum + item.price, 0);
        
        return `
            <div class="cart">
                <h3>Корзина (${this.items.length})</h3>
                <div class="cart-items">
                    ${this.items.map(item => `
                        <div class="cart-item">
                            <span>${item.name}</span>
                            <span>${this.formatMoney(item.price)}</span>
                            <button data-action="remove" data-id="${item.id}">✕</button>
                        </div>
                    `).join('')}
                </div>
                <div class="cart-total">
                    <strong>Итого: ${this.formatMoney(total)}</strong>
                </div>
                ${this.items.length ? '<button data-action="checkout">Продать</button>' : ''}
            </div>
        `;
    }

    attachEvents() {
        this.element.querySelectorAll('[data-action="remove"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                this.items = this.items.filter(i => i.id !== id);
                this.update();
            });
        });
        
        const checkoutBtn = this.element.querySelector('[data-action="checkout"]');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                this.publish('cart:checkout', { items: this.items });
            });
        }
    }

    addItem(product) {
        if (product.status !== 'in_stock') {
            alert('Товар уже продан');
            return;
        }
        this.items.push(product);
        this.update();
        this.publish('cart:updated', this.items);
    }

    clear() {
        this.items = [];
        this.update();
    }
}
