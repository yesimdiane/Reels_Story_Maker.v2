// Auto-DM Studio: one ManyChat comment-to-DM campaign RECORD per episode + guided manual setup.
// ManyChat's public API cannot create/attach/activate comment automations, so nothing here pretends to. "Active"
// is only reachable by recording evidence of a real end-to-end test.
import { h, chip, icon, copyText, toast, confirmDialog, modal } from '../ui.js';
import { state, act, requireEpisode, selectEpisode } from '../state.js';
import { api } from '../api.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, asyncBlock } from './common.js';

const KIND = { draft: '', setup_required: 'attention', ready: 'attention', active: 'done', failed: 'err' };
const STEPS = [['draft', '초안'], ['setup_required', 'ManyChat 설정'], ['ready', '준비됨'], ['active', '활성 (검증)']];

function statusStrip(c) {
  const idx = c ? STEPS.findIndex((s) => s[0] === c.status) : -1;
  return h('div', { class: 'dm-steps', role: 'list' }, STEPS.map(([k, l], i) => h('div', { role: 'listitem', class: 'dm-step' + (i <= idx ? ' on' : '') + (c && c.status === k ? ' cur' : '') }, h('span', { class: 'ko' }, l))));
}

/** Auto DM now lives in Settings → AI · 연동 → 자동 DM: the same per-episode campaign editor, with an episode picker (no episode-specific page header). */
export function autodmPanel() {
  const ep = requireEpisode();
  const wrap = h('div', { class: 'stack', style: 'gap:16px', 'data-autodm-panel': '' });
  const live = (state.summary.episodes || []).filter((e) => !e.archived);
  wrap.append(h('div', { class: 'row between', style: 'gap:12px;flex-wrap:wrap' },
    h('div', null, h('h2', { style: 'margin:0' }, '자동 DM (ManyChat)'), h('p', { class: 'small muted', style: 'margin:4px 0 0' }, '인스타그램 댓글 → DM은 ManyChat이 처리합니다. 에피소드별 캠페인 설정을 정리하고 ManyChat 설정을 안내합니다. ManyChat 연결(토큰)은 "API 연결"에서 설정합니다.')),
    live.length > 1 ? h('select', { 'aria-label': '에피소드 선택', 'data-autodm-episode': '', style: 'width:auto;padding:7px 12px;border-radius:999px', onchange: (e) => selectEpisode(e.target.value) }, live.map((e) => h('option', { value: e.id, selected: ep && e.id === ep.id }, (e.displayId || e.id) + ' · ' + (e.title || '').slice(0, 24)))) : null));
  if (!ep) { wrap.append(noEpisode()); return wrap; }
  wrap.append(asyncBlock(() => api.get(`/api/episodes/${ep.id}/dm`), (data) => editor(ep, data)));
  return wrap;
}

export function autodm() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Auto-DM Studio', '자동 DM 스튜디오', '인스타그램 댓글 → DM은 ManyChat이 처리합니다. 여기서는 에피소드별 캠페인 설정을 정리하고, ManyChat 설정을 안내하며, 실제 동작을 확인한 기록만 남깁니다.', episodePicker()));
  wrap.append(pipelineBar(ep));
  wrap.append(asyncBlock(() => api.get(`/api/episodes/${ep.id}/dm`), (data) => editor(ep, data)));
  return wrap;
}

