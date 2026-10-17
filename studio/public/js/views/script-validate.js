// Inline error highlighting + error navigation for Script Studio.
// Every editable input carries data-rf="<kind>:<id>:<field>"; a validation error maps to exactly one such key, so a click on the
// error (summary, scene footer, tab badge) can open the collapsed section, scroll to the input, focus it and flash it.
//   S:<sceneId>:<field>   scene fields (title_ko, durationSec, visual, action, narration, placement, characters, showsProduct, block, timing)
//   L:<lineId>:<field>    dialogue fields (en, ko, speaker)
//   B:<beatKey>:<field>   beat title (title_ko) or the beat card
//   cta:<field>           CTA lines / keyword / durationSec
import { h } from '../ui.js';

// Codes that mean "a required field is empty": the red state clears as soon as the user types something.
const EMPTY_CODES = new Set(['LINE_EN', 'LINE_KO', 'SCENE_VISUAL', 'SCENE_TITLE', 'KEYWORD', 'CTA', 'BEAT_TITLE', 'SCENE_STORY']);

export function targetKey(e) {
  if (!e) return null;
  if (e.field === 'timing') return e.sceneId ? `S:${e.sceneId}:durationSec` : null;
  if (e.field && e.field.startsWith('cta.')) return 'cta:' + e.field.slice(4);
  if (e.field === 'beat.title_ko' && e.beatKey) return `B:${e.beatKey}:title_ko`;
  if (e.lineId && e.field && e.sceneId) return `L:${e.lineId}:${e.field}`;
  if (e.sceneId && e.field) return `S:${e.sceneId}:${e.field}`;
  if (e.sceneId) return `S:${e.sceneId}:block`;
  if (e.beatKey) return `B:${e.beatKey}:card`;
  return null;
}

/** All blocking errors of the saved script, de-duplicated (episode-level validation + each scene's own checks). */
export function allErrors(ep) {
  const seen = new Set();
  const out = [];
  const add = (e) => { const k = e.code + '|' + e.message; if (seen.has(k)) return; seen.add(k); out.push(e); };
  (ep.derived.validation.errors || []).forEach(add);
  (ep.scenes || []).forEach((s) => ((s.approval && s.approval.errors) || []).forEach(add));
  return out;
}

export function errorIndex(ep) {
  const byKey = {};
  const errors = allErrors(ep).map((e) => Object.assign({}, e, { key: targetKey(e) }));
  errors.forEach((e) => { if (e.key) (byKey[e.key] = byKey[e.key] || []).push(e); });
  const bySceneCount = {};
  errors.forEach((e) => { const sid = e.sceneId || sceneOfLine(ep, e.lineId); if (sid) bySceneCount[sid] = (bySceneCount[sid] || 0) + 1; });
  return { errors, byKey, bySceneCount };
}
function sceneOfLine(ep, lineId) { const l = (ep.lines || []).find((x) => x.id === lineId); return l ? l.sceneId : ''; }

/**
 * Marks the input(s) inside `fieldEl` for navigation and shows the inline messages right below them.
 * `unsaved` = the user has edited since the last save: the red state is then only informational.
 */
export function attach(index, fieldEl, key, { label } = {}) {
  const errs = index.byKey[key] || [];
  const inputs = fieldEl.matches && fieldEl.matches('input,textarea,select') ? [fieldEl] : Array.from(fieldEl.querySelectorAll('input,textarea,select'));
  const input = inputs[0];
  if (input) {
    input.setAttribute('data-rf', key);
    if (label) input.setAttribute('aria-label', label);
  }
  if (!errs.length) return fieldEl;
  const box = h('div', { class: 'field-errors', role: 'alert', 'data-rf-msg': key }, errs.map((e) => h('div', { class: 'field-error' }, e.message.replace(/^S\d+: |^E\d+: /, ''))));
  if (input) { input.classList.add('has-error'); input.setAttribute('aria-invalid', 'true'); }
  (fieldEl.matches && fieldEl.matches('input,textarea,select') ? fieldEl.parentElement || fieldEl : fieldEl).append(box);
  if (input && errs.every((e) => EMPTY_CODES.has(e.code))) {
    const clear = () => { if (String(input.value || '').trim()) { input.classList.remove('has-error'); input.removeAttribute('aria-invalid'); box.remove(); } };
    input.addEventListener('input', clear);
  }
  return fieldEl;
}

const find = (key) => document.querySelector(`[data-rf="${CSS.escape(key)}"]`);

/** Scroll to the exact input (opening collapsed sections), focus it and flash it. */
export function jumpTo(err) {
  const key = typeof err === 'string' ? err : err.key || targetKey(err);
  const sid = typeof err === 'string' ? (/^S:([^:]+):/.exec(err) || [])[1] : err.sceneId || '';
  let el = key && find(key);
  if (!el && sid) el = find(`S:${sid}:block`) || document.getElementById('script-scene-' + sid);
  if (!el) return false;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) p.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const target = el.matches('input,textarea,select,button') ? el : null;
  if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }, 250);
  flash(el);
  // a timing error also flashes the dialogue meter of the scene
  if (typeof err !== 'string' && err.field === 'timing' && err.sceneId) { const m = find(`S:${err.sceneId}:timing`); if (m) flash(m); }
  return true;
}
function flash(el) {
  el.classList.remove('rf-flash');
  void el.offsetWidth;
  el.classList.add('rf-flash');
  setTimeout(() => el.classList.remove('rf-flash'), 2400);
}

/** Clickable validation summary grouped by scene. */
export function summary(ep, index, { onJump = jumpTo } = {}) {
  if (!index.errors.length) return h('div', { class: 'banner ok' }, '막는 오류가 없습니다.');
  const groups = new Map();
  index.errors.forEach((e) => { const sid = e.sceneId || sceneOfLine(ep, e.lineId) || (e.beatKey ? ((ep.scenes.find((s) => s.beatKey === e.beatKey) || {}).id || '') : ''); const k = sid || '__project'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
  const wrap = h('div', { class: 'stack validation-summary', style: 'gap:10px' }, h('div', { class: 'small', style: 'color:var(--rose);font-weight:600' }, `고쳐야 할 항목 ${index.errors.length}개 — 누르면 해당 입력칸으로 이동합니다`));
  groups.forEach((list, k) => {
    const sc = ep.scenes.find((s) => s.id === k);
    wrap.append(h('div', { class: 'stack', style: 'gap:6px' },
      h('div', { class: 'eyebrow' }, k === '__project' ? '프로젝트 전체' : `${k} · ${sc ? sc.title_ko || '' : ''}`),
      list.map((e) => h('button', { class: 'issue err issue-link', type: 'button', title: e.key ? '해당 입력칸으로 이동' : '해당 장면으로 이동', onclick: () => { if (!onJump(e)) { const el = document.getElementById('script-scene-' + (e.sceneId || k)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, h('span', null, e.message), e.recovery ? h('span', { class: 'fix' }, '→ ' + e.recovery) : null))));
  });
  return wrap;
}
