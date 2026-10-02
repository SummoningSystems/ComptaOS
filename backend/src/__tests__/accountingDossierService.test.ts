import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; legalType?: "company" | "sci" | "holding"; createdAt: string }> }));
vi.mock("../services/companiesService.js", () => ({ getCompaniesRoot: () => workspace.root, loadCompanies: () => workspace.companies }));

import { ensureAccountingDossier, getAccountingDossiers } from "../services/accountingDossierService.js";
import { createHousehold, createPerson, getPlatformState, setAccessGrant } from "../services/platformService.js";

describe("universal accounting dossiers", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-dossiers-")); workspace.companies = [{ id: "holding", name: "Holding Test", path: "companies/holding", legalType: "holding", createdAt: "2026-01-01T00:00:00.000Z" }]; });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("active les dossiers personnels et expose les structures juridiques comme dossiers complets", () => {
    const initial = getPlatformState(); const withPerson = createPerson({ name: "Alice", expectedRevision: initial.revision }); const withHousehold = createHousehold({ name: "Foyer Alice", expectedRevision: withPerson.revision });
    const actor = { id: "local", role: "local" as const }; const before = getAccountingDossiers(actor);
    expect(before.find((item) => item.scopeId === withPerson.people[0].id)).toMatchObject({ mode: "personal", created: false });
    expect(before.find((item) => item.scopeId === "entity_holding")).toMatchObject({ mode: "full", legalType: "holding", created: true });
    expect(ensureAccountingDossier(withPerson.people[0].id, actor)).toMatchObject({ created: true, mode: "personal" });
    expect(ensureAccountingDossier(withHousehold.households[0].id, actor)).toMatchObject({ created: true, mode: "household" });
  });

  it("respecte les droits de gestion du périmètre", () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Client", expectedRevision: initial.revision }); const personId = state.people[0].id;
    const granted = setAccessGrant({ userId: "reader", scopeId: personId, role: "viewer", createdBy: "owner", expectedRevision: state.revision });
    expect(granted.grants).toHaveLength(1);
    expect(() => ensureAccountingDossier(personId, { id: "reader", role: "member" })).toThrow("Droits de gestion");
  });
});
