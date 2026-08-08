import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensureWorkspaceGitignore,
  mergeWorkspaceGitignore,
  WORKSPACE_GITIGNORE_ENTRIES,
  autoCommit,
  initRepo,
  refreshLocalGitStatus,
} from "../services/gitService.js";

const execFile = promisify(execFileCallback);

describe("workspace .gitignore", () => {
  it("ajoute toutes les données sensibles", () => {
    const merged = mergeWorkspaceGitignore("attachments/\n*.tmp\n");

    for (const entry of WORKSPACE_GITIGNORE_ENTRIES) {
      expect(merged.split("\n")).toContain(entry);
    }
  });

  it("préserve les règles existantes sans créer de doublons", () => {
    const merged = mergeWorkspaceGitignore("custom-export/\nauth.json\n");

    expect(merged).toContain("custom-export/\n");
    expect(merged.match(/auth\.json/g)).toHaveLength(1);
    expect(merged.endsWith("\n")).toBe(true);
  });

  it("écrit les exclusions sans dépendre de la disponibilité de Git", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "comptaos-gitignore-"));
    try {
      await ensureWorkspaceGitignore(workspace);
      const content = await readFile(join(workspace, ".gitignore"), "utf-8");
      for (const entry of WORKSPACE_GITIGNORE_ENTRIES) {
        expect(content.split("\n")).toContain(entry);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("versionne le chemin d'une pièce mais ignore son fichier binaire", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "comptaos-git-data-"));
    try {
      await initRepo(workspace);
      await mkdir(join(workspace, "transactions")); await mkdir(join(workspace, "attachments"));
      await writeFile(join(workspace, "transactions", "txn.yml"), "attachment: facture.pdf\nattachments:\n  - facture.pdf\n");
      await writeFile(join(workspace, "attachments", "facture.pdf"), "contenu binaire simulé");
      await autoCommit(workspace, "test: chemin justificatif");
      const { stdout } = await execFile("git", ["ls-files"], { cwd: workspace });
      expect(stdout).toContain("transactions/txn.yml");
      expect(stdout).not.toContain("attachments/facture.pdf");
      expect((await refreshLocalGitStatus(workspace)).uncommitted).toBe(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
