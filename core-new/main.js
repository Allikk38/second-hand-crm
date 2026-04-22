// ========================================
// FILE: ./core-new/main.js
// ========================================

/**
 * Second Hand CRM 2.0 - Точка входа
 * 
 * Новая архитектура на основе изолированных виджетов и событийной шины.
 * Минималистичный вход: только инициализация ядра и запуск оболочки.
 * 
 * Архитектурные решения:
 * - Полная изоляция от старого кода.
 * - Ленивая загрузка всех модулей.
 * - Единая точка конфигурации приложения.
 * - Обработка критических ошибок с понятным UI.
 * 
 * @module main
 * @version 2.0.0
 * @changes
 * - Создан с нуля для новой архитектуры.
 * - Убрана прямая зависимость от Supabase в точке входа.
 * - Добавлен глобальный Error Boundary.
 */

import { AppShell } from './AppShell.js';
import { EventBus, EventTypes, EventSource } from './EventBus.js';
import { supabaseAdapter } from './SupabaseAdapter.js';

// ========== КОНФИГУРАЦИЯ ПРИЛОЖЕНИЯ ==========

const APP_CONFIG = {
    name: 'SH CRM 2.0',
    version: '2.0.0',
    environment: window.location.hostname === 'localhost' ? 'development' : 'production',
    debug: window.location.hostname === 'localhost'
};

// ========== ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК ==========

/**
 * Показывает критическую ошибку, если не удалось инициализировать приложение.
 */
