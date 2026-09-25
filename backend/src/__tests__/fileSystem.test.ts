import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/companiesService.js", () => ({
  getActiveCompanyPath: () => workspace.root,
}));

import {
  WorkspacePathError,
  createDirectory,
  deleteFile,
  readFile,
  renameNode,
  resolveSafe,
  writeFile,
} from "../services/fileSystem.js";

describe("workspace file boundaries", () => {
  let sibling: string;

  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-files-"));
    sibling = workspace.root + "-other";
    await fs.mkdir(sibling);
  });

  afterEach(async () => {
    await fs.rm(workspace.root, { recursive: true, force: true });
    await fs.rm(sibling, { recursive: true, force: true });
  });

  it("allows normal nested file operations", async () => {
    await createDirectory("nested");
    await writeFile("nested/source.txt", "hello");
    expect(await readFile("nested/source.txt")).toBe("hello");
    await renameNode("nested/source.txt", "nested/dest.txt");
    expect(await readFile("nested/dest.txt")).toBe("hello");
    await deleteFile("nested/dest.txt");
    await expect(readFile("nested/dest.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal, a sibling with the same prefix, and absolute paths", async () => {
    const siblingPath = path.relative(workspace.root, path.join(sibling, "secret.txt"));
    for (const unsafe of ["../outside.txt", siblingPath, path.join(sibling, "secret.txt")]) {
      expect(() => resolveSafe(unsafe)).toThrow(WorkspacePathError);
      await expect(writeFile(unsafe, "leak")).rejects.toMatchObject({ statusCode: 403 });
      await expect(readFile(unsafe)).rejects.toMatchObject({ statusCode: 403 });
      await expect(deleteFile(unsafe)).rejects.toMatchObject({ statusCode: 403 });
      await expect(renameNode("safe.txt", unsafe)).rejects.toMatchObject({ statusCode: 403 });
      await expect(renameNode(unsafe, "safe.txt")).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(fs.readdir(sibling)).resolves.toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects a symlink target and symlinked parent", async () => {
    await fs.writeFile(path.join(sibling, "secret.txt"), "secret");
    await fs.symlink(path.join(sibling, "secret.txt"), path.join(workspace.root, "linked.txt"));
    await fs.symlink(sibling, path.join(workspace.root, "linked-dir"), "dir");

    for (const unsafe of ["linked.txt", "linked-dir/secret.txt"]) {
      expect(() => resolveSafe(unsafe)).toThrow(WorkspacePathError);
      await expect(readFile(unsafe)).rejects.toMatchObject({ statusCode: 403 });
      await expect(deleteFile(unsafe)).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(writeFile("linked-dir/new.txt", "leak")).rejects.toMatchObject({ statusCode: 403 });
    await expect(createDirectory("linked-dir/new-dir")).rejects.toMatchObject({ statusCode: 403 });
    await expect(renameNode("linked.txt", "safe.txt")).rejects.toMatchObject({ statusCode: 403 });
    await expect(renameNode("safe.txt", "linked-dir/new.txt")).rejects.toMatchObject({ statusCode: 403 });
    await expect(fs.readdir(sibling)).resolves.toEqual(["secret.txt"]);
  });
});
