import { execFile as _execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { atomicWriteFile } from "./atomicFile.js";

const execFile = promisify(_execFile);

export const WORKSPACE_GITIGNORE_ENTRIES = [
  "attachments/",
  "*.tmp",
  ".DS_Store",
  "auth.json",
  ".jwt_secret",
  ".banking_config.json",
  "banking/",
];

export function mergeWorkspaceGitignore(existing: string): string {
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  const merged = [...lines.filter(Boolean)];
  for (const entry of WORKSPACE_GITIGNORE_ENTRIES) {
    if (!merged.includes(entry)) merged.push(entry);
  }
  return `${merged.join("\n")}\n`;
}

export async function ensureWorkspaceGitignore(workspacePath: string): Promise<void> {
  const ignorePath = path.join(workspacePath, ".gitignore");
  const existing = await fs.readFile(ignorePath, "utf-8").catch(() => "");
  const updated = mergeWorkspaceGitignore(existing);
  if (updated !== existing) await atomicWriteFile(ignorePath, updated);
}

/** Lance une commande git dans un répertoire donné. */
async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", args, { cwd });
    return stdout.trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(e.stderr?.trim() || e.message || String(err));
  }
}

/**
 * Initialise un dépôt Git dans le dossier workspace si ce n'est pas déjà fait.
 * Crée un .gitignore (exclut les pièces jointes) et fait un commit initial.
 */
export async function initRepo(workspacePath: string): Promise<void> {
  // Les exclusions sensibles doivent être garanties même lorsque Git n'est pas
  // installé dans l'image de production.
  await ensureWorkspaceGitignore(workspacePath);

  try {
    await git(["rev-parse", "--git-dir"], workspacePath);
    // Déjà initialisé — s'assurer que l'identité est configurée
    await git(["config", "user.email", "comptaos@localhost"], workspacePath).catch(() => {});
    await git(["config", "user.name", "ComptaOS"], workspacePath).catch(() => {});
  } catch {
    // Nouveau dépôt
    await git(["init"], workspacePath);
    await git(["config", "user.email", "comptaos@localhost"], workspacePath);
    await git(["config", "user.name", "ComptaOS"], workspacePath);

    try {
      await git(["add", "-A"], workspacePath);
      await git(["commit", "-m", "init: initialisation du workspace ComptaOS"], workspacePath);
    } catch {
      // Le dossier peut être vide — on ignore
    }
  }
}

/**
 * Ajoute tous les fichiers modifiés et crée un commit.
 * Ne plante jamais (les erreurs git ne doivent pas bloquer l'API).
 */
export async function autoCommit(workspacePath: string, message: string): Promise<void> {
  try {
    await git(["add", "-A"], workspacePath);
    const status = await git(["status", "--porcelain"], workspacePath);
    if (!status) return; // Rien à commiter
    await git(["commit", "-m", message], workspacePath);
  } catch (err) {
    console.warn("[git] autoCommit ignoré:", (err as Error).message?.slice(0, 120));
  }
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
  filesChanged: number;
}

const SEP = "\x1f"; // Unit Separator ASCII — impossible dans un message de commit standard

/** Retourne les N derniers commits du dépôt. */
export async function getLog(workspacePath: string, n = 100): Promise<GitCommit[]> {
  try {
    const format = `%H${SEP}%h${SEP}%ai${SEP}%s${SEP}%an`;
    const out = await git(["log", `--pretty=format:${format}`, "-n", String(n)], workspacePath);
    if (!out) return [];

    // Récupérer le nombre de fichiers changés par commit (--shortstat)
    const statOut = await git(
      ["log", "--pretty=format:%H", "--shortstat", "-n", String(n)],
      workspacePath
    );
    const statMap: Record<string, number> = {};
    const statLines = statOut.split("\n");
    let currentHash = "";
    for (const line of statLines) {
      if (/^[0-9a-f]{40}$/i.test(line.trim())) {
        currentHash = line.trim();
      } else {
        const m = line.match(/(\d+) file/);
        if (m && currentHash) {
          statMap[currentHash] = parseInt(m[1], 10);
        }
      }
    }

    return out
      .split("\n")
      .map((line) => {
        const parts = line.split(SEP);
        const hash = parts[0] ?? "";
        return {
          hash,
          shortHash: parts[1] ?? "",
          date: parts[2] ?? "",
          message: parts[3] ?? "",
          author: parts[4] ?? "",
          filesChanged: statMap[hash] ?? 0,
        };
      })
      .filter((c) => c.hash);
  } catch {
    return [];
  }
}

/** Retourne le diff complet (stat + patch) d'un commit. */
export async function getDiff(workspacePath: string, hash: string): Promise<string> {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error("hash invalide");
  try {
    return await git(["show", hash, "--stat", "--patch", "--no-color"], workspacePath);
  } catch {
    return "";
  }
}

/** Retourne true si le workspace est un dépôt git valide avec au moins un commit. */
export async function hasRepo(workspacePath: string): Promise<boolean> {
  try {
    await git(["rev-parse", "HEAD"], workspacePath);
    return true;
  } catch {
    return false;
  }
}

// ── Synchronisation distante ──────────────────────────────────────────────────

export type GitProvider = "github" | "gitlab" | "gitea" | "custom";

