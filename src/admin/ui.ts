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

export function confirmBox(title: string, text: string, yes = 'Да', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean) => { back.remove(); resolve(v); };
    const back = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === back && close(false) },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h3', null, title),
        h('p', null, text),
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Отказ'),
          h('button', { class: danger ? 'btn danger' : 'btn', onclick: () => close(true) }, yes),
        ),
      ),
    );
    document.body.appendChild(back);
    (back.querySelector('.btn:last-child') as HTMLElement).focus();
  });
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
