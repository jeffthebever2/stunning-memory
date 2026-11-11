# Freebuff Desktop SDK — versioned 0.0.190 and 0.0.201 interfaces

Local JavaScript SDK recovered from the installed Windows Freebuff desktop build. The core HTTP SDK has no runtime dependencies; the native-copy launcher uses optional @electron/asar. Requires Node 22.12+ or an ES module capable Freebuff renderer.

## Start here: no manual port or token needed

### Current hosted tasks (0.0.201)

```js
import {startFreebuff} from 'freebuff-desktop-sdk-local/server';
import {connectHostedWorkspace} from 'freebuff-desktop-sdk-local/hosted';
const app = await startFreebuff();
let cloud, task;
try {
  cloud = await connectHostedWorkspace(app.client);
  const catalog = await cloud.models();
  task = await cloud.startTask({text:'Explain your capabilities without editing files', model:catalog.recommendedKey});
  for await (const output of cloud.watchRun(task.runId)) {
    console.log(output.status, output.text, output.tools, output.checklist);
  }
  // Sending on a different model releases the old session, then submits a new run
  // in the same workspace. Pass a key from catalog.rows, not its opaque handle.
  task = await cloud.sendMessage(task, 'Continue with another model', {model:'A_KEY_FROM_THE_CATALOG'});
  const result = await cloud.waitForRun(task.runId);
  console.log(result.status, result.text);
} finally {
  if (cloud && task) await cloud.endSession(task);
  await app.stop();
}
```

The hosted connector bootstraps through the signed-in local SDK server, confines the session cookie to the three workspace origins reviewed in the shipped native app, and verifies the remote account ID before returning. Tokens are private fields and must not be logged. Mutating requests reject redirects and use the workspace origin. Model keys resolve to the catalog's current opaque wire handles. A send refusal is surfaced with its task/admission data; the client does not automatically consent, retry a mutation, or purchase hours. `walletLimit` defaults to zero.

`watchRun` uses validated SSE frames by default and recovers through cursor-based polling, preserving raw events, questions, tool events, metrics, error and completion status. Decimal event cursors use integer-safe comparisons and are deduplicated. A completed status is drained through all 500-event pages. `waitForRun` returns the final result, including failed/cancelled outcomes; it does not equate “finished” with success. Aborting monitoring does not cancel the cloud run; use `cancelRun` to do that. SSE idle detection cancels stalled readers and falls back to polling from the last committed cursor; streaming is retried after a cooldown. `transport:'poll'` forces polling and `transport:'stream'` requires SSE. Authentication failures stop immediately. Ephemeral previews remain separate from committed `text` on the output's `preview` field.

The current adapter also exposes project/chat history, chat updates/forks/rollback, run/event/trace history, file reads and revision-checked file saves. Signed-in live checks cover account verification, model/project reads, task execution, completed assistant output, same-workspace model switching, session release, attachments, workspace files, registered local-project preparation, typed terminal I/O and native-agent status. Raw tool events and active todo extraction are covered by fixtures; the current hosted model may emit suggestions instead of todo writes.

Current CLI commands now use the hosted adapter: `freebuff-sdk models`, `freebuff-sdk projects`, `freebuff-sdk task none codebuff default "Your prompt"`, and `freebuff-sdk watch RUN_ID`. For `task`, replace `none` with a cloud project ID when desired; it is not a local filesystem path in 0.0.201. Use the JavaScript `sendMessage(task,text,{model})` method for current model switching. Native Codex/Claude installation/status is exposed through `nativeAgents`; device-target task submission and long-lived reconnect scenarios remain the only unverified execution edges.

**Version matters:** Freebuff 0.0.201 removed the old local task HTTP API in favor of a hosted workspace. The launcher detects the installed version from its ASAR. `client.version` identifies the selected interface, `operations` contains only that version's operations, and removed methods throw an explicit version error. Unknown versions are rejected rather than guessed. The task/model/project examples below apply to 0.0.190 resources, which can be selected using `startFreebuff({resources:'C:/path/to/0.0.190/resources'})`. The 0.0.201 hosted adapter now executes tasks and switches models with live validation; its broader feature surface is still incomplete.

