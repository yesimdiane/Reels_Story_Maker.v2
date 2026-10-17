// Configuration from environment variables (and renderer/.env). Same keys locally and in the cloud.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadConfig(env = process.env, { dotenvFile = path.join(__dirname, '..', '.env'), platform = process.platform } = {}) {
  // Local terminal workflow: RF_ENV_FILE=/absolute/path/to/keys.env npm run studio
  // Explicit env values take precedence; the file is read only by the Node process.
  const selectedFile = env.RF_ENV_FILE ? path.resolve(env.RF_ENV_FILE) : dotenvFile;
  if (env.RF_ENV_FILE && !fs.existsSync(selectedFile)) {
    throw new Error('RF_ENV_FILE does not exist: ' + selectedFile);
  }
  const e = Object.assign({}, loadDotEnv(selectedFile), env);
  const num = (k, d) => (e[k] != null && e[k] !== '' ? Number(e[k]) : d);
  const stateDir = e.RF_STATE_DIR || path.join(os.homedir(), '.reels-factory');
  const inCloud = !!(e.K_SERVICE || e.CLOUD_RUN_JOB);
  return {
    secret: e.RF_RENDER_SECRET || '',
    // Gemini checks the finished video against the approved script (advisory). Key lives in renderer/.env only.
    geminiApiKey: e.GEMINI_API_KEY || '',
    geminiModel: e.RF_GEMINI_MODEL || 'gemini-3.5-flash',
    openaiApiKey: e.OPENAI_API_KEY || '',
    anthropicApiKey: e.ANTHROPIC_API_KEY || '',
    // --- Studio V2.3 (cloud). RF_MASTER_KEY encrypts provider keys saved from Settings (required when RF_ENV=production).
    masterKey: e.RF_MASTER_KEY || '',
    production: e.RF_ENV === 'production' || e.NODE_ENV === 'production',
    adminPassword: e.RF_ADMIN_PASSWORD || '',
    publicHost: e.RF_PUBLIC_HOST || '',
    driveToken: e.RF_DRIVE_ACCESS_TOKEN || '',
    refsDir: e.RF_REFS_DIR || path.join(__dirname, '..', 'refs'),
    ttsProvider: e.RF_TTS_PROVIDER || 'heygen',
    ttsAuth: e.RF_TTS_AUTH || (e.GOOGLE_TTS_API_KEY ? 'apiKey' : inCloud ? 'metadata' : 'gcloud'),
    googleApiKey: e.GOOGLE_TTS_API_KEY || '',
    heygenApiKey: e.HEYGEN_API_KEY || '',
    heygenVoice: e.RF_HEYGEN_VOICE_ID || '5bfc3fa102124f7681ee3ffb34bcf1bf',
    // --- Studio V2 (Jack & Diane). The Muapi key never leaves this process; the UI only learns "configured: yes/no".
    muapiApiKey: e.MUAPI_API_KEY || '',
    muapiBaseUrl: e.RF_MUAPI_BASE_URL || 'https://api.muapi.ai/api/v1',
    // MOCK is the default. Real (billable) generation needs RF_MUAPI_MODE=live set by the operator in the environment.
    muapiMode: e.RF_MUAPI_MODE === 'live' ? 'live' : 'mock',
    studioMode: e.RF_STUDIO_VOICE_MODE === 'live' ? 'live' : 'mock',
    studioDir: e.RF_STUDIO_DIR || path.join(stateDir, 'studio'),
    // Cloud hosts inject PORT and need 0.0.0.0; local default stays 127.0.0.1:4173.
    studioHost: e.RF_STUDIO_HOST || (e.PORT ? '0.0.0.0' : '127.0.0.1'),
    studioPort: num('RF_STUDIO_PORT', e.PORT ? Number(e.PORT) : 4173),
    studioToken: e.RF_STUDIO_TOKEN || '',
    sheetsBridgeUrl: e.RF_SHEETS_BRIDGE_URL || '',
    sheetsBridgeToken: e.RF_SHEETS_BRIDGE_TOKEN || '',
    reelSpendLimitUsd: num('RF_REEL_SPEND_LIMIT_USD', 5),
    gcpProject: e.RF_GCP_PROJECT || '',
    voice: e.RF_TTS_VOICE || 'ko-KR-Wavenet-A',
    speakingRate: num('RF_TTS_RATE', 1.05),
    maxCharsPerJob: num('RF_TTS_MAX_CHARS_PER_JOB', 1500),
    monthlyCharLimit: num('RF_TTS_MONTHLY_CHAR_LIMIT', 500000),
    stateDir,
    cacheDir: path.join(stateDir, 'cache', 'tts'),
    ledgerFile: path.join(stateDir, 'tts-usage.json'),
    outputDir: e.RF_OUTPUT_DIR || path.join(__dirname, '..', 'output'),
    clipsDir: e.RF_CLIPS_DIR || path.join(__dirname, '..', 'clips'),
    jobsDir: e.RF_JOBS_DIR || path.join(__dirname, '..', 'jobs'),
    // Declared provenance for clips without an assets.json (the operator's workflow: Google Flow).
    defaultSource: e.RF_DEFAULT_FOOTAGE_SOURCE || 'flow-generated',
    allowFontFallback: e.RF_ALLOW_FONT_FALLBACK === '1',
    ffmpeg: { ffmpeg: e.RF_FFMPEG || 'ffmpeg', ffprobe: e.RF_FFPROBE || 'ffprobe' },
    font: e.RF_FONT_NAME || (platform === 'darwin' ? 'Apple SD Gothic Neo' : 'NanumGothic'),
    fontsDir: e.RF_FONTS_DIR || '',
    crf: num('RF_CRF', 20),
    preset: e.RF_X264_PRESET || 'medium',
  };
}

module.exports = { loadConfig, loadDotEnv };
