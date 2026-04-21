// ========================================
// FILE: ./modules/cashier/CartSummary.js
// ========================================

/**
 * DEPRECATED: Cart Summary Component
 * 
 * Этот файл больше не используется.
 * Логика отображения итогов корзины перенесена непосредственно в `Cart.js`.
 * 
 * Архитектурное решение:
 * - Упрощение структуры: корзина рендерит все содержимое сама.
 * - Уменьшение накладных расходов на создание множества мелких компонентов.
 * 
 * @deprecated Удален в версии 5.0.0
 * @module CartSummary
 * @version 5.0.0
 * @changes
 * - Файл удален. Функционал перенесен в Cart.js.
 */

// Файл оставлен пустым намеренно.
// Если вы видите эту ошибку, значит где-то остался устаревший импорт.
// Удалите импорт CartSummary и используйте Cart напрямую.

throw new Error(
    '[DEPRECATED] CartSummary.js has been removed. ' +
    'Cart component now renders summary internally. ' +
    'Please remove any imports of CartSummary.'
);
