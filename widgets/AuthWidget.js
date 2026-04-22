// ========================================
// FILE: ./widgets/AuthWidget.js
// ========================================

/**
 * Auth Widget - Виджет аутентификации
 * 
 * Управляет входом в систему, регистрацией и выходом.
 * Отображает форму входа или информацию о текущем пользователе.
 * 
 * Архитектурные решения:
 * - Наследуется от BaseWidget.
 * - Использует Supabase Auth напрямую.
 * - Публикует события AUTH.LOGIN_SUCCESS и AUTH.LOGOUT.
 * - Сохраняет сессию в localStorage.
 * 
 * @module AuthWidget
 * @version 1.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 */

import { BaseWidget } from '../core-new/BaseWidget.js';
import { EventTypes, EventSource } from '../core-new/EventBus.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ========== КОНФИГУРАЦИЯ SUPABASE ==========
const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

export class AuthWidget extends BaseWidget {
    constructor(container) {
        super(container);
        
        // Инициализируем Supabase клиент
        this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
        
        // Состояние виджета
        this.state = {
            user: null,
            isLoading: true,
            isAuthenticated: false,
            authMode: 'login', // 'login' или 'register'
            formData: {
                email: '',
                password: '',
                fullName: ''
            },
            errors: {},
            loginError: null
        };
        
        // Привязка методов
        this.handleInputChange = this.handleInputChange.bind(this);
    }

    // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
    
    async render() {
        const { isLoading, isAuthenticated, user, authMode, formData, errors, loginError } = this.state;
        
        if (isLoading) {
            return this.renderLoader();
        }
        
        if (isAuthenticated && user) {
            return this.renderUserInfo(user);
        }
        
        return this.renderAuthForm(authMode, formData, errors, loginError);
    }
    
    renderLoader() {
        return `
            <div class="auth-widget auth-loading">
                <div class="loading-spinner small"></div>
            </div>
        `;
    }
    
    renderUserInfo(user) {
        const userEmail = user.email || 'Пользователь';
        const userName = user.user_metadata?.full_name || userEmail.split('@')[0];
        
        return `
            <div class="auth-widget auth-user">
                <div class="user-info">
                    <div class="user-avatar">
                        ${userName.charAt(0).toUpperCase()}
                    </div>
                    <div class="user-details">
                        <span class="user-name">${this.escapeHtml(userName)}</span>
                        <span class="user-email">${this.escapeHtml(userEmail)}</span>
                    </div>
                </div>
                <button class="btn-ghost btn-sm logout-btn" data-ref="logoutBtn" title="Выйти">
                    🚪 Выход
                </button>
            </div>
        `;
    }
    
    renderAuthForm(mode, formData, errors, loginError) {
        const isLogin = mode === 'login';
        
        return `
            <div class="auth-widget auth-form">
                <div class="auth-header">
                    <h3>${isLogin ? 'Вход в систему' : 'Регистрация'}</h3>
                </div>
                
                <form class="auth-form-content" data-ref="authForm">
                    ${!isLogin ? `
                        <div class="form-group ${errors.fullName ? 'has-error' : ''}">
                            <label>Имя</label>
                            <input 
                                type="text" 
                                name="fullName"
                                data-ref="fullNameInput"
                                value="${this.escapeHtml(formData.fullName || '')}"
                                placeholder="Иван Петров"
                                autocomplete="name"
                            >
                            ${errors.fullName ? `<span class="error-text">${errors.fullName}</span>` : ''}
                        </div>
                    ` : ''}
                    
                    <div class="form-group ${errors.email ? 'has-error' : ''}">
                        <label>Email</label>
                        <input 
                            type="email" 
                            name="email"
                            data-ref="emailInput"
                            value="${this.escapeHtml(formData.email || '')}"
                            placeholder="user@example.com"
                            autocomplete="email"
                        >
                        ${errors.email ? `<span class="error-text">${errors.email}</span>` : ''}
                    </div>
                    
                    <div class="form-group ${errors.password ? 'has-error' : ''}">
                        <label>Пароль</label>
                        <input 
                            type="password" 
                            name="password"
                            data-ref="passwordInput"
                            value="${this.escapeHtml(formData.password || '')}"
                            placeholder="••••••••"
                            autocomplete="${isLogin ? 'current-password' : 'new-password'}"
                        >
                        ${errors.password ? `<span class="error-text">${errors.password}</span>` : ''}
                    </div>
                    
                    ${loginError ? `
                        <div class="auth-error">${this.escapeHtml(loginError)}</div>
                    ` : ''}
                    
                    <div class="form-actions">
                        <button type="submit" class="btn-primary btn-block" data-ref="submitBtn">
                            ${isLogin ? 'Войти' : 'Зарегистрироваться'}
                        </button>
                    </div>
                    
                    <div class="auth-footer">
                        ${isLogin ? `
                            <span>Нет аккаунта?</span>
                            <button type="button" class="btn-link" data-ref="switchToRegisterBtn">
                                Зарегистрироваться
                            </button>
                        ` : `
                            <span>Уже есть аккаунт?</span>
                            <button type="button" class="btn-link" data-ref="switchToLoginBtn">
                                Войти
                            </button>
                        `}
                    </div>
                </form>
            </div>
        `;
    }

