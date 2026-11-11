import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeHostedStream} from './hosted-stream.js';
import {HostedWorkspaceClient} from './hosted.js';
const make=fetch=>new HostedWorkspaceClient({origin:'https://freebuff.com',sessionToken:'fixture',accountId:'fixture',fetch});
const frame=(status,events)=>'data: '+JSON.stringify({v:1,status,events})+'\r\n\r\n';
test('SSE decoding preserves UTF-8 and CRLF split at every byte',async()=>{
 const bytes=new TextEncoder().encode(': ping\r\n\r\n'+frame('completed',[{id:'1',kind:'chunk',payload:'héllo 🌍'}]));
 let i=0;
 const response=new Response(new ReadableStream({pull(c){if(i===bytes.length)c.close();else c.enqueue(bytes.slice(i,++i));}}),{headers:{'content-type':'text/event-stream'}});
 const frames=[];for await(const value of decodeHostedStream(response))frames.push(value);
 assert.equal(frames[0].events[0].payload,'héllo 🌍');assert.equal(frames.length,1);
});
test('auto stream recovery resumes polling from last committed cursor without duplicates',async()=>{
 let cancelled=false,polled=false;
 const c=make(async url=>{
   if(url.pathname.endsWith('/stream'))return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frame('running',[{id:'1',kind:'chunk',payload:'Hello'}])+'data: invalid-json\n\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
   polled=true;assert.equal(url.searchParams.get('after'),'1');
   return Response.json({status:'completed',events:[{id:'1',kind:'chunk',payload:'Hello'},{id:'2',kind:'chunk',payload:' world'}]});
 });
 const result=await c.waitForRun('run',{pollInterval:0});
 assert.equal(result.text,'Hello world');assert.equal(result.transport,'poll');assert.ok(cancelled&&polled);
});
test('stream authentication failures do not fall back or retry',async()=>{
 let requests=0;const c=make(async()=>{requests++;return Response.json({error:'unauthorized'},{status:401});});
 await assert.rejects(c.waitForRun('run'),error=>error.status===401);assert.equal(requests,1);
});
test('idle stream is cancelled and resources released',async()=>{
 let cancelled=false;
 const r=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(async()=>{for await(const value of decodeHostedStream(r,{idleTimeout:10}))void value;},/idle timeout/);
 assert.ok(cancelled);
});
test('malformed preview is rejected and early exit unsubscribes',async()=>{
 const malformed=new Response('data: '+JSON.stringify({v:1,status:'running',events:[],preview:{base:1,attempt:'2',parts:[]}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(async()=>{for await(const value of decodeHostedStream(malformed))void value;},/preview/);
 let cancelled=false;
 const r=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame('running',[])));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 for await(const value of decodeHostedStream(r)){assert.equal(value.status,'running');break;}
 assert.ok(cancelled);
});
