import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FreebuffClient, routesForVersion } from './index.js';

// Start an owned orchestrator: no port/token scraping or changes to the desktop profile.
export async function startFreebuff({ resources = join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop', 'resources'), statePath = join(process.env.LOCALAPPDATA, 'FreebuffSDK', 'state.json'), version } = {}) {
  if (!version) {
    const {extractFile} = await import('@electron/asar');
    version = JSON.parse(extractFile(join(resources,'app.asar'),'package.json').toString()).version;
  }
  routesForVersion(version);
  statePath = resolve(statePath);
  await mkdir(dirname(statePath), { recursive: true });
  const token = randomUUID(), env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('FREEBUFF_')) delete env[key];
  Object.assign(env, { PORT: '0', FREEBUFF_LAUNCH_ID: token, FREEBUFF_DESKTOP_STATE_PATH: statePath, FREEBUFF_UI_DIR: join(resources, 'orchestrator', 'ui') });
  const child = spawn(join(resources, 'bun', 'bun.exe'), [join(resources, 'orchestrator', 'orchestrator.js')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  // Consume logs without exposing tokens, project content or account data to stdout.
  child.stderr.resume();
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  };
  try {
    const ready = await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Freebuff did not start within 30 seconds')), 30000);
      const fail = error => { clearTimeout(timer); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`Freebuff server exited (${code}); check installation and profile ownership`)));
      child.stdout.on('data', chunk => {
        buffer = (buffer + chunk).slice(-65536);
        const match = buffer.match(/\[orchestrator-ready\] ([^\r\n]+)/);
        if (match) {
          try { const value = JSON.parse(match[1]); clearTimeout(timer); resolveReady(value); } catch (error) { fail(error); }
        }
      });
    });
    return { client: new FreebuffClient({ baseUrl: `http://127.0.0.1:${ready.port}`, token, version }), stop, statePath };
  } catch (error) { await stop(); throw error; }
}
