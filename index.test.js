import test from 'node:test';
import assert from 'node:assert/strict';
import { FreebuffClient, FreebuffError, routes, taskOutput, routesForVersion } from './index.js';

test('current hosted routes are version-specific and all expand with exact request bodies', async () => {
  const requests=[];
  const client=new FreebuffClient({baseUrl:'http://127.0.0.1:8787',version:'0.0.201',fetch:async(url,init)=>{requests.push({path:url.pathname,method:init.method,body:init.body});return Response.json({ok:true});}});
  assert.equal(Object.keys(client.operations).length,40);
  assert.equal(Object.keys(client.actions).length,0);
  assert.throws(()=>client.createThread({}),/unavailable in Freebuff 0.0.201/);
  for(const r of routesForVersion('0.0.201').filter(r=>r.pattern.startsWith('/api/'))) {
    const params=Object.fromEntries([...r.pattern.matchAll(/[:*](\w+)/g)].map(m=>[m[1],'test']));
    await client.call(r.method,r.pattern,{params});
  }
  await client.hostedWorkspace.postNativeAgents({accountId:'fixture',operation:'status'});
  assert.deepEqual(requests.at(-1),{path:'/api/hosted-workspace/native-agents',method:'POST',body:'{"accountId":"fixture","operation":"status"}'});
  assert.throws(()=>routesForVersion('unknown'),/not been inventoried/);
});

test('checklists track tool updates, active states, clearing and new user turns', () => {
  const tool = todos => ({ role: 'assistant', parts: [{ kind: 'tool', toolName: 'TodoWrite', input: { todos } }] });
  const messages = [tool([{ content: 'First', status: 'in_progress' }, { task: 'Second', completed: true }])];
  assert.deepEqual(taskOutput({ messages }).checklist, [{ text: 'First', state: 'active' }, { text: 'Second', state: 'done' }]);
  assert.equal(taskOutput({ messages: [...messages, tool([])] }).checklist, null);
  assert.equal(taskOutput({ messages: [...messages, { role: 'user', parts: [] }] }).checklist, null);
  assert.equal(taskOutput({ messages: [{ role: 'assistant', parts: [{ kind: 'text', text: 'answer' }] }] }).text, 'answer');
});

test('task creation forwards attachments and project context to the message action', async () => {
  const calls = [];
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', fetch: async (url, init) => {
    calls.push({path: url.pathname, body: JSON.parse(init.body)});
    return Response.json(calls.length === 1 ? {id: 'task'} : {ok: true});
  }});
  await client.startTask({text: 'inspect attachment', projectPath: 'C:/fixture', attachments: ['C:/fixture/file.png']});
  assert.equal(calls[0].body.attachments, undefined);
  assert.deepEqual(calls[1], {path: '/api/thread/task/message', body: {text: 'inspect attachment', projectPath: 'C:/fixture', attachments: ['C:/fixture/file.png']}});
});

test('project state follows the canonical path returned by the server', async () => {
  let cancelled = false;
  const client = new FreebuffClient({baseUrl: 'http://127.0.0.1:8787', fetch: async url => {
    if (url.pathname === '/api/project/open') return Response.json({ok: true, path: 'C:/Canonical'});
    return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"state","snapshot":{"project":{"rootPath":"C:/Canonical"}}}\n\n')); }, cancel() {cancelled = true;} }), {headers: {'content-type': 'text/event-stream'}});
  }});
  const state = await client.getState('C:/alias');
  assert.equal(state.project.rootPath, 'C:/Canonical');
  assert.equal(cancelled, true);
});

test('catalog is unique and all operations expand without escaping origin', async () => {
  assert.equal(new Set(routes.map(r => r.method + ' ' + r.pattern)).size, routes.length);
  let count = 0;
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', token: 'test-token', fetch: async (url, init) => {
    assert.equal(url.origin, 'http://127.0.0.1:8787');
    assert.equal(init.headers.get('x-freebuff-launch-id'), 'test-token');
    assert.equal(init.redirect, 'error');
    count++;
    return Response.json({ ok: true });
  }});
  for (const r of routes) {
    const params = Object.fromEntries([...r.pattern.matchAll(/[:*]([\w]+)/g)].map(m => [m[1], 'test value']));
    if (r.pattern.startsWith('/auth/')) continue;
    await client.call(r.method === 'ANY' ? 'GET' : r.method, r.pattern, { params });
  }
  assert.ok(count > 150);
});

test('parameters, host, and redirect boundaries', async () => {
  for (const baseUrl of ['https://example.com', 'http://127.0.0.1:8787/other', 'http://user:password@127.0.0.1:8787']) assert.throws(() => new FreebuffClient({ baseUrl }));
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787' });
  assert.throws(() => client.getThread('..'));
  assert.throws(() => client.getThread(undefined));
  assert.throws(() => client.call('GET', '/api/nonexistent'));
  await assert.rejects(client.request('GET', '/api/../../other'));
  await assert.rejects(client.request('GET', '/api/test?token=secret'));
});

test('JSON request, typed error, raw response, and no-content', async () => {
  let init;
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', fetch: async (_, value) => { init = value; return Response.json({ error: 'conflict' }, { status: 409 }); } });
  await assert.rejects(client.threadAction('one', 'message', { prompt: 'hello' }), error => error instanceof FreebuffError && error.status === 409 && error.data.error === 'conflict');
  assert.deepEqual(JSON.parse(init.body), { prompt: 'hello' });
  const empty = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', fetch: async () => new Response(null, { status: 204 }) });
  assert.equal(await empty.request('DELETE', '/api/terminal'), undefined);
});

test('SSE handles split UTF-8, CRLF, comments, and cancels on early exit', async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode(': ping\r\n\r\ndata: {"type":"héllo"}\r\n\r\ndata: {"type":"next"}\n\n');
  let offset = 0;
  const stream = new ReadableStream({ pull(c) { if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset)); }, cancel() { cancelled = true; } });
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', fetch: async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }) });
  for await (const event of client.events()) { assert.equal(event.type, 'héllo'); break; }
  assert.equal(cancelled, true);
});

test('aborting an idle task stream cancels its reader', async () => {
  const controller = new AbortController();
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', fetch: async () => new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } }) });
  const events = client.events({ signal: controller.signal });
  const pending = events.next();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('native bridge remains bound and terminal factory receives header without URL token', () => {
  const bridge = { apiToken: () => 'secret', appVersion: () => '0.0.190' };
  const client = new FreebuffClient({ baseUrl: 'http://127.0.0.1:8787', bridge });
  assert.equal(client.desktop, bridge);
  client.connectTerminal({ threadId: 'a/b' }, { factory(url, headers) { assert.equal(headers['x-freebuff-launch-id'], 'secret'); assert.ok(!url.includes('secret')); assert.equal(new URL(url).searchParams.get('threadId'), 'a/b'); } });
  assert.throws(() => client.connectTerminal({ threadId: 'a' }));
});
