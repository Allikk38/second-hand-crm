// ========================================
// FILE: utils/categorySchema.js
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
 * @version 2.2.0
 * @changes
 * - Добавлена функция groupByCategoryForDb для создания объектов, совместимых с Supabase JSONB.
 * - Улучшен JSDoc.
 */

// ========== КОНСТАНТЫ ==========

/**
 * Ключи всех доступных категорий.
 * @type {string[]}
 */
export const CATEGORY_KEYS = ['clothes', 'toys', 'dishes', 'electronics', 'furniture', 'other'];

/**
 * Человекочитаемые названия категорий.
 * @type {Object<string, string>}
 */
export const CATEGORY_NAMES = {
    clothes: 'Одежда',
    toys: 'Игрушки',
    dishes: 'Посуда',
    electronics: 'Электроника',
    furniture: 'Мебель',
    other: 'Другое'
};

/**
 * Схема полей для каждой категории товаров.
 * @type {Object<string, Object>}
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
                label: 'Объём', 
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
                type: 'text',
                placeholder: '1, 6, 12, набор',
                required: false
            }
        ]
    },
    electronics: {
        name: 'Электроника',
        fields: [
            { 
                name: 'brand', 
                label: 'Бренд', 
                type: 'text', 
                placeholder: 'Apple, Samsung, Xiaomi',
                required: true 
            },
            { 
                name: 'model', 
                label: 'Модель', 
                type: 'text', 
                placeholder: 'iPhone 13, Galaxy S22',
                required: true 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее', 'Требует ремонта'],
                required: true 
            },
            {
                name: 'accessories',
                label: 'Комплектация',
                type: 'text',
                placeholder: 'Зарядное устройство, коробка, чехол',
                required: false
            },
            {
                name: 'warranty',
                label: 'Гарантия',
                type: 'text',
                placeholder: '3 месяца, 1 год',
                required: false
            }
        ]
    },
    furniture: {
        name: 'Мебель',
        fields: [
            { 
                name: 'material', 
                label: 'Материал', 
                type: 'select',
                options: ['Дерево', 'Металл', 'Пластик', 'Стекло', 'Ткань', 'Кожа', 'Комбинированный'],
                required: true 
            },
            { 
                name: 'dimensions', 
                label: 'Размеры (Ш×Г×В)', 
                type: 'text', 
                placeholder: '80×40×120 см',
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
                name: 'assembly',
                label: 'Требуется сборка',
                type: 'select',
                options: ['Да', 'Нет', 'Частично'],
                required: false
            },
            {
                name: 'color',
                label: 'Цвет',
                type: 'text',
                placeholder: 'Белый, дуб, венге',
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
 * @param {string} category - Ключ категории
 * @returns {Object} Схема категории
 */
export function getCategorySchema(category) {
    if (!category || typeof category !== 'string') {
        return CATEGORY_SCHEMA.other;
    }
    return CATEGORY_SCHEMA[category] || CATEGORY_SCHEMA.other;
}

/**
 * Получает человекочитаемое название категории.
 * @param {string} category - Ключ категории
 * @returns {string} Название категории
 */
export function getCategoryName(category) {
    if (!category) return 'Другое';
    return CATEGORY_SCHEMA[category]?.name || category;
}

/**
 * Получает список категорий для использования в select.
 * @param {boolean} [includeOther=true] - Включать ли категорию "Другое"
 * @returns {Array<{value: string, label: string}>}
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
 * @returns {Array<Object>}
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
 * @param {string} category - Ключ категории
 * @returns {Array<Object>}
 */
export function getCategoryFields(category) {
    const schema = getCategorySchema(category);
    return schema.fields || [];
}

/**
 * Получает обязательные поля для категории.
 * @param {string} category - Ключ категории
 * @returns {Array<Object>}
 */
export function getRequiredFields(category) {
    const fields = getCategoryFields(category);
    return fields.filter(field => field.required);
}

/**
 * Валидирует атрибуты товара на соответствие схеме категории.
 * @param {string} category - Ключ категории
 * @param {Object} attributes - Объект атрибутов
 * @returns {Object} { valid, errors, missingFields }
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
 * @param {string} category - Ключ категории
 * @param {Object} attributes - Объект атрибутов
 * @param {Object} options - Опции форматирования
 * @param {string} [options.format='labels'] - 'labels', 'values', 'compact'
 * @param {string} [options.separator=' • '] - Разделитель
 * @param {string} [options.emptyValue='—'] - Значение по умолчанию
 * @returns {string}
 */
export function formatAttributes(category, attributes = {}, options = {}) {
    const {
        format = 'labels',
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
            if (format === 'labels') {
                parts.push(`${field.label}: ${value}`);
            } else if (format === 'compact') {
                parts.push(value);
            } else {
                parts.push(value);
            }
        }
    });
    
    // Добавляем дополнительные атрибуты, которых нет в схеме
    if (format === 'labels') {
        Object.entries(attributes).forEach(([key, value]) => {
            const isInSchema = schema.fields.some(f => f.name === key);
            if (!isInSchema && value !== undefined && value !== null && String(value).trim() !== '') {
                parts.push(`${key}: ${value}`);
            }
        });
    }
    
    return parts.length > 0 ? parts.join(separator) : emptyValue;
}

/**
 * Создает пустой объект атрибутов для категории.
 * @param {string} category - Ключ категории
 * @returns {Object}
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
 * Группирует массив товаров по категориям.
 * Возвращает Map для эффективной работы в UI.
 * 
 * @param {Array<Object>} products - Массив товаров
 * @returns {Object} { byCategory, counts, sorted }
 */
export function groupByCategory(products = []) {
    const byCategory = new Map();
    const counts = new Map();
    
    // Инициализируем все категории из схемы
    Object.keys(CATEGORY_SCHEMA).forEach(key => {
        byCategory.set(key, []);
        counts.set(key, 0);
    });
    
    products.forEach(product => {
        const category = product.category || 'other';
        
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
            counts.set(category, 0);
        }
        
        byCategory.get(category).push(product);
        counts.set(category, (counts.get(category) || 0) + 1);
    });
    
    const sorted = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => key);
    
    return { byCategory, counts, sorted };
}

/**
 * Группирует товары по категориям и возвращает объект, совместимый с JSONB в Supabase.
 * Используется для сохранения в БД.
 * 
 * @param {Array<Object>} products - Массив товаров
 * @returns {Object} Объект { "categoryKey": [products] }
 */
export function groupByCategoryForDb(products = []) {
    const result = {};
    const { byCategory } = groupByCategory(products);
    
    for (const [key, value] of byCategory.entries()) {
        // Фильтруем товары, чтобы убрать временные свойства из _optimistic
        const cleanProducts = value.map(p => {
            const { _optimistic, _deleted, ...cleanProduct } = p;
            return cleanProduct;
        });
        result[key] = cleanProducts;
    }
    
    return result;
}

/**
 * Проверяет, поддерживает ли категория указанное поле.
 * @param {string} category - Ключ категории
 * @param {string} fieldName - Имя поля
 * @returns {boolean}
 */
export function hasField(category, fieldName) {
    const fields = getCategoryFields(category);
    return fields.some(f => f.name === fieldName);
}

/**
 * Получает метаданные поля в категории.
 * @param {string} category - Ключ категории
 * @param {string} fieldName - Имя поля
 * @returns {Object|null}
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
    groupByCategoryForDb,
    hasField,
    getFieldMetadata
};
