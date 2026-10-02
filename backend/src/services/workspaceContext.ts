import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestActor } from "./requestActor.js";

export type WorkspaceAccessRole = "owner" | "manager" | "viewer";
export interface WorkspaceRequestContext { companyId: string; root: string; actor: RequestActor; accessRole: WorkspaceAccessRole }
export const workspaceContext = new AsyncLocalStorage<WorkspaceRequestContext>();
export const actorContext = new AsyncLocalStorage<RequestActor>();
