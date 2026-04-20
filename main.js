import { SupabaseClient } from './core/SupabaseClient.js';
import { EventBus } from './core/EventBus.js';
import { PermissionManager } from './core/PermissionManager.js';
import { AuthManager } from './modules/auth/AuthManager.js';

console.log('Second Hand CRM загружен');

EventBus.on('app:error', (err) => console.error('Ошибка:', err));

document.addEventListener('DOMContentLoaded', async () => {
    const user = await AuthManager.init();
    
    if (user) {
        await PermissionManager.loadUserPermissions(user.id);
        console.log('Пользователь авторизован:', user.email);
    } else {
        console.log('Не авторизован');
    }
});
