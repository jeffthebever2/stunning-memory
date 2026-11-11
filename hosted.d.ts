import {RequestOptions} from './index.js';
export interface HostedOptions extends Omit<RequestOptions,'params'> {headers?: Record<string,string>; encoded?: boolean}
export interface HostedTask {workspaceId:string;runId:string;instanceId:string;model:string;projectId?:string;mode?:'build'|'plan'|'mission';effort?:string;admission:unknown}
export interface HostedEvent {id:string;kind:string;payload:unknown}
export interface HostedRunSnapshot {status:string;error?:unknown;events:HostedEvent[];questions?:unknown[]}
export interface HostedRunOutput extends HostedRunSnapshot {runId?:string;text:string;tools:HostedEvent[];metrics:unknown;checklist:Array<{text:string;state:string}>|null;lastEventId?:string;transport?:'stream'|'poll';preview?:HostedPreview}
export interface HostedPreview {base:string;attempt:string;parts:Array<{kind:'text'|'reasoning';text:string}>}
export interface HostedStreamFrame extends HostedRunSnapshot {v:1;preview?:HostedPreview}
export interface AttachmentSource {kind:'upload'|'stored';id:string;name:string;mediaType:string;bytes:number;sha256?:string;scope?:{kind:'project'|'chat';id:string}}
export interface HostedDocument {kind:'document';id:string;name:string;mediaType:'text/plain';bytes:number;truncated:boolean}
export interface InlineImage {data:string;mediaType:'image/png'|'image/jpeg'|'image/webp';name:string}
export interface HostedWatchOptions {signal?:AbortSignal;pollInterval?:number;transport?:'auto'|'poll'|'stream';idleTimeout?:number}
export interface HostedTaskInput {text:string;model?:string;workspaceId?:string;runId?:string;instanceId?:string;projectId?:string;mode?:'build'|'plan'|'mission';effort?:string;walletLimit?:number;sources?:AttachmentSource[];documents?:HostedDocument[];images?:InlineImage[]}
export type NativeAgentOperation = 'status'|'recheck'|'install';
export interface DeviceScope {projectId:string;threadId:string}
export type DeviceFileOperation = DeviceScope & (
 {operation:'list';directory?:string;query?:string} | {operation:'read';path:string;expanded:boolean} |
 {operation:'save';path:string;content:string;revision:string} | {operation:'create';path:string;kind:'file'|'directory'} |
 {operation:'upload';path:string;data:string} | {operation:'download';path:string;offset:number});
export type DeviceGitOperation = DeviceScope & ({operation:'changes';scope:'all'|'uncommitted'} | {operation:'diff';scope:'all'|'uncommitted';path:string;untracked:boolean});
export type DeviceTerminalOperation = DeviceScope & {sessionId:string} & (
 {operation:'attach';cols?:number;rows?:number;resumeGeneration?:string} | {operation:'read'|'detach';viewerId:string} |
 {operation:'input';viewerId:string;generation:string;data:string} | {operation:'resize';viewerId:string;generation:string;cols:number;rows:number} | {operation:'close'});