function showCriticalError(error) {
    const root = document.getElementById('app-root');
    if (!root) return;
    
    root.innerHTML = `
        <div class="critical-error">
            <div class="error-icon">🔥</div>
            <h2>Критическая ошибка</h2>
            <p>Не удалось запустить приложение. Попробуйте обновить страницу.</p>
            <details>
                <summary>Техническая информация</summary>
                <pre>${escapeHtml(error.message)}\n\n${escapeHtml(error.stack || '')}</pre>
            </details>
            <div class="actions">
                <button class="btn-primary" onclick="window.location.reload()">🔄 Обновить</button>
                <button class="btn-secondary" onclick="localStorage.clear();window.location.reload()">🧹 Очистить кэш</button>
            </div>
            <p class="hint">Если ошибка повторяется, обратитесь в поддержку.</p>
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ========== ОСНОВНОЙ КЛАСС ПРИЛОЖЕНИЯ ==========

class Application {
    constructor() {
        /** @type {HTMLElement} */
        this.root = document.getElementById('app-root');
        
        /** @type {AppShell|null} */
        this.shell = null;
        
        /** @type {boolean} */
        this.initialized = false;
        
        // Привязка методов
        this.handleCriticalError = this.handleCriticalError.bind(this);
    }
    
    /**
     * Запуск приложения.
     */
    async start() {
        if (this.initialized) {
            console.warn('[App] Already initialized');
            return;
        }
        
        console.log(`[App] Starting ${APP_CONFIG.name} v${APP_CONFIG.version}...`);
        console.log(`[App] Environment: ${APP_CONFIG.environment}`);
        
        // Скрываем начальный лоадер (если есть)
        this.hideInitialLoader();
        
        // Включаем режим отладки EventBus в development
        EventBus.setDebug(APP_CONFIG.debug);
        
        // Подписываемся на критические ошибки
        EventBus.on(EventTypes.SYSTEM.ERROR, this.handleCriticalError);
        
        try {
            // 1. Инициализируем адаптер данных
            console.log('[App] Initializing SupabaseAdapter...');
            await supabaseAdapter.init();
            
            // 2. Создаем и запускаем оболочку
            console.log('[App] Creating AppShell...');
            this.shell = new AppShell(this.root);
            await this.shell.init();
            
            this.initialized = true;
            
            console.log('[App] ✅ Application started successfully');
            
            // Сообщаем системе о готовности
            EventBus.emit(EventTypes.SYSTEM.APP_READY, {
                name: APP_CONFIG.name,
                version: APP_CONFIG.version,
                timestamp: Date.now()
            }, EventSource.KERNEL);
            
            // Показываем приветственное уведомление (опционально)
            this.showWelcomeMessage();
            
        } catch (error) {
            console.error('[App] ❌ Failed to start:', error);
            showCriticalError(error);
            throw error;
        }
    }
    
    /**
     * Скрывает начальный лоадер.
     */
    hideInitialLoader() {
        const loader = document.getElementById('initial-loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.display = 'none';
            }, 300);
        }
    }
    
    /**
     * Показывает приветственное сообщение.
     */
    showWelcomeMessage() {
        // Отправляем событие для виджета уведомлений
        setTimeout(() => {
            EventBus.emit(EventTypes.UI.NOTIFICATION_SHOW, {
                type: 'info',
                title: 'Добро пожаловать!',
                message: `${APP_CONFIG.name} готов к работе`,
                duration: 3000
            }, EventSource.KERNEL);
        }, 500);
    }
    
    /**
     * Обработчик критических ошибок из EventBus.
     */
    handleCriticalError(data) {
        const { source, error, operation } = data;
        
        console.error(`[App] Critical error from ${source}:`, error);
        
        // Игнорируем ошибки, которые уже обработаны виджетами
        if (source === EventSource.KERNEL) {
            // Это ошибка уровня ядра — показываем пользователю
            EventBus.emit(EventTypes.UI.NOTIFICATION_SHOW, {
                type: 'error',
                title: 'Системная ошибка',
                message: operation ? `Операция "${operation}" не выполнена` : 'Произошла ошибка',
                duration: 5000
            }, EventSource.KERNEL);
        }
    }
    
    /**
     * Остановка приложения (используется при горячей перезагрузке в dev).
     */
    async stop() {
        console.log('[App] Stopping...');
        
        if (this.shell) {
            await this.shell.destroy();
            this.shell = null;
        }
        
        supabaseAdapter.destroy();
        
        EventBus.off(EventTypes.SYSTEM.ERROR, this.handleCriticalError);
        
        this.initialized = false;
        
        console.log('[App] 💀 Stopped');
    }
}

// ========== ЗАПУСК ПРИ ЗАГРУЗКЕ DOM ==========

const app = new Application();

// Ждем загрузку DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        app.start().catch(error => {
            console.error('[App] Failed to start after DOMContentLoaded:', error);
        });
    });
} else {
    // DOM уже загружен
    app.start().catch(error => {
        console.error('[App] Failed to start (DOM already loaded):', error);
    });
}

// ========== ЭКСПОРТ ДЛЯ ОТЛАДКИ ==========

// Делаем приложение доступным в консоли браузера для отладки
if (APP_CONFIG.debug) {
    window.__APP = {
        config: APP_CONFIG,
        instance: app,
        eventBus: EventBus,
        adapter: supabaseAdapter,
        
        // Утилиты для отладки
        getState: () => {
            console.log('App Shell:', app.shell);
            console.log('Widgets:', app.shell?.widgets);
            console.log('EventBus listeners:', EventBus.listeners);
        },
        
        // Принудительная остановка и перезапуск
        restart: async () => {
            await app.stop();
            await app.start();
        }
    };
    
    console.log('[App] Debug mode enabled. Use window.__APP to inspect.');
}

// ========== ГЛОБАЛЬНЫЕ СТИЛИ ДЛЯ КРИТИЧЕСКОЙ ОШИБКИ ==========

// Добавляем стили динамически, чтобы не зависеть от загрузки CSS
const style = document.createElement('style');
style.textContent = `
    .critical-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 40px;
        text-align: center;
        font-family: system-ui, -apple-system, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
    }
    
    .critical-error .error-icon {
        font-size: 80px;
        margin-bottom: 20px;
        filter: drop-shadow(0 4px 6px rgba(0,0,0,0.2));
    }
    
    .critical-error h2 {
        font-size: 28px;
        margin-bottom: 16px;
        font-weight: 600;
    }
    
    .critical-error p {
        font-size: 16px;
        margin-bottom: 24px;
        opacity: 0.9;
    }
    
    .critical-error details {
        margin-bottom: 24px;
        text-align: left;
        background: rgba(0,0,0,0.1);
        padding: 16px;
        border-radius: 8px;
        max-width: 600px;
        width: 100%;
    }
    
    .critical-error summary {
        cursor: pointer;
        font-weight: 500;
        margin-bottom: 12px;
    }
    
    .critical-error pre {
        background: rgba(0,0,0,0.3);
        padding: 12px;
        border-radius: 4px;
        overflow-x: auto;
        font-size: 12px;
        margin: 0;
    }
    
    .critical-error .actions {
        display: flex;
        gap: 12px;
        margin-bottom: 20px;
    }
    
    .critical-error .btn-primary,
    .critical-error .btn-secondary {
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .critical-error .btn-primary {
        background: white;
        color: #667eea;
    }
    
    .critical-error .btn-secondary {
        background: rgba(255,255,255,0.2);
        color: white;
        backdrop-filter: blur(10px);
    }
    
    .critical-error .btn-primary:hover,
    .critical-error .btn-secondary:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    
    .critical-error .hint {
        font-size: 13px;
        opacity: 0.6;
    }
    
    /* Стили для загрузчика виджета */
    .widget-loader {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px;
        color: #6b7280;
    }
    
    .loader-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #e5e7eb;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 16px;
    }
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    
    /* Стили для ошибки виджета */
    .widget-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px;
        text-align: center;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 12px;
        margin: 20px;
    }
    
    .widget-error .error-icon {
        font-size: 48px;
        margin-bottom: 16px;
    }
    
    .widget-error h4 {
        font-size: 18px;
        font-weight: 600;
        color: #991b1b;
        margin-bottom: 8px;
    }
    
    .widget-error p {
        color: #7f1d1d;
        margin-bottom: 16px;
    }
    
    .widget-error .retry-btn {
        padding: 8px 16px;
        background: #dc2626;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
    }
    
    .widget-error .retry-btn:hover {
        background: #b91c1c;
    }
`;
document.head.appendChild(style);

export { Application, app };
export default app;
