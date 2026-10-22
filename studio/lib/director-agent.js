'use strict';

// Deterministic Director workflow: this module never calls a model or a paid API.
// Every step is advanced explicitly and requires a human approval at its boundary.
const STAGES = Object.freeze(['product', 'story', 'script', 'image', 'animation', 'video', 'publishing']);
const STATUS = Object.freeze({PENDING:'pending', READY:'ready', AWAITING:'awaiting_approval', APPROVED:'approved', BLOCKED:'blocked'});
const COSTLY = new Set(['image', 'animation', 'video']);
function assertStage(stage) {
  if (!STAGES.includes(stage)) throw new Error('UNKNOWN_AGENT_STAGE');
}
function createRun({projectId, episodeId, productId} = {}) {
  if (!projectId || typeof projectId !== 'string') throw new Error('PROJECT_ID_REQUIRED');
  return {
    schemaVersion: 1, projectId, episodeId: episodeId || null, productId: productId || null,
    status: 'active', currentStage: 'product', revision: 0,
    stages: Object.fromEntries(STAGES.map((id, i) => [id, {
      status: i === 0 ? STATUS.READY : STATUS.PENDING,
      fingerprint: null, outputRef: null, approvedFingerprint: null
    }]))
  };
}
function clone(run) { return JSON.parse(JSON.stringify(run)); }
function validate(run) {
  if (!run || run.schemaVersion !== 1 || !run.stages) throw new Error('INVALID_AGENT_RUN');
  for (const stage of STAGES) if (!run.stages[stage]) throw new Error('INVALID_AGENT_RUN');
}
function completeStage(run, {stage, fingerprint, outputRef}) {
  validate(run); assertStage(stage);
  if (!fingerprint || !outputRef) throw new Error('OUTPUT_AND_FINGERPRINT_REQUIRED');
  const next = clone(run), step = next.stages[stage];
  if (next.currentStage !== stage || ![STATUS.READY, STATUS.AWAITING].includes(step.status)) throw new Error('STAGE_NOT_READY');
  if (step.status === STATUS.AWAITING && step.fingerprint === fingerprint && step.outputRef === outputRef) return next;
  step.status = STATUS.AWAITING;
  step.fingerprint = fingerprint;
  step.outputRef = outputRef;
  step.approvedFingerprint = null;
  next.revision++;
  return next;
}
function approveStage(run, {stage, fingerprint}) {
  validate(run); assertStage(stage);
  const next = clone(run), step = next.stages[stage];
  if (step.status === STATUS.APPROVED && step.approvedFingerprint === fingerprint) return next;
  if (next.currentStage !== stage || step.status !== STATUS.AWAITING || step.fingerprint !== fingerprint) throw new Error('APPROVAL_STALE_OR_MISSING');
  step.status = STATUS.APPROVED; step.approvedFingerprint = fingerprint;
  const idx = STAGES.indexOf(stage);
  if (idx < STAGES.length - 1) {
    const target = STAGES[idx + 1];
    next.currentStage = target;
    next.stages[target].status = STATUS.READY;
  } else { next.currentStage = null; next.status = 'completed'; }
  next.revision++;
  return next;
}
function reviseStage(run, stage) {
  validate(run); assertStage(stage);
  const next = clone(run), idx = STAGES.indexOf(stage);
  if (idx > 0 && next.stages[STAGES[idx - 1]].status !== STATUS.APPROVED) throw new Error('UPSTREAM_NOT_APPROVED');
  for (let i = idx; i < STAGES.length; i++) {
    const key = STAGES[i];
    next.stages[key] = {status: i === idx ? STATUS.READY : STATUS.PENDING,
      fingerprint:null, outputRef:null, approvedFingerprint:null};
  }
  next.currentStage = stage; next.status = 'active'; next.revision++;
  return next;
}
function paidGate(run, stage, {explicitApproval=false, modelVerified=false, budgetApproved=false} = {}) {
  validate(run); assertStage(stage);
  if (!COSTLY.has(stage)) throw new Error('NOT_A_PAID_STAGE');
  const idx = STAGES.indexOf(stage);
  return {
    allowed: Boolean(explicitApproval && modelVerified && budgetApproved &&
      STAGES.slice(0, idx).every(key => run.stages[key].status === STATUS.APPROVED) &&
      run.currentStage === stage && run.stages[stage].status === STATUS.READY)
  };
}
module.exports = {STAGES, STATUS, createRun, completeStage, approveStage, reviseStage, paidGate};
