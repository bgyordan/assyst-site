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
    const h = new Headers({ Location: '/admin/' });
    h.append('Set-Cookie', `${SESSION}=${j.access_token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
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

// Simple admin panel API: /api/me, /api/logout, /api/repo/<GitHub repo API path>
async function adminApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (!origin || new URL(origin).host !== url.host || request.headers.get('X-Assyst') !== '1') return json({ error: 'Bad origin' }, 403);
  }
  if (pathname === '/api/logout') {
    return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${SESSION}=; Path=/api; Max-Age=0` } });
  }
  const token = getCookie(request, SESSION);
  if (!token) return json({ error: 'login' }, 401);
  const repo = env.REPO || 'bgyordan/assyst-site';
  if (pathname === '/api/me') {
    const [u, r] = await Promise.all([gh(token, 'user'), gh(token, `repos/${repo}`)]);
    if (u.status === 401) return json({ error: 'login' }, 401);
    const user = (await u.json()) as { login: string; name?: string; avatar_url: string };
    const rj = (await r.json().catch(() => ({}))) as { permissions?: { push?: boolean } };
    if (!rj.permissions?.push) return json({ error: 'noaccess', login: user.login }, 403);
    return json({ login: user.login, name: user.name || user.login, avatar: user.avatar_url, repo });
  }
  const sub = pathname.slice('/api/repo/'.length);
  if (!/^(contents\/|git\/trees\/|actions\/runs|commits)/.test(sub) || sub.includes('..')) return json({ error: 'Not allowed' }, 403);
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Method' }, 405);
  const res = await gh(token, `repos/${repo}/${sub}${url.search}`, {
    method: request.method,
    body: request.method === 'GET' ? undefined : await request.text(),
  });
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
    if (pathname === '/api/me' || pathname === '/api/logout' || pathname.startsWith('/api/repo/')) return adminApi(request, env, pathname);
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