function editor(ep, data) {
  const c = data.campaign;
  const base = c || data.suggestion;
  const f = state.draft.dm || (state.draft.dm = { instagramAccount: base.instagramAccount || '', postUrl: base.postUrl || '', keywords: (base.keywords || []).join(', '), dmMessage: base.dmMessage || '', affiliateUrl: base.affiliateUrl || '', buttonLabel: base.buttonLabel || '' });
  const rerender = () => import('../state.js').then(({ hooks }) => hooks.rerender());
  const call = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); delete state.draft.dm; rerender(); return r; } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return null; } };
  const status = c ? c.status : 'none';
  const root = h('div', { class: 'stack', style: 'gap:16px' });

  const conn = data.connection;
  root.append(h('div', { class: 'card stack', style: 'gap:8px' },
    h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, '캠페인 상태'), chip(c ? c.statusLabel : '미설정', c ? KIND[c.status] : '')),
    statusStrip(c),
    status === 'active' && c.evidence ? h('p', { class: 'small', style: 'margin:0' }, `검증 기록: ${c.evidence.verifiedAt.slice(0, 16).replace('T', ' ')} · ${c.evidence.note} `, h('span', { class: 'muted' }, '(운영자가 실제 테스트로 확인한 기록 · API 자동 확인 아님)')) : null,
    status === 'failed' && c.failure ? h('div', { class: 'banner err' }, h('div', null, '실패 사유: ' + c.failure.reason)) : null,
    status === 'ready' ? h('p', { class: 'small muted', style: 'margin:0' }, '아직 검증되지 않았습니다. 실제 게시물에 테스트 댓글을 달아 DM이 오는지 확인한 뒤 "검증 기록"을 남기세요.') : null,
    !data.finalApproved ? h('p', { class: 'small muted', style: 'margin:0' }, '최종 영상이 승인되면 ManyChat 설정 단계로 넘길 수 있습니다. 그 전에는 초안만 저장됩니다.') : null,
    conn.state !== 'connected' ? h('p', { class: 'small muted', style: 'margin:0' }, `ManyChat 연결: ${conn.configured ? '테스트가 필요하거나 실패했습니다' : '미설정'} (설정 → API 연결). 연결이 없어도 캠페인 초안과 수동 설정 안내는 사용할 수 있습니다.`) : h('p', { class: 'small muted', style: 'margin:0' }, `ManyChat 연결됨: ${(conn.page || {}).name || ''}`)));

  const input = (label, key, opts = {}) => h('div', { class: 'field' }, h('label', null, label), opts.rows ? h('textarea', { rows: opts.rows, value: f[key], oninput: (e) => (f[key] = e.target.value) }) : h('input', { type: 'text', value: f[key], placeholder: opts.ph || '', oninput: (e) => (f[key] = e.target.value) }), opts.hint ? h('div', { class: 'small muted' }, opts.hint) : null);
  const readOnlyLink = base.affiliateFrom === 'publishing' || base.affiliateFrom === 'product';
  const form = h('div', { class: 'card stack', style: 'gap:12px' },
    h('h2', { style: 'margin:0' }, '캠페인 설정'),
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '에피소드'), h('input', { type: 'text', value: ep.displayId || ep.id, disabled: true })),
      input('인스타그램 계정', 'instagramAccount', { ph: '@계정이름' })),
    input('게시물 주소 (게시 후 연결해도 됩니다)', 'postUrl', { ph: 'https://www.instagram.com/reel/…' }),
    input('트리거 키워드 (쉼표로 구분, 최대 5개)', 'keywords', { hint: '댓글에 이 단어가 포함되면 ManyChat이 DM을 보냅니다. 같은 계정의 다른 캠페인 키워드와 겹치면 저장되지 않습니다.' }),
    input('DM 문구 ([광고] 표기 포함)', 'dmMessage', { rows: 5 }),
    h('div', { class: 'field' }, h('label', null, '제휴 링크 (제품 스튜디오/게시 준비에서 가져옴)'), h('input', { type: 'text', value: f.affiliateUrl, oninput: (e) => (f.affiliateUrl = e.target.value) }), h('div', { class: 'small muted' }, readOnlyLink ? (base.affiliateFrom === 'publishing' ? '게시 준비의 제휴 링크를 사용 중입니다.' : '제품 스튜디오의 제휴 링크를 사용 중입니다.') + ' 바꾸면 이 캠페인에만 적용됩니다.' : '쿠팡 파트너스 링크(link.coupang.com / coupa.ng)만 허용됩니다.')),
    input('버튼 문구 (선택)', 'buttonLabel'),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
      h('button', { class: 'btn sage', onclick: async () => {
        const live = c && ['ready', 'active'].includes(c.status);
        let confirmLive = false;
        if (live) { confirmLive = await confirmDialog({ title: '운영 중인 캠페인을 변경할까요?', body: '변경하면 상태가 "ManyChat 설정 필요"로 돌아가고 다시 검증해야 합니다. ManyChat에서도 직접 수정해야 합니다. 이 화면은 ManyChat을 바꾸지 않습니다.', confirm: '변경하고 다시 검증', tone: 'sage' }); if (!confirmLive) return; }
        await call(() => api.put(`/api/episodes/${ep.id}/dm`, Object.assign({}, f, { confirmLive })), '초안을 저장했습니다');
      } }, icon('check'), '초안 저장'),
      h('button', { class: 'btn ghost', onclick: async () => { const r = await api.post('/api/manychat/test').catch((e) => { toast(e.message, { error: true, recovery: e.recovery }); return null; }); if (r) { toast(r.state === 'connected' ? 'ManyChat 연결 확인됨' : '연결 상태: ' + r.state, { error: r.state !== 'connected' }); rerender(); } } }, '연결 테스트')));
  root.append(form);

  if (c && c.issues && c.issues.length && c.status !== 'active') root.append(h('div', { class: 'banner warn' }, h('div', null, h('b', null, '설정 전에 고칠 것'), h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, c.issues.map((i) => h('li', null, i.message))))));

  // Guided workflow (always manual in ManyChat)
  const actions = h('div', { class: 'card stack', style: 'gap:10px' }, h('h2', { style: 'margin:0' }, '다음 단계'));
  if (!c) actions.append(h('p', { class: 'muted', style: 'margin:0' }, '먼저 초안을 저장하세요.'));
  if (c && ['draft', 'failed'].includes(c.status)) actions.append(h('button', { class: 'btn', disabled: !data.finalApproved, onclick: () => call(() => api.post(`/api/episodes/${ep.id}/dm/prepare`), 'ManyChat 설정 단계로 넘겼습니다') }, 'ManyChat 설정 단계로 넘기기'));
  if (c && c.status === 'setup_required') {
    actions.append(h('button', { class: 'btn', onclick: () => guide(ep, data) }, '설정 안내 보기 · 설정 복사'));
    actions.append(h('button', { class: 'btn sage', onclick: async () => { if (await confirmDialog({ title: 'ManyChat에서 설정을 마쳤나요?', body: '이 화면은 ManyChat에 아무것도 만들지 않습니다. 직접 설정을 마쳤다는 확인만 기록하며, 아직 "검증됨"이 아닙니다.', confirm: '설정 완료로 기록' })) call(() => api.post(`/api/episodes/${ep.id}/dm/configured`, { confirm: true }), '준비됨으로 기록했습니다'); } }, 'ManyChat 설정 완료 기록'));
  }
  if (c && c.status === 'ready') actions.append(h('button', { class: 'btn sage', onclick: () => verifyDialog(ep, call) }, icon('check'), '검증 기록 남기기 (테스트 완료)'));
  if (c && ['ready', 'active', 'failed'].includes(c.status)) actions.append(h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: '다시 설정 단계로 돌릴까요?', body: '운영 중일 수 있는 캠페인입니다. ManyChat에서 직접 멈추거나 수정한 뒤 확인하세요. 이 화면은 ManyChat을 멈추지 못합니다.', confirm: '확인했고 돌리기' })) call(() => api.post(`/api/episodes/${ep.id}/dm/reopen`, { confirm: true })); } }, '설정 단계로 되돌리기'));
  if (c && ['setup_required', 'ready', 'active'].includes(c.status)) actions.append(h('button', { class: 'btn ghost danger', onclick: () => failDialog(ep, call) }, '실패로 기록'));
  actions.append(h('p', { class: 'small muted', style: 'margin:0' }, 'ManyChat API는 댓글 자동화를 만들거나 켜고 끄는 기능을 제공하지 않아, 켜기/일시중지는 ManyChat에서 직접 합니다. 안전 수칙: 사용자가 직접 댓글을 남긴 경우에만 DM이 나가야 하며, 대량·일방적 DM은 하지 않습니다.'));
  if (c) actions.append(h('details', { class: 'fold' }, h('summary', null, '고급 · 이력 / 보관'), h('div', { class: 'stack', style: 'gap:6px;margin-top:8px' },
    (c.history || []).slice().reverse().map((x) => h('div', { class: 'small muted' }, x.at.slice(0, 16).replace('T', ' ') + ' · ' + x.event + (x.reason ? ' · ' + x.reason : ''))),
    h('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmDialog({ title: '이 캠페인 기록을 보관할까요?', body: 'ManyChat의 실제 자동화는 그대로 남습니다. 필요하면 ManyChat에서 직접 끄세요.', confirm: '보관', tone: 'danger' })) call(() => api.del(`/api/episodes/${ep.id}/dm`), '보관했습니다'); } }, '캠페인 기록 보관'))));
  root.append(actions);
  return root;
}

async function guide(ep, data) {
  let x;
  try { x = await api.get(`/api/episodes/${ep.id}/dm/export`); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return; }
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, 'ManyChat 설정 안내'),
    h('ol', { style: 'margin:0;padding-left:20px' }, x.steps.map((s) => h('li', { style: 'white-space:pre-wrap;margin-bottom:6px' }, s))),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
      h('a', { class: 'btn', href: x.dashboardUrl, target: '_blank', rel: 'noopener' }, 'ManyChat 대시보드 열기'),
      h('button', { class: 'btn ghost', onclick: () => copyText(JSON.stringify(x.config, null, 2), '설정(JSON)을 복사했습니다') }, icon('copy'), '설정 복사 (JSON)'),
      h('button', { class: 'btn ghost', onclick: () => { const b = new Blob([JSON.stringify(x.config, null, 2)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(b), download: `${(ep.displayId || ep.id)}-dm-campaign.json` }); document.body.append(a); a.click(); a.remove(); } }, '내보내기')),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '닫기'))), { wide: true });
}

