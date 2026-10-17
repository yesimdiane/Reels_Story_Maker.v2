'use strict';
// Railway's deploy healthcheck sends GET /healthz with Host: healthcheck.railway.app. With RF_PUBLIC_HOST set, the
// Host allowlist must still reject everything else; only that exact request is exempt.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, createAuth } = require('../studio/server');
const { make } = require('./helpers/v23');

async function boot() {
  const { s } = make({ env: {} });
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
  const app = createApp(s, { port, host: '0.0.0.0', publicHost: 'studio.example.com', auth: createAuth({ password: 'a-long-admin-password', secret: 'k' }) });
  await new Promise((r) => app.listen(port, '127.0.0.1', r));
  return { port, close: () => new Promise((r) => app.close(r)) };
}
const req = (port, method, path, host, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path, headers: Object.assign({ Host: host }, headers) }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
  });
  r.on('error', reject); r.end();
});
const RH = 'healthcheck.railway.app';

test('Railway healthcheck: GET /healthz with Host healthcheck.railway.app is allowed without login', async () => {
  const t = await boot();
  try {
    const r = await req(t.port, 'GET', '/healthz', RH);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal((await req(t.port, 'GET', '/healthz', 'studio.example.com')).status, 200); // normal public host still works
  } finally { await t.close(); }
});

test('Railway healthcheck host is NOT accepted for any other path or method', async () => {
  const t = await boot();
  try {
    for (const p of ['/', '/api/session', '/api/episodes', '/media/product/a/b', '/healthz/x', '/healthz.json']) {
      const r = await req(t.port, 'GET', p, RH);
      assert.equal(r.status, 403, p); assert.equal(r.json && r.json.error.code, 'HOST', p);
    }
    for (const m of ['POST', 'PUT', 'DELETE']) {
      const r = await req(t.port, m, '/healthz', RH, { 'x-rf-studio': '1' });
      assert.equal(r.status, 403, m); assert.equal(r.json.error.code, 'HOST', m);
    }
  } finally { await t.close(); }
});

test('other / look-alike hosts are still rejected, even on /healthz', async () => {
  const t = await boot();
  try {
    for (const h of ['evil.example.com', 'healthcheck.railway.app.evil.com', 'xhealthcheck.railway.app', 'healthcheck.railway.app:8080', 'railway.app']) {
      const r = await req(t.port, 'GET', '/healthz', h);
      assert.equal(r.status, 403, h); assert.equal(r.json.error.code, 'HOST', h);
    }
    assert.equal((await req(t.port, 'GET', '/api/session', 'evil.example.com')).status, 403);
  } finally { await t.close(); }
});

test('login protection is unchanged: API still needs a session for the public host', async () => {
  const t = await boot();
  try {
    const r = await req(t.port, 'GET', '/api/episodes', 'studio.example.com');
    assert.equal(r.status, 401); assert.equal(r.json.error.code, 'LOGIN_REQUIRED');
  } finally { await t.close(); }
});
