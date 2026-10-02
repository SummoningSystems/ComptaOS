import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("compatibilité du registre d'entreprises", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-companies-"));
    vi.stubEnv("WORKSPACE_PATH", root);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("masque les anciens conteneurs techniques sans les effacer", async () => {
    const registry = [
      { id: "default", name: "Entreprise", path: ".", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "legacy-ecosystem", kind: "ecosystem", name: "Ancien écosystème", path: "companies/legacy-ecosystem", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "legacy-household", kind: "household", name: "Ancien foyer", path: "companies/legacy-household", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "scope-person", kind: "personal", scopeId: "person_test", name: "Dossier Alice", path: "companies/scope-person", createdAt: "2026-10-02T00:00:00.000Z" },
    ];
    await fs.writeFile(path.join(root, "_companies.json"), JSON.stringify(registry), "utf-8");
    const service = await import("../services/companiesService.js");

    expect(service.loadCompanies().map((company) => company.id)).toEqual(["default", "scope-person"]);
    service.createCompany("Nouvelle société");
    const stored = JSON.parse(await fs.readFile(path.join(root, "_companies.json"), "utf-8")) as Array<{ id: string }>;
    expect(stored.some((entry) => entry.id === "legacy-ecosystem")).toBe(true);
    expect(stored.some((entry) => entry.id === "legacy-household")).toBe(true);
    expect(stored.some((entry) => entry.id === "scope-person")).toBe(true);
  });

  it("crée un espace de données isolé et réutilisable pour une personne", async () => {
    const service = await import("../services/companiesService.js");
    const first = service.ensureScopedWorkspace("person_alice", "Alice", "personal");
    const second = service.ensureScopedWorkspace("person_alice", "Alice renommée", "personal");

    expect(second.id).toBe(first.id);
    expect(service.resolveCompanyPath(first)).toBe(path.join(root, first.path));
    expect(await fs.stat(path.join(root, first.path, "transactions"))).toBeTruthy();
    expect(await fs.stat(path.join(root, first.path, "attachments"))).toBeTruthy();
    expect(await fs.stat(path.join(root, first.path, "banking"))).toBeTruthy();
    expect(service.loadCompanies().filter((company) => company.scopeId === "person_alice")).toHaveLength(1);
  });
});
