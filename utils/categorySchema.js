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
 */
export function getCategorySchema(category) {
    return CATEGORY_SCHEMA[category] || CATEGORY_SCHEMA.other;
}

/**
 * Получить список категорий для select
 */
export function getCategoryOptions() {
    return Object.entries(CATEGORY_SCHEMA).map(([value, data]) => ({
        value,
        label: data.name
    }));
}

/**
 * Форматировать атрибуты для отображения
 */
export function formatAttributes(category, attributes) {
    if (!attributes || !Object.keys(attributes).length) return '';
    
    const schema = getCategorySchema(category);
    return schema.fields
        .filter(field => attributes[field.name])
        .map(field => `${field.label}: ${attributes[field.name]}`)
        .join(' • ');
}
