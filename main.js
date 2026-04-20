/**
 * Second Hand CRM - Точка входа приложения
 * 
 * Архитектура:
 * - Модульная структура (core, services, modules, utils)
 * - Событийная связь через EventBus
 * - Права доступа через PermissionManager
 * - Аутентификация через Supabase
 * 
 * @module main
 * @version 1.0.0
 * @author Allik
 * @license MIT
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
 * Конфигурация страниц приложения
 * @constant {Object}
 */
const PAGES = {
    INVENTORY: 'inventory',
    CASHIER: 'cashier',
    REPORTS: 'reports'
};

/**
 * Заголовки страниц
 * @constant {Object}
 */
const PAGE_TITLES = {
    [PAGES.INVENTORY]: 'Склад',
    [PAGES.CASHIER]: 'Касса',
    [PAGES.REPORTS]: 'Отчеты'
};

/**
 * Корневой элемент приложения
 * @constant {HTMLElement}
 */
const root = document.getElementById('app-root');

/**
 * Текущая активная страница
 * @type {string}
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
 * 
 * @async
 * @returns {Promise<void>}
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
 * @returns {string|null} - Идентификатор страницы
 */
function getPageFromHash() {
    const hash = window.location.hash.slice(1);
    return Object.values(PAGES).includes(hash) ? hash : null;
}

/**
 * Устанавливает хэш страницы в URL
 * @param {string} page - Идентификатор страницы
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
 * Рендерит основной макет приложения (хедер, навигацию, контейнер для страниц)
 */
function renderAppLayout() {
    root.innerHTML = `
        <div class="app">
            <header class="app-header">
                <h1>Second Hand CRM</h1>
                <nav class="app-nav">
                    <button class="nav-btn" data-page="${PAGES.INVENTORY}">${PAGE_TITLES[PAGES.INVENTORY]}</button>
                    <button class="nav-btn" data-page="${PAGES.CASHIER}">${PAGE_TITLES[PAGES.CASHIER]}</button>
                    <button class="nav-btn" data-page="${PAGES.REPORTS}">${PAGE_TITLES[PAGES.REPORTS]}</button>
                    <button class="nav-btn nav-btn-logout" data-action="logout">Выход</button>
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
 * @async
 */
async function handleLogout() {
    await AuthManager.signOut();
    EventBus.emit('auth:logout');
}

// ========== PAGE MANAGEMENT ==========
/**
 * Отображает указанную страницу
 * @async
 * @param {string} page - Идентификатор страницы
 */
async function showPage(page) {
    const container = document.getElementById('page-container');
    if (!container) return;
    
    currentPage = page;
    updateActiveNavButton(page);
    
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
        EventBus.emit('app:error', error);
    }
}

/**
 * Обновляет активную кнопку в навигации
 * @param {string} page - Идентификатор текущей страницы
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
 * @async
 * @param {HTMLElement} container - Контейнер для страницы
 */
async function showInventoryPage(container) {
    const inventory = new InventoryPage(container);
    await inventory.mount();
}

/**
 * Отображает страницу кассы
 * @async
 * @param {HTMLElement} container - Контейнер для страницы
 */
async function showCashierPage(container) {
    const { CashierPage } = await import('./modules/cashier/CashierPage.js');
    const cashier = new CashierPage(container);
    await cashier.mount();
}

/**
 * Отображает страницу отчетов
 * @async
 * @param {HTMLElement} container - Контейнер для страницы
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