For 0.0.201, `client.hostedWorkspace` exposes the factory-generated local controls, including `postBootstrap`, `postNativeAgents`, `getStatus`, `postLocalConversations`, `postPrepareChat`, `postTerminal`, `postFiles`, `postGit`, `postBrowser` and the remaining recovered controls. `connectHostedWorkspace` adds `connectLocalProject`, `localControl`, `nativeAgents` and `openDeviceTerminal`; the returned `HostedTerminalSession` captures decoded output and tracks the server generation. Bootstrap returns a session token: keep it private and do not log its response. `evidence/versions/0.0.201/contracts.json` retains the bound action handlers, not just the shared wrapper. `evidence/version-diff.json` lists removed/added routes and bridge members. The 0.0.201 server has 40 API routes plus one sign-in navigation route, and its main bridge has 60 members. Signed-in bootstrap, workspace status, native-agent status and registered-device terminal I/O passed live checks (`evidence/current-validation.json`, `evidence/device-validation.json`).

`startFreebuff` uses the optional `@electron/asar` dependency to detect installed versions. If it is omitted, supply an explicit, inventoried `version` together with the matching resources directory. A directly constructed `FreebuffClient` defaults to 0.0.190 for backward compatibility; pass `version:'0.0.201'` for a manually connected current server.

```js
import { startFreebuff } from 'freebuff-desktop-sdk-local/server';
const app = await startFreebuff();
try {
  const client = app.client;
  const projectPath = 'C:/path/to/project';
  console.log(await client.listModels(projectPath));
  const task = await client.startTask({ projectPath, harnessId: 'codex', text: 'Explain this project', executionMode: 'local' });
  for await (const update of client.watchTask(task.id)) {
    console.log(update.text, update.checklist, update.tools, update.event);
    // Use an AbortSignal to end monitoring; finish events do not necessarily mean success.
  }
} finally { await app.stop(); }
```

The Windows launcher starts the installed, unmodified orchestrator under a separate persistent `%LOCALAPPDATA%/FreebuffSDK/state.json` profile. It manages the port and launch token in memory. Normal Codex/Claude CLI authentication is used for their respective agents. Freebuff-hosted models require signing in to this separate profile. The launcher does not import your desktop credentials. Keep the returned server alive while tasks run; `stop()` stops its server and in-flight work. Native Electron bridges require the actual Electron window and are unavailable in this standalone server.

After installing this package, these commands are available:

```powershell
freebuff-sdk login
freebuff-sdk models C:/path/to/project
freebuff-sdk task C:/path/to/project codex default "Explain this project"
freebuff-sdk switch THREAD_ID codebuff MODEL_ID
freebuff-sdk watch THREAD_ID
freebuff-sdk projects
```

`login` prints the sign-in URL and waits for you to finish in a browser. `task` and `watch` stream full snapshots and raw events until Ctrl+C, which also shuts down their owned server. One launcher can own a profile at a time; use the JavaScript client for concurrent tasks and model changes in a single running server.

`switchProject(path)` opens/selects the project engine and returns its state; it does not rearrange the Electron UI. `switchModel(id,{harnessId,model})` uses the actual agent-switch action and reports rejection. `setEffort`, `setProvider`, `sendMessage`, `stop`, `captureTask` and `watchTask` expose reasoning effort, BYOK, execution and output. Captured output contains full original messages, tool calls/results, queue items and the latest active checklist using the app's own todo semantics. Raw agent events remain available for finer streaming; snapshots are authoritative and can include still-running output. No automatic approval of questions or elevation requests occurs.

All 175 recovered HTTP operations are also in `client.operations['METHOD /api/pattern'](options)`. All 43 thread actions are in `client.actions[action](threadId,body,options)`, including queue control, missions, forks, cloud handoff, worktrees, browser, previews and skills. Use `call` and `action` CLI commands with JSON arguments for those same interfaces. Request bodies and validation details are preserved in `evidence/contracts.json`; these entries expose the recovered server contracts and do not imply every operation has been exercised.

## Use

## Native Electron SDK connection

The stock packaged application deliberately exits when remote-debugging switches are present (`electron/main.cjs:23`). The SDK does not patch the installed application. Native remote access uses an explicitly instrumented private copy with a fresh Electron profile:

```js
import { launchDesktop } from 'freebuff-desktop-sdk-local/desktop-launcher';
const app = await launchDesktop({ instrument: true });
try {
  console.log(await app.desktop.appVersion());
  console.log(await app.desktop.windowState());
  const unsubscribe = await app.desktop.onInterfaceZoom(percent => console.log(percent));
  await app.desktop.setInterfaceZoom(110);
  await unsubscribe();
  // The HTTP SDK is connected to this same app's orchestrator.
  console.log(await app.client.listProjects());
} finally {
  await app.stop();
}
```

