// Form building blocks bound directly to a data object.
import { h } from './ui';
import { richEditor } from './editor';
import { previews } from './previews';

export type Field =
  | { key: string; label: string; type: 'text' | 'textarea' | 'date' | 'number' | 'email' | 'url'; hint?: string; placeholder?: string; big?: boolean }
  | { key: string; label: string; type: 'rich'; hint?: string; small?: boolean }
  | { key: string; label: string; type: 'image' | 'file'; hint?: string; accept?: string }
  | { key: string; label: string; type: 'bool'; hint?: string }
  | { key: string; label: string; type: 'select'; options: { value: any; label: string }[]; hint?: string }
  | { key: string; label: string; type: 'chips'; options: string[]; hint?: string }
  | { key: string; label: string; type: 'strings'; hint?: string; addLabel?: string }
  | { key: string; label: string; type: 'list'; fields: Field[]; itemLabel: string; hint?: string; summary?: (o: any) => string }
  | { key: string; label: string; type: 'group'; fields: Field[]; hint?: string };

export type Ctx = {
  collectors: (() => void)[];
  upload: (file: File, kind: 'image' | 'file') => Promise<string | undefined>;
  dirty: () => void;
};

const fieldWrap = (f: Field, ...c: (Node | false | undefined)[]) =>
  h('div', { class: 'field' }, h('label', { class: 'flabel' }, f.label), f.hint ? h('div', { class: 'hint' }, f.hint) : null, ...c);

export function renderFields(obj: any, fields: Field[], ctx: Ctx): HTMLElement {
  return h('div', { class: 'fields' }, fields.map((f) => renderField(obj, f, ctx)));
}

