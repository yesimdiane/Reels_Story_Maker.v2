// Character profile editor (create / edit) shared by Story Lab and the Character Library. No paid calls: it only saves the profile.
import { h, toast, modal } from '../ui.js';
import { api } from '../api.js';

const lines = (v) => (Array.isArray(v) ? v : []).join('\n');
const parse = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

export function profileModal({ character = null, universeId = 'jackdiane', universes = [], characters = [], onDone = () => {} } = {}) {
  const c = character || {};
  const f = {
    name: c.name || '', role: c.role || '', universeId: c.universeId || universeId,
    personality: lines(c.personality), look: c.look || '', speakingStyle: c.speakingStyle || '',
    catchphrases: lines(c.catchphrases && c.catchphrases.length ? c.catchphrases : (c.catchphrase ? [c.catchphrase] : [])),
    relationships: (c.relationships || []).map((r) => `${r.characterId}: ${r.note}`).join('\n'),
    behaviorRules: lines(c.behaviorRules), negativePrompts: lines(c.negativePrompts),
  };
  const ta = (label, key, rows = 2, hint = '') => h('div', { class: 'field' }, h('label', null, label), h('textarea', { rows, value: f[key], oninput: (e) => (f[key] = e.target.value) }), hint ? h('div', { class: 'small muted' }, hint) : null);
  const others = characters.filter((x) => x.id !== c.id && (x.universeId || 'jackdiane') === f.universeId);
  return modal((close) => h('div', { class: 'stack', style: 'gap:10px', 'data-profile-modal': '' },
    h('h2', { style: 'margin:0' }, character ? `${c.name} 프로필 편집` : '새 캐릭터'),
    h('p', { class: 'small muted', style: 'margin:0' }, '프로필은 유료 호출 없이 저장됩니다. 외모는 승인된 참조 이미지가 기준이며, 모르는 시각 정보를 지어내지 마세요.'),
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '이름'), h('input', { type: 'text', value: f.name, 'data-f': 'name', oninput: (e) => (f.name = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '역할'), h('input', { type: 'text', value: f.role, placeholder: '예: 책임감 있는 장남', oninput: (e) => (f.role = e.target.value) }))),
    h('div', { class: 'field' }, h('label', null, '유니버스'), h('select', { 'data-f': 'universe', onchange: (e) => (f.universeId = e.target.value) }, universes.map((u) => h('option', { value: u.id, selected: u.id === f.universeId }, u.name)))),
    ta('성격 (한 줄에 하나)', 'personality', 3), ta('외모 설명', 'look', 3, '비워 두면 "승인된 참조 이미지로만 정의"로 전달됩니다.'), ta('말투', 'speakingStyle', 2),
    ta('말버릇 / 시그니처 대사 (한 줄에 하나)', 'catchphrases', 2),
    ta('관계 (한 줄에 하나: 캐릭터ID: 설명)', 'relationships', 3, others.length ? '사용 가능한 ID: ' + others.map((x) => x.id).join(', ') : ''),
    ta('행동 규칙 (한 줄에 하나)', 'behaviorRules', 2), ta('금지 행동 · 네거티브 프롬프트 (한 줄에 하나)', 'negativePrompts', 2),
    h('div', { class: 'row end', style: 'gap:8px' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'),
      h('button', { class: 'btn sage', type: 'button', 'data-profile-save': '', onclick: async () => {
        const body = { name: f.name, role: f.role, universeId: f.universeId, personality: parse(f.personality), look: f.look, speakingStyle: f.speakingStyle, catchphrases: parse(f.catchphrases),
          relationships: parse(f.relationships).map((l) => { const i = l.indexOf(':'); return i < 0 ? null : { characterId: l.slice(0, i).trim(), note: l.slice(i + 1).trim() }; }).filter(Boolean), behaviorRules: parse(f.behaviorRules), negativePrompts: parse(f.negativePrompts) };
        try { if (character) await api.put('/api/characters/' + c.id, body); else await api.post('/api/characters', body); toast('프로필을 저장했습니다'); close(); await onDone(); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
      } }, '프로필 저장'))), { wide: true });
}

export function universeModal({ universe = null, endingTemplates = [], onDone = () => {} } = {}) {
  const u = universe || {};
  const f = { name: u.name || '', description: u.description || '', storyStyle: u.storyStyle || '', language: u.language || 'en', visualStyle: u.visualStyle || '', endingTemplateId: u.endingTemplateId || '', active: u.active !== false };
  const field = (label, key, rows) => h('div', { class: 'field' }, h('label', null, label), rows ? h('textarea', { rows, value: f[key], oninput: (e) => (f[key] = e.target.value) }) : h('input', { type: 'text', value: f[key], oninput: (e) => (f[key] = e.target.value) }));
  return modal((close) => h('div', { class: 'stack', style: 'gap:10px', 'data-universe-modal': '' },
    h('h2', { style: 'margin:0' }, universe ? `${u.name} 편집` : '새 유니버스'),
    field('이름', 'name'), field('설명', 'description', 2), field('기본 스토리텔링 스타일', 'storyStyle', 2), field('시각 스타일', 'visualStyle', 2),
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '기본 언어'), h('select', { onchange: (e) => (f.language = e.target.value) }, [['en', '영어'], ['ko', '한국어']].map(([v, l]) => h('option', { value: v, selected: f.language === v }, l)))),
      h('div', { class: 'field' }, h('label', null, '고정 엔딩 템플릿'), h('select', { onchange: (e) => (f.endingTemplateId = e.target.value) }, [h('option', { value: '' }, '(시리즈 기본)')].concat(endingTemplates.map((t) => h('option', { value: t.id, selected: f.endingTemplateId === t.id }, t.name)))))),
    h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: f.active, onchange: (e) => (f.active = e.target.checked) }), '활성 (Story Lab에서 선택 가능)'),
    h('div', { class: 'row end', style: 'gap:8px' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'),
      h('button', { class: 'btn sage', type: 'button', 'data-universe-save': '', onclick: async () => {
        try { if (universe) await api.put('/api/universes/' + u.id, f); else await api.post('/api/universes', f); toast('유니버스를 저장했습니다'); close(); await onDone(); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
      } }, '유니버스 저장'))));
}
