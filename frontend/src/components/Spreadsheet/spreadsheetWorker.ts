/**
 * spreadsheetWorker.ts — Web Worker pour le calcul des formules HyperFormula.
 * Tourne dans un thread OS séparé : l'UI ne gèle jamais pendant la réévaluation.
 *
 * Protocol postMessage :
 *   → { type: "COMPUTE", sheets, activeSheetIdx, vars, version }
 *   ← { type: "RESULT",  computed, version }
 *   ← { type: "ERROR",   message, version }
 */

import { HyperFormula } from "hyperformula";

// ── Helpers (dupliqués ici pour être auto-contenus dans le worker) ──────────

function parseCell(key: string): { col: number; row: number } | null {
  const m = key.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return {
    col: m[1].split("").reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1,
    row: parseInt(m[2], 10) - 1,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function normalizeFormulaReferences(formula: string, sheetNames: string[]): string {
  if (!formula.startsWith("=")) return formula;

  let normalized = formula;
  const namesToQuote = [...sheetNames]
    .filter((name) => /[^A-Za-z0-9_]/.test(name))
    .sort((a, b) => b.length - a.length);

  for (const sheetName of namesToQuote) {
    normalized = normalized.replace(
      new RegExp(`${escapeRegExp(sheetName)}!`, "g"),
      `${quoteSheetName(sheetName)}!`
    );
  }

  return normalized;
}

function formatHyperFormulaValue(raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" || typeof raw === "number") return raw;

  if (typeof raw === "object") {
    const maybeError = raw as { value?: string; message?: string };
    if (typeof maybeError.value === "string") return maybeError.value;
    if (typeof maybeError.message === "string") return `#ERR:${maybeError.message.slice(0, 16)}`;
  }

  return String(raw);
}

// ── Types (inline pour ne pas importer spreadsheetTypes) ────────────────────

interface WorkerCell {
  value: string | number | null;
}

interface WorkerSheet {
  name: string;
  cells: Record<string, WorkerCell>;
}

interface ComputeRequest {
  type: "COMPUTE";
  sheets: WorkerSheet[];
  activeSheetIdx: number;
  vars: Record<string, number>;
  version: number;
}

// ── Handler principal ───────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<ComputeRequest>) => {
  const { type, sheets, activeSheetIdx, vars, version } = e.data;
  if (type !== "COMPUTE") return;

  try {
    // 1. Construire toutes les feuilles pour permettre les références inter-feuilles.
    const sourceSheets = Array.isArray(sheets) ? sheets : [];
    const normalizedSheetNames = sourceSheets.map((src, i) => src.name?.trim() || `Sheet${i + 1}`);
    const safeActiveSheetIdx = Math.min(
      Math.max(activeSheetIdx ?? 0, 0),
      Math.max(sourceSheets.length - 1, 0)
    );
    const hfSheets: Record<string, (string | number | null)[][]> = {};

    for (let i = 0; i < sourceSheets.length; i++) {
      const src = sourceSheets[i];
      const entries = Object.entries(src.cells ?? {}).filter(
        ([, cell]) => cell.value !== null && cell.value !== undefined && cell.value !== ""
      );

      let maxRow = 0;
      let maxCol = 0;
      for (const [key] of entries) {
        const pos = parseCell(key);
        if (pos) {
          if (pos.row > maxRow) maxRow = pos.row;
          if (pos.col > maxCol) maxCol = pos.col;
        }
      }

      const usedRows = Math.max(1, maxRow + 1);
      const usedCols = Math.max(1, maxCol + 1);

      const matrix: (string | number | null)[][] = Array.from(
        { length: usedRows },
        () => Array(usedCols).fill(null)
      );

      for (const [key, cell] of entries) {
        const pos = parseCell(key);
        if (pos && pos.row < usedRows && pos.col < usedCols) {
          matrix[pos.row][pos.col] = typeof cell.value === "string"
            ? normalizeFormulaReferences(cell.value, normalizedSheetNames)
            : cell.value;
        }
      }

      const sheetName = normalizedSheetNames[i];
      hfSheets[sheetName] = matrix;
    }

    if (Object.keys(hfSheets).length === 0) {
      hfSheets.Sheet1 = [[null]];
    }

    // 2. Instancier HyperFormula
    const hf = HyperFormula.buildFromSheets(hfSheets, {
      licenseKey: "gpl-v3",
      // Désactiver les fonctions inutilisées pour réduire le temps d'init
      functionPlugins: [],
    });

    // 4. Injecter les variables comptables (ex: TOTAL_DEPENSES)
    for (const [name, value] of Object.entries(vars)) {
      try {
        hf.addNamedExpression(name.toUpperCase(), value.toString());
      } catch {
        /* ignore si déjà défini */
      }
    }

    // 4. Évaluer uniquement les cellules non vides de la feuille active,
    // tout en permettant des références vers les autres feuilles.
    const activeSheet = sourceSheets[safeActiveSheetIdx];
    const computed: Record<string, string | number | null> = {};
    if (!activeSheet) {
      hf.destroy();
      self.postMessage({ type: "RESULT", computed, version });
      return;
    }

    const activeSheetName = activeSheet.name?.trim() || `Sheet${safeActiveSheetIdx + 1}`;
    const activeSheetId = hf.getSheetId(activeSheetName);
    if (activeSheetId === undefined) {
      hf.destroy();
      self.postMessage({
        type: "ERROR",
        message: `Feuille introuvable: ${activeSheetName}`,
        version,
      });
      return;
    }
    const activeCells = activeSheet.cells ?? {};

    for (const [key, cell] of Object.entries(activeCells)) {
      if (!cell.value && cell.value !== 0) continue;
      const pos = parseCell(key);
      if (!pos) continue;

      try {
        const raw = hf.getCellValue({ sheet: activeSheetId, row: pos.row, col: pos.col });
        computed[key] = formatHyperFormulaValue(raw);
      } catch {
        computed[key] = cell.value;
      }
    }

    // 5. Libérer la mémoire HyperFormula
    hf.destroy();

    // 6. Renvoyer le résultat au thread principal
    self.postMessage({ type: "RESULT", computed, version });

  } catch (err) {
    self.postMessage({
      type: "ERROR",
      message: (err as Error).message ?? "Erreur inconnue",
      version,
    });
  }
};
