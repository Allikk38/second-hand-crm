import { EventBus } from './EventBus.js';

export class BaseComponent {
    constructor(container) {
        this.container = container;
        this.element = null;
        this.eventUnsubscribers = [];
    }

    async render() {
        throw new Error('render() must be implemented');
    }

    attachEvents() {}

    subscribe(event, callback) {
        const unsub = EventBus.on(event, callback);
        this.eventUnsubscribers.push(unsub);
        return unsub;
    }

    publish(event, data) {
        EventBus.emit(event, data);
    }

    async mount() {
        this.container.innerHTML = '';
        const html = await this.render();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html.trim();
        this.element = wrapper.firstChild;
        this.container.appendChild(this.element);
        this.attachEvents();
        this.hideLoader();
    }

    async update() {
        if (this.element?.parentNode) {
            const parent = this.element.parentNode;
            this.destroy();
            const html = await this.render();
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html.trim();
            this.element = wrapper.firstChild;
            parent.appendChild(this.element);
            this.attachEvents();
        }
    }

    showLoader() {
        this.container.innerHTML = '<div class="loading">Загрузка...</div>';
    }

    hideLoader() {
        const loader = this.container.querySelector('.loading');
        if (loader) loader.remove();
    }

    destroy() {
        this.eventUnsubscribers.forEach(u => u());
        this.eventUnsubscribers = [];
        if (this.element) this.element.remove();
    }

    formatMoney(amount) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0
        }).format(amount);
    }
}
