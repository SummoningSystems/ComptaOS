import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("stored company path boundaries", () => {
  let root: string;
  let sibling: string;
  let companies: typeof import("../services/companiesService.js");

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-company-"));
    sibling = root + "-other";
    await fs.mkdir(sibling);
    vi.stubEnv("WORKSPACE_PATH", root);
    vi.resetModules();
    companies = await import("../services/companiesService.js");
    companies.ensureDefaultCompany();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(sibling, { recursive: true, force: true });
  });

  async function setCompanyPath(companyPath: string) {
    await fs.writeFile(path.join(root, "_companies.json"), JSON.stringify([{
      id: "default", name: "Test", path: companyPath, createdAt: "2026-01-01T00:00:00Z",
    }]));
    companies.invalidateActiveCompanyCache();
  }

  it("accepts a company directory inside the workspace", async () => {
    await fs.mkdir(path.join(root, "companies", "safe"), { recursive: true });
    await setCompanyPath("companies/safe");
    expect(companies.getActiveCompanyPath()).toBe(await fs.realpath(path.join(root, "companies", "safe")));
  });

  it("rejects traversal, same-prefix siblings, and absolute company paths", async () => {
    for (const unsafe of ["../outside", path.relative(root, sibling), sibling]) {
      await setCompanyPath(unsafe);
      expect(() => companies.getActiveCompanyPath()).toThrow(/Chemin d'entreprise/);
    }
  });

  it.skipIf(process.platform === "win32")("rejects a company symlink outside the workspace", async () => {
    await fs.symlink(sibling, path.join(root, "linked-company"), "dir");
    await setCompanyPath("linked-company");
    expect(() => companies.getActiveCompanyPath()).toThrow(/Chemin d'entreprise/);
  });
});
