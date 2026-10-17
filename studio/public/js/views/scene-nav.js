// Jump to a scene (and one of its collapsible sections) in the Storyboard — used by the readiness card and any "where do I do this?" link.
import { state, hooks } from '../state.js';

export function goToScenePanel(ep, sceneId, panel) {
  state.ui = state.ui || { open: {} };
  state.ui.open = state.ui.open || {};
  state.ui.sbScene = state.ui.sbScene || {};
  if (sceneId) state.ui.sbScene[ep.id] = sceneId;
  if (panel === 'clips' && sceneId) { state.ui.anim = state.ui.anim || {}; state.ui.anim[ep.id] = sceneId; location.hash = `#/animation/${ep.id}`; return; } // video generation lives in Animation Studio
  if (panel === 'audio' && sceneId) { state.ui.voiceOpen = state.ui.voiceOpen || {}; state.ui.voiceOpen[sceneId] = true; location.hash = `#/voice/${ep.id}`; return; } // dialogue audio lives in Voice Studio
  if (panel === 'lipsync') { location.hash = `#/lipsync/${ep.id}`; return; }
  if (panel === 'product') panel = 'charrefs';
  if (sceneId && ['charrefs', 'look', 'face', 'camera', 'imageprompt'].includes(panel)) { state.ui.sbEdit = state.ui.sbEdit || {}; state.ui.sbEdit[`${ep.id}:${sceneId}`] = true; } // approved scenes hide these sections until reopened
  if (sceneId && panel) state.ui.open[`sb:${ep.id}:${sceneId}:${panel}`] = true;
  const settle = () => setTimeout(() => { const el = document.querySelector(panel ? `[data-panel="${panel}"]` : '[data-scene-card]') || document.querySelector('[data-sb-tab]'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
  if (state.view === 'image') { hooks.rerender(); settle(); } else { location.hash = `#/image/${ep.id}`; settle(); }
}
