import * as api from './api';
import { h, toast, confirmBox, busy, fmtDate, isoDate, niceError } from './ui';
import { renderFields, type Ctx, type Field } from './forms';
import { richEditor } from './editor';
import { COLLECTIONS, PAGES, SECTION_TYPES, HERO_FIELDS, SETTINGS_FIELDS, type Coll } from './schema';
import { previews } from './previews';
import { icon } from './icons';

const root = document.getElementById('app')!;
let user: api.Me | null = null;
let dirty = false;
const cache = new Map<string, Entry[]>();
type Entry = { file: api.RepoFile; data: Record<string, any>; body: string; sha: string; id: string };

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', async () => {
  if (dirty && !(await confirmBox('Незапазени промени', 'Имате промени, които не са запазени. Да ги изоставим ли?', 'Изостави промените', true))) {
    history.back();
    return;
  }
  dirty = false;
  route();
});

// ---------- layout ----------
function shell(title: string, ...content: (Node | false | null | undefined)[]) {
  root.innerHTML = '';
  root.append(
    h('header', { class: 'top' },
      h('a', { href: '#/', class: 'brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'Админ панел')),
      h('div', { class: 'top-right' },
        statusEl,
        h('a', { class: 'top-link', href: '/', target: '_blank' }, h('span', null, 'Виж сайта'), icon('ext', 15)),
        user && h('button', { class: 'user', title: 'Изход', onclick: async () => { await api.logout(); location.reload(); } },
          h('span', null, user.name || user.login), icon('out', 16)),
      ),
    ),
    h('main', { class: 'wrap' }, ...(content[0] instanceof HTMLAnchorElement && content[0].classList.contains('back') ? [content.shift()!, h('h1', null, title)] : [h('h1', null, title)]), ...content),
    h('footer', { class: 'foot' }, 'Нужно е нещо по-сложно? ', h('a', { href: '/admin/pro/' }, 'Разширен режим')),
  );
  window.scrollTo(0, 0);
}
const back = (href: string, text = 'Назад') => h('a', { class: 'back', href }, '← ' + text);

// ---------- publish status ----------
const statusEl = h('div', { class: 'status', title: 'Състояние на сайта' });
let pollTimer: number | undefined;
async function refreshStatus() {
  const s = await api.publishStatus();
  const recentSave = api.lastCommitAt && Date.now() - api.lastCommitAt < 15000;
  const running = s.state === 'running' || (recentSave && s.state !== 'failed');
  statusEl.className = 'status ' + (running ? 'run' : s.state === 'failed' ? 'bad' : 'ok');
  statusEl.textContent = running ? 'Публикува се… (около 1–2 мин)' : s.state === 'failed' ? 'Публикуването не успя' : 'Сайтът е актуален';
  clearTimeout(pollTimer);
  if (running) pollTimer = window.setTimeout(refreshStatus, 8000);
}
const afterSave = () => { setTimeout(refreshStatus, 300); };

// ---------- uploads ----------
async function upload(file: File, kind: 'image' | 'file'): Promise<string | undefined> {
  try {
    const now = new Date();
    const dir = `public/uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    let bytes: Uint8Array, ext: string;
    const base = api.fileSlug(file.name.replace(/\.[^.]+$/, ''));
    if (kind === 'image' && /image\/(jpeg|png|webp|heic|heif)/.test(file.type)) {
      ({ bytes, ext } = await shrinkImage(file));
    } else {
      if (file.size > 20 * 1024 * 1024) { toast('Файлът е по-голям от 20 MB. Моля, намалете го.', 'err'); return; }
      bytes = new Uint8Array(await file.arrayBuffer());
      ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    }
    toast('Качване…', 'info');
    const path = await api.uniquePath(dir, base, ext);
    await api.writeFile(path, api.b64encodeBytes(bytes), `Качен файл: ${path.split('/').pop()}`);
    const url = path.replace(/^public/, '');
    previews.set(url, URL.createObjectURL(new Blob([bytes as BlobPart])));
    afterSave();
    toast('Файлът е качен');
    return url;
  } catch (e) {
    toast(niceError(e), 'err');
  }
}

async function shrinkImage(file: File): Promise<{ bytes: Uint8Array; ext: string }> {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return { bytes: new Uint8Array(await file.arrayBuffer()), ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
  const max = 1800;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 400_000 && file.type !== 'image/heic') return { bytes: new Uint8Array(await file.arrayBuffer()), ext: file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg' };
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d')!;
  const png = file.type === 'image/png';
  if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(img, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), png ? 'image/png' : 'image/jpeg', 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: png ? 'png' : 'jpg' };
}

function newCtx(): Ctx {
  return { collectors: [], upload, dirty: () => { dirty = true; } };
}

// ---------- data ----------
async function loadColl(c: Coll, force = false): Promise<Entry[]> {
  if (!force && cache.has(c.key)) return cache.get(c.key)!;
  const files = (await api.listDir(c.dir)).filter((f) => f.type === 'file' && f.name.endsWith('.' + c.ext));
  const out: Entry[] = [];
  const queue = [...files];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const f = queue.shift()!;
      const { text, sha } = await api.readFile(f.path);
      const parsed = c.ext === 'md' ? api.parseMd(text) : { data: api.parseYaml(text), body: '' };
      out.push({ file: f, data: parsed.data, body: parsed.body, sha, id: f.name.replace(/\.[^.]+$/, '') });
    }
  }));
  const k = c.sortKey;
  out.sort((a, b) => {
    const va = a.data[k], vb = b.data[k];
    const r = typeof va === 'number' || typeof vb === 'number' ? (va ?? 99) - (vb ?? 99) : String(isoDate(va) || va || '').localeCompare(String(isoDate(vb) || vb || ''));
    return c.sortDesc ? -r : r;
  });
  cache.set(c.key, out);
  return out;
}

// ---------- views ----------
async function dashboard() {
  const tiles = h('div', { class: 'tiles' });
  shell(`Здравейте${user?.name ? ', ' + user.name.split(' ')[0] : ''}!`,
    h('p', { class: 'lead' }, 'Какво искате да направите днес?'),
    h('div', { class: 'quick' },
      h('a', { class: 'quick-btn primary', href: '#/c/posts/new' }, icon('pen', 26), h('span', null, h('b', null, 'Напиши новина'), h('small', null, 'Статия, съобщение или новина за блога'))),
      h('a', { class: 'quick-btn', href: '#/c/events/new' }, icon('calendar', 26), h('span', null, h('b', null, 'Добави събитие'), h('small', null, 'Обучение, среща или друго събитие'))),
      h('a', { class: 'quick-btn', href: '#/c/documents/new' }, icon('upload', 26), h('span', null, h('b', null, 'Качи документ'), h('small', null, 'PDF файл за страница „Документи“'))),
    ),
    h('h2', null, 'Всичко в сайта'),
    tiles,
  );
  const tile = (href: string, ic: string, title: string, sub: string) =>
    h('a', { class: 'tile', href }, icon(ic, 22), h('b', null, title), h('small', null, sub));
  tiles.append(
    ...COLLECTIONS.map((c) => tile(`#/c/${c.key}`, c.icon, c.name, 'Преглед и редакция')),
    tile('#/pages', 'layout', 'Страници', 'Текстовете на всички страници'),
    tile('#/settings', 'phone', 'Контакти и меню', 'Телефон, имейл, Facebook, меню'),
  );
}

async function listView(c: Coll) {
  const listEl = h('div', { class: 'list' }, h('div', { class: 'loading-row' }, h('span', { class: 'spin' }), ' Зареждане…'));
  const search = h('input', { type: 'search', placeholder: 'Търсене…', class: 'search', oninput: () => draw() });
  shell(c.name, back('#/', 'Начало'),
    h('div', { class: 'row between' }, search, h('a', { class: 'btn', href: `#/c/${c.key}/new` }, c.addLabel)),
    listEl);
  let items: Entry[] = [];
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    listEl.innerHTML = '';
    const shown = items.filter((e) => !q || String(e.data[c.titleKey] || '').toLowerCase().includes(q));
    if (!shown.length) listEl.append(h('p', { class: 'muted empty' }, q ? 'Нищо не е намерено.' : 'Все още няма записи. Натиснете „' + c.addLabel + '“.'));
    for (const e of shown) {
      const img = c.imageKey && e.data[c.imageKey];
      listEl.append(h('div', { class: 'list-item' },
        h('a', { class: 'li-main', href: `#/c/${c.key}/edit/${encodeURIComponent(e.file.name)}` },
          c.imageKey ? h('span', { class: 'thumb' }, img ? h('img', { src: previews.get(img) || img, alt: '', loading: 'lazy' }) : icon(c.icon, 22)) : h('span', { class: 'thumb' }, icon(c.icon, 22)),
          h('span', { class: 'li-text' },
            h('b', null, e.data[c.titleKey] || '(без заглавие)'),
            h('small', null, [
              c.dateKey && fmtDate(e.data[c.dateKey]),
              e.data.categories?.join(', '),
              e.data.role,
              e.data.draft ? 'скрита' : '',
              c.key === 'documents' ? (e.data.file ? 'има файл' : 'предстои') : '',
            ].filter(Boolean).join(' · ')),
          ),
        ),
        h('div', { class: 'li-tools' },
          h('a', { class: 'btn ghost small', href: `#/c/${c.key}/edit/${encodeURIComponent(e.file.name)}` }, 'Редактирай'),
          c.url && !e.data.draft && h('a', { class: 'btn ghost small', href: c.url(e.id), target: '_blank' }, 'Виж'),
          h('button', { class: 'btn ghost small danger', onclick: async () => {
            if (!(await confirmBox(`Изтриване`, `Сигурни ли сте, че искате да изтриете „${e.data[c.titleKey]}“? Това не може да се отмени от тук.`, 'Изтрий', true))) return;
            try {
              await api.deleteFile(e.file.path, e.sha, `Изтрито: ${e.data[c.titleKey]}`);
              cache.delete(c.key); afterSave(); toast('Изтрито'); listView(c);
            } catch (err) { toast(niceError(err), 'err'); }
          } }, 'Изтрий'),
        ),
      ));
    }
  };
  try { items = await loadColl(c); draw(); } catch (e) { listEl.innerHTML = ''; listEl.append(h('p', { class: 'err' }, niceError(e))); }
}

async function editView(c: Coll, fileName?: string) {
  const isNew = !fileName;
  let entry: Entry | undefined;
  if (!isNew) {
    const items = await loadColl(c);
    entry = items.find((e) => e.file.name === fileName);
    if (!entry) { toast('Записът не е намерен.', 'err'); location.hash = `#/c/${c.key}`; return; }
    // re-read to get the latest version
    const { text, sha } = await api.readFile(entry.file.path);
    const p = c.ext === 'md' ? api.parseMd(text) : { data: api.parseYaml(text), body: '' };
    entry = { ...entry, data: p.data, body: p.body, sha };
  }
  const data: Record<string, any> = isNew ? c.defaults() : structuredClone(entry!.data);
  for (const f of c.fields) if (f.type === 'date' && data[f.key]) data[f.key] = isoDate(data[f.key]);
  const ctx = newCtx();
  const body = c.bodyLabel ? richEditor({ value: entry?.body || '', placeholder: 'Започнете да пишете… Може да поставите текст от Word.', onImage: (f) => upload(f, 'image') }) : null;
  body?.el.addEventListener('input', () => { dirty = true; });

  const save = h('button', { class: 'btn big' }, isNew ? 'Публикувай' : 'Запази промените');
  save.addEventListener('click', () => busy(save, 'Записване…', async () => {
    ctx.collectors.forEach((fn) => fn());
    const title = String(data[c.titleKey] || '').trim();
    if (!title) { toast('Моля, попълнете заглавие.', 'err'); return; }
    if (c.key === 'posts' && !data.excerpt && body) {
      const plain = body.value.replace(/[#*_>\[\]()!`-]/g, ' ').replace(/\s+/g, ' ').trim();
      data.excerpt = plain.length > 220 ? plain.slice(0, 220).replace(/\s+\S*$/, '') + '…' : plain;
    }
    let md = body ? swapPreviews(body.value) : '';
    const text = c.ext === 'md' ? api.stringifyMd(cleanData(data), md) : api.stringifyYaml(cleanData(data));
    const path = isNew ? await api.uniquePath(c.dir, api.slugify(title), c.ext) : entry!.file.path;
    await api.writeFile(path, api.b64encodeText(text), `${isNew ? 'Ново' : 'Промяна'}: ${title}`, entry?.sha);
    dirty = false; cache.delete(c.key); afterSave();
    const id = path.split('/').pop()!.replace(/\.[^.]+$/, '');
    toast(isNew ? 'Публикувано! След 1–2 минути ще се появи на сайта.' : 'Запазено! След 1–2 минути промяната ще е на сайта.');
    if (isNew) location.hash = `#/c/${c.key}`; else editView(c, fileName);
    void id;
  }));

  shell(isNew ? c.addLabel : `Редакция на ${c.one}`,
    back(`#/c/${c.key}`, c.name),
    h('div', { class: 'editor-grid' },
      h('div', { class: 'card' },
        renderFields(data, c.fields.filter((f) => f.type !== 'image' && f.type !== 'file' && f.type !== 'chips' && f.key !== 'order' && f.type !== 'date' || f.key === 'title'), ctx),
        body && h('div', { class: 'field' }, h('label', { class: 'flabel' }, c.bodyLabel!), body.el),
        c.key === 'posts' && renderFields(data, [{ key: 'excerpt', label: 'Кратко резюме (по желание)', type: 'textarea', hint: 'Показва се в списъка с новини и в Google. Ако е празно, се взима началото на текста.' } as Field], ctx),
      ),
      h('aside', { class: 'side' },
        h('div', { class: 'card' },
          save,
          !isNew && c.url && !data.draft && h('a', { class: 'btn ghost', href: c.url(entry!.id), target: '_blank' }, 'Виж на сайта'),
          c.key === 'posts' && renderFields(data, [{ key: 'draft', label: 'Скрий от сайта (чернова)', type: 'bool' } as Field], ctx),
        ),
        h('div', { class: 'card' }, renderFields(data, c.fields.filter((f) => (f.type === 'date' || f.type === 'chips' || f.key === 'order') && f.key !== 'title'), ctx)),
        h('div', { class: 'card' }, renderFields(data, c.fields.filter((f) => f.type === 'image' || f.type === 'file'), ctx)),
      ),
    ),
  );
}

function cleanData(d: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === '' || v === undefined || v === null || (Array.isArray(v) && !v.length && k !== 'categories')) continue;
    if (k === 'draft' && v === false) continue;
    out[k] = v;
  }
  return out;
}
function swapPreviews(md: string) {
  for (const [url, blob] of previews) md = md.split(blob).join(url);
  return md;
}
function deepSwap(v: any): any {
  if (typeof v === 'string') return swapPreviews(v);
  if (Array.isArray(v)) return v.map(deepSwap);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepSwap(x)]));
  return v;
}

