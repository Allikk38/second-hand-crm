import { SupabaseClient } from './core/SupabaseClient.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';
import { AuthManager } from './modules/auth/AuthManager.js';
import { LoginForm } from './modules/auth/LoginForm.js';
import { InventoryPage } from './modules/inventory/InventoryPage.js';
import { CashierPage } from './modules/cashier/CashierPage.js';

const root = document.getElementById('app-root');

EventBus.on('app:error', (err) => console.error('Ошибка:', err));

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AuthManager.init();
    
    if (user) {
        await PermissionManager.loadUserPermissions(user.id);
        renderApp();
    } else {
        new LoginForm(root).render();
    }
});

function renderApp() {
    root.innerHTML = `
        <div class="app">
            <header>
                <h1>Second Hand CRM</h1>
                <nav>
                    <button data-page="inventory">Склад</button>
                    <button data-page="cashier">Касса</button>
                    <button data-page="reports">Отчеты</button>
                    <button data-action="logout">Выход</button>
                </nav>
            </header>
            <main id="page-container"></main>
        </div>
    `;
    
    document.querySelector('[data-page="inventory"]').addEventListener('click', () => showPage('inventory'));
    document.querySelector('[data-page="cashier"]').addEventListener('click', () => showPage('cashier'));
    document.querySelector('[data-action="logout"]').addEventListener('click', async () => {
        await AuthManager.signOut();
        EventBus.emit('auth:logout');
    });
    
    showPage('inventory');
}

async function showPage(page) {
    const container = document.getElementById('page-container');
    
    if (page === 'inventory') {
        const inventory = new InventoryPage(container);
        await inventory.mount();
    }
    
    if (page === 'cashier') {
        const { CashierPage } = await import('./modules/cashier/CashierPage.js');
        const cashier = new CashierPage(container);
        await cashier.mount();
    }
    
    if (page === 'reports') {
        const { ReportsPage } = await import('./modules/reports/ReportsPage.js');
        const reports = new ReportsPage(container);
        await reports.mount();
    }
}

EventBus.on('auth:logout', () => {
    new LoginForm(root).render();
});
