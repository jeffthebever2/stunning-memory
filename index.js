import routes from './routes.json' with { type: 'json' };
import actions from './actions.json' with { type: 'json' };
import hostedRoutes from './routes-0.0.201.json' with {type: 'json'};
import { taskOutput } from './task.js';
export { taskOutput };
export { routes };
export function routesForVersion(version) {
  if (version === '0.0.190') return routes;
  if (version === '0.0.201') return hostedRoutes;
  throw new Error(`Freebuff ${version} has not been inventoried; refusing to guess its interface`);
}

export class FreebuffError extends Error {
  constructor(status, data) {
    super(`Freebuff HTTP ${status}`);
    this.name = 'FreebuffError';
    this.status = status;
    this.data = data;
  }
}

function segment(value) {
  if (value == null || String(value) === '' || ['.', '..'].includes(String(value))) throw new TypeError('Missing or unsafe path parameter');
  return encodeURIComponent(String(value));
}

export class FreebuffClient {
  #base; #token; #fetch; #routes;
  constructor({ baseUrl = globalThis.location?.origin, token, bridge = globalThis.freebuffDesktop, consent = globalThis.consent, fetch: fetchImpl = globalThis.fetch, version = '0.0.190' } = {}) {
    const base = new URL(baseUrl);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new TypeError('Use the Freebuff http://127.0.0.1:PORT origin');
    this.#base = base;
    this.#token = token ?? bridge?.apiToken?.();
    this.#fetch = fetchImpl;
    this.#routes = routesForVersion(version);
    this.version = version;
    this.desktop = bridge ?? null;
    this.consent = consent ?? null;
    this.operations = Object.fromEntries(this.#routes.filter(r => r.pattern.startsWith('/api/')).map(r => [`${r.method} ${r.pattern}`, options => this.call(r.method, r.pattern, options)]));
    this.actions = Object.fromEntries((version === '0.0.190' ? actions : []).map(action => [action, (id, body, options) => this.threadAction(id, action, body, options)]));
    this.hostedWorkspace = Object.fromEntries(this.#routes.filter(r => r.pattern.startsWith('/api/hosted-workspace/')).map(r => [`${r.method.toLowerCase()}${r.pattern.split('/').at(-1).split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('')}`, (body, options = {}) => this.call(r.method, r.pattern, {...options, body:r.method==='GET'?undefined:body??{}})]));
  }

  async request(method, path, { query = {}, body, signal, raw = false } = {}) {
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) throw new TypeError('Invalid HTTP method');
    if (!/^\/api\//.test(path) || /[?#\\]/.test(path)) throw new TypeError('Expected an /api/ path without query or fragment');
    const url = new URL(path, this.#base);
    if (url.origin !== this.#base.origin || !url.pathname.startsWith('/api/')) throw new TypeError('Unsafe API path');
    for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
    const headers = new Headers();
    if (this.#token) headers.set('x-freebuff-launch-id', this.#token);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await this.#fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', redirect: 'error', signal });
    if (!response.ok) {
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      throw new FreebuffError(response.status, data);
    }
    if (raw) return response;
    if (response.status === 204) return undefined;
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text();
  }

  call(method, pattern, { params = {}, ...options } = {}) {
    if (!this.#routes.some(r => r.pattern === pattern && (r.method === method || r.method === 'ANY'))) throw new TypeError(`Operation ${method} ${pattern} is unavailable in Freebuff ${this.version}`);
    const path = pattern.split('/').map(p => p.startsWith(':') ? segment(params[p.slice(1)]) : p.startsWith('*') ? String(params[p.slice(1)] ?? '').split('/').map(segment).join('/') : p).join('/');
    return this.request(method, path, options);
  }

  createThread(body, options = {}) { return this.call('POST', '/api/threads', { ...options, body }); }
  getThread(id, options = {}) { return this.call('GET', '/api/thread/:id', { ...options, params: { id } }); }
  threadAction(id, action, body = {}, options = {}) { return this.call('POST', '/api/thread/:id/*action', { ...options, params: { id, action }, body }); }

  authStatus(options) { return this.call('GET', '/api/auth/status', options); }
  login(options = {}) { return this.call('POST', '/api/auth/login/start', { ...options, body: {} }); }
  openProject(path, options = {}) { return this.call('POST', '/api/project/open', { ...options, body: { path } }); }
  async getState(projectPath, { signal = AbortSignal.timeout(15000) } = {}) {
    const opened = await this.openProject(projectPath, { signal });
    const normalize = path => path.replace(/\\/g, '/').replace(/\/$/, '');
    for await (const event of this.events({ signal })) {
      if (event.type === 'state' && normalize(event.snapshot.project.rootPath) === normalize(opened.path)) return event.snapshot;
    }
    throw new Error('State stream ended before the requested project arrived');
  }
  async listModels(projectPath, options) {
    const state = await this.getState(projectPath, options);
    return { freebuff: state.freebuff, agents: state.agent };
  }
  async switchModel(id, { harnessId = 'codebuff', model, projectPath }, options = {}) {
    if (typeof model !== 'string' || !model) throw new TypeError('model required');
    const result = await this.threadAction(id, 'agent', { harnessId, model, projectPath }, options);
    if (result.rejected) throw new Error('Freebuff rejected the model change for this thread');
    return result;
  }
  setEffort(id, effort, options = {}) { return this.threadAction(id, 'effort', { effort }, options); }
  setProvider(id, binding, options = {}) { return this.threadAction(id, 'byok', binding ?? { connectionId: null }, options); }
  sendMessage(id, text, { attachments, projectPath, ...options } = {}) { return this.threadAction(id, 'message', { text, attachments, projectPath }, options); }
  stop(id, options = {}) { return this.threadAction(id, 'stop', {}, options); }
  listProjects(options) { return this.call('GET', '/api/projects', options); }
  switchProject(path, options) { return this.getState(path, options); }
  async startTask({ text, attachments, ...thread }, options = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('Task text required');
    const created = await this.createThread(thread, options);
    try { await this.sendMessage(created.id, text, { ...options, attachments, projectPath: thread.projectPath }); }
    catch (error) { error.threadId = created.id; throw error; }
    return created;
  }
  async captureTask(id, options = {}) { return taskOutput(await this.getThread(id, options)); }
  async *watchTask(id, options = {}) {
    const stream = this.events(options);
    // Consume the initial replay before reading a snapshot, so subsequent output cannot be missed.
    const first = await stream.next();
    try {
      yield { event: null, ...await this.captureTask(id, options) };
      if (!first.done && first.value.threadId === id) yield { event: first.value, ...await this.captureTask(id, options) };
      for await (const event of stream) {
        if (event.threadId === id || event.type === 'question_request' || event.type === 'elevation_request' || event.type === 'log') yield { event, ...await this.captureTask(id, options) };
      }
    } finally { await stream.return(); }
  }

  async *events({ signal } = {}) {
    const response = await this.request('GET', '/api/events', { signal, raw: true });
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new TypeError('Expected SSE response');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    let buffer = '', data = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { signal?.throwIfAborted(); break; }
        buffer += value;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line === '') {
            if (data.length) { const payload = data.join('\n'); data = []; yield JSON.parse(payload); }
          } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
      }
    } finally { signal?.removeEventListener('abort', cancel); try { await reader.cancel(); } finally { reader.releaseLock(); } }
  }

  connectTerminal(query, { factory } = {}) {
    if (!query?.threadId) throw new TypeError('threadId required');
    const url = new URL('/api/terminal', this.#base);
    url.protocol = 'ws:';
    for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
    if (factory) return factory(url.href, this.#token ? { 'x-freebuff-launch-id': this.#token } : {});
    if (globalThis.location?.origin !== this.#base.origin) throw new TypeError('Use a WebSocket factory supporting authentication headers outside the Freebuff renderer');
    return new WebSocket(url);
  }
}
