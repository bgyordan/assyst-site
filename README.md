# assyst.bg

Сайтът на ASSYST BULGARIA: статичен сайт (Astro), хостван в Cloudflare (Workers + Static Assets),
с админ панел на `/admin/` (Sveltia CMS). Всяка промяна от админ панела се записва в това хранилище
и Cloudflare публикува сайта наново за около минута.

## Как се редактира

Отворете **https://assyst.bg/admin/** и влезте с GitHub акаунт, който има достъп до това хранилище.

| Раздел в админ панела | Какво съдържа |
|---|---|
| Новини и статии | Публикациите в блога (заглавие, дата, категории, снимка, текст) |
| Събития и обучения | Календар на събитията (`/events/`) |
| Екип | Членовете на екипа със снимка и биография (показват се на „За нас“ и „Екип“) |
| Документи | PDF документите на страница „Документи“ |
| Страници | Текстовете на всички страници, разделени на секции, които могат да се добавят, местят и трият |
| Настройки на сайта | Телефон, имейл, Facebook, меню, категории |

В заглавията думи между `*звездички*` се показват в цветен курсив.
Снимките и файловете се качват в `public/uploads/`.

## Разработка

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # статичните файлове в dist/
npx wrangler dev   # сайтът + /api (формата и входа) локално
```

* `src/content/` – съдържанието (Markdown/YAML), което админ панелът редактира
* `src/data/settings.yml` – общи настройки
* `src/components/Sections.astro` – видовете секции на страниците
* `worker/index.ts` – Cloudflare Worker: вход в админ панела (GitHub OAuth) и формата за контакти
* `scripts/cms-config.py` – генерира `public/admin/config.yml`
* `scripts/migrate.py` – еднократният пренос от WordPress (за справка)

Адресите на страниците и публикациите са същите като в стария WordPress сайт, а файловете са на
същите пътища под `/uploads/...` (вместо `/wp-content/uploads/...`, пренасочено в `public/_redirects`).

## Публикуване в Cloudflare (еднократна настройка)

1. **Домейн:** Cloudflare → *Add a domain* → `assyst.bg` (Free план). Проверете, че са прехвърлени всички DNS записи,
   и сменете nameserver-ите при регистратора на домейна с тези, които дава Cloudflare.
2. **Сайт:** Cloudflare → *Workers & Pages* → *Create* → *Import a repository* → това хранилище.
   Build command: `npm run build`, Deploy command: `npx wrangler deploy`.
3. **Собствен адрес:** в Worker-а `assyst-site` → *Settings* → *Domains & Routes* → добавете `assyst.bg` и `www.assyst.bg`.
4. **Вход в админ панела:** GitHub → *Settings* → *Developer settings* → *OAuth Apps* → *New OAuth App*:
   Homepage `https://assyst.bg`, Authorization callback URL `https://assyst.bg/api/callback`.
   В Worker-а → *Settings* → *Variables and Secrets* добавете `GITHUB_CLIENT_ID` и `GITHUB_CLIENT_SECRET` (като Secret).
5. **Форма за контакти:** Cloudflare → `assyst.bg` → *Email* → *Email Routing* → включете го и добавете
   `assystbulgaria@gmail.com` като destination address (потвърждава се от пощата). После разкоментирайте
   реда `send_email` в `wrangler.jsonc`.
