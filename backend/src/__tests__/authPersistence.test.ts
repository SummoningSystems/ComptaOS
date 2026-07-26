import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));

vi.mock("../services/companiesService.js", () => ({
  getCompaniesRoot: () => workspace.root,
}));

import { createOwner, getJwtSecret, hasUsers, listUsers } from "../services/authService.js";

describe("auth persistence", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-auth-"));
    vi.stubEnv("JWT_SECRET", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workspace.root, { recursive: true, force: true });
  });

  it("écrit puis relit le registre utilisateurs sans fichier temporaire", async () => {
    await createOwner("owner", "Propriétaire", "mot-de-passe-solide");

    expect(hasUsers()).toBe(true);
    expect(listUsers()[0]).toMatchObject({ username: "owner", role: "owner", active: true });
    expect(await fs.readdir(workspace.root)).toEqual(["auth.json"]);
  });

  it("refuse un registre corrompu au lieu de proposer un nouveau setup", async () => {
    await fs.writeFile(path.join(workspace.root, "auth.json"), '{"users":', "utf-8");

    expect(() => hasUsers()).toThrow("Stockage d'authentification invalide");
  });

  it("génère un secret JWT persistant et refuse un secret tronqué", async () => {
    const generated = getJwtSecret();
    expect(generated).toHaveLength(128);
    expect(getJwtSecret()).toBe(generated);

    await fs.writeFile(path.join(workspace.root, ".jwt_secret"), "court", "utf-8");
    expect(() => getJwtSecret()).toThrow("Secret JWT local invalide ou tronqué");
  });
});
