// ========================================
// FILE: ./js/login.js
// ========================================

/**
 * Login Page Module
 * 
 * Логика страницы аутентификации. Управляет входом, регистрацией
 * и восстановлением сессии.
 * 
 * Архитектурные решения:
 * - Полностью автономный модуль, не зависит от других страниц.
 * - Использует единый клиент из core/supabase.js.
 * - Поддерживает возврат на исходную страницу после логина.
 * - Кастомные уведомления вместо alert().
 * - Валидация форм с понятными сообщениями.
 * 
 * @module login
 * @version 2.0.0
 * @changes
 * - Создан с нуля, логика вынесена из HTML.
 * - Добавлена валидация форм.
 * - Добавлена поддержка возврата на исходную страницу.
 * - Заменены alert() на кастомные уведомления.
 * - Добавлена обработка офлайн-режима.
 */

import { supabase } from '../core/supabase.js';
import { 
    checkAuth, 
    signIn, 
    signUp, 
    getReturnUrl, 
    saveReturnUrl,
    getUserProfile 
} from '../core/auth.js';
import { 
    escapeHtml, 
    isValidEmail, 
    isNotEmpty,
    formatMoney 
} from '../utils/formatters.js';

// ========== СОСТОЯНИЕ ==========

/**
 * Состояние страницы входа
 * @type {Object}
 */
const state = {
    isLoading: false,
    isRegisterModalOpen: false,
    errors: {
        email: '',
        password: '',
        registerName: '',
        registerEmail: '',
        registerPassword: '',
        form: ''
    }
};

// ========== DOM ЭЛЕМЕНТЫ ==========

