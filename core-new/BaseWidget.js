// ========================================
// FILE: ./core-new/BaseWidget.js
// ========================================

/**
 * Base Widget - Абстрактный базовый класс для всех виджетов
 * 
 * Предоставляет единый жизненный цикл и автоматическое управление ресурсами.
 * Гарантирует, что виджет не оставит за собой "мусор" (подписки, таймеры, слушатели).
 * 
 * Архитектурные решения:
 * - Автоматическая очистка ресурсов при destroy().
 * - Изолированный try/catch для каждого этапа жизненного цикла.
 * - Стандартизированные события о состоянии виджета.
 * - Встроенная поддержка EventBus с авто-отпиской.
 * 
 * @abstract
 * @module BaseWidget
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { EventBus, EventTypes, EventSource } from './EventBus.js';

export class BaseWidget {
    /**
     * @param {HTMLElement} container - DOM-элемент, в который будет смонтирован виджет
     * @param {string} widgetId - Уникальный идентификатор виджета
     */
    constructor(container, widgetId = null) {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('BaseWidget: container must be a valid HTMLElement');
        }
        
        /** @type {HTMLElement} */
        this.container = container;
        
        /** @type {string} */
        this.widgetId = widgetId || this._generateWidgetId();
        
        /** @type {HTMLElement|null} */
        this.element = null;
        
        /** @type {Map<string, HTMLElement|HTMLElement[]>} */
        this.refs = new Map();
        
        /** @type {boolean} */
        this._isMounted = false;
        
        /** @type {boolean} */
        this._isDestroyed = false;
        
        // Хранилища для автоматической очистки
        /** @type {Array<Function>} */
        this._unsubscribers = [];
        
        /** @type {Array<{element: HTMLElement, event: string, handler: Function, options: Object}>} */
        this._domListeners = [];
        
        /** @type {Array<number>} */
        this._timers = [];
        
        /** @type {Array<number>} */
        this._intervals = [];
        
        /** @type {Array<AbortController>} */
        this._abortControllers = [];
        
        // Привязываем методы
        this._handleGlobalError = this._handleGlobalError.bind(this);
        
        console.log(`[${this.constructor.name}] Constructed with ID: ${this.widgetId}`);
    }
    
    // ========== ЖИЗНЕННЫЙ ЦИКЛ (ПУБЛИЧНЫЙ) ==========
    
    /**
     * Монтирует виджет в контейнер.
     * @returns {Promise<void>}
     */
    async mount() {
        if (this._isDestroyed) {
            console.warn(`[${this.constructor.name}] Cannot mount destroyed widget`);
            return;
        }
        
        if (this._isMounted) {
            console.warn(`[${this.constructor.name}] Already mounted`);
            return;
        }
        
        console.log(`[${this.constructor.name}] Mounting...`);
        
        try {
            // 1. Рендеринг HTML
            const html = await this._safeExecute('render', async () => this.render());
            
            if (html) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html.trim();
                this.element = wrapper.firstChild;
                
                if (this.element) {
                    this.container.appendChild(this.element);
                    this._cacheRefs();
                }
            }
            
            // 2. Пост-рендер хук
            await this._safeExecute('afterRender', async () => this.afterRender());
            
            // 3. Привязка событий
            await this._safeExecute('attachEvents', async () => this.attachEvents());
            
            this._isMounted = true;
            
            // Оповещаем систему
            EventBus.emit(
                EventTypes.UI.MODAL_OPENED, // Используем как общее событие активности виджета
                { widgetId: this.widgetId, widgetName: this.constructor.name },
                this.widgetId
            );
            
            console.log(`[${this.constructor.name}] ✅ Mounted successfully`);
            
        } catch (error) {
            console.error(`[${this.constructor.name}] ❌ Mount failed:`, error);
            this._renderErrorState(error);
            throw error;
        }
    }
    
    /**
     * Обновляет виджет (перерисовывает полностью).
     * @returns {Promise<void>}
     */
    async update() {
        if (!this._isMounted || this._isDestroyed) return;
        
        console.log(`[${this.constructor.name}] Updating...`);
        
        try {
            const html = await this._safeExecute('render', async () => this.render());
            
            if (html && this.element) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html.trim();
                const newElement = wrapper.firstChild;
                
                // Сохраняем состояние форм
                this._preserveInputState(this.element, newElement);
                
                // Заменяем элемент
                this.element.replaceWith(newElement);
                this.element = newElement;
                this._cacheRefs();
                
                await this._safeExecute('afterRender', async () => this.afterRender());
                await this._safeExecute('attachEvents', async () => this.attachEvents());
            }
            
            console.log(`[${this.constructor.name}] ✅ Updated`);
            
        } catch (error) {
            console.error(`[${this.constructor.name}] ❌ Update failed:`, error);
            this._renderErrorState(error);
        }
    }
    
    /**
     * Уничтожает виджет и очищает ВСЕ ресурсы.
     * @returns {Promise<void>}
     */
    async destroy() {
        if (this._isDestroyed) return;
        
        console.log(`[${this.constructor.name}] Destroying...`);
        
        // 1. Хук перед уничтожением
        await this._safeExecute('beforeDestroy', async () => this.beforeDestroy());
        
        // 2. Очистка таймеров
        this._timers.forEach(id => clearTimeout(id));
        this._intervals.forEach(id => clearInterval(id));
        this._timers = [];
        this._intervals = [];
        
        // 3. Отмена AbortController
        this._abortControllers.forEach(ctrl => ctrl.abort());
        this._abortControllers = [];
        
        // 4. Очистка DOM-слушателей
        this._domListeners.forEach(({ element, event, handler, options }) => {
            element.removeEventListener(event, handler, options);
        });
        this._domListeners = [];
        
        // 5. Отписка от EventBus
        this._unsubscribers.forEach(unsub => {
            try {
                unsub();
            } catch (e) {
                // Игнорируем
            }
        });
        this._unsubscribers = [];
        
        // 6. Очистка EventBus от подписок этого виджета
        EventBus.clearSource(this.widgetId);
        
        // 7. Удаление из DOM
        if (this.element?.parentNode) {
            this.element.remove();
        }
        
        this.element = null;
        this.refs.clear();
        this._isDestroyed = true;
        this._isMounted = false;
        
        console.log(`[${this.constructor.name}] 💀 Destroyed`);
    }
    
    // ========== МЕТОДЫ ДЛЯ ПЕРЕОПРЕДЕЛЕНИЯ (АБСТРАКТНЫЕ) ==========
    
    /**
     * Возвращает HTML-строку виджета.
     * @abstract
     * @returns {Promise<string>|string}
     */
    async render() {
        return '<div>Widget</div>';
    }
    
    /**
     * Вызывается после рендеринга, до attachEvents.
     * @abstract
     */
    async afterRender() {
        // Опционально
    }
    
    /**
     * Привязывает DOM-события и подписки на EventBus.
     * @abstract
     */
    attachEvents() {
        // Опционально
    }
    
    /**
     * Вызывается перед уничтожением виджета.
     * @abstract
     */
    beforeDestroy() {
        // Опционально
    }
    
    // ========== УПРАВЛЕНИЕ РЕСУРСАМИ (ЗАЩИЩЕННЫЕ) ==========
    
    /**
     * Подписаться на событие EventBus (с авто-отпиской).
     * @param {string} event - Тип события
     * @param {Function} callback - Обработчик
     * @param {string|null} sourceFilter - Фильтр по источнику
     */
    subscribe(event, callback, sourceFilter = null) {
        const unsub = EventBus.on(event, callback, sourceFilter);
        this._unsubscribers.push(unsub);
        return unsub;
    }
    
    /**
     * Подписаться на событие один раз.
     */
    subscribeOnce(event, callback, sourceFilter = null) {
        EventBus.once(event, callback, sourceFilter);
    }
    
    /**
     * Отправить событие в EventBus.
     */
    publish(event, data = null) {
        EventBus.emit(event, data, this.widgetId);
    }
    
    /**
     * Добавить DOM-слушатель (с авто-очисткой).
     */
    addDomListener(refName, event, handler, options = {}) {
        const element = this.refs.get(refName);
        if (!element) {
            console.warn(`[${this.constructor.name}] Ref "${refName}" not found`);
            return false;
        }
        
        const elements = Array.isArray(element) ? element : [element];
        
        elements.forEach(el => {
            const boundHandler = handler.bind(this);
            el.addEventListener(event, boundHandler, options);
            
            this._domListeners.push({
                element: el,
                event,
                handler: boundHandler,
                options
            });
        });
        
        return true;
    }
    
    /**
     * Установить таймаут (с авто-очисткой).
     */
    setTimeout(callback, delay) {
        const id = setTimeout(() => {
            this._timers = this._timers.filter(t => t !== id);
            callback();
        }, delay);
        
        this._timers.push(id);
        return id;
    }
    
    /**
     * Установить интервал (с авто-очисткой).
     */
    setInterval(callback, delay) {
        const id = setInterval(callback, delay);
        this._intervals.push(id);
        return id;
    }
    
    /**
     * Создать AbortController (с авто-отменой).
     */
    createAbortController() {
        const controller = new AbortController();
        this._abortControllers.push(controller);
        return controller;
    }
    
    // ========== УТИЛИТЫ ==========
    
    /**
     * Экранирует HTML.
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    /**
     * Форматирует деньги.
     */
    formatMoney(amount) {
        if (amount === null || isNaN(amount)) return '0 ₽';
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount).replace('RUB', '₽');
    }
    
    // ========== ПРИВАТНЫЕ МЕТОДЫ ==========
    
    _generateWidgetId() {
        return `${this.constructor.name.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    async _safeExecute(methodName, fn) {
        try {
            return await fn();
        } catch (error) {
            console.error(`[${this.constructor.name}] Error in ${methodName}():`, error);
            
            this.publish(EventTypes.SYSTEM.ERROR, {
                widget: this.constructor.name,
                method: methodName,
                error: error.message,
                stack: error.stack
            });
            
            throw error;
        }
    }
    
    _cacheRefs() {
        this.refs.clear();
        if (!this.element) return;
        
        const refElements = this.element.querySelectorAll('[data-ref]');
        refElements.forEach(el => {
            const refName = el.dataset.ref;
            
            if (this.refs.has(refName)) {
                const existing = this.refs.get(refName);
                if (Array.isArray(existing)) {
                    existing.push(el);
                } else {
                    this.refs.set(refName, [existing, el]);
                }
            } else {
                this.refs.set(refName, el);
            }
        });
    }
    
    _preserveInputState(oldElement, newElement) {
        if (!oldElement || !newElement) return;
        
        const oldInputs = oldElement.querySelectorAll('input, select, textarea');
        const newInputs = newElement.querySelectorAll('input, select, textarea');
        
        oldInputs.forEach((oldInput, index) => {
            const newInput = newInputs[index];
            if (!newInput) return;
            
            if (oldInput.type === 'checkbox' || oldInput.type === 'radio') {
                newInput.checked = oldInput.checked;
            } else {
                newInput.value = oldInput.value;
            }
        });
    }
    
    _renderErrorState(error) {
        if (this.container) {
            this.container.innerHTML = `
                <div class="widget-error">
                    <div class="error-icon">⚠️</div>
                    <h4>Ошибка в виджете ${this.constructor.name}</h4>
                    <p>${this.escapeHtml(error.message)}</p>
                </div>
            `;
        }
    }
    
    _handleGlobalError(event) {
        console.error(`[${this.constructor.name}] Global error:`, event);
    }
}

export default BaseWidget;
