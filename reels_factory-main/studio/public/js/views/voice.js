import { h, chip, icon, confirmDialog, fmtSec, fmtUsd, toast } from '../ui.js';
import { state, act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { timingTable } from './script-timing.js';
import { voicePicker } from './voice-connections.js';
import { voiceScenes } from './voice-scenes.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, issueList, charAvatar, lockedNotice, videoTabs } from './common.js';

export function voice() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const chars = state.summary.characters;
  const est = ep.derived.voice;
  const live = est.mode === 'live';
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Voice Studio', '보이스 스튜디오', '캐릭터마다 HeyGen 목소리를 따로 설정합니다. 영어 대사만 음성으로 만들고, 만든 오디오는 캐릭터별로 저장해 다시 쓰므로 같은 대사를 두 번 결제하지 않습니다.', episodePicker()));
  wrap.append(videoTabs('voice'));
  wrap.append(pipelineBar(ep));
  wrap.append(h('div', { class: 'banner ' + (live ? 'live' : 'mock') }, chip(live ? 'LIVE' : 'MOCK', live ? 'live' : 'mock'), h('div', null, h('b', null, live ? '실제 HeyGen 음성 (유료)' : '목업 음성 — 요금 없음'), live ? '음성 확인이 끝난 캐릭터만 생성할 수 있고, 생성 전 글자 수를 확인해야 합니다.' : '확인용 톤 오디오가 만들어집니다. 실제 음성은 서버 환경변수 RF_STUDIO_VOICE_MODE=live 와 HEYGEN_API_KEY가 필요합니다.')));
  if (!ep.derived.scriptApproved) wrap.append(lockedNotice('대본이 승인되어야 음성을 만들 수 있습니다.', 'script', '대본으로 이동'));

  const scenesCard = h('div', { class: 'card stack', style: 'gap:10px' }, h('div', { class: 'card-head' }, h('h2', null, '장면별 음성'), h('span', { class: 'small muted' }, '무음 애니메이션 승인 후 대사 음성을 만들고 승인합니다 · 대사가 없는 장면은 이 단계를 건너뜁니다')), voiceScenes(ep));
  wrap.append(scenesCard);
  const cards = h('div', { class: 'grid two' }, chars.map((c) => charVoiceCard(c)));
  wrap.append(cards);

  const run = h('button', { class: 'btn lg sage', disabled: !est.canRun || est.cachedLines === est.lines.length, onclick: async () => {
    const ok = await confirmDialog({ title: live ? '유료 음성 생성을 진행할까요?' : '목업 음성을 만들까요?', body: h('div', { class: 'stack small' }, h('div', null, `${est.lines.length - est.cachedLines}개 대사 · ${est.billableChars}자 (캐시된 ${est.cachedLines}개는 다시 만들지 않음)`), live ? h('div', null, est.usdKnown ? '예상 ' + fmtUsd(est.usd) : '가격 추정치가 입력되지 않았습니다 (설정에서 입력)') : h('div', { class: 'muted' }, '요금이 없습니다.'), h('div', { class: 'muted' }, '실패한 대사는 자동으로 다시 시도하지 않습니다.')), confirm: '생성', tone: live ? 'clay' : 'sage' });
    if (ok) await act(() => api.post(`/api/episodes/${ep.id}/voice/run`, { confirmChars: est.billableChars }), { ok: '음성을 생성했습니다' });
  } }, icon('play'), est.cachedLines === est.lines.length ? '모든 음성이 준비됨' : '음성 생성');

  // the all-lines overview + bulk generate button comes first, above the per-scene cards
  wrap.insertBefore(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, '대사별 음성'), h('div', { class: 'row' }, chip(`${est.cachedLines}/${est.lines.length} 준비됨`, est.cachedLines === est.lines.length ? 'done' : 'attention'), run)),
    issueList(est.blockers, 'err'),
    h('table', { class: 'tbl', style: 'margin-top:8px' }, h('thead', null, h('tr', null, ['화자', 'English', '한국어 자막', '길이', '음성'].map((x) => h('th', null, x)))),
      h('tbody', null, ep.lines.map((l) => { const e = est.lines.find((x) => x.lineId === l.id); const c = chars.find((x) => x.id === l.speaker); return h('tr', null,
        h('td', null, h('div', { class: 'row', style: 'gap:8px;flex-wrap:nowrap' }, charAvatar(c), c.name)),
        h('td', { style: 'max-width:260px' }, l.en), h('td', { style: 'max-width:240px', class: 'muted' }, l.ko),
        h('td', null, e && e.durationSec ? fmtSec(e.durationSec) : '—'),
        h('td', null, e && e.cached ? h('audio', { controls: true, src: e.url, preload: 'none', style: 'height:34px;max-width:230px' }) : chip('없음', 'attention'))); })))), scenesCard);

  { const tt = timingTable(ep); if (tt) wrap.append(tt); }
  const tl = ep.derived.render.plan.timeline;
  if (tl.lines.length) wrap.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '오디오 싱크'), h('span', { class: 'small muted' }, `총 ${tl.total}초 · 대사 사이에 인위적인 무음을 넣지 않고, 대사가 길면 장면이 자동으로 늘어납니다.`)), timelineBar(tl), tl.warnings.length ? h('div', { style: 'margin-top:10px' }, issueList(tl.warnings, 'warn')) : null,
    h('p', { class: 'small muted', style: 'margin:10px 0 0' }, '승인된 음성은 립싱크 스튜디오(무음 애니메이션과 결합)와 비디오 스튜디오(최종 믹스에 정확히 한 번)에서 사용됩니다.')));
  return wrap;
}

