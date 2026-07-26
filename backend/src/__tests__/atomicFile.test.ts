import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, atomicWriteFileSync } from "../services/atomicFile.js";

describe("atomicWriteFile", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-atomic-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("crée les dossiers et écrit le contenu attendu", async () => {
    const target = path.join(root, "transactions", "txn_1.yaml");

    await atomicWriteFile(target, "id: txn_1\n");

    await expect(fs.readFile(target, "utf-8")).resolves.toBe("id: txn_1\n");
  });

  it("remplace complètement un fichier existant", async () => {
    const target = path.join(root, "txn.yaml");
    await fs.writeFile(target, "ancien contenu", "utf-8");

    await atomicWriteFile(target, "nouveau contenu");

    await expect(fs.readFile(target, "utf-8")).resolves.toBe("nouveau contenu");
    expect(await fs.readdir(root)).toEqual(["txn.yaml"]);
  });

  it("offre les mêmes garanties aux services synchrones", async () => {
    const target = path.join(root, "settings", "invoices.json");

    atomicWriteFileSync(target, JSON.stringify([{ id: "inv_1" }]));
    atomicWriteFileSync(target, JSON.stringify([{ id: "inv_2" }]));

    await expect(fs.readFile(target, "utf-8")).resolves.toBe('[{"id":"inv_2"}]');
    expect(await fs.readdir(path.dirname(target))).toEqual(["invoices.json"]);
  });
});
