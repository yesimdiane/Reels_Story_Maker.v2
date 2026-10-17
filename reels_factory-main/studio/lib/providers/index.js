// Provider-independent video interface. Everything in the Studio talks to `createVideoProvider(cfg)`;
// swapping Muapi for another service means adding a module with the same methods:
//   capabilities(), balance(), listModels(), uploadImage(file), submit(req), pollOnce(id),
//   waitForResult(id, {onProgress}), download(url, dest)  and the flags name / mode / paid.
'use strict';
const { createMuapiProvider, ProviderError } = require('./muapi');
const { createMockVideoProvider } = require('./mock');

function createVideoProvider(cfg, overrides = {}) {
  if (cfg.muapiMode === 'live') {
    if (!cfg.muapiApiKey) throw new ProviderError('AUTH', 'RF_MUAPI_MODE=live 이지만 MUAPI_API_KEY가 없습니다. 목업 모드로 되돌리거나 renderer/.env에 키를 넣으세요.');
    return createMuapiProvider(Object.assign({ apiKey: cfg.muapiApiKey, baseUrl: cfg.muapiBaseUrl }, overrides));
  }
  return createMockVideoProvider(Object.assign({ ffmpeg: cfg.ffmpeg.ffmpeg }, overrides));
}

module.exports = { createVideoProvider, createMuapiProvider, createMockVideoProvider, ProviderError };
