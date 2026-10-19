'use strict';
// The SSRF guard's DNS lookup must answer in the shape the socket asks for. Node >= 20 asks with { all: true } and expects an array;
// answering with one address string made every fetch fail with "Invalid IP address: undefined".
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createSafeLookup } = require('../studio/lib/extract');

const ask = (lookup, opts) => new Promise((resolve) => lookup('shop.test', opts, (err, a, f) => resolve({ err, a, f })));
const dnsReturning = (list) => (host, opts, cb) => cb(null, list);

test('safe lookup: array answer for { all: true }, single address for { all: false }', async () => {
  const lk = createSafeLookup(dnsReturning([{ address: '203.0.113.7', family: 4 }, { address: '2001:db8::1', family: 6 }]));
  const many = await ask(lk, { all: true });
  assert.deepEqual(many.a, [{ address: '203.0.113.7', family: 4 }, { address: '2001:db8::1', family: 6 }]);
  const one = await ask(lk, { all: false });
  assert.equal(one.a, '203.0.113.7'); assert.equal(one.f, 4);
  const legacy = await ask(createSafeLookup((h, o, cb) => cb(null, '203.0.113.7', 4)), {});
  assert.equal(legacy.a, '203.0.113.7', 'a lookup that still answers with one address string keeps working');
});

test('safe lookup: a host with ANY internal address is refused; empty and failed lookups are clear errors', async () => {
  const mixed = createSafeLookup(dnsReturning([{ address: '203.0.113.7', family: 4 }, { address: '10.0.0.5', family: 4 }]));
  assert.equal((await ask(mixed, { all: true })).err.code, 'BLOCKED_HOST');
  assert.equal((await ask(createSafeLookup(dnsReturning([{ address: '127.0.0.1', family: 4 }])), {})).err.code, 'BLOCKED_HOST');
  assert.equal((await ask(createSafeLookup(dnsReturning([])), { all: true })).err.code, 'ENOTFOUND');
  const boom = Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
  assert.equal((await ask(createSafeLookup((h, o, cb) => cb(boom)), {})).err, boom);
});

test('safe lookup works as a real socket lookup on this Node (no "Invalid IP address")', async () => {
  const lk = createSafeLookup(dnsReturning([{ address: '192.0.2.1', family: 4 }])); // TEST-NET: never answers
  const code = await new Promise((resolve) => {
    const s = net.connect({ host: 'shop.test', port: 9, lookup: lk, timeout: 600 });
    s.on('error', (e) => resolve(e.code));
    s.on('timeout', () => { s.destroy(); resolve('connect-attempted'); });
  });
  assert.notEqual(code, 'ERR_INVALID_IP_ADDRESS');
});
