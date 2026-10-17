// Sound effects of one scene: ONE editor used by Script Studio (section B) and Storyboard (효과음 · 씬 합본), backed by the same ep.sfx[] records.
// Sources: built-in (local FFmpeg), own upload, HeyGen catalog SEARCH (HeyGen has no sound-effect generation). Nothing here is paid or automatic.
import { h, icon } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';

export function sfxEditor(ep, sc) {
  const mine = (ep.sfx || []).filter((x) => x.sceneId === sc.id);
  const base = `/api/episodes/${ep.id}/scenes/${sc.id}`;
  const out = h('div', { class: 'small muted', 'data-sfx-search-out': sc.id });
  const queryIn = h('input', { type: 'text', placeholder: '예: whoosh, door close, notification', 'data-sfx-query': sc.id, style: 'flex:1;min-width:160px' });
  const search = async () => {
    out.textContent = '검색 중…';
    try {
      const r = await api.post(`/api/episodes/${ep.id}/sfx/search`, { query: queryIn.value });
      out.replaceChildren(h('div', { class: 'small muted' }, r.note), r.results.length ? h('div', { class: 'stack', style: 'gap:6px' }, r.results.map((x) => h('div', { class: 'card flat row', style: 'gap:8px;flex-wrap:wrap;align-items:center', 'data-sfx-result': x.id },
        h('div', { style: 'flex:1;min-width:140px' }, h('b', null, x.name), x.durationSec ? h('span', { class: 'small muted' }, ` · ${x.durationSec}초`) : null),
        h('audio', { controls: true, preload: 'none', src: x.previewUrl, style: 'height:32px' }),
        h('button', { class: 'btn sm sage', type: 'button', 'data-sfx-add-heygen': x.id, onclick: () => act(() => api.post(base + '/sfx/heygen', { soundId: x.id, offsetSec: 0 }), { ok: '효과음을 추가했습니다 (씬 시작 시점)' }) }, '추가')))) : h('div', { class: 'small' }, '검색 결과가 없습니다.'));
    } catch (e) { out.replaceChildren(h('div', { class: 'issue err' }, e.message + (e.recovery ? ' — ' + e.recovery : ''))); }
  };
  const fileIn = h('input', { type: 'file', accept: 'audio/*', style: 'display:none', 'data-sfx-file': sc.id, onchange: async (e) => { const file = e.target.files[0]; if (file) await act(() => api.upload(`${base}/sfx/upload?label=${encodeURIComponent(file.name)}`, file), { ok: '효과음을 올렸습니다' }); } });
  const builtin = h('select', { 'aria-label': '내장 효과음', 'data-sfx-builtin': sc.id }, Object.entries(ep.sceneFlow.builtinSfx || {}).map(([k, v]) => h('option', { value: k }, v)));
  return h('div', { class: 'stack', style: 'gap:6px' }, h('b', { class: 'small' }, '효과음'),
      mine.length ? mine.map((x) => h('div', { class: 'card flat row', style: 'gap:8px;flex-wrap:wrap;align-items:center', 'data-sfx': x.id },
        h('div', { style: 'flex:1;min-width:120px' }, h('b', null, x.label), h('span', { class: 'small muted' }, ' · ' + ({ upload: '직접 올림', builtin: '내장', heygen: 'HeyGen 카탈로그' }[x.source] || x.source))),
        h('audio', { controls: true, preload: 'none', src: `/media/sfx/${ep.id}/${x.id}`, style: 'height:32px' }),
        h('label', { class: 'small' }, '시작(초)', h('input', { type: 'number', step: 0.1, min: 0, value: x.offsetSec || 0, style: 'width:70px', 'data-sfx-offset': x.id, onchange: (e) => act(() => api.post(`/api/episodes/${ep.id}/sfx/${x.id}/update`, { offsetSec: Number(e.target.value) }), { ok: '효과음 시작 시점을 바꿨습니다' }) })),
        h('label', { class: 'small' }, '볼륨(dB)', h('input', { type: 'number', step: 1, min: -30, max: 6, value: x.gainDb, style: 'width:64px', onchange: (e) => act(() => api.post(`/api/episodes/${ep.id}/sfx/${x.id}/update`, { gainDb: Number(e.target.value) }), { ok: '볼륨을 바꿨습니다' }) })),
        h('button', { class: 'btn sm ghost danger', type: 'button', 'data-sfx-remove': x.id, onclick: () => act(() => api.post(`/api/episodes/${ep.id}/sfx/${x.id}/update`, { remove: true }), { ok: '효과음을 뺐습니다' }) }, '빼기'))) : h('div', { class: 'small muted' }, '이 씬에 효과음이 없습니다.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, builtin, h('button', { class: 'btn sm ghost', type: 'button', 'data-sfx-add-builtin': sc.id, onclick: () => act(() => api.post(base + '/sfx/builtin', { name: builtin.value, offsetSec: 0 }), { ok: '내장 효과음을 추가했습니다' }) }, '내장 효과음 추가 (무료)'), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => fileIn.click() }, icon('upload'), '파일 올리기'), fileIn),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, queryIn, h('button', { class: 'btn sm ghost', type: 'button', 'data-sfx-search': sc.id, disabled: !ep.sceneFlow.heygenConnected, title: ep.sceneFlow.heygenConnected ? '' : 'Settings → 음성 연결에서 HeyGen 키를 저장하세요', onclick: search }, 'HeyGen 카탈로그 검색')),
      out,
      h('div', { class: 'small muted' }, 'HeyGen은 새 효과음을 "생성"하지 않고 기존 카탈로그를 검색합니다. 크레딧 사용과 상업적 이용 조건은 HeyGen 계정 기준으로 확인하세요. 효과음은 씬 안의 시작 시점에 맞춰 들어가며 씬 길이는 바뀌지 않습니다.'));
}
