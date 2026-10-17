'use strict';
// MuAPI video-model contract. MuAPI documents the submit/poll protocol but each model endpoint takes its own JSON
// field names, so nothing here assumes two models share a request shape: every model declares its own field map.
// Verification levels (strongest last): 'unverified' (seed / catalog id only) < 'user-entered' (operator confirmed the
// endpoint and parameters in the MuAPI playground) < 'verified' (a real job on this endpoint completed).

const LEVELS = ['unverified', 'user-entered', 'verified'];
const LIVE_OK = ['user-entered', 'verified'];

/** Endpoint path relative to the fixed MuAPI base. No scheme, host, query, fragment, backslash, '//' or '..'. */
function validateEndpoint(raw) {
  const ep = String(raw == null ? '' : raw).trim().replace(/^\/(?!\/)/, '').replace(/^api\/v1\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{1,100}$/.test(ep) || ep.includes('..') || ep.includes('//') || /^[a-z][a-z0-9+.-]*:/i.test(ep)) return null;
  return ep;
}

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
function field(v, dflt) { const s = String(v == null || v === '' ? dflt : v).trim(); return FIELD.test(s) ? s : null; }

/** extraParams: flat JSON of scalar constants the model requires (e.g. {"mode":"std"}); never secrets, never nested. */
function cleanExtra(x) {
  if (x == null || x === '') return {};
  const o = typeof x === 'string' ? JSON.parse(x) : x;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('extraParams must be a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!FIELD.test(k)) throw new Error('bad extraParams key: ' + k);
    if (!['string', 'number', 'boolean'].includes(typeof v)) throw new Error('extraParams values must be string/number/boolean: ' + k);
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

/** The request body for one submit. Field names come from the model; unset optional fields are simply not sent. */
function buildBody(model, { prompt, imageUrl, aspectRatio, duration, negativePrompt, extra = {}, silent = false }) {
  // silentParams: the model's own switch that turns generated audio off (e.g. {generate_audio:false}); only sent when the operator declared it
  const body = Object.assign({}, model.extraParams || {}, silent ? model.silentParams || {} : {}, extra);
  // An endpoint slug or UI alias is NOT a MuAPI AIR identifier. Never send a
  // guessed 'model' value to a potentially billable endpoint.
  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    const value = body.model;
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('MuAPI model must be a non-empty AIR identifier string; check model extraParams. No generation submitted.');
    }
    const catalog = require('../seed/muapi-cli-i2v.json').models;
    const knownAliases = new Set(catalog.flatMap((entry) => [entry.alias, entry.endpoint]));
    if (knownAliases.has(value.trim()) || value.trim() === model.id || value.trim() === model.endpoint) {
      throw new Error('MuAPI model field contains a UI alias or endpoint, not a confirmed AIR identifier. Verify the exact AIR ID in MuAPI documentation/playground before generating. No generation submitted.');
    }
  }
  // Seedance 2.5 has two separate, billable steps. Never infer finalization
  // from a draft response: it requires a fresh, explicit operator decision.
  if (validateEndpoint(model.endpoint) === 'seedance-2.5-image-to-video') {
    const draft = body.draft === true;
    const draftId = body.draft_request_id;
    if (draftId != null && draftId !== '' && (typeof draftId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(draftId))) throw new Error('Invalid Seedance draft_request_id');
    if (draft && draftId) throw new Error('Seedance draft and finalize cannot run together');
    if (draft && body.resolution !== undefined && body.resolution !== '480p') throw new Error('Seedance draft requires 480p');
    if (draftId && body.resolution !== undefined && body.resolution !== '1080p') throw new Error('Seedance finalization requires 1080p');
    if (draftId && draft !== false) throw new Error('Seedance finalization must have draft=false');
  }
  body[model.promptField || 'prompt'] = prompt;
  // The official MuAPI CLI catalog declares the input image shape per exact endpoint.
  // Older saved custom models may still have the default image_url field even when their
  // endpoint requires images_list. Resolve that stale default without guessing for unknown endpoints.
  const catalog = require('../seed/muapi-cli-i2v.json').models;
  const contract = catalog.find((entry) => entry.endpoint === validateEndpoint(model.endpoint));
  const usesList = contract ? contract.imageAsList === true : model.imageAsList === true;
  const imageField = contract && (model.imageField == null || model.imageField === 'image_url' || model.imageField === 'images_list')
    ? contract.imageField
    : model.imageField || (usesList ? 'images_list' : 'image_url');
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) throw new Error('Approved starting image URL is required before MuAPI submission');
  body[imageField] = usesList ? [imageUrl] : imageUrl;
  if (aspectRatio != null && !model.omitAspectRatio) body[model.aspectField || 'aspect_ratio'] = aspectRatio;
  if (duration != null) body[model.durationField || 'duration'] = duration;
  if (negativePrompt && model.supportsNegativePrompt !== false) body[model.negativeField || 'negative_prompt'] = negativePrompt;
  return body;
}

module.exports = { LEVELS, LIVE_OK, validateEndpoint, field, cleanExtra, buildBody };
