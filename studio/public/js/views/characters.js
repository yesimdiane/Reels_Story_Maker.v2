// Character Library: universes (casts) and their persistent character profiles. Profiles, universes and reference uploads cost nothing.
import { h, chip, toast, confirmDialog } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { pageHead } from './common.js';
import { charCard } from './settings.js';
import { voicePicker } from './voice-connections.js';
import { voiceSettings } from './voice-settings.js';
import { profileModal, universeModal } from './character-profile.js';

/** The reference section stays open across the re-render that follows every selection / approval / upload. */
function keepOpen(id, det) { det.addEventListener('toggle', () => { state.charOpen = state.charOpen || {}; state.charOpen[id] = det.open; }); return det; }
const avatar = (c) => (c.thumb ? h('img', { class: 'cast-thumb', src: c.thumb.url, alt: c.name, loading: 'lazy' }) : h('span', { class: 'cast-thumb cast-init', 'aria-hidden': 'true' }, (c.name || '?')[0]));

export function characters() {
  const U = (state.summary.universes || {}).universes || [];
  const full = state.summary.characters;
  const rerender = () => act(async () => null);
  const call = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } await rerender(); };
  const openUniverse = async (u) => { let t = []; try { t = (await api.get('/api/ending-templates')).templates; } catch (_) { /* optional */ } universeModal({ universe: u, endingTemplates: t, onDone: rerender }); };
  const wrap = h('div', { class: 'stack', style: 'gap:20px', 'data-character-library': '' });
  wrap.append(pageHead('Character Library', '캐릭터 라이브러리', '유니버스(출연진 묶음)와 캐릭터 프로필을 한 곳에서 관리합니다. 프로필·참조 이미지 저장은 유료 호출이 없고, Story Lab에서 유니버스와 출연 캐릭터를 고릅니다.', h('button', { class: 'btn', type: 'button', 'data-new-universe': '', onclick: () => openUniverse(null) }, '＋ 새 유니버스')));
  U.forEach((u) => {
    const chars = u.characters;
    wrap.append(h('section', { class: 'card stack', style: 'gap:12px', 'data-universe-card': u.id },
      h('div', { class: 'card-head' },
        h('div', null, h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, h('h2', { style: 'margin:0' }, u.name), chip(u.active === false ? '비활성' : '활성', u.active === false ? 'attention' : 'done'), chip(u.language === 'ko' ? '한국어 대사' : '영어 대사', ''), u.builtin ? chip('기본 제공', 'mock') : null), h('div', { class: 'small muted' }, u.description)),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openUniverse(u) }, '편집'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => call(() => api.put('/api/universes/' + u.id, { active: u.active === false }), u.active === false ? '활성으로 바꿨습니다' : '비활성으로 바꿨습니다') }, u.active === false ? '활성화' : '비활성화'),
          u.builtin ? null : h('button', { class: 'btn sm ghost danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: `${u.name} 유니버스를 삭제할까요?`, body: '캐릭터가 없고 어떤 프로젝트도 쓰지 않을 때만 삭제됩니다.', confirm: '삭제', tone: 'danger' })) call(() => api.del('/api/universes/' + u.id), '삭제했습니다'); } }, '삭제'))),
      h('div', { class: 'small' }, h('b', null, '스토리 스타일: '), u.storyStyle, h('br'), h('b', null, '시각 스타일: '), u.visualStyle),
      h('div', { class: 'cast-chars' }, chars.map((c) => {
        const f = full.find((x) => x.id === c.id) || c;
        return h('article', { class: 'card flat stack', style: 'gap:8px', 'data-library-character': c.id },
          h('div', { class: 'row', style: 'gap:10px;flex-wrap:nowrap' }, avatar(c), h('div', { style: 'min-width:0' }, h('b', null, c.name), h('div', { class: 'small muted' }, c.role || '역할 미입력'))),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, (f.personality || []).slice(0, 4).map((p) => chip(String(p), '')), c.hasApprovedReference ? chip('참조 이미지 승인됨', 'done') : chip('참조 이미지 필요', 'attention'),
            ),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
            h('button', { class: 'btn sm ghost', type: 'button', onclick: () => profileModal({ character: f, universes: U, characters: full, onDone: rerender }) }, '프로필 편집'),
            h('button', { class: 'btn sm ghost danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: `${c.name}을(를) 삭제할까요?`, body: '쓰는 에피소드가 없을 때만 삭제됩니다. 참조 이미지 파일은 서버에 남습니다.', confirm: '삭제', tone: 'danger' })) call(() => api.del('/api/characters/' + c.id), '삭제했습니다'); } }, '삭제')),
          voicePicker(f),
          voiceSettings(f),
          keepOpen(f.id, h('details', { class: 'small', open: !!(state.charOpen || {})[f.id] }, h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, '참조 이미지'), charCard(f))));
      }).concat([h('button', { type: 'button', class: 'cast-add', onclick: () => profileModal({ universeId: u.id, universes: U, characters: full, onDone: rerender }) }, '＋ 캐릭터 추가')]))));
  });
  return wrap;
}
