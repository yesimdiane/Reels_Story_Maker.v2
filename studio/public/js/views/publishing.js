import { h, chip, icon, copyText, toast, confirmDialog } from '../ui.js';
import { state, act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, issueList, lockedNotice } from './common.js';

function block(label, key, pub, draft, { rows = 3, mono = false } = {}) {
  const val = draft[key] !== undefined ? draft[key] : Array.isArray(pub[key]) ? pub[key].join(' ') : pub[key] || '';
  const ta = h('textarea', { rows, class: mono ? 'mono' : '', value: val, oninput: (e) => (draft[key] = e.target.value) });
  return h('div', { class: 'field' }, h('div', { class: 'row between' }, h('label', null, label), h('button', { class: 'btn sm ghost', onclick: () => copyText(draft[key] !== undefined ? draft[key] : val, label + ' 복사됨') }, icon('copy'), '복사')), ta);
}

export function publishing() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const pub = ep.publishing || {};
  const hasPack = !!pub.caption;
  const d = ep.derived.publishing;
  const draft = state.draft.publishing || (state.draft.publishing = {});
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Publishing', '게시 준비', '캡션, 해시태그, ManyChat DM 문구를 확인된 제품 정보와 승인된 대본만으로 만듭니다. 이 스튜디오는 인스타그램에 직접 게시하거나 ManyChat을 바꾸지 않습니다.', episodePicker()));
  wrap.append(pipelineBar(ep));
  if (!ep.approvals.final) wrap.append(lockedNotice('최종 영상을 승인해야 캡션을 승인할 수 있습니다.', 'render', '렌더 스튜디오로 이동'));

  const gen = (force) => act(async () => { delete state.draft.publishing; return api.post(`/api/episodes/${ep.id}/publishing/generate`, { force }); }, { ok: '캡션 초안을 만들었습니다' });
  if (!hasPack) {
    wrap.append(h('div', { class: 'card empty' }, h('h2', null, '아직 게시 문구가 없습니다'), h('p', null, '확인된 제품 기능과 CTA 키워드로 초안을 만듭니다. 만든 뒤 자유롭게 고칠 수 있습니다.'), h('button', { class: 'btn sage', onclick: () => gen(false) }, '캡션 초안 만들기')));
    return wrap;
  }

  const save = () => act(async () => { const r = await api.put(`/api/episodes/${ep.id}/publishing`, draft); delete state.draft.publishing; return r; }, { ok: '저장했습니다 (승인은 다시 필요합니다)' });
  const dirty = Object.keys(draft).length > 0;
  const form = h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '캡션 · DM'), h('div', { class: 'row' },
      h('button', { class: 'btn sm ghost', onclick: () => { if (confirm('직접 수정한 내용이 초안으로 덮어씌워집니다. 계속할까요?')) gen(true); } }, icon('refresh'), '초안 다시 만들기'),
      h('button', { class: 'btn sm', disabled: !dirty, onclick: save }, dirty ? '변경 저장' : '저장됨'))),
    block('후크', 'hook', pub, draft, { rows: 2 }),
    block('캡션 (첫 줄 [광고] 표기 필수)', 'caption', pub, draft, { rows: 12 }),
    block('제품 설명 (확인된 기능만)', 'productDescription', pub, draft, { rows: 4 }),
    block('CTA', 'cta', pub, draft, { rows: 2 }),
    block('해시태그', 'hashtags', pub, draft, { rows: 2 }),
    block('ManyChat DM 문구', 'dmMessage', pub, draft, { rows: 5 }),
    h('div', { class: 'field' }, h('div', { class: 'row between' }, h('label', null, '쿠팡 파트너스 링크'), pub.affiliateUrl ? h('button', { class: 'btn sm ghost', onclick: () => copyText(pub.affiliateUrl, '링크 복사됨') }, icon('copy'), '복사') : null),
      h('input', { type: 'url', placeholder: 'https://link.coupang.com/…', value: draft.affiliateUrl !== undefined ? draft.affiliateUrl : pub.affiliateUrl || '', oninput: (e) => (draft.affiliateUrl = e.target.value) }),
      h('div', { class: 'small muted' }, '쿠팡 파트너스 링크(link.coupang.com 또는 coupa.ng)만 허용됩니다. 링크는 DM 문구의 {링크} 자리에 직접 넣어 사용하세요.')),
    h('div', { class: 'field' }, h('label', null, '광고 표기 문구'), h('div', { class: 'card flat small' }, pub.disclosure || ep.publishing.disclosure)));

  const side = h('div', { class: 'stack', style: 'gap:14px' });
  if (dirty) side.append(h('div', { class: 'banner warn' }, icon('lock'), h('div', null, '저장하지 않은 변경이 있습니다. 먼저 저장하세요.')));
  const v = d.validation;
  side.append(h('div', { class: 'card' }, h('h3', null, '점검'), v ? h('div', { class: 'stack', style: 'gap:8px' }, v.ok ? chip('차단 항목 없음', 'done') : null, issueList(v.errors, 'err'), issueList(v.warnings, 'warn')) : h('p', { class: 'small muted' }, '저장 후 점검됩니다.')));
  const chk = d.checklist;
  side.append(h('div', { class: 'card' }, h('h3', null, '게시 체크리스트'),
    h('div', { class: 'stack', style: 'gap:8px' }, chk.items.map((i) => h('label', { class: 'check ' + (i.ok ? 'ok' : ''), style: 'display:flex;gap:8px;align-items:flex-start;font-size:14px' },
      i.auto ? h('span', { style: 'width:18px;color:var(--sage-deep)' }, i.ok ? '✓' : '○') : h('input', { type: 'checkbox', checked: i.ok, disabled: !!pub.publishedAt, style: 'margin-top:3px', onchange: (e) => act(() => api.put(`/api/episodes/${ep.id}/publishing/checklist`, { key: i.key, value: e.target.checked })) }),
      h('span', null, i.label, i.auto ? h('span', { class: 'muted small' }, ' · 자동') : h('span', { class: 'muted small' }, ' · 직접 확인'))))),
    h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'ManyChat 설정과 게시는 이 화면 밖에서 직접 합니다. 체크는 사용자가 확인했다는 기록일 뿐입니다.')));
  const approved = !!pub.approvedAt;
  side.append(h('div', { class: 'card' }, h('h3', null, '승인'),
    approved ? h('p', { class: 'small' }, chip('캡션 승인됨', 'done')) : h('p', { class: 'small muted' }, '승인 후 내용을 고치면 다시 승인해야 합니다.'),
    h('button', { class: 'btn sage', disabled: approved || dirty || !ep.approvals.final || (v && !v.ok), onclick: () => act(() => api.post(`/api/episodes/${ep.id}/publishing/approve`), { ok: '캡션·DM 문구를 승인했습니다' }) }, icon('check'), approved ? '승인 완료' : '캡션·DM 승인'),
    approved ? h('button', { class: 'btn ghost', style: 'margin-left:8px', 'data-publishing-revoke': ep.id, title: '승인만 취소합니다 (문구는 그대로 남습니다)', onclick: async () => {
      if (!(await confirmDialog({ title: '캡션·DM 승인을 취소할까요?', body: '문구는 지워지지 않습니다. 취소하면 다시 승인해야 게시 준비가 완료됩니다.', confirm: '승인 취소', tone: 'clay' }))) return;
      await act(() => api.post(`/api/episodes/${ep.id}/publishing/revoke`), { ok: '캡션·DM 승인을 취소했습니다' });
    } }, '승인 취소') : null));

  const urlIn = h('input', { type: 'url', placeholder: 'https://www.instagram.com/reel/…', value: pub.postUrl || '', disabled: !!pub.publishedAt });
  side.append(h('div', { class: 'card' }, h('h3', null, '게시 완료 기록'),
    pub.publishedAt ? h('p', { class: 'small' }, chip('게시됨', 'done'), ' ', h('a', { href: pub.postUrl, target: '_blank', rel: 'noopener' }, pub.postUrl)) : h('p', { class: 'small muted' }, '인스타그램에 직접 올린 뒤 게시물 주소를 기록합니다. 체크리스트가 모두 완료되어야 합니다.'),
    h('div', { class: 'row', style: 'flex-wrap:nowrap' }, urlIn, h('button', { class: 'btn', disabled: !chk.ready || !!pub.publishedAt, onclick: () => act(() => api.post(`/api/episodes/${ep.id}/publishing/published`, { postUrl: urlIn.value }), { ok: '게시 완료로 기록했습니다' }) }, '기록')),
    pub.publishedAt ? h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn ghost', 'data-publishing-clear': ep.id, title: '게시했다는 기록만 지웁니다 (인스타그램의 게시물은 건드리지 않습니다)', onclick: async () => {
      if (!(await confirmDialog({ title: '게시 완료 기록을 취소할까요?', body: '이 스튜디오의 기록만 지웁니다. 인스타그램에 올린 게시물은 그대로입니다.', confirm: '기록 취소', tone: 'clay' }))) return;
      await act(() => api.post(`/api/episodes/${ep.id}/publishing/clear-published`), { ok: '게시 완료 기록을 취소했습니다' });
    } }, '게시 기록 취소')) : null));
  wrap.append(h('div', { class: 'split wide-left' }, form, side));
  return wrap;
}