    // ========== ПОСЛЕ РЕНДЕРА ==========
    
    async afterRender() {
        // Проверяем текущую сессию при монтировании
        await this.checkSession();
    }
    
    attachEvents() {
        // Форма входа/регистрации
        this.addDomListener('authForm', 'submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
        
        // Переключение режимов
        this.addDomListener('switchToRegisterBtn', 'click', () => {
            this.state.authMode = 'register';
            this.state.errors = {};
            this.state.loginError = null;
            this.update();
        });
        
        this.addDomListener('switchToLoginBtn', 'click', () => {
            this.state.authMode = 'login';
            this.state.errors = {};
            this.state.loginError = null;
            this.update();
        });
        
        // Выход
        this.addDomListener('logoutBtn', 'click', () => {
            this.handleLogout();
        });
        
        // Отслеживание изменений в полях ввода
        const form = this.refs.get('authForm');
        if (form) {
            form.addEventListener('input', this.handleInputChange);
        }
        
        // Подписка на события аутентификации от других виджетов
        this.subscribe(EventTypes.AUTH.LOGOUT, () => {
            this.handleLogout();
        });
    }
    
    // ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
    
    handleInputChange(e) {
        const { name, value } = e.target;
        this.state.formData[name] = value;
        
        // Очищаем ошибку поля при вводе
        if (this.state.errors[name]) {
            delete this.state.errors[name];
        }
    }
    
    async handleSubmit() {
        const { authMode, formData } = this.state;
        const errors = this.validateForm(formData, authMode);
        
        if (Object.keys(errors).length > 0) {
            this.state.errors = errors;
            this.update();
            return;
        }
        
        this.state.isLoading = true;
        this.state.loginError = null;
        this.update();
        
        try {
            if (authMode === 'login') {
                await this.signIn(formData.email, formData.password);
            } else {
                await this.signUp(formData.email, formData.password, formData.fullName);
            }
        } catch (error) {
            console.error('[AuthWidget] Auth error:', error);
            
            let errorMessage = 'Ошибка аутентификации';
            
            if (error.message.includes('Invalid login credentials')) {
                errorMessage = 'Неверный email или пароль';
            } else if (error.message.includes('User already registered')) {
                errorMessage = 'Пользователь с таким email уже существует';
            } else if (error.message.includes('Password should be')) {
                errorMessage = 'Пароль должен содержать не менее 6 символов';
            } else {
                errorMessage = error.message;
            }
            
            this.state.loginError = errorMessage;
            this.state.isLoading = false;
            this.update();
        }
    }
    
    async signIn(email, password) {
        const { data, error } = await this.supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        this.state.user = data.user;
        this.state.isAuthenticated = true;
        this.state.isLoading = false;
        this.state.formData = { email: '', password: '', fullName: '' };
        
        this.update();
        
        // Публикуем событие успешного входа
        this.publish(EventTypes.AUTH.LOGIN_SUCCESS, {
            user: data.user,
            session: data.session
        });
        
        this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
            type: 'success',
            message: `Добро пожаловать, ${data.user.email}!`
        });
        
