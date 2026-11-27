// A small "like Word" text editor: toolbar + editable area. Stores Markdown.
import { marked } from 'marked';
import TurndownService from 'turndown';
import { h } from './ui';
import { previews } from './previews';

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
td.addRule('dropSpans', { filter: ['span', 'font' as any], replacement: (c) => c });
td.addRule('underline', { filter: ['u'], replacement: (c) => c });
td.remove(['script', 'style', 'meta']);

export const mdToHtml = (md: string) => marked.parse(md || '', { async: false }) as string;
export const htmlToMd = (html: string) => td.turndown(html).replace(/\n{3,}/g, '\n\n').trim();

type Opts = { value: string; small?: boolean; placeholder?: string; onImage?: (file: File) => Promise<string | undefined> };

export function richEditor({ value, small, placeholder, onImage }: Opts) {
  const area = h('div', { class: 'rte-area' + (small ? ' small' : ''), contenteditable: 'true', 'data-placeholder': placeholder || 'Пишете тук…', html: mdToHtml(value) });
  const exec = (cmd: string, arg?: string) => { area.focus(); document.execCommand(cmd, false, arg); };
  const btn = (label: string, title: string, fn: () => void, cls = '') =>
    h('button', { type: 'button', class: 'rte-btn ' + cls, title, 'aria-label': title, onmousedown: (e: Event) => e.preventDefault(), onclick: fn, html: label });

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f || !onImage) return;
    const url = await onImage(f);
    if (url) exec('insertHTML', `<p><img src="${previews.get(url) || url}" alt=""></p>`);
  } });

  const isHeading = () => /^h[23]$/i.test(String(document.queryCommandValue('formatBlock') || ''));
  const bar = h('div', { class: 'rte-bar' },
    btn('<b>Ж</b>', 'Удебелен текст', () => exec('bold')),
    btn('<i>К</i>', 'Наклонен текст (курсив)', () => exec('italic')),
    h('span', { class: 'rte-sep' }),
    !small && btn('Заглавие', 'Превръща реда в заглавие (натиснете пак, за да стане обикновен текст)', () => exec('formatBlock', isHeading() ? 'P' : 'H2'), 'wide'),
    btn('• Списък', 'Списък с точки', () => exec('insertUnorderedList'), 'wide'),
    !small && btn('1. Списък', 'Номериран списък', () => exec('insertOrderedList'), 'wide'),
    h('span', { class: 'rte-sep' }),
    btn('Връзка', 'Маркирайте текст и натиснете, за да стане връзка', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { alert('Първо маркирайте с мишката текста, който да стане връзка.'); return; }
      let url = prompt('Адрес на връзката (напр. https://… или имейл):', 'https://');
      if (!url) return;
      if (/^[^@\s]+@[^@\s]+$/.test(url)) url = 'mailto:' + url;
      exec('createLink', url);
    }, 'wide'),
    onImage && !small && btn('Снимка в текста', 'Вмъкни снимка в текста', () => fileInput.click(), 'wide'),
    h('span', { class: 'rte-grow' }),
    btn('↶ Отмени', 'Отменя последната промяна', () => exec('undo'), 'wide'),
    fileInput,
  );

  // Paste: keep structure, drop Word/Google Docs styling.
  area.addEventListener('paste', (e: ClipboardEvent) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    e.preventDefault();
    exec('insertHTML', mdToHtml(htmlToMd(html)));
  });
  area.addEventListener('drop', async (e: DragEvent) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f || !f.type.startsWith('image/') || !onImage) return;
    e.preventDefault();
    const url = await onImage(f);
    if (url) exec('insertHTML', `<p><img src="${previews.get(url) || url}" alt=""></p>`);
  });

  const el = h('div', { class: 'rte' }, bar, area);
  return { el, get value() { return htmlToMd(area.innerHTML); }, get html() { return area.innerHTML; } };
}
