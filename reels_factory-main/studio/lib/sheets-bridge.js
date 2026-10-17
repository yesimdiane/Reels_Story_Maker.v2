'use strict';
const crypto = require('node:crypto');

function createSheetsBridge({ url = '', token = '', fetchFn = globalThis.fetch, log = () => {} } = {}) {
  const enabled = /^https:\/\/script\.google\.com\/macros\/s\//.test(url) && token.length >= 32;
  async function request(action, payload = {}) {
    if (!enabled) throw new Error('Sheets bridge is not configured');
    const response = await fetchFn(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, ...payload }), redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('Sheets bridge HTTP ' + response.status);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Sheets bridge rejected request');
    return data;
  }
  async function push(episode) {
    const snapshot = JSON.parse(JSON.stringify(episode));
    // Avoid mirroring raw media or credentials; only metadata and production decisions.
    const serialized = JSON.stringify(snapshot);
    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    return request('put', { snapshot, hash });
  }
  async function health() { return request('health'); }
  async function list() { return request('list'); }
  async function get(id) { return request('get', { id }); }
  return { enabled, push, health, list, get };
}
module.exports = { createSheetsBridge };