This copies the installed Windows application to a new directory, extracts its ASAR with the official optional `@electron/asar` dependency, verifies the exact recognized debug guard, and changes only that guard in the copy. It opens a loopback debugger and uses the existing trusted preload bridge. The launcher modifies only the copy and uses a fresh profile. Automatic update checks are explicitly disabled with Freebuff's supported FREEBUFF_DISABLE_UPDATE_CHECK setting, so the SDK copy does not download and auto-install an update into the registered installation. The copy has no inherited desktop sign-in, browser sessions or project state. Instrumentation changes package integrity; this copy is for local SDK use, not redistribution or signed-app equivalence. Keep the private debugging endpoint limited to the lifetime of the SDK session. The copied directory is retained for inspection; each default launch creates another copy and consumes disk space.

`app.desktop` exposes the 58 recovered main-bridge members; remote methods return promises. Event subscriptions also return a promise for an async unsubscribe function. Byte arguments can be `Uint8Array`. Native `File` objects (notably `getPathForFile`) are renderer-local objects and cannot be transferred as plain JSON over this connection. File dialogs run in the real native application. Consent windows use a different restricted bridge and are not impersonated by the main-window connector. `stop()` asks the app's normal close flow to close its main window; the app can keep running if an open task requires attention. `close()` disconnects the SDK without closing the app.

For a separately launched debugging-enabled Freebuff copy, `connectDesktop({endpoint:'http://127.0.0.1:PORT',targetId})` from `/desktop` connects to one exact loopback page. An ambiguous target list requires an explicit ID. It verifies that the page exposes the Freebuff preload before constructing the SDK. No arbitrary remote host is accepted.

Live checks on the isolated 0.0.190 copy passed for version, window state, zoom read/write/restore, native zoom events, unsubscribe, and HTTP authorization via the same preload. See `evidence/native-validation.json`. The 0.0.201 registered-device path additionally passed local project enrollment, terminal I/O and native-agent discovery (`evidence/device-validation.json`). Dialog workflows, updater actions, browser profile operations and the separate consent window still need individual verification.

TypeScript declarations now cover all recovered API method/pattern combinations and required path parameters, all 43 action names, and all 58 main native bridge members plus the consent bridge. Request body and response schemas that have not been verified remain `unknown`; route coverage does not imply complete payload typing. Run `npm run types:generate` to regenerate declarations from retained evidence, and `npm run test:types` after installing development dependencies to verify accepted and rejected calls. Both the main module and `/server` export declarations.

Task helpers forward `attachments: string[]` and project context to the real message endpoint. `getState` and `switchProject` compare against the canonical project path returned by the app, so accepted path aliases do not leave state discovery waiting on the wrong spelling.

From another local Node project, install this directory with `npm install /absolute/path/to/freebuff-sdk`, then:

```js
import { FreebuffClient, routes } from 'freebuff-desktop-sdk-local';

const client = new FreebuffClient({
  baseUrl: process.env.FREEBUFF_URL, // actual http://127.0.0.1:PORT
  token: process.env.FREEBUFF_LAUNCH_TOKEN,
});
const settings = await client.call('GET', '/api/settings');
const thread = await client.createThread({
  projectPath: 'C:/path/to/project',
  title: 'SDK session',
});
// Sends an actual agent request; normal account access and charges apply.
await client.threadAction(thread.id, 'message', { text: 'Explain this project' });
```

The running desktop orchestrator uses a dynamically assigned port. 8787 is a standalone server default, not a desktop port discovery mechanism. Both reads and writes require the current launch token when Electron manages the server. The SDK sends `x-freebuff-launch-id`; it does not scrape credentials, change the application, or disable its checks. A signed-in account may additionally be required by a route. A launch token is distinct from a cloud API key.

Inside the existing trusted Freebuff renderer, `new FreebuffClient()` uses its current origin, the existing `freebuffDesktop.apiToken()` bridge and browser session cookie. This package does not automatically install itself into the app. Outside that renderer, supply the port and token through an integration you control. Do not put launch tokens in URLs or commit them. Cross-origin web pages are rejected by the app.

## Entire recovered interface

