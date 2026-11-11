import {FreebuffClient, DesktopBridge} from './index.js';
export type RemoteDesktopBridge = {
  [K in keyof DesktopBridge]: K extends 'platform' | 'customTitleBar' | 'shellTheme' ? DesktopBridge[K] :
    K extends `on${string}` ? (handler: (...args: unknown[]) => void) => Promise<() => Promise<void>> :
    DesktopBridge[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};
export interface DesktopConnection {client: Omit<FreebuffClient, 'desktop'> & {desktop: RemoteDesktopBridge}; desktop: RemoteDesktopBridge; close(): Promise<void>}
export function connectDesktop(options: {endpoint: string; targetId?: string; signal?: AbortSignal}): Promise<DesktopConnection>;
