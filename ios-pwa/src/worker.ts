/**
 * Public, credential-free Cloudflare Worker: PWA assets plus honest health endpoint.
 * Browser history stays in IndexedDB. No school proxy, credentials, cookie, KV or D1.
 */
interface Env { ASSETS: { fetch: (request: Request) => Promise<Response> } }

const SECURITY_HEADERS: Record<string, string> = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    if (url.pathname === '/api/health') {
      if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405 });
      return new Response(method === 'HEAD' ? null : JSON.stringify({
        ok: true, version: '1.0.1-pwa', mode: 'local-only',
        canQuerySchool: false, authentication: 'not-available',
      }), {
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        }
      });
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: '学校查询目前不通过 Cloudflare Worker 提供' }), {
        status: 503,
        headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405 });
    const upstream = await env.ASSETS.fetch(request);
    const response = new Response(upstream.body, upstream);
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/sw.js') {
      response.headers.set('Cache-Control', 'no-cache');
    }
    if (url.pathname === '/manifest.webmanifest') {
      response.headers.set('Content-Type', 'application/manifest+json; charset=utf-8');
    }
    return response;
  },
};
