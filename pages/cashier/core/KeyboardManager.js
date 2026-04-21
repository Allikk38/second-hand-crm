/**
 * Keyboard Manager
 * 
 * Управление горячими клавишами для кассового модуля.
 * Обеспечивает быструю работу кассира без использования мыши.
 * 
 * Архитектурные решения:
 * - Приоритетная обработка клавиш (поиск > корзина > навигация)
 * - Блокировка при открытых модальных окнах
 * - Поддержка звуковых сигналов для обратной связи
 * - Автоматическая фокусировка на поиске после действий
 * 
 * @module KeyboardManager
 * @version 6.0.0
 * @changes
 * - Создан специально для MPA архитектуры
 * - Добавлена поддержка сканера штрихкодов (Enter после ввода)
 * - Добавлены звуковые сигналы
 * - Добавлена вибрация для мобильных устройств
 */

import { EventBus } from '../../../core/EventBus.js';

// ========== КОНСТАНТЫ ==========
const SCANNER_TIMEOUT = 50; // мс для определения сканера
const SOUND_ENABLED = true;
const VIBRATION_ENABLED = true;

// Звуковые сигналы (создаются лениво)
let sounds = {
    scan: null,
    success: null,
    error: null,
    checkout: null
};

class KeyboardManagerClass {
    constructor() {
        this.handlers = new Map();
        this.isModalOpen = false;
        this.isInputFocused = false;
        this.scannerBuffer = '';
        this.scannerTimer = null;
        this.enabled = true;
        
        // Привязка методов
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyPress = this.handleKeyPress.bind(this);
        this.handlePaste = this.handlePaste.bind(this);
    }
    
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    /**
     * Инициализирует менеджер клавиатуры
     * @param {Object} options - Опции и обработчики
     */
    init(options = {}) {
        this.options = {
            onSearch: options.onSearch || (() => {}),
            onClearSearch: options.onClearSearch || (() => {}),
            onCheckout: options.onCheckout || (() => {}),
            onClearCart: options.onClearCart || (() => {}),
            onAddQuantity: options.onAddQuantity || (() => {}),
            onRemoveQuantity: options.onRemoveQuantity || (() => {}),
            onScan: options.onScan || (() => {}),
            ...options
        };
        
        // Инициализируем звуки
        if (SOUND_ENABLED) {
            this.initSounds();
        }
        
        // Добавляем слушатели
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keypress', this.handleKeyPress);
        document.addEventListener('paste', this.handlePaste);
        
        // Слушаем события модальных окон
        EventBus.on('modal:opened', () => { this.isModalOpen = true; });
        EventBus.on('modal:closed', () => { this.isModalOpen = false; });
        
        // Слушаем фокус на инпутах
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('input, textarea, select')) {
                this.isInputFocused = true;
            }
        });
        
        document.addEventListener('focusout', () => {
            this.isInputFocused = false;
        });
        
        console.log('[KeyboardManager] Initialized');
    }
    
    /**
     * Инициализирует звуковые сигналы
     */
    initSounds() {
        try {
            // Используем Web Audio API для генерации звуков
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            
            this.audioContext = new AudioContext();
            
            // Звуки будут создаваться динамически при воспроизведении
        } catch (error) {
            console.warn('[KeyboardManager] Web Audio API not supported');
        }
    }
    
    /**
     * Воспроизводит звуковой сигнал
     * @param {string} type - Тип сигнала ('scan', 'success', 'error', 'checkout')
     */
    playSound(type) {
        if (!SOUND_ENABLED || !this.audioContext) return;
        
        // Возобновляем контекст если он приостановлен
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        try {
            const now = this.audioContext.currentTime;
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Настройки для разных типов сигналов
            switch (type) {
                case 'scan':
                    oscillator.frequency.value = 1200;
                    gainNode.gain.setValueAtTime(0.1, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                    oscillator.start();
                    oscillator.stop(now + 0.05);
                    break;
                    
                case 'success':
                    oscillator.frequency.value = 800;
                    gainNode.gain.setValueAtTime(0.1, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                    oscillator.start();
                    
                    // Второй тон
                    const osc2 = this.audioContext.createOscillator();
                    const gain2 = this.audioContext.createGain();
                    osc2.connect(gain2);
                    gain2.connect(this.audioContext.destination);
                    osc2.frequency.value = 1200;
                    gain2.gain.setValueAtTime(0.1, now + 0.05);
                    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                    osc2.start(now + 0.05);
                    osc2.stop(now + 0.15);
                    
                    oscillator.stop(now + 0.1);
                    break;
                    
                case 'error':
                    oscillator.frequency.value = 400;
                    gainNode.gain.setValueAtTime(0.15, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                    oscillator.start();
                    oscillator.stop(now + 0.2);
                    break;
                    
                case 'checkout':
                    oscillator.frequency.value = 523.25; // C5
                    gainNode.gain.setValueAtTime(0.1, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                    oscillator.start();
                    
                    // Аккорд
                    const osc3 = this.audioContext.createOscillator();
                    const gain3 = this.audioContext.createGain();
                    osc3.connect(gain3);
                    gain3.connect(this.audioContext.destination);
                    osc3.frequency.value = 659.25; // E5
                    gain3.gain.setValueAtTime(0.08, now + 0.1);
                    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                    osc3.start(now + 0.1);
                    osc3.stop(now + 0.3);
                    
                    oscillator.stop(now + 0.2);
                    break;
            }
        } catch (error) {
            // Игнорируем ошибки воспроизведения
        }
    }
    
    /**
     * Вибрация для мобильных устройств
     * @param {string} type - Тип вибрации
     */
    vibrate(type) {
        if (!VIBRATION_ENABLED || !navigator.vibrate) return;
        
        switch (type) {
            case 'scan':
                navigator.vibrate(20);
                break;
            case 'success':
                navigator.vibrate([50, 50, 50]);
                break;
            case 'error':
                navigator.vibrate([100, 50, 100]);
                break;
            case 'checkout':
                navigator.vibrate(200);
                break;
        }
    }
    
    // ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
    
    /**
     * Обработчик нажатия клавиш
     * @param {KeyboardEvent} e - Событие клавиатуры
     */
    handleKeyDown(e) {
        if (!this.enabled) return;
        if (this.isModalOpen) return;
        
        const key = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const alt = e.altKey;
        const shift = e.shiftKey;
        
        // === ГЛОБАЛЬНЫЕ СОЧЕТАНИЯ ===
        
        // Ctrl/Cmd + Enter = Оформление продажи
        if (ctrl && key === 'Enter') {
            e.preventDefault();
            this.options.onCheckout();
            this.playSound('checkout');
            this.vibrate('checkout');
            return;
        }
        
        // Alt + C = Очистка корзины
        if (alt && key === 'c') {
            e.preventDefault();
            this.options.onClearCart();
            return;
        }
        
        // Alt + Delete = Очистка корзины (альтернатива)
        if (alt && key === 'Delete') {
            e.preventDefault();
            this.options.onClearCart();
            return;
        }
        
        // === ФОКУС НА ПОИСКЕ ===
        
        // / = Фокус на поиск
        if (key === '/' && !this.isInputFocused) {
            e.preventDefault();
            this.options.onSearch();
            return;
        }
        
        // Escape = Очистка поиска и снятие фокуса
        if (key === 'Escape') {
            if (this.isInputFocused) {
                e.preventDefault();
                this.options.onClearSearch();
                document.activeElement?.blur();
            }
            return;
        }
        
        // === УПРАВЛЕНИЕ КОЛИЧЕСТВОМ (когда выбран товар в корзине) ===
        
        // + или = Увеличить количество
        if ((key === '+' || key === '=') && !this.isInputFocused) {
            e.preventDefault();
            // Получаем ID выбранного товара из Store или активного элемента
            const selectedId = this.getSelectedCartItemId();
            if (selectedId) {
                this.options.onAddQuantity(selectedId);
            }
            return;
        }
        
        // - Уменьшить количество
        if (key === '-' && !this.isInputFocused) {
            e.preventDefault();
            const selectedId = this.getSelectedCartItemId();
            if (selectedId) {
                this.options.onRemoveQuantity(selectedId);
            }
            return;
        }
        
        // Delete = Удалить выбранный товар
        if (key === 'Delete' && !this.isInputFocused) {
            e.preventDefault();
            const selectedId = this.getSelectedCartItemId();
            if (selectedId) {
                this.options.onRemoveQuantity(selectedId);
            }
            return;
        }
        
        // === НАВИГАЦИЯ ПО ТОВАРАМ ===
        
        // Стрелки для навигации по сетке товаров
        if (!this.isInputFocused) {
            switch (key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateProducts('up');
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateProducts('down');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.navigateProducts('left');
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.navigateProducts('right');
                    break;
                case 'Enter':
                    // Добавить выбранный товар в корзину
                    e.preventDefault();
                    this.addSelectedProduct();
                    break;
            }
        }
        
        // === ЦИФРОВОЙ ВВОД ДЛЯ КОЛИЧЕСТВА ===
        
        // Запоминаем цифры для быстрого ввода количества
        if (/^[0-9]$/.test(key) && !this.isInputFocused) {
            this.handleQuantityInput(key);
        }
    }
    
    /**
     * Обработчик нажатия клавиш (для сканера)
     * @param {KeyboardEvent} e - Событие клавиатуры
     */
    handleKeyPress(e) {
        if (!this.enabled) return;
        if (this.isModalOpen) return;
        if (this.isInputFocused) return;
        
        const key = e.key;
        
        // Игнорируем служебные клавиши
        if (key.length > 1) return;
        
        // Накапливаем ввод от сканера
        this.scannerBuffer += key;
        
        // Сбрасываем таймер
        clearTimeout(this.scannerTimer);
        
        // Ждем окончания ввода от сканера
        this.scannerTimer = setTimeout(() => {
            if (this.scannerBuffer.length > 3) {
                // Это сканер штрихкодов
                const barcode = this.scannerBuffer.trim();
                this.options.onScan(barcode);
                this.playSound('scan');
                this.vibrate('scan');
            }
            this.scannerBuffer = '';
        }, SCANNER_TIMEOUT);
    }
    
    /**
     * Обработчик вставки из буфера обмена
     * @param {ClipboardEvent} e - Событие вставки
     */
    handlePaste(e) {
        if (!this.enabled) return;
        if (this.isModalOpen) return;
        if (this.isInputFocused) return;
        
        e.preventDefault();
        
        const text = e.clipboardData?.getData('text') || '';
        if (text) {
            this.options.onScan(text);
            this.playSound('scan');
            this.vibrate('scan');
        }
    }
    
    // ========== УПРАВЛЕНИЕ КОЛИЧЕСТВОМ ==========
    
    /**
     * Обрабатывает ввод количества с цифровой клавиатуры
     * @param {string} digit - Цифра
     */
    handleQuantityInput(digit) {
        // Сохраняем ввод для комбинации с Enter
        if (!this.quantityBuffer) {
            this.quantityBuffer = '';
        }
        
        this.quantityBuffer += digit;
        
        // Показываем подсказку
        this.showQuantityHint(this.quantityBuffer);
        
        // Сбрасываем через 1 секунду бездействия
        clearTimeout(this.quantityTimer);
        this.quantityTimer = setTimeout(() => {
            this.quantityBuffer = '';
            this.hideQuantityHint();
        }, 1000);
    }
    
    /**
     * Показывает подсказку с количеством
     * @param {string} quantity - Количество
     */
    showQuantityHint(quantity) {
        let hint = document.getElementById('quantity-hint');
        
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'quantity-hint';
            hint.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: #0f172a;
                color: white;
                padding: 8px 16px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                z-index: 9999;
                pointer-events: none;
            `;
            document.body.appendChild(hint);
        }
        
        hint.textContent = `Количество: ${quantity}`;
        hint.style.display = 'block';
    }
    
    /**
     * Скрывает подсказку с количеством
     */
    hideQuantityHint() {
        const hint = document.getElementById('quantity-hint');
        if (hint) {
            hint.style.display = 'none';
        }
    }
    
    // ========== НАВИГАЦИЯ ПО ТОВАРАМ ==========
    
    /**
     * Навигация по сетке товаров
     * @param {string} direction - Направление
     */
    navigateProducts(direction) {
        const grid = document.querySelector('.products-grid');
        if (!grid) return;
        
        const cards = grid.querySelectorAll('.product-card:not(.sold)');
        if (cards.length === 0) return;
        
        // Находим текущий выбранный товар
        const current = grid.querySelector('.product-card.selected');
        let index = current ? Array.from(cards).indexOf(current) : -1;
        
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        
        switch (direction) {
            case 'up':
                index = Math.max(0, index - columns);
                break;
            case 'down':
                index = Math.min(cards.length - 1, index + columns);
                break;
            case 'left':
                index = Math.max(0, index - 1);
                break;
            case 'right':
                index = Math.min(cards.length - 1, index + 1);
                break;
        }
        
        // Если не было выбранного, выбираем первый
        if (index === -1) index = 0;
        
        // Снимаем выделение со всех
        cards.forEach(c => c.classList.remove('selected'));
        
        // Выделяем новый
        const selected = cards[index];
        selected.classList.add('selected');
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    
    /**
     * Добавляет выбранный товар в корзину
     */
    addSelectedProduct() {
        const selected = document.querySelector('.product-card.selected');
        if (!selected) return;
        
        const productId = selected.dataset.id;
        if (productId) {
            // Имитируем клик по кнопке добавления
            const addBtn = selected.querySelector('[data-action="addToCart"]');
            if (addBtn) {
                addBtn.click();
                this.playSound('success');
                this.vibrate('success');
            }
        }
    }
    
    /**
     * Получает ID выбранного товара в корзине
     * @returns {string|null}
     */
    getSelectedCartItemId() {
        const selected = document.querySelector('.cart-item.selected');
        return selected?.dataset.id || null;
    }
    
    // ========== УПРАВЛЕНИЕ ==========
    
    /**
     * Включает/выключает менеджер
     * @param {boolean} enabled - Включен ли
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    
    /**
     * Фокусирует поле поиска
     */
    focusSearch() {
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }
    
    /**
     * Очищает поле поиска
     */
    clearSearch() {
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.value = '';
            this.options.onClearSearch();
        }
    }
    
    // ========== ОЧИСТКА ==========
    
    /**
     * Уничтожает менеджер
     */
    destroy() {
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keypress', this.handleKeyPress);
        document.removeEventListener('paste', this.handlePaste);
        
        clearTimeout(this.scannerTimer);
        clearTimeout(this.quantityTimer);
        
        this.hideQuantityHint();
        
        console.log('[KeyboardManager] Destroyed');
    }
}

// Создаем и экспортируем синглтон
export const KeyboardManager = new KeyboardManagerClass();

// Для отладки
if (typeof window !== 'undefined') {
    window.KeyboardManager = KeyboardManager;
}

export default KeyboardManager;
