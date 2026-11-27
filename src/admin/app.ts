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
  document.body.classList.remove('has-actionbar');
  root.append(
    h('header', { class: 'top' },
      h('a', { href: '#/', class: 'brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'Админ панел')),
      h('div', { class: 'top-right' },
        statusEl,
        h('a', { class: 'top-link', href: '/', target: '_blank' }, h('span', null, 'Виж сайта'), icon('ext', 15)),
        user && h('details', { class: 'user-menu' },
          h('summary', { class: 'user' }, h('span', null, user.name || user.login), h('span', { class: 'caret' })),
          h('div', { class: 'menu' },
            user.kind === 'pw' && h('a', { href: '#/account' }, 'Смяна на паролата'),
            user.kind === 'github' && h('a', { href: '/admin/pro/' }, 'Разширен режим'),
            h('button', { onclick: async () => { await api.logout(); location.reload(); } }, icon('out', 15), 'Изход'),
          )),
      ),
    ),
    h('main', { class: 'wrap' }, ...(content[0] instanceof HTMLAnchorElement && content[0].classList.contains('back') ? [content.shift()!, h('h1', null, title)] : [h('h1', null, title)]), ...content),
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
    h('div', { class: 'card help' },
      h('h2', null, 'Как се публикува новина?'),
      h('ol', null,
        h('li', null, 'Натиснете ', h('b', null, '„Напиши новина“'), ' горе.'),
        h('li', null, 'Попълнете заглавие, снимка и текст. Текст от Word може просто да се постави.'),
        h('li', null, 'Натиснете ', h('b', null, '„Преглед“'), ', за да видите как изглежда, и после ', h('b', null, '„Публикувай“'), '.'),
      ),
      h('p', { class: 'muted' }, 'След 1–2 минути новината е на сайта. За поправка влезте в „Новини и статии“ и кликнете върху нея. Нищо не може да се развали необратимо: всяка промяна се пази и може да се върне.'),
    ),
  );
  const tile = (href: string, ic: string, title: string, sub: string) =>
    h('a', { class: 'tile', href }, icon(ic, 22), h('b', null, title), h('small', null, sub));
  tiles.append(
    ...COLLECTIONS.map((c) => tile(`#/c/${c.key}`, c.icon, c.name, 'Преглед и редакция')),
    tile('#/pages', 'layout', 'Страници', 'Текстовете на всички страници'),
    tile('#/settings', 'phone', 'Контакти и меню', 'Телефон, имейл, Facebook, меню'),
    ...(user?.admin ? [tile('#/users', 'users', 'Служители', 'Кой може да влиза в панела')] : []),
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
        ),
      ));
    }
  };
  try { items = await loadColl(c); draw(); } catch (e) { listEl.innerHTML = ''; listEl.append(h('p', { class: 'err' }, niceError(e))); }
}

const draftKey = (c: Coll) => `assyst_draft_${c.key}`;
function readDraft(c: Coll): { data: Record<string, any>; body: string; at: number } | null {
  try { const d = JSON.parse(localStorage.getItem(draftKey(c)) || 'null'); return d && (d.data?.[c.titleKey] || d.body) ? d : null; } catch { return null; }
}
const clearDraft = (c: Coll) => { try { localStorage.removeItem(draftKey(c)); } catch {} };

const step = (n: number, title: string, hint: string, ...content: (Node | false | null | undefined)[]) =>
  h('section', { class: 'card step' },
    h('div', { class: 'step-head' }, h('span', { class: 'step-n' }, String(n)), h('div', null, h('h2', null, title), hint && h('p', null, hint))),
    ...content);

