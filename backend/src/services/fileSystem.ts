import fs from "fs/promises";
import { lstatSync, realpathSync } from "fs";
import path from "path";
import { FileNode } from "../types/index.js";
import { getActiveCompanyPath } from "./companiesService.js";

export function getWorkspaceRoot(): string {
  return getActiveCompanyPath();
}

export class WorkspacePathError extends Error {
  statusCode = 403;

  constructor() {
    super("Accès interdit hors du workspace");
  }
}

/** Résout un chemin relatif sans traversée ni lien symbolique. */
export function resolveSafe(relativePath: string): string {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new WorkspacePathError();
  }

  const base = realpathSync(getActiveCompanyPath());
  const resolved = path.resolve(base, relativePath);
  const withinBase = path.relative(base, resolved);
  if (withinBase === ".." || withinBase.startsWith(".." + path.sep) || path.isAbsolute(withinBase)) {
    throw new WorkspacePathError();
  }

  if (withinBase.split(path.sep).some(part => part.startsWith(".") || part.startsWith("_") || ["auth.json", "companies", "workspaces", "banking", "ai_config.json", "git_sync.json", "household.json", "household.pending.json"].includes(part))) throw new WorkspacePathError();
  let current = base;
  for (const part of withinBase.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new WorkspacePathError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return resolved;
}

/** Construit un arbre de fichiers récursivement. */
export async function buildFileTree(dir: string, base?: string): Promise<FileNode[]> {
  const actualBase = base ?? getActiveCompanyPath();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = path.relative(actualBase, absPath).replace(/\\/g, "/");

    try { resolveSafe(relPath); } catch { continue; }
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const children = await buildFileTree(absPath, actualBase);
      nodes.push({ name: entry.name, path: relPath, type: "directory", children });
    } else {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "file",
        extension: path.extname(entry.name).slice(1),
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/** Lit le contenu d'un fichier texte. */
export async function readFile(relativePath: string): Promise<string> {
  const abs = resolveSafe(relativePath);
  return fs.readFile(abs, "utf-8");
}

/** Écrit le contenu d'un fichier (crée les dossiers intermédiaires si besoin). */
export async function writeFile(relativePath: string, content: string): Promise<void> {
  const abs = resolveSafe(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

/** Supprime un fichier. */
export async function deleteFile(relativePath: string): Promise<void> {
  const abs = resolveSafe(relativePath);
  await fs.unlink(abs);
}

/** Crée un dossier. */
export async function createDirectory(relativePath: string): Promise<void> {
  const abs = resolveSafe(relativePath);
  await fs.mkdir(abs, { recursive: true });
}

/** Renomme / déplace un fichier ou dossier. */
export async function renameNode(oldRel: string, newRel: string): Promise<void> {
  const oldAbs = resolveSafe(oldRel);
  const newAbs = resolveSafe(newRel);
  await fs.rename(oldAbs, newAbs);
}