export function timelineBar(tl) {
  const total = tl.total || 1;
  const parts = tl.scenes.map((s) => {
    const el = h('div', { class: 'tl-scene' + (s.extended ? ' ext' : ''), style: `flex:${s.duration} 1 0`, title: `${s.id} ${s.title || ''} ${s.start}–${s.end}초` }, h('span', null, s.id + (s.title ? ' ' + s.title.slice(0, 6) : '')));
    tl.lines.filter((l) => l.sceneId === s.id).forEach((l) => el.append(h('i', { class: 'tl-line ' + l.speaker, style: `left:${((l.start - s.start) / s.duration) * 100}%;width:${(l.duration / s.duration) * 100}%`, title: l.speaker + ': ' + l.en })));
    return el;
  });
  if (tl.cta.duration) parts.push(h('div', { class: 'tl-scene cta', style: `flex:${tl.cta.duration} 1 0` }, h('span', null, 'CTA')));
  return h('div', null, h('div', { class: 'timeline' }, parts), h('div', { class: 'tl-legend' }, h('span', null, h('i', { style: 'background:#c98f6c' }), 'Diane'), h('span', null, h('i', { style: 'background:var(--sage-deep)' }), 'Jack'), h('span', null, h('i', { style: 'background:#ead4bf;border:1px solid #d4c8b1' }), '자동으로 늘어난 장면'), h('span', null, h('i', { style: 'background:var(--espresso)' }), 'CTA 엔드 카드')));
}

function charVoiceCard(c) {
  const v = c.voice;
  const f = { voiceId: v.heygenVoiceId, identityId: v.heygenIdentityId, speed: v.speed };
  const status = { verified: ['확인됨', 'done'], unverified: ['미확인 — "음성 확인" 필요', 'attention'], 'identity-only': ['Identity ID만 있음 (Voice ID 필요)', 'err'], unset: ['미설정', 'err'] }[c.voiceStatus];
  return h('div', { class: 'card' },
    h('div', { class: 'row between', style: 'margin-bottom:12px' }, h('div', { class: 'row' }, charAvatar(c, true), h('div', null, h('h3', null, c.name + ' · ' + c.nameKo), h('div', { class: 'small muted' }, c.role + ' · English'))), chip(status[0], status[1])),
    h('div', { class: 'stack', style: 'gap:10px' },
      voicePicker(c),
      h('div', { class: 'field' }, h('label', null, 'HeyGen Identity ID (참고용)'), h('input', { type: 'text', class: 'mono', value: f.identityId, oninput: (e) => (f.identityId = e.target.value) }), h('div', { class: 'small muted' }, 'Identity ID는 Voice ID가 아닙니다. 음성 생성에는 쓰이지 않으며, 같은 값으로 간주하지 않습니다.')),
      h('div', { class: 'field' }, h('label', null, '말 속도 ' + f.speed + '×'), h('input', { type: 'range', min: 0.7, max: 1.3, step: 0.05, value: f.speed, oninput: (e) => { f.speed = Number(e.target.value); e.target.previousSibling.textContent = '말 속도 ' + f.speed + '×'; } })),
      v.verified ? h('div', { class: 'small muted' }, `HeyGen 목록에서 확인: ${v.verifiedName || ''} ${v.verifiedLanguage ? '(' + v.verifiedLanguage + ')' : ''}`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => act(async () => { await api.put('/api/characters/' + c.id, { voice: { heygenVoiceId: f.voiceId, heygenIdentityId: f.identityId, speed: f.speed } }); return null; }, { ok: c.name + ' 음성 설정을 저장했습니다' }) }, '저장'))));
}
