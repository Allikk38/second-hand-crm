/**
 * App Layout - Main Layout Renderer
 * 
 * Отвечает за рендеринг основного макета приложения в стиле Excel/Google Sheets.
 * Хедер упрощен, навигация представлена в виде вкладок над контентной областью.
 * 
 * @module AppLayout
 * @version 3.2.0
 * @changes
 * - Полный редизайн: навигация в виде вкладок, интегрированных с контентом.
 * - Перемещение навигации из хедера в область над page-container.
 * - Упрощение хедера (только логотип/заголовок и кнопка выхода).
 */

import { AppState } from './AppState.js';
import { EventBus } from './EventBus.js';
import { Router } from './Router.js';

// ========== КОНСТАНТЫ ==========
const APP_TITLE = 'SH CRM';

const NAV_ITEMS = [
    {
        id: 'inventory',
        path: '/inventory',
        title: 'Склад',
        icon: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
        `
    },
    {
        id: 'cashier',
        path: '/cashier',
        title: 'Касса',
        icon: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="19" r="2"></circle>
                <circle cx="17" cy="19" r="2"></circle>
                <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 6.5"></path>
            </svg>
        `
    },
    {
        id: 'reports',
        path: '/reports',
        title: 'Отчеты',
        icon: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2"></path>
                <circle cx="12" cy="16" r="5"></circle>
                <path d="M12 11v5"></path>
                <path d="M9 13h6"></path>
            </svg>
        `
    }
];

const LOGOUT_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
    </svg>
`;

export class AppLayout {
    constructor(container) {
        this.container = container;
        this.unsubscribe = null;
    }
    
    /**
     * Рендерит основной макет приложения
     */
    render() {
        const currentPath = AppState.get('currentPage') || '/inventory';
        
        this.container.innerHTML = `
            <div class="app">
                <!-- Упрощенный хедер -->
                <header class="app-header">
                    <h1 class="app-title">${APP_TITLE}</h1>
                    <div class="header-actions">
                        <button class="btn-ghost btn-icon" data-action="logout" title="Выход">
                            <span class="nav-icon">${LOGOUT_ICON}</span>
                        </button>
                    </div>
                </header>
                
                <!-- Навигация в виде вкладок Excel -->
                <nav class="app-tabs">
                    ${NAV_ITEMS.map(item => this.renderTabItem(item, currentPath)).join('')}
                </nav>
                
                <!-- Контейнер для страниц -->
                <main id="page-container" class="page-container">
                    <div class="loading-overlay">
                        <div class="loading-spinner"></div>
                        <span class="loading-text">Загрузка...</span>
                    </div>
                </main>
            </div>
        `;
        
        this.attachEvents();
        this.subscribeToState();
    }
    
    /**
     * Рендерит один элемент навигации (вкладку)
     */
    renderTabItem(item, currentPath) {
        const isActive = currentPath === item.path;
        
        return `
            <button class="app-tab ${isActive ? 'active' : ''}" data-nav="${item.id}" data-path="${item.path}">
                <span class="tab-icon">${item.icon}</span>
                <span class="tab-text">${item.title}</span>
            </button>
        `;
    }
    
    /**
     * Привязывает события к элементам навигации
     */
    attachEvents() {
        // Навигация
        this.container.querySelectorAll('[data-nav]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.dataset.path;
                Router.navigate(path);
            });
        });
        
        // Выход
        this.container.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
            EventBus.emit('auth:logout');
        });
    }
    
    /**
     * Подписывается на изменения состояния для обновления активной вкладки
     */
    subscribeToState() {
        this.unsubscribe = AppState.subscribe('currentPage', (newPath) => {
            this.updateActiveTabItem(newPath);
        });
    }
    
    /**
     * Обновляет активную вкладку
     */
    updateActiveTabItem(currentPath) {
        this.container.querySelectorAll('[data-nav]').forEach(btn => {
            const path = btn.dataset.path;
            if (path === currentPath) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
    
    /**
     * Получает контейнер для страниц
     */
    getPageContainer() {
        return document.getElementById('page-container');
    }
    
    /**
     * Уничтожает layout и отписывается от событий
     */
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }
}
