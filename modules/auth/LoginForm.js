import { AuthManager } from './AuthManager.js';
import { EventBus } from '../../core/EventBus.js';

export class LoginForm {
    constructor(container) {
        this.container = container;
    }

    render() {
        this.container.innerHTML = `
            <div class="login-form">
                <h2>Вход</h2>
                <form id="login-form">
                    <input type="email" id="email" placeholder="Email" required>
                    <input type="password" id="password" placeholder="Пароль" required>
                    <button type="submit">Войти</button>
                </form>
                <p id="error-message" style="color:red"></p>
            </div>
        `;
        
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                await AuthManager.signIn(email, password);
                EventBus.emit('auth:login');
                window.location.reload();
            } catch (error) {
                document.getElementById('error-message').textContent = error.message;
            }
        });
    }
}
