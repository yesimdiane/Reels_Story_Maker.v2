import { characters } from './characters.js';
import { lipsyncModelsCard } from './lipsync-settings.js';
import { h, chip, icon, confirmDialog, toast, fmtUsd } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { pageHead, charAvatar } from './common.js';
import { aiIntegrations, promptManager, usagePanel } from './ai-settings.js';
import { presetManager } from './script-prompt.js';
import { endingManager } from './ending-settings.js';
import { manychatCard } from './manychat-settings.js';
import { refGallery } from './ref-gallery.js';
import { voiceConnections } from './voice-connections.js';
import { autodmPanel } from './autodm.js';

function kv(k, v) { return h('div', { class: 'row between', style: 'padding:6px 0;border-bottom:1px solid var(--line)' }, h('span', { class: 'muted' }, k), h('span', null, v)); }

function parts() {
  const s = state.summary;
  const p = s.providers;
  const st = s.settings;
  const box = () => h('div', { class: 'stack', style: 'gap:20px' });
  // one container per Settings sub-tab; nothing was dropped, the former single "general" page is just split across them
  const sec = { general: box(), connections: box(), costs: box() };

  sec.general.append(h('div', { class: 'card stack', style: 'gap:10px', 'data-output-language': '' },
    h('h2', null, 'AI 분석 결과 표시 언어'),
    h('p', { class: 'small muted' }, '제품 분석의 요약은 선택한 언어로 표시합니다. 이미지·영상 생성용 원본 프롬프트와 제품 구조 설명은 정확성을 위해 영어로 유지합니다.'),
    h('select', { 'aria-label': '결과 표시 언어', onchange: (e) => {
      state.outputLanguage = e.target.value;
      try { localStorage.setItem('rf.outputLanguage', e.target.value); } catch (_) {}
      toast('표시 언어를 저장했습니다. 다음 제품 분석부터 적용됩니다.');
    } }, [
      ['ko', '한국어'], ['en', 'English']
    ].map(([value, label]) => h('option', { value, selected: state.outputLanguage === value }, label)))));
  // Providers (status overview)
  sec.general.append(h('div', { class: 'grid two' },
    h('div', { class: 'card' }, h('h2', null, '영상 생성 (Muapi)'),
      kv('모드', p.video.mode === 'live' ? chip('LIVE (유료)', 'live') : chip('MOCK', 'mock')),
      kv('API 키', p.video.keyConfigured ? chip('서버에 설정됨', 'done') : chip('없음', 'attention')),
      kv('실제 모드 요청', p.video.liveWithoutKey ? chip('요청됨 · 키 없음 → MOCK 동작', 'attention') : p.video.liveRequested ? '켜짐' : '꺼짐'),
      kv('Base URL', h('span', { class: 'mono small' }, p.video.baseUrl)),
      h('p', { class: 'small muted', style: 'margin:10px 0 0' }, p.how)),
    h('div', { class: 'card' }, h('h2', null, '음성 (HeyGen)'),
      kv('모드', p.voice.mode === 'live' ? chip('LIVE (유료)', 'live') : chip('MOCK', 'mock')),
      kv('API 키', p.voice.keyConfigured ? chip('서버에 설정됨', 'done') : chip('없음', 'attention')),
      kv('실제 모드 요청', p.voice.liveWithoutKey ? chip('요청됨 · 키 없음 → MOCK 동작', 'attention') : p.voice.liveRequested ? '켜짐' : '꺼짐'),
      kv('1회 최대 글자 수', String(p.limits.maxCharsPerJob || '—')),
      kv('월 글자 한도', String(p.limits.monthlyCharLimit || '—')),
      kv('립싱크', chip('미제공', 'attention')),
      kv('Gemini (프롬프트 AI)', p.gemini.configured ? chip('키 설정됨 · ' + p.gemini.model, 'done') : chip('키 없음 — 템플릿만', 'attention')),
      h('p', { class: 'small muted', style: 'margin:10px 0 0' }, p.lipSync.note))));

  // Animation and B-roll video models can be configured independently.
  // Changing it never triggers a paid generation or overwrites per-scene choices.
  const defaultVideoModel = { id: st.defaultModelId || '' };
  const defaultBrollModel = { id: st.brollModelId || st.defaultModelId || '' };
  sec.connections.append(h('div', { class: 'card stack', style: 'gap:12px', 'data-default-video-model': '' },
    h('div', { class: 'card-head' }, h('h2', null, '영상 생성 기본 AI 모델'),
      h('button', { class: 'btn sm', type: 'button', 'data-default-model-save': '', onclick: () => act(() => api.put('/api/settings', { defaultModelId: defaultVideoModel.id }), { ok: '영상 기본 모델을 저장했습니다. 기존 장면별 모델 설정은 유지됩니다.' }) }, '기본 모델 저장')),
    h('label', { class: 'field' }, h('span', { class: 'small' }, 'Animation Studio 기본 모델'),
      h('select', { 'data-default-model-select': '', value: defaultVideoModel.id, onchange: (e) => (defaultVideoModel.id = e.target.value) },
        (s.models || []).map((m) => h('option', { value: m.id, selected: m.id === defaultVideoModel.id }, (m.label || m.id) + ' · ' + m.id + (m.verification === 'unverified' ? ' (미검증)' : ''))))),
    h('div', { class: 'small muted' }, '여기서 선택한 모델은 새 영상 생성의 기본값입니다. 장면별로 지정한 모델은 그대로 유지됩니다. 모델을 변경해도 생성이나 과금은 시작되지 않습니다.'),
    h('div', { class: 'small muted' }, '원하는 모델이 없으면 아래 Muapi 영상 모델의 "모델 직접 추가"에서 플레이그라운드에 표시된 모델 ID와 엔드포인트를 등록하고, 비용 설정도 입력하세요.')));

  sec.connections.append(h('div', { class: 'card stack', style: 'gap:12px', 'data-broll-video-model': '' },
    h('div', { class: 'card-head' }, h('h2', null, 'B-roll 클립 전용 AI 모델'),
      h('button', { class: 'btn sm', type: 'button', 'data-broll-model-save': '', onclick: () => act(() => api.put('/api/settings', { brollModelId: defaultBrollModel.id }), { ok: 'B-roll 전용 모델을 저장했습니다. 일반 씬 모델은 유지됩니다.' }) }, 'B-roll 모델 저장')),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '승인된 B-roll 이미지 → 영상 클립'),
      h('select', { 'data-broll-model-select': '', onchange: (e) => (defaultBrollModel.id = e.target.value) },
        (s.models || []).map((m) => h('option', { value: m.id, selected: m.id === defaultBrollModel.id }, (m.label || m.id) + ' · ' + m.id + (m.verification === 'unverified' ? ' (미검증)' : ''))))),
    h('div', { class: 'small muted' }, 'B-roll 전용 모델 선택은 일반 씬 애니메이션에 영향을 주지 않습니다. 저장해도 유료 영상은 생성되지 않습니다. 실제 생성 전 비용 확인과 별도 승인이 필요합니다.')));

  // Muapi connection check + models (explicit buttons only: nothing here runs on page load)
  const chk = h('div', { class: 'small', 'data-muapi-result': '' }, h('span', { class: 'muted' }, '"연결 확인"은 무료 조회(잔액·모델 목록)만 합니다. 영상 생성은 시작되지 않습니다.'));
  const VER = { unverified: ['미확인 — 실제 생성 차단', 'attention'], 'user-entered': ['직접 확인함 (실제 호출 전)', 'mock'], verified: ['실제 생성으로 검증됨', 'done'] };
  const cm = { id: '', label: '', endpoint: '', durations: '5', resolutions: '', neg: false };
  const catalogBox = h('div', { class: 'stack', style: 'gap:8px', 'data-muapi-catalog-import': '' });
  const showCatalog = (catalog) => {
    catalogBox.replaceChildren();
    if (!catalog.length) return;
    const choice = { id: catalog[0].id };
    const selector = h('select', { 'data-muapi-catalog-select': '', onchange: (e) => { choice.id = e.target.value; } },
      catalog.map((m) => h('option', { value: m.id }, (m.name || m.id) + ' · ' + m.id)));
    catalogBox.append(
      h('div', { class: 'small muted' }, 'MuAPI 계정에서 조회한 모델입니다. API 목록만으로 영상 지원 여부, 엔드포인트, 길이, 가격을 보장할 수 없습니다.'),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, selector,
        h('button', { class: 'btn sm ghost', type: 'button', 'data-muapi-catalog-use': '', onclick: () => {
          const m = catalog.find((x) => x.id === choice.id);
          if (!m) return;
          cm.id = m.id; cm.label = m.name || m.id; cm.endpoint = m.id;
          const card = catalogBox.closest('[data-muapi-card]');
          card.querySelector('[data-model-id]').value = cm.id;
          card.querySelector('[data-model-endpoint]').value = cm.endpoint;
          card.querySelector('[data-model-label]').value = cm.label;
          card.querySelector('[data-model-add]').open = true;
          toast('모델 ID를 입력했습니다. MuAPI 플레이그라운드에서 엔드포인트·길이·지원 기능을 확인한 뒤 직접 추가하세요.');
        } }, '등록 양식에 가져오기')));
  };
  const verLabel = (m) => chip((VER[m.verification] || [m.verification, ''])[0], (VER[m.verification] || [0, ''])[1]);
  const modelRows = (s.models || []).map((m) => h('tr', null, h('td', null, h('b', null, m.label || m.id), m.custom ? chip('직접 추가', 'mock') : null, h('div', { class: 'small muted mono' }, m.endpoint)),
    h('td', null, (m.durations || []).join(' / ') + '초'), h('td', null, (m.resolutions || []).join(' / ') || '미선언'), h('td', null, m.endImageField ? '선언됨' : '미선언'), h('td', null, m.supportsNegativePrompt ? '지원' : '미선언'), h('td', null, verLabel(m), m.verification === 'unverified' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-model-confirm': m.id, title: 'MuAPI 플레이그라운드에서 엔드포인트와 요청 파라미터를 직접 확인한 경우에만 누르세요. 요금은 발생하지 않습니다.', onclick: async () => { if (await confirmDialog({ title: '플레이그라운드에서 확인했나요?', body: m.endpoint + ' 엔드포인트와 요청 파라미터를 MuAPI 플레이그라운드에서 직접 확인했다는 표시입니다. 이 앱은 생성 요청을 보내지 않습니다. 이후 실제 생성은 별도의 비용 승인이 필요합니다.' })) act(() => api.post('/api/models/' + encodeURIComponent(m.id) + '/confirm'), { ok: '확인됨으로 표시했습니다' }); } }, '플레이그라운드에서 확인함') : null),
    h('td', null, m.custom ? h('button', { class: 'btn sm danger', type: 'button', 'data-model-remove': m.id, onclick: () => act(() => api.del('/api/models/' + encodeURIComponent(m.id)), { ok: '모델을 지웠습니다' }) }, '삭제') : null)));
  sec.connections.append(h('div', { class: 'card stack', style: 'gap:12px', 'data-muapi-card': '' },
    h('div', { class: 'card-head' }, h('h2', null, 'Muapi 연결 · 영상 모델'),
      h('button', { class: 'btn sm', type: 'button', 'data-muapi-check': '', onclick: async () => {
        chk.textContent = '확인하는 중…';
        try {
          const r = await api.post('/api/muapi/check');
          showCatalog(r.catalog || []);
          chk.replaceChildren(r.mode === 'mock' ? h('div', null, chip('MOCK', 'mock'), ' ', r.note) : h('div', { class: 'stack', style: 'gap:4px' }, h('div', null, r.connected ? chip('연결됨', 'done') : chip('연결 안 됨', 'err'), r.balance != null ? ` 잔액 ${r.balance} 크레딧` : ' 잔액: 제공되지 않음'), h('div', { class: 'small muted' }, `Muapi 모델 목록 ${r.catalog.length}개 조회됨 (참고용 — 아래 표의 엔드포인트·길이·해상도는 직접 확인한 값만 쓰입니다)`), ...r.errors.map((e) => h('div', { class: 'issue err' }, `${e.where}: ${e.message}`))));
        } catch (e) { chk.replaceChildren(h('div', { class: 'issue err' }, e.message)); }
      } }, '연결 확인 (무료)')),
    chk,
    h('div', { class: 'grid two', style: 'gap:6px', 'data-model-status': '' }, (() => {
      const dm = (s.models || []).find((m) => m.id === defaultVideoModel.id);
      const live = state.summary && state.summary.providers && state.summary.providers.video && state.summary.providers.video.mode === 'live';
      const okVer = dm && ['user-entered', 'verified'].includes(dm.verification);
      const row = (k, v, tone) => h('div', { class: 'row small', style: 'gap:6px' }, h('b', null, k), chip(v, tone));
      return [
        row('API 연결', live ? '실제 모드 (키는 서버에만 있음 · "연결 확인"으로 무료 조회)' : 'MOCK — 연결하지 않음', live ? '' : 'mock'),
        row('모델 등록', dm ? '등록됨 · ' + dm.endpoint : '기본 모델 없음', dm ? 'done' : 'attention'),
        row('엔드포인트 확인', dm ? (VER[dm.verification] || [dm.verification])[0] : '—', okVer ? 'done' : 'attention'),
        row('생성 준비', live ? (okVer ? '비용 승인 후 생성 가능' : '차단 — 엔드포인트 확인 필요') : 'MOCK 생성만 가능 (요금 없음)', live && !okVer ? 'err' : ''),
      ];
    })()),
    h('div', { class: 'small muted' }, '잔액 조회가 성공해도 모델 엔드포인트가 동작한다는 뜻은 아닙니다. 연결 확인은 무료 조회만 하며 영상 생성은 시작하지 않습니다.'),
    h('div', { class: 'row small', style: 'gap:8px;flex-wrap:wrap;align-items:center', 'data-muapi-tts': '' }, h('b', null, 'MuAPI TTS (ElevenLabs)'),
      chip(st.muapiTtsConfirmed ? '엔드포인트 확인함' : '미확인 — 실제 호출 차단', st.muapiTtsConfirmed ? 'done' : 'attention'),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-muapi-tts-confirm': '', onclick: async () => { if (st.muapiTtsConfirmed) return act(() => api.post('/api/muapi/tts/confirm', { confirmed: false }), { ok: '확인을 취소했습니다' }); if (await confirmDialog({ title: 'MuAPI TTS를 플레이그라운드에서 확인했나요?', body: 'elevenlabs-tts-turbo-2-5 엔드포인트와 요청 파라미터(prompt, voice_id, speed)를 MuAPI 플레이그라운드에서 직접 확인했다는 표시입니다. 이 앱은 음성 요청을 보내지 않습니다. 실제 음성 생성은 글자 수 확인 후에만 시작됩니다.' })) act(() => api.post('/api/muapi/tts/confirm', {}), { ok: '확인됨으로 표시했습니다' }); } }, st.muapiTtsConfirmed ? '확인 취소' : '플레이그라운드에서 확인함')),
    catalogBox,
    h('div', { class: 'small muted' }, 'API 키는 서버 환경변수 MUAPI_API_KEY에만 두며 브라우저로 전달되지 않습니다. 실제(유료) 호출은 RF_MUAPI_MODE=live일 때만 가능합니다.'),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['모델', '길이', '해상도', '끝 프레임', '네거티브', '검증', ''].map((x) => h('th', null, x)))), h('tbody', null, modelRows))),
    h('details', { class: 'scene-section', 'data-model-add': '' }, h('summary', null, h('span', { class: 'section-title' }, '모델 직접 추가'), h('span', { class: 'small muted' }, 'Muapi 플레이그라운드에서 확인한 값만 입력')),
      h('div', { class: 'section-body stack', style: 'gap:8px' },
        h('div', { class: 'grid two', style: 'gap:8px' },
          h('label', { class: 'field' }, h('span', { class: 'small' }, '모델 ID (영문 소문자)'), h('input', { type: 'text', 'data-model-id': '', placeholder: 'veo3-fast', oninput: (e) => (cm.id = e.target.value) })),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '표시 이름'), h('input', { type: 'text', 'data-model-label': '', oninput: (e) => (cm.label = e.target.value) })),
          h('label', { class: 'field', style: 'grid-column:1/-1' }, h('span', { class: 'small' }, '공식 muapi-cli 모델 목록에서 고르기 (엔드포인트·이미지 전달 방식만 채워 줍니다 — 길이/비용은 직접 입력)'),
            (() => {
              const sel = h('select', { 'data-cli-model': '', onfocus: async () => { if (sel.dataset.loaded) return; sel.dataset.loaded = '1'; try { const r = await api.get('/api/muapi/cli-models'); sel.append(...r.models.map((m) => h('option', { value: JSON.stringify(m) }, `${m.alias} → ${m.endpoint}`))); } catch (e) { toast(e.message, { error: true }); } },
                onchange: (e) => { if (!e.target.value) return; const m = JSON.parse(e.target.value); const card = e.target.closest('[data-muapi-card]'); cm.id = m.alias.toLowerCase().replace(/[^a-z0-9._-]/g, '-'); cm.label = m.alias; cm.endpoint = m.endpoint; cm.imageAsList = m.imageAsList; cm.imageField = m.imageField;
                  card.querySelector('[data-model-id]').value = cm.id; card.querySelector('[data-model-label]').value = cm.label; card.querySelector('[data-model-endpoint]').value = cm.endpoint; card.querySelector('[data-model-imagefield]').value = m.imageAsList ? 'list' : 'string'; toast('값을 채웠습니다. 길이·해상도를 플레이그라운드에서 확인해 입력하세요.'); } }, h('option', { value: '' }, '— 선택 —'));
              return sel;
            })()),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '시작 이미지 전달 방식'), h('select', { 'data-model-imagefield': '', onchange: (e) => { cm.imageAsList = e.target.value === 'list'; cm.imageField = cm.imageAsList ? 'images_list' : 'image_url'; } }, h('option', { value: 'string' }, 'image_url (문자열)'), h('option', { value: 'list' }, 'images_list (배열)'))),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '엔드포인트 (플레이그라운드의 경로)'), h('input', { type: 'text', 'data-model-endpoint': '', placeholder: 'seedance-pro-i2v-fast', oninput: (e) => (cm.endpoint = e.target.value) })),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '지원 클립 길이(초, 쉼표)'), h('input', { type: 'text', value: cm.durations, oninput: (e) => (cm.durations = e.target.value) })),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '해상도 (선택, 쉼표 — 문서에 있을 때만)'), h('input', { type: 'text', oninput: (e) => (cm.resolutions = e.target.value) })),
          h('label', { class: 'row small', style: 'gap:6px;align-items:center' }, h('input', { type: 'checkbox', checked: false, onchange: (e) => (cm.neg = e.target.checked) }), '네거티브 프롬프트 지원'),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '요청 필드 이름 (프롬프트 / 이미지 / 길이 / 비율 / 네거티브 — 모델마다 다를 수 있음)'), h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' }, [['promptField', 'prompt'], ['imageField', 'image_url'], ['durationField', 'duration'], ['aspectField', 'aspect_ratio'], ['negativeField', 'negative_prompt']].map(([k, d]) => h('input', { type: 'text', 'data-model-field': k, placeholder: d, style: 'width:120px', oninput: (e) => (cm[k] = e.target.value) })))),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '고정 파라미터 JSON (선택, 예: {"mode":"std"})'), h('input', { type: 'text', 'data-model-extra': '', oninput: (e) => (cm.extraParams = e.target.value) })),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '음성 끄기 파라미터 JSON (선택 — 모델이 소리 생성을 끄는 값, 예: {"generate_audio":false})'), h('input', { type: 'text', 'data-model-silent': '', oninput: (e) => (cm.silentParams = e.target.value) })),
          h('label', { class: 'field' }, h('span', { class: 'small' }, '예상 비용 / 클립 (USD, 선택 — 직접 입력)'), h('input', { type: 'number', min: 0, step: 0.01, 'data-model-cost': '', oninput: (e) => (cm.costEstimateUsd = e.target.value) })),
          h('label', { class: 'row small', style: 'gap:6px;align-items:center' }, h('input', { type: 'checkbox', 'data-model-confirmed': '', onchange: (e) => (cm.confirmed = e.target.checked) }), '플레이그라운드에서 엔드포인트·파라미터를 확인했습니다 (체크하지 않으면 미확인으로 등록되어 실제 생성이 차단됩니다)')),
        h('button', { class: 'btn sm', type: 'button', 'data-model-save': '', onclick: () => act(() => api.post('/api/models', { id: cm.id, label: cm.label, endpoint: cm.endpoint, durations: cm.durations.split(',').map((x) => Number(x.trim())).filter(Boolean), resolutions: cm.resolutions.split(',').map((x) => x.trim()).filter(Boolean), supportsNegativePrompt: cm.neg, confirmed: !!cm.confirmed, extraParams: cm.extraParams || undefined, silentParams: cm.silentParams || undefined, costEstimateUsd: cm.costEstimateUsd || undefined, promptField: cm.promptField, imageField: cm.imageField, imageAsList: !!cm.imageAsList, durationField: cm.durationField, aspectField: cm.aspectField, negativeField: cm.negativeField }), { ok: '모델을 등록했습니다. Animation Studio에서 선택할 수 있습니다. 첫 생성 전 엔드포인트와 비용을 확인하세요.' }) }, '모델 추가')))));

  sec.connections.append(lipsyncModelsCard(state.summary));

  // Spend + prices: responsive cards with server-backed resolution/duration estimates.
  const f = { limit: st.reelSpendLimitUsd == null ? '' : st.reelSpendLimitUsd, voice: st.voiceUsdPer1kChars == null ? '' : st.voiceUsdPer1kChars, prices: {}, resolutionPrices: {} };
  const published = {
    'grok-imagine-image-to-video': ['480p: $0.025/초 · 720p: $0.05/초', '6~30초 지원 · 5초 미지원'],
    'seedance-pro-i2v': ['$0.18/회 공개 단가', '해상도·길이별 실제 청구액 미확인'],
    'seedance-pro-i2v-fast': ['480p 5초 $0.10 / 10초 $0.20', '720p 5초 $0.15 / 10초 $0.30 · 1080p 5초 $0.30 / 10초 $0.60'],
    'kling-v2.1-master-i2v': ['$0.30/회 공개 단가', '10초 및 크레딧 환산 비용 확인 필요'],
    'seedance-2.5-image-to-video': ['해상도별 가격 미확인', 'Intl 모델 요금을 대신 사용하지 마세요'],
    'runway-image-to-video': ['$0.15/회 공개 단가', '해상도별 실제 청구액 확인 필요'],
  };
  const cards = (s.models || []).map((m) => {
    const cur = ((st.modelEstimates || {})[m.id] || {}).usdByDuration || {};
    const ds = m.durations || [];
    const ref = published[m.endpoint] || published[m.id] || ['공식 단가 미확인', 'MuAPI 계정에서 가격을 확인하세요'];
    f.prices[m.id] = Object.fromEntries(ds.map((d) => [String(d), cur[String(d)] === undefined ? '' : cur[String(d)]]));
    const savedMatrix = ((st.modelEstimates || {})[m.id] || {}).usdByResolution || {};
    f.resolutionPrices[m.id] = Object.fromEntries((m.resolutions || []).map((res) => [res,
      Object.fromEntries(ds.map((d) => [String(d), (savedMatrix[res] || {})[String(d)] ?? '']))]));
    return h('div', { class: 'card stack', style: 'gap:12px;min-width:0', 'data-model-price-card': m.id },
      h('div', { class: 'row between', style: 'gap:8px;align-items:flex-start;flex-wrap:wrap' },
        h('div', { style: 'min-width:0;overflow-wrap:anywhere' },
          h('b', null, m.label || m.id),
          h('div', { class: 'small muted mono', style: 'overflow-wrap:anywhere' }, m.endpoint)),
        chip(m.verification === 'verified' ? '생성 검증됨' : m.verification === 'user-entered' ? '사용자 확인' : '미검증', m.verification === 'verified' ? 'done' : 'attention')),
      h('div', { class: 'small muted' }, '공개 참고 가격: ' + ref.join(' · ')),
      h('div', { class: 'small muted' }, (m.resolutions || []).length ? '해상도와 길이별로 실제 비용을 입력하세요. 비어 있는 조합은 유료 생성이 차단됩니다.' : '길이별 예상 비용을 입력하세요.'),
      ...(m.resolutions || []).map((res) => h('div', { class: 'stack', style: 'gap:8px' },
        h('b', { class: 'small' }, res),
        h('div', { class: 'grid two', style: 'gap:10px' },
          ...ds.map((d) => h('label', { class: 'field', style: 'min-width:0' },
            h('span', { class: 'small' }, d + '초 · USD'),
            h('input', { type: 'number', min: 0, step: 0.001, inputmode: 'decimal',
              'aria-label': (m.label || m.id) + ' ' + res + ' ' + d + '초 예상 비용',
              placeholder: '미확인', value: f.resolutionPrices[m.id][res][String(d)],
              style: 'width:100%;min-width:0;max-width:100%',
              oninput: (e) => (f.resolutionPrices[m.id][res][String(d)] = e.target.value) })))))),
      ...((m.resolutions || []).length ? [] : [h('div', { class: 'grid two', style: 'gap:10px' }, ds.length
        ? ds.map((d) => h('label', { class: 'field', style: 'min-width:0' },
          h('span', { class: 'small' }, d + '초 · USD/클립'),
          h('input', { type: 'number', min: 0, step: 0.001, inputmode: 'decimal',
            'aria-label': (m.label || m.id) + ' ' + d + '초 예상 비용',
            placeholder: '미확인', value: f.prices[m.id][String(d)],
            style: 'width:100%;min-width:0;max-width:100%',
            oninput: (e) => (f.prices[m.id][String(d)] = e.target.value) })))
        : [h('span', { class: 'small muted' }, '지원 길이가 등록되지 않았습니다.')])]));
  });
  sec.costs.append(h('div', { class: 'stack', style: 'gap:14px', 'data-pricing-settings': '' },
    h('div', { class: 'card stack', style: 'gap:12px' },
      h('div', { class: 'card-head', style: 'gap:10px;flex-wrap:wrap' },
        h('h2', null, '비용 한도와 가격 추정'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => act(async () => {
          await api.put('/api/settings', {
            reelSpendLimitUsd: f.limit, voiceUsdPer1kChars: f.voice,
            modelEstimates: Object.fromEntries(Object.entries(f.prices).map(([k, v]) => [k, { usdByDuration: v, usdByResolution: f.resolutionPrices[k] || {} }]))
          }); return null;
        }, { ok: '비용 설정을 저장했습니다' }) }, '가격 저장')),
      h('div', { class: 'banner warn' }, icon('lock'),
        h('div', null, '공개 가격은 참고용이며 자동 입력하지 않습니다. 해상도·길이별 요금이 다를 수 있습니다. 미확인 비용은 비워 두세요. 실제 생성은 별도 승인과 비용 확인이 필요합니다.')),
      h('div', { class: 'grid two', style: 'gap:12px' },
        h('label', { class: 'field', style: 'min-width:0' },
          h('span', null, '릴스 1편당 지출 한도 (USD)'),
          h('input', { type: 'number', min: 0, step: 0.5, style: 'width:100%;min-width:0', value: f.limit,
            placeholder: '기본값 $' + st.effectiveReelSpendLimitUsd, oninput: (e) => (f.limit = e.target.value) }),
          h('span', { class: 'small muted' }, '현재 적용: ' + fmtUsd(st.effectiveReelSpendLimitUsd))),
        h('label', { class: 'field', style: 'min-width:0' },
          h('span', null, 'HeyGen 1,000자당 가격 (USD)'),
          h('input', { type: 'number', min: 0, step: 0.01, style: 'width:100%;min-width:0',
            value: f.voice, placeholder: '미확인', oninput: (e) => (f.voice = e.target.value) })))),
    h('h3', null, '영상 모델별 예상 비용'),
    ...cards));
  
  // Render prefs
  const r = Object.assign({}, st.render);
  sec.general.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '렌더링'), h('button', { class: 'btn sm', onclick: () => act(async () => { await api.put('/api/settings', { render: { font: r.font, fontSize: Number(r.fontSize), burnDisclosure: !!r.burnDisclosure, previewWidth: Number(r.previewWidth) } }); return null; }, { ok: '렌더 설정을 저장했습니다' }) }, '저장')),
    h('div', { class: 'grid three' },
      h('div', { class: 'field' }, h('label', null, '자막 글꼴 이름'), h('input', { type: 'text', value: r.font || '', placeholder: '기본: NanumSquareRound', oninput: (e) => (r.font = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '자막 크기'), h('input', { type: 'number', min: 30, max: 120, value: r.fontSize, oninput: (e) => (r.fontSize = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '미리보기 폭(px)'), h('input', { type: 'number', min: 270, max: 1080, value: r.previewWidth, oninput: (e) => (r.previewWidth = e.target.value) }))),
    h('label', { style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: !!r.burnDisclosure, onchange: (e) => (r.burnDisclosure = e.target.checked) }), '영상에 광고 표기를 직접 넣기 (기본은 캡션 첫 줄에 표기)')));

  // Characters
  const chars = h('div', { class: 'stack', style: 'gap:20px' });
  chars.append(h('div', { class: 'card-head' }, h('h2', { style: 'margin:0' }, '캐릭터 라이브러리'), h('button', { class: 'btn sm ghost', onclick: async () => {
    const ok = await confirmDialog({ title: '데모용 임시 참조 이미지를 만들까요?', body: '실제 캐릭터 그림이 아닌 단색 자리표시 이미지입니다. 목업 모드에서 흐름을 확인하는 용도이며, 실제 모드에서는 사용할 수 없습니다. 이미 승인된 참조가 있으면 건드리지 않습니다.' });
    if (ok) await act(async () => { const r2 = await api.post('/api/demo/references'); toast(r2.made ? `${r2.made}개 만들었습니다` : '만들 것이 없습니다'); return null; });
  } }, '데모 참조 만들기')));
  chars.append(h('div', { class: 'small muted' }, '승인된 참조 이미지가 캐릭터의 기준입니다. 생성할 때 승인된 참조만 시작 프레임으로 사용됩니다. 스타일: ' + (s.style.summary || s.style.name || '손그림 2D 한국 웹툰/애니메이션 · 뮤트 베이지 톤')));
  chars.append(h('div', { class: 'grid two' }, s.characters.map(charCard)));
  return { general: sec.general, connections: sec.connections, costs: sec.costs, characters: chars };
}

