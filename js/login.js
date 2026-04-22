/**
 * Login Page Module - MPA Edition
 * 
 * Логика страницы аутентификации. Управляет входом в систему.
 * 
 * Архитектурные решения:
 * - Полностью автономный модуль, не зависит от других страниц.
 * - Использует единый клиент из core/auth.js.
 * - Простые уведомления через единый компонент.
 * - Блокировка повторной отправки формы.
 * 
 * @module login
 * @version 3.2.0
 * @changes
 * - Убран импорт несуществующей getReturnUrl.
 * - Заменен alert() на кастомные уведомления.
 * - Добавлена проверка isOnline().
 * - Упрощена структура.
 */

import { signIn, isOnline } from '../core/auth.js';
import { isValidEmail, escapeHtml } from '../utils/formatters.js';

// ========== СОСТОЯНИЕ ==========

const state = {
    isLoading: false
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    loginForm: document.getElementById('loginForm'),
    emailInput: document.getElementById('email'),
    passwordInput: document.getElementById('password'),
    emailError: document.getElementById('emailError'),
    passwordError: document.getElementById('passwordError'),
    formError: document.getElementById('formError'),
    loginBtn: document.getElementById('loginBtn'),
    btnText: null,
    btnLoader: null,
    notificationContainer: document.getElementById('notificationContainer'),
    offlineBanner: document.getElementById('offlineBanner')
};

// ========== УВЕДОМЛЕНИЯ ==========

/**
 * Показывает уведомление
 * @param {string} message - Текст уведомления
 * @param {string} type - Тип (success, error, warning, info)
 */
