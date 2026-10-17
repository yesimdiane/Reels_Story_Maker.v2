'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSheetsBridge } = require('../studio/lib/sheets-bridge');
const URL = 'https://script.google.com/macros/s/DEPLOYMENT/exec';
const token = '12345678901234567890123456789012';
test('bridge disabled without deployment URL and secret', () => {
  assert.equal(createSheetsBridge({url:'https://evil.test/collect',token}).enabled,false);
  assert.equal(createSheetsBridge({url:URL,token:'short'}).enabled,false);
});
test('bridge pushes a serialized snapshot and never exposes secret in response', async () => {
  let seen;
  const bridge = createSheetsBridge({url:URL,token,fetchFn:async (url,opts) => {
    seen = {url,opts,body:JSON.parse(opts.body)};
    return {ok:true,json:async()=>({ok:true,id:'PRD-001-R01'})};
  }});
  const res = await bridge.push({id:'PRD-001-R01',lines:[]});
  assert.equal(res.ok,true);
  assert.equal(seen.body.action,'put');
  assert.equal(seen.body.snapshot.id,'PRD-001-R01');
  assert.equal(seen.body.hash.length,64);
  assert.equal(seen.opts.headers['Content-Type'],'text/plain;charset=utf-8');
});
test('bridge rejects server errors', async () => {
  const bridge = createSheetsBridge({url:URL,token,fetchFn:async()=>({ok:true,json:async()=>({ok:false,error:'bad token'})})});
  await assert.rejects(()=>bridge.health(),/bad token/);
});
