import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFreebuff } from './server.js';

const app = await startFreebuff();
const client = app.client;
const checks = [];
let thread;
try {
  assert.equal((await client.authStatus()).authed, true, 'Sign in with freebuff-sdk login first');
  const projectPath = resolve(process.env.FREEBUFF_TEST_PROJECT ?? 'work/hosted-fixture');
  await mkdir(projectPath, { recursive: true });
  const catalog = await client.listModels(projectPath);
  console.log(JSON.stringify({ models: catalog.freebuff.models.map(m => ({ id: m.id, disabled: m.disabled, available: m.available })), authed: catalog.freebuff.authed }));
  const candidates = catalog.freebuff.models.filter(m => !m.disabled && m.available !== false);
  assert.ok(candidates.length >= 2, 'Two available models required');
  thread = await client.createThread({ projectPath, harnessId: 'codebuff', model: candidates[0].id, executionMode: 'local', title: 'SDK hosted validation' });
  for (const [index, model] of candidates.slice(0, 2).entries()) {
    if (index) await client.switchModel(thread.id, { model: model.id, projectPath });
    const marker = `SDK_HOSTED_MODEL_${index}_VERIFIED`;
    await client.sendMessage(thread.id, `Use write_todos to create two steps: Verify SDK (in_progress), Finish check (pending). Then call write_todos again with both completed. Do not execute shell commands or modify any files. Finally reply exactly ${marker}.`, { signal: AbortSignal.timeout(30000) });
    const deadline = Date.now() + 120000;
    let result, completed = false;
    while (Date.now() < deadline) {
      result = await client.captureTask(thread.id, { signal: AbortSignal.timeout(10000) });
      if (result.text.includes(marker)) { completed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(completed, `Model ${model.id} did not produce the marker. Last output: ${result?.text.slice(-1200)}`);
    checks.push({ model: model.id, generated: true, checklist: result.checklist, toolNames: result.tools.map(t => t.toolName) });
    console.log(JSON.stringify(checks.at(-1)));
  }
  const report = { status: 'passed', checks };
  await writeFile(new URL('./evidence/hosted-validation.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (thread) {
    await client.stop(thread.id, { signal: AbortSignal.timeout(10000) }).catch(() => {});
    await client.actions.close(thread.id, {}, { signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
  await app.stop();
}
