// What can be edited, described in plain Bulgarian.
import type { Field } from './forms';

export const CATEGORIES = ['Новини', 'Публикации', 'Статии', 'Обучения и събития'];

const TITLE_HINT = 'Думи между *звездички* излизат в цветен курсив.';
const label: Field = { key: 'label', label: 'Малък надпис над секцията', type: 'text' };
const heading: Field = { key: 'heading', label: 'Заглавие', type: 'text', hint: TITLE_HINT };
const buttons: Field = { key: 'buttons', label: 'Бутони', type: 'list', itemLabel: 'Бутон', fields: [
  { key: 'text', label: 'Надпис на бутона', type: 'text' },
  { key: 'link', label: 'Води към', type: 'text', placeholder: '/kontakti/' },
] };
const stats: Field = { key: 'stats', label: 'Числа', type: 'list', itemLabel: 'Число', fields: [
  { key: 'value', label: 'Число', type: 'text', placeholder: '90+' },
  { key: 'label', label: 'Какво означава', type: 'text' },
] };

export const SECTION_TYPES: Record<string, { name: string; icon: string; desc: string; fields: Field[] }> = {
  text: { name: 'Текст', icon: '📝', desc: 'Заглавие и текст, по желание с каре отстрани', fields: [
    label, heading, { key: 'body', label: 'Текст', type: 'rich' },
    { key: 'aside_big', label: 'Каре отстрани: голямо число', type: 'text' },
    { key: 'aside_title', label: 'Каре отстрани: заглавие', type: 'text' },
    { key: 'aside_items', label: 'Каре отстрани: списък', type: 'strings', addLabel: 'Добави точка' },
    { key: 'aside_contacts', label: 'Покажи телефона и имейла в карето', type: 'bool' },
    { key: 'aside_note', label: 'Каре отстрани: бележка', type: 'textarea' },
  ] },
  cards: { name: 'Карти', icon: '🗂', desc: 'Няколко карти с заглавие и кратък текст', fields: [
    label, heading, { key: 'intro', label: 'Въвеждащ текст', type: 'rich', small: true },
    { key: 'style', label: 'Вид на картите', type: 'select', options: [
      { value: 'plain', label: 'Обикновени' }, { value: 'numbered', label: 'С номера 01, 02, 03…' },
      { value: 'links', label: 'Връзки със стрелка' }, { value: 'letters', label: 'Големи букви' }, { value: 'timeline', label: 'Етапи' }] },
    { key: 'columns', label: 'Карти на ред', type: 'select', options: [{ value: 3, label: '3' }, { value: 2, label: '2' }, { value: 4, label: '4' }, { value: 6, label: '6' }] },
    { key: 'items', label: 'Карти', type: 'list', itemLabel: 'Карта', fields: [
      { key: 'meta', label: 'Малък надпис (по желание)', type: 'text' },
      { key: 'title', label: 'Заглавие', type: 'text' },
      { key: 'text', label: 'Текст', type: 'textarea' },
      { key: 'link', label: 'Води към (по желание)', type: 'text', placeholder: '/kontakti/' },
    ] },
    { key: 'note', label: 'Бележка под картите', type: 'text' },
  ] },
  stats: { name: 'Числа', icon: '🔢', desc: 'Големи числа с кратко описание', fields: [label, heading, stats] },
  mission: { name: 'Тъмно каре', icon: '🟦', desc: 'Тъмносиньо каре с текст и числа', fields: [label, heading, { key: 'text', label: 'Текст', type: 'textarea' }, stats] },
  list: { name: 'Списък', icon: '📋', desc: 'Номериран списък или етикети', fields: [
    label, heading,
    { key: 'style', label: 'Вид', type: 'select', options: [{ value: 'values', label: 'Номериран списък' }, { value: 'chips', label: 'Етикети' }] },
    { key: 'items', label: 'Точки', type: 'strings', addLabel: 'Добави точка' },
  ] },
  quote: { name: 'Цитат', icon: '❝', desc: 'Голям цитат в средата', fields: [{ key: 'text', label: 'Цитат', type: 'textarea' }] },
  cta: { name: 'Синьо каре с бутон', icon: '📣', desc: 'Призив за действие с бутон', fields: [
    heading, { key: 'text', label: 'Текст', type: 'textarea' }, buttons,
    { key: 'contacts', label: 'Покажи телефона и имейла', type: 'bool' },
  ] },
  team: { name: 'Екипът', icon: 'users', desc: 'Показва хората от раздел „Екип“', fields: [label, heading, { key: 'profiles', label: 'Покажи и пълните биографии', type: 'bool' }] },
  documents: { name: 'Документите', icon: 'file', desc: 'Показва файловете от раздел „Документи“', fields: [label, heading] },
  posts: { name: 'Последни новини', icon: 'news', desc: 'Показва последните публикации', fields: [
    label, heading, { key: 'count', label: 'Колко да се показват', type: 'number' },
    { key: 'filters', label: 'Покажи бутони за категориите', type: 'bool' },
  ] },
  events: { name: 'Събития', icon: 'calendar', desc: 'Показва събитията', fields: [label, heading] },
  contact: { name: 'Форма за контакт', icon: '✉️', desc: 'Телефон, имейл и форма за съобщение', fields: [label] },
};

