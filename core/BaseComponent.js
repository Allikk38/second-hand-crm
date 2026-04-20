/**
 * Base Component
 * 
 * Абстрактный базовый класс для всех UI компонентов.
 * Предоставляет жизненный цикл, управление событиями и утилиты рендеринга.
 * 
 * Архитектурные решения:
 * - Наследование для единообразного API компонентов
 * - Система refs для кэширования DOM-элементов
 * - Автоматическая очистка подписок EventBus при destroy
 * - Хук beforeDestroy для очистки таймеров/интервалов
 * - Интеллектуальное обновление с сохранением состояния форм
 * 
 * @abstract
 * @module BaseComponent
 * @requires EventBus
 */

import { EventBus } from './EventBus.js';
import { formatMoney } from '../utils/formatters.js';

export class BaseComponent {
    /**
     * @param {HTMLElement} container - DOM-элемент, в который будет смонтирован компонент
     */
    constructor(container) {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('BaseComponent: container must be a valid HTMLElement');
        }
        
        this.container = container;
        this.element = null;
        this.eventUnsubscribers = [];
        this.domEventListeners = [];
        this.refs = new Map();
        this._state = {};
        this._isDestroyed = false;
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    /**
     * Рендерит HTML компонента
     * @abstract
     * @returns {Promise<string>|string} HTML строка
     */
    async render() {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Привязывает DOM события после рендеринга
     * @abstract
     */
    attachEvents() {
        // Опционально реализуется в наследниках
    }

    /**
     * Вызывается перед уничтожением компонента
     * Используется для очистки таймеров, интервалов, observer'ов
     */
    beforeDestroy() {
        // Опционально реализуется в наследниках
    }

    /**
     * Монтирует компонент в контейнер
     * @returns {Promise<void>}
     */
    async mount() {
        if (this._isDestroyed) {
            console.warn('[BaseComponent] Attempted to mount destroyed component');
            return;
        }
        
        this.container.innerHTML = '';
        
        try {
            const html = await this.render();
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html.trim();
            this.element = wrapper.firstChild;
            
            if (this.element) {
                this.container.appendChild(this.element);
                this.cacheRefs();
                this.attachEvents();
            }
            
            this.hideLoader();
        } catch (error) {
            console.error('[BaseComponent] Mount failed:', error);
            this.container.innerHTML = `
                <div class="error-state">
                    <p>Ошибка загрузки компонента</p>
                    <small>${error.message}</small>
                </div>
            `;
            throw error;
        }
    }

    /**
     * Обновляет компонент (полная перерисовка)
     * Внимание: сбрасывает состояние форм и фокус!
     * Для частичного обновления используйте updateState()
     * 
     * @returns {Promise<void>}
     */
    async update() {
        if (this._isDestroyed || !this.element?.parentNode) {
            return;
        }
        
        const parent = this.element.parentNode;
        const nextSibling = this.element.nextSibling;
        
        this.cleanupDomEvents();
        this.beforeDestroy();
        
        const html = await this.render();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html.trim();
        
        const newElement = wrapper.firstChild;
        
        // Сохраняем состояние input'ов с одинаковыми name
        this.preserveInputState(this.element, newElement);
        
        this.element.remove();
        parent.insertBefore(newElement, nextSibling);
        
        this.element = newElement;
        this.cacheRefs();
        this.attachEvents();
    }

    /**
     * Обновляет состояние компонента без полной перерисовки
     * @param {Object} newState - Новое состояние
     */
    setState(newState) {
        this._state = { ...this._state, ...newState };
        this.applyStateToDOM();
    }

    /**
     * Получает текущее состояние
     * @returns {Object}
     */
    getState() {
        return { ...this._state };
    }

    /**
     * Применяет состояние к DOM (переопределяется в наследниках)
     */
    applyStateToDOM() {
        // Опционально реализуется в наследниках для эффективного обновления
    }

    /**
     * Уничтожает компонент и очищает все ресурсы
     */
    destroy() {
        if (this._isDestroyed) return;
        
        this.beforeDestroy();
        
        // Отписка от EventBus
        this.eventUnsubscribers.forEach(unsub => {
            try {
                unsub();
            } catch (e) {
                // Игнорируем ошибки при отписке
            }
        });
        this.eventUnsubscribers = [];
        
        // Очистка DOM-слушателей
        this.cleanupDomEvents();
        
        // Удаление элемента из DOM
        if (this.element?.parentNode) {
            this.element.remove();
        }
        
        this.element = null;
        this.refs.clear();
        this._isDestroyed = true;
    }

    // ========== УПРАВЛЕНИЕ СОБЫТИЯМИ ==========
    
    /**
     * Подписывается на событие EventBus
     * @param {string} event - Имя события
     * @param {Function} callback - Обработчик
     * @returns {Function} Функция отписки
     */
    subscribe(event, callback) {
        const unsub = EventBus.on(event, callback);
        this.eventUnsubscribers.push(unsub);
        return unsub;
    }

    /**
     * Публикует событие в EventBus
     * @param {string} event - Имя события
     * @param {*} data - Данные события
     */
    publish(event, data) {
        EventBus.emit(event, data);
    }

    /**
     * Добавляет DOM-слушатель с автоматической очисткой при destroy
     * @param {HTMLElement|string} target - Элемент или селектор ref
     * @param {string} event - Имя события
     * @param {Function} handler - Обработчик
     * @param {Object} options - Опции addEventListener
     */
    addDomListener(target, event, handler, options = {}) {
        let element;
        
        if (typeof target === 'string') {
            element = this.refs.get(target);
            if (!element) {
                console.warn(`[BaseComponent] Ref "${target}" not found for event listener`);
                return;
            }
        } else if (target instanceof HTMLElement) {
            element = target;
        } else {
            console.warn('[BaseComponent] Invalid target for addDomListener');
            return;
        }
        
        const boundHandler = handler.bind(this);
        element.addEventListener(event, boundHandler, options);
        
        this.domEventListeners.push({
            element,
            event,
            handler: boundHandler,
            options
        });
    }

    /**
     * Удаляет все DOM-слушатели
     * @private
     */
    cleanupDomEvents() {
        this.domEventListeners.forEach(({ element, event, handler, options }) => {
            if (element) {
                element.removeEventListener(event, handler, options);
            }
        });
        this.domEventListeners = [];
    }

    // ========== УТИЛИТЫ ==========
    
    /**
     * Кэширует элементы с атрибутом data-ref
     * @private
     */
    cacheRefs() {
        this.refs.clear();
        
        if (!this.element) return;
        
        const refElements = this.element.querySelectorAll('[data-ref]');
        refElements.forEach(el => {
            const refName = el.dataset.ref;
            this.refs.set(refName, el);
        });
    }

    /**
     * Сохраняет состояние input/select/textarea при перерисовке
     * @private
     */
    preserveInputState(oldElement, newElement) {
        if (!oldElement || !newElement) return;
        
        const oldInputs = oldElement.querySelectorAll('input, select, textarea');
        const newInputs = newElement.querySelectorAll('input, select, textarea');
        
        oldInputs.forEach((oldInput, index) => {
            const newInput = newInputs[index];
            if (!newInput || !oldInput.name || oldInput.name !== newInput.name) return;
            
            if (oldInput.type === 'checkbox' || oldInput.type === 'radio') {
                newInput.checked = oldInput.checked;
            } else {
                newInput.value = oldInput.value;
            }
        });
    }

    /**
     * Показывает лоадер в контейнере
     */
    showLoader() {
        if (this._isDestroyed) return;
        this.container.innerHTML = `
            <div class="loading-overlay">
                <div class="loading-spinner"></div>
                <span class="loading-text">Загрузка...</span>
            </div>
        `;
    }

    /**
     * Скрывает лоадер
     */
    hideLoader() {
        const loader = this.container.querySelector('.loading-overlay');
        if (loader) {
            loader.remove();
        }
    }

    /**
     * Форматирует денежную сумму
     * @deprecated Используйте formatMoney из utils/formatters.js
     * @param {number} amount - Сумма
     * @returns {string} Отформатированная строка
     */
    formatMoney(amount) {
        return formatMoney(amount);
    }

    /**
     * Экранирует HTML спецсимволы
     * @param {string} str - Исходная строка
     * @returns {string} Безопасная строка
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Безопасно получает значение из вложенного объекта
     * @param {Object} obj - Объект
     * @param {string} path - Путь через точку
     * @param {*} defaultValue - Значение по умолчанию
     * @returns {*}
     */
    getNestedValue(obj, path, defaultValue = null) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : defaultValue;
        }, obj);
    }

    // ========== СТАТИЧЕСКИЕ УТИЛИТЫ ==========
    
    /**
     * Создает элемент с атрибутами и классами
     * @static
     * @param {string} tag - Тег элемента
     * @param {Object} options - { class, id, attrs, text, html }
     * @returns {HTMLElement}
     */
    static createElement(tag, options = {}) {
        const el = document.createElement(tag);
        
        if (options.class) {
            const classes = Array.isArray(options.class) ? options.class : options.class.split(' ');
            el.classList.add(...classes.filter(Boolean));
        }
        
        if (options.id) el.id = options.id;
        if (options.text) el.textContent = options.text;
        if (options.html) el.innerHTML = options.html;
        
        if (options.attrs) {
            Object.entries(options.attrs).forEach(([key, value]) => {
                el.setAttribute(key, value);
            });
        }
        
        if (options.data) {
            Object.entries(options.data).forEach(([key, value]) => {
                el.dataset[key] = value;
            });
        }
        
        return el;
    }
}
