// Runtime resolution of keys and modes, so changing a provider key or mode in Settings takes effect without
// restarting the server or editing .env files. Keys come from the encrypted vault (or the environment as a fallback).
// Safety: a "live" request without a key does NOT silently become real — it is reported as live_requested_without_key
// and the effective mode stays MOCK, which the UI shows explicitly.
'use strict';

function createRuntime({ cfg, vault, store }) {
  const settings = () => store.settings.get();
  const prov = (name) => (settings().providers || {})[name] || {};

  const muapiKey = () => vault.get('muapi') || cfg.muapiApiKey || '';
  const heygenKey = () => vault.get('heygen') || cfg.heygenApiKey || '';

  function requestedMuapi() {
    if (cfg.muapiMode === 'live') return 'live'; // environment can force live (legacy behaviour)
    return prov('muapi').mode === 'live' ? 'live' : 'mock';
  }
  function requestedVoice() {
    if (cfg.studioMode === 'live') return 'live';
    return prov('heygen').mode === 'live' ? 'live' : 'mock';
  }
  let googleReady = () => false; // set by the voice catalog (Google Cloud TTS credentials present on the server)
  return {
    muapiKey,
    heygenKey,
    muapiRequested: requestedMuapi,
    voiceRequested: requestedVoice,
    muapiMode: () => (requestedMuapi() === 'live' && muapiKey() ? 'live' : 'mock'),
    voiceMode: () => (requestedVoice() === 'live' && (heygenKey() || googleReady()) ? 'live' : 'mock'),
    setGoogleReady: (fn) => { googleReady = fn; },
    key: (name) => vault.get(name),
  };
}

module.exports = { createRuntime };
