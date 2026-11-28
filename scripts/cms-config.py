# Generates public/admin/pro/config.yml (Sveltia CMS). Run: python3 scripts/cms-config.py
import yaml, sys
REPO = sys.argv[1] if len(sys.argv) > 1 else 'bgyordan/assyst-site'
CATS = ['Новини', 'Публикации', 'Статии', 'Обучения и събития']

def s(name, label, **kw): return {'name': name, 'label': label, 'widget': 'string', **kw}
def t(name, label, **kw): return {'name': name, 'label': label, 'widget': 'text', **kw}
def mdw(name, label, **kw): return {'name': name, 'label': label, 'widget': 'markdown', 'buttons': ['bold', 'italic', 'link', 'heading-two', 'heading-three', 'bulleted-list', 'numbered-list', 'quote'], **kw}
def b(name, label, **kw): return {'name': name, 'label': label, 'widget': 'boolean', 'required': False, **kw}
def img(name, label, **kw): return {'name': name, 'label': label, 'widget': 'image', 'required': False, **kw}
def opt(f): return {**f, 'required': False}
link = [s('text', 'Текст'), s('link', 'Връзка (напр. /kontakti/)'), b('outline', 'Прозрачен бутон')]
stat = [s('value', 'Число / стойност'), s('label', 'Описание')]
item = [opt(s('meta', 'Надзаглавие')), opt(s('title', 'Заглавие')), opt(t('text', 'Текст')), opt(s('link', 'Връзка'))]
TITLE_HINT = 'Думи между *звездички* се показват в цветен курсив.'
lbl = opt(s('label', 'Малък надпис над секцията'))
head = opt(s('heading', 'Заглавие', hint=TITLE_HINT))

types = [
  {'name': 'text', 'label': 'Текст', 'widget': 'object', 'fields': [lbl, head, opt(mdw('body', 'Текст')),
    opt(s('aside_big', 'Странично каре: голямо число')), opt(s('aside_title', 'Странично каре: заглавие')),
    {'name': 'aside_items', 'label': 'Странично каре: списък', 'widget': 'list', 'required': False},
    b('aside_contacts', 'Странично каре: покажи телефон и имейл'), opt(t('aside_note', 'Странично каре: бележка'))]},
  {'name': 'cards', 'label': 'Карти', 'widget': 'object', 'fields': [lbl, head, opt(mdw('intro', 'Въвеждащ текст')),
    {'name': 'style', 'label': 'Вид', 'widget': 'select', 'required': False, 'options': [
      {'label': 'Обикновени', 'value': 'plain'}, {'label': 'Номерирани (01, 02…)', 'value': 'numbered'},
      {'label': 'Връзки със стрелка', 'value': 'links'}, {'label': 'Букви (ASSYST)', 'value': 'letters'}, {'label': 'Времева линия', 'value': 'timeline'}]},
    {'name': 'columns', 'label': 'Колони', 'widget': 'select', 'options': [2, 3, 4, 6], 'default': 3, 'required': False},
    {'name': 'items', 'label': 'Карти', 'widget': 'list', 'fields': item, 'summary': '{{fields.title}}'},
    opt(s('note', 'Бележка под картите'))]},
  {'name': 'stats', 'label': 'Числа (статистика)', 'widget': 'object', 'fields': [lbl, head,
    {'name': 'stats', 'label': 'Числа', 'widget': 'list', 'fields': stat, 'summary': '{{fields.value}} {{fields.label}}'}]},
  {'name': 'mission', 'label': 'Тъмно каре с мисия и числа', 'widget': 'object', 'fields': [lbl, head, opt(t('text', 'Текст')),
    {'name': 'stats', 'label': 'Числа', 'widget': 'list', 'fields': stat, 'required': False}]},
  {'name': 'list', 'label': 'Списък (ценности / етикети)', 'widget': 'object', 'fields': [lbl, head,
    {'name': 'style', 'label': 'Вид', 'widget': 'select', 'required': False, 'options': [{'label': 'Номериран списък', 'value': 'values'}, {'label': 'Етикети', 'value': 'chips'}]},
    {'name': 'items', 'label': 'Елементи', 'widget': 'list'}]},
  {'name': 'quote', 'label': 'Цитат', 'widget': 'object', 'fields': [t('text', 'Цитат')]},
  {'name': 'cta', 'label': 'Призив (синьо каре с бутон)', 'widget': 'object', 'fields': [s('heading', 'Заглавие', hint=TITLE_HINT), opt(t('text', 'Текст')),
    {'name': 'buttons', 'label': 'Бутони', 'widget': 'list', 'fields': link, 'required': False}, b('contacts', 'Покажи телефон и имейл')]},
  {'name': 'team', 'label': 'Екип (от раздел „Екип“)', 'widget': 'object', 'fields': [lbl, head, b('profiles', 'Покажи и пълните биографии')]},
  {'name': 'documents', 'label': 'Документи (от раздел „Документи“)', 'widget': 'object', 'fields': [lbl, head]},
  {'name': 'posts', 'label': 'Последни публикации', 'widget': 'object', 'fields': [lbl, head,
    {'name': 'count', 'label': 'Брой', 'widget': 'number', 'default': 3, 'value_type': 'int'}, b('filters', 'Покажи филтър по категории')]},
  {'name': 'events', 'label': 'Събития (от раздел „Събития“)', 'widget': 'object', 'fields': [lbl, head]},
  {'name': 'contact', 'label': 'Контакти + форма', 'widget': 'object', 'fields': [lbl]},
]
page_fields = [
  {'name': 'slug', 'label': 'Адрес', 'widget': 'hidden'},
  s('title', 'Заглавие (в менюто и раздела на браузъра)'),
  opt(t('description', 'Описание за Google (до 160 знака)')),
  {'name': 'hero', 'label': 'Горна част (заглавие)', 'widget': 'object', 'collapsed': False, 'fields': [
    opt(s('label', 'Малък надпис')), s('title', 'Голямо заглавие', hint=TITLE_HINT), opt(s('subtitle', 'Подзаглавие')),
    opt(mdw('text', 'Текст')), opt(s('watermark', 'Голям блед надпис на фона')),
    {'name': 'style', 'label': 'Вид', 'widget': 'select', 'required': False, 'options': [{'label': 'Светъл', 'value': 'plain'}, {'label': 'Голяма снимка', 'value': 'image'}]},
    img('image', 'Снимка (за вид „Голяма снимка“)'),
    {'name': 'buttons', 'label': 'Бутони', 'widget': 'list', 'fields': link, 'required': False},
    {'name': 'links', 'label': 'Карти вдясно (само при снимка)', 'widget': 'list', 'fields': item, 'required': False},
    {'name': 'stats', 'label': 'Числа под снимката', 'widget': 'list', 'fields': stat, 'required': False}]},
  opt(mdw('body', 'Основен текст (за прости страници)')),
  {'name': 'sections', 'label': 'Секции на страницата', 'widget': 'list', 'required': False, 'types': types, 'typeKey': 'type', 'summary': '{{fields.label}} {{fields.heading}}'},
]
PAGES = [('home', 'Начало'), ('about-us', 'За нас'), ('ekip', 'Екип'), ('dokumenti', 'Документи'), ('assyst', 'ASSYST'),
         ('krizisna', 'Кризисна помощ'), ('dari', 'Дари'), ('kontakti', 'Контакти'), ('blog', 'Блог'), ('privacy-policy', 'Политика за поверителност')]