function showNotification(message, type = 'info') {
    if (!DOM.notificationContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-icon"></div>
        <div class="notification-content">
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
        <button class="notification-close">×</button>
    `;
    
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.remove();
    });
    
    DOM.notificationContainer.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }
    }, 4000);
}

// ========== ВАЛИДАЦИЯ ==========

/**
 * Валидирует email
 * @returns {boolean} true если email корректен
 */
function validateEmail() {
    const email = DOM.emailInput?.value.trim() || '';
    let error = '';
    
    if (!email) {
        error = 'Email обязателен';
    } else if (!isValidEmail(email)) {
        error = 'Введите корректный email';
    }
    
    if (DOM.emailError) {
        DOM.emailError.textContent = error;
    }
    if (DOM.emailInput) {
        DOM.emailInput.classList.toggle('error', !!error);
    }
    
    return !error;
}

/**
 * Валидирует пароль
 * @returns {boolean} true если пароль корректен
 */
function validatePassword() {
    const password = DOM.passwordInput?.value || '';
    let error = '';
    
    if (!password) {
        error = 'Пароль обязателен';
    } else if (password.length < 6) {
        error = 'Пароль должен содержать не менее 6 символов';
    }
    
    if (DOM.passwordError) {
        DOM.passwordError.textContent = error;
    }
    if (DOM.passwordInput) {
        DOM.passwordInput.classList.toggle('error', !!error);
    }
    
    return !error;
}

/**
 * Показывает общую ошибку формы
 * @param {string} message - Сообщение об ошибке
 */
function showFormError(message) {
    if (DOM.formError) {
        DOM.formError.textContent = message;
        DOM.formError.classList.add('show');
        
        setTimeout(() => {
            DOM.formError.classList.remove('show');
        }, 5000);
    }
}

/**
 * Очищает все ошибки формы
 */
function clearErrors() {
    if (DOM.emailError) DOM.emailError.textContent = '';
    if (DOM.passwordError) DOM.passwordError.textContent = '';
    if (DOM.formError) DOM.formError.classList.remove('show');
    if (DOM.emailInput) DOM.emailInput.classList.remove('error');
    if (DOM.passwordInput) DOM.passwordInput.classList.remove('error');
}

// ========== УПРАВЛЕНИЕ ЗАГРУЗКОЙ ==========

/**
 * Устанавливает состояние загрузки кнопки
 * @param {boolean} loading - Состояние загрузки
 */
function setLoading(loading) {
    state.isLoading = loading;
    
    if (DOM.loginBtn) {
        DOM.loginBtn.disabled = loading;
    }
    
    if (DOM.btnText) {
        DOM.btnText.style.display = loading ? 'none' : 'inline';
    }
    
    if (DOM.btnLoader) {
        DOM.btnLoader.style.display = loading ? 'inline-flex' : 'none';
    }
}

// ========== ОБРАБОТЧИК ФОРМЫ ==========

/**
 * Обработчик отправки формы входа
 * @param {Event} e - Событие отправки
 */
async function handleLoginSubmit(e) {
    e.preventDefault();
    
    // Предотвращаем повторную отправку
    if (state.isLoading) return;
    
    // Очищаем предыдущие ошибки
    clearErrors();
    
    // Валидируем поля
    const isEmailValid = validateEmail();
    const isPasswordValid = validatePassword();
    
    if (!isEmailValid || !isPasswordValid) {
        return;
    }
    
    // Проверяем наличие сети
    if (!isOnline()) {
        showFormError('Нет подключения к интернету');
        showNotification('Проверьте подключение к интернету', 'warning');
        return;
    }
    
    const email = DOM.emailInput.value.trim();
    const password = DOM.passwordInput.value;
    
    // Показываем лоадер
    setLoading(true);
    
    try {
        const result = await signIn(email, password);
        
        if (result.success) {
            console.log('[Login] Login successful');
            showNotification('Вход выполнен успешно!', 'success');
            
            // Перенаправляем на страницу склада
            setTimeout(() => {
                window.location.href = 'inventory.html';
            }, 500);
        } else {
            showFormError(result.error || 'Ошибка входа');
            showNotification(result.error || 'Ошибка входа', 'error');
        }
    } catch (error) {
        console.error('[Login] Login error:', error);
        showFormError('Произошла ошибка при входе');
        showNotification('Произошла ошибка при входе', 'error');
    } finally {
        setLoading(false);
    }
}

// ========== ОФЛАЙН-РЕЖИМ ==========

/**
 * Проверяет статус сети и показывает/скрывает баннер
 */
function checkOfflineStatus() {
    if (!navigator.onLine && DOM.offlineBanner) {
        DOM.offlineBanner.classList.add('show');
    } else if (DOM.offlineBanner) {
        DOM.offlineBanner.classList.remove('show');
    }
}

/**
 * Привязывает события сети
 */
function attachNetworkEvents() {
    window.addEventListener('online', () => {
        checkOfflineStatus();
        showNotification('Соединение восстановлено', 'success');
    });
    
    window.addEventListener('offline', () => {
        checkOfflineStatus();
        showNotification('Нет подключения к интернету', 'warning');
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Кэширует элементы кнопки
 */
function cacheButtonElements() {
    if (DOM.loginBtn) {
        DOM.btnText = DOM.loginBtn.querySelector('.btn-text');
        DOM.btnLoader = DOM.loginBtn.querySelector('.btn-loader');
    }
}

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    if (DOM.loginForm) {
        DOM.loginForm.addEventListener('submit', handleLoginSubmit);
    }
    
    if (DOM.emailInput) {
        DOM.emailInput.addEventListener('input', validateEmail);
        DOM.emailInput.addEventListener('blur', validateEmail);
    }
    
    if (DOM.passwordInput) {
        DOM.passwordInput.addEventListener('input', validatePassword);
        DOM.passwordInput.addEventListener('blur', validatePassword);
    }
    
    attachNetworkEvents();
}

/**
 * Инициализация страницы входа
 */
function init() {
    console.log('[Login] Initializing MPA page...');
    
    cacheButtonElements();
    attachEvents();
    checkOfflineStatus();
    
    console.log('[Login] Initialized');
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
