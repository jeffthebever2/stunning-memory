import assert from 'node:assert/strict';
import {startFreebuff} from './server.js';
import {writeFile} from 'node:fs/promises';
const app = await startFreebuff();
const checks=[];
try {
  const client=app.client;
  assert.equal(client.version,'0.0.201');
  assert.equal(Object.keys(client.operations).length,40);
  assert.equal(Object.keys(client.actions).length,0);
  assert.throws(()=>client.createThread({title:'unavailable'}),/unavailable in Freebuff 0.0.201/);
  checks.push('Version detection and removed local-task capability rejection');
  const auth=await client.authStatus();
  assert.equal(auth.authed,true,'Sign in to the SDK profile first');
  const session=await client.hostedWorkspace.postBootstrap({});
  assert.equal(typeof session.sessionToken,'string');
  assert.equal(typeof session.accountId,'string');
  checks.push('Signed-in hosted workspace bootstrap');
  const agents=await client.hostedWorkspace.postNativeAgents({accountId:session.accountId,operation:'status'});
  assert.ok(Array.isArray(agents.agents));
  checks.push('Native agent status through current hosted-control API');
  const status=await client.hostedWorkspace.getStatus();
  assert.equal(typeof status,'object');
  checks.push('Current hosted workspace status');
  const report={version:client.version,status:'passed',checks};
  await writeFile(new URL('./evidence/current-validation.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await app.stop();}
