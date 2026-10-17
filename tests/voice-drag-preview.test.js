'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTimeline } = require('../studio/lib/timeline');
const preview = fs.readFileSync(path.join(__dirname,'../studio/public/js/views/video-summary.js'),'utf8');
test('voice offsets preserve default order and honor explicit 0.3 second timing', () => {
  const ep = {scenes:[{id:'S1',durationSec:5}],lines:[{id:'L1',sceneId:'S1'},{id:'L2',sceneId:'S1'}],cta:{durationSec:0}};
  const normal=buildTimeline(ep,()=>1);
  assert.ok(normal.lines[1].start>normal.lines[0].end);
  ep.audioTiming={L2:3.3};
  const shifted=buildTimeline(ep,()=>1);
  assert.equal(shifted.lines[1].start,3.3);
  assert.ok(shifted.lines[1].end<=5);
});
test('existing clip preview enabled without unapproved full render',()=>{
  assert.match(preview,/const clipPreview = !shown/);
  assert.match(preview,/기존 클립 재생 \(무료\)/);
  assert.match(preview,/r\.canRender \? render\(true\)/);
});
