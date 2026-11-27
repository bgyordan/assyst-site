import { getCollection } from 'astro:content';
import { settings } from '../lib/util';
export async function GET({ site }: { site: URL }) {
  const pages = (await getCollection('pages')).map((p) => (p.id === 'home' ? '/' : `/${p.id}/`));
  const posts = (await getCollection('posts', (p) => !p.data.draft)).map((p) => `/${p.id}/`);
  const events = (await getCollection('events')).map((e) => `/event/${e.id}/`);
  const cats = settings.categories.map((c) => `/category/${c.slug}/`);
  const urls = [...pages, ...posts, ...events, '/events/', ...cats].map((u) => `<url><loc>${new URL(encodeURI(u), site).href}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
