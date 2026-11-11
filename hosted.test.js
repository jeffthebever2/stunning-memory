import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedWorkspaceClient,HostedTerminalSession,decodeTerminalData,hostedOutput} from './hosted.js';
const client = fetch => new HostedWorkspaceClient({origin:'https://freebuff.com',sessionToken:'test-session',accountId:'test-account',fetch});
test('hosted requests confine cookies and disallow redirects and header overrides',async()=>{
  const c=client(async(url,init)=>{
    assert.equal(url.origin,'https://freebuff.com');
    assert.equal(init.headers.get('cookie'),'__Secure-next-auth.session-token=test-session');
    assert.equal(init.redirect,'error');
    return Response.json({user:{id:'test-account'}});
  });
  assert.equal(await c.verify(),true);
  await assert.rejects(c.request('GET','/api/workspace/../../outside'),/Unsafe/);
  await assert.rejects(c.request('GET','/api/workspace/auth',{headers:{cookie:'other'}}),/owned/);
  assert.throws(()=>new HostedWorkspaceClient({origin:'https://example.com',sessionToken:'secret',accountId:'id'}),/Unrecognized/);
});
test('hosted task wire body preserves Unicode and zero-spend admission',async()=>{
  let requests=0;
  const c=client(async(url,init)=>{
    if(url.pathname.endsWith('/models'))return Response.json({recommendedKey:'model',rows:[{key:'model',handle:'wire-model'}]});
    requests++;
    assert.equal(init.headers.get('origin'),'https://freebuff.com');
    const body=JSON.parse(init.body);
    const decoded=JSON.parse(Buffer.from(body.data,'base64').toString('utf8'));
    assert.equal(decoded.run.prompt,'Hello 🌍');
    assert.equal(decoded.run.model,'wire-model');
    assert.equal(decoded.admission.walletLimit,0);
    return Response.json({kind:'submitted'});
  });
  const task=await c.startTask({text:'Hello 🌍'});
  assert.equal(task.model,'model');assert.equal(requests,1);
});
test('session refusal is preserved without retry or additional spending',async()=>{
  let sends=0;
  const c=client(async url=>url.pathname.endsWith('/models')?Response.json({recommendedKey:'m',rows:[{key:'m',handle:'wire'}]}):(sends++,Response.json({kind:'refused',admission:{status:'consent_required'}})));
  await assert.rejects(c.startTask({text:'fixture'}),error=>error.task.admission.admission.status==='consent_required');
  assert.equal(sends,1);
});
test('hosted run watching deduplicates cursors and preserves actual completion/errors',async()=>{
  let count=0;
  const c=client(async url=>{
    const after=url.searchParams.get('after');
    count++;
    if(count===1){assert.equal(after,'0');return Response.json({status:'running',events:[{id:'9007199254740993',kind:'chunk',payload:'Hello'}]});}
    assert.equal(after,'9007199254740993');
    return Response.json({status:'failed',error:'fixture failure',events:[{id:'9007199254740993',kind:'chunk',payload:'Hello'},{id:'9007199254740994',kind:'chunk',payload:' world'}]});
  });
  const result=await c.waitForRun('run',{pollInterval:0,transport:'poll'});
  assert.equal(result.status,'failed');assert.equal(result.error,'fixture failure');assert.equal(result.text,'Hello world');
});
test('hosted output retains tool events and todo state',()=>{
  const output=hostedOutput({events:[{kind:'event',payload:{type:'tool_call',toolName:'write_todos',input:{todos:[{task:'Verify',status:'in_progress'}]}}},{kind:'metrics',payload:{costUsd:0}}]});
  assert.deepEqual(output.checklist,[{text:'Verify',state:'active'}]);assert.equal(output.tools.length,1);assert.equal(output.metrics.costUsd,0);
});
test('device terminal tracks generation and captures output text',async()=>{
  const calls=[];
  const c=new HostedWorkspaceClient({origin:'https://freebuff.com',sessionToken:'test-session',accountId:'test-account',fetch:async()=>Response.json({}),localClient:{hostedWorkspace:{postTerminal:async body=>{calls.push(body);if(body.operation==='attach')return {viewerId:'viewer',frames:[{type:'ready',generation:'generation'}]};if(body.operation==='read')return {frames:[{type:'data',data:Buffer.from('SDK_MARKER').toString('base64')}]};return {ok:true};}}}});
  const terminal=await c.openDeviceTerminal({projectId:'project',threadId:'thread'},'session');
  assert.ok(terminal instanceof HostedTerminalSession);
  await terminal.input('echo SDK_MARKER\\n');
  assert.equal(await terminal.readText(),'SDK_MARKER');
  await terminal.resize(80,24);await terminal.detach();await terminal.close();
  assert.equal(calls.at(-1).operation,'close');
  assert.equal(decodeTerminalData(Buffer.from('hello').toString('base64')),'hello');
});
test('native-agent controls validate the shipped harness contract',async()=>{
  const calls=[];
  const c=new HostedWorkspaceClient({origin:'https://freebuff.com',sessionToken:'test-session',accountId:'test-account',fetch:async()=>Response.json({}),localClient:{hostedWorkspace:{postNativeAgents:async body=>(calls.push(body),{agents:[]})}}});
  await c.nativeAgents('status');
  await c.nativeAgents('install','codex');
  assert.deepEqual(calls.map(call=>call.operation),['status','install']);
  assert.equal(calls[1].harness,'codex');
  assert.throws(()=>c.nativeAgents('install'),/requires/);
});
