// ========================================
// FILE: js/cashier.js
// ========================================

/**
 * Cashier Module - Backward Compatibility Entry Point
 * 
 * Точка входа для сохранения обратной совместимости.
 * Реэкспортирует всё из нового модуля js/cashier/index.js.
 * 
 * @module cashier
 * @version 4.0.0
 * @changes
 * - Полный рефакторинг: модуль разделён на cart.js, shift.js, products.js, index.js.
 * - Этот файл теперь является реэкспортом для обратной совместимости.
 */

// Реэкспорт основного модуля
export * from './cashier/index.js';

// Импорт и реэкспорт init для обратной совместимости
import { init } from './cashier/index.js';
export { init };

// Экспорт по умолчанию
export default { init };
