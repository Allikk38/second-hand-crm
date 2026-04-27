// ========================================
// FILE: sw.js
// ========================================

/**
 * Service Worker — SH CRM PWA
 * 
 * Стратегия кэширования:
 * - Статика (CSS, JS, иконки): Cache First (сеть — fallback)
 * - HTML-страницы: Network First (кэш — fallback для офлайна)
 * - Supabase API: Network Only (не кэшируем)
 * - CDN-скрипты: Cache First
 * 
 * @version 1.0.0
 */

const CACHE_VERSION = 'sh-crm-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGES_CACHE = `${CACHE_VERSION}-pages`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;

// ========== КОНФИГУРАЦИЯ ПУТЕЙ ==========

const BASE_PATH = '/second-hand-crm';

// Статика (кэшируется сразу при установке)
const STATIC_ASSETS = [
    `${BASE_PATH}/`,
    `${BASE_PATH}/css/styles.css`,
    `${BASE_PATH}/css/base/variables.css`,
    `${BASE_PATH}/css/base/reset.css`,
    `${BASE_PATH}/css/base/typography.css`,
    `${BASE_PATH}/css/components/buttons.css`,
    `${BASE_PATH}/css/components/forms.css`,
    `${BASE_PATH}/css/components/tables.css`,
    `${BASE_PATH}/css/components/modal.css`,
    `${BASE_PATH}/css/components/notifications.css`,
    `${BASE_PATH}/css/components/product-card.css`,
    `${BASE_PATH}/css/components/cart.css`,
    `${BASE_PATH}/css/layouts/app.css`,
    `${BASE_PATH}/css/layouts/cashier.css`,
    `${BASE_PATH}/css/layouts/inventory.css`,
    `${BASE_PATH}/css/layouts/reports.css`,
    `${BASE_PATH}/css/pages/cashier.css`,
    `${BASE_PATH}/css/utils/utilities.css`,
    `${BASE_PATH}/css/utils/responsive.css`,
    `${BASE_PATH}/js/login.js`,
    `${BASE_PATH}/utils/formatters.js`,
    `${BASE_PATH}/utils/ui.js`,
    `${BASE_PATH}/utils/categorySchema.js`,
    `${BASE_PATH}/utils/logger.js`,
    `${BASE_PATH}/utils/product-form.js`,
    `${BASE_PATH}/core/supabase-client.js`,
    `${BASE_PATH}/core/auth.js`,
    `${BASE_PATH}/core/db.js`,
    `${BASE_PATH}/manifest.json`
];

// HTML-страницы (Network First)
const PAGES = [
    `${BASE_PATH}/index.html`,
    `${BASE_PATH}/pages/login.html`,
    `${BASE_PATH}/pages/inventory.html`,
    `${BASE_PATH}/pages/cashier.html`,
    `${BASE_PATH}/pages/reports.html`
];

// CDN-ресурсы (Cache First)
const CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Supabase API — не кэшируем
const SUPABASE_URL = 'https://bhdwniiyrrujeoubrvle.supabase.co';

// ========== УСТАНОВКА ==========

self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    
    event.waitUntil(
        Promise.all([
            // Кэшируем статику
            caches.open(STATIC_CACHE).then(cache => {
                console.log('[SW] Caching static assets...');
                return cache.addAll(STATIC_ASSETS).catch(err => {
                    console.warn('[SW] Some static assets failed to cache:', err);
                });
            }),
            // Кэшируем CDN
            caches.open(CDN_CACHE).then(cache => {
                console.log('[SW] Caching CDN assets...');
                return Promise.all(
                    CDN_URLS.map(url => 
                        cache.add(url).catch(err => {
                            console.warn('[SW] CDN asset failed to cache:', url, err);
                        })
                    )
                );
            })
        ]).then(() => {
            console.log('[SW] Install complete, skipping waiting');
            return self.skipWaiting();
        })
    );
});

// ========== АКТИВАЦИЯ ==========

self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name.startsWith('sh-crm-') && 
                        name !== STATIC_CACHE && 
                        name !== PAGES_CACHE && 
                        name !== CDN_CACHE)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Claiming clients');
            return self.clients.claim();
        })
    );
});

// ========== ЗАПРОСЫ ==========

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Не обрабатываем POST/PUT/DELETE
    if (request.method !== 'GET') return;
    
    // Supabase API — не кэшируем, идём напрямую в сеть
    if (url.origin === new URL(SUPABASE_URL).origin) {
        return;
    }
    
    // CDN-ресурсы — Cache First
    if (CDN_URLS.some(cdnUrl => request.url.startsWith(cdnUrl.split('/dist/')[0]))) {
        event.respondWith(cacheFirst(request, CDN_CACHE));
        return;
    }
    
    // HTML-страницы — Network First
    if (PAGES.some(page => url.pathname === new URL(page, self.location.origin).pathname)) {
        event.respondWith(networkFirst(request, PAGES_CACHE));
        return;
    }
    
    // Статика (CSS, JS, иконки) — Cache First
    if (request.destination === 'style' || 
        request.destination === 'script' || 
        request.destination === 'image' ||
        request.destination === 'font' ||
        url.pathname.includes('/icons/')) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }
    
    // Всё остальное — Network First с fallback в статику
    event.respondWith(networkFirst(request, STATIC_CACHE));
});

// ========== СТРАТЕГИИ КЭШИРОВАНИЯ ==========

/**
 * Cache First: берём из кэша, если нет — идём в сеть и кэшируем.
 */
async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.warn('[SW] Cache first failed:', request.url, error);
        // Fallback: вернуть заглушку или пустой ответ
        return new Response('', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Network First: идём в сеть, при ошибке — берём из кэша.
 * Для HTML-страниц сохраняем свежую версию в кэш.
 */
async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.warn('[SW] Network first fell back to cache:', request.url);
        const cached = await caches.match(request);
        if (cached) return cached;
        
        // Если страницы нет в кэше — показываем офлайн-заглушку
        if (request.destination === 'document') {
            return caches.match(`${BASE_PATH}/index.html`);
        }
        
        throw error;
    }
}
