import { SupabaseClient } from './SupabaseClient.js';
import { EventBus } from './EventBus.js';

class PermissionManagerClass {
    constructor() {
        this.permissions = new Set();
        this.loaded = false;
    }

    async loadUserPermissions(userId) {
        const { data: profile } = await SupabaseClient
            .from('profiles')
            .select('role_id')
            .eq('id', userId)
            .single();

        if (!profile) return;

        const { data: perms } = await SupabaseClient
            .from('role_permissions')
            .select(`
                permission_id,
                permissions!inner(slug)
            `)
            .eq('role_id', profile.role_id);

        this.permissions.clear();
        perms?.forEach(p => this.permissions.add(p.permissions.slug));
        this.loaded = true;
        
        EventBus.emit('permissions:loaded');
    }

    can(slug) {
        return this.loaded && this.permissions.has(slug);
    }
    
    getAll() {
        return Array.from(this.permissions);
    }

    clear() {
        this.permissions.clear();
        this.loaded = false;
    }
}

export const PermissionManager = new PermissionManagerClass();
