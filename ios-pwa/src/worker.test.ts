import { describe, expect, it, vi } from 'vitest';
import worker from './worker';

const ORIGIN = 'https://pwa.10273055.xyz';
const assets = { fetch: vi.fn(async (_req: Request) => new Response('<html>ok</html>', {
  headers: { 'Content-Type': 'text/html' }
})) };

describe('Cloudflare PWA public edge boundary', () => {
  it('is transparent that school login does not work at the edge', async () => {
    const res = await worker.fetch(new Request(ORIGIN + '/api/health'), { ASSETS: assets });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, mode: 'local-only', canQuerySchool: false });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('never forwards login endpoints to any school server or assets', async () => {
    assets.fetch.mockClear();
    const res = await worker.fetch(
      new Request(ORIGIN + '/api/login', { method: 'POST', body: 'synthetic-request' }),
      { ASSETS: assets }
    );
    expect(res.status).toBe(503);
    expect(assets.fetch).not.toHaveBeenCalled();
  });
  it('adds strong headers to all frontend assets', async () => {
    const res = await worker.fetch(new Request(ORIGIN + '/'), { ASSETS: assets });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
  it('denies unsupported HTTP methods', async () => {
    const res = await worker.fetch(new Request(ORIGIN + '/', { method: 'POST' }), { ASSETS: assets });
    expect(res.status).toBe(405);
  });
});