export function renderField(obj: any, f: Field, ctx: Ctx): HTMLElement {
  const set = (v: any) => { obj[f.key] = v; ctx.dirty(); };
  switch (f.type) {
    case 'text': case 'date': case 'number': case 'email': case 'url': {
      const inp = h('input', {
        type: f.type === 'text' ? 'text' : f.type, class: f.big ? 'big' : '', value: obj[f.key] ?? '', placeholder: f.placeholder || '',
        oninput: () => set(f.type === 'number' ? (inp.value === '' ? undefined : Number(inp.value)) : inp.value),
      });
      return fieldWrap(f, inp);
    }
    case 'textarea': {
      const ta = h('textarea', { rows: 3, oninput: () => set(ta.value) }, obj[f.key] ?? '');
      return fieldWrap(f, ta);
    }
    case 'rich': {
      const ed = richEditor({ value: obj[f.key] ?? '', small: f.small, onImage: (file) => ctx.upload(file, 'image') });
      ed.el.addEventListener('input', () => ctx.dirty());
      ctx.collectors.push(() => { obj[f.key] = ed.value; });
      return fieldWrap(f, ed.el);
    }
    case 'bool': {
      const cb = h('input', { type: 'checkbox', checked: !!obj[f.key], onchange: () => set(cb.checked) });
      return h('div', { class: 'field' }, h('label', { class: 'check' }, cb, h('span', null, f.label)), f.hint ? h('div', { class: 'hint' }, f.hint) : null);
    }
    case 'select': {
      const sel = h('select', { onchange: () => set(f.options[sel.selectedIndex].value) },
        f.options.map((o) => h('option', { selected: (obj[f.key] ?? f.options[0].value) === o.value }, o.label)));
      return fieldWrap(f, sel);
    }
    case 'chips': {
      const cur = new Set<string>(obj[f.key] || []);
      const box = h('div', { class: 'chips' }, f.options.map((o) => {
        const b = h('button', { type: 'button', class: 'chip' + (cur.has(o) ? ' on' : ''), onclick: () => {
          cur.has(o) ? cur.delete(o) : cur.add(o);
          b.classList.toggle('on');
          set(f.options.filter((x) => cur.has(x)));
        } }, o);
        return b;
      }));
      return fieldWrap(f, box);
    }
    case 'image': case 'file': {
      const isImg = f.type === 'image';
      const preview = h('div', { class: 'drop-preview' });
      const show = () => {
        preview.innerHTML = '';
        const v = obj[f.key];
        if (!v) { preview.append(h('span', { class: 'muted' }, isImg ? 'Няма снимка' : 'Няма файл')); return; }
        preview.append(isImg ? h('img', { src: previews.get(v) || v, alt: '' }) : h('a', { href: v, target: '_blank' }, decodeURIComponent(v.split('/').pop())));
      };
      show();
      const input = h('input', { type: 'file', accept: isImg ? 'image/*' : (f as any).accept || '.pdf,.doc,.docx,.xls,.xlsx', hidden: true, onchange: () => pick(input.files?.[0]) });
      const pick = async (file?: File) => {
        input.value = '';
        if (!file) return;
        drop.classList.add('loading');
        const url = await ctx.upload(file, isImg ? 'image' : 'file');
        drop.classList.remove('loading');
        if (url) { set(url); show(); }
      };
      const drop = h('div', { class: 'drop', onclick: () => input.click(),
        ondragover: (e: DragEvent) => { e.preventDefault(); drop.classList.add('over'); },
        ondragleave: () => drop.classList.remove('over'),
        ondrop: (e: DragEvent) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer?.files?.[0]); },
      },
        preview,
        h('div', { class: 'drop-text' }, isImg ? 'Плъзнете снимка тук или кликнете, за да изберете' : 'Плъзнете файл тук или кликнете, за да изберете'),
        input,
      );
      const remove = h('button', { type: 'button', class: 'link-btn', onclick: () => { set(''); show(); } }, isImg ? 'Махни снимката' : 'Махни файла');
      return fieldWrap(f, drop, remove);
    }
    case 'strings': {
      const arr: string[] = (obj[f.key] = Array.isArray(obj[f.key]) ? obj[f.key] : []);
      const list = h('div', { class: 'strings' });
      const draw = () => {
        list.innerHTML = '';
        arr.forEach((v, i) => {
          const inp = h('input', { type: 'text', value: v, oninput: () => { arr[i] = inp.value; ctx.dirty(); } });
          list.append(h('div', { class: 'row' }, inp,
            h('button', { type: 'button', class: 'icon-btn', title: 'Премахни', onclick: () => { arr.splice(i, 1); ctx.dirty(); draw(); } }, '✕')));
        });
        list.append(h('button', { type: 'button', class: 'btn ghost small', onclick: () => { arr.push(''); ctx.dirty(); draw(); (list.querySelector('.row:last-of-type input') as HTMLInputElement)?.focus(); } }, '+ ' + (f.addLabel || 'Добави ред')));
      };
      draw();
      return fieldWrap(f, list);
    }
    case 'group': {
      obj[f.key] = obj[f.key] && typeof obj[f.key] === 'object' ? obj[f.key] : {};
      return h('fieldset', { class: 'group' }, h('legend', null, f.label), f.hint ? h('div', { class: 'hint' }, f.hint) : null, renderFields(obj[f.key], f.fields, ctx));
    }
    case 'list': {
      const arr: any[] = (obj[f.key] = Array.isArray(obj[f.key]) ? obj[f.key] : []);
      const box = h('div', { class: 'items' });
      const draw = () => {
        box.innerHTML = '';
        arr.forEach((item, i) => {
          const move = (d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; ctx.dirty(); draw(); };
          box.append(h('div', { class: 'item' },
            h('div', { class: 'item-head' },
              h('strong', null, `${f.itemLabel} ${i + 1}`),
              h('span', { class: 'item-tools' },
                h('button', { type: 'button', class: 'icon-btn', title: 'Нагоре', disabled: i === 0, onclick: () => move(-1) }, '↑'),
                h('button', { type: 'button', class: 'icon-btn', title: 'Надолу', disabled: i === arr.length - 1, onclick: () => move(1) }, '↓'),
                h('button', { type: 'button', class: 'icon-btn danger', title: 'Премахни', onclick: () => { arr.splice(i, 1); ctx.dirty(); draw(); } }, '✕'),
              ),
            ),
            renderFields(item, f.fields, ctx),
          ));
        });
        box.append(h('button', { type: 'button', class: 'btn ghost small', onclick: () => { arr.push({}); ctx.dirty(); draw(); } }, `+ Добави ${f.itemLabel.toLowerCase()}`));
      };
      draw();
      return fieldWrap(f, box);
    }
  }
}
