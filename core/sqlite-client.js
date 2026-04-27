// ========================================
// FILE: core/sqlite-client.js
// ========================================

/**
 * SQLite Client для браузера
 * Использует sql.js (SQLite, скомпилированный в WebAssembly)
 * База данных автоматически сохраняется в localStorage
 * 
 * @module sqlite-client
 * @version 1.0.0
 */

let SQL = null;
let db = null;
const DB_STORAGE_KEY = 'sh_crm_sqlite_db';

/**
 * Загружает библиотеку sql.js
 * @returns {Promise<void>}
 */
async function loadSqlJs() {
    if (SQL) return;
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.0/dist/sql-wasm.js';
    
    return new Promise((resolve, reject) => {
        script.onload = async () => {
            try {
                SQL = await window.initSqlJs({
                    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.0/dist/${file}`
                });
                console.log('[SQLite] sql.js loaded successfully');
                resolve();
            } catch (e) {
                reject(e);
            }
        };
        script.onerror = () => reject(new Error('Failed to load sql.js'));
        document.head.appendChild(script);
    });
}

/**
 * Сохраняет базу данных в localStorage
 */
function saveToStorage() {
    if (!db) return;
    try {
        const data = db.export();
        const arr = Array.from(data);
        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
        console.warn('[SQLite] Failed to save to localStorage:', e);
    }
}

/**
 * Загружает базу данных из localStorage
 * @returns {Uint8Array|null}
 */
function loadFromStorage() {
    try {
        const saved = localStorage.getItem(DB_STORAGE_KEY);
        if (saved) {
            const arr = JSON.parse(saved);
            return new Uint8Array(arr);
        }
    } catch (e) {
        console.warn('[SQLite] Failed to load from localStorage:', e);
    }
    return null;
}

/**
 * Создаёт таблицы если их нет
 */
function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            cost_price REAL DEFAULT 0,
            category TEXT DEFAULT 'other',
            status TEXT DEFAULT 'in_stock',
            photo_url TEXT,
            created_by TEXT,
            attributes TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            sold_at TEXT,
            _deleted INTEGER DEFAULT 0,
            _optimistic INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS sales (
            id TEXT PRIMARY KEY,
            shift_id TEXT,
            items TEXT NOT NULL DEFAULT '[]',
            total REAL NOT NULL DEFAULT 0,
            profit REAL DEFAULT 0,
            payment_method TEXT DEFAULT 'cash',
            created_by TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS shifts (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            opened_at TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            initial_cash REAL DEFAULT 0,
            final_cash REAL,
            total_revenue REAL DEFAULT 0,
            total_profit REAL DEFAULT 0,
            sales_count INTEGER DEFAULT 0,
            items_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active'
        );
        
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
        CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
        CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id);
    `);
    
    saveToStorage();
}

/**
 * Инициализирует базу данных
 * @returns {Promise<Object>} Объект базы данных
 */
async function initDatabase() {
    await loadSqlJs();
    
    const savedData = loadFromStorage();
    
    if (savedData) {
        db = new SQL.Database(savedData);
        console.log('[SQLite] Database loaded from localStorage');
    } else {
        db = new SQL.Database();
        console.log('[SQLite] New database created');
        createTables();
        
        // Создаём тестового пользователя
        db.run(`
            INSERT OR IGNORE INTO users (id, email, password_hash, full_name) 
            VALUES ('user-1', 'owner@test.com', 'test-hash', 'Владелец')
        `);
        saveToStorage();
    }
    
    // Автосохранение каждые 30 секунд
    setInterval(saveToStorage, 30000);
    
    // Сохранение при закрытии
    window.addEventListener('beforeunload', saveToStorage);
    
    return db;
}

/**
 * Выполняет SELECT запрос
 * @param {string} sql - SQL запрос
 * @param {Object} params - Параметры запроса
 * @returns {Array} Массив строк
 */
function select(sql, params = {}) {
    if (!db) throw new Error('Database not initialized');
    
    const stmt = db.prepare(sql);
    stmt.bind(params);
    
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    
    // Парсим JSON поля
    return results.map(row => {
        if (row.attributes && typeof row.attributes === 'string') {
            try { row.attributes = JSON.parse(row.attributes); } catch {}
        }
        if (row.items && typeof row.items === 'string') {
            try { row.items = JSON.parse(row.items); } catch {}
        }
        return row;
    });
}

/**
 * Выполняет INSERT/UPDATE/DELETE запрос
 * @param {string} sql - SQL запрос
 * @param {Object} params - Параметры запроса
 */
function execute(sql, params = {}) {
    if (!db) throw new Error('Database not initialized');
    
    db.run(sql, params);
    saveToStorage();
}

/**
 * Получает одну строку
 * @param {string} sql - SQL запрос
 * @param {Object} params - Параметры запроса
 * @returns {Object|null}
 */
function selectOne(sql, params = {}) {
    const results = select(sql, params);
    return results[0] || null;
}

/**
 * Генерирует UUID
 * @returns {string}
 */
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Публичный API
export default {
    initDatabase,
    select,
    selectOne,
    execute,
    generateId,
    saveToStorage
};
