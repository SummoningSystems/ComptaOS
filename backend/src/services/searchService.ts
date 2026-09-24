import path from "path";
import fs from "fs/promises";
import { Dirent } from "fs";
import { loadAllTransactions } from "./transactionService.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { Transaction } from "../types/index.js";

export interface SearchResult {
  type: "transaction" | "file";
  score: number;
  // transaction fields
  transaction?: Transaction;
  // file fields
  filePath?: string;
  fileName?: string;
  extension?: string;
  excerpt?: string;
}

/**
 * Recherche fulltext dans les transactions et les fichiers du workspace.
 */
export async function search(query: string, maxResults = 30): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  // ── Transactions ───────────────────────────────────────────────────────────
  const transactions = await loadAllTransactions();
  for (const txn of transactions) {
    let score = 0;
    if (txn.label.toLowerCase().includes(q)) score += txn.label.toLowerCase().startsWith(q) ? 3 : 2;
    if (txn.category.toLowerCase().includes(q)) score += 1;
    if (txn.notes?.toLowerCase().includes(q)) score += 1;
    if (txn.tags?.some((t) => t.toLowerCase().includes(q))) score += 1;
    if (txn.id.toLowerCase().includes(q)) score += 1;
    if (String(txn.amount_ttc).includes(q)) score += 1;
    if (score > 0) results.push({ type: "transaction", score, transaction: txn });
  }

  // ── Fichiers du workspace ─────────────────────────────────────────────────
  const fileResults = await searchFiles(getWorkspaceRoot(), q, getWorkspaceRoot());
  results.push(...fileResults);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

async function searchFiles(dir: string, query: string, root: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let entries: Dirent[];

  try {
    entries = await fs.readdir(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }

  for (const entry of entries) {
    const name = entry.name as string;
    // Search only business documents. Never traverse credentials, metadata or links.
    if(name.startsWith(".")||name.startsWith("_")||entry.isSymbolicLink()||/^(settings|preferences|scope-data|companies|backups|plugins)$/i.test(name)||/^(ecosystem|receipt-inbox|auth|banking|config|secret|token)/i.test(name))continue;
    const abs = path.join(dir, name);
    const rel = path.relative(root, abs).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      results.push(...await searchFiles(abs, query, root));
      continue;
    }

    const ext = path.extname(name).slice(1).toLowerCase();
    const textExtensions = ["yaml", "yml", "md", "json", "csv", "txt"];

    let score = 0;
    let excerpt: string | undefined;

    // Correspondance sur le nom de fichier
    if (name.toLowerCase().includes(query)) score += 2;

    // Correspondance dans le contenu (uniquement pour fichiers texte)
    if (textExtensions.includes(ext)) {
      try {
        const content = (await fs.readFile(abs, "utf-8")) as string;
        const lower = content.toLowerCase();
        if (lower.includes(query)) {
          score += 1;
          const idx = lower.indexOf(query);
          const start = Math.max(0, idx - 40);
          const end = Math.min(content.length, idx + query.length + 80);
          excerpt = "…" + content.slice(start, end).replace(/\n/g, " ") + "…";
        }
      } catch {
        // fichier illisible
      }
    }

    if (score > 0) {
      results.push({
        type: "file",
        score,
        filePath: rel,
        fileName: name,
        extension: ext,
        excerpt,
      });
    }
  }

  return results;
}
