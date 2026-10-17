// Review translation next to a text box (EN <-> KO). Read-only: the English text in the box stays the source of truth
// (it is what is stored and sent to the AI/video models). Translating is an AI call: cost-confirmed, cached per text.
import { h, toast } from '../ui.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { confirmPaid } from './common.js';

const HANGUL = /[가-힣]/;

/** { btn, panel }: put `btn` beside the box's other buttons and `panel` below the box. */
export function translateControl(ep, getText) {
  const panel = h('div', { class: 'translation-panel', hidden: true });
  const btn = h('button', { class: 'btn sm ghost', type: 'button', title: '검토용 번역 (한↔영). 원문(영어)이 기준이며 번역은 읽기 전용입니다.' }, '번역 보기');
  const show = (r) => {
    const toKo = r.to === 'ko';
    panel.hidden = false;
    panel.replaceChildren(
      h('div', { class: 'row between' }, h('b', { class: 'small' }, toKo ? '한국어 번역 (읽기 전용 · 검토용)' : 'English translation (read-only · for review)'), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { panel.hidden = true; btn.textContent = '번역 보기'; } }, '닫기')),
      h('div', { class: 'translation-text', lang: toKo ? 'ko' : 'en' }, r.translation),
      h('div', { class: 'small muted' }, (r.cached ? '저장된 번역 · ' : '') + (r.mock ? '샘플 번역(AI 미연결) · ' : '') + '수정은 원문 상자에서 하세요. 번역은 AI에 보내는 프롬프트에 쓰이지 않습니다.'));
    btn.textContent = '번역 숨기기';
  };
  btn.onclick = async () => {
    if (!panel.hidden) { panel.hidden = true; btn.textContent = '번역 보기'; return; }
    const text = String(getText() || '').trim();
    if (!text) return toast('번역할 내용이 없습니다.');
    try {
      const est = await api.post(`/api/episodes/${ep.id}/translate/estimate`, { text });
      if (est.cached) return show({ to: est.to, translation: est.translation, cached: true });
      const toKo = est.to === 'ko';
      const route = (state.summary.ai.routing || []).find((r) => r.task === 'scriptWriting') || { provider: 'mock' };
      const confirm = await confirmPaid({ title: (toKo ? '한국어로 번역' : '영어로 번역') + (route.provider === 'mock' ? ' (샘플)' : ' (유료일 수 있음)'), est: est.estimate, confirmLabel: '번역', body: h('p', { class: 'small muted', style: 'margin:0' }, '검토용 번역만 만듭니다. 원문은 바뀌지 않고, 같은 내용은 다시 번역하지 않습니다.') });
      if (confirm === null) return;
      show(await api.post(`/api/episodes/${ep.id}/translate`, { text, confirm }));
    } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
  };
  return { btn, panel };
}

/** Appends the button + panel under a labelled field (label row gets the button on the right). */
export function withTranslate(fieldEl, ep, getText) {
  const { btn, panel } = translateControl(ep, getText);
  fieldEl.append(h('div', { class: 'row', style: 'margin-top:4px' }, btn), panel);
  return fieldEl;
}
export const isKorean = (t) => HANGUL.test(String(t || ''));
