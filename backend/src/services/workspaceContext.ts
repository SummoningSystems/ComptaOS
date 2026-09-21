import { AsyncLocalStorage } from "node:async_hooks";
export interface WorkspaceContext { id: string; root: string; kind: "business" | "household"; actor: string; role: string }
export const workspaceContext = new AsyncLocalStorage<WorkspaceContext>();
export const actorContext = new AsyncLocalStorage<{ id: string; role: string }>();
const queues = new Map<string, Promise<unknown>>();
/** One writer per workspace, including durable import recovery. */
export async function workspaceLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(root, next);
  try { return await next; } finally { if (queues.get(root) === next) queues.delete(root); }
}
export async function drainWorkspaceWrites() { await Promise.all([...queues.values()].map(p => p.catch(() => undefined))); }
