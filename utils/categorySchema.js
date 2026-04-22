// ========================================
// FILE: ./utils/categorySchema.js
// ========================================

/**
 * Category Schema Module
 * 
 * Определяет схему атрибутов для каждой категории товаров.
 * Используется при создании/редактировании товаров и отображении атрибутов.
 * 
 * Архитектурные решения:
 * - Единый источник истины для всех категорий и их атрибутов.
 * - Поддержка динамических полей в зависимости от категории.
 * - Валидация обязательных полей на основе схемы.
 * - Форматирование атрибутов для отображения в UI.
 * 
 * @module categorySchema
 * @version 2.0.0
 * @changes
 * - Добавлена полная JSDoc-документация.
 * - Экспортированы дополнительные утилиты: getCategoryOptions, validateAttributes.
 * - Улучшена функция formatAttributes с fallback-значением.
 * - Добавлена функция groupByCategory для статистики.
 * - Добавлены константы CATEGORY_KEYS и CATEGORY_NAMES.
 */

// ========== КОНСТАНТЫ ==========

/**
 * Ключи всех доступных категорий.
 * @type {string[]}
 */
export const CATEGORY_KEYS = ['clothes', 'toys', 'dishes', 'other'];

/**
 * Человекочитаемые названия категорий.
 * @type {Object<string, string>}
 */
export const CATEGORY_NAMES = {
    clothes: 'Одежда',
    toys: 'Игрушки',
    dishes: 'Посуда',
    other: 'Другое'
};

/**
 * Схема полей для каждой категории товаров.
 * Определяет какие атрибуты нужны для каждой категории и как их отображать.
 * 
 * @type {Object<string, Object>}
 * @property {string} name - Человекочитаемое название категории
 * @property {Array<Object>} fields - Массив полей категории
 * @property {string} fields[].name - Ключ поля в объекте attributes
 * @property {string} fields[].label - Метка для отображения в UI
 * @property {string} fields[].type - Тип поля (text, select, textarea, number)
 * @property {string} [fields[].placeholder] - Placeholder для input
 * @property {boolean} [fields[].required] - Обязательное ли поле
 * @property {Array<string>} [fields[].options] - Опции для select
 */
export const CATEGORY_SCHEMA = {
    clothes: {
        name: 'Одежда',
        fields: [
            { 
                name: 'size', 
                label: 'Размер', 
                type: 'text', 
                placeholder: '42, M, XL, 104',
                required: true 
            },
            { 
                name: 'brand', 
                label: 'Бренд', 
                type: 'text', 
                placeholder: 'Zara, H&M, Adidas',
                required: false 
            },
            { 
                name: 'material', 
                label: 'Материал', 
                type: 'text', 
                placeholder: 'Хлопок, Шерсть, Полиэстер',
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее', 'Требует ремонта'],
                required: true 
            },
            {
                name: 'season',
                label: 'Сезон',
                type: 'select',
                options: ['Лето', 'Зима', 'Демисезон', 'Всесезон'],
                required: false
            }
        ]
    },
    toys: {
        name: 'Игрушки',
        fields: [
            { 
                name: 'age', 
                label: 'Возраст', 
                type: 'text', 
                placeholder: '3+, 5-7 лет, от 12 лет',
                required: true 
            },
            { 
                name: 'brand', 
                label: 'Бренд', 
                type: 'text', 
                placeholder: 'LEGO, Mattel, Hasbro',
                required: false 
            },
            { 
                name: 'type', 
                label: 'Тип игрушки', 
                type: 'select',
                options: ['Конструктор', 'Кукла', 'Машинка', 'Настольная игра', 'Мягкая игрушка', 'Развивающая', 'Другое'],
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее', 'Требует ремонта'],
                required: true 
            },
            {
                name: 'completeness',
                label: 'Комплектация',
                type: 'select',
                options: ['Полная', 'Неполная', 'Отсутствуют детали'],
                required: false
            }
        ]
    },
    dishes: {
        name: 'Посуда',
        fields: [
            { 
                name: 'material', 
                label: 'Материал', 
                type: 'select',
                options: ['Керамика', 'Стекло', 'Фарфор', 'Металл', 'Пластик', 'Дерево', 'Хрусталь'],
                required: true 
            },
            { 
                name: 'volume', 
                label: 'Объем', 
                type: 'text', 
                placeholder: '250 мл, 1 л, 3 л',
                required: false 
            },
            { 
                name: 'brand', 
                label: 'Бренд', 
                type: 'text', 
                placeholder: 'IKEA, Tefal, Luminarc',
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее', 'Имеет дефекты'],
                required: true 
            },
            {
                name: 'setItems',
                label: 'Предметов в наборе',
                type: 'number',
                placeholder: '1, 6, 12',
                required: false
            }
        ]
    },
    other: {
        name: 'Другое',
        fields: [
            { 
                name: 'description', 
                label: 'Описание', 
                type: 'textarea', 
                placeholder: 'Дополнительная информация о товаре',
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее', 'Требует ремонта'],
                required: true 
            },
            {
                name: 'brand',
                label: 'Бренд/Производитель',
                type: 'text',
                placeholder: 'Укажите если известно',
                required: false
            }
        ]
    }
};

