import { marked } from 'marked';
import { load as yamlLoad } from 'js-yaml';
import fs from 'node:fs';

export const md = (s?: string) => (s ? (marked.parse(s, { async: false }) as string) : '');
export const mdInline = (s?: string) => (s ? (marked.parseInline(s, { async: false }) as string) : '');
/** "Текст *акцент*" → Текст <em>акцент</em> */
export const accent = (s?: string) => mdInline(s);

export type Settings = {
  site_name: string; tagline: string; logo: string; phone: string; email: string; facebook?: string;
  footer_text: string; menu: { text: string; link: string; children?: { text: string; link: string }[] }[];
  donate_button?: { text: string; link: string };
  categories: { name: string; slug: string }[];
};
export const settings = yamlLoad(fs.readFileSync('src/data/settings.yml', 'utf8')) as Settings;
export const tel = (p: string) => 'tel:' + p.replace(/[^+\d]/g, '');

const months = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
export const fmtDate = (d: Date) => `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const postUrl = (id: string) => `/${id}/`;
export const catSlug = (name: string) => settings.categories.find((c) => c.name === name)?.slug ?? name.toLowerCase().replace(/\s+/g, '-');