async function editView(c: Coll, fileName?: string, restored?: { data: Record<string, any>; body: string }) {
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
  // A new entry that was not published last time: offer to continue it.
  if (isNew && !restored) {
    const d = readDraft(c);
    if (d) {
      const goOn = await confirmBox('Имате незавършена чернова',
        `„${d.data[c.titleKey] || 'без заглавие'}“ от ${new Date(d.at).toLocaleString('bg-BG', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Да продължим ли с нея?`,
        'Продължи черновата');
      if (goOn) restored = d; else clearDraft(c);
    }
  }
  const data: Record<string, any> = restored ? restored.data : isNew ? c.defaults() : structuredClone(entry!.data);
  for (const f of c.fields) if (f.type === 'date' && data[f.key]) data[f.key] = isoDate(data[f.key]);
  const ctx = newCtx();
  const body = c.bodyLabel ? richEditor({ value: restored?.body ?? entry?.body ?? '', placeholder: 'Започнете да пишете… Може да поставите текст, копиран от Word.', onImage: (f) => upload(f, 'image') }) : null;
  body?.el.addEventListener('input', () => { dirty = true; });

  const titleF = c.fields.filter((f) => f.key === c.titleKey);
  const mediaF = c.fields.filter((f) => f.type === 'image' || f.type === 'file');
  const detailF = c.fields.filter((f) => f.key !== c.titleKey && f.type !== 'image' && f.type !== 'file' && f.key !== 'order');
  const extraF: Field[] = [
    ...(c.key === 'posts' ? [{ key: 'excerpt', label: 'Кратко резюме', type: 'textarea', hint: 'Показва се в списъка с новини и в Google. Ако е празно, се взима началото на текста.' } as Field] : []),
    ...c.fields.filter((f) => f.key === 'order'),
    ...(c.key === 'posts' ? [{ key: 'draft', label: 'Скрий от сайта (запази като чернова)', type: 'bool' } as Field] : []),
  ];

  const save = h('button', { class: 'btn big' }, isNew ? 'Публикувай' : 'Запази промените');
  save.addEventListener('click', () => busy(save, 'Записване…', async () => {
    ctx.collectors.forEach((fn) => fn());
    const title = String(data[c.titleKey] || '').trim();
    if (!title) { toast('Моля, напишете заглавие (стъпка 1).', 'err'); (root.querySelector('.step input') as HTMLInputElement)?.focus(); return; }
    if (c.key === 'posts' && !data.excerpt && body) {
      const plain = body.value.replace(/[#*_>\[\]()!`-]/g, ' ').replace(/\s+/g, ' ').trim();
      data.excerpt = plain.length > 220 ? plain.slice(0, 220).replace(/\s+\S*$/, '') + '…' : plain;
    }
    const md = body ? swapPreviews(body.value) : '';
    const text = c.ext === 'md' ? api.stringifyMd(cleanData(data), md) : api.stringifyYaml(cleanData(data));
    const path = isNew ? await api.uniquePath(c.dir, api.slugify(title), c.ext) : entry!.file.path;
    await api.writeFile(path, api.b64encodeText(text), `${isNew ? 'Ново' : 'Промяна'}: ${title}`, entry?.sha);
    dirty = false; cache.delete(c.key); afterSave();
    if (isNew) clearDraft(c);
    const id = path.split('/').pop()!.replace(/\.[^.]+$/, '');
    doneView(c, id, title, isNew, !!data.draft);
  }));

  const preview = body && h('button', { type: 'button', class: 'btn ghost big', onclick: () => {
    ctx.collectors.forEach((fn) => fn());
    previewBox(c, data, body.html);
  } }, 'Преглед');

  const del = !isNew && h('button', { type: 'button', class: 'link-btn danger', onclick: async () => {
    if (!(await confirmBox('Изтриване', `Сигурни ли сте, че искате да изтриете „${data[c.titleKey]}“ от сайта?`, 'Изтрий', true))) return;
    try {
      await api.deleteFile(entry!.file.path, entry!.sha, `Изтрито: ${data[c.titleKey]}`);
      dirty = false; cache.delete(c.key); afterSave(); toast('Изтрито'); location.hash = `#/c/${c.key}`;
    } catch (err) { toast(niceError(err), 'err'); }
  } }, `Изтрий ${c.one === 'член на екипа' ? 'този човек' : c.one === 'новина' ? 'тази новина' : 'този запис'}`);

  let n = 0;
  const media = mediaF[0];
  shell(isNew ? c.addLabel : `Редакция на ${c.one}`,
    back(`#/c/${c.key}`, c.name),
    restored ? h('div', { class: 'notice' }, 'Продължавате незавършената чернова. Тя се пази само на този компютър, докато не натиснете „Публикувай“.')
      : isNew ? h('p', { class: 'lead small' }, 'Попълнете стъпките отгоре надолу и натиснете „Публикувай“ най-долу. Докато пишете, всичко се пази на този компютър.') : null,
    h('div', { class: 'steps' },
      step(++n, c.key === 'team' ? 'Име' : 'Заглавие', c.key === 'posts' ? 'Кратко и ясно, както би стояло във вестник.' : '', renderFields(data, titleF.map((f) => ({ ...f, label: '' }) as Field), ctx)),
      media && step(++n, media.type === 'image' ? 'Снимка' : 'Файл', media.type === 'image' ? 'Една хубава хоризонтална снимка. Ще я смалим автоматично.' : 'PDF или Word файл.', renderFields(data, mediaF.map((f) => ({ ...f, label: '', hint: '' }) as Field), ctx)),
      body && step(++n, c.bodyLabel!, 'Пишете както в Word. За заглавие в текста маркирайте реда и натиснете „Заглавие“.', body.el),
      detailF.length > 0 && step(++n, 'Подробности', c.key === 'posts' ? 'Датата и категорията се попълват сами. Променете ги само ако е нужно.' : '', renderFields(data, detailF, ctx)),
      extraF.length > 0 && h('details', { class: 'card more' }, h('summary', null, 'Още настройки (по желание)'), renderFields(data, extraF, ctx), del)
        || (del && h('div', { class: 'card more' }, del)),
    ),
    h('div', { class: 'actionbar' },
      h('div', { class: 'wrap actionbar-in' },
        h('span', { class: 'ab-note' }, isNew ? 'Новината се появява на сайта 1–2 минути след публикуване.' : 'Промените се виждат на сайта след 1–2 минути.'),
        h('div', { class: 'ab-btns' }, preview, save),
      )),
  );
  document.body.classList.add('has-actionbar');

  // Keep a local copy of a new entry while it is being written.
  if (isNew) {
    let t: number | undefined;
    const keep = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (!document.body.contains(save)) return;
        try { localStorage.setItem(draftKey(c), JSON.stringify({ data, body: body ? swapPreviews(body.value) : '', at: Date.now() })); } catch {}
      }, 800);
    };
    root.addEventListener('input', keep);
    root.addEventListener('click', keep);
  }
}

