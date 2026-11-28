// Tiny DOM helpers for the admin panel (no framework).
type Child = Node | string | number | false | null | undefined | Child[];
type Props = Record<string, any>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}
function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function toast(text: string, kind: 'ok' | 'err' | 'info' = 'ok') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, text);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 7000 : 3500);
}

function modal(title: string, body: (Node | string | null)[], buttons: { label: string; cls: string; value: any }[], onKey?: (close: (v: any) => void) => void): Promise<any> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const close = (v: any) => { back.remove(); document.removeEventListener('keydown', key); prev?.focus?.(); resolve(v); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(buttons[0].value); };
    const back = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === back && close(buttons[0].value) },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h3', null, title),
        ...body,
        h('div', { class: 'row end modal-btns' }, buttons.map((b) => h('button', { type: 'button', class: b.cls, onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))),
      ),
    );
    document.body.appendChild(back);
    document.addEventListener('keydown', key);
    onKey?.(close);
    ((back.querySelector('input') as HTMLElement) || (back.querySelector('.modal-btns .btn:last-child') as HTMLElement)).focus();
  });
}

/** Question with two clear answers: "Откажи" (left) and the action (right). */
export function confirmBox(title: string, text: string, yes = 'Потвърди', danger = false, no = 'Откажи'): Promise<boolean> {
  return modal(title, [h('p', null, text)], [
    { label: no, cls: 'btn ghost', value: false },
    { label: yes, cls: danger ? 'btn danger' : 'btn', value: true },
  ]);
}

/** A message with one button. */
export function infoBox(title: string, text: string, ok = 'Разбрах'): Promise<void> {
  return modal(title, [h('p', null, text)], [{ label: ok, cls: 'btn', value: undefined }]);
}

/** Ask for one line of text; resolves to null on "Откажи". */
export function askBox(title: string, text: string, value = '', placeholder = ''): Promise<string | null> {
  const inp = h('input', { type: 'text', value, placeholder, class: 'modal-input' });
  return modal(title, [h('p', null, text), inp], [
    { label: 'Откажи', cls: 'btn ghost', value: null },
    { label: 'Потвърди', cls: 'btn', value: () => inp.value.trim() || null },
  ], (close) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(inp.value.trim() || null); } }));
}

export function busy<T>(btn: HTMLButtonElement, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> ${label}`;
  return fn()
    .catch((e) => { toast(niceError(e), 'err'); return undefined; })
    .finally(() => { btn.disabled = false; btn.innerHTML = old; });
}

export function niceError(e: any) {
  if (e?.status === 409 || /does not match|sha/i.test(e?.message || '')) return 'Някой друг току-що е променил този запис. Презаредете страницата и опитайте отново.';
  if (e?.status === 413 || /too large/i.test(e?.message || '')) return 'Файлът е твърде голям.';
  if (e instanceof TypeError) return 'Няма връзка с интернет. Опитайте пак.';
  return 'Нещо се обърка: ' + (e?.message || e);
}

const months = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
export function fmtDate(v: any) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(+d)) return String(v);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const isoDate = (v: any) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(+d) ? '' : d.toISOString().slice(0, 10);
};
export const today = () => new Date().toISOString().slice(0, 10);

/** "днес в 10:05", "вчера в 18:20" or "12 ное, 10:05". */
export function whenText(v: any) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(+d)) return '';
  const t = d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return `днес в ${t}`;
  if (diff === 1) return `вчера в ${t}`;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + ' ' : ''}в ${t}`;
}