// Three top-level groups, each with a compact secondary nav (one line; scrolls sideways on phones instead of wrapping).
// The leaf keys are the old tab keys (plus 'costs' and 'autodm'), so every old #/settings/<tab> deep link still resolves.
export const GROUPS = [
  ['general', '일반 · 비용', 'General & Cost', [['general', '일반'], ['costs', '모델 비용 · 지출 한도'], ['usage', '사용량 · 한도']]],
  ['ai', 'AI · 연동', 'AI & Integrations', [['ai', 'AI 제공자 · 작업별 배정'], ['connections', 'API 연결'], ['prompts', '프롬프트 관리'], ['autodm', '자동 DM']]],
  ['media', '캐릭터 · 미디어', 'Characters & Media', [['characters', '캐릭터 라이브러리'], ['voices', '음성 연결 · 배정'], ['endings', '엔딩 템플릿']]],
];
const LEAVES = GROUPS.flatMap((g) => g[3].map((t) => t[0]));
/** Old key 'scriptprompts' (the Script Studio presets) is now the second tool inside Prompt Management. */
export const isSettingsTab = (k) => LEAVES.includes(k) || k === 'scriptprompts';
const groupOf = (tab) => GROUPS.find((g) => g[3].some((t) => t[0] === tab)) || GROUPS[0];
const goTab = (tab) => { state.settingsTab = tab; try { history.replaceState(null, '', '#/settings/' + tab); } catch (_) { /* ignore */ } import('../state.js').then(({ hooks }) => hooks.rerender()); };

