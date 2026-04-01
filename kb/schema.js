/**
 * Knowledge Base Schema
 *
 * Кожен документ має структуру:
 * {
 *   id: string,           // унікальний ідентифікатор
 *   category: string,     // категорія (services, contacts, structure, regulations, info)
 *   tags: string[],       // теги для пошуку
 *   title: string,        // заголовок
 *   content: string,      // повний текст
 *   metadata: {           // додаткові дані
 *     source: string,     // джерело інформації
 *     date: string,       // дата додавання
 *     updated: string,    // дата оновлення
 *   }
 * }
 */

const CATEGORIES = {
  services: 'Послуги',
  contacts: 'Контакти',
  structure: 'Структура',
  regulations: 'Нормативні акти',
  info: 'Загальна інформація',
};

module.exports = { CATEGORIES };
