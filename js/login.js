/**
 * Login Page Module
 * 
 * Логика страницы аутентификации. Управляет входом в систему.
 * 
 * Архитектурные решения:
 * - Полностью автономный модуль, не зависит от других страниц.
 * - Использует единый клиент из core/supabase.js.
 * - Поддерживает возврат на исходную страницу после логина.
 * - Простые уведомления вместо сложных модалок.
 * 
 * @module login
 * @version 3.0.0
 * @changes
 * - Полный рефакторинг: удалена регистрация, упрощена логика.
 * - Исправлены импорты в соответствии с новым auth.js.
 * - Добавлены кастомные уведомления.
 */

import { signIn, getReturnUrl } from '../core/auth.js';
import { isValidEmail } from '../utils/formatters.js';

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

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы
 */
function init() {
    console.log('[Login] Initializing...');
    
    // Кэшируем элементы кнопки
    if (DOM.loginBtn) {
        DOM.btnText = DOM.loginBtn.querySelector('.btn-text');
        DOM.btnLoader = DOM.loginBtn.querySelector('.btn-loader');
    }
    
    // Проверяем офлайн-режим
    checkOfflineStatus();
    
    // Привязываем события
    attachEvents();
    
    console.log('[Login] Initialized');
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
    
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showNotification('Соединение восстановлено', 'success');
    });
    
    window.addEventListener('offline', () => {
        showOfflineBanner();
        showNotification('Нет подключения к интернету', 'warning');
    });
}

// ========== ОБРАБОТЧИКИ ФОРМ ==========

/**
 * Обработчик отправки формы входа
 * @param {Event} e - Событие отправки
 */
async function handleLoginSubmit(e) {
    e.preventDefault();
    
    // Очищаем предыдущие ошибки
    clearErrors();
    
    // Валидируем поля
    const isEmailValid = validateEmail();
    const isPasswordValid = validatePassword();
    
    if (!isEmailValid || !isPasswordValid) {
        return;
    }
    
    // Проверяем наличие сети
    if (!navigator.onLine) {
        showFormError('Нет подключения к интернету');
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
            
            // Перенаправляем на исходную страницу
            const returnUrl = getReturnUrl('/pages/inventory.html');
            setTimeout(() => {
                window.location.href = returnUrl;
            }, 500);
        } else {
            showFormError(result.error || 'Ошибка входа');
        }
    } catch (error) {
        console.error('[Login] Login error:', error);
        showFormError('Произошла ошибка при входе');
    } finally {
        setLoading(false);
    }
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
    
    showFieldError('email', error);
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
    
    showFieldError('password', error);
    return !error;
}

// ========== УПРАВЛЕНИЕ ОШИБКАМИ ==========

/**
 * Показывает ошибку для конкретного поля
 */
function showFieldError(field, message) {
    const input = field === 'email' ? DOM.emailInput : DOM.passwordInput;
    const errorEl = field === 'email' ? DOM.emailError : DOM.passwordError;
    
    if (errorEl) {
        errorEl.textContent = message;
    }
    if (input) {
        input.classList.toggle('error', !!message);
    }
}

/**
 * Показывает общую ошибку формы
 */
function showFormError(message) {
    if (DOM.formError) {
        DOM.formError.textContent = message;
        DOM.formError.classList.add('show');
    }
}

/**
 * Очищает все ошибки
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
 * Устанавливает состояние загрузки
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

// ========== УВЕДОМЛЕНИЯ ==========

/**
 * Показывает уведомление
 */
function showNotification(message, type = 'info') {
    if (!DOM.notificationContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-left: 3px solid;
    `;
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    notification.style.borderLeftColor = colors[type] || colors.info;
    notification.textContent = message;
    
    DOM.notificationContainer.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// ========== ОФЛАЙН-РЕЖИМ ==========

function checkOfflineStatus() {
    if (!navigator.onLine) {
        showOfflineBanner();
    }
}

function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.classList.add('show');
    }
}

function hideOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.classList.remove('show');
    }
}

// ========== ЗАПУСК ==========

document.addEventListener('DOMContentLoaded', init);

export { init };
