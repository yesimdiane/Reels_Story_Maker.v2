// Settings → API 연결 → ManyChat. The token is write-only: the server returns only configured / last 4 / state.
import { h, chip, icon, toast, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { asyncBlock } from './common.js';

const STATE = { not_configured: ['미설정', 'attention'], untested: ['테스트 전', 'attention'], connected: ['연결됨', 'done'], auth_failed: ['인증 실패', 'err'], rate_limited: ['요청 제한', 'attention'], unavailable: ['응답 없음', 'attention'], error: ['오류', 'err'] };

export function manychatCard() {
  const rerender = () => import('../state.js').then(({ hooks }) => hooks.rerender());
  const call = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); rerender(); return r; } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return null; } };
  return asyncBlock(() => api.get('/api/manychat'), ({ connection: c }) => {
    const f = state.draft.mcToken || (state.draft.mcToken = { token: '' });
    const [label, kind] = STATE[c.state] || [c.state, ''];
    const unsupported = Object.entries(c.capabilities).filter(([, v]) => !v.supported);
    return h('div', { class: 'card stack', style: 'gap:12px' },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, 'ManyChat'), chip(label, kind)),
      h('p', { class: 'small muted', style: 'margin:0' }, '인스타그램 댓글 감지와 DM 발송은 ManyChat만 담당합니다. 이 스튜디오는 별도의 인스타그램 봇이나 권한을 만들지 않습니다.'),
      c.configured ? h('div', { class: 'small' }, `토큰: •••• ${c.last4} · 암호화 저장`, c.page ? ` · 페이지: ${c.page.name}${c.page.username ? ' (@' + c.page.username + ')' : ''}` : '', c.testedAt ? ' · 마지막 테스트 ' + c.testedAt.slice(0, 16).replace('T', ' ') : '') : null,
      c.message ? h('div', { class: 'banner warn' }, h('div', null, c.message)) : null,
      h('div', { class: 'field' }, h('label', null, c.configured ? 'API 토큰 교체' : 'API 토큰 (ManyChat → Settings → API)'), h('input', { type: 'password', autocomplete: 'off', placeholder: c.configured ? '새 토큰 붙여넣기' : '토큰 붙여넣기', oninput: (e) => (f.token = e.target.value) })),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
        h('button', { class: 'btn sage', onclick: async () => { const t = f.token; f.token = ''; await call(() => api.put('/api/manychat/token', { token: t }), '토큰을 저장했습니다 (연결 테스트를 눌러 확인하세요)'); } }, '토큰 저장'),
        h('button', { class: 'btn ghost', disabled: !c.configured, onclick: async () => { const r = await call(() => api.post('/api/manychat/test')); if (r) toast(r.state === 'connected' ? '연결 확인됨' : '연결 상태: ' + (STATE[r.state] || [r.state])[0], { error: r.state !== 'connected' }); } }, '연결 테스트'),
        h('button', { class: 'btn ghost danger', disabled: !c.configured, onclick: async () => { if (await confirmDialog({ title: 'ManyChat 연결을 해제할까요?', body: '스튜디오에서 토큰을 삭제합니다. 토큰 자체를 무효화하려면 ManyChat에서 새 토큰을 재발급하세요. 이미 ManyChat에 설정된 자동화는 그대로 동작합니다.', confirm: '해제', tone: 'danger' })) { const r = await call(() => api.del('/api/manychat/token'), '연결을 해제했습니다'); if (r && r.note) toast(r.note, { ms: 8000 }); } } }, '연결 해제'),
        h('a', { class: 'btn ghost', href: c.dashboardUrl, target: '_blank', rel: 'noopener' }, 'ManyChat 열기')),
      h('details', { class: 'fold' }, h('summary', null, '고급 · API로 할 수 없는 것'),
        h('ul', { class: 'small muted', style: 'margin:8px 0 0;padding-left:18px' }, unsupported.map(([k, v]) => h('li', null, v.note)), h('li', null, '그래서 캠페인 켜기/일시중지는 ManyChat에서 직접 하고, 이 스튜디오는 설정 안내와 검증 기록만 담당합니다.'))));
  });
}
