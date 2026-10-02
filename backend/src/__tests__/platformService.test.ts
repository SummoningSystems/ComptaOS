import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; kind?: "business" | "personal" | "household"; scopeId?: string; createdAt: string }> }));

vi.mock("../services/companiesService.js", () => ({
  getCompaniesRoot: () => workspace.root,
  loadCompanies: () => workspace.companies,
}));

import { createPerson, createRelation, getPlatformState, getScopeAccess, getVisiblePlatformState, initializeLegacyAccess, setAccessGrant } from "../services/platformService.js";

describe("person-centric platform registry", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-platform-"));
    workspace.companies = [
      { id: "default", name: "Société principale", path: ".", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "holding", name: "Holding", path: "companies/holding", createdAt: "2026-02-01T00:00:00.000Z" },
    ];
    await fs.mkdir(path.join(workspace.root, "banking"), { recursive: true });
    await fs.writeFile(path.join(workspace.root, "banking", "connections.json"), JSON.stringify([{ connectorName: "Banque test", accounts: [{ id: 7, name: "Compte pro", iban: "FR7612345678901234567890123", currency: "EUR", balance: 1200 }] }]), "utf-8");
  });

  afterEach(async () => {
    await fs.rm(workspace.root, { recursive: true, force: true });
  });

  it("référence les entreprises et comptes existants sans modifier leurs données", async () => {
    const before = await fs.readFile(path.join(workspace.root, "banking", "connections.json"), "utf-8");
    const state = getPlatformState();

    expect(state.entities.map((entity) => entity.workspaceId)).toEqual(["default", "holding"]);
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0]).toMatchObject({ name: "Compte pro", maskedIdentifier: "•••• 0123", sourceWorkspaceId: "default" });
    expect(state.relations[0]).toMatchObject({ fromId: "entity_default", type: "uses", source: "workspace" });
    expect(await fs.readFile(path.join(workspace.root, "banking", "connections.json"), "utf-8")).toBe(before);
  });

  it("actualise le solde référencé sans toucher aux données bancaires source", async () => {
    const initial = getPlatformState();
    expect(initial.accounts[0].balance).toBe(1200);
    const updatedSource = JSON.stringify([{ connectorName: "Banque test", accounts: [{ id: 7, name: "Compte pro", iban: "FR7612345678901234567890123", currency: "EUR", balance: 1450 }] }]);
    await fs.writeFile(path.join(workspace.root, "banking", "connections.json"), updatedSource, "utf-8");
    const updated = getPlatformState();
    expect(updated.accounts[0].balance).toBe(1450);
    expect(await fs.readFile(path.join(workspace.root, "banking", "connections.json"), "utf-8")).toBe(updatedSource);
  });

  it("relie les saisies manuelles et les comptes bancaires à leur dossier personnel sans créer une entreprise", async () => {
    const initial = getPlatformState();
    const withPerson = createPerson({ name: "Alice", expectedRevision: initial.revision });
    const personId = withPerson.people[0].id;
    const scopedPath = path.join(workspace.root, "companies", "scope-alice");
    await fs.mkdir(path.join(scopedPath, "banking"), { recursive: true });
    await fs.writeFile(path.join(scopedPath, "banking", "connections.json"), JSON.stringify([{ connectorName: "Banque perso", accounts: [{ id: "perso-1", name: "Compte courant", balance: 420 }] }]), "utf-8");
    workspace.companies.push({ id: "scope-alice", kind: "personal", scopeId: personId, name: "Alice", path: "companies/scope-alice", createdAt: "2026-10-02T00:00:00.000Z" });

    const state = getPlatformState();
    expect(state.entities.map((entity) => entity.workspaceId)).toEqual(["default", "holding"]);
    const scopedAccounts = state.accounts.filter((account) => account.sourceWorkspaceId === "scope-alice");
    expect(scopedAccounts.map((account) => account.sourceAccountId).sort()).toEqual(["main", "perso-1"]);
    expect(scopedAccounts.every((account) => state.relations.some((relation) => relation.fromId === personId && relation.toId === account.id && relation.type === "uses"))).toBe(true);
  });

  it("gère plusieurs personnes et leurs liens avec une révision optimiste", () => {
    const initial = getPlatformState();
    const withAlice = createPerson({ name: "Alice", expectedRevision: initial.revision });
    const withBob = createPerson({ name: "Bob", expectedRevision: withAlice.revision });
    const linked = createRelation({ fromId: withBob.people[0].id, toId: withBob.people[1].id, type: "family", expectedRevision: withBob.revision });

    expect(linked.created).toBe(true);
    expect(linked.state.people.map((person) => person.name)).toEqual(["Alice", "Bob"]);
    expect(linked.state.relations.some((relation) => relation.type === "family")).toBe(true);
    const duplicate = createRelation({ fromId: withBob.people[0].id, toId: withBob.people[1].id, type: "family", expectedRevision: linked.state.revision });
    expect(duplicate.created).toBe(false);
    expect(duplicate.relation.id).toBe(linked.relation.id);
    expect(duplicate.state.revision).toBe(linked.state.revision);
    expect(() => createPerson({ name: "Conflit", expectedRevision: initial.revision })).toThrow("modifiée ailleurs");
  });

  it("isole les portefeuilles tout en préservant les accès historiques", () => {
    const initialized = initializeLegacyAccess([
      { id: "user_accountant", role: "member", active: true },
      { id: "user_reader", role: "readonly", active: true },
    ]);
    expect(getScopeAccess({ id: "user_accountant", role: "member" }, "entity_default")).toBe("manager");
    expect(getScopeAccess({ id: "user_reader", role: "readonly" }, "entity_default")).toBe("viewer");

    const personState = createPerson({ name: "Client privé", expectedRevision: initialized.revision });
    const granted = setAccessGrant({ userId: "user_accountant", scopeId: personState.people[0].id, role: "manager", createdBy: "owner", expectedRevision: personState.revision });
    const visible = getVisiblePlatformState({ id: "user_accountant", role: "member" });
    const hidden = getVisiblePlatformState({ id: "unrelated", role: "member" });

    expect(granted.grants.some((grant) => grant.scopeId === personState.people[0].id)).toBe(true);
    expect(visible.people.map((person) => person.name)).toEqual(["Client privé"]);
    expect(hidden.people).toEqual([]);
    expect(hidden.entities).toEqual([]);
  });
});