config = {
  'backend': {'name': 'github', 'repo': REPO, 'branch': 'main', 'base_url': 'https://assyst.bg', 'auth_endpoint': 'api/auth',
              'commit_messages': {'create': 'Ново: {{slug}}', 'update': 'Промяна: {{slug}}', 'delete': 'Изтрито: {{slug}}', 'uploadMedia': 'Качен файл: {{path}}', 'deleteMedia': 'Изтрит файл: {{path}}'}},
  'site_url': 'https://assyst.bg', 'display_url': 'https://assyst.bg', 'logo': {'src': '/logo.png'},
  'media_folder': 'public/uploads', 'public_folder': '/uploads',
  'slug': {'encoding': 'unicode', 'clean_accents': False, 'sanitize_replacement': '-'},
  'collections': [
    {'name': 'posts', 'label': 'Новини и статии', 'label_singular': 'публикация', 'folder': 'src/content/posts', 'create': True,
     'slug': '{{title}}', 'extension': 'md', 'format': 'frontmatter', 'sortable_fields': ['date', 'title'],
     'summary': '{{title}} ({{date | date(\'DD.MM.YYYY\')}})', 'preview_path': '/{{slug}}/',
     'fields': [s('title', 'Заглавие'), {'name': 'date', 'label': 'Дата', 'widget': 'datetime', 'time_format': False, 'date_format': 'DD.MM.YYYY', 'format': 'YYYY-MM-DD'},
       {'name': 'categories', 'label': 'Категории', 'widget': 'select', 'multiple': True, 'options': CATS, 'default': ['Новини']},
       img('image', 'Главна снимка'), img('gallery', 'Още снимки (галерия)', multiple=True), opt(t('excerpt', 'Кратко резюме (за списъка и Google)')), b('draft', 'Чернова (не се показва на сайта)'),
       mdw('body', 'Текст', buttons=None)]},
    {'name': 'events', 'label': 'Събития и обучения', 'label_singular': 'събитие', 'folder': 'src/content/events', 'create': True,
     'slug': '{{title}}', 'extension': 'md', 'format': 'frontmatter', 'summary': '{{title}} ({{start | date(\'DD.MM.YYYY\')}})',
     'fields': [s('title', 'Заглавие'), {'name': 'start', 'label': 'Начална дата', 'widget': 'datetime', 'time_format': False, 'date_format': 'DD.MM.YYYY', 'format': 'YYYY-MM-DD'},
       {'name': 'end', 'label': 'Крайна дата', 'widget': 'datetime', 'time_format': False, 'date_format': 'DD.MM.YYYY', 'format': 'YYYY-MM-DD', 'required': False},
       opt(s('time', 'Час (напр. 10:00 – 17:00)')), opt(s('location', 'Място')), img('image', 'Снимка'), img('gallery', 'Още снимки (галерия)', multiple=True), opt(s('link', 'Връзка за регистрация')),
       mdw('body', 'Описание', buttons=None)]},
    {'name': 'team', 'label': 'Екип', 'label_singular': 'член на екипа', 'folder': 'src/content/team', 'create': True, 'slug': '{{name}}',
     'identifier_field': 'name', 'summary': '{{name}} – {{role}}', 'sortable_fields': ['order', 'name'],
     'fields': [s('name', 'Име'), opt(s('role', 'Позиция (напр. Председател на УС)')), opt(s('short', 'Кратко описание (под снимката)')),
       opt(s('tagline', 'Надпис над биографията')), img('photo', 'Снимка'), {'name': 'order', 'label': 'Подредба (1 = първи)', 'widget': 'number', 'value_type': 'int', 'default': 10},
       mdw('body', 'Биография', required=False)]},
    {'name': 'documents', 'label': 'Документи', 'label_singular': 'документ', 'folder': 'src/content/documents', 'create': True, 'slug': '{{title}}',
     'extension': 'yml', 'format': 'yaml', 'sortable_fields': ['order', 'title'],
     'fields': [s('title', 'Име на документа'), opt(s('description', 'Описание')),
       {'name': 'file', 'label': 'Файл (PDF)', 'widget': 'file', 'required': False, 'hint': 'Ако няма файл, документът се показва като „Предстои“.'},
       {'name': 'order', 'label': 'Подредба', 'widget': 'number', 'value_type': 'int', 'default': 10}]},
    {'name': 'pages', 'label': 'Страници', 'label_singular': 'страница', 'files': [
       {'name': n, 'label': l, 'file': f'src/content/pages/{n}.yml', 'fields': page_fields} for n, l in PAGES]},
    {'name': 'settings', 'label': 'Настройки на сайта', 'files': [
       {'name': 'site', 'label': 'Контакти, меню и общи', 'file': 'src/data/settings.yml', 'fields': [
         s('site_name', 'Име на сайта'), s('tagline', 'Подзаглавие'), img('logo', 'Лого'),
         s('phone', 'Телефон'), s('email', 'Имейл'), opt(s('facebook', 'Facebook страница')),
         s('footer_text', 'Текст в долния край', hint='{year} се заменя с текущата година.'),
         {'name': 'menu', 'label': 'Главно меню', 'widget': 'list', 'summary': '{{fields.text}}', 'fields': [
           s('text', 'Текст'), s('link', 'Връзка'),
           {'name': 'children', 'label': 'Подменю', 'widget': 'list', 'required': False, 'fields': [s('text', 'Текст'), s('link', 'Връзка')]}]},
         {'name': 'donate_button', 'label': 'Бутон „Дари“', 'widget': 'object', 'fields': [s('text', 'Текст'), s('link', 'Връзка')]},
         {'name': 'categories', 'label': 'Категории на блога', 'widget': 'list', 'summary': '{{fields.name}}',
          'hint': 'Ако добавите категория, добавете я и в настройката на „Новини и статии“ (помолете администратора).',
          'fields': [s('name', 'Име'), s('slug', 'Адрес (латиница, напр. novini)')]}]}]},
  ],
}
for c in config['collections']:
    for f in c.get('fields', []):
        if f.get('buttons') is None: f.pop('buttons', None)
open('public/admin/pro/config.yml', 'w').write('# Generated by scripts/cms-config.py – edit that file instead.\n' + yaml.dump(config, allow_unicode=True, sort_keys=False, width=200))
print('ok')
