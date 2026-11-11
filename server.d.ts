import {FreebuffClient} from './index.js';
export function startFreebuff(options?: {resources?: string; statePath?: string; version?: string}): Promise<{client: FreebuffClient; statePath: string; stop(): Promise<void>}>;
