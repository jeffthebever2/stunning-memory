#!/usr/bin/env node
import { startFreebuff } from './server.js';
import {connectHostedWorkspace} from './hosted.js';

const [command, ...args] = process.argv.slice(2);
if (!['models', 'projects', 'task', 'watch', 'switch', 'login', 'call', 'action'].includes(command)) {
  console.error('Usage: freebuff-sdk models PROJECT | projects | task PROJECT HARNESS MODEL PROMPT | watch THREAD | switch THREAD HARNESS MODEL | login | call METHOD PATTERN OPTIONS_JSON | action THREAD ACTION BODY_JSON');
  process.exit(1);
}
const server = await startFreebuff();
const client = server.client;
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
const print = value => console.log(JSON.stringify(value, null, 2));
try {
  const cloud=client.version==='0.0.201'&&['models','projects','task','watch','switch'].includes(command)?await connectHostedWorkspace(client):null;
  if (command === 'models') print(cloud?await cloud.models():await client.listModels(args[0]));
  if (command === 'projects') print(cloud?await cloud.listProjects():await client.listProjects());
  if (command === 'switch'&&cloud) throw new Error('For hosted chats, send the next message with HostedWorkspaceClient.sendMessage(task,text,{model}); the model session changes with that send.');
  if (command === 'switch') print(await client.switchModel(args[0], { harnessId: args[1], model: args[2] }));
  if (command === 'call') print(await client.call(args[0], args[1], JSON.parse(args[2] ?? '{}')));
  if (command === 'action') print(await client.threadAction(args[0], args[1], JSON.parse(args[2] ?? '{}')));
  if (command === 'login') {
    if ((await client.authStatus()).authed) print({ signedIn: true });
    else {
      const login = await client.login();
      console.log('Open this sign-in URL while this command stays running:');
      console.log(login.url);
      while (!(await client.authStatus({ signal: abort.signal })).authed) await new Promise(resolve => setTimeout(resolve, 1000));
      print({ signedIn: true });
    }
  }
  if (command === 'task' || command === 'watch') {
    if(cloud) {
      if(command==='task'&&args[1]!=='codebuff')throw new Error('Hosted CLI tasks currently require the codebuff harness; native CLI agents need a registered device target');
      const task=command==='watch'?{runId:args[0]}:await cloud.startTask({projectId:args[0]==='none'?undefined:args[0],model:args[2]==='default'?undefined:args[2],text:args.slice(3).join(' ')},{signal:abort.signal});
      print(task);
      for await(const output of cloud.watchRun(task.runId,{signal:abort.signal}))print(output);
    } else {
    const id = command === 'watch' ? args[0] : (await client.startTask({ projectPath: args[0], harnessId: args[1], model: args[2] === 'default' ? undefined : args[2], text: args.slice(3).join(' '), executionMode: 'local' })).id;
    print({ threadId: id });
    for await (const output of client.watchTask(id, { signal: abort.signal })) {
      print(output);
      // Stay attached across tool calls, queue pauses, questions and finishes; Ctrl+C detaches.
    }
    }
  }
} catch (error) {
  if (!abort.signal.aborted) { console.error(error.message); if (error.data) print(error.data); process.exitCode = 1; }
} finally { await server.stop(); }