- `routes` / `routes.json`: 176 observed method/pattern declarations, including expanded literal method maps. `call(method, pattern, {params, query, body, signal, raw})` covers the 175 `/api/` declarations. The remaining `/auth/login/launch/:token` browser navigation is catalogued but intentionally outside the HTTP API client; it returns a redirect and consumes an app sign-in launch link.
- `request(method, '/api/...', options)`: also reaches dynamic routes and the separately dispatched terminal endpoint. JSON bodies are serialized as supplied; validation remains with the server. `raw:true` preserves binary/file responses and headers. API errors expose `.status` and `.data` on `FreebuffError`; mutating requests are never retried automatically.
- `createThread(body)`, `getThread(id, options)`, `threadAction(id, action, body, options)`: convenience methods. Nested actions such as `cloud/handoff` retain their slash; each segment and route parameter is encoded separately. Use `query:{projectPath}` where the recovered handler needs it.
- `events({signal})`: async iterator over JSON SSE events from `/api/events`, including initial replay and ongoing changes. Supports chunk boundaries, UTF-8, CRLF and heartbeat comments. Abort through `AbortController`; breaking the loop cancels the stream. No automatic reconnection or replay deduplication.
- `client.desktop`: the exact existing 58-member `freebuffDesktop` object, or null outside its renderer. Call native dialogs, browser operations, window controls, updater, themes and event subscriptions using their existing argument shapes. Bridge event subscriptions return their original unsubscribe functions.
- `client.consent`: the separate three-member consent-window bridge (`ready`, `answer`, `height`), when supplied or present. A regular Freebuff renderer does not possess this bridge. The SDK does not create or impersonate a consent window.
- `connectTerminal({threadId, sessionId, location, cwd, cols, rows}, {factory})`: connects `/api/terminal` as a raw WebSocket. The native renderer uses its existing launch cookie. Outside it supply a WebSocket factory accepting `(url, headers)` and honoring the authentication header; the built-in Node WebSocket cannot set that header. For example, an already installed `ws` implementation can use `factory:(url,headers)=>new WebSocket(url,{headers})`. The SDK does not add a dependency for this. Close a session with `request('DELETE','/api/terminal',{query:{threadId,sessionId}})`. Terminal attachment can start a shell or reopen its thread. This is a raw transport, not a reconstructed terminal emulator or typed terminal message protocol.

Use `evidence/contracts.json` for every captured route handler and the 43 thread-action cases, with exact bundle line numbers. This exposes required body fields and validation without inventing schemas. `evidence/bridge.json` holds every main preload member and its argument forwarding. `evidence/routes.md` is a compact endpoint index. Responses remain the application's original values; there are no guessed TypeScript response types.

## What was analyzed

Installed package: `@codebuff/freebuff-desktop` 0.0.190. The Electron ASAR contains a native shell, with a separately shipped Bun orchestrator and UI bundle. The shell starts and supervises the loopback server, initializes launch authentication and exposes IPC. The orchestrator implements projects, threads, queueing, agents, cloud handoff, browser/preview actions, files and diffs, settings, skills, MCP, integrations, authentication/account operations, BYOK, onboarding, surveys, telemetry, sites and appearance APIs. Remote services and external agent CLIs remain external dependencies.

The app also contains the existing official `@codebuff/sdk` 0.10.7. Use that SDK for the Codebuff agent engine; this package addresses the additional desktop orchestration interface. The bundled dependency is not republished here.

REA 4.0.1 was installed and configured for Codex with its skill. The original config backup is `C:/Users/wtsco/.codex/config.toml.rea.backup`. Its MCP registration points at this chat's `work/rea-runtime` installation; retain that directory, or rerun setup from a permanent installation before removing it. Restart Codex to load the new MCP connection. The CLI already worked in this session.

REA full-ASAR analysis returned `artifact_operation_failed` / I/O failure. Extraction through REA's installed `@electron/asar` dependency succeeded. REA then successfully analyzed the extracted Electron directory: 106 parsed JavaScript files, 1097 findings, 125 IPC operations, 61 exposed members across two bridges and no parse failures. The main bridge contains 58 of those members. `evidence/rea-summary.json` retains provenance and REA's explicit limitations. Full raw evidence is in the companion `freebuff-rea-evidence.zip` artifact. A Babel AST pass over the separately shipped 11 MB Bun bundle recovered the route declarations, expanded method arrays and action switch cases without executing the target. The bundle SHA-256 is recorded in `evidence/contracts.json`.

## Validation and limits

Run `npm test`. The test suite expands every API declaration through the client, checks loopback restriction, path parameters, authentication headers, JSON bodies, conflict errors, no-content handling, SSE cancellation and terminal authentication forwarding.

