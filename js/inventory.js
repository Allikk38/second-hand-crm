// ========================================
// FILE: js/inventory.js
// ========================================

/**
 * Inventory Module - Backward Compatibility Entry Point
 * 
 * Точка входа для сохранения обратной совместимости.
 * Реэкспортирует всё из нового модуля js/inventory/index.js.
 * 
 * ВАЖНО: этот файл НЕ содержит логики.
 * Вся логика в inventory/index.js.
 * 
 * @module inventory
 * @version 4.0.0
 * @changes
 * - Полный рефакторинг: удалён старый код (1013 строк).
 * - Теперь это чистый реэкспорт нового модуля.
 * - Старый код перемещён в inventory/index.js.
 */

// Реэкспорт всего из нового модуля
export * from './inventory/index.js';

// Импорт и реэкспорт init для обратной совместимости
import { init } from './inventory/index.js';
export { init };

// Экспорт по умолчанию
export default { init };
