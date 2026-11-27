import { getCollection } from 'astro:content';
import { settings } from '../lib/util';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function GET({ site }: { site: URL }) {
  const posts = (await getCollection('posts', (p) => !p.data.draft)).sort((a, b) => +b.data.date - +a.data.date);
  const items = posts.map((p) => {
    const url = new URL(`/${encodeURI(p.id)}/`, site).href;
    return `<item><title>${esc(p.data.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${p.data.date.toUTCString()}</pubDate><description>${esc(p.data.excerpt || '')}</description></item>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(settings.site_name)}</title><link>${site}</link><description>${esc(settings.tagline)}</description><language>bg</language>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
