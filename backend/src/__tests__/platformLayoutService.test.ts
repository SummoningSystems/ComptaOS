import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; createdAt: string }> }));
vi.mock("../services/companiesService.js", () => ({ getCompaniesRoot: () => workspace.root, loadCompanies: () => workspace.companies }));

import { createPerson, getPlatformState, setAccessGrant } from "../services/platformService.js";
import { getPlatformLayout, savePlatformLayout } from "../services/platformLayoutService.js";

describe("platform graph layouts", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-layout-")); workspace.companies = [{ id: "default", name: "Entreprise", path: ".", createdAt: "2026-01-01T00:00:00.000Z" }]; });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("mémorise une disposition propre à chaque utilisateur et à ses nœuds visibles", () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Alice", expectedRevision: initial.revision }); const personId = state.people[0].id;
    setAccessGrant({ userId: "viewer", scopeId: personId, role: "viewer", createdBy: "owner", expectedRevision: state.revision });
    savePlatformLayout({ id: "owner", role: "owner" }, { [personId]: { x: 120, y: 80 }, entity_default: { x: 500, y: 200 } });
    savePlatformLayout({ id: "viewer", role: "member" }, { [personId]: { x: 40, y: 60 }, entity_default: { x: 900, y: 900 } });
    expect(getPlatformLayout({ id: "owner", role: "owner" })).toMatchObject({ [personId]: { x: 120, y: 80 }, entity_default: { x: 500, y: 200 } });
    expect(getPlatformLayout({ id: "viewer", role: "member" })).toEqual({ [personId]: { x: 40, y: 60 } });
  });
});
