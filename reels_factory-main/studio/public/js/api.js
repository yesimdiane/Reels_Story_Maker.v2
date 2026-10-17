// Thin fetch wrapper. Sends the CSRF header; never handles any API key (keys live only on the server).
export class ApiError extends Error {
  constructor(payload, status) {
    super((payload && payload.message) || '요청에 실패했습니다.');
    this.code = payload && payload.code;
    this.recovery = payload && payload.recovery;
    this.details = payload && payload.details;
    this.status = status;
  }
}

async function call(method, url, body, headers = {}) {
  const init = { method, headers: Object.assign({ 'x-rf-studio': '1' }, headers) };
  if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && data && data.error && data.error.code === 'LOGIN_REQUIRED') window.dispatchEvent(new Event('rf-login-required'));
    throw new ApiError(data && data.error, res.status);
  }
  return data;
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b = {}) => call('POST', u, b),
  put: (u, b = {}) => call('PUT', u, b),
  del: (u, b) => call('DELETE', u, b),
  upload: (u, file, extra = {}) => call('POST', u, file, Object.assign({ 'x-filename': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, extra)),
};
