import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedWorkspaceClient} from './hosted.js';
const source={kind:'upload',id:'7cc00566-8d4d-44e4-950d-6c9df08555b5',name:'fixture.txt',mediaType:'text/plain',bytes:3,sha256:'a'.repeat(64)};
const make=fetch=>new HostedWorkspaceClient({origin:'https://freebuff.com',sessionToken:'fixture',accountId:'fixture',fetch});
test('attachment upload sends exact binary bytes with filename metadata',async()=>{
 const c=make(async(url,init)=>{
   assert.equal(url.pathname,'/api/workspace/cloud/attachments');assert.deepEqual([...init.body],[1,2,3]);
   assert.equal(init.headers.get('content-type'),'text/plain');assert.equal(init.headers.get('x-file-name'),'fixture.txt');
   return Response.json(source);
 });
 assert.deepEqual(await c.uploadAttachment({name:'fixture.txt',mediaType:'text/plain',data:new Uint8Array([1,2,3])}),source);
});
test('unsafe and oversized attachments are rejected before networking',async()=>{
 const c=make(()=>{throw Error('Unexpected network');});
 await assert.rejects(c.uploadAttachment({name:'../secret',data:new Uint8Array()}),/filename/);
 await assert.rejects(c.uploadAttachment({name:'file.bin',data:new Uint8Array(25*1024*1024+1)}),/25 MB/);
 await assert.rejects(c.startTask({text:'fixture',sources:Array(10).fill(source)}),/Too many/);
});
test('document conversion uses the recovered base64 envelope',async()=>{
 const document={kind:'document',id:'b'.repeat(64),name:'fixture.txt',mediaType:'text/plain',bytes:3,truncated:false};
 const c=make(async(url,init)=>{assert.equal(url.pathname,'/api/workspace/cloud/documents');assert.equal(JSON.parse(init.body).data,'YWJj');return Response.json(document);});
 assert.deepEqual(await c.convertDocument({name:'fixture.txt',mediaType:'text/plain',data:new TextEncoder().encode('abc')}),document);
});
test('task sources and documents are forwarded inside encoded run bodies',async()=>{
 const c=make(async(url,init)=>{
   if(url.pathname.endsWith('/models'))return Response.json({recommendedKey:'m',rows:[{key:'m',handle:'wire'}]});
   const body=JSON.parse(Buffer.from(JSON.parse(init.body).data,'base64').toString());assert.deepEqual(body.run.sources,[source]);return Response.json({kind:'submitted'});
 });
 await c.startTask({text:'fixture',sources:[source]});
});
