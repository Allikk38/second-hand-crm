// ========================================
// FILE: core/supabase-client.js
// ========================================

/**
 * Supabase Client — прямой импорт через ES-модули
 * 
 * Использует официальный SDK @supabase/supabase-js через CDN (ES модули).
 * Никаких прокси, обёрток и асинхронной загрузки через <script>.
 * 
 * @module supabase-client
 * @version 3.0.0
 * @changes
 * - v3.0.0: Полный переход на ES-модули. Удалены прокси и отложенная загрузка.
 * - v2.0.0: Старая версия с UMD-скриптом (удалена).
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';

/**
 * Единый экземпляр Supabase-клиента.
 * Создаётся сразу при импорте модуля.
 * 
 * @type {Object}
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('[Supabase] Client created (ES modules)');