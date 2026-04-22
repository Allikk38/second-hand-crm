// ========================================
// FILE: ./core/supabase.js
// ========================================

/**
 * Supabase Client - Единый клиент для всего приложения
 * 
 * @module supabase
 * @version 1.0.0
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// Создаем ОДИН клиент на всё приложение
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    },
    db: {
        schema: 'public'
    }
});

// Экспортируем для удобства
export default supabase;
