// Encrypted credential vault. API keys are stored AES-256-GCM encrypted in <data>/secrets.json and are only ever
// decrypted inside the server process. The browser can learn "configured / last 4 characters" and nothing more.
// The master key comes from RF_MASTER_KEY (required in production). Without it (local development only) a random
// key file is created next to the data with owner-only permissions.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, readJson, writeJsonAtomic } = require('./util');

const PROVIDERS = ['gemini', 'openai', 'anthropic', 'muapi', 'heygen', 'manychat', 'googletts', 'googletts_sa'];
const ENV_NAMES = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', muapi: 'MUAPI_API_KEY', heygen: 'HEYGEN_API_KEY', manychat: 'MANYCHAT_API_TOKEN', googletts: 'GOOGLE_TTS_API_KEY', googletts_sa: 'GOOGLE_TTS_SERVICE_ACCOUNT_JSON' };

function deriveKey(secret, salt) {
  return crypto.scryptSync(String(secret), Buffer.from(salt, 'base64'), 32);
}

function createVault({ dir, masterKey = '', env = {}, requireMasterKey = false, log = () => {} }) {
  const file = path.join(dir, 'secrets.json');
  let key;
  let keySource;
  const data = () => readJson(file, { v: 1, salt: crypto.randomBytes(16).toString('base64'), secrets: {} });
  const ensureSalt = () => {
    const d = data();
    if (!fs.existsSync(file)) writeJsonAtomic(file, d);
    return d.salt;
  };
  if (masterKey) {
    key = deriveKey(masterKey, ensureSalt());
    keySource = 'env';
  } else if (requireMasterKey) {
    throw new StudioError('NO_MASTER_KEY', 'RF_MASTER_KEY가 설정되지 않았습니다. 운영 환경에서는 API 키 암호화를 위해 반드시 필요합니다.', { recovery: '긴 무작위 문자열(예: openssl rand -base64 32)을 RF_MASTER_KEY 환경변수로 설정하세요. 분실하면 저장된 키를 복호화할 수 없습니다.', status: 500 });
  } else {
    const kf = path.join(dir, 'master.key');
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(kf)) {
      fs.writeFileSync(kf, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
      log('개발용 master.key를 만들었습니다. 운영 환경에서는 RF_MASTER_KEY를 사용하세요.');
    }
    key = deriveKey(fs.readFileSync(kf, 'utf8').trim(), ensureSalt());
    keySource = 'file';
  }

  function enc(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  }
  function dec(rec) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
      d.setAuthTag(Buffer.from(rec.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(rec.ct, 'base64')), d.final()]).toString('utf8');
    } catch {
      throw new StudioError('VAULT_DECRYPT', '저장된 API 키를 복호화하지 못했습니다. RF_MASTER_KEY가 바뀌었을 수 있습니다.', { recovery: '원래의 RF_MASTER_KEY를 복원하거나, Settings → AI Integrations에서 키를 다시 입력하세요.', status: 500 });
    }
  }
  const check = (p) => {
    if (!PROVIDERS.includes(p)) throw new StudioError('BAD_PROVIDER', '알 수 없는 제공자입니다: ' + p);
    return p;
  };

  return {
    keySource,
    providers: PROVIDERS,
    /** `multiline` is for structured secrets (a service-account JSON key): whitespace is allowed there, the length floor stays. */
    set(provider, secret, { multiline = false } = {}) {
      check(provider);
      const s = String(secret || '').trim();
      if (s.length < 8 || (!multiline && /\s/.test(s))) throw new StudioError('BAD_KEY', 'API 키 형식이 올바르지 않습니다(공백 없이 8자 이상).');
      const d = data();
      d.secrets[provider] = Object.assign(enc(s), { last4: s.slice(-4), length: s.length, updatedAt: nowIso() });
      writeJsonAtomic(file, d);
    },
    remove(provider) {
      check(provider);
      const d = data();
      delete d.secrets[provider];
      writeJsonAtomic(file, d);
    },
    /** Server-side only. Vault value wins over the environment variable. */
    get(provider) {
      check(provider);
      const rec = data().secrets[provider];
      if (rec) return dec(rec);
      return env[ENV_NAMES[provider]] || '';
    },
    /** Safe for the browser: never the key itself. */
    mask(provider) {
      check(provider);
      const rec = data().secrets[provider];
      if (rec) return { configured: true, source: 'vault', last4: rec.last4, updatedAt: rec.updatedAt };
      if (env[ENV_NAMES[provider]]) return { configured: true, source: 'env', last4: String(env[ENV_NAMES[provider]]).slice(-4), updatedAt: '' };
      return { configured: false, source: '', last4: '', updatedAt: '' };
    },
  };
}

module.exports = { createVault, PROVIDERS, ENV_NAMES };
