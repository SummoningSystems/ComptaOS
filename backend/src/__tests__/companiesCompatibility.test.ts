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
    ];
    await fs.writeFile(path.join(root, "_companies.json"), JSON.stringify(registry), "utf-8");
    const service = await import("../services/companiesService.js");

    expect(service.loadCompanies().map((company) => company.id)).toEqual(["default"]);
    service.createCompany("Nouvelle société");
    const stored = JSON.parse(await fs.readFile(path.join(root, "_companies.json"), "utf-8")) as Array<{ id: string }>;
    expect(stored.some((entry) => entry.id === "legacy-ecosystem")).toBe(true);
  });
});
