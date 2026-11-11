import test from 'node:test';
import assert from 'node:assert/strict';
import {connectDesktop} from './desktop.js';
import {launchDesktop} from './desktop-launcher.js';
test('desktop rejects remote, credential-bearing, and non-http endpoints before networking', async () => {
  for (const endpoint of ['https://127.0.0.1:9222','http://example.com:9222','http://user:password@127.0.0.1:9222','http://127.0.0.1']) await assert.rejects(connectDesktop({endpoint}), /loopback/);
});
test('instrumented native launch requires explicit opt-in', async () => {
  await assert.rejects(launchDesktop(), /instrument:true/);
});
