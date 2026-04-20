import { SupabaseClient } from './core/SupabaseClient.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';
import { AuthManager } from './modules/auth/AuthManager.js';
import { LoginForm } from './modules/auth/LoginForm.js';

const root = document.getElementById('app-root');

EventBus.on('app:error', (err) => console.error('Ошибка:', err));

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AuthManager.init();
    
    if (user) {
        await PermissionManager.loadUserPermissions(user.id);
        root.innerHTML = `<h2>Добро пожаловать, ${user.email}</h2>`;
    } else {
        new LoginForm(root).render();
    }
});