export const HERO_FIELDS: Field[] = [
  { key: 'label', label: 'Малък надпис над заглавието', type: 'text' },
  { key: 'title', label: 'Голямо заглавие', type: 'text', hint: TITLE_HINT, big: true },
  { key: 'subtitle', label: 'Подзаглавие', type: 'text' },
  { key: 'text', label: 'Текст до заглавието', type: 'rich', small: true },
  { key: 'image', label: 'Голяма снимка на фона (само за началната страница)', type: 'image' },
  buttons,
];

export const PAGES: { file: string; name: string; url: string }[] = [
  { file: 'home', name: 'Начало', url: '/' },
  { file: 'about-us', name: 'За нас', url: '/about-us/' },
  { file: 'ekip', name: 'Екип', url: '/екип/' },
  { file: 'assyst', name: 'ASSYST', url: '/assyst/' },
  { file: 'krizisna', name: 'Кризисна помощ', url: '/krizisna/' },
  { file: 'dokumenti', name: 'Документи', url: '/dokumenti/' },
  { file: 'dari', name: 'Дари', url: '/dari/' },
  { file: 'kontakti', name: 'Контакти', url: '/kontakti/' },
  { file: 'blog', name: 'Блог', url: '/blog/' },
  { file: 'privacy-policy', name: 'Политика за поверителност', url: '/privacy-policy/' },
  { file: 'cookie-policy', name: 'Политика за бисквитки', url: '/cookie-policy/' },
  { file: 'obshti-usloviya', name: 'Общи условия', url: '/obshti-usloviya/' },
];

export type Coll = {
  key: string; name: string; one: string; dir: string; ext: 'md' | 'yml'; icon: string; addLabel: string;
  titleKey: string; dateKey?: string; imageKey?: string; url?: (id: string) => string; sortKey: string; sortDesc?: boolean;
  fields: Field[]; bodyLabel?: string; defaults: () => Record<string, any>;
};

