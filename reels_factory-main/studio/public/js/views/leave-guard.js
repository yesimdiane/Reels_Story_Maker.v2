// Unsaved edits are never discarded silently: switching scenes, switching episodes or leaving the editor asks first.
import { h, modal } from '../ui.js';
import { state } from '../state.js';

/**
 * Resolves true when it is OK to continue (nothing unsaved, saved, or the operator chose to discard), false to stay.
 * save(): async → true when the save worked.
 */
export function guardLeave({ dirty, what = '', save } = {}) {
  if (!dirty) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const close = modal((closeFn) => h('div', { class: 'stack' },
      h('h2', null, '저장하지 않은 변경이 있습니다'),
      h('p', { class: 'muted', style: 'margin:0' }, `${what ? what + ' ' : ''}이동하면 지금 입력한 내용이 사라집니다. 어떻게 할까요?`),
      h('div', { class: 'stack', style: 'gap:8px' },
        save ? h('button', { class: 'btn sage', type: 'button', 'data-leave-save': '1', onclick: async () => { const ok = await save(); closeFn(); finish(!!ok); } }, '저장하고 계속 (승인은 되지 않습니다)') : null,
        h('button', { class: 'btn clay', type: 'button', 'data-leave-discard': '1', onclick: () => { state.draft.script = null; closeFn(); finish(true); } }, '저장하지 않고 계속'),
        h('button', { class: 'btn ghost', type: 'button', 'data-leave-stay': '1', onclick: () => { closeFn(); finish(false); } }, '계속 편집'))), {});
    // closing the dialog by clicking outside / Escape means "stay"
    const obs = new MutationObserver(() => { if (!document.querySelector('[data-leave-stay]')) { obs.disconnect(); finish(false); } });
    obs.observe(document.getElementById('modal-root'), { childList: true, subtree: true });
    void close;
  });
}
