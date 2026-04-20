/**
 * Supabase Client Facade
 * 
 * Архитектурные решения:
 * - Фасад над Supabase SDK для централизации логики работы с бэкендом
 * - Разделение на неймспейсы (db, storage, auth)
 * - Автоматическая обработка 401 ошибок (редирект на /login)
 * - Утилиты для загрузки файлов с валидацией
 * - Кэширование публичных URL изображений
 * - Логирование медленных запросов (>1000ms)
 * 
 * Безопасность:
 * - Публикуемый (anon) ключ безопасно использовать на клиенте
 * - Row Level Security (RLS) на стороне Supabase — единственный источник правды
 * - Никаких сервисных ключей (service_role) на фронтенде
 * 
 * @module SupabaseClient
 * @requires @supabase/supabase-js
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ========== КОНФИГУРАЦИЯ ==========
const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EZ_RGBwpdbz9O2N8hX_wXw_NjbslvTP';

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    },
    db: {
        schema: 'public'
    },
    global: {
        headers: {
            'x-application-name': 'second-hand-crm'
        }
    }
});

// ========== УТИЛИТЫ ==========
/**
 * Кэш публичных URL для изображений
 * @type {Map<string, string>}
 */
const urlCache = new Map();

/**
 * Измеряет время выполнения запроса и логирует медленные
 * @param {string} operation - Название операции
 * @param {Function} fn - Асинхронная функция
 * @returns {Promise<any>}
 */
async function measurePerformance(operation, fn) {
    const start = performance.now();
    try {
        return await fn();
    } finally {
        const duration = performance.now() - start;
        if (duration > 1000) {
            console.warn(`[Supabase] Slow query: ${operation} took ${duration.toFixed(0)}ms`);
        }
    }
}

/**
 * Обрабатывает ошибку ответа от Supabase
 * @param {Object} response - Ответ от Supabase { data, error }
 * @param {string} context - Контекст для логирования
 * @returns {Object} data
 * @throws {Error}
 */
function handleResponse(response, context = 'Unknown') {
    const { data, error } = response;
    
    if (error) {
        // Ошибка аутентификации — перенаправляем на логин
        if (error.code === 'PGRST301' || error.status === 401) {
            console.error(`[Supabase] Auth error in ${context}:`, error.message);
            // Даем EventBus время обработать событие перед редиректом
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('supabase:auth-error', { detail: error }));
            }, 100);
        }
        
        console.error(`[Supabase] Error in ${context}:`, error);
        throw error;
    }
    
    return data;
}

// ========== STORAGE OPERATIONS ==========
/**
 * Операции с файловым хранилищем
 */
export const Storage = {
    /**
     * Загружает файл в бакет
     * @param {string} bucket - Название бакета
     * @param {string} path - Путь к файлу
     * @param {File|Blob} file - Файл для загрузки
     * @returns {Promise<string>} - Публичный URL загруженного файла
     */
    async upload(bucket, path, file) {
        return measurePerformance(`storage.upload:${bucket}`, async () => {
            const response = await _client.storage
                .from(bucket)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: false
                });
            
            handleResponse(response, `Storage.upload:${bucket}`);
            return Storage.getPublicUrl(bucket, path);
        });
    },

    /**
     * Удаляет файл из бакета
     * @param {string} bucket - Название бакета
     * @param {string} path - Путь к файлу
     * @returns {Promise<void>}
     */
    async remove(bucket, path) {
        return measurePerformance(`storage.remove:${bucket}`, async () => {
            const response = await _client.storage
                .from(bucket)
                .remove([path]);
            
            handleResponse(response, `Storage.remove:${bucket}`);
            urlCache.delete(`${bucket}/${path}`);
        });
    },

    /**
     * Получает публичный URL файла
     * @param {string} bucket - Название бакета
     * @param {string} path - Путь к файлу
     * @returns {string} - Публичный URL
     */
    getPublicUrl(bucket, path) {
        const cacheKey = `${bucket}/${path}`;
        
        if (urlCache.has(cacheKey)) {
            return urlCache.get(cacheKey);
        }
        
        const { data } = _client.storage
            .from(bucket)
            .getPublicUrl(path);
        
        urlCache.set(cacheKey, data.publicUrl);
        return data.publicUrl;
    },

    /**
     * Генерирует уникальное имя файла
     * @param {File} file - Исходный файл
     * @returns {string} - Уникальное имя с расширением
     */
    generateFileName(file) {
        const ext = file.name.split('.').pop();
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        return `${timestamp}_${random}.${ext}`;
    },

    /**
     * Валидирует файл изображения
     * @param {File} file - Файл для проверки
     * @param {Object} options - Опции валидации
     * @returns {Object} - { valid: boolean, error?: string }
     */
    validateImage(file, options = {}) {
        const {
            maxSizeMB = 5,
            allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
        } = options;
        
        if (!file) {
            return { valid: false, error: 'Файл не выбран' };
        }
        
        if (!allowedTypes.includes(file.type)) {
            return { valid: false, error: 'Недопустимый формат. Разрешены: JPEG, PNG, WebP' };
        }
        
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            return { valid: false, error: `Файл слишком большой. Максимум: ${maxSizeMB} МБ` };
        }
        
        return { valid: true };
    }
};

// ========== AUTH OPERATIONS ==========
/**
 * Операции аутентификации
 */
export const Auth = {
    /**
     * Получить текущую сессию
     * @returns {Promise<Object|null>}
     */
    async getSession() {
        const { data, error } = await _client.auth.getSession();
        if (error) throw error;
        return data.session;
    },

    /**
     * Получить текущего пользователя
     * @returns {Promise<Object|null>}
     */
    async getUser() {
        const { data, error } = await _client.auth.getUser();
        if (error) throw error;
        return data.user;
    },

    /**
     * Вход по email/password
     * @param {string} email
     * @param {string} password
     * @returns {Promise<Object>}
     */
    async signIn(email, password) {
        const response = await _client.auth.signInWithPassword({ email, password });
        return handleResponse(response, 'Auth.signIn');
    },

    /**
     * Регистрация
     * @param {string} email
     * @param {string} password
     * @param {Object} metadata - Дополнительные данные пользователя
     * @returns {Promise<Object>}
     */
    async signUp(email, password, metadata = {}) {
        const response = await _client.auth.signUp({
            email,
            password,
            options: { data: metadata }
        });
        return handleResponse(response, 'Auth.signUp');
    },

    /**
     * Выход
     * @returns {Promise<void>}
     */
    async signOut() {
        const response = await _client.auth.signOut();
        handleResponse(response, 'Auth.signOut');
    },

    /**
     * Подписка на изменения состояния аутентификации
     * @param {Function} callback - (event, session) => void
     * @returns {Function} - Функция отписки
     */
    onAuthStateChange(callback) {
        const { data } = _client.auth.onAuthStateChange(callback);
        return data.subscription.unsubscribe;
    }
};

// ========== RAW CLIENT (для сервисов) ==========
/**
 * Прямой доступ к клиенту для сервисного слоя.
 * Использовать только через сервисы, никогда напрямую в компонентах!
 * 
 * @example
 * // Внутри ProductService:
 * import { db } from '../core/SupabaseClient.js';
 * const { data, error } = await db.from('products').select('*');
 */
export const db = _client;

// ========== DEPRECATED (для обратной совместимости) ==========
/**
 * @deprecated Используйте именованные экспорты: db, Storage, Auth
 */
export const SupabaseClient = _client;

// ========== EXPORTS ==========
export default {
    db,
    Storage,
    Auth
};