export function decodeTerminalData(data:string):string;
export class WorkspaceFileError extends Error {result:Record<string,unknown>;conflict:boolean;constructor(result:Record<string,unknown>)}
export class HostedWorkspaceClient {
  readonly accountId:string;
  constructor(options:{origin:string;sessionToken:string;accountId:string;fetch?:typeof fetch});
  request(method:string,path:string,options:HostedOptions&{raw:true}):Promise<Response>;
  request(method:string,path:string,options?:HostedOptions):Promise<unknown>;
  verify(options?:HostedOptions):Promise<true>;
  models(options?:HostedOptions):Promise<{recommendedKey:string;rows:Array<{key:string;handle:string;displayName:string;[key:string]:unknown}>;[key:string]:unknown}>;
  listProjects(options?:HostedOptions):Promise<unknown>;
  getProject(id:string,options?:HostedOptions):Promise<unknown>;
  updateProject(id:string,body:unknown,options?:HostedOptions):Promise<unknown>;
  listChats(options?:HostedOptions):Promise<unknown>;
  getChat(id:string,options?:HostedOptions):Promise<unknown>;
  updateChat(id:string,body:unknown,options?:HostedOptions):Promise<unknown>;
  forkChat(id:string,body:unknown,options?:HostedOptions):Promise<unknown>;
  rollbackChat(id:string,body:unknown,options?:HostedOptions):Promise<unknown>;
  listRuns(chatId:string,options?:HostedOptions):Promise<unknown>;
  getRun(id:string,options?:HostedOptions):Promise<HostedRunSnapshot>;
  listEvents(id:string,options?:HostedOptions):Promise<unknown>;
  listTraces(id:string,options?:HostedOptions):Promise<unknown>;
  send(run:unknown,admission?:unknown,options?:HostedOptions):Promise<unknown>;
  cancelRun(id:string,options?:HostedOptions):Promise<unknown>;
  endSession(task:HostedTask,options?:HostedOptions):Promise<unknown>;
  startTask(task:HostedTaskInput,options?:HostedOptions):Promise<HostedTask>;
  sendMessage(task:HostedTask,text:string,options?:HostedOptions&{model?:string;walletLimit?:number;sources?:AttachmentSource[];documents?:HostedDocument[];images?:InlineImage[]}):Promise<HostedTask>;
  streamRun(id:string,options?:{signal?:AbortSignal;after?:string;idleTimeout?:number}):AsyncGenerator<HostedStreamFrame>;
  watchRun(id:string,options?:HostedWatchOptions):AsyncGenerator<HostedRunOutput>;
  waitForRun(id:string,options?:HostedWatchOptions):Promise<HostedRunOutput>;
  uploadAttachment(file:{name:string;mediaType?:string;data:Blob|Uint8Array|ArrayBuffer},options?:HostedOptions):Promise<AttachmentSource>;
  readAttachment(source:AttachmentSource,options?:HostedOptions):Promise<Response>;
  convertDocument(file:{name:string;mediaType:string;data:Blob|Uint8Array|ArrayBuffer},options?:HostedOptions):Promise<HostedDocument>;
  readFile(workspaceId:string,path:string,options?:HostedOptions):Promise<unknown>;
  saveFile(workspaceId:string,path:string,content:string,revision:string,options?:HostedOptions):Promise<unknown>;
  openWorkspace(workspaceId:string,options?:HostedOptions):Promise<unknown>;
  touchWorkspace(workspaceId:string,generation:string,options?:HostedOptions):Promise<unknown>;
  listFiles(workspaceId:string,options?:Omit<HostedOptions,'query'>&{directory?:string;query?:string}):Promise<unknown[]>;
  createFile(workspaceId:string,path:string,kind?:'file'|'directory',options?:HostedOptions):Promise<unknown>;
  uploadFile(workspaceId:string,path:string,data:Uint8Array,options?:HostedOptions):Promise<unknown>;
  downloadFile(workspaceId:string,path:string,options?:HostedOptions&{inline?:boolean}):Promise<Response>;
  listRemoteDevices(projectId:string,options?:HostedOptions):Promise<unknown>;
  prepareDeviceChat(input:DeviceScope,options?:HostedOptions):Promise<unknown>;
  openDeviceTerminal(scope:DeviceScope,sessionId:string,options?:HostedOptions&{attach?:{cols?:number;rows?:number;resumeGeneration?:string}}):Promise<HostedTerminalSession>;
  nativeAgents(operation?:NativeAgentOperation,harness?:'claude-code'|'codex',options?:HostedOptions):Promise<unknown>;
  devicePanel(panel:'files',input:DeviceFileOperation,options?:HostedOptions):Promise<unknown>;
  devicePanel(panel:'git',input:DeviceGitOperation,options?:HostedOptions):Promise<unknown>;
  devicePanel(panel:'terminal',input:DeviceTerminalOperation,options?:HostedOptions):Promise<unknown>;
  storedFilesPath(scope:{kind:'project'|'chat';id:string}):string;
  listStoredFiles(scope:{kind:'project'|'chat';id:string},options?:HostedOptions):Promise<unknown[]>;
  uploadStoredFile(scope:{kind:'project'|'chat';id:string},file:{name:string;mediaType?:string;data:Uint8Array|Blob|ArrayBuffer},options?:HostedOptions):Promise<AttachmentSource>;
  readStoredFile(scope:{kind:'project'|'chat';id:string},id:string,options?:HostedOptions):Promise<Response>;
}
export class HostedTerminalSession {
  readonly initial:unknown;
  readonly viewerId:string;
  readonly generation:string;
  read(options?:HostedOptions):Promise<unknown>;
  readText(options?:HostedOptions):Promise<string>;
  input(data:string,options?:HostedOptions):Promise<unknown>;
  resize(cols:number,rows:number,options?:HostedOptions):Promise<unknown>;
  detach(options?:HostedOptions):Promise<unknown>;
  close(options?:HostedOptions):Promise<unknown>;
}
export function hostedOutput(snapshot:HostedRunSnapshot):HostedRunOutput;
export function connectHostedWorkspace(localClient:import('./index.js').FreebuffClient,options?:HostedOptions):Promise<HostedWorkspaceClient>;
