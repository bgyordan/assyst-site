// Talks to the content repository through the Worker (/api/repo/*), which adds the
// editor's GitHub sign-in. Every save is a commit; GitHub Actions then publishes the site.
import { load, dump } from 'js-yaml';

export type Me = { kind: 'github' | 'pw'; login: string; name: string; avatar: string; admin: boolean; repo: string };
export type Editor = { email: string; name: string; admin: boolean; created: number };
export type RepoFile = { name: string; path: string; sha: string; type: 'file' | 'dir'; size: number };

export class LoginError extends Error {}
export class NoAccessError extends Error {}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`/api/${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'X-Assyst': '1', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (r.status === 401) throw new LoginError('login');
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 && j.error === 'noaccess') throw new NoAccessError(j.login);
  if (!r.ok) throw Object.assign(new Error(j.message || j.error || `Грешка ${r.status}`), { status: r.status });
  return j;
}

export const me = (): Promise<Me> => call('me');
export const logout = () => call('logout', { method: 'POST' });

/** E-mail + password sign-in. Returns an error message, or '' on success. */
export async function login(email: string, password: string): Promise<string> {
  const r = await fetch('/api/login', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'X-Assyst': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.ok) return '';
  const j = await r.json().catch(() => ({}));
  return j.error || 'Входът не успя. Опитайте пак.';
}
export const changePassword = (old: string, password: string) => call('password', { method: 'POST', body: JSON.stringify({ old, password }) });
export const listUsers = (): Promise<{ users: Editor[]; saver: { login?: string; at?: number } | null; permanent?: boolean; appSlug?: string | null }> => call('users');
export const saveUser = (u: { email: string; name: string; password?: string; admin: boolean }) => call('users', { method: 'POST', body: JSON.stringify(u) });
export const deleteUser = (email: string) => call(`users?email=${encodeURIComponent(email)}`, { method: 'DELETE' });

// --- base64 helpers that are safe for Cyrillic text ---
export function b64encodeText(s: string) {
  const bytes = new TextEncoder().encode(s);
  return b64encodeBytes(bytes);
}
export function b64encodeBytes(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decodeText(b64: string) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function listDir(dir: string): Promise<RepoFile[]> {
  try {
    return await call(`repo/contents/${enc(dir)}?ref=main&t=${Date.now()}`);
  } catch (e: any) {
    if (e.status === 404) return [];
    throw e;
  }
}

export async function readFile(path: string): Promise<{ text: string; sha: string }> {
  const j = await call(`repo/contents/${enc(path)}?ref=main&t=${Date.now()}`);
  return { text: b64decodeText(j.content || ''), sha: j.sha };
}

export async function fileExists(path: string) {
  try {
    await call(`repo/contents/${enc(path)}?ref=main`);
    return true;
  } catch (e: any) {
    if (e.status === 404) return false;
    throw e;
  }
}

export async function writeFile(path: string, base64: string, message: string, sha?: string) {
  const j = await call(`repo/contents/${enc(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: base64, branch: 'main', ...(sha ? { sha } : {}) }),
  });
  lastCommitAt = Date.now();
  return j.content?.sha as string;
}

export async function deleteFile(path: string, sha: string, message: string) {
  await call(`repo/contents/${enc(path)}`, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: 'main' }) });
  lastCommitAt = Date.now();
}

export let lastCommitAt = 0;

/** Latest publish run: 'running' | 'ok' | 'failed' | 'none' */
export async function publishStatus(): Promise<{ state: string; at?: string }> {
  try {
    const j = await call(`repo/actions/runs?per_page=1&branch=main&t=${Date.now()}`);
    const run = j.workflow_runs?.[0];
    if (!run) return { state: 'none' };
    if (run.status !== 'completed') return { state: 'running', at: run.created_at };
    return { state: run.conclusion === 'success' ? 'ok' : 'failed', at: run.updated_at };
  } catch {
    return { state: 'unknown' };
  }
}

// --- front matter (Markdown files) and YAML files ---
export function parseMd(text: string): { data: Record<string, any>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: (load(m[1]) as Record<string, any>) || {}, body: m[2].replace(/^\r?\n/, '') };
}
const yamlOpts = { lineWidth: -1, noRefs: true, quotingType: '"' } as const;
export function stringifyMd(data: Record<string, any>, body: string) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== '' && v !== null));
  return `---\n${dump(clean, yamlOpts)}---\n\n${body.trim()}\n`;
}
export const parseYaml = (text: string) => (load(text) as Record<string, any>) || {};
export const stringifyYaml = (data: unknown) => dump(data, yamlOpts);

// --- file names ---
const TR: Record<string, string> = Object.fromEntries(
  'абвгдежзийклмнопрстуфхцчшщъьюя'.split('').map((c, i) => [c, ['a','b','v','g','d','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','sht','a','','yu','ya'][i]]),
);
/** Web address part, kept in Cyrillic like WordPress did: "Нова статия!" → "нова-статия" */
export function slugify(s: string, max = 60) {
  return s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'zapis';
}
/** Latin-only name for uploaded files */
export function fileSlug(s: string) {
  return s.toLowerCase().split('').map((c) => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'fail';
}

export async function uniquePath(dir: string, base: string, ext: string) {
  const existing = new Set((await listDir(dir)).map((f) => f.name));
  let name = `${base}.${ext}`;
  for (let i = 2; existing.has(name); i++) name = `${base}-${i}.${ext}`;
  return `${dir}/${name}`;
}
