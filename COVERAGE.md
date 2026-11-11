# Full SDK completion audit

The requested goal remains active. Availability of a generic transport is not proof of complete feature behavior.

| Requirement | Current authoritative evidence | Remaining work |
|---|---|---|
| Projects and model selection | Isolated live suite and hosted validation | Broader model/harness/provider combinations |
| Task execution and generated output | Real Codex and two hosted-model responses | Explicit completion/error/paused lifecycle API and recovery |
| Active checklists and tool results | Real hosted write_todos calls plus extraction tests | More harness tool formats and streaming transitions |
| All HTTP operations and thread actions | 175 routes and 43 actions from 0.0.190; transport and declaration tests | Individual payload typing and feature behavior verification |
| Native Electron access | Isolated copy: version, window state, zoom read/write/events, unsubscribe and same-app HTTP authentication | Individual browser, dialogs, filesystem, notifications, updater and window workflow tests |
| Native launcher | Installed package launched/closed isolated 0.0.190 and 0.0.201 copies | More failure and cleanup cases; disk lifecycle |
| App update isolation | Launcher sets FREEBUFF_DISABLE_UPDATE_CHECK=1 | Retain this invariant in future native launch workflows |
| Native object transfer | JSON and Uint8Array arguments | Renderer-local File identity cannot currently cross remote connection |
| Consent bridge | Evidence and declarations | Standalone consent-window connection and live consent flow |
| Terminal | Live registered-device `HostedTerminalSession` attach/input/read/resize/detach/close with captured marker (`evidence/device-validation.json`) | Long-lived reconnect and alternate shell profiles |
| Cloud, MCP, integrations, skills, missions, worktrees, queue, publishing | Recovered operations/actions and source handler excerpts | Feature-specific methods/types and scoped integration verification |
| Current installed app version | 0.0.201 local controls plus hosted adapter; live task output, model switching, session release, attachments, SSE completion, registered local project, terminal and native-agent status | Native model execution target task and remaining feature-specific integration tests |
| Hosted streaming and recovery | Live SSE completion; fixtures verify split frames, malformed preview, idle cancellation, auth failure, fallback and cursor deduplication | Long-running reconnect scenarios and transient polling failures |
| Hosted attachments | Live binary round-trip, document conversion and task ingestion of a private random fixture | Stored project/chat uploads, more document formats and image resize ergonomics |
| Hosted workspace files | Live create/read/save, stale-revision protection, list, binary upload/download and stored chat attachments | Project-scoped stored uploads and full resource lifecycle |
| Device panel requests | Recovered typed file/Git/terminal operations, live registered-device preparation, terminal lifecycle and output capture | Device-target task execution and panel reconnect lifecycle |

During native testing the registered installation advanced to 0.0.201. The initially copied shell retained the original updater configuration; subsequent SDK-owned launches disable automatic update checks. The SDK does not downgrade or overwrite the registered application. Native instrumentation only changes the recognized debugging guard in a private copy with a new profile; it does not establish equivalence to the original signed package.
