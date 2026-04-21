/**
 * Confirm Dialog Module
 * 
 * Модальное окно подтверждения действия.
 * Заменяет нативный confirm().
 * 
 * @module ConfirmDialog
 * @version 2.0.0
 * @changes
 * - Убран BaseComponent (используем чистый DOM API)
 * - Убраны анимации
 * - Добавлена поддержка HTML в сообщении
 * - Улучшена обработка клавиатуры
 */

export class ConfirmDialog {
    /**
     * @param {HTMLElement} container - Контейнер для диалога
     * @param {Object} options - Настройки
     * @param {string} options.title - Заголовок
     * @param {string} options.message - Сообщение
     * @param {string} options.confirmText - Текст кнопки подтверждения
     * @param {string} options.cancelText - Текст кнопки отмены
     * @param {string} options.type - Тип: 'danger', 'warning', 'info'
     * @param {boolean} options.html - Разрешить HTML в сообщении
     */
    constructor(container, options = {}) {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('ConfirmDialog: container must be a valid HTMLElement');
        }
        
        this.container = container;
        this.options = {
            title: 'Подтверждение',
            message: 'Вы уверены?',
            confirmText: 'Да',
            cancelText: 'Отмена',
            type: 'info',
            html: false,
            ...options
        };
        
        this.resolve = null;
        this.element = null;
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    /**
     * Рендерит диалог
     * @returns {HTMLElement}
     */
    render() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.setAttribute('data-ref', 'overlay');
        
        const modal = document.createElement('div');
        modal.className = `modal confirm-dialog modal-${this.options.type}`;
        
        const header = document.createElement('div');
        header.className = 'modal-header';
        header.innerHTML = `<h3>${this.escapeHtml(this.options.title)}</h3>`;
        
        const body = document.createElement('div');
        body.className = 'modal-body';
        
        if (this.options.html) {
            body.innerHTML = `<div class="confirm-message">${this.options.message}</div>`;
        } else {
            body.innerHTML = `<div class="confirm-message">${this.escapeHtml(this.options.message)}</div>`;
        }
        
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        
        const actions = document.createElement('div');
        actions.className = 'actions';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = `btn-secondary`;
        cancelBtn.textContent = this.options.cancelText;
        cancelBtn.setAttribute('data-action', 'cancel');
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = this.getConfirmButtonClass();
        confirmBtn.textContent = this.options.confirmText;
        confirmBtn.setAttribute('data-action', 'confirm');
        
        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        footer.appendChild(actions);
        
        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        
        return overlay;
    }
    
    /**
     * Получает класс для кнопки подтверждения
     * @returns {string}
     */
    getConfirmButtonClass() {
        const classes = {
            danger: 'btn-danger',
            warning: 'btn-primary',
            info: 'btn-primary'
        };
        return classes[this.options.type] || 'btn-primary';
    }
    
    /**
     * Экранирует HTML спецсимволы
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    /**
     * Привязывает события
     */
    attachEvents() {
        // Кнопки
        const cancelBtn = this.element.querySelector('[data-action="cancel"]');
        const confirmBtn = this.element.querySelector('[data-action="confirm"]');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.close(false));
        }
        
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.close(true));
        }
        
        // Закрытие по клику на оверлей
        const overlay = this.element.querySelector('.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.close(false);
                }
            });
        }
        
        // Закрытие по Escape
        document.addEventListener('keydown', this.handleKeyDown);
    }
    
    /**
     * Обработчик клавиатуры
     * @param {KeyboardEvent} e
     */
    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.close(false);
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.close(true);
        }
    }
    
    /**
     * Отключает события
     */
    detachEvents() {
        document.removeEventListener('keydown', this.handleKeyDown);
    }
    
    /**
     * Закрывает диалог и возвращает результат
     * @param {boolean} result - Результат (true - подтверждено)
     */
    close(result) {
        this.detachEvents();
        
        if (this.element && this.element.parentNode) {
            this.element.remove();
        }
        
        if (this.resolve) {
            this.resolve(result);
        }
    }
    
    /**
     * Монтирует диалог в контейнер
     * @returns {Promise<void>}
     */
    async mount() {
        this.element = this.render();
        this.container.appendChild(this.element);
        this.attachEvents();
    }
    
    /**
     * Показывает диалог и возвращает Promise
     * @returns {Promise<boolean>}
     */
    async show() {
        await this.mount();
        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    }
    
    /**
     * Статический метод для быстрого показа диалога
     * @static
     * @param {Object} options - Настройки диалога
     * @returns {Promise<boolean>}
     */
    static async show(options) {
        const container = document.createElement('div');
        container.style.position = 'relative';
        container.style.zIndex = '1000';
        document.body.appendChild(container);
        
        const dialog = new ConfirmDialog(container, options);
        const result = await dialog.show();
        
        container.remove();
        return result;
    }
}
