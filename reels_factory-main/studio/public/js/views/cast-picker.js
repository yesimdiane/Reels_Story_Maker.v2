// Story Lab → compact "캐릭터 & 유니버스" picker: one universe dropdown + small character chips (multi-select), guest / narrator.
// Profiles and universes are edited in Settings → Character Library, never here. The selection is saved per product on the server
// and sent with every story request. Nothing here makes a paid call.
import { h, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

const avatar = (c) => (c.thumb ? h('img', { class: 'cast-chip-thumb', src: c.thumb.url, alt: '', loading: 'lazy' }) : h('span', { class: 'cast-chip-thumb cast-init', 'aria-hidden': 'true' }, (c.name || '?')[0]));
// the characters last chosen inside each universe (per product), so switching the dropdown back and forth keeps them (session only)
const memo = {};

export function castSection(pid, castState, onChange) {
  const U = (state.summary.universes || {}).universes || [];
  const sel = castState.cast;
  const universe = U.find((u) => u.id === sel.universeId) || U[0];
  const rerender = () => act(async () => null);
  const save = async (next) => {
    try { await api.put(`/api/storylab/${pid}/cast`, next); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    await rerender(); if (onChange) onChange();
  };
  const chooseUniverse = (id) => {
    const u = U.find((x) => x.id === id);
    if (!u || u.id === sel.universeId) return;
    memo[pid + ':' + sel.universeId] = sel.characterIds.slice();
    const own = new Set(u.characters.map((c) => c.id));
    const back = (memo[pid + ':' + u.id] || []).filter((x) => own.has(x));
    return save({ universeId: u.id, characterIds: back.length ? back : u.characters.map((c) => c.id), guest: null, narrator: false });
  };
  const toggle = (id) => {
    const on = sel.characterIds.includes(id);
    const ids = on ? sel.characterIds.filter((x) => x !== id) : sel.characterIds.concat([id]);
    if (!ids.length && !sel.guest && !sel.narrator) return toast('출연 캐릭터를 한 명 이상 선택하세요', { error: true });
    return save({ universeId: sel.universeId, characterIds: ids, guest: sel.guest, narrator: sel.narrator });
  };
  const guest = { name: (sel.guest && sel.guest.name) || '', description: (sel.guest && sel.guest.description) || '' };
  const warn = castState.warnings || [];
  const count = sel.characterIds.length;

  return h('section', { class: 'cast-picker cast-compact stack', style: 'gap:8px', 'data-cast-picker': '', 'aria-label': '캐릭터 & 유니버스 선택' },
    h('div', { class: 'cast-bar' },
      h('label', { class: 'cast-bar-field' }, h('span', { class: 'small', style: 'font-weight:600' }, '유니버스'),
        h('select', { class: 'cast-universe-select', 'data-universe-select': '', 'aria-label': '유니버스', onchange: (e) => chooseUniverse(e.target.value) },
          U.filter((u) => u.active !== false || u.id === sel.universeId).map((u) => h('option', { value: u.id, selected: u.id === sel.universeId }, `${u.name} (${u.characters.length}명 · ${u.language === 'ko' ? '한국어' : '영어'} 대사)`)))),
      h('span', { class: 'chip cast-count', 'data-cast-count': String(count) }, `선택 ${count}명`),
      h('a', { class: 'small', href: '#/settings/characters' }, '캐릭터 편집은 설정 → 캐릭터 라이브러리')),
    universe ? h('div', { class: 'cast-chip-row', 'data-no-en': '', role: 'group', 'aria-label': '출연 캐릭터', 'data-cast-chars': '' }, universe.characters.map((c) => {
      const on = sel.characterIds.includes(c.id);
      return h('button', { type: 'button', class: 'cast-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-character': c.id, title: [c.role || '', c.hasApprovedReference ? '' : '참조 이미지 없음'].filter(Boolean).join(' · ') || c.name, onclick: () => toggle(c.id) },
        avatar(c), h('span', { class: 'cast-chip-name' }, c.name), !c.hasApprovedReference ? h('span', { class: 'cast-chip-warn', 'aria-label': '참조 이미지 없음' }, '참조 없음') : null);
    })) : null,
    h('div', { class: 'cast-foot' },
    h('details', { class: 'small', 'data-guest': '' }, h('summary', { style: 'cursor:pointer;min-height:32px;display:flex;align-items:center' }, '게스트 · 내레이터' + (sel.guest || sel.narrator ? ' (사용 중)' : '')),
      h('div', { class: 'stack', style: 'gap:8px;margin-top:6px' },
        h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: !!sel.narrator, 'data-narrator': '', onchange: (e) => save({ universeId: sel.universeId, characterIds: sel.characterIds, guest: sel.guest, narrator: e.target.checked }) }), '내레이터(보이스오버) 허용'),
        h('div', { class: 'grid two' },
          h('input', { type: 'text', placeholder: '게스트 이름 (1회성)', value: guest.name, 'aria-label': '게스트 이름', 'data-guest-name': '', oninput: (e) => (guest.name = e.target.value) }),
          h('input', { type: 'text', placeholder: '게스트 설명', value: guest.description, 'aria-label': '게스트 설명', oninput: (e) => (guest.description = e.target.value) })),
        h('div', { class: 'row', style: 'gap:8px' }, h('button', { type: 'button', class: 'btn sm ghost', 'data-guest-save': '', onclick: () => save({ universeId: sel.universeId, characterIds: sel.characterIds, guest: guest.name.trim() ? guest : null, narrator: sel.narrator }) }, '게스트 적용')),
        h('div', { class: 'small muted' }, '게스트는 저장된 정체성·목소리가 없어 대사 없이 1회성으로만 등장합니다. 선택하지 않은 캐릭터는 새로 등장하지 않습니다.'))),
    h('div', { class: 'small muted', 'data-cast-summary': '' }, `선택: ${universe ? universe.name : '?'} · ${count}명${sel.guest ? ' + 게스트 ' + sel.guest.name : ''}${sel.narrator ? ' + 내레이터' : ''}${castState.saved ? '' : ' (기본값 — 선택하면 저장됩니다)'}`)),
    castState.errors && castState.errors.length ? h('div', { class: 'banner err' }, h('div', null, castState.errors.map((e) => h('div', null, e.message)))) : null,
    warn.length ? h('div', { class: 'small', style: 'color:var(--clay)', 'data-cast-warnings': '' }, warn.map((w) => h('div', null, '• ' + w.message))) : null,
    null);
}