// ========== ПУБЛИЧНЫЕ ФУНКЦИИ ==========

/**
 * Получает схему для указанной категории.
 * Если категория не найдена, возвращает схему для 'other'.
 * 
 * @param {string} category - Ключ категории
 * @returns {Object} Схема категории с полями и названием
 * 
 * @example
 * const schema = getCategorySchema('clothes');
 * console.log(schema.name); // "Одежда"
 * console.log(schema.fields); // [{ name: 'size', label: 'Размер', ... }]
 */
export function getCategorySchema(category) {
    if (!category || typeof category !== 'string') {
        console.warn('[categorySchema] Invalid category, using "other":', category);
        return CATEGORY_SCHEMA.other;
    }
    
    return CATEGORY_SCHEMA[category] || CATEGORY_SCHEMA.other;
}

/**
 * Получает человекочитаемое название категории.
 * 
 * @param {string} category - Ключ категории
 * @returns {string} Название категории или исходный ключ если не найдено
 * 
 * @example
 * getCategoryName('clothes') // "Одежда"
 * getCategoryName('unknown') // "unknown"
 */
export function getCategoryName(category) {
    if (!category) return 'Другое';
    
    return CATEGORY_SCHEMA[category]?.name || category;
}

/**
 * Получает список категорий для использования в select.
 * 
 * @param {boolean} [includeOther=true] - Включать ли категорию "Другое"
 * @returns {Array<{value: string, label: string}>} Массив объектов для option
 * 
 * @example
 * const options = getCategoryOptions();
 * // [{ value: 'clothes', label: 'Одежда' }, ...]
 */
export function getCategoryOptions(includeOther = true) {
    return Object.entries(CATEGORY_SCHEMA)
        .filter(([key]) => includeOther || key !== 'other')
        .map(([value, data]) => ({
            value,
            label: data.name
        }));
}

/**
 * Получает все категории с дополнительной информацией.
 * 
 * @returns {Array<Object>} Массив объектов категорий с ключом и схемой
 */
export function getAllCategories() {
    return Object.entries(CATEGORY_SCHEMA).map(([key, schema]) => ({
        key,
        name: schema.name,
        fieldsCount: schema.fields.length,
        requiredFields: schema.fields.filter(f => f.required).length
    }));
}

/**
 * Получает поля для указанной категории.
 * 
 * @param {string} category - Ключ категории
 * @returns {Array<Object>} Массив полей категории
 * 
 * @example
 * const fields = getCategoryFields('toys');
 * // [{ name: 'age', label: 'Возраст', type: 'text', ... }, ...]
 */
export function getCategoryFields(category) {
    const schema = getCategorySchema(category);
    return schema.fields || [];
}

/**
 * Получает обязательные поля для категории.
 * 
 * @param {string} category - Ключ категории
 * @returns {Array<Object>} Массив обязательных полей
 */
export function getRequiredFields(category) {
    const fields = getCategoryFields(category);
    return fields.filter(field => field.required);
}

/**
 * Валидирует атрибуты товара на соответствие схеме категории.
 * 
 * @param {string} category - Ключ категории
 * @param {Object} attributes - Объект атрибутов для проверки
 * @returns {Object} Объект с результатом валидации
 * @returns {boolean} .valid - true если все обязательные поля заполнены
 * @returns {Array<string>} .errors - Массив сообщений об ошибках
 * @returns {Array<string>} .missingFields - Ключи незаполненных обязательных полей
 * 
 * @example
 * const result = validateAttributes('clothes', { size: 'M', condition: 'Отличное' });
 * if (!result.valid) {
 *     console.error('Missing fields:', result.missingFields);
 * }
 */
export function validateAttributes(category, attributes = {}) {
    const requiredFields = getRequiredFields(category);
    const missingFields = [];
    
    requiredFields.forEach(field => {
        const value = attributes[field.name];
        if (!value || (typeof value === 'string' && value.trim() === '')) {
            missingFields.push(field.name);
        }
    });
    
    const errors = missingFields.map(fieldName => {
        const field = requiredFields.find(f => f.name === fieldName);
        return `Поле "${field?.label || fieldName}" обязательно для заполнения`;
    });
    
    return {
        valid: missingFields.length === 0,
        errors,
        missingFields
    };
}

