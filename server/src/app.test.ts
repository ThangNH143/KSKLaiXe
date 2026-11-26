import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, normalizeSubpathPrefix } from './app.js';

describe('GET /api/health & Production static client/dist serving (Root + IIS Subpath)', () => {
  it('trả về HTTP 200 và {"ok":true}', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('phục vụ giao diện tĩnh client/dist và SPA fallback trên cùng 1 cổng khi bật serveClientDist, không chặn /api/*', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gksk-client-dist-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'index.html'),
        '<!doctype html><html><body><div id="root">GKSKLaiXe Production SPA</div></body></html>',
        'utf8',
      );
      fs.mkdirSync(path.join(tmpDir, 'assets'));
      fs.writeFileSync(
        path.join(tmpDir, 'assets', 'app.js'),
        'console.log("gksk-asset");',
        'utf8',
      );

      const app = createApp({
        serveClientDist: true,
        clientDistDir: tmpDir,
      });

      const homeRes = await request(app).get('/');
      expect(homeRes.status).toBe(200);
      expect(homeRes.headers['content-type']).toContain('text/html');
      expect(homeRes.text).toContain('GKSKLaiXe Production SPA');

      const spaRouteRes = await request(app).get('/import');
      expect(spaRouteRes.status).toBe(200);
      expect(spaRouteRes.text).toContain('GKSKLaiXe Production SPA');

      const assetRes = await request(app).get('/assets/app.js');
      expect(assetRes.status).toBe(200);
      expect(assetRes.text).toContain('gksk-asset');

      const healthRes = await request(app).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body).toEqual({ ok: true });

      const protectedApiRes = await request(app).get('/api/certificates');
      expect(protectedApiRes.status).toBe(401);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('hỗ trợ chạy dưới Subpath IIS (basePath="/KSKLaiXe") cho cả giao diện tĩnh, SPA route và /KSKLaiXe/api/*', async () => {
    expect(normalizeSubpathPrefix('')).toBe('');
    expect(normalizeSubpathPrefix('/')).toBe('');
    expect(normalizeSubpathPrefix('KSKLaiXe/')).toBe('/KSKLaiXe');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gksk-subpath-dist-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'index.html'),
        '<!doctype html><html><body><div id="root">GKSKLaiXe Subpath SPA</div></body></html>',
        'utf8',
      );
      fs.mkdirSync(path.join(tmpDir, 'assets'));
      fs.writeFileSync(
        path.join(tmpDir, 'assets', 'sub.js'),
        'console.log("gksk-subpath-asset");',
        'utf8',
      );

      const app = createApp({
        serveClientDist: true,
        clientDistDir: tmpDir,
        basePath: '/KSKLaiXe',
      });

      const subHomeRes = await request(app).get('/KSKLaiXe');
      expect(subHomeRes.status).toBe(200);
      expect(subHomeRes.text).toContain('GKSKLaiXe Subpath SPA');

      const subSpaRes = await request(app).get('/KSKLaiXe/import');
      expect(subSpaRes.status).toBe(200);
      expect(subSpaRes.text).toContain('GKSKLaiXe Subpath SPA');

      const subAssetRes = await request(app).get('/KSKLaiXe/assets/sub.js');
      expect(subAssetRes.status).toBe(200);
      expect(subAssetRes.text).toContain('gksk-subpath-asset');

      const subHealthRes = await request(app).get('/KSKLaiXe/api/health');
      expect(subHealthRes.status).toBe(200);
      expect(subHealthRes.body).toEqual({ ok: true });

      const rootHealthRes = await request(app).get('/api/health');
      expect(rootHealthRes.status).toBe(200);
      expect(rootHealthRes.body).toEqual({ ok: true });

      const subProtectedRes = await request(app).get('/KSKLaiXe/api/certificates');
      expect(subProtectedRes.status).toBe(401);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('cấu hình Helmet: giữ nguyên upgrade-insecure-requests/HSTS/COOP khi allowInsecureCookie=false và tự động tắt chúng khi allowInsecureCookie=true (chống lỗi màn hình trắng trên HTTP LAN)', async () => {
    const strictApp = createApp({
      auth: {
        allowInsecureCookie: false,
      },
    });
    const strictRes = await request(strictApp).get('/api/health');
    expect(strictRes.status).toBe(200);
    expect(strictRes.headers['content-security-policy']).toContain(
      'upgrade-insecure-requests',
    );
    expect(strictRes.headers['strict-transport-security']).toBeDefined();
    expect(strictRes.headers['cross-origin-opener-policy']).toBeDefined();
    expect(strictRes.headers['origin-agent-cluster']).toBeDefined();

    const lanHttpApp = createApp({
      auth: {
        allowInsecureCookie: true,
      },
    });
    const lanRes = await request(lanHttpApp).get('/api/health');
    expect(lanRes.status).toBe(200);
    expect(lanRes.headers['content-security-policy']).toBeDefined();
    expect(lanRes.headers['content-security-policy']).toContain("default-src 'self'");
    expect(lanRes.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
    expect(lanRes.headers['strict-transport-security']).toBeUndefined();
    expect(lanRes.headers['cross-origin-opener-policy']).toBeUndefined();
    expect(lanRes.headers['origin-agent-cluster']).toBeUndefined();
  });
});
