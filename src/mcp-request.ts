import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

/** The /mcp request currently being authenticated. Bearer verification has no request argument. */
export const mcpRequestStore = new AsyncLocalStorage<Request>();
