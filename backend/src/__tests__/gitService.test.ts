import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensureWorkspaceGitignore,
  mergeWorkspaceGitignore,
  WORKSPACE_GITIGNORE_ENTRIES,
} from "../services/gitService.js";

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
});
