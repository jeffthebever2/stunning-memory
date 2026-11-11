import members from './evidence/bridge-current.json' with {type: 'json'};
import { FreebuffClient } from './index.js';

function loopback(raw, protocol) {
  const url = new URL(raw);
  if (url.protocol !== protocol || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new TypeError('Expected a literal loopback debugging endpoint');
  return url;
}

/** Connect only to an explicitly enabled debugging endpoint of the user's Freebuff app. */
export async function connectDesktop({endpoint, targetId, signal = AbortSignal.timeout(15000)}) {
  const base = loopback(endpoint, 'http:');
  const response = await fetch(new URL('/json/list', base), {signal, redirect: 'error'});
  if (!response.ok) throw new Error(`Desktop discovery HTTP ${response.status}`);
  const targets = (await response.json()).filter(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url) && (!targetId || t.id === targetId));
  if (targets.length !== 1) throw new Error('Select exactly one Freebuff page with targetId');
  const target = targets[0];
  const wsUrl = loopback(target.webSocketDebuggerUrl, 'ws:');
  if (wsUrl.port !== base.port) throw new Error('Unexpected debugger WebSocket port');
  const socket = new WebSocket(wsUrl);
  const pending = new Map(), subscriptions = new Map();
  let sequence = 0, closed = false;
  const binding = '__freebuff_sdk_' + crypto.randomUUID().replaceAll('-', '');
  const rejectPending = () => {
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Desktop connection closed')); }
    pending.clear(); subscriptions.clear();
  };
  socket.addEventListener('close', rejectPending);
  socket.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    if (message.id) {
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
    } else if (message.method === 'Runtime.bindingCalled' && message.params.name === binding) {
      const event = JSON.parse(message.params.payload);
      subscriptions.get(event.id)?.(...event.args);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Desktop connection closed'));
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id); reject(new Error(`Desktop ${method} timed out`));}, 30000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.throwIfAborted();
      signal.addEventListener('abort', abort, {once:true});
      socket.addEventListener('open', () => {cleanup(); resolve();}, {once:true});
      socket.addEventListener('error', () => {cleanup(); reject(new Error('Desktop WebSocket failed'));}, {once:true});
    });
    const info = await evaluate(`(async () => { if (!globalThis.freebuffDesktop || typeof freebuffDesktop.apiToken !== 'function') throw Error('Not a Freebuff renderer'); return {origin: location.origin, version: await freebuffDesktop.appVersion(), platform: freebuffDesktop.platform, customTitleBar: freebuffDesktop.customTitleBar, shellTheme: freebuffDesktop.shellTheme, names: Object.keys(freebuffDesktop), token: freebuffDesktop.apiToken()}; })()`);
    if (info.origin !== new URL(target.url).origin) throw new Error('Desktop navigation changed during connection');
    await send('Runtime.enable');
    await send('Runtime.addBinding', {name: binding});
    await evaluate(`globalThis[${JSON.stringify(binding + '_cleanup')}] = {}`);
    const desktop = {platform: info.platform, customTitleBar: info.customTitleBar, apiToken: async () => info.token};
    if (info.names.includes('shellTheme')) desktop.shellTheme = info.shellTheme;
    for (const {name} of members) {
      if (!info.names.includes(name)) continue;
      if (name in desktop || name === 'apiToken') continue;
      if (/^on[A-Z]/.test(name)) {
        desktop[name] = async handler => {
          if (typeof handler !== 'function') throw new TypeError('Event callback required');
          const id = crypto.randomUUID();
          subscriptions.set(id, handler);
          try { await evaluate(`globalThis[${JSON.stringify(binding + '_cleanup')}][${JSON.stringify(id)}] = freebuffDesktop[${JSON.stringify(name)}]((...args) => globalThis[${JSON.stringify(binding)}](JSON.stringify({id:${JSON.stringify(id)},args})))`); }
          catch(error) {subscriptions.delete(id); throw error;}
          return async () => {
            subscriptions.delete(id);
            if (!closed) await evaluate(`(() => { const c = globalThis[${JSON.stringify(binding + '_cleanup')}]; c?.[${JSON.stringify(id)}]?.(); if(c) delete c[${JSON.stringify(id)}]; })()`);
          };
        };
      } else {
        desktop[name] = (...args) => {
          const serialized = JSON.stringify(args, (_, value) => value instanceof Uint8Array ? {__freebuffBytes: Array.from(value)} : value);
          return evaluate(`freebuffDesktop[${JSON.stringify(name)}](...JSON.parse(${JSON.stringify(serialized)}, (_, value) => value?.__freebuffBytes ? new Uint8Array(value.__freebuffBytes) : value))`);
        };
      }
    }
    const client = new FreebuffClient({baseUrl: info.origin, token: info.token, version:info.version});
    client.desktop = desktop;
    return {client, desktop, async close() {
      if (closed) return;
      try {
        await evaluate(`(() => { const key=${JSON.stringify(binding + '_cleanup')}; for(const fn of Object.values(globalThis[key] ?? {})) if(typeof fn==='function') fn(); delete globalThis[key]; })()`);
        await send('Runtime.removeBinding', {name: binding});
      } finally {socket.close(); rejectPending();}
    }};
  } catch (error) {socket.close(); rejectPending(); throw error;}
}
