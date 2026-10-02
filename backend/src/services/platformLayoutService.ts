import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot } from "./companiesService.js";
import { getVisiblePlatformState } from "./platformService.js";
import type { RequestActor } from "./requestActor.js";

export interface PlatformNodePosition { x: number; y: number }
export type PlatformLayout = Record<string, PlatformNodePosition>;
interface LayoutStore { schemaVersion: 1; users: Record<string, PlatformLayout> }

const file = () => join(getCompaniesRoot(), "_platform_layouts.json");
function readStore(): LayoutStore {
  if (!existsSync(file())) return { schemaVersion: 1, users: {} };
  try { const parsed = JSON.parse(readFileSync(file(), "utf-8")) as Partial<LayoutStore>; return { schemaVersion: 1, users: parsed.users ?? {} }; }
  catch { return { schemaVersion: 1, users: {} }; }
}
const actorKey = (actor: RequestActor) => actor.role === "local" ? "local" : actor.id;

export function getPlatformLayout(actor: RequestActor): PlatformLayout {
  const state = getVisiblePlatformState(actor);
  const visible = new Set([...state.people, ...state.households, ...state.entities, ...state.accounts].map((node) => node.id));
  return Object.fromEntries(Object.entries(readStore().users[actorKey(actor)] ?? {}).filter(([id]) => visible.has(id)));
}

export function savePlatformLayout(actor: RequestActor, positions: PlatformLayout): PlatformLayout {
  const state = getVisiblePlatformState(actor);
  const visible = new Set([...state.people, ...state.households, ...state.entities, ...state.accounts].map((node) => node.id));
  const normalized: PlatformLayout = {};
  for (const [id, position] of Object.entries(positions ?? {})) {
    if (!visible.has(id)) continue;
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) throw new Error("Position de nœud invalide.");
    normalized[id] = { x: Math.round(Math.max(0, Math.min(5000, position.x))), y: Math.round(Math.max(0, Math.min(5000, position.y))) };
  }
  const store = readStore(); store.users[actorKey(actor)] = normalized; atomicWriteFileSync(file(), JSON.stringify(store, null, 2));
  return normalized;
}
