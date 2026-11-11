import { FreebuffClient } from '../index.js';
import { startFreebuff } from '../server.js';
import { connectDesktop } from '../desktop.js';
import { launchDesktop } from '../desktop-launcher.js';
import {connectHostedWorkspace, HostedWorkspaceClient} from '../hosted.js';
void connectHostedWorkspace;
void HostedWorkspaceClient;
declare const hosted: HostedWorkspaceClient;
hosted.uploadAttachment({name:'fixture.txt',mediaType:'text/plain',data:new Uint8Array([1,2])});
hosted.watchRun('run',{transport:'auto',idleTimeout:10000});
hosted.listFiles('workspace',{directory:'src',query:'test'});
hosted.devicePanel('git',{projectId:'p',threadId:'t',operation:'changes',scope:'all'});
// @ts-expect-error revision required for a device save
hosted.devicePanel('files',{projectId:'p',threadId:'t',operation:'save',path:'file',content:'text'});
// @ts-expect-error invalid stream transport
hosted.watchRun('run',{transport:'other'});
// @ts-expect-error bytes must not be a string
hosted.uploadAttachment({name:'fixture.txt',data:'text'});
void connectDesktop;
void launchDesktop;
const client = new FreebuffClient({baseUrl: 'http://127.0.0.1:8787'});
client.operations['GET /api/thread/:id']({params: {id: 'thread'}});
client.operations['GET /api/projects']();
client.actions['cloud/handoff']('thread', {});
client.call('POST', '/api/thread/:id/*action', {params: {id: 'thread', action: 'rename'}, body: {title: 'new'}});
client.sendMessage('thread', 'hello', {attachments: ['C:/fixture.txt']});
void startFreebuff;
// @ts-expect-error route parameter is required
client.operations['GET /api/thread/:id']();
// @ts-expect-error parameter typo
client.operations['GET /api/thread/:id']({params: {thread: 'wrong'}});
// @ts-expect-error unknown action
client.actions['not-a-real-action']('thread');
// @ts-expect-error method and route combination does not exist
client.call('DELETE', '/api/threads');

