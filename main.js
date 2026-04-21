/**
 * Second Hand CRM - Application Entry Point
 * 
 * Точка входа приложения. Управляет роутингом, рендерингом основного макета
 * и инициализацией модулей. Реализована строгая система прав доступа
 * и динамическая загрузка страниц (Code Splitting).
 * 
 * @module main
 * @version 3.1.0
 * @changes
 * - Добавлены SVG-иконки в навигацию
 * - Улучшена обработка ошибок при загрузке страниц
 * - Переработана структура рендеринга хедера
 */

// ========== IMPORTS (Core) ==========
import { SupabaseClient } from './core/SupabaseClient.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';

// ========== IMPORTS (Modules) ==========
import { AuthManager } from './modules/auth/AuthManager.js';
import { LoginForm } from './modules/auth/LoginForm.js';
import { InventoryPage } from './modules/inventory/InventoryPage.js';

// ========== CONSTANTS ==========
/**
 * Идентификаторы страниц
 */
const PAGES = {
    INVENTORY: 'inventory',
    CASHIER: 'cashier',
    REPORTS: 'reports'
};

/**
 * Заголовки страниц для навигации
 */
const PAGE_TITLES = {
    [PAGES.INVENTORY]: 'Склад',
    [PAGES.CASHIER]: 'Касса',
    [PAGES.REPORTS]: 'Отчеты'
};

/**
 * SVG-иконки для навигации (чистый, строгий контур)
 */
