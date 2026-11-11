import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedWorkspaceClient,WorkspaceFileError} from './hosted.js';
const make=fetch=>new HostedWorkspaceClient({origin:'https://freebuff.com',sessionToken:'fixture',accountId:'fixture',fetch});
test('file save requires revision and surfaces an HTTP-200 conflict envelope',async()=>{
 let requests=0;
 const c=make(async(url,init)=>{requests++;assert.equal(url.searchParams.get('path'),'file.txt');assert.deepEqual(JSON.parse(init.body),{content:'text',revision:'old'});return Response.json({ok:false,conflict:true,error:'changed'});});
 await assert.rejects(c.saveFile('workspace','file.txt','text',''),/revision/);
 await assert.rejects(c.saveFile('workspace','file.txt','text','old'),e=>e instanceof WorkspaceFileError&&e.conflict&&e.result.error==='changed');
 assert.equal(requests,1);
});
test('workspace entry creation, activity and downloads retain exact contracts',async()=>{
 const calls=[];const c=make(async(url,init)=>{calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),body:init.body&&JSON.parse(init.body)});return Response.json({ok:true});});
 await c.openWorkspace('workspace');await c.createFile('workspace','dir','directory');await c.downloadFile('workspace','dir/file.txt',{inline:true});
 assert.deepEqual(calls[0].query,{open:'1'});assert.deepEqual(calls[1].body,{path:'dir',kind:'directory'});assert.deepEqual(calls[2].query,{path:'dir/file.txt',inline:'1'});
});
test('device panel JSON encoding distinguishes uploads and rejects unknown panels',async()=>{
 const calls=[];const c=make(async(url,init)=>{calls.push({path:url.pathname,body:JSON.parse(init.body)});return Response.json({ok:true});});
 await c.devicePanel('git',{operation:'changes',projectId:'p',threadId:'t',scope:'all'});
 assert.equal(calls[0].path,'/api/workspace/cloud/device-execution/panels');
 assert.equal(JSON.parse(Buffer.from(calls[0].body.data,'base64').toString()).panel,'git');
 await c.devicePanel('files',{operation:'upload',projectId:'p',threadId:'t',path:'file',data:'YWJj'});
 assert.equal(calls[1].path,'/api/workspace/cloud/device-execution/file-upload');assert.equal(calls[1].body.panel,'files');
 assert.throws(()=>c.devicePanel('unknown',{}),/panel/);
});
test('stored file endpoints preserve project/chat scopes and binary response',async()=>{
 const c=make(async(url)=>{assert.equal(url.pathname,'/api/workspace/cloud/workspaces/chat/sources/file');return new Response('fixture');});
 assert.equal(await(await c.readStoredFile({kind:'chat',id:'chat'},'file')).text(),'fixture');
 assert.throws(()=>c.storedFilesPath({kind:'other',id:'id'}),/scope/);
});
