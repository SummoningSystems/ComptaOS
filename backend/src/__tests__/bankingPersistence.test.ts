import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companiesRoot: "" }));

vi.mock("../services/fileSystem.js", () => ({
  getWorkspaceRoot: () => workspace.root,
}));

vi.mock("../services/companiesService.js", () => ({
  getCompaniesRoot: () => workspace.companiesRoot,
}));

import {
  getConfig,
  getConnections,
  getConnectWebviewUrl,
  saveConfig,
  saveConnections,
  validateBankingConfig,
} from "../services/bankingService.js";

describe("banking persistence", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-banking-"));
    workspace.companiesRoot = workspace.root;
    for (const name of ["POWENS_DOMAIN", "POWENS_CLIENT_ID", "POWENS_CLIENT_SECRET", "POWENS_USER_TOKEN"]) {
      vi.stubEnv(name, "");
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await fs.rm(workspace.companiesRoot, { recursive: true, force: true });
  });

  it("écrit atomiquement une configuration Powens valide", async () => {
    const config = { domain: "client-test", clientId: "client-id", clientSecret: "secret", userToken: "token" };

    await saveConfig(config);

    await expect(getConfig()).resolves.toEqual(config);
    expect(await fs.readdir(workspace.root)).toEqual([".banking_config.json"]);
  });

  it("refuse les configurations incomplètes et les fichiers corrompus", async () => {
    expect(() => validateBankingConfig({ domain: "", clientId: "id", clientSecret: "secret" })).toThrow(
      "Configuration bancaire invalide",
    );
    await fs.writeFile(path.join(workspace.root, ".banking_config.json"), '{"domain":42}', "utf-8");
    await expect(getConfig()).rejects.toThrow("Configuration bancaire locale invalide");
  });

  it("valide, écrit et relit les connexions bancaires", async () => {
    const connections = [{
      connectionId: 42,
      connectorName: "Banque test",
      accounts: [{ id: 7, name: "Compte courant", currency: "EUR" }],
      createdAt: "2026-07-26T00:00:00.000Z",
      status: "active",
    }];

    await saveConnections(connections);

    await expect(getConnections()).resolves.toEqual(connections);
    const files = await fs.readdir(path.join(workspace.root, "banking"));
    expect(files).toEqual(["connections.json"]);
  });

  it("crée un utilisateur Powens isolé pour un dossier personnel", async () => {
    workspace.companiesRoot = workspace.root;
    workspace.root = path.join(workspace.companiesRoot, "companies", "person-test");
    await fs.mkdir(workspace.root, { recursive: true });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ auth_token: "personal-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "temporary-code" }), { status: 200 }));

    const result = await getConnectWebviewUrl(undefined, { domain: "client-test", clientId: "id", clientSecret: "secret", userToken: "legacy-business-token" });

    expect(result.url).toContain("/fr/manage");
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/init");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: expect.objectContaining({ Authorization: "Bearer personal-token" }) });
    await expect(fs.readFile(path.join(workspace.root, "banking", ".powens_user.json"), "utf-8")).resolves.toContain("personal-token");
    await expect(getConnections()).resolves.toEqual([]);
  });
});
