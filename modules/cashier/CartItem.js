// ========================================
// FILE: ./modules/cashier/CartItem.js
// ========================================

/**
 * DEPRECATED: Cart Item Component
 * 
 * Этот файл больше не используется.
 * Логика отображения строки корзины перенесена непосредственно в `Cart.js`.
 * 
 * Архитектурное решение:
 * - Упрощение структуры: корзина рендерит все содержимое сама.
 * - Уменьшение накладных расходов на создание множества мелких компонентов.
 * 
 * @deprecated Удален в версии 5.0.0
 * @module CartItem
 * @version 5.0.0
 * @changes
 * - Файл удален. Функционал перенесен в Cart.js.
 */

// Файл оставлен пустым намеренно.
// Если вы видите эту ошибку, значит где-то остался устаревший импорт.
// Удалите импорт CartItem и используйте Cart напрямую.

throw new Error(
    '[DEPRECATED] CartItem.js has been removed. ' +
    'Cart component now renders all cart items internally. ' +
    'Please remove any imports of CartItem.'
);