async function pagesList() {
  shell('Страници', back('#/', 'Начало'),
    h('p', { class: 'lead' }, 'Изберете страница, за да промените текстовете в нея.'),
    h('div', { class: 'tiles' }, PAGES.map((p) => h('a', { class: 'tile', href: `#/pages/${p.file}` }, icon('file', 22), h('b', null, p.name), h('small', null, p.url)))));
}

function cleanDeep(v: any): any {
  if (Array.isArray(v)) return v.map(cleanDeep).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const o: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = cleanDeep(x);
      if (c === '' || c === undefined || c === null || (Array.isArray(c) && !c.length)) continue;
      o[k] = c;
    }
    return o;
  }
  return v;
}

async function pageEdit(file: string) {
  const meta = PAGES.find((p) => p.file === file);
  if (!meta) { location.hash = '#/pages'; return; }
  const path = `src/content/pages/${file}.yml`;
  const { text, sha } = await api.readFile(path);
  const data = api.parseYaml(text);
  data.hero = data.hero || {};
  data.sections = data.sections || [];
  let ctx = newCtx();
  const sectionsBox = h('div', { class: 'sections' });
  const save = h('button', { class: 'btn big' }, 'Запази страницата');

  const drawSections = () => {
    ctx.collectors.forEach((fn) => fn()); // keep text typed so far
    ctx = { ...newCtx(), collectors: [] };
    heroCollectors.forEach((fn) => ctx.collectors.push(fn));
    if (bodyEd) ctx.collectors.push(() => { data.body = bodyEd!.value; });
    sectionsBox.innerHTML = '';
    data.sections.forEach((s: any, i: number) => {
      const t = SECTION_TYPES[s.type] || { name: s.type, icon: '▫️', desc: '', fields: [] };
      const move = (d: number) => { const j = i + d; if (j < 0 || j >= data.sections.length) return; [data.sections[i], data.sections[j]] = [data.sections[j], data.sections[i]]; dirty = true; drawSections(); };
      const details = h('details', { class: 'section-card' },
        h('summary', null,
                    h('span', { class: 'sec-title' }, h('b', null, (s.heading || s.label || t.name).replace(/\*/g, '')), h('small', null, t.name)),
          h('span', { class: 'item-tools' },
            h('button', { type: 'button', class: 'icon-btn', title: 'Премести нагоре', disabled: i === 0, onclick: (e: Event) => { e.preventDefault(); move(-1); } }, '↑'),
            h('button', { type: 'button', class: 'icon-btn', title: 'Премести надолу', disabled: i === data.sections.length - 1, onclick: (e: Event) => { e.preventDefault(); move(1); } }, '↓'),
            h('button', { type: 'button', class: 'icon-btn danger', title: 'Премахни секцията', onclick: async (e: Event) => {
              e.preventDefault();
              if (!(await confirmBox('Премахване на секция', `Да премахнем ли секцията „${t.name}“ от страницата?`, 'Премахни', true))) return;
              data.sections.splice(i, 1); dirty = true; drawSections();
            } }, '✕'),
          ),
        ),
        renderFields(s, t.fields, ctx),
      );
      sectionsBox.append(details);
    });
    sectionsBox.append(h('details', { class: 'add-section' },
      h('summary', { class: 'btn ghost' }, '+ Добави секция'),
      h('div', { class: 'section-types' }, Object.entries(SECTION_TYPES).map(([key, t]) =>
        h('button', { type: 'button', class: 'type-btn', onclick: () => {
          data.sections.push({ type: key }); dirty = true; drawSections();
          (sectionsBox.querySelectorAll('details.section-card')[data.sections.length - 1] as HTMLDetailsElement).open = true;
        } }, h('b', null, t.name), h('small', null, t.desc)))),
    ));
  };

  const heroCtx = newCtx();
  const heroCollectors = heroCtx.collectors;
  const heroEl = renderFields(data.hero, HERO_FIELDS.filter((f) => f.key !== 'image' || file === 'home'), heroCtx);
  let bodyEd: ReturnType<typeof richEditor> | null = null;
  if (data.body !== undefined) {
    bodyEd = richEditor({ value: data.body, placeholder: 'Текст на страницата…' });
    bodyEd.el.addEventListener('input', () => { dirty = true; });
  }

  save.addEventListener('click', () => busy(save, 'Записване…', async () => {
    ctx.collectors.forEach((fn) => fn());
    const out = cleanDeep(deepSwap(data));
    out.slug = data.slug; out.title = data.title;
    await api.writeFile(path, api.b64encodeText(api.stringifyYaml(out)), `Промяна: страница ${meta.name}`, currentSha);
    const fresh = await api.readFile(path); currentSha = fresh.sha;
    dirty = false; afterSave();
    toast('Запазено! След 1–2 минути промяната ще е на сайта.');
  }));
  let currentSha = sha;

  shell(`Страница: ${meta.name}`, back('#/pages', 'Страници'),
    h('div', { class: 'editor-grid' },
      h('div', null,
        h('div', { class: 'card' }, h('h2', null, 'Горна част на страницата'), heroEl),
        bodyEd && h('div', { class: 'card' }, h('h2', null, 'Текст'), bodyEd.el),
        h('h2', { class: 'mt' }, 'Секции'),
        h('p', { class: 'muted' }, 'Кликнете върху секция, за да я отворите. Със стрелките ги разместите.'),
        sectionsBox,
      ),
      h('aside', { class: 'side' }, h('div', { class: 'card sticky' }, save, h('a', { class: 'btn ghost', href: meta.url, target: '_blank' }, 'Виж страницата'),
        h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Описание за Google'), (() => {
          const ta = h('textarea', { rows: 4, oninput: () => { data.description = ta.value; dirty = true; } }, data.description || '');
          return ta;
        })()))),
    ),
  );
  drawSections();
}

