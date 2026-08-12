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
  prepareLocalRepository,
  resolveLocalGitPath,
  syncPush,
  writeSyncConfig,
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

  it("crée et utilise un dépôt de sauvegarde local sans token", async () => {
    const root = await mkdtemp(join(tmpdir(), "comptaos-local-sync-"));
    const workspace = join(root, "workspace"); const backup = join(root, "backup.git");
    try {
      await mkdir(workspace); await initRepo(workspace);
      await writeFile(join(workspace, "settings.json"), "{}\n"); await autoCommit(workspace, "test: données locales");
      expect(resolveLocalGitPath(backup, workspace)).toBe(backup);
      expect(await prepareLocalRepository(workspace, backup)).toBe(backup);
      await writeSyncConfig(workspace, { provider: "local", remoteUrl: backup, branch: "main" });
      expect(await syncPush(workspace)).toMatchObject({ ok: true });
      const { stdout } = await execFile("git", ["--git-dir", backup, "ls-tree", "-r", "--name-only", "main"]);
      expect(stdout).toContain("settings.json");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("refuse de placer la sauvegarde locale dans le workspace", async () => {
    const workspace = join(tmpdir(), "comptaos-workspace");
    expect(() => resolveLocalGitPath(join(workspace, "backup.git"), workspace)).toThrow("workspace ComptaOS");
  });
});