/** Prompt Management keeps TWO distinct tools with separate data: shared AI prompts (promptManager) and Script Studio presets (presetManager). */
function promptManagement() {
  const tab = state.promptTab === 'presets' ? 'presets' : 'shared';
  const box = h('div', { class: 'stack', style: 'gap:14px', 'data-prompt-management': '' });
  box.append(h('div', { class: 'seg prompt-tabs', 'data-no-en': '', role: 'tablist', 'aria-label': '프롬프트 관리 도구', style: 'align-self:flex-start;flex-wrap:nowrap' },
    [['shared', '공용 AI 프롬프트', '스토리 랩 · 대본 · 이미지/스토리보드 등 공용 생성 지침'], ['presets', '대본 프리셋', '대본 스튜디오 전용 프롬프트 템플릿']].map(([k, l, tip]) => h('button', { type: 'button', role: 'tab', title: tip, 'data-prompt-tab': k, 'aria-selected': tab === k ? 'true' : 'false', 'aria-pressed': tab === k ? 'true' : 'false', onclick: () => { state.promptTab = k; import('../state.js').then(({ hooks }) => hooks.rerender()); } }, l))));
  box.append(h('div', { class: 'small muted' }, tab === 'shared' ? '스토리 랩 · 대본 · 이미지/스토리보드 등 공용 생성 지침입니다 (대본 스튜디오 프리셋과는 별도 데이터).' : '대본 스튜디오에서 고르는 프롬프트 템플릿입니다 (공용 AI 프롬프트와는 별도 데이터).'));
  box.append(h('div', { 'data-prompt-pane': tab }, tab === 'shared' ? promptManager() : presetManager()));
  return box;
}

