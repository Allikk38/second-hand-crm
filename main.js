import { SupabaseClient } from './core/SupabaseClient.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';
import { AuthManager } from './modules/auth/AuthManager.js';
import { LoginForm } from './modules/auth/LoginForm.js';
import { InventoryPage } from './modules/inventory/InventoryPage.js';

const root = document.getElementById('app-root');

EventBus.on('app:error', (err) => console.error('Ошибка:', err));

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AuthManager.init();
    
    if (user) {
        await PermissionManager.loadUserPermissions(user.id);
        const inventory = new InventoryPage(root);
        await inventory.mount();
    } else {
        new LoginForm(root).render();
    }
});

EventBus.on('auth:logout', () => {
    new LoginForm(root).render();
});
