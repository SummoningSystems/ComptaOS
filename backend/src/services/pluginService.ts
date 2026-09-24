/**
 * pluginService.ts
 * Système de plugins ComptaOS.
 *
 * Un plugin est un dossier dans <workspace>/plugins/<name>/ contenant :
 *   - manifest.json  : métadonnées (name, version, description, author, hooks)
 *   - plugin.cjs     : code CommonJS exécuté dans une sandbox vm (optionnel)
 *
 * Hooks disponibles :
 *   "hook-transaction"  : transforme/enrichit les transactions à l'import
 *   "hook-import"       : post-traitement après import CSV
 *   "report-generator"  : génère un rapport personnalisé
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import vm from "vm";
import { getWorkspaceRoot } from "./fileSystem.js";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  hooks: Array<"hook-transaction" | "hook-import" | "report-generator">;
  enabled: boolean;
}

function getPluginsDir(): string {
  return join(getWorkspaceRoot(), "plugins");
}

function ensurePluginsDir() {
  const d = getPluginsDir();
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/** Liste tous les plugins disponibles dans le dossier plugins/ */
export function listPlugins(): PluginManifest[] {
  ensurePluginsDir();
  const dir = getPluginsDir();
  const results: PluginManifest[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(dir, entry.name, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
        results.push({ ...raw, name: entry.name });
      } catch {
        // manifest malformé — ignorer
      }
    }
  } catch {
    // dossier inaccessible
  }

  return results;
}

/** Active ou désactive un plugin (persiste dans manifest.json) */
export function setPluginEnabled(name: string, enabled: boolean): void {
  if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error("Nom de plugin invalide");
  const dir = getPluginsDir();
  const manifestPath = join(dir, name, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Plugin "${name}" introuvable`);

  const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
  raw.enabled = enabled;
  writeFileSync(manifestPath, JSON.stringify(raw, null, 2), "utf-8");
}

/** Exécute un plugin dans un sandbox vm avec un contexte limité */
export function runPlugin(
  name: string,
  hook: string,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if(!/^[a-zA-Z0-9_-]+$/.test(name)||!["hook-transaction","hook-import","report-generator"].includes(hook))throw new Error("Plugin ou hook invalide");
  const manifest=listPlugins().find(p=>p.name===name);
  if(!manifest?.enabled||!manifest.hooks.includes(hook as PluginManifest["hooks"][number]))throw new Error("Plugin désactivé ou hook non déclaré");
  const dir = getPluginsDir();
  const codePath = join(dir, name, "plugin.cjs");
  if (!existsSync(codePath)) return context;

  const code = readFileSync(codePath, "utf-8");

  // Sandbox strict : pas d'accès process/require/fs
  const sandbox: Record<string, unknown> = {
    module: { exports: {} as Record<string, unknown> },
    exports: {} as Record<string, unknown>,
    context: JSON.parse(JSON.stringify(context)), // deep copy
    result: null as unknown,
    console: { log: () => {}, error: () => {}, warn: () => {} },
  };

  const script = new vm.Script(`
    (function(module, exports, context, console) {
      ${code}
      if (typeof exports['${hook}'] === 'function') {
        result = exports['${hook}'](context);
      } else {
        result = context;
      }
    })(module, exports, context, console);
  `);

  try {
    vm.createContext(sandbox);
    script.runInContext(sandbox, { timeout: 2000 });
    return (sandbox.result as Record<string, unknown>) ?? context;
  } catch (err) {
    console.warn(`[plugin:${name}] erreur lors de l'exécution du hook "${hook}":`, (err as Error).message);
    return context;
  }
}

/** Crée un plugin exemple si le dossier plugins est vide */
export function createExamplePlugin(): void {
  ensurePluginsDir();
  const dir = join(getPluginsDir(), "example-plugin");
  if (existsSync(dir)) return;

  mkdirSync(dir, { recursive: true });

  const manifest: PluginManifest = {
    name: "example-plugin",
    version: "1.0.0",
    description: "Plugin exemple — ajoute un tag 'reviewed' aux transactions > 500€",
    author: "ComptaOS",
    hooks: ["hook-transaction"],
    enabled: false,
  };

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  writeFileSync(join(dir, "plugin.cjs"), `// Exemple de plugin ComptaOS
// Hook "hook-transaction" : reçoit une transaction, retourne la transaction (éventuellement modifiée)
exports["hook-transaction"] = function(transaction) {
  if (transaction.amount_ttc && Math.abs(transaction.amount_ttc) > 500) {
    transaction.notes = (transaction.notes ? transaction.notes + " " : "") + "[reviewed]";
  }
  return transaction;
};
`, "utf-8");
}