const DOM = {
    // Форма входа
    loginForm: null,
    emailInput: null,
    passwordInput: null,
    emailError: null,
    passwordError: null,
    formError: null,
    loginBtn: null,
    btnText: null,
    btnLoader: null,
    
    // Кнопки
    showRegisterBtn: null,
    
    // Баннеры
    offlineBanner: null,
    
    // Контейнеры
    modalContainer: null,
    notificationContainer: null
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

/**
 * Инициализация страницы
 */
async function init() {
    console.log('[Login] Initializing login page...');
    
    // Кэшируем DOM элементы
    cacheElements();
    
    // Проверяем, не авторизован ли уже пользователь
    const user = await checkAuth();
    if (user) {
        console.log('[Login] User already authenticated, redirecting...');
        redirectToApp();
        return;
    }
    
    // Проверяем офлайн-режим
    checkOfflineStatus();
    
    // Привязываем события
    attachEvents();
    
    // Проверяем, есть ли демо-режим в URL
    checkDemoMode();
    
    console.log('[Login] Page initialized');
}

/**
 * Кэширует DOM элементы
 */
function cacheElements() {
    DOM.loginForm = document.getElementById('loginForm');
    DOM.emailInput = document.getElementById('email');
    DOM.passwordInput = document.getElementById('password');
    DOM.emailError = document.getElementById('emailError');
    DOM.passwordError = document.getElementById('passwordError');
    DOM.formError = document.getElementById('formError');
    DOM.loginBtn = document.getElementById('loginBtn');
    DOM.btnText = DOM.loginBtn?.querySelector('.btn-text');
    DOM.btnLoader = DOM.loginBtn?.querySelector('.btn-loader');
    DOM.showRegisterBtn = document.getElementById('showRegisterBtn');
    DOM.offlineBanner = document.getElementById('offlineBanner');
    DOM.modalContainer = document.getElementById('modalContainer');
    DOM.notificationContainer = document.getElementById('notificationContainer');
}

/**
 * Привязывает обработчики событий
 */
function attachEvents() {
    // Форма входа
    if (DOM.loginForm) {
        DOM.loginForm.addEventListener('submit', handleLoginSubmit);
    }
    
    // Кнопка регистрации
    if (DOM.showRegisterBtn) {
        DOM.showRegisterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openRegisterModal();
        });
    }
    
    // Валидация при вводе
    if (DOM.emailInput) {
        DOM.emailInput.addEventListener('input', () => {
            validateEmail();
        });
        DOM.emailInput.addEventListener('blur', validateEmail);
    }
    
    if (DOM.passwordInput) {
        DOM.passwordInput.addEventListener('input', () => {
            validatePassword();
        });
        DOM.passwordInput.addEventListener('blur', validatePassword);
    }
    
    // Отслеживание статуса сети
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
        showFormError('Нет подключения к интернету. Проверьте соединение.');
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
            
            // Получаем профиль пользователя
            await getUserProfile(result.user.id, { forceRefresh: true });
            
            showNotification('Вход выполнен успешно!', 'success');
            
            // Перенаправляем на исходную страницу
            redirectToApp();
        } else {
            showFormError(result.error || 'Ошибка входа');
        }
    } catch (error) {
        console.error('[Login] Login error:', error);
        showFormError('Произошла ошибка при входе. Попробуйте позже.');
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
        error = 'Введите корректный email адрес';
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

// ========== РЕГИСТРАЦИЯ ==========

/**
 * Открывает модальное окно регистрации
 */
function openRegisterModal() {
    if (!DOM.modalContainer) return;
    
    const modalHtml = `
        <div class="modal-overlay" id="registerModalOverlay">
            <div class="modal register-modal">
                <div class="modal-header">
                    <h3>Регистрация</h3>
                    <button class="btn-close" id="closeRegisterModal" aria-label="Закрыть">✕</button>
                </div>
                <div class="modal-body">
                    <form class="register-form" id="registerForm">
                        <div class="form-group">
                            <label for="regName">Имя *</label>
                            <input 
                                type="text" 
                                id="regName" 
                                name="name"
                                class="form-control" 
                                placeholder="Иван Петров"
                                autocomplete="name"
                            >
                            <div class="error-message" id="regNameError"></div>
                        </div>
                        
                        <div class="form-group">
                            <label for="regEmail">Email *</label>
                            <input 
                                type="email" 
                                id="regEmail" 
                                name="email"
                                class="form-control" 
                                placeholder="user@example.com"
                                autocomplete="email"
                            >
                            <div class="error-message" id="regEmailError"></div>
                        </div>
                        
                        <div class="form-group">
                            <label for="regPassword">Пароль *</label>
                            <input 
                                type="password" 
                                id="regPassword" 
                                name="password"
                                class="form-control" 
                                placeholder="Не менее 6 символов"
                                autocomplete="new-password"
                            >
                            <div class="error-message" id="regPasswordError"></div>
                        </div>
                        
                        <div class="form-error" id="regFormError"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cancelRegisterBtn">Отмена</button>
                    <button class="btn-primary" id="registerSubmitBtn">
                        <span class="btn-text">Зарегистрироваться</span>
                        <span class="btn-loader" style="display: none;">
                            <span class="loading-spinner small"></span>
                            Регистрация...
                        </span>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    DOM.modalContainer.innerHTML = modalHtml;
    
    // Привязываем события модального окна
    const overlay = document.getElementById('registerModalOverlay');
    const closeBtn = document.getElementById('closeRegisterModal');
    const cancelBtn = document.getElementById('cancelRegisterBtn');
    const submitBtn = document.getElementById('registerSubmitBtn');
    const form = document.getElementById('registerForm');
    
    const closeModal = () => {
        DOM.modalContainer.innerHTML = '';
    };
    
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    
    // Валидация полей регистрации
    const nameInput = document.getElementById('regName');
    const emailInput = document.getElementById('regEmail');
    const passwordInput = document.getElementById('regPassword');
    
    nameInput?.addEventListener('input', () => validateRegisterName());
    nameInput?.addEventListener('blur', validateRegisterName);
    emailInput?.addEventListener('input', () => validateRegisterEmail());
    emailInput?.addEventListener('blur', validateRegisterEmail);
    passwordInput?.addEventListener('input', () => validateRegisterPassword());
    passwordInput?.addEventListener('blur', validateRegisterPassword);
    
    // Отправка формы
    submitBtn?.addEventListener('click', handleRegisterSubmit);
    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        handleRegisterSubmit();
    });
    
    // Обработка Escape
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

/**
 * Обработчик отправки формы регистрации
 */
async function handleRegisterSubmit() {
    // Очищаем ошибки
    clearRegisterErrors();
    
    // Валидируем
    const isNameValid = validateRegisterName();
    const isEmailValid = validateRegisterEmail();
    const isPasswordValid = validateRegisterPassword();
    
    if (!isNameValid || !isEmailValid || !isPasswordValid) {
        return;
    }
    
    if (!navigator.onLine) {
        showRegisterFormError('Нет подключения к интернету');
        return;
    }
    
    const name = document.getElementById('regName')?.value.trim() || '';
    const email = document.getElementById('regEmail')?.value.trim() || '';
    const password = document.getElementById('regPassword')?.value || '';
    
    // Показываем лоадер
    const submitBtn = document.getElementById('registerSubmitBtn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const btnLoader = submitBtn?.querySelector('.btn-loader');
    
    if (btnText) btnText.style.display = 'none';
    if (btnLoader) btnLoader.style.display = 'inline-flex';
    if (submitBtn) submitBtn.disabled = true;
    
    try {
        const result = await signUp(email, password, { full_name: name });
        
        if (result.success) {
            showNotification('Регистрация успешна! Теперь вы можете войти.', 'success');
            
            // Закрываем модалку
            DOM.modalContainer.innerHTML = '';
            
            // Заполняем email в форме входа
            if (DOM.emailInput) {
                DOM.emailInput.value = email;
            }
        } else {
            showRegisterFormError(result.error || 'Ошибка регистрации');
        }
    } catch (error) {
        console.error('[Login] Register error:', error);
        showRegisterFormError('Произошла ошибка при регистрации');
    } finally {
        if (btnText) btnText.style.display = 'inline';
        if (btnLoader) btnLoader.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
    }
}

/**
 * Валидация имени при регистрации
 */
function validateRegisterName() {
    const input = document.getElementById('regName');
    const errorEl = document.getElementById('regNameError');
    const name = input?.value.trim() || '';
    
    let error = '';
    if (!name) {
        error = 'Имя обязательно';
    } else if (name.length < 2) {
        error = 'Имя должно содержать не менее 2 символов';
    }
    
    if (errorEl) {
        errorEl.textContent = error;
    }
    if (input) {
        input.classList.toggle('error', !!error);
    }
    
    return !error;
}

/**
 * Валидация email при регистрации
 */
function validateRegisterEmail() {
    const input = document.getElementById('regEmail');
    const errorEl = document.getElementById('regEmailError');
    const email = input?.value.trim() || '';
    
    let error = '';
    if (!email) {
        error = 'Email обязателен';
    } else if (!isValidEmail(email)) {
        error = 'Введите корректный email';
    }
    
    if (errorEl) {
        errorEl.textContent = error;
    }
    if (input) {
        input.classList.toggle('error', !!error);
    }
    
    return !error;
}

/**
 * Валидация пароля при регистрации
 */
function validateRegisterPassword() {
    const input = document.getElementById('regPassword');
    const errorEl = document.getElementById('regPasswordError');
    const password = input?.value || '';
    
    let error = '';
    if (!password) {
        error = 'Пароль обязателен';
    } else if (password.length < 6) {
        error = 'Пароль должен содержать не менее 6 символов';
    }
    
    if (errorEl) {
        errorEl.textContent = error;
    }
    if (input) {
        input.classList.toggle('error', !!error);
    }
    
    return !error;
}

// ========== УПРАВЛЕНИЕ ОШИБКАМИ ==========

/**
 * Показывает ошибку для конкретного поля
 * @param {string} field - Имя поля
 * @param {string} message - Сообщение об ошибке
 */
function showFieldError(field, message) {
    const input = document.getElementById(field);
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
 * @param {string} message - Сообщение об ошибке
 */
function showFormError(message) {
    if (DOM.formError) {
        DOM.formError.textContent = message;
        DOM.formError.classList.add('show');
    }
}

/**
 * Показывает ошибку формы регистрации
 * @param {string} message - Сообщение об ошибке
 */
function showRegisterFormError(message) {
    const errorEl = document.getElementById('regFormError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('show');
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

/**
 * Очищает ошибки регистрации
 */
function clearRegisterErrors() {
    ['regNameError', 'regEmailError', 'regPasswordError', 'regFormError'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            if (id === 'regFormError') el.classList.remove('show');
        }
    });
    
    ['regName', 'regEmail', 'regPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('error');
    });
}

// ========== УПРАВЛЕНИЕ ЗАГРУЗКОЙ ==========

/**
 * Устанавливает состояние загрузки
 * @param {boolean} loading - Идет ли загрузка
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
 * @param {string} message - Сообщение
 * @param {string} type - Тип (success, error, warning, info)
 */
function showNotification(message, type = 'info') {
    if (!DOM.notificationContainer) {
        // Fallback на alert если контейнера нет
        alert(message);
        return;
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-left: 3px solid;
        animation: slideIn 0.3s ease;
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

/**
 * Проверяет статус сети
 */
function checkOfflineStatus() {
    if (!navigator.onLine) {
        showOfflineBanner();
    }
}

/**
 * Показывает баннер офлайн-режима
 */
function showOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.classList.add('show');
    }
}

/**
 * Скрывает баннер офлайн-режима
 */
function hideOfflineBanner() {
    if (DOM.offlineBanner) {
        DOM.offlineBanner.classList.remove('show');
    }
}

// ========== НАВИГАЦИЯ ==========

/**
 * Перенаправляет в приложение
 */
function redirectToApp() {
    const returnUrl = getReturnUrl('/pages/inventory.html');
    console.log('[Login] Redirecting to:', returnUrl);
    
    // Небольшая задержка для отображения уведомления
    setTimeout(() => {
        window.location.href = returnUrl;
    }, 500);
}

// ========== ДЕМО-РЕЖИМ ==========

/**
 * Проверяет и включает демо-режим
 */
function checkDemoMode() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('demo')) {
        const demoCredentials = document.getElementById('demoCredentials');
        if (demoCredentials) {
            demoCredentials.style.display = 'block';
        }
        
        // Автозаполнение демо-доступа
        if (DOM.emailInput && DOM.passwordInput) {
            DOM.emailInput.value = 'demo@example.com';
            DOM.passwordInput.value = 'demo123';
        }
    }
}

// ========== ЗАПУСК ==========

// Запускаем инициализацию после загрузки DOM
document.addEventListener('DOMContentLoaded', init);

// Экспорт для возможного использования
export { init };