export function settings() {
  const wrap = h('div', { class: 'stack', style: 'gap:16px' });
  if (state.settingsTab === 'scriptprompts') { state.settingsTab = 'prompts'; state.promptTab = 'presets'; }
  const tab = LEAVES.includes(state.settingsTab) ? state.settingsTab : 'general';
  const group = groupOf(tab);
  wrap.append(pageHead('Settings', '설정', 'API 키는 서버의 암호화 저장소에만 저장되며 이 화면에 다시 표시되지 않습니다. 키·모델·프롬프트·한도는 코드나 .env를 고치지 않고 여기서 바꿉니다.'));
  wrap.append(h('div', { class: 'set-groups', 'data-no-en': '', role: 'tablist', 'aria-label': '설정 그룹', 'data-settings-groups': '' }, GROUPS.map((g) => h('button', { type: 'button', role: 'tab', 'data-settings-group': g[0], title: g[2], 'aria-selected': g === group ? 'true' : 'false', onclick: () => goTab(g === group ? tab : (state.settingsLast && state.settingsLast[g[0]]) || g[3][0][0]) }, g[1]))));
  wrap.append(h('div', { class: 'sub-nav', 'data-no-en': '', role: 'tablist', 'aria-label': group[1], 'data-settings-sub': group[0] }, group[3].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'data-settings-tab': k, 'aria-selected': tab === k ? 'true' : 'false', onclick: () => goTab(k) }, l))));
  state.settingsLast = Object.assign(state.settingsLast || {}, { [group[0]]: tab });
  const p = tab === 'general' || tab === 'connections' || tab === 'costs' || tab === 'characters' ? parts() : null;
  if (tab === 'ai') wrap.append(aiIntegrations());
  else if (tab === 'connections') { wrap.append(p.connections); wrap.append(manychatCard()); }
  else if (tab === 'costs') wrap.append(p.costs);
  else if (tab === 'usage') wrap.append(usagePanel());
  else if (tab === 'prompts') wrap.append(promptManagement());
  else if (tab === 'autodm') wrap.append(autodmPanel());
  else if (tab === 'voices') wrap.append(voiceConnections());
  else if (tab === 'endings') wrap.append(endingManager());
  else if (tab === 'characters') wrap.append(characters());
  else wrap.append(p.general);
  return wrap;
}