function verifyDialog(ep, call) {
  const f = { note: '' };
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, '검증 기록'),
    h('p', { class: 'muted', style: 'margin:0' }, '실제 게시물에 테스트 계정으로 키워드 댓글을 달고 DM이 도착한 것을 확인했나요? 확인한 내용을 적으면 "활성 (검증됨)"으로 기록됩니다. API가 자동으로 확인한 것이 아니라 당신의 확인 기록입니다.'),
    h('div', { class: 'field' }, h('label', null, '확인한 내용 (10자 이상)'), h('textarea', { rows: 3, placeholder: '예: 테스트 계정으로 “우산” 댓글 → 1분 내 DM 수신, 링크 정상', oninput: (e) => (f.note = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn sage', onclick: async () => { const r = await call(() => api.post(`/api/episodes/${ep.id}/dm/verify`, { confirm: true, note: f.note }), '검증됨으로 기록했습니다'); if (r) close(); } }, '활성으로 기록'))));
}

function failDialog(ep, call) {
  const f = { reason: '' };
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, '실패로 기록'),
    h('div', { class: 'field' }, h('label', null, '사유'), h('textarea', { rows: 3, oninput: (e) => (f.reason = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn danger', onclick: async () => { const r = await call(() => api.post(`/api/episodes/${ep.id}/dm/fail`, { reason: f.reason }), '실패로 기록했습니다'); if (r) close(); } }, '실패 기록'))));
}
