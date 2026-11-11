import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {connectDesktop} from './desktop.js';

/** Instrument a private copy, never the installed app or its user profile. */
export async function launchDesktop({instrument = false, source = path.join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop'), directory, signal = AbortSignal.timeout(60000)} = {}) {
  if (!instrument) throw new Error('Packaged Freebuff refuses debugging; pass instrument:true to create an isolated SDK copy');
  const {extractAll, createPackage} = await import('@electron/asar');
  const root = directory ? path.resolve(directory) : await fs.mkdtemp(path.join(os.tmpdir(), 'freebuff-native-sdk-'));
  if (directory) await fs.mkdir(root); // Fail rather than reuse or overwrite an existing directory.
  const appDir = path.join(root, 'app'), unpack = path.join(root, 'unpacked'), profile = path.join(root, 'profile');
  await fs.cp(source, appDir, {recursive:true, force:false, errorOnExist:true});
  extractAll(path.join(source, 'resources/app.asar'), unpack);
  const main = path.join(unpack, 'electron/main.cjs');
  const code = await fs.readFile(main, 'utf8');
  const guard = 'if (app.isPackaged && hasRemoteDebuggingSwitch(process.argv)) app.exit(1)';
  const ownedMarker = '// SDK-owned isolated test copy permits its explicit loopback debugging endpoint.';
  if (code.split(guard).length !== 2 && code.split(ownedMarker).length !== 2) throw new Error('Unrecognized Freebuff debug guard; isolated copy was not launched');
  await fs.writeFile(main, code.replace(guard, '// SDK-owned isolated copy permits its explicit loopback debugger.'));
  await createPackage(unpack, path.join(appDir, 'resources/app.asar'));
  await fs.mkdir(profile);
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('FREEBUFF_')) delete env[key];
  env.FREEBUFF_DESKTOP_STATE_PATH = path.join(profile, 'state.json');
  env.FREEBUFF_DISABLE_UPDATE_CHECK = '1';
  const child = spawn(path.join(appDir, 'Freebuff.exe'), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir='+profile], {env, windowsHide:true, stdio:'ignore'});
  let spawnError;
  child.once('error', error => {spawnError = error;});
  try {
    while (true) {
      signal.throwIfAborted();
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Freebuff exited before its desktop bridge became ready');
      try {
        const port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim();
        if (!/^\d+$/.test(port)) throw new Error('Invalid desktop debugger port');
        const connection = await connectDesktop({endpoint:'http://127.0.0.1:'+port, signal});
        return {...connection, directory:root, process:child,
          async stop() {
            // Use the normal window-close flow so the app can refuse when work needs attention.
            await connection.desktop.closeWindow(false);
            await connection.close().catch(() => {});
          }
        };
      } catch (error) {
        if (signal.aborted) throw error;
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) && !/fetch failed|Select exactly|Not a Freebuff|context was destroyed/.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error) {
    // No SDK work has been started during readiness; terminate only our own failed launch.
    if (child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  }
}
