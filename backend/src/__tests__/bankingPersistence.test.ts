import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));

vi.mock("../services/fileSystem.js", () => ({
  getWorkspaceRoot: () => workspace.root,
}));

vi.mock("../services/companiesService.js", () => ({
  getCompaniesRoot: () => workspace.root,
}));

import {
  getConfig,
  getConnections,
  saveConfig,
  saveConnections,
  validateBankingConfig,
} from "../services/bankingService.js";

describe("banking persistence", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-banking-"));
    for (const name of ["POWENS_DOMAIN", "POWENS_CLIENT_ID", "POWENS_CLIENT_SECRET", "POWENS_USER_TOKEN"]) {
      vi.stubEnv(name, "");
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workspace.root, { recursive: true, force: true });
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
});
