// Shared client state (no framework): the summary, the open episode, and helpers views use.
import { api } from './api.js';
import { toast } from './ui.js';

const NO_EPISODE_VIEWS = ['overview', 'episodes', 'settings', 'products', 'storylab'];
export const state = { summary: null, episode: null, episodeId: localStorage.getItem('rf.episode') || '', productId: localStorage.getItem('rf.product') || '', view: 'overview', draft: {}, settingsTab: 'general' };
export const hooks = { rerender: () => {} };

export function go(view, episodeId) {
  const id = ['products', 'storylab'].includes(view) ? (episodeId || state.productId) : (episodeId || state.episodeId);
  location.hash = '#/' + view + (id && !['overview', 'episodes', 'settings'].includes(view) ? '/' + id : '');
}

export async function refresh({ episode = true } = {}) {
  state.summary = await api.get('/api/state');
  if (!state.episodeId || !state.summary.episodes.some((e) => e.id === state.episodeId)) state.episodeId = (state.summary.episodes.find((e) => !e.archived) || state.summary.episodes[0] || {}).id || '';
  if (episode && state.episodeId) state.episode = await api.get('/api/episodes/' + state.episodeId);
  else if (!state.episodeId) state.episode = null;
  try { localStorage.setItem('rf.episode', state.episodeId); } catch { /* private mode */ }
}

/** Mutations return the fresh episode view; keep the summary in sync too. */
export async function setEpisode(ep) {
  state.episode = ep;
  try { state.summary = await api.get('/api/state'); } catch { /* keep old summary */ }
  await hooks.rerender();
}

export async function selectEpisode(id) {
  state.episodeId = id;
  state.draft = {};
  await refresh();
  await hooks.rerender();
}

/** Runs an action, shows errors with recovery steps, and swaps in the returned episode. */
export async function act(fn, { ok = '' } = {}) {
  try {
    const r = await fn();
    if (r && r.id && r.derived) await setEpisode(r);
    else { await refresh(); await hooks.rerender(); }
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(e.message, { error: true, recovery: e.recovery });
    try { await refresh(); await hooks.rerender(); } catch { /* ignore */ }
    return null;
  }
}

export function setProduct(id) {
  state.productId = id || '';
  try { localStorage.setItem('rf.product', state.productId); } catch { /* private mode */ }
}

export const requireEpisode = () => state.episode;
