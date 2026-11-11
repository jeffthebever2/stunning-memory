import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startFreebuff} from './server.js';
import {connectHostedWorkspace} from './hosted.js';
const app=await startFreebuff({version:'0.0.201'});
let cloud,task;
const checks=[];
try {
 cloud=await connectHostedWorkspace(app.client);
 const content='SDK_ATTACHMENT_'+crypto.randomUUID();
 const bytes=new TextEncoder().encode(content);
 const source=await cloud.uploadAttachment({name:'sdk-fixture.txt',mediaType:'text/plain',data:bytes});
 const downloaded=await cloud.readAttachment(source);
 assert.equal(await downloaded.text(),content);
 checks.push('Real binary attachment upload and exact download round-trip');
 const document=await cloud.convertDocument({name:'sdk-document.txt',mediaType:'text/plain',data:bytes});
 assert.equal(document.kind,'document');
 checks.push('Real document conversion and descriptor validation');
 task=await cloud.startTask({text:'Read the attached sdk-fixture.txt file and reply exactly with its contents. Do not edit files.',sources:[source]},{signal:AbortSignal.timeout(85000)});
 let final,sawStream=false;
 for await(const output of cloud.watchRun(task.runId,{signal:AbortSignal.timeout(120000)})) {
   final=output;if(output.transport==='stream')sawStream=true;
 }
 assert.equal(final.status,'completed');
 assert.ok(final.text.includes(content));
 checks.push('Real hosted task consumed uploaded file and returned its private random contents');
 if(sawStream)checks.push('Live SSE stream delivered run output through completion');
 else checks.push('Live run completed through polling fallback; SSE not established');
 const report={status:'passed',version:'0.0.201',checks,streamEstablished:sawStream};
 await writeFile(new URL('./evidence/attachments-validation.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally {
 if(cloud&&task){await cloud.cancelRun(task.runId).catch(()=>{});await cloud.endSession(task).catch(()=>{});}
 await app.stop();
}
