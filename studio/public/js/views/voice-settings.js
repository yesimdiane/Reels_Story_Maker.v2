// Per-character voice settings that every episode reuses: provider, voice id, speaking rate, style, emotion.
// HeyGen / Google voices are picked from the synced catalog (voicePicker). MuAPI TTS (ElevenLabs) has no catalog read here,
// so its voice_id is typed in. Style and emotion are stored with the character; a provider that cannot apply them says so.
import { h, chip, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

const APPLIES = { muapi: '속도(rate)만 적용됩니다. 스타일·감정은 이 제공자 요청에 보내지 않습니다.', google: '속도만 적용됩니다. 스타일·감정은 보내지 않습니다.', heygen: '속도만 적용됩니다. 스타일·감정은 보내지 않습니다.' };

export function voiceSettings(c) {
  const v = c.voice || {};
  const f = { provider: v.provider || 'heygen', muapiVoiceId: v.muapiVoiceId || '', speed: v.speed == null ? 1 : v.speed, style: v.style || '', emotion: v.emotion || '' };
  const confirmed = !!(state.summary.settings && state.summary.settings.muapiTtsConfirmed);
  const save = (ok) => act(async () => { await api.put('/api/characters/' + c.id, { voice: { provider: f.provider, muapiVoiceId: f.muapiVoiceId, speed: Number(f.speed), style: f.style, emotion: f.emotion } }); return null; }, { ok });
  return h('div', { class: 'stack', style: 'gap:8px', 'data-voice-settings': c.id },
    h('b', null, '캐릭터 목소리 설정 (모든 에피소드에서 재사용)'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('span', { class: 'small' }, '현재 제공자:'), chip({ heygen: 'HeyGen', google: 'Google Cloud TTS', muapi: 'MuAPI TTS' }[f.provider] || f.provider, 'mock'),
      f.provider === 'muapi' ? chip(confirmed ? '엔드포인트 확인됨' : '엔드포인트 미확인 — 실제 호출 차단', confirmed ? 'done' : 'attention') : null),
    h('div', { class: 'grid two', style: 'gap:8px' },
      h('label', { class: 'field' }, h('span', { class: 'small' }, 'MuAPI ElevenLabs voice_id'), h('input', { type: 'text', value: f.muapiVoiceId, 'data-muapi-voice-id': '', placeholder: 'voice_id', oninput: (e) => (f.muapiVoiceId = e.target.value) })),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '속도 (0.7–1.2)'), h('input', { type: 'number', step: 0.05, min: 0.5, max: 2, value: f.speed, 'data-voice-rate': '', oninput: (e) => (f.speed = e.target.value) })),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '스타일 (메모)'), h('input', { type: 'text', value: f.style, 'data-voice-style': '', oninput: (e) => (f.style = e.target.value) })),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '감정 (메모)'), h('input', { type: 'text', value: f.emotion, 'data-voice-emotion': '', oninput: (e) => (f.emotion = e.target.value) }))),
    h('div', { class: 'small muted' }, APPLIES[f.provider] || ''),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm', type: 'button', 'data-voice-settings-save': '', onclick: () => { if (f.provider === 'muapi' && !f.muapiVoiceId.trim()) return toast('MuAPI voice_id를 입력하세요', { error: true }); save('목소리 설정을 저장했습니다'); } }, '설정 저장'),
      f.provider !== 'muapi' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-use-muapi-tts': '', onclick: () => { f.provider = 'muapi'; if (!f.muapiVoiceId.trim()) return toast('voice_id를 입력한 뒤 "설정 저장"을 누르세요'); save('MuAPI TTS를 사용하도록 저장했습니다'); } }, 'MuAPI TTS 사용') : h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { f.provider = 'heygen'; save('HeyGen 설정으로 되돌렸습니다'); } }, 'HeyGen으로 되돌리기')));
}
