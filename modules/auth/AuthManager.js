import { SupabaseClient } from '../../core/SupabaseClient.js';
import { PermissionManager } from '../../core/PermissionManager.js';

export const AuthManager = {
    user: null,
    
    async init() {
        const { data } = await SupabaseClient.auth.getSession();
        this.user = data?.session?.user || null;
        return this.user;
    },
    
    async signUp(email, password, fullName) {
        const { data, error } = await SupabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: fullName }
            }
        });
        if (error) throw error;
        return data;
    },
    
    async signIn(email, password) {
        const { data, error } = await SupabaseClient.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        this.user = data.user;
        await PermissionManager.loadUserPermissions(data.user.id);
        return data;
    },
    
    async signOut() {
        await SupabaseClient.auth.signOut();
        this.user = null;
        PermissionManager.clear();
    },
    
    getUser() {
        return this.user;
    }
};
