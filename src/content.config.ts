import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const link = z.object({ text: z.string(), link: z.string(), outline: z.boolean().optional() });
const item = z.object({
  title: z.string().optional(), text: z.string().optional(), link: z.string().optional(), meta: z.string().optional(),
});
const stat = z.object({ value: z.coerce.string(), label: z.string() });

const section = z.object({
  type: z.enum(['text', 'cards', 'stats', 'mission', 'list', 'quote', 'cta', 'team', 'documents', 'posts', 'events', 'contact']),
  label: z.string().optional(),
  heading: z.string().optional(),
  intro: z.string().optional(),
  text: z.string().optional(),
  body: z.string().optional(),
  note: z.string().optional(),
  style: z.string().optional(),
  columns: z.coerce.number().optional(),
  count: z.coerce.number().optional(),
  filters: z.boolean().optional(),
  profiles: z.boolean().optional(),
  contacts: z.boolean().optional(),
  items: z.array(z.union([z.string(), item])).optional(),
  stats: z.array(stat).optional(),
  buttons: z.array(link).optional(),
  aside_title: z.string().optional(),
  aside_big: z.coerce.string().optional(),
  aside_items: z.array(z.string()).optional(),
  aside_contacts: z.boolean().optional(),
  aside_note: z.string().optional(),
}).passthrough();

const pages = defineCollection({
  loader: glob({ pattern: '*.{yml,yaml}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    hero: z.object({
      style: z.string().optional(),
      image: z.string().optional(),
      label: z.string().optional(),
      watermark: z.string().optional(),
      title: z.string(),
      subtitle: z.string().optional(),
      text: z.string().optional(),
      buttons: z.array(link).optional(),
      links: z.array(item).optional(),
      stats: z.array(stat).optional(),
    }),
    sections: z.array(section).default([]),
    body: z.string().optional(),
  }),
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.array(z.string()).default([]),
    image: z.string().optional(),
    gallery: z.array(z.string()).default([]),
    excerpt: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().optional(),
    time: z.string().optional(),
    location: z.string().optional(),
    image: z.string().optional(),
    gallery: z.array(z.string()).default([]),
    link: z.string().optional(),
  }),
});

const team = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/team' }),
  schema: z.object({
    name: z.string(), role: z.string().optional(), short: z.string().optional(), tagline: z.string().optional(),
    photo: z.string().optional(), order: z.coerce.number().default(99),
  }),
});

const documents = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/documents' }),
  schema: z.object({
    title: z.string(), description: z.string().optional(), file: z.string().optional(), order: z.coerce.number().default(99),
  }),
});

export const collections = { pages, posts, events, team, documents };