export const COLLECTIONS: Coll[] = [
  { key: 'posts', name: 'Новини и статии', one: 'новина', dir: 'src/content/posts', ext: 'md', icon: 'news', addLabel: 'Напиши новина',
    titleKey: 'title', dateKey: 'date', imageKey: 'image', url: (id) => `/${id}/`, sortKey: 'date', sortDesc: true,
    bodyLabel: 'Текст на новината',
    defaults: () => ({ date: new Date().toISOString().slice(0, 10), categories: ['Новини'] }),
    fields: [
      { key: 'title', label: 'Заглавие', type: 'text', big: true, placeholder: 'Напишете заглавие…' },
      { key: 'date', label: 'Дата', type: 'date' },
      { key: 'categories', label: 'Категория', type: 'chips', options: CATEGORIES, hint: 'Изберете една или повече.' },
      { key: 'image', label: 'Главна снимка', type: 'image', hint: 'Показва се в списъка с новини и най-горе в статията.' },
    ] },
  { key: 'events', name: 'Събития и обучения', one: 'събитие', dir: 'src/content/events', ext: 'md', icon: 'calendar', addLabel: 'Добави събитие',
    titleKey: 'title', dateKey: 'start', imageKey: 'image', url: (id) => `/event/${id}/`, sortKey: 'start', sortDesc: true,
    bodyLabel: 'Описание на събитието',
    defaults: () => ({ start: new Date().toISOString().slice(0, 10) }),
    fields: [
      { key: 'title', label: 'Име на събитието', type: 'text', big: true },
      { key: 'start', label: 'Начална дата', type: 'date' },
      { key: 'end', label: 'Крайна дата (ако е повече от един ден)', type: 'date' },
      { key: 'time', label: 'Час', type: 'text', placeholder: '10:00 – 17:00' },
      { key: 'location', label: 'Място', type: 'text', placeholder: 'София, ул. …' },
      { key: 'image', label: 'Снимка', type: 'image' },
      { key: 'link', label: 'Връзка за записване (по желание)', type: 'url', placeholder: 'https://…' },
    ] },
  { key: 'team', name: 'Екип', one: 'член на екипа', dir: 'src/content/team', ext: 'md', icon: 'users', addLabel: 'Добави човек',
    titleKey: 'name', imageKey: 'photo', sortKey: 'order', bodyLabel: 'Биография',
    defaults: () => ({ order: 10 }),
    fields: [
      { key: 'name', label: 'Име и фамилия', type: 'text', big: true },
      { key: 'role', label: 'Позиция', type: 'text', placeholder: 'Член на УС' },
      { key: 'short', label: 'Кратко описание под снимката', type: 'text', placeholder: 'Психолог' },
      { key: 'tagline', label: 'Надпис над биографията', type: 'text', placeholder: 'Психолог • Кризисна интервенция' },
      { key: 'photo', label: 'Снимка', type: 'image' },
      { key: 'order', label: 'Подредба (1 = първи)', type: 'number' },
    ] },
  { key: 'documents', name: 'Документи', one: 'документ', dir: 'src/content/documents', ext: 'yml', icon: 'file', addLabel: 'Качи документ',
    titleKey: 'title', sortKey: 'order',
    defaults: () => ({ order: 10 }),
    fields: [
      { key: 'title', label: 'Име на документа', type: 'text', big: true },
      { key: 'description', label: 'Кратко описание', type: 'text' },
      { key: 'file', label: 'Файл', type: 'file', hint: 'Ако няма файл, документът се показва като „Предстои“.' },
      { key: 'order', label: 'Подредба (1 = първи)', type: 'number' },
    ] },
];

export const SETTINGS_FIELDS: Field[] = [
  { key: 'phone', label: 'Телефон', type: 'text' },
  { key: 'email', label: 'Имейл', type: 'email' },
  { key: 'facebook', label: 'Facebook страница', type: 'url' },
  { key: 'legal_name', label: 'Пълно име на сдружението', type: 'text', hint: 'Показва се във футъра и в правните страници.' },
  { key: 'eik', label: 'ЕИК', type: 'text' },
  { key: 'address', label: 'Седалище и адрес на управление', type: 'text' },
  { key: 'footer_text', label: 'Текст в най-долната част', type: 'text', hint: '{year} се заменя с текущата година.' },
  { key: 'menu', label: 'Главно меню', type: 'list', itemLabel: 'Бутон в менюто', fields: [
    { key: 'text', label: 'Надпис', type: 'text' },
    { key: 'link', label: 'Води към', type: 'text' },
    { key: 'children', label: 'Падащо подменю', type: 'list', itemLabel: 'Подточка', fields: [
      { key: 'text', label: 'Надпис', type: 'text' }, { key: 'link', label: 'Води към', type: 'text' }] },
  ] },
];
