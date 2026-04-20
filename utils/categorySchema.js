/**
 * Схема полей для категорий товаров
 * Определяет какие атрибуты нужны для каждой категории
 * 
 * @module categorySchema
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
                placeholder: 'Zara, H&M',
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее'],
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
                placeholder: '3+, 5-7 лет',
                required: true 
            },
            { 
                name: 'brand', 
                label: 'Бренд', 
                type: 'text', 
                placeholder: 'LEGO, Mattel',
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее'],
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
                options: ['Керамика', 'Стекло', 'Фарфор', 'Металл', 'Пластик'],
                required: false 
            },
            { 
                name: 'volume', 
                label: 'Объем', 
                type: 'text', 
                placeholder: '250 мл, 1 л',
                required: false 
            },
            { 
                name: 'condition', 
                label: 'Состояние', 
                type: 'select',
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее'],
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
                options: ['Новое', 'Отличное', 'Хорошее', 'Среднее'],
                required: false 
            }
        ]
    }
};

/**
 * Получить схему для категории
 * @param {string} category - Ключ категории
 * @returns {Object} Схема категории
 */
export function getCategorySchema(category) {
    return CATEGORY_SCHEMA[category] || CATEGORY_SCHEMA.other;
}

/**
 * Получить список категорий для select
 * @returns {Array<{value: string, label: string}>}
 */
export function getCategoryOptions() {
    return Object.entries(CATEGORY_SCHEMA).map(([value, data]) => ({
        value,
        label: data.name
    }));
}

/**
 * Форматировать атрибуты для отображения
 * @param {string} category - Категория товара
 * @param {Object} attributes - Объект атрибутов
 * @returns {string} Отформатированная строка
 */
export function formatAttributes(category, attributes) {
    if (!attributes || !Object.keys(attributes).length) return '';
    
    const schema = getCategorySchema(category);
    const parts = [];
    
    schema.fields.forEach(field => {
        const value = attributes[field.name];
        if (value && value.toString().trim()) {
            parts.push(`${field.label}: ${value}`);
        }
    });
    
    return parts.join(' • ');
}

/**
 * Получить название категории
 * @param {string} category - Ключ категории
 * @returns {string} Название категории
 */
export function getCategoryName(category) {
    return CATEGORY_SCHEMA[category]?.name || category || 'Другое';
}
