'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {STAGES, createRun, completeStage, approveStage, reviseStage, paidGate} = require('../studio/lib/director-agent');
test('handoff needs an approved upstream stage and is immutable', () => {
  const original = createRun({projectId:'P1'});
  assert.equal(original.currentStage, 'product');
  const ready = completeStage(original, {stage:'product',fingerprint:'p1',outputRef:'products/1'});
  assert.equal(original.stages.product.status, 'ready');
  assert.equal(ready.stages.product.status, 'awaiting_approval');
  assert.throws(() => approveStage(ready,{stage:'product',fingerprint:'stale'}), /APPROVAL_STALE/);
  const approved = approveStage(ready,{stage:'product',fingerprint:'p1'});
  assert.equal(approved.currentStage, 'story');
  assert.equal(approved.stages.story.status,'ready');
  assert.deepEqual(approveStage(approved,{stage:'product',fingerprint:'p1'}),approved);
});
test('downstream approval becomes invalid when an upstream stage is revised', () => {
 let run=createRun({projectId:'P1'});
 for (const stage of STAGES.slice(0,3)) {
  run=completeStage(run,{stage,fingerprint:stage,outputRef:'ref-'+stage});
  run=approveStage(run,{stage,fingerprint:stage});
 }
 run=reviseStage(run,'story');
 assert.equal(run.currentStage,'story');
 assert.equal(run.stages.product.status,'approved');
 assert.equal(run.stages.script.status,'pending');
 assert.equal(run.stages.script.approvedFingerprint,null);
 assert.throws(()=>completeStage(run,{stage:'script',fingerprint:'x',outputRef:'y'}),/STAGE_NOT_READY/);
});
test('paid generation cannot begin from an unapproved or unverified state',()=>{
 let run=createRun({projectId:'P1'});
 assert.equal(paidGate(run,'image',{explicitApproval:true,modelVerified:true,budgetApproved:true}).allowed,false);
 for(const stage of STAGES.slice(0,3)){
 run=approveStage(completeStage(run,{stage,fingerprint:stage,outputRef:stage}),{stage,fingerprint:stage});
 }
 assert.equal(run.currentStage,'image');
 assert.equal(paidGate(run,'image',{modelVerified:true,budgetApproved:true}).allowed,false);
 assert.equal(paidGate(run,'image',{explicitApproval:true,modelVerified:false,budgetApproved:true}).allowed,false);
 assert.equal(paidGate(run,'image',{explicitApproval:true,modelVerified:true,budgetApproved:true}).allowed,true);
});
