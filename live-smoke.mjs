import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FreebuffClient, FreebuffError } from './index.js';

const resources = process.env.FREEBUFF_RESOURCES ?? join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop', 'resources');
const root = await mkdtemp(join(tmpdir(), 'freebuff-sdk-smoke-'));
const project = join(root, 'project');
await mkdir(project);
await writeFile(join(project, 'sample.txt'), 'SDK fixture\n');
const token = randomUUID();
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('FREEBUFF_')) delete env[key];
Object.assign(env, {
  PORT: '0', FREEBUFF_LAUNCH_ID: token,
  FREEBUFF_DESKTOP_STATE_PATH: join(root, 'state.json'),
  FREEBUFF_UI_DIR: join(resources, 'orchestrator', 'ui'),
  FREEBUFF_SHIP_LOGS: '0', DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1',
  NEXT_PUBLIC_CODEBUFF_APP_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_FREEBUFF_APP_URL: 'http://127.0.0.1:9',
  FREEBUFF_AUTH_HOST: 'http://127.0.0.1:9',
  NEXT_PUBLIC_POSTHOG_API_KEY: '', NEXT_PUBLIC_POSTHOG_HOST_URL: 'http://127.0.0.1:9',
});
const child = spawn(join(resources, 'bun', 'bun.exe'), [join(resources, 'orchestrator', 'orchestrator.js')], { env, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', stdout = '';
child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
const checks = [];
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Freebuff startup timeout')), 30000);
    const fail = error => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', code => fail(new Error(`Freebuff exited ${code}`)));
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/\[orchestrator-ready\] ([^\r\n]+)/);
      if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); }
    });
  });
  const baseUrl = `http://127.0.0.1:${ready.port}`;
  const client = new FreebuffClient({ baseUrl, token });
  const options = { signal: AbortSignal.timeout(10000) };
  const unauthorized = new FreebuffClient({ baseUrl, token: 'wrong' });
  await assert.rejects(unauthorized.call('GET', '/api/projects', options), e => e instanceof FreebuffError && e.status === 401);
  checks.push('invalid authentication rejected with 401');
  const projects = await client.call('GET', '/api/projects', options);
  assert.ok(Array.isArray(projects.projects));
  checks.push('authenticated projects read');
  const events = client.events({ signal: AbortSignal.timeout(10000) });
  const first = await events.next();
  assert.equal(first.done, false);
  assert.equal(typeof first.value.type, 'string');
  await events.return();
  checks.push('real SSE replay and cancellation');
  await client.call('POST', '/api/settings/ui', { ...options, body: { explorerWidth: 333 } });
  const workspace = await client.call('GET', '/api/workspace/bootstrap', options);
  assert.equal(workspace.prefs.explorerWidth, 333);
  checks.push('settings write and readback in isolated profile');
  await assert.rejects(client.call('POST', '/api/settings/ui', { ...options, body: { explorerWidth: 'invalid' } }), e => e instanceof FreebuffError && e.status === 400);
  checks.push('server validation errors preserved');
  const thread = await client.createThread({ projectPath: project, title: 'SDK smoke', harnessId: 'codex', executionMode: 'local' }, options);
  assert.equal(typeof thread.id, 'string');
  const snapshot = await client.getThread(thread.id, { ...options, query: { projectPath: project } });
  assert.equal(snapshot.thread.id, thread.id);
  await client.threadAction(thread.id, 'rename', { title: 'Renamed by SDK', projectPath: project }, options);
  const renamed = await client.getThread(thread.id, { ...options, query: { projectPath: project } });
  assert.equal(renamed.thread.title, 'Renamed by SDK');
  checks.push('thread creation, snapshot, rename and readback');
  const catalog = await client.listModels(project, { signal: AbortSignal.timeout(20000) });
  assert.ok(catalog.freebuff.models.length >= 2);
  const switched = [];
  for (const model of catalog.freebuff.models.slice(0, 2)) {
    const result = await client.switchModel(thread.id, { model: model.id, projectPath: project }, { signal: AbortSignal.timeout(10000) });
    assert.equal(result.ok, true);
    const current = await client.getThread(thread.id, { query: { projectPath: project }, signal: AbortSignal.timeout(10000) });
    assert.equal(current.thread.model, model.id);
    assert.equal(current.thread.harnessId, 'codebuff');
    switched.push(model.id);
  }
  checks.push('model discovery and switching with persisted readback: ' + switched.join(', '));
  const auth = await client.authStatus({ signal: AbortSignal.timeout(10000) });
  checks.push('authentication status: ' + (auth.authed ? 'signed in' : 'sign-in required for hosted generation'));
  const project2 = join(root, 'project2');
  await mkdir(project2);
  const state2 = await client.switchProject(project2, { signal: AbortSignal.timeout(10000) });
  assert.equal(state2.project.rootPath.replaceAll('\\', '/'), project2.replaceAll('\\', '/'));
  await client.switchProject(project, { signal: AbortSignal.timeout(10000) });
  checks.push('switch between two real project engines');
  if (process.env.FREEBUFF_TEST_GENERATION === '1') {
    const task = await client.startTask({ projectPath: project, harnessId: 'codex', executionMode: 'local', text: 'Do not run tools or edit files. Reply exactly SDK_GENERATION_VERIFIED.' }, { signal: AbortSignal.timeout(30000) });
    let verified = false;
    let checklistCaptured = false;
    for await (const output of client.watchTask(task.id, { signal: AbortSignal.timeout(120000) })) {
      if (output.checklist?.length === 2) checklistCaptured = true;
      if (output.text.includes('SDK_GENERATION_VERIFIED')) { verified = true; break; }
    }
    assert.ok(verified);
    checks.push('real Codex task generation and captured assistant output');
    if (checklistCaptured) checks.push('real agent checklist captured from tool parts');
  }
  if (process.env.FREEBUFF_TEST_WS_MODULE) {
    const { default: WebSocket } = await import(process.env.FREEBUFF_TEST_WS_MODULE);
    const socket = client.connectTerminal({ threadId: thread.id, sessionId: 'sdk-smoke', cols: 80, rows: 24 }, { factory: (url, headers) => new WebSocket(url, { headers }) });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Terminal readiness timeout')), 15000);
        const fail = error => { clearTimeout(timer); reject(error); };
        socket.once('error', fail);
        socket.once('close', (code, reason) => fail(new Error(`Terminal closed ${code}: ${reason}`)));
        socket.on('message', data => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'ready') { clearTimeout(timer); resolve(); }
          } catch {}
        });
      });
      await client.request('DELETE', '/api/terminal', { ...options, query: { threadId: thread.id, sessionId: 'sdk-smoke' } });
      checks.push('authenticated terminal WebSocket readiness and session close');
    } finally { socket.terminate(); }
  }
  console.log(JSON.stringify({ status: 'passed', checks, isolatedProfile: root }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', checks, error: error.message, logs: logs.replaceAll(token, '[redacted]') }, null, 2));
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
