// ========================================
// FILE: ./modules/cashier/cashierState.js
// ========================================

/**
 * DEPRECATED: Cashier State
 * 
 * Этот файл больше не используется.
 * Вся логика управления состоянием кассы перенесена в глобальный `Store` (core/Store.js).
 * 
 * Используйте:
 * - `Store.state.cashier` для доступа к состоянию
 * - `Store.subscribe('cashier.*')` для подписки на изменения
 * - `Store.getCartTotal()`, `Store.getCartItemsCount()` для вычислений
 * 
 * @deprecated Удален в версии 5.0.0
 * @module cashierState
 * @version 5.0.0
 * @changes
 * - Файл удален. Функционал перенесен в core/Store.js
 */

// Файл оставлен пустым намеренно.
// Если вы видите эту ошибку, значит где-то остался устаревший импорт.
// Замените: import { CashierState } from './cashierState.js'
// На: import { Store } from '../../core/Store.js'

throw new Error(
    '[DEPRECATED] cashierState.js has been removed. ' +
    'Please use Store from ../../core/Store.js instead. ' +
    'Example: Store.state.cashier.currentShift'
);
