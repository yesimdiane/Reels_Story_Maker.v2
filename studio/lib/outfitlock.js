'use strict';
const fs = require('node:fs');
const { StudioError } = require('./util');
/** Episode-specific clothing reference, approved by the operator. Never silently change. */
function lockedOutfits(ep, scene, store, characters) {
  const active = ep.outfitLock || {};
  const images = [], instructions = [];
  for (const id of scene.characters || []) {
    const lock = active[id];
    if (!lock) continue; // old episodes are untouched until the operator chooses a lock
    const c = characters.find((x) => x.id === id);
    const ref = c && (c.references || []).find((r) => r.id === lock.refId);
    if (!ref || !ref.approved || ref.placeholder) throw new StudioError('OUTFIT_REFERENCE_MISSING', id + ': 승인된 의상 기준 이미지가 없습니다. 비용 발생 전 확인하세요.', { status: 409 });
    const file = store.characters.refPath(id, ref);
    if (!fs.existsSync(file)) throw new StudioError('OUTFIT_REFERENCE_MISSING', id + ': 의상 이미지 파일이 없습니다.', { status: 409 });
    const ext = require('node:path').extname(file).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    images.push({ label: 'EPISODE OUTFIT LOCK for '+id+': use exactly this approved outfit reference, not a redesigned outfit.', mimeType, data: fs.readFileSync(file).toString('base64') });
    instructions.push('OUTFIT LOCK '+id+': preserve clothing colours, sleeves, material, silhouette and accessories exactly as in the attached EPISODE OUTFIT LOCK reference. '+String(lock.description || '').slice(0,400)+' No costume change in this scene.');
  }
  return { images, instructions };
}
function validateSelection(changes, characters) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new StudioError('BAD_OUTFIT_LOCK', '의상 잠금 정보가 올바르지 않습니다.', { status: 422 });
  const next = {};
  for (const [id, item] of Object.entries(changes)) {
    if (!item) continue;
    const c = characters.find((x) => x.id === id);
    const ref = c && (c.references || []).find((r) => r.id === item.refId && r.approved && !r.placeholder);
    if (!ref) throw new StudioError('OUTFIT_REFERENCE_MISSING', id+': 승인된 캐릭터 참조 이미지를 선택하세요.', { status: 409 });
    next[id] = { refId: ref.id, description: String(item.description || '').slice(0,400) };
  }
  return next;
}
module.exports = { lockedOutfits, validateSelection };