async function settingsView() {
  const path = 'src/data/settings.yml';
  const { text, sha } = await api.readFile(path);
  const data = api.parseYaml(text);
  const ctx = newCtx();
  const save = h('button', { class: 'btn big' }, 'Запази');
  save.addEventListener('click', () => busy(save, 'Записване…', async () => {
    ctx.collectors.forEach((fn) => fn());
    await api.writeFile(path, api.b64encodeText(api.stringifyYaml(cleanDeep(data))), 'Промяна: контакти и меню', sha);
    dirty = false; afterSave(); toast('Запазено! След 1–2 минути промяната ще е на сайта.');
    settingsView();
  }));
  shell('Контакти и меню', back('#/', 'Начало'),
    h('div', { class: 'editor-grid' },
      h('div', { class: 'card' }, renderFields(data, SETTINGS_FIELDS, ctx)),
      h('aside', { class: 'side' }, h('div', { class: 'card sticky' }, save)),
    ));
}

// ---------- router ----------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  try {
    if (!parts[0]) return dashboard();
    if (parts[0] === 'c') {
      const c = COLLECTIONS.find((x) => x.key === parts[1]);
      if (!c) return dashboard();
      if (parts[2] === 'new') return editView(c);
      if (parts[2] === 'edit') return editView(c, parts[3]);
      return listView(c);
    }
    if (parts[0] === 'pages') return parts[1] ? pageEdit(parts[1]) : pagesList();
    if (parts[0] === 'settings') return settingsView();
    dashboard();
  } catch (e) {
    if (e instanceof api.LoginError) return loginView();
    shell('Грешка', back('#/', 'Начало'), h('p', { class: 'err' }, niceError(e)));
  }
}

function loginView(noAccess?: string) {
  root.innerHTML = '';
  root.append(h('div', { class: 'login' },
    h('div', { class: 'login-card' },
      h('img', { src: '/logo.png', alt: 'ASSYST BULGARIA', class: 'login-logo' }),
      h('h1', null, 'Админ панел'),
      noAccess
        ? h('p', { class: 'err' }, `Профилът „${noAccess}“ няма права да редактира сайта. Помолете администратора да ви добави.`)
        : h('p', null, 'Влезте, за да редактирате съдържанието на сайта.'),
      h('a', { class: 'btn big', href: '/api/auth?mode=session' }, 'Вход с GitHub'),
      noAccess && h('button', { class: 'link-btn', onclick: async () => { await api.logout(); location.reload(); } }, 'Вход с друг профил'),
    ),
  ));
}

(async () => {
  try {
    user = await api.me();
  } catch (e) {
    if (e instanceof api.NoAccessError) return loginView(e.message);
    return loginView();
  }
  refreshStatus();
  route();
})();
