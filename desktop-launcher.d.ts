import {DesktopConnection} from './desktop.js';
export function launchDesktop(options: {instrument: true; source?: string; directory?: string; signal?: AbortSignal}): Promise<DesktopConnection & {directory: string; process: unknown; stop(): Promise<void>}>;
