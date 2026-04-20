import { BaseComponent } from '../../core/BaseComponent.js';
import { ShiftService } from '../../services/ShiftService.js';
import { AuthManager } from '../auth/AuthManager.js';

export class ShiftOpener extends BaseComponent {
    async render() {
        const user = AuthManager.getUser();
        const currentShift = await ShiftService.getCurrentShift(user.id);
        
        if (currentShift) {
            return `
                <div class="shift-status">
                    <span>🟢 Смена открыта (${new Date(currentShift.opened_at).toLocaleTimeString()})</span>
                </div>
            `;
        }
        
        return `
            <div class="shift-status">
                <span>🔴 Смена закрыта</span>
                <button data-action="open-shift">Открыть смену</button>
            </div>
        `;
    }

    attachEvents() {
        const btn = this.element.querySelector('[data-action="open-shift"]');
        if (btn) {
            btn.addEventListener('click', async () => {
                const user = AuthManager.getUser();
                await ShiftService.openShift(user.id);
                this.update();
            });
        }
        
        this.subscribe('shift:closed', () => this.update());
    }
}
