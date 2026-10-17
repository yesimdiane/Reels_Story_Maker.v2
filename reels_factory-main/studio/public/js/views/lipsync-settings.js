// Settings → lip-sync models: the registry (read-only seed from the official muapi-cli + models you add), the default, verification, and price.
// Nothing here calls the provider; "플레이그라운드에서 확인함" is the operator's statement, and live lip sync stays blocked until it is made.
import { h, chip, confirmDialog, fmtUsd } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

const VER = { unverified: ['미확인 — 실제 호출 차단', 'attention'], 'user-entered': ['직접 확인함', 'mock'], verified: ['실제 호출로 검증됨', 'done'] };
const SPK = { multi: '다인 지원(선언)', single: '1인', unknown: '미확인 → 1인만' };

export function lipsyncModelsCard(summary) {
  const L = (summary.lipsync) || { models: [], defaultModelId: '' };
  const f = { id: 'lipsync-', label: '', endpoint: '', videoField: 'video_url', audioField: 'audio_url', speakers: 'unknown', maxDurationSec: '', costEstimateUsd: '', confirmed: false };
  const rows = L.models.map((m) => {
    const [vl, vk] = VER[m.verification] || [m.verification, ''];
    return h('tr', { 'data-lipsync-model-row': m.id }, h('td', null, h('b', null, m.label), m.custom ? chip('직접 추가', 'mock') : null, h('div', { class: 'small muted mono' }, m.endpoint)),
      h('td', null, chip(vl, vk)), h('td', null, SPK[m.speakers] || SPK.unknown), h('td', null, h('label', { class: 'field', style: 'min-width:120px' },
        h('span', { class: 'small muted' }, '장면당 예상 USD'),
        h('input', { type: 'number', min: '0', step: '0.001', 'aria-label': m.label + ' 장면당 가격 USD', 'data-lipsync-price': m.id, value: m.costEstimateUsd == null ? '' : String(m.costEstimateUsd),
          onchange: (e) => { const v = e.target.value; act(() => api.put('/api/lipsync/models/' + encodeURIComponent(m.id) + '/price', { costEstimateUsd: v === '' ? null : Number(v) }), { ok: '립싱크 모델별 예상 가격을 저장했습니다' }); } }))),
      h('td', null, h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' },
        m.verification === 'unverified' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-lipsync-confirm': m.id, onclick: async () => { if (await confirmDialog({ title: '플레이그라운드에서 확인했나요?', body: `${m.endpoint} 엔드포인트와 요청 필드(${m.videoField}, ${m.audioField})를 MuAPI 플레이그라운드에서 직접 확인했다는 표시입니다. 이 앱은 요청을 보내지 않으며, 실제 립싱크는 별도의 정확한 금액 승인이 필요합니다.` })) act(() => api.post('/api/lipsync/models/' + encodeURIComponent(m.id) + '/confirm'), { ok: '확인됨으로 표시했습니다' }); } }, '플레이그라운드에서 확인함') : null,
        m.custom ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => act(() => api.del('/api/lipsync/models/' + encodeURIComponent(m.id)), { ok: '모델을 지웠습니다' }) }, '삭제') : null)));
  });
  const field = (label, key, attrs) => h('label', { class: 'field' }, h('span', { class: 'small' }, label), h('input', Object.assign({ type: 'text', value: f[key], oninput: (e) => (f[key] = e.target.value) }, attrs || {})));
  return h('div', { class: 'card stack', style: 'gap:12px', 'data-lipsync-settings': '' },
    h('div', { class: 'card-head' }, h('h2', null, '립싱크 모델'), h('span', { class: 'small muted' }, '입력 = 승인된 무음 애니메이션 + 승인된 음성')),
    h('div', { class: 'small muted' }, '목록은 공식 muapi-cli의 엔드포인트 이름입니다(소스만 읽었고 실제 호출로 확인하지 않음). 말하는 인물 수·최대 길이·가격은 목록에 없어서 직접 입력해야 하며, 다인 립싱크는 가정하지 않습니다.'),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '기본 립싱크 모델'), h('select', { 'data-lipsync-default': '', onchange: (e) => act(() => api.put('/api/lipsync/default', { modelId: e.target.value }), { ok: '립싱크 기본 모델을 저장했습니다' }) }, L.models.map((m) => h('option', { value: m.id, selected: m.id === L.defaultModelId }, m.label)))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl-stack' }, h('thead', null, h('tr', null, ['모델', '검증', '화자', '가격', ''].map((x) => h('th', null, x)))), h('tbody', null, rows))),
    h('details', { class: 'scene-section', 'data-lipsync-add': '' }, h('summary', null, h('span', { class: 'section-title' }, '립싱크 모델 직접 추가'), h('span', { class: 'small muted' }, '플레이그라운드에서 확인한 값만')),
      h('div', { class: 'section-body stack', style: 'gap:8px' }, h('div', { class: 'grid two', style: 'gap:8px' },
        field('모델 ID (lipsync-…)', 'id', { 'data-lipsync-id': '' }), field('표시 이름', 'label'), field('엔드포인트', 'endpoint', { 'data-lipsync-endpoint': '' }),
        field('영상 필드', 'videoField'), field('오디오 필드', 'audioField'), field('최대 길이(초, 선택)', 'maxDurationSec'), field('장면당 예상 비용 USD (직접 입력)', 'costEstimateUsd'),
        h('label', { class: 'field' }, h('span', { class: 'small' }, '말하는 인물 수'), h('select', { onchange: (e) => (f.speakers = e.target.value) }, h('option', { value: 'unknown' }, '모름 (1인만 허용)'), h('option', { value: 'single' }, '1인'), h('option', { value: 'multi' }, '다인 지원(문서로 확인함)')))),
        h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', onchange: (e) => (f.confirmed = e.target.checked) }), '플레이그라운드에서 엔드포인트·필드를 확인했습니다 (체크하지 않으면 미확인으로 등록)'),
        h('button', { class: 'btn sm', type: 'button', 'data-lipsync-save': '', onclick: () => act(() => api.post('/api/lipsync/models', Object.assign({}, f)), { ok: '립싱크 모델을 등록했습니다' }) }, '모델 추가'))));
}
