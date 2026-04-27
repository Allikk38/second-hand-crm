// ========================================
// FILE: core/supabase-client.js
// ========================================

/**
 * Supabase Client — обёртка над официальным SDK
 * 
 * Загружает @supabase/supabase-js через CDN и создаёт клиент.
 * Больше никакой самописной реализации HTTP-запросов.
 * 
 * @module supabase-client
 * @version 2.0.0
 */

const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZHduaWl5cnJ1amVvdWJydmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzM2MTYsImV4cCI6MjA5MjIwOTYxNn0.-EilGBYgNNRraTjEqilYuvk-Pfy_Mf5TNEtS1NrU2WM';

let supabaseClient = null;
let initPromise = null;

/**
 * Загружает официальный Supabase SDK через CDN
 * @returns {Promise<void>}
 */
async function loadSDK() {
    if (window.supabase && window.supabase.createClient) {
        return;
    }
    
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        script.onload = () => {
            console.log('[Supabase] Official SDK loaded');
            resolve();
        };
        script.onerror = () => reject(new Error('Не удалось загрузить Supabase SDK. Проверьте подключение к интернету.'));
        document.head.appendChild(script);
    });
}

/**
 * Создаёт и возвращает клиент Supabase.
 * При первом вызове загружает SDK.
 * 
 * @returns {Promise<Object>} Supabase-клиент
 */
async function getClient() {
    if (supabaseClient) return supabaseClient;
    
    if (!initPromise) {
        initPromise = (async () => {
            await loadSDK();
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('[Supabase] Client created');
        })();
    }
    
    await initPromise;
    return supabaseClient;
}

/**
 * Синхронная версия — для обратной совместимости.
 * Возвращает клиент если он уже создан, иначе null.
 * Используй ТОЛЬКО если уверен что init уже вызван.
 */
function getClientSync() {
    return supabaseClient;
}

/**
 * Создаёт клиент (синхронно возвращает заглушку с методами, которые делегируют асинхронному клиенту).
 * Нужно для обратной совместимости с кодом, который вызывает createClient() не await-я.
 * 
 * @param {string} url
 * @param {string} key
 * @returns {Object}
 */
function createClient(url, key) {
    // Возвращаем объект с теми же методами, что и официальный SDK,
    // но auth-методы работают асинхронно через getClient()
    return {
        auth: {
            signInWithPassword: async (credentials) => {
                const client = await getClient();
                return client.auth.signInWithPassword(credentials);
            },
            signOut: async () => {
                const client = await getClient();
                return client.auth.signOut();
            },
            getUser: async () => {
                const client = await getClient();
                return client.auth.getUser();
            },
            getSession: async () => {
                const client = await getClient();
                return client.auth.getSession();
            },
            refreshSession: async () => {
                const client = await getClient();
                return client.auth.refreshSession();
            },
            onAuthStateChange: (callback) => {
                getClient().then(client => {
                    client.auth.onAuthStateChange(callback);
                });
                return { data: { subscription: { unsubscribe: () => {} } } };
            }
        },
        from: (table) => {
            // Прокси, который резолвит реальный from() при await
            return createTableProxy(table);
        },
        storage: {
            from: (bucket) => ({
                upload: async (path, file) => {
                    const client = await getClient();
                    return client.storage.from(bucket).upload(path, file);
                },
                getPublicUrl: (path) => {
                    return { data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` } };
                },
                remove: async (paths) => {
                    const client = await getClient();
                    return client.storage.from(bucket).remove(paths);
                }
            })
        },
        rest: { url, key }
    };
}

/**
 * Создаёт прокси для цепочки .from('table').select().eq() итд.
 * Все методы просто накапливаются и выполняются при await.
 */
function createTableProxy(table) {
    const chain = [];
    let singleFlag = false;
    
    const builder = {
        select: (columns = '*') => { chain.push({ method: 'select', args: [columns] }); return builder; },
        insert: (rows) => { chain.push({ method: 'insert', args: [rows] }); return builder; },
        update: (updates) => { chain.push({ method: 'update', args: [updates] }); return builder; },
        delete: () => { chain.push({ method: 'delete', args: [] }); return builder; },
        eq: (col, val) => { chain.push({ method: 'eq', args: [col, val] }); return builder; },
        neq: (col, val) => { chain.push({ method: 'neq', args: [col, val] }); return builder; },
        is: (col, val) => { chain.push({ method: 'is', args: [col, val] }); return builder; },
        gte: (col, val) => { chain.push({ method: 'gte', args: [col, val] }); return builder; },
        lte: (col, val) => { chain.push({ method: 'lte', args: [col, val] }); return builder; },
        gt: (col, val) => { chain.push({ method: 'gt', args: [col, val] }); return builder; },
        lt: (col, val) => { chain.push({ method: 'lt', args: [col, val] }); return builder; },
        order: (col, opts) => { chain.push({ method: 'order', args: [col, opts] }); return builder; },
        limit: (n) => { chain.push({ method: 'limit', args: [n] }); return builder; },
        single: () => { chain.push({ method: 'single', args: [] }); return builder; },
        maybeSingle: () => { chain.push({ method: 'maybeSingle', args: [] }); return builder; },
        
        then: async (resolve, reject) => {
            try {
                const client = await getClient();
                let query = client.from(table);
                
                for (const step of chain) {
                    if (typeof query[step.method] === 'function') {
                        query = query[step.method](...step.args);
                    }
                }
                
                const { data, error } = await query;
                resolve({ data, error: error ? { status: error.code, message: error.message, details: error.details } : null });
            } catch (err) {
                resolve({ data: null, error: err });
            }
        }
    };
    
    return builder;
}

// Экспорт
export { createClient, getClient, getClientSync };
