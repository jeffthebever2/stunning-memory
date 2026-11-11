import fs from 'node:fs';
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const routes = [...read('./routes.json'), ...read('./routes-0.0.201.json')].filter(r => r.pattern.startsWith('/api/')).filter((r,i,a)=>a.findIndex(s=>s.method===r.method&&s.pattern===r.pattern)===i);
const actions = read('./actions.json');
const q = JSON.stringify;
const params = pattern => [...pattern.matchAll(/[:*](\w+)/g)].map(m => m[1]);
const options = pattern => params(pattern).length ? `RequestOptions & { params: { ${params(pattern).map(p => `${p}: string`).join('; ')} } }` : 'RequestOptions';
const bridge = read('./evidence/bridge-current.json');
const member = ({name, implementation}) => {
  if (name === 'platform') return 'readonly platform: string;';
  if (name === 'customTitleBar') return 'readonly customTitleBar: boolean;';
  if (name === 'shellTheme') return "readonly shellTheme?: 'dark' | 'light' | 'system';";
  const match = implementation.match(/^[\w]+:\s*\(([^)]*)\)\s*=>/);
  const args = (match?.[1] ?? '').split(',').map(s=>s.trim()).filter(Boolean).map(s => `${s}: ${s === 'handler' ? '(...args: unknown[]) => void' : 'unknown'}`).join(', ');
  const result = name === 'apiToken' ? 'string | null' : name === 'getPathForFile' ? 'string' : /^on[A-Z]/.test(name) ? '() => void' : implementation.includes('ipcRenderer.invoke') ? 'Promise<unknown>' : 'void';
  return `${name}(${args}): ${result};`;
};
const source = `// Generated from recovered route and preload evidence; npm run types:generate.
export interface RequestOptions { query?: Record<string, string | number | boolean | null | undefined>; body?: unknown; signal?: AbortSignal; raw?: boolean; }
export type ThreadAction = ${actions.map(q).join(' | ')};
export interface OperationOptions {
${routes.map(r=>`  ${q(r.method+' '+r.pattern)}: ${options(r.pattern)};`).join('\n')}
}
export type Operations = { [K in keyof OperationOptions]: (...args: {} extends OperationOptions[K] ? [options?: OperationOptions[K]] : [options: OperationOptions[K]]) => Promise<unknown> };
export interface DesktopBridge {
${bridge.map(m=>'  '+member(m)).join('\n')}
}
export interface ConsentBridge { ready(handler: (request: unknown) => void): void; answer(approved: boolean): void; height(px: number): void; }
export interface Thread { id: string; projectPath?: string; harnessId?: string; model?: string; [key: string]: unknown; }
export interface Message { role: string; parts?: Array<{ kind: string; text?: string; [key: string]: unknown }>; [key: string]: unknown; }
export interface TaskSnapshot { thread: Thread; messages: Message[]; items: unknown[]; [key: string]: unknown; }
export interface TaskOutput { thread: Thread; messages: Message[]; items: unknown[]; text: string; tools: unknown[]; checklist: Array<{text: string; state: 'pending' | 'active' | 'done'}> | null; }
export interface AppEvent { type: string; threadId?: string; [key: string]: unknown; }
export class FreebuffError extends Error { status: number; data: unknown; constructor(status: number, data: unknown); }
export const routes: Array<{method: string; pattern: string; line: number}>;
export function routesForVersion(version: string): typeof routes;
export function taskOutput(snapshot: TaskSnapshot): TaskOutput;
export class FreebuffClient {
  constructor(options?: {baseUrl?: string; token?: string; bridge?: DesktopBridge; consent?: ConsentBridge; fetch?: typeof fetch; version?: string});
  readonly version: string;
  hostedWorkspace: Record<string, (body?: unknown, options?: RequestOptions) => Promise<unknown>>;
  desktop: DesktopBridge | null;
  consent: ConsentBridge | null;
  operations: Operations;
  actions: Record<ThreadAction, (id: string, body?: unknown, options?: RequestOptions) => Promise<unknown>>;
  request(method: string, path: string, options: RequestOptions & {raw: true}): Promise<Response>;
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
${routes.map(r=>`  call(method: ${q(r.method)}, pattern: ${q(r.pattern)}, ${params(r.pattern).length ? 'options:' : 'options?:'} ${options(r.pattern)}): Promise<unknown>;`).join('\n')}
  threadAction(id: string, action: ThreadAction, body?: unknown, options?: RequestOptions): Promise<unknown>;
  createThread(body: {projectPath?: string; [key: string]: unknown}, options?: RequestOptions): Promise<Thread>;
  getThread(id: string, options?: RequestOptions): Promise<TaskSnapshot>;
  startTask(body: {text: string; attachments?: string[]; projectPath?: string; [key: string]: unknown}, options?: RequestOptions): Promise<Thread>;
  captureTask(id: string, options?: RequestOptions): Promise<TaskOutput>;
  watchTask(id: string, options?: RequestOptions): AsyncGenerator<TaskOutput & {event: AppEvent | null}>;
  events(options?: {signal?: AbortSignal}): AsyncGenerator<AppEvent>;
  authStatus(options?: RequestOptions): Promise<{authed: boolean; [key: string]: unknown}>;
  login(options?: RequestOptions): Promise<{url: string; attemptId: string}>;
  openProject(path: string, options?: RequestOptions): Promise<{ok: boolean; path: string}>;
  getState(projectPath: string, options?: {signal?: AbortSignal}): Promise<Record<string, unknown>>;
  switchProject(projectPath: string, options?: {signal?: AbortSignal}): Promise<Record<string, unknown>>;
  listProjects(options?: RequestOptions): Promise<unknown>;
  listModels(projectPath: string, options?: {signal?: AbortSignal}): Promise<{freebuff: unknown; agents: unknown}>;
  switchModel(id: string, model: {harnessId?: string; model: string; projectPath?: string}, options?: RequestOptions): Promise<unknown>;
  setEffort(id: string, effort: string | null, options?: RequestOptions): Promise<unknown>;
  setProvider(id: string, binding: unknown, options?: RequestOptions): Promise<unknown>;
  sendMessage(id: string, text: string, options?: RequestOptions & {attachments?: string[]; projectPath?: string}): Promise<unknown>;
  stop(id: string, options?: RequestOptions): Promise<unknown>;
  connectTerminal<T = WebSocket>(query: {threadId: string; [key: string]: string | number | undefined}, options?: {factory?: (url: string, headers: Record<string, string>) => T}): T;
}
`;
fs.writeFileSync(new URL('./index.d.ts', import.meta.url), source);
fs.writeFileSync(new URL('./server.d.ts', import.meta.url), `import {FreebuffClient} from './index.js';\nexport function startFreebuff(options?: {resources?: string; statePath?: string; version?: string}): Promise<{client: FreebuffClient; statePath: string; stop(): Promise<void>}>;\n`);