/**
 * Форматирует атрибуты товара для отображения в UI.
 * 
 * @param {string} category - Ключ категории товара
 * @param {Object} attributes - Объект атрибутов
 * @param {Object} options - Опции форматирования
 * @param {boolean} [options.showLabels=true] - Показывать названия полей
 * @param {string} [options.separator=' • '] - Разделитель между атрибутами
 * @param {string} [options.emptyValue='—'] - Что показывать если атрибутов нет
 * @returns {string} Отформатированная строка с атрибутами
 * 
 * @example
 * formatAttributes('clothes', { size: 'M', brand: 'Zara', condition: 'Отличное' })
 * // "Размер: M • Бренд: Zara • Состояние: Отличное"
 * 
 * formatAttributes('clothes', { size: 'M' }, { showLabels: false })
 * // "M"
 */
export function formatAttributes(category, attributes = {}, options = {}) {
    const {
        showLabels = true,
        separator = ' • ',
        emptyValue = '—'
    } = options;
    
    if (!attributes || typeof attributes !== 'object') {
        return emptyValue;
    }
    
    const schema = getCategorySchema(category);
    const parts = [];
    
    schema.fields.forEach(field => {
        const value = attributes[field.name];
        
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            if (showLabels) {
                parts.push(`${field.label}: ${value}`);
            } else {
                parts.push(String(value));
            }
        }
    });
    
    // Добавляем дополнительные атрибуты, которых нет в схеме
    Object.entries(attributes).forEach(([key, value]) => {
        const isInSchema = schema.fields.some(f => f.name === key);
        
        if (!isInSchema && value !== undefined && value !== null && String(value).trim() !== '') {
            if (showLabels) {
                parts.push(`${key}: ${value}`);
            } else {
                parts.push(String(value));
            }
        }
    });
    
    return parts.length > 0 ? parts.join(separator) : emptyValue;
}

/**
 * Создает пустой объект атрибутов с значениями по умолчанию для категории.
 * 
 * @param {string} category - Ключ категории
 * @returns {Object} Объект атрибутов с пустыми строками
 * 
 * @example
 * const emptyAttrs = createEmptyAttributes('clothes');
 * // { size: '', brand: '', material: '', condition: '', season: '' }
 */
export function createEmptyAttributes(category) {
    const fields = getCategoryFields(category);
    const attributes = {};
    
    fields.forEach(field => {
        attributes[field.name] = '';
    });
    
    return attributes;
}

/**
 * Группирует массив товаров по категориям с подсчетом.
 * 
 * @param {Array<Object>} products - Массив товаров
 * @returns {Object} Объект с группировкой
 * @returns {Object} .byCategory - Товары сгруппированные по категориям
 * @returns {Object} .counts - Количество товаров в каждой категории
 * @returns {Array} .sorted - Категории отсортированные по количеству
 * 
 * @example
 * const grouped = groupByCategory(products);
 * console.log(grouped.counts); // { clothes: 15, toys: 8, dishes: 3, other: 2 }
 * console.log(grouped.sorted); // ['clothes', 'toys', 'dishes', 'other']
 */
export function groupByCategory(products = []) {
    const byCategory = {};
    const counts = {};
    
    // Инициализируем все категории
    CATEGORY_KEYS.forEach(key => {
        byCategory[key] = [];
        counts[key] = 0;
    });
    
    // Группируем товары
    products.forEach(product => {
        const category = product.category || 'other';
        
        if (!byCategory[category]) {
            byCategory[category] = [];
            counts[category] = 0;
        }
        
        byCategory[category].push(product);
        counts[category]++;
    });
    
    // Сортируем категории по количеству товаров
    const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => key);
    
    return {
        byCategory,
        counts,
        sorted
    };
}

/**
 * Проверяет, поддерживает ли категория указанное поле.
 * 
 * @param {string} category - Ключ категории
 * @param {string} fieldName - Имя поля
 * @returns {boolean} true если поле есть в схеме категории
 */
export function hasField(category, fieldName) {
    const fields = getCategoryFields(category);
    return fields.some(f => f.name === fieldName);
}

/**
 * Получает метаданные конкретного поля в категории.
 * 
 * @param {string} category - Ключ категории
 * @param {string} fieldName - Имя поля
 * @returns {Object|null} Объект поля или null если не найдено
 */
export function getFieldMetadata(category, fieldName) {
    const fields = getCategoryFields(category);
    return fields.find(f => f.name === fieldName) || null;
}

// ========== ЭКСПОРТ ПО УМОЛЧАНИЮ ==========

export default {
    CATEGORY_SCHEMA,
    CATEGORY_KEYS,
    CATEGORY_NAMES,
    getCategorySchema,
    getCategoryName,
    getCategoryOptions,
    getAllCategories,
    getCategoryFields,
    getRequiredFields,
    validateAttributes,
    formatAttributes,
    createEmptyAttributes,
    groupByCategory,
    hasField,
    getFieldMetadata
};
