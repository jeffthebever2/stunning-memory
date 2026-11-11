import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {connectDesktop} from './desktop.js';

if (!process.env.FREEBUFF_DEBUG_ENDPOINT) throw new Error('FREEBUFF_DEBUG_ENDPOINT required; use an SDK-instrumented copy');
const app = await connectDesktop({endpoint:process.env.FREEBUFF_DEBUG_ENDPOINT});
const previous = await app.desktop.interfaceZoom();
let unsubscribe;
try {
  assert.equal(Object.keys(app.desktop).length, app.client.version === '0.0.201' ? 60 : 58);
  assert.equal(await app.desktop.appVersion(), app.client.version);
  const state = await app.desktop.windowState();
  assert.equal(typeof state.maximized, 'boolean');
  let receive;
  const event = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native zoom event timeout')), 5000);
    receive = value => {clearTimeout(timer); resolve(value);};
  });
  unsubscribe = await app.desktop.onInterfaceZoom(receive);
  const next = previous === 110 ? 100 : 110;
  await app.desktop.setInterfaceZoom(next);
  assert.equal(await event, next);
  assert.equal(await app.desktop.interfaceZoom(), next);
  await unsubscribe(); unsubscribe = null;
  assert.equal(typeof (await app.client.authStatus()).authed, 'boolean');
  const report = {status:'passed', target:'SDK-instrumented isolated Freebuff '+app.client.version+' copy', checks:['Version-specific native bridge constructed','native version and window-state reads','native zoom setting write and readback','native pushed event and unsubscribe','HTTP authentication through the trusted preload']};
  await writeFile(new URL('./evidence/native-validation.json',import.meta.url), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  if (unsubscribe) await unsubscribe();
  await app.desktop.setInterfaceZoom(previous);
  await app.close();
}