function previewBox(c: Coll, data: Record<string, any>, html: string) {
  const img = c.imageKey && data[c.imageKey];
  const date = c.dateKey && data[c.dateKey];
  const close = () => back.remove();
  const back = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === back && close() },
    h('div', { class: 'modal preview', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'pv-top' }, h('span', null, 'Преглед: така ще изглежда на сайта'), h('button', { class: 'btn ghost small', onclick: close }, 'Затвори')),
      h('article', { class: 'pv' },
        h('p', { class: 'pv-meta' }, [date && fmtDate(date), data.categories?.join(', ')].filter(Boolean).join(' · ')),
        h('h1', null, data[c.titleKey] || '(без заглавие)'),
        img && h('img', { class: 'pv-img', src: previews.get(img) || img, alt: '' }),
        h('div', { class: 'pv-body', html }),
      ),
    ),
  );
  document.body.appendChild(back);
}

function doneView(c: Coll, id: string, title: string, isNew: boolean, hidden: boolean) {
  shell(isNew ? 'Готово, публикувано!' : 'Промените са запазени',
    h('div', { class: 'card done' },
      h('div', { class: 'done-mark' }, '✓'),
      h('p', null, h('b', null, `„${title}“`)),
      h('p', { class: 'muted' }, hidden ? 'Записано е като чернова и не се вижда на сайта.' : 'Сайтът се обновява. След 1–2 минути ще се вижда за всички. Горе вдясно пише „Сайтът е актуален“, когато е готово.'),
      h('div', { class: 'row' },
        c.url && !hidden && h('a', { class: 'btn', href: c.url(id), target: '_blank' }, 'Виж на сайта'),
        isNew && h('a', { class: 'btn ghost', href: `#/c/${c.key}/new` }, c.key === 'posts' ? 'Напиши още една' : 'Добави още'),
        h('a', { class: 'btn ghost', href: '#/' }, 'Към началото'),
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
    if (parts[0] === 'users' && user?.admin) return usersView();
    if (parts[0] === 'account') return accountView();
    dashboard();
  } catch (e) {
    if (e instanceof api.LoginError) return loginView();
    shell('Грешка', back('#/', 'Начало'), h('p', { class: 'err' }, niceError(e)));
  }
}

function loginView(noAccess?: string) {
  root.innerHTML = '';
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'name@example.com' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'err', hidden: true });
  const submit = h('button', { class: 'btn big', type: 'submit' }, 'Вход');
  const form = h('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    msg.hidden = true;
    const err = await busy(submit, 'Влизане…', () => api.login(email.value.trim(), pass.value));
    if (err === '') { location.reload(); return; }
    msg.textContent = err || 'Входът не успя. Опитайте пак.'; msg.hidden = false;
  } },
    h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Имейл'), email),
    h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Парола'), pass),
    msg, submit,
  );
  root.append(h('div', { class: 'login' },
    h('div', { class: 'login-card' },
      h('img', { src: '/logo.png', alt: 'ASSYST BULGARIA', class: 'login-logo' }),
      h('h1', null, 'Админ панел'),
      noAccess
        ? h('p', { class: 'err' }, `Профилът „${noAccess}“ няма права да редактира сайта.`)
        : h('p', null, 'Влезте с имейла и паролата, които сте получили.'),
      form,
      h('p', { class: 'login-alt' }, 'Забравена парола? Обърнете се към администратора.'),
      h('a', { class: 'login-gh', href: '/api/auth?mode=session' }, 'Вход за администратор с GitHub'),
    ),
  ));
  email.focus();
}

function genPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, (n) => abc[n % abc.length]).join('');
}

async function usersView() {
  const listEl = h('div', { class: 'list' }, h('div', { class: 'loading-row' }, h('span', { class: 'spin' }), ' Зареждане…'));
  const saverEl = h('p', { class: 'muted small-note' });
  const name = h('input', { type: 'text', placeholder: 'Мария Иванова' });
  const email = h('input', { type: 'email', placeholder: 'maria@example.com' });
  const pass = h('input', { type: 'text', value: genPassword() });
  const admin = h('input', { type: 'checkbox' });
  const add = h('button', { class: 'btn', type: 'submit' }, 'Добави служител');
  const done = h('div', { class: 'notice', hidden: true });
  const form = h('form', { class: 'fields', onsubmit: (e: Event) => {
    e.preventDefault();
    busy(add, 'Записване…', async () => {
      const u = { name: name.value.trim(), email: email.value.trim(), password: pass.value, admin: admin.checked };
      await api.saveUser(u);
      done.innerHTML = '';
      done.append(h('b', null, 'Готово. Изпратете на служителя:'),
        h('pre', null, `Адрес: ${location.origin}/admin/\nИмейл: ${u.email}\nПарола: ${u.password}`),
        h('small', null, 'Паролата не се пази никъде видимо. Служителят може да я смени след като влезе.'));
      done.hidden = false;
      name.value = ''; email.value = ''; pass.value = genPassword(); admin.checked = false;
      load();
    });
  } },
    h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Име'), name),
    h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Имейл'), email),
    h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Начална парола'), h('div', { class: 'row' }, pass,
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { pass.value = genPassword(); } }, 'Нова'))),
    h('label', { class: 'check' }, admin, h('span', null, 'Може да добавя и други служители')),
    add,
  );
  shell('Служители', back('#/', 'Начало'),
    h('p', { class: 'lead' }, 'Хората тук влизат с имейл и парола и могат да редактират всичко в сайта.'),
    h('div', { class: 'editor-grid' },
      h('div', null, listEl, saverEl),
      h('aside', { class: 'side' }, h('div', { class: 'card' }, h('h2', null, 'Нов служител'), form), done),
    ),
  );
  async function load() {
    try {
      const { users, saver } = await api.listUsers();
      listEl.innerHTML = '';
      if (!users.length) listEl.append(h('p', { class: 'muted empty' }, 'Още няма добавени служители.'));
      for (const u of users) {
        listEl.append(h('div', { class: 'list-item' },
          h('div', { class: 'li-main' }, h('span', { class: 'thumb' }, icon('users', 20)),
            h('span', { class: 'li-text' }, h('b', null, u.name), h('small', null, [u.email, u.admin ? 'администратор' : ''].filter(Boolean).join(' · ')))),
          h('div', { class: 'li-tools' },
            h('button', { class: 'btn ghost small', onclick: async () => {
              const pw = genPassword();
              if (!(await confirmBox('Нова парола', `Да зададем ли нова парола на ${u.name}? Старата спира да работи.`, 'Задай нова парола'))) return;
              try {
                await api.saveUser({ email: u.email, name: u.name, admin: u.admin, password: pw });
                done.innerHTML = '';
                done.append(h('b', null, `Новата парола на ${u.name}:`), h('pre', null, pw));
                done.hidden = false;
              } catch (e) { toast(niceError(e), 'err'); }
            } }, 'Нова парола'),
            h('button', { class: 'btn ghost small danger', onclick: async () => {
              if (!(await confirmBox('Премахване', `Да премахнем ли достъпа на ${u.name}?`, 'Премахни', true))) return;
              try { await api.deleteUser(u.email); toast('Достъпът е премахнат'); load(); } catch (e) { toast(niceError(e), 'err'); }
            } }, 'Премахни'),
          ),
        ));
      }
      saverEl.textContent = saver
        ? `Промените на служителите се записват чрез GitHub профила на ${saver.login}.`
        : 'Внимание: за да могат служителите да записват, администратор трябва да влезе веднъж с GitHub.';
    } catch (e) { listEl.innerHTML = ''; listEl.append(h('p', { class: 'err' }, niceError(e))); }
  }
  load();
}

function accountView() {
  const old = h('input', { type: 'password', autocomplete: 'current-password' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Смени паролата');
  shell('Смяна на паролата', back('#/', 'Начало'),
    h('div', { class: 'card narrow-card' }, h('form', { class: 'fields', onsubmit: (e: Event) => {
      e.preventDefault();
      if (pw.value.length < 8) { toast('Новата парола трябва да е поне 8 знака.', 'err'); return; }
      if (pw.value !== pw2.value) { toast('Двете нови пароли не съвпадат.', 'err'); return; }
      busy(save, 'Записване…', async () => { await api.changePassword(old.value, pw.value); toast('Паролата е сменена'); location.hash = '#/'; });
    } },
      h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Сегашна парола'), old),
      h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Нова парола (поне 8 знака)'), pw),
      h('div', { class: 'field' }, h('label', { class: 'flabel' }, 'Нова парола още веднъж'), pw2),
      save,
    )));
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

// Close the header menu when clicking elsewhere.
document.addEventListener('click', (e) => {
  document.querySelectorAll<HTMLDetailsElement>('.user-menu[open]').forEach((d) => { if (!d.contains(e.target as Node)) d.open = false; });
});
