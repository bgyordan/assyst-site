// Cloudflare Worker: serves the static site (./dist) and handles /api/* —
// GitHub sign-in for the admin panel and the contact form.
import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage, Mailbox } from 'mimetext';

interface Env {
  ASSETS: Fetcher;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  MAIL?: SendEmail;
  CONTACT_TO?: string;   // verified destination address
  CONTACT_FROM?: string; // sender on the domain, e.g. forma@assyst.bg
  REPO?: string;         // owner/name of the content repository
  USERS?: KVNamespace;   // admin panel: editors, sessions, saved GitHub key
}

const SESSION = 'assyst_session';
const getCookie = (req: Request, name: string) =>
  new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.get('Cookie') || '')?.[1];

const page = (origin: string, status: 'success' | 'error', content: Record<string, string>) => {
  const msg = `authorization:github:${status}:${JSON.stringify(content)}`;
  return new Response(
    `<!doctype html><html><body><p>${status === 'success' ? 'Влизане…' : 'Грешка при влизане.'}</p><script>
(() => {
  const origin = ${JSON.stringify(origin)};
  const msg = ${JSON.stringify(msg)};
  window.addEventListener('message', (e) => {
    if (e.origin === origin && e.data === 'authorizing:github') {
      window.opener && window.opener.postMessage(msg, origin);
    }
  });
  window.opener && window.opener.postMessage('authorizing:github', origin);
})();
</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'cms_oauth_state=; Path=/api; Max-Age=0' } },
  );
};

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function auth(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID) return new Response('GITHUB_CLIENT_ID is not configured', { status: 500 });
  const url = new URL(request.url);
  // "s" prefix = sign-in for the simple admin panel (token kept in an HttpOnly cookie).
  const state = (url.searchParams.get('mode') === 'session' ? 's' : '') + crypto.randomUUID().replace(/-/g, '');
  const scope = url.searchParams.get('scope') === 'public_repo' ? 'public_repo' : 'repo';
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', `${url.origin}/api/callback`);
  gh.searchParams.set('scope', scope);
  gh.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: gh.toString(),
      'Set-Cookie': `cms_oauth_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = request.headers.get('Cookie') || '';
  const saved = /(?:^|;\s*)cms_oauth_state=(s?[a-f0-9]+)/.exec(cookie)?.[1];
  if (!code || !state || !saved || state !== saved) {
    return page(url.origin, 'error', { provider: 'github', error: 'Invalid OAuth state' });
  }
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'assyst-cms' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/api/callback` }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!j.access_token) return page(url.origin, 'error', { provider: 'github', error: j.error_description || 'Token exchange failed' });
  if (state.startsWith('s')) {
    if (!env.USERS) return new Response('USERS KV is not configured', { status: 500 });
    const repo = env.REPO || 'bgyordan/assyst-site';
    const [u, r] = await Promise.all([gh(j.access_token, 'user'), gh(j.access_token, `repos/${repo}`)]);
    const user = (await u.json().catch(() => ({}))) as { login?: string; name?: string; avatar_url?: string };
    const rj = (await r.json().catch(() => ({}))) as { permissions?: { push?: boolean } };
    const push = !!rj.permissions?.push;
    // A GitHub admin's key is kept so that editors who sign in with e-mail can save too.
    if (push) await env.USERS.put('svc:github', JSON.stringify({ token: j.access_token, login: user.login, at: Date.now() }));
    const sid = await newSession(env, { kind: 'github', token: j.access_token, login: user.login || '', name: user.name || user.login || '', avatar: user.avatar_url || '', push });
    const h = new Headers({ Location: '/admin/' });
    h.append('Set-Cookie', sessionCookie(sid));
    h.append('Set-Cookie', 'cms_oauth_state=; Path=/api; Max-Age=0');
    return new Response(null, { status: 302, headers: h });
  }
  return page(url.origin, 'success', { provider: 'github', token: j.access_token });
}

const gh = (token: string, path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'assyst-admin',
      'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

// ---------- admin panel: sessions, e-mail + password editors ----------
type Sess =
  | { kind: 'github'; token: string; login: string; name: string; avatar: string; push: boolean }
  | { kind: 'pw'; email: string; name: string; admin: boolean };
type User = { email: string; name: string; hash: string; salt: string; admin?: boolean; created: number };

const DAY = 86400;
const SESSION_TTL = 30 * DAY;
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sessionCookie = (sid: string) => `${SESSION}=${sid}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
const normEmail = (e: unknown) => clean(e, 200).toLowerCase().replace(/\s/g, '');

async function newSession(env: Env, s: Sess) {
  const sid = randomHex(32);
  await env.USERS!.put(`sess:${sid}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
  return sid;
}
async function hashPassword(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((x) => parseInt(x, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const isAdmin = (s: Sess) => (s.kind === 'github' ? s.push : s.admin);
const publicUser = (u: User) => ({ email: u.email, name: u.name, admin: !!u.admin, created: u.created });

async function adminApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (!origin || new URL(origin).host !== url.host || request.headers.get('X-Assyst') !== '1') return json({ error: 'Bad origin' }, 403);
  }
  const kv = env.USERS;
  if (!kv) return json({ error: 'Хранилището за потребители още не е настроено.' }, 503);
  const sid = getCookie(request, SESSION);
  const body = async () => ((await request.json().catch(() => ({}))) as Record<string, unknown>);

  if (pathname === '/api/logout') {
    if (sid && /^[a-f0-9]{64}$/.test(sid)) await kv.delete(`sess:${sid}`);
    return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${SESSION}=; Path=/api; Max-Age=0` } });
  }

  if (pathname === '/api/login' && request.method === 'POST') {
    const b = await body();
    const email = normEmail(b.email);
    const password = String(b.password ?? '');
    const failKey = `fail:${email}`;
    const fails = Number((await kv.get(failKey)) || 0);
    if (fails >= 8) return json({ error: 'Твърде много неуспешни опита. Опитайте пак след 15 минути.' }, 429);
    const u = email && ((await kv.get(`user:${email}`, 'json')) as User | null);
    const ok = !!u && sameString(await hashPassword(password, u.salt), u.hash);
    if (!ok || !u) {
      await kv.put(failKey, String(fails + 1), { expirationTtl: 900 });
      return json({ error: 'Грешен имейл или парола.' }, 401);
    }
    await kv.delete(failKey);
    const newSid = await newSession(env, { kind: 'pw', email: u.email, name: u.name, admin: !!u.admin });
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(newSid) } });
  }

  const sess = sid && /^[a-f0-9]{64}$/.test(sid) ? ((await kv.get(`sess:${sid}`, 'json')) as Sess | null) : null;
  if (!sess) return json({ error: 'login' }, 401);
  const repo = env.REPO || 'bgyordan/assyst-site';

  if (pathname === '/api/me') {
    if (sess.kind === 'github') {
      if (!sess.push) return json({ error: 'noaccess', login: sess.login }, 403);
      return json({ kind: 'github', login: sess.login, name: sess.name, avatar: sess.avatar, admin: true, repo });
    }
    const u = (await kv.get(`user:${sess.email}`, 'json')) as User | null;
    if (!u) { await kv.delete(`sess:${sid}`); return json({ error: 'login' }, 401); }
    return json({ kind: 'pw', login: u.email, name: u.name, avatar: '', admin: !!u.admin, repo });
  }

  if (pathname === '/api/password' && request.method === 'POST') {
    if (sess.kind !== 'pw') return json({ error: 'Паролата се сменя само за вход с имейл.' }, 400);
    const b = await body();
    const u = (await kv.get(`user:${sess.email}`, 'json')) as User | null;
    if (!u || !sameString(await hashPassword(String(b.old ?? ''), u.salt), u.hash)) return json({ error: 'Старата парола е грешна.' }, 400);
    const pw = String(b.password ?? '');
    if (pw.length < 8) return json({ error: 'Новата парола трябва да е поне 8 знака.' }, 400);
    u.salt = randomHex(16); u.hash = await hashPassword(pw, u.salt);
    await kv.put(`user:${u.email}`, JSON.stringify(u));
    return json({ ok: true });
  }

  if (pathname === '/api/users') {
    if (!isAdmin(sess)) return json({ error: 'Само администратор може да управлява служителите.' }, 403);
    if (request.method === 'GET') {
      const list = await kv.list({ prefix: 'user:' });
      const users = (await Promise.all(list.keys.map((k) => kv.get(k.name, 'json')))).filter(Boolean) as User[];
      const svc = (await kv.get('svc:github', 'json')) as { login?: string; at?: number } | null;
      return json({ users: users.map(publicUser).sort((a, b) => a.name.localeCompare(b.name)), saver: svc ? { login: svc.login, at: svc.at } : null });
    }
    if (request.method === 'POST') {
      const b = await body();
      const email = normEmail(b.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Невалиден имейл.' }, 400);
      const name = clean(b.name, 80).replace(/\n/g, ' ') || email;
      const existing = (await kv.get(`user:${email}`, 'json')) as User | null;
      const pw = String(b.password ?? '');
      if (!existing && pw.length < 8) return json({ error: 'Паролата трябва да е поне 8 знака.' }, 400);
      if (pw && pw.length < 8) return json({ error: 'Паролата трябва да е поне 8 знака.' }, 400);
      if (sess.kind === 'pw' && sess.email === email && !b.admin) return json({ error: 'Не можете да махнете собствените си права на администратор.' }, 400);
      const u: User = existing || { email, name, hash: '', salt: '', created: Date.now() };
      u.name = name; u.admin = !!b.admin;
      if (pw) { u.salt = randomHex(16); u.hash = await hashPassword(pw, u.salt); }
      await kv.put(`user:${email}`, JSON.stringify(u));
      return json({ ok: true, user: publicUser(u) });
    }
    if (request.method === 'DELETE') {
      const email = normEmail(url.searchParams.get('email'));
      if (sess.kind === 'pw' && sess.email === email) return json({ error: 'Не можете да изтриете собствения си профил.' }, 400);
      await kv.delete(`user:${email}`);
      return json({ ok: true });
    }
    return json({ error: 'Method' }, 405);
  }

  if (!pathname.startsWith('/api/repo/')) return json({ error: 'Not found' }, 404);
  const sub = pathname.slice('/api/repo/'.length);
  if (!/^(contents\/|git\/trees\/|actions\/runs|commits)/.test(sub) || sub.includes('..')) return json({ error: 'Not allowed' }, 403);
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Method' }, 405);
  let token: string;
  if (sess.kind === 'github') {
    if (!sess.push) return json({ error: 'noaccess', login: sess.login }, 403);
    token = sess.token;
  } else {
    const svc = (await kv.get('svc:github', 'json')) as { token?: string } | null;
    if (!svc?.token) return json({ error: 'Администраторът трябва да влезе веднъж с GitHub, за да могат служителите да записват.' }, 503);
    token = svc.token;
  }
  let reqBody: string | undefined;
  if (request.method !== 'GET') {
    reqBody = await request.text();
    if (sess.kind === 'pw') {
      // Record who made the change.
      const b = JSON.parse(reqBody || '{}');
      b.message = `${b.message || 'Промяна'} (${sess.name})`;
      b.author = { name: sess.name, email: sess.email };
      reqBody = JSON.stringify(b);
    }
  }
  const res = await gh(token, `repos/${repo}/${sub}${url.search}`, { method: request.method, body: reqBody });
  if (res.status === 401 && sess.kind === 'pw') return json({ error: 'Ключът за записване е изтекъл. Администраторът трябва да влезе веднъж с GitHub.' }, 503);
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function contact(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Bad origin' }, 403);
  const f = await request.formData().catch(() => null);
  if (!f) return json({ error: 'Bad request' }, 400);
  if (clean(f.get('website'), 100)) return json({ ok: true }); // honeypot
  const name = clean(f.get('name'), 120).replace(/\n/g, ' ');
  const email = clean(f.get('email'), 200).replace(/\s/g, '');
  const phone = clean(f.get('phone'), 40).replace(/\n/g, ' ');
  const subject = clean(f.get('subject'), 200).replace(/\n/g, ' ');
  const message = clean(f.get('message'), 5000);
  if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Моля, попълнете задължителните полета.' }, 400);
  if (!env.MAIL || !env.CONTACT_TO || !env.CONTACT_FROM) return json({ error: 'Формата още не е настроена.' }, 503);

  const msg = createMimeMessage();
  msg.setSender({ name: 'Сайт assyst.bg', addr: env.CONTACT_FROM });
  msg.setRecipient(env.CONTACT_TO);
  msg.setHeader('Reply-To', new Mailbox({ name: name.replace(/[<>",]/g, ''), addr: email }));
  msg.setSubject(`Съобщение от сайта: ${subject || name}`);
  msg.addMessage({
    contentType: 'text/plain',
    data: `Име: ${name}\nИмейл: ${email}\nТелефон: ${phone || '-'}\nТема: ${subject || '-'}\n\n${message}\n`,
  });
  try {
    await env.MAIL.send(new EmailMessage(env.CONTACT_FROM, env.CONTACT_TO, msg.asRaw()));
  } catch {
    return json({ error: 'Изпращането не успя.' }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/auth' && request.method === 'GET') return auth(request, env);
    if (pathname === '/api/callback' && request.method === 'GET') return callback(request, env);
    if (pathname === '/api/contact' && request.method === 'POST') return contact(request, env);
    if (['/api/me', '/api/logout', '/api/login', '/api/password', '/api/users'].includes(pathname) || pathname.startsWith('/api/repo/')) return adminApi(request, env, pathname);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    if (pathname === '/admin/pro/config.yml') {
      // Sign-in must go through the domain the admin is opened on (workers.dev preview or assyst.bg).
      const res = await env.ASSETS.fetch(request);
      const origin = new URL(request.url).origin;
      const text = (await res.text()).replace(/^(\s*base_url:).*$/m, `$1 ${origin}`);
      return new Response(text, { headers: { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