export function charCard(c) {
  const f = { look: c.look, promptBlock: c.promptBlock, catchphrase: c.catchphrase || '' };
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, style: 'display:none', onchange: async (e) => { for (const file of e.target.files) await act(async () => { await api.upload(`/api/characters/${c.id}/references?label=${encodeURIComponent(file.name)}`, file); return null; }, { ok: file.name + ' 업로드됨 (승인 필요)' }); e.target.value = ''; } });
  const dz = h('div', { class: 'dropzone', tabindex: 0, onclick: () => input.click(),
    ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); }, ondragleave: () => dz.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); dz.classList.remove('over'); for (const file of e.dataTransfer.files) await act(async () => { await api.upload(`/api/characters/${c.id}/references?label=${encodeURIComponent(file.name)}`, file); return null; }, { ok: file.name + ' 업로드됨 (승인 필요)' }); } },
    input, icon('upload'), ' 참조 이미지를 끌어놓거나 클릭해서 올리기 (PNG·JPG·WebP)');
  return h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'row between' }, h('div', { class: 'row' }, charAvatar(c, true), h('div', null, h('h3', null, c.name + ' · ' + c.nameKo), h('div', { class: 'small muted' }, c.role))), chip(c.references.some((r) => r.approved) ? '승인된 참조 있음' : '승인된 참조 없음', c.references.some((r) => r.approved) ? 'done' : 'attention')),
    refGallery(c),
    dz,
    h('div', { class: 'field' }, h('label', null, '외형 설명'), h('textarea', { rows: 3, value: f.look, oninput: (e) => (f.look = e.target.value) })),
    h('div', { class: 'field' }, h('label', null, '프롬프트 블록 (생성에 그대로 들어감)'), h('textarea', { rows: 3, value: f.promptBlock, oninput: (e) => (f.promptBlock = e.target.value) })),
    c.forbiddenWords && c.forbiddenWords.length ? h('div', { class: 'small muted' }, '금지어: ' + c.forbiddenWords.join(', ')) : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn sm', onclick: () => act(async () => { await api.put('/api/characters/' + c.id, f); return null; }, { ok: c.name + ' 정보를 저장했습니다' }) }, '저장')));
}