const PAGE_ICONS = {
    [PAGES.INVENTORY]: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
    `,
    [PAGES.CASHIER]: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="19" r="2"></circle>
            <circle cx="17" cy="19" r="2"></circle>
            <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 6.5"></path>
        </svg>
    `,
    [PAGES.REPORTS]: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2"></path>
            <circle cx="12" cy="16" r="5"></circle>
            <path d="M12 11v5"></path>
            <path d="M9 13h6"></path>
        </svg>
    `
};

/**
 * Корневой элемент приложения
 */
const root = document.getElementById('app-root');

/**
 * Текущая активная страница
 */
let currentPage = PAGES.INVENTORY;

// ========== EVENT BUS SETUP ==========
EventBus.on('app:error', (error) => {
    console.error('[App Error]:', error);
});

// ========== LIFECYCLE ==========
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

// ========== INITIALIZATION ==========
/**
 * Инициализация приложения
 * Проверяет сессию, загружает права, рендерит интерфейс
 */
async function initializeApp() {
    try {
        const user = await AuthManager.init();
        
        if (user) {
            await PermissionManager.loadUserPermissions(user.id);
            renderAppLayout();
            await showPage(getPageFromHash() || PAGES.INVENTORY);
        } else {
            showLoginPage();
        }
    } catch (error) {
        console.error('[Init Error]:', error);
        showLoginPage();
    }
}

// ========== ROUTING ==========
/**
 * Получает страницу из хэша URL
 */
function getPageFromHash() {
    const hash = window.location.hash.slice(1);
    return Object.values(PAGES).includes(hash) ? hash : null;
}

/**
 * Устанавливает хэш страницы в URL
 */
function setPageHash(page) {
    window.location.hash = page;
}

/**
 * Обработчик изменения хэша
 */
window.addEventListener('hashchange', async () => {
    const page = getPageFromHash();
    if (page && page !== currentPage) {
        await showPage(page);
    }
});

// ========== LAYOUT RENDERING ==========
/**
 * Рендерит основной макет приложения
 * Включает хедер, навигацию с SVG-иконками и контейнер для страниц
 */
function renderAppLayout() {
    root.innerHTML = `
        <div class="app">
            <header class="app-header">
                <h1 class="app-title">SH CRM</h1>
                <nav class="app-nav">
                    <button class="nav-btn" data-page="${PAGES.INVENTORY}">
                        <span class="nav-icon">${PAGE_ICONS[PAGES.INVENTORY]}</span>
                        <span class="nav-text">${PAGE_TITLES[PAGES.INVENTORY]}</span>
                    </button>
                    <button class="nav-btn" data-page="${PAGES.CASHIER}">
                        <span class="nav-icon">${PAGE_ICONS[PAGES.CASHIER]}</span>
                        <span class="nav-text">${PAGE_TITLES[PAGES.CASHIER]}</span>
                    </button>
                    <button class="nav-btn" data-page="${PAGES.REPORTS}">
                        <span class="nav-icon">${PAGE_ICONS[PAGES.REPORTS]}</span>
                        <span class="nav-text">${PAGE_TITLES[PAGES.REPORTS]}</span>
                    </button>
                    <button class="nav-btn nav-btn-logout" data-action="logout">
                        <span class="nav-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                <polyline points="16 17 21 12 16 7"></polyline>
                                <line x1="21" y1="12" x2="9" y2="12"></line>
                            </svg>
                        </span>
                        <span class="nav-text">Выход</span>
                    </button>
                </nav>
            </header>
            <main id="page-container" class="page-container"></main>
        </div>
    `;
    
    attachNavigationEvents();
}

/**
 * Привязывает события навигации
 */
function attachNavigationEvents() {
    // Навигация по страницам
    document.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = e.currentTarget.dataset.page;
            setPageHash(page);
        });
    });
    
    // Выход
    document.querySelector('[data-action="logout"]')?.addEventListener('click', handleLogout);
}

/**
 * Обработчик выхода из системы
 */
async function handleLogout() {
    await AuthManager.signOut();
    EventBus.emit('auth:logout');
}

// ========== PAGE MANAGEMENT ==========
/**
 * Отображает указанную страницу
 */
async function showPage(page) {
    const container = document.getElementById('page-container');
    if (!container) return;
    
    currentPage = page;
    updateActiveNavButton(page);
    
    // Очищаем контейнер и показываем скелетон загрузки
    container.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <span class="loading-text">Загрузка ${PAGE_TITLES[page]}</span>
        </div>
    `;
    
    try {
        switch (page) {
            case PAGES.INVENTORY:
                await showInventoryPage(container);
                break;
            case PAGES.CASHIER:
                await showCashierPage(container);
                break;
            case PAGES.REPORTS:
                await showReportsPage(container);
                break;
            default:
                await showInventoryPage(container);
        }
    } catch (error) {
        console.error(`[Page Error] Failed to load ${page}:`, error);
        
        // Показываем красивую ошибку вместо белого экрана
        container.innerHTML = `
            <div class="error-state" style="padding: 40px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;">⚠️</div>
                <h3 style="margin-bottom: 12px; color: var(--color-text);">Ошибка загрузки модуля</h3>
                <p style="color: var(--color-text-secondary); margin-bottom: 24px;">Не удалось загрузить страницу. Попробуйте обновить.</p>
                <button class="btn-primary" onclick="location.reload()">Обновить страницу</button>
            </div>
        `;
        
        EventBus.emit('app:error', error);
    }
}

/**
 * Обновляет активную кнопку в навигации
 */
function updateActiveNavButton(page) {
    document.querySelectorAll('[data-page]').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.page === page) {
            btn.classList.add('active');
        }
    });
}

/**
 * Отображает страницу склада
 */
async function showInventoryPage(container) {
    const inventory = new InventoryPage(container);
    await inventory.mount();
}

/**
 * Отображает страницу кассы (ленивая загрузка)
 */
async function showCashierPage(container) {
    const { CashierPage } = await import('./modules/cashier/CashierPage.js');
    const cashier = new CashierPage(container);
    await cashier.mount();
}

/**
 * Отображает страницу отчетов (ленивая загрузка)
 */
async function showReportsPage(container) {
    const { ReportsPage } = await import('./modules/reports/ReportsPage.js');
    const reports = new ReportsPage(container);
    await reports.mount();
}

// ========== AUTH PAGES ==========
/**
 * Отображает страницу входа
 */
function showLoginPage() {
    new LoginForm(root).render();
}

// ========== GLOBAL EVENTS ==========
EventBus.on('auth:logout', () => {
    window.location.hash = '';
    showLoginPage();
});

// ========== EXPORTS ==========
export { PAGES, PAGE_TITLES };
