/**
 * Login Form Component
 * 
 * Форма входа в систему.
 * 
 * @module LoginForm
 * @version 2.0.0
 * @changes
 * - Использование CSS-классов вместо инлайн-стилей
 * - Добавлена валидация полей
 * - Добавлена индикация загрузки
 * - Улучшена обработка ошибок
 */

import { AuthManager } from './AuthManager.js';
import { EventBus } from '../../core/EventBus.js';

export class LoginForm {
    constructor(container) {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('LoginForm: container must be a valid HTMLElement');
        }
        this.container = container;
        this.isLoading = false;
        this.errorTimeout = null;
    }

    render() {
        this.container.innerHTML = `
            <div class="login-container">
                <div class="login-form">
                    <div class="login-header">
                        <h2>Вход в систему</h2>
                        <p class="login-subtitle">Second Hand CRM</p>
                    </div>
                    
                    <form id="login-form" data-ref="form">
                        <div class="form-group" data-ref="emailGroup">
                            <label for="email">Email</label>
                            <input 
                                type="email" 
                                id="email" 
                                name="email" 
                                class="login-input"
                                placeholder="user@example.com"
                                autocomplete="email"
                                required
                            >
                            <div class="validation-error" data-ref="emailError" style="display: none;"></div>
                        </div>
                        
                        <div class="form-group" data-ref="passwordGroup">
                            <label for="password">Пароль</label>
                            <input 
                                type="password" 
                                id="password" 
                                name="password" 
                                class="login-input"
                                placeholder="••••••••"
                                autocomplete="current-password"
                                required
                            >
                            <div class="validation-error" data-ref="passwordError" style="display: none;"></div>
                        </div>
                        
                        <div class="form-actions">
                            <button type="submit" class="btn-primary btn-block" data-ref="submitBtn" ${this.isLoading ? 'disabled' : ''}>
                                ${this.isLoading ? 'Вход...' : 'Войти'}
                            </button>
                        </div>
                        
                        <div class="error-message" data-ref="errorMessage" style="display: none;"></div>
                    </form>
                </div>
            </div>
        `;
        
        this.cacheRefs();
        this.attachEvents();
    }
    
    cacheRefs() {
        this.refs = {
            form: this.container.querySelector('#login-form'),
            email: this.container.querySelector('#email'),
            password: this.container.querySelector('#password'),
            submitBtn: this.container.querySelector('[data-ref="submitBtn"]'),
            errorMessage: this.container.querySelector('[data-ref="errorMessage"]'),
            emailError: this.container.querySelector('[data-ref="emailError"]'),
            passwordError: this.container.querySelector('[data-ref="passwordError"]'),
            emailGroup: this.container.querySelector('[data-ref="emailGroup"]'),
            passwordGroup: this.container.querySelector('[data-ref="passwordGroup"]')
        };
    }
    
    attachEvents() {
        this.refs.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit();
        });
        
        // Очистка ошибок при вводе
        this.refs.email.addEventListener('input', () => {
            this.clearFieldError('email');
        });
        
        this.refs.password.addEventListener('input', () => {
            this.clearFieldError('password');
        });
    }
    
    /**
     * Валидация формы
     * @returns {boolean}
     */
    validate() {
        let isValid = true;
        const email = this.refs.email.value.trim();
        const password = this.refs.password.value;
        
        // Валидация email
        if (!email) {
            this.showFieldError('email', 'Введите email');
            isValid = false;
        } else if (!this.isValidEmail(email)) {
            this.showFieldError('email', 'Введите корректный email');
            isValid = false;
        } else {
            this.clearFieldError('email');
        }
        
        // Валидация пароля
        if (!password) {
            this.showFieldError('password', 'Введите пароль');
            isValid = false;
        } else if (password.length < 6) {
            this.showFieldError('password', 'Пароль должен содержать не менее 6 символов');
            isValid = false;
        } else {
            this.clearFieldError('password');
        }
        
        return isValid;
    }
    
    /**
     * Проверка корректности email
     * @param {string} email
     * @returns {boolean}
     */
    isValidEmail(email) {
        const re = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
        return re.test(email);
    }
    
    /**
     * Показать ошибку поля
     * @param {string} field
     * @param {string} message
     */
    showFieldError(field, message) {
        const errorEl = this.refs[`${field}Error`];
        const groupEl = this.refs[`${field}Group`];
        
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
        if (groupEl) {
            groupEl.classList.add('has-error');
        }
    }
    
    /**
     * Очистить ошибку поля
     * @param {string} field
     */
    clearFieldError(field) {
        const errorEl = this.refs[`${field}Error`];
        const groupEl = this.refs[`${field}Group`];
        
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
        if (groupEl) {
            groupEl.classList.remove('has-error');
        }
    }
    
    /**
     * Показать общую ошибку
     * @param {string} message
     */
    showError(message) {
        if (this.errorTimeout) {
            clearTimeout(this.errorTimeout);
        }
        
        this.refs.errorMessage.textContent = message;
        this.refs.errorMessage.style.display = 'block';
        
        this.errorTimeout = setTimeout(() => {
            if (this.refs.errorMessage) {
                this.refs.errorMessage.style.display = 'none';
            }
        }, 5000);
    }
    
    /**
     * Очистить ошибки
     */
    clearErrors() {
        this.refs.errorMessage.style.display = 'none';
        this.refs.errorMessage.textContent = '';
        this.clearFieldError('email');
        this.clearFieldError('password');
    }
    
    /**
     * Установить состояние загрузки
     * @param {boolean} loading
     */
    setLoading(loading) {
        this.isLoading = loading;
        
        if (this.refs.submitBtn) {
            this.refs.submitBtn.disabled = loading;
            this.refs.submitBtn.textContent = loading ? 'Вход...' : 'Войти';
        }
    }
    
    /**
     * Обработчик отправки формы
     */
    async handleSubmit() {
        // Очищаем ошибки
        this.clearErrors();
        
        // Валидация
        if (!this.validate()) {
            return;
        }
        
        this.setLoading(true);
        
        try {
            const email = this.refs.email.value.trim();
            const password = this.refs.password.value;
            
            await AuthManager.signIn(email, password);
            
            EventBus.emit('auth:login');
            
            // Перенаправляем на склад
            window.location.hash = '/inventory';
            window.location.reload();
            
        } catch (error) {
            console.error('[LoginForm] Login error:', error);
            
            let errorMessage = 'Ошибка при входе в систему';
            
            if (error.message === 'Invalid login credentials') {
                errorMessage = 'Неверный email или пароль';
            } else if (error.message.includes('Email not confirmed')) {
                errorMessage = 'Email не подтвержден. Проверьте почту';
            } else {
                errorMessage = error.message || 'Ошибка при входе';
            }
            
            this.showError(errorMessage);
        } finally {
            this.setLoading(false);
        }
    }
    
    /**
     * Уничтожение формы
     */
    destroy() {
        if (this.errorTimeout) {
            clearTimeout(this.errorTimeout);
        }
        this.container.innerHTML = '';
    }
}
