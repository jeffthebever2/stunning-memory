import {FreebuffError} from './index.js';
import {decodeHostedStream} from './hosted-stream.js';
import {validateAttachmentName,validateAttachmentSource,validateDocument,toBase64} from './attachments.js';
const origins = new Set(['https://staging-2-auth.freebuffweb.site','https://staging-auth.freebuff.com','https://freebuff.com']);
export class WorkspaceFileError extends Error {
  constructor(result){super(result.error??'Workspace file operation failed');this.name='WorkspaceFileError';this.result=result;this.conflict=result.conflict===true;}
}
export function decodeTerminalData(data) {
  if(typeof data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(data)||data.length%4)throw new TypeError('Terminal frame data must be base64');
  const bytes=typeof Buffer==='function'?Uint8Array.from(Buffer.from(data,'base64')):Uint8Array.from(atob(data),char=>char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
const part = value => {
  if(typeof value!=='string'||!value||value==='.'||value==='..')throw new TypeError('Nonempty resource id required');
  return encodeURIComponent(value);
};

export class HostedWorkspaceClient {
  #origin; #token; #fetch; #local;
  constructor({origin,sessionToken,accountId,fetch:fetchImpl=globalThis.fetch,localClient}) {
    const url=new URL(origin);
    if(!origins.has(url.origin)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new TypeError('Unrecognized shipped Freebuff workspace origin');
    if(typeof sessionToken!=='string'||!sessionToken||/[;\r\n]/.test(sessionToken))throw new TypeError('Invalid workspace session token');
    if(typeof accountId!=='string'||!accountId)throw new TypeError('Workspace account id required');
    this.#origin=url.origin;this.#token=sessionToken;this.#fetch=fetchImpl;this.accountId=accountId;this.#local=localClient;
  }
  async request(method,path,{body,query={},signal=AbortSignal.timeout(60000),raw=false,headers:extraHeaders={},encoded=false}={}) {
    if(!/^(GET|POST|PATCH|PUT|DELETE)$/.test(method)||!path.startsWith('/api/workspace/')||/[?#\\]/.test(path))throw new TypeError('Expected a workspace API method and path');
    const url=new URL(path,this.#origin);
    if(url.origin!==this.#origin||!url.pathname.startsWith('/api/workspace/'))throw new TypeError('Unsafe workspace path');
    for(const [key,value]of Object.entries(query))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
    const headers=new Headers(extraHeaders);
    for(const forbidden of ['cookie','authorization','host','origin'])if(headers.has(forbidden))throw new TypeError('Authentication headers are owned by the workspace client');
    headers.set('cookie','__Secure-next-auth.session-token='+this.#token);
    if(method!=='GET')headers.set('origin',this.#origin);
    let payload;
    if(body!==undefined) {
      if(body instanceof Blob||body instanceof Uint8Array||body instanceof ArrayBuffer) {
        if(encoded)throw new TypeError('Binary bodies cannot use the JSON envelope');
        payload=body;
        if(!headers.has('content-type'))headers.set('content-type',body.type||'application/octet-stream');
      }else {
      headers.set('content-type','application/json');
      payload=JSON.stringify(body);
      if(encoded) {
        payload=JSON.stringify({encoding:'base64',data:toBase64(new TextEncoder().encode(payload))});
        headers.set('x-freebuff-body-encoding','base64');
      }
      }
    }
    const response=await this.#fetch(url,{method,headers,body:payload,signal,redirect:'error',cache:'no-store'});
    if(!response.ok) {
      const data=await response.json().catch(()=>null);
      throw new FreebuffError(response.status,data);
    }
    return raw?response:response.json();
  }
  async verify(options) {
    const auth=await this.request('GET','/api/workspace/auth',options);
    if(auth?.user?.id!==this.accountId||auth.user.banned)throw new Error('Workspace identity changed or account access is unavailable');
    return true;
  }
  models(options) {return this.request('GET','/api/workspace/models',options);}
  async startTask({text,model,workspaceId=crypto.randomUUID(),runId=crypto.randomUUID(),instanceId=crypto.randomUUID(),projectId,mode='build',effort,walletLimit=0,sources=[],documents=[],images=[]},options={}) {
    if(typeof text!=='string'||!text.trim())throw new TypeError('Task text required');
    if(!['build','plan','mission'].includes(mode))throw new TypeError('Invalid agent mode');
    if(typeof walletLimit!=='number'||!Number.isFinite(walletLimit)||walletLimit<0)throw new TypeError('Invalid wallet limit');
    if(!Array.isArray(sources)||!Array.isArray(documents)||!Array.isArray(images)||sources.length+documents.length+images.length>9||documents.length>5||images.length>8)throw new TypeError('Too many task attachments');
    sources.forEach(validateAttachmentSource);documents.forEach(validateDocument);
    let imageBytes=0;
    for(const image of images) {
      if(!image||typeof image.data!=='string'||!image.data||image.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)||!['image/png','image/jpeg','image/webp'].includes(image.mediaType)||typeof image.name!=='string'||image.name.length>200)throw new TypeError('Invalid inline image');
      imageBytes+=image.data.length/4*3;
    }
    if(imageBytes>2000000)throw new TypeError('Inline images exceed 2 MB');
    const catalog=await this.models(options);
    const row=catalog.rows.find(r=>r.key===(model??catalog.recommendedKey));
    if(!row)throw new Error('Model is no longer in the current catalog; choose a listed key');
    const run={workspaceId,runId,instanceId,prompt:text,model:row.handle,agentMode:mode==='mission'?'build':mode,injectAgentsMd:true,...projectId?{projectId}:{},...effort?{effort}:{},...sources.length?{sources}:{},...documents.length?{documents}:{},...images.length?{images}:{},...mode==='mission'?{mission:{prompt:text.trim()}}:{}};
    const admission=await this.send(run,{wire:row.handle,model:row.key,attemptId:runId,walletLimit,catalog:true},options);
    const task={workspaceId,runId,instanceId,model:row.key,projectId,mode,effort,admission};
    if(admission.kind==='refused') {
      const error=new Error('Freebuff session admission refused: '+admission.admission?.status);
      error.task=task;
      throw error;
    }
    return task;
  }
  async *streamRun(id,{signal,after='0',idleTimeout=30000}={}) {
    const controller=new AbortController();
    const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[]),AbortSignal.timeout(150000)]);
    try {
      const response=await this.request('GET','/api/workspace/cloud/runs/'+part(id)+'/stream',{signal:combined,query:{after},raw:true});
      yield* decodeHostedStream(response,{signal:combined,idleTimeout});
    }finally{controller.abort();}
  }
  async *watchRun(id,{signal,pollInterval=1000,transport='auto',idleTimeout=30000}={}) {
    if(!Number.isFinite(pollInterval)||pollInterval<0)throw new TypeError('Invalid poll interval');
    if(!['auto','poll','stream'].includes(transport))throw new TypeError('Invalid run transport');
    let after='0';
    const events=[],seen=new Set();
    const merge=(batch,source)=>{
      if(!batch||typeof batch.status!=='string'||!Array.isArray(batch.events))throw new Error('Invalid hosted event batch');
      for(const event of batch.events??[]) {
        const key=String(event.id);
        if(typeof event.id!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(key))throw new Error('Unexpected hosted event cursor');
        if(!seen.has(key)){seen.add(key);events.push(event);}
        if(BigInt(key)>BigInt(after))after=key;
      }
      return {runId:id,...hostedOutput({...batch,events:[...events]}),lastEventId:after,transport:source};
    };
    let retryStreamAt=0;
    while(true) {
      signal?.throwIfAborted();
      if(transport!=='poll'&&Date.now()>=retryStreamAt) {
        try {
          for await(const batch of this.streamRun(id,{signal,after,idleTimeout})) {
            yield merge(batch,'stream');
            if(['completed','failed','cancelled'].includes(batch.status)&&batch.events.length<500)return;
          }
          if(transport==='stream')throw new Error('Hosted stream ended before completion');
        }catch(error) {
          signal?.throwIfAborted();
          if(transport==='stream'||error instanceof FreebuffError&&[401,403].includes(error.status))throw error;
        }
        retryStreamAt=Date.now()+30000;
      }
      const batch=await this.getRun(id,{signal,query:{after}});
      yield merge(batch,'poll');
      if(['completed','failed','cancelled'].includes(batch.status)&&(batch.events?.length??0)<500)return;
      if((batch.events?.length??0)>=500)continue;
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(signal.reason);};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},pollInterval);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
      });
    }
  }
  async waitForRun(id,{signal=AbortSignal.timeout(300000),...options}={}) {
    let final;
    for await(const output of this.watchRun(id,{...options,signal}))final=output;
    return final;
  }
  endSession(task,options={}) {return this.request('DELETE','/api/workspace/session',{...options,headers:{'x-freebuff-instance-id':task.instanceId}});}
  async sendMessage(task,text,{model=task.model,walletLimit=0,sources,documents,images,...options}={}) {
    let instanceId=task.instanceId;
    if(model!==task.model) {
      const catalog=await this.models(options);
      if(!catalog.rows.some(row=>row.key===model))throw new Error('Model is no longer in the current catalog');
      const current=await this.getRun(task.runId,options);
      if(!['completed','failed','cancelled'].includes(current.status))throw new Error('Wait for the current run to settle before switching models');
      const ended=await this.endSession(task,options);
      if(ended.status!=='ended')throw new Error('Previous model session was not released; no message was sent');
      instanceId=crypto.randomUUID();
    }
    return this.startTask({text,model,walletLimit,sources,documents,images,workspaceId:task.workspaceId,instanceId,projectId:task.projectId,mode:task.mode,effort:task.effort},options);
  }
  async uploadAttachment({name,mediaType='application/octet-stream',data},options={}) {
    validateAttachmentName(name);
    if(!(data instanceof Blob)&&!(data instanceof Uint8Array)&&!(data instanceof ArrayBuffer))throw new TypeError('Attachment data must be bytes or a Blob');
    if((data.size??data.byteLength)>25*1024*1024)throw new TypeError('Attachments exceed 25 MB');
    if(typeof mediaType!=='string'||mediaType.length>120||!/^[\w.+-]+\/[\w.+-]+$/.test(mediaType))throw new TypeError('Invalid attachment media type');
    return validateAttachmentSource(await this.request('POST','/api/workspace/cloud/attachments',{...options,body:data,headers:{'content-type':mediaType,'x-file-name':encodeURIComponent(name)}}));
  }
  readAttachment(source,options={}) {validateAttachmentSource(source);return this.request('POST','/api/workspace/cloud/attachments/read',{...options,body:source,raw:true});}
  async convertDocument({name,mediaType,data},options={}) {
    validateAttachmentName(name);
    if(!(data instanceof Blob)&&!(data instanceof Uint8Array)&&!(data instanceof ArrayBuffer))throw new TypeError('Document data must be bytes or a Blob');
    if((data.size??data.byteLength)>5*1024*1024)throw new TypeError('Document input exceeds 5 MB');
    if(typeof mediaType!=='string'||!mediaType||mediaType.length>255)throw new TypeError('Invalid document media type');
    const bytes=data instanceof Blob?new Uint8Array(await data.arrayBuffer()):data instanceof ArrayBuffer?new Uint8Array(data):data;
    return validateDocument(await this.request('POST','/api/workspace/cloud/documents',{...options,body:{encoding:'base64',name,mediaType,data:toBase64(bytes)}}));
  }
  listProjects(options) {return this.request('GET','/api/workspace/cloud/history/projects',options);}
  getProject(id,options) {return this.request('GET','/api/workspace/cloud/history/projects/'+part(id),options);}
  updateProject(id,body,options={}) {return this.request('PATCH','/api/workspace/cloud/history/projects/'+part(id),{...options,body});}
  listChats(options) {return this.request('GET','/api/workspace/cloud/history/chats',options);}
  getChat(id,options) {return this.request('GET','/api/workspace/cloud/history/chats/'+part(id),options);}
  updateChat(id,body,options={}) {return this.request('PATCH','/api/workspace/cloud/history/chats/'+part(id),{...options,body});}
  forkChat(id,body,options={}) {return this.request('POST','/api/workspace/cloud/history/chats/'+part(id)+'/fork',{...options,body});}
  rollbackChat(id,body,options={}) {return this.request('POST','/api/workspace/cloud/history/chats/'+part(id)+'/rollback',{...options,body});}
  listRuns(chatId,options) {return this.request('GET','/api/workspace/cloud/history/chats/'+part(chatId)+'/runs',options);}
  getRun(id,options) {return this.request('GET','/api/workspace/cloud/runs/'+part(id),options);}
  listEvents(id,options) {return this.request('GET','/api/workspace/cloud/history/runs/'+part(id)+'/events',options);}
  listTraces(id,options) {return this.request('GET','/api/workspace/cloud/history/runs/'+part(id)+'/traces',options);}
  send(run,admission,options={}) {return this.request('POST','/api/workspace/cloud/sends',{...options,signal:options.signal??AbortSignal.timeout(85000),headers:{...options.headers,'x-freebuff-cloud-questions':'1'},encoded:true,body:{run,...admission?{admission}:{}}});}
  cancelRun(id,options={}) {return this.request('POST','/api/workspace/cloud/runs/'+part(id)+'/cancel',{...options,body:{}});}
  readFile(workspaceId,path,options={}) {return this.request('GET',`/api/workspace/cloud/workspaces/${part(workspaceId)}/file`,{...options,query:{...options.query,path}});}
  async saveFile(workspaceId,path,content,revision,options={}) {
    if(typeof content!=='string'||typeof revision!=='string'||!revision)throw new TypeError('File content and the revision from readFile are required');
    const result=await this.request('PUT',`/api/workspace/cloud/workspaces/${part(workspaceId)}/file`,{...options,query:{path},body:{content,revision}});
    if(result?.ok===false)throw new WorkspaceFileError(result);
    return result;
  }
  openWorkspace(workspaceId,options={}) {return this.request('POST',`/api/workspace/cloud/workspaces/${part(workspaceId)}/activity`,{...options,query:{open:'1'}});}
  touchWorkspace(workspaceId,generation,options={}) {return this.request('POST',`/api/workspace/cloud/workspaces/${part(workspaceId)}/activity`,{...options,query:{generation}});}
  async listFiles(workspaceId,{directory='',query,...options}={}) {return (await this.request('GET',`/api/workspace/cloud/workspaces/${part(workspaceId)}/files`,{...options,query:{directory,query}})).files;}
  createFile(workspaceId,path,kind='file',options={}) {
    if(!['file','directory'].includes(kind))throw new TypeError('Invalid file entry kind');
    return this.request('POST',`/api/workspace/cloud/workspaces/${part(workspaceId)}/files`,{...options,body:{path,kind}});
  }
  uploadFile(workspaceId,path,data,options={}) {
    if(!(data instanceof Uint8Array)||data.byteLength>16*1024*1024)throw new TypeError('Workspace upload requires bytes no larger than 16 MiB');
    return this.request('POST',`/api/workspace/cloud/workspaces/${part(workspaceId)}/files`,{...options,signal:options.signal??AbortSignal.timeout(300000),body:{path,kind:'file',data:toBase64(data)}});
  }
  downloadFile(workspaceId,path,{inline=false,...options}={}) {return this.request('GET',`/api/workspace/cloud/workspaces/${part(workspaceId)}/download`,{...options,query:{path,...inline?{inline:'1'}:{}},raw:true});}
  listRemoteDevices(projectId,options) {return this.request('GET',`/api/workspace/cloud/projects/${part(projectId)}/remote-devices`,options);}
  async connectLocalProject(projectPath,options={}) {
    if(!this.#local)throw new Error('Connect through the local SDK server to register a local folder');
    if(typeof projectPath!=='string'||!projectPath)throw new TypeError('Local project path required');
    return this.#local.hostedWorkspace.postEnroll({accountId:this.accountId,projectPath},options);
  }
  localControl(operation,input={},options={}) {
    if(!this.#local)throw new Error('Local SDK server connection required');
    const allowed=['postPrepareChat','postRuntime','postTerminal','postFiles','postGit','postBrowser','postDisconnect','postNativeAgents'];
    if(!allowed.includes(operation))throw new TypeError('Unknown local control operation');
    return this.#local.hostedWorkspace[operation]({...input,accountId:this.accountId},options);
  }
  nativeAgents(operation='status',harness,options={}) {
    if(!['status','recheck','install'].includes(operation))throw new TypeError('Invalid native-agent operation');
    if(harness!==undefined&&!['claude-code','codex'].includes(harness))throw new TypeError('Invalid native-agent harness');
    if(operation==='install'&&!harness)throw new TypeError('Native-agent install requires a harness');
    return this.localControl('postNativeAgents',{operation,...harness?{harness}:{}},options);
  }
  async openDeviceTerminal(scope,sessionId,{attach={},...requestOptions}={}) {
    if(!scope||typeof scope.projectId!=='string'||typeof scope.threadId!=='string')throw new TypeError('Device scope required');
    if(typeof sessionId!=='string'||!sessionId)throw new TypeError('Terminal session id required');
    const result=await this.localControl('postTerminal',{...scope,sessionId,operation:'attach',...attach},requestOptions);
    return new HostedTerminalSession(this,scope,sessionId,result);
  }
  prepareDeviceChat(input,options={}) {return this.request('POST','/api/workspace/cloud/device-execution/prepare-chat',{...options,encoded:true,body:input});}
  devicePanel(panel,input,options={}) {
    if(!['files','git','terminal'].includes(panel))throw new TypeError('Invalid device panel');
    const upload=panel==='files'&&input?.operation==='upload';
    return this.request('POST','/api/workspace/cloud/device-execution/'+(upload?'file-upload':'panels'),{...options,encoded:!upload,body:{panel,input}});
  }
  storedFilesPath(scope) {
    if(!['project','chat'].includes(scope?.kind))throw new TypeError('Invalid stored file scope');
    return scope.kind==='project'?`/api/workspace/cloud/projects/${part(scope.id)}/files`:`/api/workspace/cloud/workspaces/${part(scope.id)}/sources`;
  }
  async listStoredFiles(scope,options) {return (await this.request('GET',this.storedFilesPath(scope),options)).files;}
  async uploadStoredFile(scope,{name,mediaType='application/octet-stream',data},options={}) {
    validateAttachmentName(name);
    if(!(data instanceof Blob)&&!(data instanceof Uint8Array)&&!(data instanceof ArrayBuffer))throw new TypeError('Stored upload requires binary data');
    if((data.size??data.byteLength)>25*1024*1024)throw new TypeError('Stored upload exceeds 25 MiB');
    if(typeof mediaType!=='string'||mediaType.length>120||!/^[\w.+-]+\/[\w.+-]+$/.test(mediaType))throw new TypeError('Invalid attachment media type');
    const uploaded=await this.request('POST',this.storedFilesPath(scope),{...options,signal:options.signal??AbortSignal.timeout(300000),headers:{'content-type':mediaType,'x-file-name':encodeURIComponent(name)},body:data});
    return validateAttachmentSource({...uploaded,kind:'stored',scope});
  }
  readStoredFile(scope,id,options={}) {return this.request('GET',this.storedFilesPath(scope)+'/'+part(id),{...options,raw:true});}
}

export class HostedTerminalSession {
  #client; #scope; #sessionId; #viewerId; #generation;
  constructor(client,scope,sessionId,attached={}) {
    this.#client=client;this.#scope=scope;this.#sessionId=sessionId;this.#viewerId=attached.viewerId;
    this.#generation=attached.generation??attached.frames?.find(frame=>typeof frame.generation==='string')?.generation;
    this.initial=attached;
  }
  get viewerId(){return this.#viewerId}
  get generation(){return this.#generation}
  async read(options={}) {const result=await this.#client.localControl('postTerminal',{...this.#scope,sessionId:this.#sessionId,operation:'read',viewerId:this.#viewerId},options);this.#generation=result.generation??this.#generation;return result}
  async readText(options={}) {
    const result=await this.read(options);
    return (result.frames??[]).filter(frame=>frame.type==='data').map(frame=>decodeTerminalData(frame.data)).join('');
  }
  input(data,options={}) {
    if(typeof data!=='string'||!data)throw new TypeError('Terminal input required');
    return this.#client.localControl('postTerminal',{...this.#scope,sessionId:this.#sessionId,operation:'input',viewerId:this.#viewerId,generation:this.#generation,data},options);
  }
  resize(cols,rows,options={}) {
    if(!Number.isInteger(cols)||!Number.isInteger(rows))throw new TypeError('Terminal dimensions must be integers');
    return this.#client.localControl('postTerminal',{...this.#scope,sessionId:this.#sessionId,operation:'resize',viewerId:this.#viewerId,generation:this.#generation,cols,rows},options);
  }
  detach(options={}) {return this.#client.localControl('postTerminal',{...this.#scope,sessionId:this.#sessionId,operation:'detach',viewerId:this.#viewerId},options)}
  close(options={}) {return this.#client.localControl('postTerminal',{...this.#scope,sessionId:this.#sessionId,operation:'close'},options)}
}

export function hostedOutput(snapshot) {
  const events=snapshot.events??[];
  let checklist=null;
  for(const event of events) {
    const p=event.payload;
    if(event.kind!=='event'||p?.type!=='tool_call'||!['write_todos','TodoWrite'].includes(p.toolName)||!Array.isArray(p.input?.todos))continue;
    checklist=p.input.todos.flatMap(item=>{
      const text=typeof item?.task==='string'?item.task:typeof item?.content==='string'?item.content:'';
      return text.trim()?[{text:text.trim(),state:item.completed===true||item.status==='completed'?'done':item.status==='in_progress'?'active':'pending'}]:[];
    }).slice(0,50);
  }
  return {...snapshot,text:events.filter(e=>e.kind==='chunk'&&typeof e.payload==='string').map(e=>e.payload).join(''),metrics:events.filter(e=>e.kind==='metrics').at(-1)?.payload??null,tools:events.filter(e=>e.kind==='event'&&/tool/i.test(e.payload?.type??'')),checklist};
}

export async function connectHostedWorkspace(localClient,options={}) {
  const bootstrap=await localClient.hostedWorkspace.postBootstrap({},options);
  const client=new HostedWorkspaceClient({origin:bootstrap.url,sessionToken:bootstrap.sessionToken,accountId:bootstrap.accountId,localClient});
  await client.verify(options);
  return client;
}