        console.log('[AuthWidget] User signed in:', data.user.email);
    }
    
    async signUp(email, password, fullName) {
        const { data, error } = await this.supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName
                }
            }
        });
        
        if (error) throw error;
        
        if (data.user) {
            // Создаем профиль в таблице profiles
            await this.createProfile(data.user.id, fullName, email);
            
            this.state.user = data.user;
            this.state.isAuthenticated = true;
            this.state.isLoading = false;
            this.state.formData = { email: '', password: '', fullName: '' };
            
            this.update();
            
            this.publish(EventTypes.AUTH.LOGIN_SUCCESS, {
                user: data.user,
                session: data.session
            });
            
            this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
                type: 'success',
                message: 'Регистрация успешна!'
            });
            
            console.log('[AuthWidget] User registered:', data.user.email);
        }
    }
    
    async createProfile(userId, fullName, email) {
        try {
            const { error } = await this.supabase
                .from('profiles')
                .insert({
                    id: userId,
                    full_name: fullName,
                    email: email,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            
            if (error) {
                console.warn('[AuthWidget] Failed to create profile:', error);
            }
        } catch (error) {
            console.warn('[AuthWidget] Profile creation error:', error);
        }
    }
    
    async handleLogout() {
        try {
            await this.supabase.auth.signOut();
            
            this.state.user = null;
            this.state.isAuthenticated = false;
            this.state.isLoading = false;
            
            this.update();
            
            this.publish(EventTypes.AUTH.LOGOUT, {
                timestamp: Date.now()
            });
            
            this.publish(EventTypes.UI.NOTIFICATION_SHOW, {
                type: 'info',
                message: 'Вы вышли из системы'
            });
            
            console.log('[AuthWidget] User signed out');
            
        } catch (error) {
            console.error('[AuthWidget] Logout error:', error);
        }
    }
    
    async checkSession() {
        try {
            const { data: { session }, error } = await this.supabase.auth.getSession();
            
            if (error) throw error;
            
            if (session?.user) {
                this.state.user = session.user;
                this.state.isAuthenticated = true;
                
                this.publish(EventTypes.AUTH.LOGIN_SUCCESS, {
                    user: session.user,
                    session
                });
                
                console.log('[AuthWidget] Session restored:', session.user.email);
            }
            
            this.state.isLoading = false;
            this.update();
            
        } catch (error) {
            console.error('[AuthWidget] Session check error:', error);
            this.state.isLoading = false;
            this.update();
        }
    }
    
    // ========== ВАЛИДАЦИЯ ==========
    
    validateForm(data, mode) {
        const errors = {};
        
        // Email
        if (!data.email) {
            errors.email = 'Email обязателен';
        } else if (!this.isValidEmail(data.email)) {
            errors.email = 'Некорректный email';
        }
        
        // Пароль
        if (!data.password) {
            errors.password = 'Пароль обязателен';
        } else if (data.password.length < 6) {
            errors.password = 'Пароль должен содержать не менее 6 символов';
        }
        
        // Имя (только для регистрации)
        if (mode === 'register' && !data.fullName) {
            errors.fullName = 'Имя обязательно';
        }
        
        return errors;
    }
    
    isValidEmail(email) {
        const re = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
        return re.test(email);
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    /**
     * Получить текущего пользователя.
     * @returns {Object|null}
     */
    getUser() {
        return this.state.user ? { ...this.state.user } : null;
    }
    
    /**
     * Получить ID текущего пользователя.
     * @returns {string|null}
     */
    getUserId() {
        return this.state.user?.id || null;
    }
    
    /**
     * Проверить, аутентифицирован ли пользователь.
     * @returns {boolean}
     */
    isAuthenticated() {
        return this.state.isAuthenticated;
    }
    
    // ========== ОЧИСТКА ==========
    
    beforeDestroy() {
        const form = this.refs.get('authForm');
        if (form) {
            form.removeEventListener('input', this.handleInputChange);
        }
        
        console.log('[AuthWidget] Cleaned up');
    }
}

export default AuthWidget;