export interface GitSyncConfig {
  provider: GitProvider;
  remoteUrl: string;   // URL sans token (ex: https://github.com/user/repo.git)
  token: string;       // Token d'accès personnel (stocké localement, non commité)
  branch: string;      // Branche cible (ex: main)
}

export interface GitSyncStatus {
  configured: boolean;
  provider?: GitProvider;
  remoteUrl?: string;
  branch?: string;
  hasToken: boolean;
  ahead: number;
  behind: number;
  lastSync?: string;
}

/** Chemin du fichier de config sync (dans le dossier .git — jamais commité). */
function syncConfigPath(workspacePath: string): string {
  return path.join(workspacePath, ".git", "comptaos_sync.json");
}

/** Lit la config de synchronisation distante. */
export async function readSyncConfig(workspacePath: string): Promise<GitSyncConfig | null> {
  try {
    const raw = await fs.readFile(syncConfigPath(workspacePath), "utf-8");
    return JSON.parse(raw) as GitSyncConfig;
  } catch {
    return null;
  }
}

/** Écrit la config de synchronisation distante. */
export async function writeSyncConfig(workspacePath: string, config: GitSyncConfig): Promise<void> {
  await fs.writeFile(syncConfigPath(workspacePath), JSON.stringify(config, null, 2), "utf-8");
}

/** Supprime la config de synchronisation (déconnexion). */
export async function deleteSyncConfig(workspacePath: string): Promise<void> {
  try {
    await fs.unlink(syncConfigPath(workspacePath));
  } catch { /* déjà absent */ }
  try {
    await git(["remote", "remove", "origin"], workspacePath);
  } catch { /* pas de remote */ }
}

/** Construit l'URL authentifiée pour git (token intégré, jamais stocké dans .git/config). */
function buildAuthUrl(remoteUrl: string, token: string): string {
  const url = new URL(remoteUrl);
  url.username = token;
  url.password = "x-oauth-basic";
  return url.toString();
}

/** Configure le remote dans git (sans token dans l'URL stockée). */
async function ensureRemote(workspacePath: string, remoteUrl: string): Promise<void> {
  try {
    await git(["remote", "set-url", "origin", remoteUrl], workspacePath);
  } catch {
    try {
      await git(["remote", "add", "origin", remoteUrl], workspacePath);
    } catch { /* déjà configuré */ }
  }
}

/** Teste la connexion sans modifier l'état local. */
export async function testRemoteConnection(workspacePath: string, config: GitSyncConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const authUrl = buildAuthUrl(config.remoteUrl, config.token);
    await git(["ls-remote", "--heads", authUrl], workspacePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message?.slice(0, 200) };
  }
}

/** Retourne le statut de synchronisation (ahead/behind). */
export async function getSyncStatus(workspacePath: string): Promise<GitSyncStatus> {
  const config = await readSyncConfig(workspacePath);

  if (!config) {
    return { configured: false, hasToken: false, ahead: 0, behind: 0 };
  }

  let ahead = 0;
  let behind = 0;

  try {
    await ensureRemote(workspacePath, config.remoteUrl);
    const authUrl = buildAuthUrl(config.remoteUrl, config.token);
    await git(["fetch", authUrl, "--quiet"], workspacePath);

    const rev = await git(
      ["rev-list", "--left-right", "--count", `origin/${config.branch}...HEAD`],
      workspacePath
    ).catch(() => "0\t0");

    const parts = rev.split("\t");
    behind = parseInt(parts[0] ?? "0", 10);
    ahead  = parseInt(parts[1] ?? "0", 10);
  } catch { /* remote inaccessible — on ignore */ }

  return {
    configured: true,
    provider: config.provider,
    remoteUrl: config.remoteUrl,
    branch: config.branch,
    hasToken: !!config.token,
    ahead,
    behind,
  };
}

/** Pousse les commits locaux vers le remote. */
export async function syncPush(workspacePath: string): Promise<{ ok: boolean; message: string }> {
  const config = await readSyncConfig(workspacePath);
  if (!config) return { ok: false, message: "Synchronisation non configurée" };

  try {
    await ensureRemote(workspacePath, config.remoteUrl);
    const authUrl = buildAuthUrl(config.remoteUrl, config.token);
    const result = await git(["push", authUrl, `HEAD:${config.branch}`], workspacePath);
    return { ok: true, message: result || "Push effectué" };
  } catch (err) {
    return { ok: false, message: (err as Error).message?.slice(0, 300) ?? "Erreur inconnue" };
  }
}

/** Récupère et intègre les commits distants (rebase). */
export async function syncPull(workspacePath: string): Promise<{ ok: boolean; message: string }> {
  const config = await readSyncConfig(workspacePath);
  if (!config) return { ok: false, message: "Synchronisation non configurée" };

  try {
    await ensureRemote(workspacePath, config.remoteUrl);
    const authUrl = buildAuthUrl(config.remoteUrl, config.token);
    const result = await git(["pull", "--rebase", authUrl, config.branch], workspacePath);
    return { ok: true, message: result || "Pull effectué" };
  } catch (err) {
    return { ok: false, message: (err as Error).message?.slice(0, 300) ?? "Erreur inconnue" };
  }
}
