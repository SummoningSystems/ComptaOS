import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; createdAt: string }> }));

vi.mock("../services/companiesService.js", () => ({
  getCompaniesRoot: () => workspace.root,
  loadCompanies: () => workspace.companies,
}));

import { createPerson, createRelation, getPlatformState } from "../services/platformService.js";

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

  it("gère plusieurs personnes et leurs liens avec une révision optimiste", () => {
    const initial = getPlatformState();
    const withAlice = createPerson({ name: "Alice", expectedRevision: initial.revision });
    const withBob = createPerson({ name: "Bob", expectedRevision: withAlice.revision });
    const linked = createRelation({ fromId: withBob.people[0].id, toId: withBob.people[1].id, type: "family", expectedRevision: withBob.revision });

    expect(linked.people.map((person) => person.name)).toEqual(["Alice", "Bob"]);
    expect(linked.relations.some((relation) => relation.type === "family")).toBe(true);
    expect(() => createPerson({ name: "Conflit", expectedRevision: initial.revision })).toThrow("modifiée ailleurs");
  });
});
