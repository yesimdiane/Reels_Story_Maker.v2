// HeyGen voice catalog check (GET /v3/voices — documented at developers.heygen.com/reference/list-voices).
// Used to confirm that a configured ID really is a *voice* ID before any paid speech request. An identity ID
// (e.g. Jack's d51329d2…) is a different kind of ID and is never assumed to be a voice ID.
// The docs do not say whether listing is free; it is only called when the operator presses "Verify voice".
'use strict';

async function listVoices({ apiKey, type = 'private', fetchFn = globalThis.fetch, maxPages = 10 }) {
  if (!apiKey) throw new Error('HEYGEN_API_KEY가 없습니다 (renderer/.env).');
  const out = [];
  let token = '';
  for (let page = 0; page < maxPages; page++) {
    const url = 'https://api.heygen.com/v3/voices?type=' + type + '&limit=100' + (token ? '&token=' + encodeURIComponent(token) : '');
    const res = await fetchFn(url, { headers: { 'X-Api-Key': apiKey } });
    if (!res.ok) throw new Error('HeyGen 음성 목록 조회 실패 (HTTP ' + res.status + ')');
    const j = await res.json();
    (j.data || []).forEach((v) => out.push(v));
    if (!j.has_more || !j.next_token) break;
    token = j.next_token;
  }
  return out;
}

/** Looks for `id` among private (cloned) and public voices. Returns the voice object or null. */
async function findVoice(opts, id) {
  for (const type of ['private', 'public']) {
    const hit = (await listVoices(Object.assign({}, opts, { type }))).find((v) => v.voice_id === id);
    if (hit) return Object.assign({ catalog: type }, hit);
  }
  return null;
}

module.exports = { listVoices, findVoice };