Live validation also passed against the installed, unmodified Freebuff 0.0.190 Bun orchestrator using a newly created temporary profile and fixture project: wrong-token 401 rejection, authenticated project reads, SSE replay and cancellation, settings persistence, invalid-body 400 errors, thread creation/snapshot/rename/readback, and authenticated terminal WebSocket readiness and session closure. Later validation added task/model/project helpers, an owned launcher and explicit cancellation for idle streams. Remote API hosts were pointed at an unused loopback port for this test; no agent prompt or cloud write was issued. The test stops its own server and preserves the isolated fixture directory for inspection.

Repeat with `npm run test:live` on this Windows installation. `FREEBUFF_RESOURCES` can select another installed resources directory. To include the terminal check, set `FREEBUFF_TEST_WS_MODULE` to a file URL for an already installed `ws` module; otherwise that optional check is omitted. The validation performed here included that check. See `evidence/validation.json` for the recorded scope.

This is a recovered desktop client and contract inventory, not the application's original source or a replacement implementation. Static declarations do not establish live reachability or complete behavioral parity. Payload fields and server responses are intentionally untyped. Dynamic IPC expressions, ambiguous handlers, UI internals, external services, native vendor binaries and full terminal protocol semantics are not reconstructed. A real Codex task and assistant-output capture passed. Signed-in hosted generation and switching between two live catalog models passed, including real write_todos tool calls and completed checklist capture in the same conversation. See evidence/hosted-validation.json. Billing mutations, cloud handoff/publishing and native UI actions remain unverified. Codex did not expose its plan tool in the local checklist test; the Freebuff-hosted models successfully exercised the real checklist path. No live credentials were read. Account and app authorization remain required. Private interfaces can change when Freebuff updates; this package is pinned to 0.0.190.

## Hosted attachments

## Workspace files and device panels

`openWorkspace(id)` opens the hosted file runtime. `listFiles`, `readFile`, `createFile`, `uploadFile`, and `downloadFile` operate in that workspace; `touchWorkspace(id,generation)` refreshes its activity. `saveFile(id,path,content,revision)` requires the revision returned by the latest read. The service can return an HTTP-200 `{ok:false,conflict:true}` envelope for a stale save, so the SDK throws `WorkspaceFileError` and retains that result in `error.result`. This is a domain error, not an invented HTTP status. `error.conflict` identifies revision conflicts. A live conflict test verified that previously saved content stays intact.

`uploadStoredFile({kind:'project'|'chat',id},file)`, `listStoredFiles(scope)`, and `readStoredFile(scope,fileId)` handle persistent scoped attachments. Live checks passed for the chat scope. Project-scoped uploads remain unverified. Workspace binary uploads use the observed base64 JSON format; generic stored attachments use raw binary upload.

`listRemoteDevices(projectId)` reads registered targets. `prepareDeviceChat({projectId,threadId})` requests a prepared chat. `devicePanel('files'|'git'|'terminal',input)` exposes typed discriminated operations from the shipped device-control schema. Normal panel requests use the encoded JSON envelope, while file uploads use the separate `file-upload` endpoint. This API still requires an authorized, connected execution device; the SDK does not fabricate targets or silently enroll a user folder. Device execution and terminal lifecycle are not yet live-verified. See `evidence/files-validation.json` for the isolated hosted-file checks.

`uploadAttachment({name,mediaType,data})` accepts Blob, Uint8Array or ArrayBuffer bytes up to 25 MiB and returns a validated upload source descriptor. `readAttachment(source)` returns the binary Response. `convertDocument({name,mediaType,data})` sends the recovered base64 envelope with a 5 MiB input limit and validates the converted text-document descriptor. Pass `sources`, `documents`, and/or `images` to `startTask` or `sendMessage`. There are at most nine combined attachments, five converted documents and eight inline images. Inline PNG/JPEG/WebP images require base64 data and a name, with a combined encoded-size estimate of at most 2,000,000 bytes, matching the shipped client. The SDK does not silently resize or truncate files.

```js
const source = await cloud.uploadAttachment({
  name: "notes.txt", mediaType: "text/plain", data: new TextEncoder().encode("My notes"),
});
const task = await cloud.startTask({text:"Read the attached notes",sources:[source]});
const result = await cloud.waitForRun(task.runId);
```

Live checks passed for upload/download byte equality, document conversion, and a hosted task returning a random value present only in the attachment. The same task received live SSE output through completion. See `evidence/attachments-validation.json`. Fault-injection tests cover stream reconnect fallback, duplicated cursors, malformed frames, idle streams, early cancellation and authentication failures. Stored project/chat uploads and some document formats remain unverified.
