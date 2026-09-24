import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import type { SpreadsheetDoc, SpreadsheetSheet, SpreadsheetCell, CellFormat } from "./spreadsheetTypes";
import {createSpreadsheetApi} from "../../api/spreadsheetClient";
import {useWorkspaceApi} from "../../api/WorkspaceApi";

// ── Constantes ────────────────────────────────────────────────────────────────

const DEFAULT_COLS = 26;
const DEFAULT_ROWS = 50;
const DEFAULT_COL_WIDTH = 110;
const ROW_HEIGHT = 24;
const HEADER_COL_WIDTH = 40;
const MAX_HISTORY = 20;

const PRESET_BG_COLORS = [
  "transparent",
  "#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa",
  "#fde047", "#86efac", "#93c5fd", "#f87171", "#c084fc", "#fb923c",
];

const CATEGORY_COLORS: Record<string, string> = {
  revenus: "text-green-400",
  depenses: "text-red-400",
  solde: "text-blue-400",
  tva: "text-yellow-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellKey(col: number, row: number): string {
  return `${colLetter(col)}${row + 1}`;
}

function parseCell(key: string): { col: number; row: number } | null {
  const m = key.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return {
    col: m[1].split("").reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1,
    row: parseInt(m[2], 10) - 1,
  };
}

function getRangeKeys(start: string, end: string): string[] {
  const s = parseCell(start);
  const e = parseCell(end);
  if (!s || !e) return start ? [start] : [];
  const r1 = Math.min(s.row, e.row), r2 = Math.max(s.row, e.row);
  const c1 = Math.min(s.col, e.col), c2 = Math.max(s.col, e.col);
  const out: string[] = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++)
      out.push(cellKey(c, r));
  return out;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let inQ = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cell += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        row.push(cell); cell = "";
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function formatNumber(val: number, fmt?: CellFormat["numberFormat"]): string {
  if (fmt === "euro")
    return val.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  if (fmt === "percent")
    return val.toFixed(2) + " %";
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}

/** Ajuste les références de cellules dans une formule lors d'une copie/déplacement */
function adjustFormula(formula: string, deltaRow: number, deltaCol: number): string {
  if (!formula.startsWith("=")) return formula;
  return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (_, dc, colStr, dr, rowStr) => {
    const col = colStr.split("").reduce((a: number, ch: string) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = parseInt(rowStr) - 1;
    const newCol = dc ? col : col + deltaCol;
    const newRow = dr ? row : row + deltaRow;
    return `${dc}${colLetter(Math.max(0, newCol))}${dr}${Math.max(1, newRow + 1)}`;
  });
}

// ── Liste des fonctions pour l'autocomplétion ─────────────────────────────────
const FORMULA_LIST: { name: string; usage: string; desc: string }[] = [
  { name: "ABS",         usage: "ABS(nombre)",                        desc: "Valeur absolue" },
  { name: "AND",         usage: "AND(cond1, cond2…)",                 desc: "ET logique" },
  { name: "AVERAGE",     usage: "AVERAGE(plage)",                     desc: "Moyenne" },
  { name: "AVERAGEIF",   usage: "AVERAGEIF(plage, critère, moy)",     desc: "Moyenne conditionnelle" },
  { name: "AVERAGEIFS",  usage: "AVERAGEIFS(moy, plage1, crit1…)",   desc: "Moyenne multi-critères" },
  { name: "CEILING",     usage: "CEILING(nb, palier)",                desc: "Arrondi supérieur au palier" },
  { name: "CHOOSE",      usage: "CHOOSE(index, val1, val2…)",         desc: "Sélection par index" },
  { name: "CONCATENATE", usage: "CONCATENATE(texte1, texte2…)",       desc: "Concaténer" },
  { name: "COUNT",       usage: "COUNT(plage)",                       desc: "Nombre de valeurs numériques" },
  { name: "COUNTA",      usage: "COUNTA(plage)",                      desc: "Cellules non vides" },
  { name: "COUNTBLANK",  usage: "COUNTBLANK(plage)",                  desc: "Cellules vides" },
  { name: "COUNTIF",     usage: "COUNTIF(plage, critère)",            desc: "Compter selon condition" },
  { name: "COUNTIFS",    usage: "COUNTIFS(plage1, crit1, plage2…)",  desc: "Compter multi-critères" },
  { name: "DATE",        usage: "DATE(année, mois, jour)",            desc: "Construire une date" },
  { name: "DATEDIF",     usage: "DATEDIF(début, fin, unité)",         desc: "Différence de dates" },
  { name: "DAY",         usage: "DAY(date)",                          desc: "Jour du mois" },
  { name: "FLOOR",       usage: "FLOOR(nb, palier)",                  desc: "Arrondi inférieur au palier" },
  { name: "IF",          usage: "IF(condition, si_vrai, si_faux)",    desc: "Condition" },
  { name: "IFERROR",     usage: "IFERROR(valeur, si_erreur)",         desc: "Gestion d'erreur" },
  { name: "IFS",         usage: "IFS(cond1, val1, cond2, val2…)",    desc: "Conditions multiples" },
  { name: "INDEX",       usage: "INDEX(plage, ligne, colonne)",       desc: "Valeur à index" },
  { name: "INT",         usage: "INT(nombre)",                        desc: "Partie entière" },
  { name: "ISBLANK",     usage: "ISBLANK(cellule)",                   desc: "Cellule vide ?" },
  { name: "ISERROR",     usage: "ISERROR(valeur)",                    desc: "Erreur ?" },
  { name: "ISNUMBER",    usage: "ISNUMBER(valeur)",                   desc: "Nombre ?" },
  { name: "ISTEXT",      usage: "ISTEXT(valeur)",                     desc: "Texte ?" },
  { name: "LEFT",        usage: "LEFT(texte, n)",                     desc: "Début de chaîne" },
  { name: "LEN",         usage: "LEN(texte)",                         desc: "Longueur" },
  { name: "LOWER",       usage: "LOWER(texte)",                       desc: "Minuscules" },
  { name: "MATCH",       usage: "MATCH(valeur, plage, type)",         desc: "Position d'une valeur" },
  { name: "MAX",         usage: "MAX(plage)",                         desc: "Maximum" },
  { name: "MEDIAN",      usage: "MEDIAN(plage)",                      desc: "Médiane" },
  { name: "MID",         usage: "MID(texte, début, n)",               desc: "Sous-chaîne" },
  { name: "MIN",         usage: "MIN(plage)",                         desc: "Minimum" },
  { name: "MOD",         usage: "MOD(nombre, diviseur)",              desc: "Reste de division" },
  { name: "MONTH",       usage: "MONTH(date)",                        desc: "Mois" },
  { name: "NOT",         usage: "NOT(condition)",                     desc: "NON logique" },
  { name: "NOW",         usage: "NOW()",                              desc: "Date et heure actuelles" },
  { name: "OR",          usage: "OR(cond1, cond2…)",                  desc: "OU logique" },
  { name: "POWER",       usage: "POWER(nombre, exposant)",            desc: "Puissance" },
  { name: "PRODUCT",     usage: "PRODUCT(nb1, nb2…)",                 desc: "Produit" },
  { name: "PROPER",      usage: "PROPER(texte)",                      desc: "Première lettre en majuscule" },
  { name: "RIGHT",       usage: "RIGHT(texte, n)",                    desc: "Fin de chaîne" },
  { name: "ROUND",       usage: "ROUND(nombre, décimales)",           desc: "Arrondi" },
  { name: "ROUNDDOWN",   usage: "ROUNDDOWN(nombre, décimales)",       desc: "Arrondi inférieur" },
  { name: "ROUNDUP",     usage: "ROUNDUP(nombre, décimales)",         desc: "Arrondi supérieur" },
  { name: "SQRT",        usage: "SQRT(nombre)",                       desc: "Racine carrée" },
  { name: "STDEV",       usage: "STDEV(plage)",                       desc: "Écart-type" },
  { name: "SUBSTITUTE",  usage: "SUBSTITUTE(texte, ancien, nouveau)", desc: "Remplacer texte" },
  { name: "SUM",         usage: "SUM(plage)",                         desc: "Somme" },
  { name: "SUMIF",       usage: "SUMIF(plage, critère, somme_plage)", desc: "Somme conditionnelle" },
  { name: "SUMIFS",      usage: "SUMIFS(somme, plage1, crit1…)",      desc: "Somme multi-critères" },
  { name: "TEXT",        usage: "TEXT(valeur, format)",               desc: "Formater en texte" },
  { name: "TODAY",       usage: "TODAY()",                            desc: "Date du jour" },
  { name: "TRIM",        usage: "TRIM(texte)",                        desc: "Supprimer espaces" },
  { name: "UPPER",       usage: "UPPER(texte)",                       desc: "Majuscules" },
  { name: "VLOOKUP",     usage: "VLOOKUP(val, table, col, exact)",    desc: "Recherche verticale" },
  { name: "WEEKDAY",     usage: "WEEKDAY(date, type)",                desc: "Jour de la semaine" },
  { name: "YEAR",        usage: "YEAR(date)",                         desc: "Année" },
];

// ── Composant principal ────────────────────────────────────────────────────────

export function SpreadsheetView({apiBase}:{apiBase?:string} = {}) {
  const {apiUrl}=useWorkspaceApi();
  const base=apiBase??apiUrl("spreadsheets");
  const {fetchSpreadsheets,fetchSpreadsheet,createSpreadsheet,saveSpreadsheet,deleteSpreadsheetApi,fetchAccountingVariables}=useMemo(()=>createSpreadsheetApi(base),[base]);
  const [loadError,setLoadError]=useState("");
  const [docs, setDocs] = useState<Omit<SpreadsheetDoc, "sheets">[]>([]);
  const [activeDoc, setActiveDoc] = useState<SpreadsheetDoc | null>(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [accountingVars, setAccountingVars] = useState<Record<string, number>>({});
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [formulaBarValue, setFormulaBarValue] = useState("");
  const [computedValues, setComputedValues] = useState<Record<string, string | number | null>>({});
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [showVarsPanel, setShowVarsPanel] = useState(true);
  const [varsSearch, setVarsSearch] = useState("");
  const [newSheetName, setNewSheetName] = useState("");
  const [addingSheet, setAddingSheet] = useState(false);
  const [renamingSheet, setRenamingSheet] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteIdx, setAutocompleteIdx] = useState(0);
  // Sélection multi Ctrl+clic
  const [ctrlKeys, setCtrlKeys] = useState<Set<string>>(new Set());
  // Fill drag (étirer le coin bas-droit)
  const [fillDragTarget, setFillDragTarget] = useState<string | null>(null);
  // Move drag (déplacer la sélection)
  const [moveDragActive, setMoveDragActive] = useState(false);
  const [moveDragTarget, setMoveDragTarget] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{
    cells: Record<string, SpreadsheetCell>;
    originRow: number;
    originCol: number;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStackRef = useRef<SpreadsheetSheet[][]>([]);
  const redoStackRef = useRef<SpreadsheetSheet[][]>([]);
  const resizingRef = useRef<{ col: number; startX: number; startWidth: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Refs pour les opérations de drag (accès depuis les handlers document)
  const fillDragStateRef = useRef<{ srcStart: string; srcEnd: string | null } | null>(null);
  const fillTargetSnapRef = useRef<string | null>(null);
  const moveDragStateRef = useRef<{ srcKeys: string[]; offset: { r: number; c: number } } | null>(null);
  const moveTargetSnapRef = useRef<string | null>(null);
  const potentialMoveRef = useRef<{ startX: number; startY: number; srcKeys: string[]; offset: { r: number; c: number } } | null>(null);
  const moveDragBlockClickRef = useRef(false);
  const applyFillRef = useRef<(s: string, e: string | null, t: string) => void>(() => {});
  const applyMoveRef = useRef<(keys: string[], offset: { r: number; c: number }, t: string) => void>(() => {});
  const recomputeVersionRef = useRef(0);
  // Web Worker pour HyperFormula — thread séparé, UI non bloquée
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    const w = new Worker(new URL("./spreadsheetWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  const sheet = activeDoc?.sheets[activeSheetIdx] ?? null;

  const rangeKeys = selectedCell && selectionEnd
    ? getRangeKeys(selectedCell, selectionEnd)
    : selectedCell ? [selectedCell] : [];
  const rangeSet = new Set(rangeKeys);

  // Autocomplétion : mot (lettres) en cours de frappe à la fin de la formule
  const acActiveWord = (() => {
    if (!editingCell || !editValue.startsWith("=")) return null;
    const match = editValue.match(/([A-Za-z_]+)$/);
    return match ? match[1].toUpperCase() : null;
  })();
  const acSuggestions = acActiveWord
    ? FORMULA_LIST.filter(f => f.name.startsWith(acActiveWord))
    : [];
  const showAC = autocompleteOpen && acSuggestions.length > 0;

  // Cellule en bas-à-droite de la sélection courante (pour le fill handle)
  const selectionBR = (() => {
    const s = selectedCell ? parseCell(selectedCell) : null;
    const e = selectionEnd ? parseCell(selectionEnd) : s;
    if (!s) return null;
    return cellKey(Math.max(s.col, e?.col ?? s.col), Math.max(s.row, e?.row ?? s.row));
  })();

  // Plage de prévisualisation du fill drag
  const fillPreviewSet = (() => {
    if (!fillDragTarget || !fillDragStateRef.current) return new Set<string>();
    const { srcStart, srcEnd } = fillDragStateRef.current;
    const srcCoords = (srcEnd ? getRangeKeys(srcStart, srcEnd) : [srcStart])
      .map(k => parseCell(k)).filter(Boolean) as { col: number; row: number }[];
    if (srcCoords.length === 0) return new Set<string>();
    const srcMinRow = Math.min(...srcCoords.map(c => c.row));
    const srcMaxRow = Math.max(...srcCoords.map(c => c.row));
    const srcMinCol = Math.min(...srcCoords.map(c => c.col));
    const srcMaxCol = Math.max(...srcCoords.map(c => c.col));
    const tgt = parseCell(fillDragTarget);
    if (!tgt) return new Set<string>();
    if (tgt.row > srcMaxRow) return new Set(getRangeKeys(cellKey(srcMinCol, srcMaxRow + 1), cellKey(srcMaxCol, tgt.row)));
    if (tgt.row < srcMinRow) return new Set(getRangeKeys(cellKey(srcMinCol, tgt.row), cellKey(srcMaxCol, srcMinRow - 1)));
    if (tgt.col > srcMaxCol) return new Set(getRangeKeys(cellKey(srcMaxCol + 1, srcMinRow), cellKey(tgt.col, srcMaxRow)));
    if (tgt.col < srcMinCol) return new Set(getRangeKeys(cellKey(tgt.col, srcMinRow), cellKey(srcMinCol - 1, srcMaxRow)));
    return new Set<string>();
  })();

  // Plage de destination prévisualisée pour le move drag
  const moveSrcSet = moveDragActive && moveDragStateRef.current
    ? new Set(moveDragStateRef.current.srcKeys) : new Set<string>();
  const movePreviewSet = (() => {
    if (!moveDragActive || !moveDragTarget || !moveDragStateRef.current) return new Set<string>();
    const { srcKeys, offset } = moveDragStateRef.current;
    const tgt = parseCell(moveDragTarget);
    if (!tgt) return new Set<string>();
    const coordsList = srcKeys.map(k => parseCell(k)).filter(Boolean) as { col: number; row: number }[];
    if (coordsList.length === 0) return new Set<string>();
    const srcMinRow = Math.min(...coordsList.map(c => c.row));
    const srcMinCol = Math.min(...coordsList.map(c => c.col));
    const srcMaxRow = Math.max(...coordsList.map(c => c.row));
    const srcMaxCol = Math.max(...coordsList.map(c => c.col));
    const dstMinRow = tgt.row - offset.r;
    const dstMinCol = tgt.col - offset.c;
    if (dstMinRow < 0 || dstMinCol < 0) return new Set<string>();
    return new Set(getRangeKeys(
      cellKey(dstMinCol, dstMinRow),
      cellKey(dstMinCol + (srcMaxCol - srcMinCol), dstMinRow + (srcMaxRow - srcMinRow))
    ));
  })();

  useEffect(() => {
    fetchSpreadsheets().then(setDocs).catch(e=>setLoadError(String(e.message)));
    fetchAccountingVariables().then(setAccountingVars).catch(e=>setLoadError(String(e.message)));
  }, [fetchSpreadsheets,fetchAccountingVariables]);

  const recompute = useCallback((doc: SpreadsheetDoc, sheetIdx: number, vars: Record<string, number>) => {
    const version = ++recomputeVersionRef.current;
    setIsRecomputing(true);

    const worker = workerRef.current;
    if (!worker) {
      setIsRecomputing(false);
      return;
    }

    // Envoyer les données au worker (thread séparé)
    worker.postMessage({
      type: "COMPUTE",
      sheets: doc.sheets.map((sheetItem) => ({
        name: sheetItem.name,
        cells: sheetItem.cells,
      })),
      activeSheetIdx: sheetIdx,
      vars,
      version,
    });

    // Résultat unique pour cette version
    const onMessage = (e: MessageEvent) => {
      const { type, computed, version: v, message } = e.data;
      if (v !== version) return; // réponse périmée — ignorer

      worker.removeEventListener("message", onMessage);
      setIsRecomputing(false);

      if (type === "RESULT") {
        setComputedValues(computed);
      } else if (type === "ERROR") {
        console.warn("[spreadsheetWorker] erreur de calcul:", message);
      }
    };

    worker.addEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (activeDoc) recompute(activeDoc, activeSheetIdx, accountingVars);
  }, [activeDoc, activeSheetIdx, accountingVars, recompute]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (resizingRef.current) {
        const { col, startX, startWidth } = resizingRef.current;
        const newWidth = Math.max(32, startWidth + e.clientX - startX);
        setColWidths(prev => ({ ...prev, [col]: newWidth }));
        return;
      }
      // Détection du seuil de déplacement pour le move drag
      if (potentialMoveRef.current && !moveDragStateRef.current) {
        const { startX, startY, srcKeys, offset } = potentialMoveRef.current;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) {
          moveDragStateRef.current = { srcKeys, offset };
          moveDragBlockClickRef.current = true;
          setMoveDragActive(true);
          document.body.style.cursor = "move";
          document.body.style.userSelect = "none";
        }
      }
    }
    function onMouseUp() {
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        return;
      }
      // Fin du fill drag
      if (fillDragStateRef.current) {
        const { srcStart, srcEnd } = fillDragStateRef.current;
        if (fillTargetSnapRef.current) {
          applyFillRef.current(srcStart, srcEnd, fillTargetSnapRef.current);
        }
        fillDragStateRef.current = null;
        fillTargetSnapRef.current = null;
        setFillDragTarget(null);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        return;
      }
      // Fin du move drag
      if (moveDragStateRef.current) {
        if (moveTargetSnapRef.current) {
          applyMoveRef.current(moveDragStateRef.current.srcKeys, moveDragStateRef.current.offset, moveTargetSnapRef.current);
        }
        moveDragStateRef.current = null;
        potentialMoveRef.current = null;
        moveTargetSnapRef.current = null;
        setMoveDragActive(false);
        setMoveDragTarget(null);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setTimeout(() => { moveDragBlockClickRef.current = false; }, 0);
        return;
      }
      potentialMoveRef.current = null;
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  async function loadDoc(id: string) {
    const doc = await fetchSpreadsheet(id);
    if (doc) {
      setActiveDoc(doc);
      setActiveSheetIdx(0);
      setSelectedCell(null);
      setSelectionEnd(null);
      setEditingCell(null);
      setDirty(false);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setColWidths({});
      setCtrlKeys(new Set());
    }
  }

  async function handleCreate() {
    if (!newDocName.trim()) return;
    const doc = await createSpreadsheet(newDocName.trim());
    setDocs(prev => [{ id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt }, ...prev]);
    setActiveDoc(doc);
    setActiveSheetIdx(0);
    setNewDocName("");
    setCreating(false);
    setDirty(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
  }

  function scheduleSave(doc: SpreadsheetDoc) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const saved = await saveSpreadsheet(doc);
        setActiveDoc(current=>current?.id===saved.id?saved:current);
        setDirty(false);setLoadError("");
      } catch(e) {setLoadError(e instanceof Error?e.message:"Sauvegarde impossible");}
      finally {setSaving(false);}
    }, 1500);
  }

  function pushHistory(currentSheets: SpreadsheetSheet[]) {
    undoStackRef.current.push(JSON.parse(JSON.stringify(currentSheets)));
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
    redoStackRef.current = [];
  }

  function undo() {
    if (!activeDoc || undoStackRef.current.length === 0) return;
    const prevSheets = undoStackRef.current.pop()!;
    redoStackRef.current.push(JSON.parse(JSON.stringify(activeDoc.sheets)));
    const newDoc = { ...activeDoc, sheets: prevSheets };
    setActiveDoc(newDoc);
    setDirty(true);
    scheduleSave(newDoc);
  }

  function redo() {
    if (!activeDoc || redoStackRef.current.length === 0) return;
    const nextSheets = redoStackRef.current.pop()!;
    undoStackRef.current.push(JSON.parse(JSON.stringify(activeDoc.sheets)));
    const newDoc = { ...activeDoc, sheets: nextSheets };
    setActiveDoc(newDoc);
    setDirty(true);
    scheduleSave(newDoc);
  }

  function applyDocUpdate(updatedSheet: SpreadsheetSheet) {
    if (!activeDoc) return;
    pushHistory(activeDoc.sheets);
    const newSheets = activeDoc.sheets.map((s, i) => i === activeSheetIdx ? updatedSheet : s);
    const newDoc = { ...activeDoc, sheets: newSheets };
    setActiveDoc(newDoc);
    setDirty(true);
    scheduleSave(newDoc);
  }

  function updateCell(key: string, value: string | number | null) {
    if (!sheet) return;
    const newCells = { ...sheet.cells };
    if (value === null || value === "") {
      if (newCells[key]?.format) {
        newCells[key] = { value: null, format: newCells[key].format };
      } else {
        delete newCells[key];
      }
    } else {
      newCells[key] = { ...(newCells[key] ?? {}), value };
    }
    applyDocUpdate({ ...sheet, cells: newCells });
  }

  function updateCells(updates: Record<string, SpreadsheetCell | null>) {
    if (!sheet) return;
    const newCells = { ...sheet.cells };
    for (const [key, cell] of Object.entries(updates)) {
      if (cell === null) {
        delete newCells[key];
      } else {
        newCells[key] = { ...(newCells[key] ?? {}), ...cell };
      }
    }
    applyDocUpdate({ ...sheet, cells: newCells });
  }

  function applyFormat(keys: string[], patch: Partial<CellFormat>) {
    if (!sheet) return;
    const newCells = { ...sheet.cells };
    for (const key of keys) {
      const existing = newCells[key] ?? { value: null };
      const newFmt: CellFormat = { ...(existing.format ?? {}), ...patch };
      if (newFmt.bgColor === "transparent") delete newFmt.bgColor;
      if (newFmt.numberFormat === "default") delete newFmt.numberFormat;
      const hasFmt = Object.keys(newFmt).length > 0;
      newCells[key] = { ...existing, format: hasFmt ? newFmt : undefined };
      if (newCells[key].value === null && !newCells[key].format)
        delete newCells[key];
    }
    applyDocUpdate({ ...sheet, cells: newCells });
  }

  function startEdit(key: string, initialChar?: string) {
    const raw = initialChar ?? String(sheet?.cells[key]?.value ?? "");
    setEditingCell(key);
    setEditValue(raw);
    setFormulaBarValue(raw);
    setAutocompleteOpen(false);
    setCtrlKeys(new Set());
    potentialMoveRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  /** Remplace le mot partiel en fin de formule par le nom de fonction sélectionné + "(" */
  function applyAutocompleteSuggestion(funcName: string) {
    const newValue = editValue.replace(/([A-Za-z_]+)$/, funcName + "(");
    setEditValue(newValue);
    setFormulaBarValue(newValue);
    setAutocompleteOpen(false);
    setAutocompleteIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  /** Insère la référence de cellule (ex: "B4") à la position du curseur dans la formule */
  function insertCellRefInFormula(refKey: string) {
    const input = inputRef.current;
    const cursorPos = input?.selectionStart ?? editValue.length;
    const before = editValue.slice(0, cursorPos);
    const after = editValue.slice(cursorPos);
    const newValue = before + refKey + after;
    setEditValue(newValue);
    setFormulaBarValue(newValue);
    setAutocompleteOpen(false);
    const newCursorPos = cursorPos + refKey.length;
    setTimeout(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }

  /** Étire le contenu de la plage source vers la cellule cible (fill drag) */
  function applyFillDrag(srcStart: string, srcEnd: string | null, target: string) {
    if (!sheet) return;
    const srcAllKeys = srcEnd ? getRangeKeys(srcStart, srcEnd) : [srcStart];
    const coords = srcAllKeys.map(k => parseCell(k)).filter(Boolean) as { col: number; row: number }[];
    if (coords.length === 0) return;
    const srcMinRow = Math.min(...coords.map(c => c.row));
    const srcMaxRow = Math.max(...coords.map(c => c.row));
    const srcMinCol = Math.min(...coords.map(c => c.col));
    const srcMaxCol = Math.max(...coords.map(c => c.col));
    const tgt = parseCell(target);
    if (!tgt) return;
    const srcH = srcMaxRow - srcMinRow + 1;
    const srcW = srcMaxCol - srcMinCol + 1;
    const updates: Record<string, SpreadsheetCell | null> = {};

    const getFilled = (srcRow: number, srcCol: number, dRow: number, dCol: number): SpreadsheetCell | null => {
      const srcCell = sheet.cells[cellKey(srcCol, srcRow)];
      if (!srcCell?.value && srcCell?.value !== 0) return null;
      const val = srcCell.value;
      const newVal = typeof val === "string" && val.startsWith("=") ? adjustFormula(val, dRow, dCol) : val;
      return { value: newVal, format: srcCell.format };
    };

    if (tgt.row > srcMaxRow) {
      for (let r = srcMaxRow + 1; r <= tgt.row; r++)
        for (let c = srcMinCol; c <= srcMaxCol; c++) {
          const sr = srcMinRow + ((r - srcMinRow) % srcH);
          updates[cellKey(c, r)] = getFilled(sr, c, r - sr, 0);
        }
      setSelectionEnd(cellKey(srcMaxCol, tgt.row));
    } else if (tgt.row < srcMinRow) {
      for (let r = tgt.row; r < srcMinRow; r++)
        for (let c = srcMinCol; c <= srcMaxCol; c++) {
          const sr = srcMaxRow - ((srcMaxRow - r) % srcH);
          updates[cellKey(c, r)] = getFilled(sr, c, r - sr, 0);
        }
      setSelectedCell(cellKey(srcMinCol, tgt.row));
      setSelectionEnd(cellKey(srcMaxCol, srcMaxRow));
    } else if (tgt.col > srcMaxCol) {
      for (let c = srcMaxCol + 1; c <= tgt.col; c++)
        for (let r = srcMinRow; r <= srcMaxRow; r++) {
          const sc = srcMinCol + ((c - srcMinCol) % srcW);
          updates[cellKey(c, r)] = getFilled(r, sc, 0, c - sc);
        }
      setSelectionEnd(cellKey(tgt.col, srcMaxRow));
    } else if (tgt.col < srcMinCol) {
      for (let c = tgt.col; c < srcMinCol; c++)
        for (let r = srcMinRow; r <= srcMaxRow; r++) {
          const sc = srcMaxCol - ((srcMaxCol - c) % srcW);
          updates[cellKey(c, r)] = getFilled(r, sc, 0, c - sc);
        }
      setSelectedCell(cellKey(tgt.col, srcMinRow));
      setSelectionEnd(cellKey(srcMaxCol, srcMaxRow));
    }
    if (Object.keys(updates).length) updateCells(updates);
  }

  /** Déplace la sélection vers la cellule cible (move drag) */
  function applyMoveCells(srcKeys: string[], offset: { r: number; c: number }, target: string) {
    if (!sheet) return;
    const tgt = parseCell(target);
    if (!tgt) return;
    const coordsList = srcKeys.map(k => parseCell(k)).filter(Boolean) as { col: number; row: number }[];
    if (coordsList.length === 0) return;
    const srcMinRow = Math.min(...coordsList.map(c => c.row));
    const srcMinCol = Math.min(...coordsList.map(c => c.col));
    const srcMaxRow = Math.max(...coordsList.map(c => c.row));
    const srcMaxCol = Math.max(...coordsList.map(c => c.col));
    const deltaRow = tgt.row - offset.r - srcMinRow;
    const deltaCol = tgt.col - offset.c - srcMinCol;
    if (deltaRow === 0 && deltaCol === 0) return;
    const updates: Record<string, SpreadsheetCell | null> = {};
    for (const key of srcKeys) updates[key] = null;
    for (const key of srcKeys) {
      const { row, col } = parseCell(key)!;
      const newRow = row + deltaRow;
      const newCol = col + deltaCol;
      if (newRow < 0 || newCol < 0) continue;
      const srcCell = sheet.cells[key];
      const val = srcCell?.value;
      const newVal = typeof val === "string" && val.startsWith("=")
        ? adjustFormula(val, deltaRow, deltaCol) : val ?? null;
      if (newVal !== null || srcCell?.format)
        updates[cellKey(newCol, newRow)] = { value: newVal, format: srcCell?.format };
    }
    updateCells(updates);
    setSelectedCell(cellKey(srcMinCol + deltaCol, srcMinRow + deltaRow));
    if (srcMaxRow > srcMinRow || srcMaxCol > srcMinCol)
      setSelectionEnd(cellKey(srcMaxCol + deltaCol, srcMaxRow + deltaRow));
    else
      setSelectionEnd(null);
  }

  // Maintient les refs de fonctions à jour après chaque rendu (accès depuis document handlers)
  useEffect(() => {
    applyFillRef.current = applyFillDrag;
    applyMoveRef.current = applyMoveCells;
  });

  function commitEdit(key: string) {
    const v = editValue.trim();
    updateCell(key, v === "" ? null : v);
    setEditingCell(null);
    setFormulaBarValue(v);
    setAutocompleteOpen(false);
  }

  function handleCopy(cut = false) {
    if (!selectedCell || !sheet) return;
    const keys = rangeKeys.length > 1 ? rangeKeys : [selectedCell];
    const cells: Record<string, SpreadsheetCell> = {};
    for (const k of keys) {
      if (sheet.cells[k]) cells[k] = { ...sheet.cells[k] };
    }
    const origin = parseCell(selectedCell)!;
    setClipboard({ cells, originRow: origin.row, originCol: origin.col });
    if (cut) {
      const nulls: Record<string, SpreadsheetCell | null> = {};
      for (const k of keys) nulls[k] = null;
      updateCells(nulls);
    } else {
      const origin2 = parseCell(selectedCell)!;
      const end = selectionEnd ? parseCell(selectionEnd)! : origin2;
      const lines: string[] = [];
      for (let r = Math.min(origin2.row, end.row); r <= Math.max(origin2.row, end.row); r++) {
        const row: string[] = [];
        for (let c = Math.min(origin2.col, end.col); c <= Math.max(origin2.col, end.col); c++)
          row.push(displayValue(cellKey(c, r)));
        lines.push(row.join("\t"));
      }
      navigator.clipboard.writeText(lines.join("\n")).catch(() => { /* silent */ });
    }
  }

  function handlePaste() {
    if (!clipboard || !selectedCell || !sheet) return;
    const target = parseCell(selectedCell)!;
    const updates: Record<string, SpreadsheetCell> = {};
    for (const [key, cell] of Object.entries(clipboard.cells)) {
      const pos = parseCell(key)!;
      const destKey = cellKey(
        target.col + (pos.col - clipboard.originCol),
        target.row + (pos.row - clipboard.originRow),
      );
      if (parseCell(destKey)) updates[destKey] = { ...cell };
    }
    updateCells(updates);
  }

  function handleCellKeyDown(e: React.KeyboardEvent, key: string, col: number, row: number) {
    // Navigation dans l'autocomplétion
    if (showAC) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIdx(i => (i + 1) % acSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIdx(i => (i - 1 + acSuggestions.length) % acSuggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        applyAutocompleteSuggestion(acSuggestions[autocompleteIdx].name);
        return;
      }
      if (e.key === "Escape") {
        setAutocompleteOpen(false);
        return;
      }
    }
    if (e.key === "Escape") {
      setEditingCell(null);
      setEditValue(String(sheet?.cells[key]?.value ?? ""));
      setAutocompleteOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(key);
      setSelectedCell(cellKey(col, row + 1));
      setSelectionEnd(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(key);
      setSelectedCell(cellKey(col + 1, row));
      setSelectionEnd(null);
    }
  }

  function handleGridKeyDown(e: React.KeyboardEvent) {
    if (!selectedCell) return;

    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "c": e.preventDefault(); handleCopy(false); return;
        case "x": e.preventDefault(); handleCopy(true); return;
        case "v": e.preventDefault(); handlePaste(); return;
        case "z": e.preventDefault(); undo(); return;
        case "y": e.preventDefault(); redo(); return;
        case "b": {
          e.preventDefault();
          const keys = rangeKeys.length ? rangeKeys : [selectedCell];
          applyFormat(keys, { bold: !sheet?.cells[selectedCell]?.format?.bold });
          return;
        }
        case "i": {
          e.preventDefault();
          const keys = rangeKeys.length ? rangeKeys : [selectedCell];
          applyFormat(keys, { italic: !sheet?.cells[selectedCell]?.format?.italic });
          return;
        }
      }
    }

    if (editingCell) return;

    const pos = parseCell(selectedCell);
    if (!pos) return;
    const { col, row } = pos;

    switch (e.key) {
      case "Delete":
      case "Backspace": {
        const keys = rangeKeys.length > 1 ? rangeKeys : [selectedCell];
        const nulls: Record<string, SpreadsheetCell | null> = {};
        for (const k of keys) nulls[k] = null;
        updateCells(nulls);
        break;
      }
      case "ArrowUp":
        e.preventDefault();
        if (e.shiftKey) setSelectionEnd(cellKey(col, Math.max(0, row - 1)));
        else { setSelectedCell(cellKey(col, Math.max(0, row - 1))); setSelectionEnd(null); }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (e.shiftKey) setSelectionEnd(cellKey(col, row + 1));
        else { setSelectedCell(cellKey(col, row + 1)); setSelectionEnd(null); }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey) setSelectionEnd(cellKey(Math.max(0, col - 1), row));
        else { setSelectedCell(cellKey(Math.max(0, col - 1), row)); setSelectionEnd(null); }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (e.shiftKey) setSelectionEnd(cellKey(col + 1, row));
        else { setSelectedCell(cellKey(col + 1, row)); setSelectionEnd(null); }
        break;
      case "Enter":
      case "F2":
        e.preventDefault();
        startEdit(selectedCell);
        break;
      default:
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1)
          startEdit(selectedCell, e.key);
    }
  }

  function handleAddSheet() {
    if (!activeDoc || !newSheetName.trim()) return;
    const newSheet: SpreadsheetSheet = {
      id: `sheet_${Date.now()}`,
      name: newSheetName.trim(),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cells: {},
    };
    const newDoc = { ...activeDoc, sheets: [...activeDoc.sheets, newSheet] };
    setActiveDoc(newDoc);
    setActiveSheetIdx(newDoc.sheets.length - 1);
    setNewSheetName("");
    setAddingSheet(false);
    setDirty(true);
    scheduleSave(newDoc);
  }

  function handleRenameSheet() {
    if (!activeDoc || renamingSheet === null) { setRenamingSheet(null); return; }
    if (!renameValue.trim()) { setRenamingSheet(null); return; }
    const newSheets = activeDoc.sheets.map((s, i) =>
      i === renamingSheet ? { ...s, name: renameValue.trim() } : s
    );
    const newDoc = { ...activeDoc, sheets: newSheets };
    setActiveDoc(newDoc);
    setDirty(true);
    scheduleSave(newDoc);
    setRenamingSheet(null);
  }

  function handleDeleteSheet(i: number) {
    if (!activeDoc || activeDoc.sheets.length <= 1) return;
    const newSheets = activeDoc.sheets.filter((_, idx) => idx !== i);
    const newDoc = { ...activeDoc, sheets: newSheets };
    setActiveDoc(newDoc);
    setActiveSheetIdx(prev => {
      if (i < prev) return prev - 1;
      if (i === prev) return Math.min(prev, newSheets.length - 1);
      return prev;
    });
    setDirty(true);
    scheduleSave(newDoc);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXlsx = /\.(xlsx|xls|ods)$/i.test(file.name);
    const fileName = file.name.replace(/\.(xlsx|xls|ods|csv)$/i, "").trim() || "Tableau importé";

    // ── 1. Lecture du fichier (wrappée en Promise) ─────────────────────────
    let importedSheets: SpreadsheetSheet[];
    try {
      importedSheets = await new Promise<SpreadsheetSheet[]>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = (ev) => {
          try {
            let sheets: SpreadsheetSheet[];
            if (isXlsx) {
              const data = new Uint8Array(ev.target?.result as ArrayBuffer);
              const wb = XLSX.read(data, { type: "array", cellFormula: true, cellNF: true });
              sheets = wb.SheetNames.map((sheetName, si) => {
                const ws = wb.Sheets[sheetName];
                const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
                const numRows = ref.e.r - ref.s.r + 1;
                const numCols = ref.e.c - ref.s.c + 1;
                const s: SpreadsheetSheet = {
                  id: `sheet_${Date.now()}_${si}`,
                  name: (wb.SheetNames.length === 1 ? fileName : sheetName).slice(0, 24),
                  cols: Math.max(DEFAULT_COLS, numCols),
                  rows: Math.max(DEFAULT_ROWS, numRows + 5),
                  cells: {},
                };
                for (let r = ref.s.r; r <= ref.e.r; r++) {
                  for (let c = ref.s.c; c <= ref.e.c; c++) {
                    const addr = XLSX.utils.encode_cell({ r, c });
                    const cell = ws[addr];
                    if (!cell) continue;
                    const col = c - ref.s.c;
                    const row = r - ref.s.r;
                    let value: string | number | null;
                    if (cell.f) {
                      value = "=" + cell.f;
                    } else if (cell.t === "n") {
                      value = cell.v as number;
                    } else {
                      const raw = String(cell.v ?? "").trim();
                      if (!raw) continue;
                      value = raw;
                    }
                    s.cells[cellKey(col, row)] = { value };
                  }
                }
                return s;
              });
            } else {
              const text = ev.target?.result as string;
              const rows = parseCSV(text);
              const maxCols = Math.max(DEFAULT_COLS, ...rows.map(r => r.length));
              const s: SpreadsheetSheet = {
                id: `sheet_${Date.now()}`,
                name: fileName.slice(0, 24),
                cols: maxCols,
                rows: Math.max(DEFAULT_ROWS, rows.length + 5),
                cells: {},
              };
              rows.forEach((row, r) => {
                row.forEach((raw, c) => {
                  const trimmed = raw.trim();
                  if (!trimmed) return;
                  const normalized = trimmed
                    .replace(/\s/g, "")
                    .replace(",", ".")
                    .replace(/€/g, "")
                    .replace(/%/g, "");
                  const num = parseFloat(normalized);
                  s.cells[cellKey(c, r)] = { value: isNaN(num) ? trimmed : num };
                });
              });
              sheets = [s];
            }
            resolve(sheets);
          } catch (err) {
            reject(err);
          }
        };
        if (isXlsx) reader.readAsArrayBuffer(file);
        else reader.readAsText(file, "utf-8");
      });
    } catch {
      alert("Impossible de lire le fichier. Vérifiez qu'il s'agit d'un fichier XLSX, XLS, ODS ou CSV valide.");
      e.target.value = "";
      return;
    }

    e.target.value = "";

    // ── 2. Intégration dans le doc ─────────────────────────────────────────
    if (!activeDoc) {
      // Créer un nouveau doc, puis le sauvegarder directement avec les feuilles importées
      const emptyDoc = await createSpreadsheet(fileName);
      const finalDoc = { ...emptyDoc, sheets: importedSheets };
      const saved = await saveSpreadsheet(finalDoc);
      setDocs(prev => [
        { id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt },
        ...prev,
      ]);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setActiveDoc(saved);
      setActiveSheetIdx(0);
    } else {
      const newDoc = { ...activeDoc, sheets: [...activeDoc.sheets, ...importedSheets] };
      setActiveDoc(newDoc);
      setActiveSheetIdx(activeDoc.sheets.length);
      setDirty(true);
      scheduleSave(newDoc);
    }
  }

  function exportCSV() {
    if (!sheet) return;
    let maxRow = 0, maxCol = 0;
    for (const key of Object.keys(sheet.cells)) {
      const pos = parseCell(key);
      if (pos) { maxRow = Math.max(maxRow, pos.row); maxCol = Math.max(maxCol, pos.col); }
    }
    const csvRows: string[] = [];
    for (let r = 0; r <= maxRow; r++) {
      const row: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        const val = displayValue(cellKey(c, r));
        row.push(val.includes(",") || val.includes('"') || val.includes("\n")
          ? `"${val.replace(/"/g, '""')}"`
          : val);
      }
      csvRows.push(row.join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXLSX() {
    if (!activeDoc) return;
    const wb = XLSX.utils.book_new();
    for (const s of activeDoc.sheets) {
      let maxRow = 0, maxCol = 0;
      for (const key of Object.keys(s.cells)) {
        const pos = parseCell(key);
        if (pos) { maxRow = Math.max(maxRow, pos.row); maxCol = Math.max(maxCol, pos.col); }
      }
      const aoa: (string | number | null)[][] = [];
      for (let r = 0; r <= maxRow; r++) {
        const row: (string | number | null)[] = [];
        for (let c = 0; c <= maxCol; c++) {
          row.push(s.cells[cellKey(c, r)]?.value ?? null);
        }
        aoa.push(row);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDoc.name}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function displayValue(key: string): string {
    const cellData = sheet?.cells[key];
    const raw = cellData?.value;
    const fmt = cellData?.format?.numberFormat;
    if (raw === undefined || raw === null || raw === "") return "";
    const isFormula = typeof raw === "string" && raw.startsWith("=");
    if (!isFormula) {
      const num = typeof raw === "number"
        ? raw
        : parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
      if (!isNaN(num) && fmt && fmt !== "default") return formatNumber(num, fmt);
      return String(raw);
    }
    const computed = computedValues[key];
    if (computed === undefined || computed === null) return "";
    if (typeof computed === "number") return formatNumber(computed, fmt);
    return String(computed);
  }

  const filteredVars = Object.entries(accountingVars).filter(([k]) =>
    !varsSearch || k.toLowerCase().includes(varsSearch.toLowerCase())
  );

  function varColor(key: string): string {
    for (const [prefix, cls] of Object.entries(CATEGORY_COLORS))
      if (key.startsWith(prefix)) return cls;
    return "text-vscode-muted";
  }

  function insertVarInCell(varName: string) {
    if (!selectedCell) return;
    updateCell(selectedCell, `=${varName.toUpperCase()}`);
    setFormulaBarValue(`=${varName.toUpperCase()}`);
  }

  const activeFmt: CellFormat = selectedCell ? (sheet?.cells[selectedCell]?.format ?? {}) : {};
  const getColWidth = (c: number) => colWidths[c] ?? DEFAULT_COL_WIDTH;
  const getActiveKeys = () => {
    const keys = rangeKeys.length > 0 ? rangeKeys : selectedCell ? [selectedCell] : [];
    if (ctrlKeys.size === 0) return keys;
    return Array.from(new Set([...keys, ...Array.from(ctrlKeys)]));
  };

  return (
    <div
      className="flex h-full bg-vscode-bg text-vscode-text overflow-hidden"
      onClick={() => setShowBgPicker(false)}
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,.CSV,.xlsx,.xls,.ods"
        className="hidden"
        onChange={handleImport}
      />

      {loadError && <div role="alert" className="text-red-400 p-2">{loadError}</div>}
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div className="w-52 shrink-0 bg-vscode-sidebar border-r border-vscode-border flex flex-col">
        <div className="px-3 py-2 border-b border-vscode-border flex items-center justify-between">
          <span className="text-xs font-semibold text-vscode-text">📊 Tableaux</span>
          <button
            onClick={() => setCreating(true)}
            className="text-[10px] text-vscode-muted hover:text-vscode-accent border border-vscode-border rounded px-1.5 py-0.5"
          >+ Nouveau</button>
        </div>

        {creating && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
            className="flex gap-1 px-2 py-1.5 border-b border-vscode-border"
          >
            <input
              autoFocus
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
              placeholder="Nom…"
              className="flex-1 bg-vscode-bg border border-vscode-accent text-vscode-text text-xs rounded px-1.5 py-0.5 focus:outline-none"
            />
            <button type="submit" className="text-vscode-accent text-xs">✓</button>
            <button type="button" onClick={() => setCreating(false)} className="text-vscode-muted text-xs">✕</button>
          </form>
        )}

        <div className="flex-1 overflow-auto">
          {docs.length === 0 && !creating && (
            <div className="px-3 py-4 space-y-2">
              <p className="text-[10px] text-vscode-muted">
                Aucun tableau.
              </p>
              <button
                onClick={() => importInputRef.current?.click()}
                className="w-full text-left text-[10px] text-vscode-muted hover:text-blue-300 flex items-center gap-1"
              >📂 Importer un fichier</button>
            </div>
          )}
          {docs.map(doc => (
            <button
              key={doc.id}
              onClick={() => loadDoc(doc.id)}
              className={`w-full text-left px-3 py-2 text-xs truncate transition-colors ${
                activeDoc?.id === doc.id
                  ? "bg-vscode-accent/20 text-vscode-text border-l-2 border-vscode-accent"
                  : "text-vscode-muted hover:text-vscode-text hover:bg-vscode-panel"
              }`}
            >📄 {doc.name}</button>
          ))}
        </div>
      </div>

      {/* ── Zone principale ──────────────────────────────────────────── */}
      {!activeDoc ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-vscode-muted">
          <span className="text-5xl">📊</span>
          <p className="text-sm">Sélectionnez ou créez un tableau</p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setCreating(true)}
              className="text-xs bg-vscode-accent hover:brightness-110 text-white px-4 py-1.5 rounded"
            >+ Nouveau tableau</button>
            <button
              onClick={() => importInputRef.current?.click()}
              className="text-xs border border-vscode-border hover:border-vscode-accent text-vscode-muted hover:text-vscode-text px-4 py-1.5 rounded"
            >📂 Importer XLSX / CSV</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Titre */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-vscode-panel border-b border-vscode-border shrink-0">
            <span className="text-sm font-medium text-vscode-text">{activeDoc.name}</span>
            {dirty && <span className="text-[10px] text-yellow-400">● non sauvegardé</span>}
            {saving && <span className="text-[10px] text-vscode-muted animate-pulse">Sauvegarde…</span>}
            {!dirty && !saving && <span className="text-[10px] text-green-600">✓</span>}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowVarsPanel(v => !v)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  showVarsPanel
                    ? "bg-blue-900/40 border-blue-700 text-blue-300"
                    : "border-vscode-border text-vscode-muted hover:text-vscode-text"
                }`}
              >𝑥 Variables</button>
              <button
                onClick={async () => {
                  if (!confirm(`Supprimer « ${activeDoc.name} » ?`)) return;
                  await deleteSpreadsheetApi(activeDoc.id);
                  setDocs(prev => prev.filter(d => d.id !== activeDoc.id));
                  setActiveDoc(null);
                }}
                className="text-[10px] text-vscode-muted hover:text-red-400 px-1"
              >🗑</button>
            </div>
          </div>

          {/* Barre de formule */}
          <div className="flex items-center gap-2 px-3 py-1 bg-vscode-sidebar border-b border-vscode-border shrink-0 relative">
            <span className="text-[10px] text-vscode-muted w-16 text-center font-mono shrink-0">
              {selectedCell
                ? selectionEnd ? `${selectedCell}:${selectionEnd}` : selectedCell
                : "—"}
            </span>
            <span className="text-vscode-border shrink-0">|</span>
            <span className="text-[10px] text-vscode-muted mr-1 shrink-0 italic">fx</span>
            <input
              value={formulaBarValue}
              onChange={(e) => {
                const val = e.target.value;
                setFormulaBarValue(val);
                if (editingCell) {
                  setEditValue(val);
                  if (val.startsWith("=")) {
                    const m = val.match(/([A-Za-z_]+)$/);
                    if (m) { setAutocompleteOpen(true); setAutocompleteIdx(0); }
                    else setAutocompleteOpen(false);
                  } else {
                    setAutocompleteOpen(false);
                  }
                } else if (selectedCell) {
                  startEdit(selectedCell);
                  setEditValue(val);
                }
              }}
              onKeyDown={(e) => {
                if (showAC) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setAutocompleteIdx(i => (i + 1) % acSuggestions.length); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setAutocompleteIdx(i => (i - 1 + acSuggestions.length) % acSuggestions.length); return; }
                  if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); applyAutocompleteSuggestion(acSuggestions[autocompleteIdx].name); return; }
                  if (e.key === "Escape") { setAutocompleteOpen(false); return; }
                }
                if (e.key === "Enter" && editingCell) commitEdit(editingCell);
                if (e.key === "Escape") { setEditingCell(null); setAutocompleteOpen(false); }
              }}
              placeholder="=SUM(A1:A10)  •  =REVENUS_2025  •  =IF(A1>0,…)"
              className="flex-1 bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-0.5 rounded focus:outline-none focus:border-vscode-accent font-mono"
            />
            {/* ── Dropdown autocomplétion ─────────────────────────────── */}
            {showAC && (
              <div className="absolute left-0 right-0 top-full z-50 bg-vscode-panel border border-vscode-border rounded-b shadow-2xl max-h-52 overflow-y-auto">
                {acSuggestions.slice(0, 10).map((s, i) => (
                  <div
                    key={s.name}
                    onMouseDown={(e) => { e.preventDefault(); applyAutocompleteSuggestion(s.name); }}
                    className={`flex items-center gap-3 px-3 py-1 cursor-pointer select-none ${
                      i === autocompleteIdx
                        ? "bg-vscode-accent text-white"
                        : "text-vscode-text hover:bg-vscode-sidebar"
                    }`}
                  >
                    <span className={`font-bold font-mono text-xs w-28 shrink-0 ${i === autocompleteIdx ? "text-white" : "text-green-300"}`}>{s.name}</span>
                    <span className={`font-mono text-[10px] truncate ${i === autocompleteIdx ? "text-white/80" : "text-vscode-muted"}`}>{s.usage}</span>
                    <span className={`text-[10px] ml-auto shrink-0 ${i === autocompleteIdx ? "text-white/70" : "text-vscode-muted/70"}`}>{s.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Barre d'outils ────────────────────────────────────────── */}
          <div
            className="flex items-center gap-1 px-3 py-1 bg-vscode-panel border-b border-vscode-border shrink-0 flex-wrap"
            onClick={e => e.stopPropagation()}
          >
            {/* Gras */}
            <button
              onClick={() => { const k = getActiveKeys(); if (k.length) applyFormat(k, { bold: !activeFmt.bold }); }}
              className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold border transition-colors ${
                activeFmt.bold
                  ? "bg-vscode-accent/30 border-vscode-accent text-white"
                  : "border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar"
              }`}
              title="Gras (Ctrl+B)"
            >B</button>

            {/* Italique */}
            <button
              onClick={() => { const k = getActiveKeys(); if (k.length) applyFormat(k, { italic: !activeFmt.italic }); }}
              className={`w-6 h-6 flex items-center justify-center rounded text-xs italic border transition-colors ${
                activeFmt.italic
                  ? "bg-vscode-accent/30 border-vscode-accent text-white"
                  : "border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar"
              }`}
              title="Italique (Ctrl+I)"
            >I</button>

            {/* Couleur de fond */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowBgPicker(v => !v); }}
                className={`w-6 h-6 flex items-center justify-center rounded border text-[10px] transition-colors ${
                  activeFmt.bgColor
                    ? "border-vscode-accent"
                    : "border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar"
                }`}
                style={activeFmt.bgColor ? { backgroundColor: activeFmt.bgColor } : undefined}
                title="Couleur de fond"
              >
                {!activeFmt.bgColor && "🎨"}
              </button>
              {showBgPicker && (
                <div
                  className="absolute top-7 left-0 z-50 bg-vscode-panel border border-vscode-border rounded p-2 shadow-xl"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="grid grid-cols-7 gap-1">
                    {PRESET_BG_COLORS.map(color => (
                      <button
                        key={color}
                        title={color === "transparent" ? "Supprimer la couleur" : color}
                        onClick={() => {
                          const k = getActiveKeys();
                          if (k.length) applyFormat(k, { bgColor: color });
                          setShowBgPicker(false);
                        }}
                        className="w-5 h-5 rounded border border-vscode-border hover:scale-125 transition-transform flex items-center justify-center"
                        style={{ backgroundColor: color === "transparent" ? undefined : color }}
                      >
                        {color === "transparent" && <span className="text-[9px] text-vscode-muted">✕</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Alignement */}
            {(["left", "center", "right"] as const).map((align, idx) => (
              <button
                key={align}
                onClick={() => { const k = getActiveKeys(); if (k.length) applyFormat(k, { align }); }}
                className={`w-6 h-6 flex items-center justify-center rounded border text-[10px] transition-colors ${
                  activeFmt.align === align
                    ? "bg-vscode-accent/30 border-vscode-accent text-white"
                    : "border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar"
                }`}
                title={["Gauche", "Centre", "Droite"][idx]}
              >
                {["⬅", "↔", "➡"][idx]}
              </button>
            ))}

            <span className="text-vscode-border mx-0.5">|</span>

            {/* Format numérique */}
            {(["default", "euro", "percent"] as const).map(fmt => (
              <button
                key={fmt}
                onClick={() => { const k = getActiveKeys(); if (k.length) applyFormat(k, { numberFormat: fmt }); }}
                className={`h-6 px-2 flex items-center justify-center rounded border text-[10px] font-mono transition-colors ${
                  (activeFmt.numberFormat === fmt) || (!activeFmt.numberFormat && fmt === "default")
                    ? "bg-vscode-accent/30 border-vscode-accent text-white"
                    : "border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar"
                }`}
                title={fmt === "default" ? "Nombre brut" : fmt === "euro" ? "Format euro (1 234,56 €)" : "Pourcentage"}
              >
                {fmt === "default" ? "123" : fmt === "euro" ? "€" : "%"}
              </button>
            ))}

            <span className="text-vscode-border mx-0.5">|</span>

            {/* Undo / Redo */}
            <button
              onClick={undo}
              className="w-6 h-6 flex items-center justify-center rounded border border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar text-sm transition-colors"
              title="Annuler (Ctrl+Z)"
            >↩</button>
            <button
              onClick={redo}
              className="w-6 h-6 flex items-center justify-center rounded border border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar text-sm transition-colors"
              title="Rétablir (Ctrl+Y)"
            >↪</button>

            <span className="text-vscode-border mx-0.5">|</span>

            {/* Import / Export */}
            <button
              onClick={() => importInputRef.current?.click()}
              className="h-6 px-2 flex items-center gap-1 rounded border border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar text-[10px] transition-colors"
              title="Importer un CSV ou XLSX dans un nouvel onglet (les formules XLSX sont préservées)"
            >📥 Importer</button>
            <button
              onClick={exportCSV}
              className="h-6 px-2 flex items-center gap-1 rounded border border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar text-[10px] transition-colors"
              title="Exporter la feuille active en CSV"
            >📤 CSV</button>
            <button
              onClick={exportXLSX}
              className="h-6 px-2 flex items-center gap-1 rounded border border-vscode-border text-vscode-muted hover:text-vscode-text hover:bg-vscode-sidebar text-[10px] transition-colors"
              title="Exporter toutes les feuilles en XLSX"
            >📤 XLSX</button>
          </div>

          {/* ── Grille + Variables ─────────────────────────────────────── */}
          <div className="flex flex-1 min-h-0 relative">
            {isRecomputing && (
              <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
                <div className="bg-vscode-panel/90 border border-vscode-border rounded px-4 py-2 text-vscode-muted text-xs flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-vscode-accent border-t-transparent rounded-full animate-spin" />
                  Calcul en cours…
                </div>
              </div>
            )}

            <div
              className="flex-1 overflow-auto"
              tabIndex={0}
              onKeyDown={handleGridKeyDown}
              style={{ outline: "none" }}
            >
              <table
                className="border-collapse text-xs select-none"
                style={{ minWidth: HEADER_COL_WIDTH + (sheet?.cols ?? 0) * DEFAULT_COL_WIDTH }}
              >
                <thead>
                  <tr>
                    <th
                      className="bg-vscode-sidebar border border-vscode-border sticky top-0 left-0 z-20"
                      style={{ width: HEADER_COL_WIDTH, minWidth: HEADER_COL_WIDTH, height: ROW_HEIGHT }}
                    />
                    {Array.from({ length: sheet?.cols ?? 0 }, (_, c) => (
                      <th
                        key={c}
                        className="bg-vscode-sidebar border border-vscode-border text-vscode-muted text-[10px] font-normal sticky top-0 z-10 text-center relative"
                        style={{ width: getColWidth(c), minWidth: getColWidth(c), height: ROW_HEIGHT }}
                      >
                        {colLetter(c)}
                        <div
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-vscode-accent/60 z-20"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            resizingRef.current = { col: c, startX: e.clientX, startWidth: getColWidth(c) };
                            document.body.style.cursor = "col-resize";
                            document.body.style.userSelect = "none";
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {Array.from({ length: sheet?.rows ?? 0 }, (_, r) => (
                    <tr key={r}>
                      <td
                        className="bg-vscode-sidebar border border-vscode-border text-vscode-muted text-[10px] text-right pr-2 sticky left-0 z-10 select-none"
                        style={{ width: HEADER_COL_WIDTH, height: ROW_HEIGHT }}
                      >{r + 1}</td>

                      {Array.from({ length: sheet?.cols ?? 0 }, (_, c) => {
                        const key = cellKey(c, r);
                        const isSelected = selectedCell === key && !selectionEnd;
                        const inRange = rangeSet.has(key);
                        const isEditing = editingCell === key;
                        const isInCtrl = ctrlKeys.has(key);
                        const isFillPreview = fillPreviewSet.has(key);
                        const isMovePreview = movePreviewSet.has(key);
                        const isMoveSrc = moveSrcSet.has(key);
                        const isFillHandle = !editingCell && key === selectionBR;
                        const cellData = sheet?.cells[key];
                        const rawValue = cellData?.value;
                        const fmt = cellData?.format ?? {};
                        const displayed = displayValue(key);
                        const isFormula = typeof rawValue === "string" && rawValue.startsWith("=");
                        const isError = displayed.startsWith("#ERR");

                        let textAlign: "left" | "center" | "right" = "left";
                        if (fmt.align) textAlign = fmt.align;
                        else if (typeof computedValues[key] === "number") textAlign = "right";
                        else if (typeof rawValue === "number") textAlign = "right";

                        return (
                          <td
                            key={c}
                            onMouseDown={(e) => {
                              // En mode édition de formule, empêcher le blur de l'input
                              if (editingCell && editingCell !== key && editValue.startsWith("=")) {
                                e.preventDefault();
                                return;
                              }
                              // Début potentiel d'un move drag (cellule déjà sélectionnée)
                              if (!editingCell && (rangeSet.has(key) || selectedCell === key)
                                && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
                                const pos = parseCell(key);
                                const srcKs = rangeKeys.length > 1 ? rangeKeys : selectedCell ? [selectedCell] : [];
                                if (pos && srcKs.length > 0) {
                                  const srcCoords = srcKs.map(k => parseCell(k)).filter(Boolean) as { col: number; row: number }[];
                                  const srcMinRow = Math.min(...srcCoords.map(c2 => c2.row));
                                  const srcMinCol = Math.min(...srcCoords.map(c2 => c2.col));
                                  potentialMoveRef.current = {
                                    startX: e.clientX, startY: e.clientY, srcKeys: srcKs,
                                    offset: { r: pos.row - srcMinRow, c: pos.col - srcMinCol },
                                  };
                                }
                              }
                            }}
                            onMouseEnter={() => {
                              if (fillDragStateRef.current) {
                                setFillDragTarget(key);
                                fillTargetSnapRef.current = key;
                              }
                              if (moveDragStateRef.current) {
                                setMoveDragTarget(key);
                                moveTargetSnapRef.current = key;
                              }
                            }}
                            onClick={(e) => {
                              // Bloquer le click si un move drag vient de se terminer
                              if (moveDragBlockClickRef.current) return;
                              // Clic pendant l'édition d'une formule → insérer la ref
                              if (editingCell && editingCell !== key && editValue.startsWith("=")) {
                                insertCellRefInFormula(key);
                                return;
                              }
                              potentialMoveRef.current = null;
                              if (e.shiftKey && selectedCell) {
                                setSelectionEnd(key);
                                setCtrlKeys(new Set());
                              } else if (e.ctrlKey || e.metaKey) {
                                // Ctrl+clic : ajoute/retire la cellule de la multi-sélection
                                setCtrlKeys(prev => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key); else next.add(key);
                                  return next;
                                });
                              } else {
                                setSelectedCell(key);
                                setSelectionEnd(null);
                                setFormulaBarValue(String(rawValue ?? ""));
                                setCtrlKeys(new Set());
                              }
                            }}
                            onDoubleClick={() => startEdit(key)}
                            className={`border border-vscode-border relative p-0 overflow-visible
                              ${isSelected && !isEditing ? "outline outline-2 outline-vscode-accent outline-offset-[-1px] z-[5]" : ""}
                              ${inRange && !isSelected && !isFillPreview ? "bg-blue-500/10" : ""}
                              ${isInCtrl ? "bg-violet-500/20 outline outline-1 outline-violet-400" : ""}
                              ${isFillPreview ? "bg-blue-300/20 outline outline-1 outline-dashed outline-blue-400 z-[4]" : ""}
                              ${isMovePreview ? "outline outline-2 outline-orange-400 z-[5]" : ""}
                              ${isMoveSrc && !isMovePreview ? "opacity-40" : ""}
                              ${isEditing ? "z-[6]" : ""}
                            `}
                            style={{
                              height: ROW_HEIGHT,
                              width: getColWidth(c),
                              backgroundColor: !inRange && !isInCtrl && fmt.bgColor ? fmt.bgColor : undefined,
                              cursor: !editingCell && !moveDragActive && (inRange || isSelected) && !isInCtrl ? "move" : undefined,
                            }}
                          >
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                value={editValue}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditValue(val);
                                  setFormulaBarValue(val);
                                  if (val.startsWith("=")) {
                                    const m = val.match(/([A-Za-z_]+)$/);
                                    if (m) { setAutocompleteOpen(true); setAutocompleteIdx(0); }
                                    else setAutocompleteOpen(false);
                                  } else {
                                    setAutocompleteOpen(false);
                                  }
                                }}
                                onBlur={() => commitEdit(key)}
                                onKeyDown={(e) => handleCellKeyDown(e, key, c, r)}
                                className="absolute inset-0 w-full h-full bg-vscode-bg border-2 border-vscode-accent text-vscode-text text-xs px-1 focus:outline-none font-mono z-10"
                              />
                            ) : (
                              <span
                                className={`block px-1 truncate ${
                                  isError ? "text-red-400"
                                  : isFormula ? "text-green-300"
                                  : "text-vscode-text"
                                } ${fmt.bold ? "font-bold" : ""} ${fmt.italic ? "italic" : ""}`}
                                style={{ lineHeight: `${ROW_HEIGHT}px`, textAlign }}
                                title={isError ? displayed : undefined}
                              >
                                {displayed}
                              </span>
                            )}
                            {/* Fill handle (petit carré en bas-à-droite de la sélection) */}
                            {isFillHandle && (
                              <div
                                className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-vscode-accent border-2 border-vscode-bg z-30 cursor-crosshair translate-x-1/2 translate-y-1/2"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  fillDragStateRef.current = { srcStart: selectedCell!, srcEnd: selectionEnd };
                                  document.body.style.cursor = "crosshair";
                                  document.body.style.userSelect = "none";
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Variables comptables ──────────────────────────────── */}
            {showVarsPanel && (
              <div className="w-56 shrink-0 border-l border-vscode-border bg-vscode-sidebar flex flex-col text-xs">
                <div className="px-3 py-2 border-b border-vscode-border">
                  <p className="text-vscode-text font-medium text-[11px] mb-1">Variables comptables</p>
                  <input
                    value={varsSearch}
                    onChange={(e) => setVarsSearch(e.target.value)}
                    placeholder="Filtrer…"
                    className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-vscode-accent"
                  />
                </div>
                <div className="flex-1 overflow-auto px-1 py-1 space-y-0.5">
                  {filteredVars.map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => insertVarInCell(key)}
                      className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-vscode-panel transition-colors text-left"
                      title={`Insérer =${key.toUpperCase()}`}
                    >
                      <span className={`truncate font-mono text-[10px] ${varColor(key)}`}>{key}</span>
                      <span className="text-vscode-muted text-[10px] tabular-nums ml-1 shrink-0">{val.toFixed(2)}</span>
                    </button>
                  ))}
                  {filteredVars.length === 0 && (
                    <p className="text-vscode-muted text-[10px] px-2 py-2">Aucune variable</p>
                  )}
                </div>
                <div className="px-2 py-2 border-t border-vscode-border text-[9px] text-vscode-muted leading-relaxed">
                  <p className="font-semibold mb-0.5">Raccourcis :</p>
                  <p>Ctrl+C/V/X  copier/coller/couper</p>
                  <p>Ctrl+Z/Y  annuler/rétablir</p>
                  <p>Ctrl+B/I  gras/italique</p>
                  <p>Shift+↑↓←→  sélection plage</p>
                  <p className="mt-1 font-semibold">Formules :</p>
                  <p>=REVENUS_2025</p>
                  <p>=SUM(A1:A10)</p>
                  <p>=IF(A1&gt;0,"Bénef","Perte")</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Onglets ───────────────────────────────────────────────── */}
          <div className="flex items-center border-t border-vscode-border bg-vscode-sidebar shrink-0 px-2">
            {activeDoc.sheets.map((s, i) => (
              <div key={s.id}>
                {renamingSheet === i ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleRenameSheet(); }}
                    className="flex items-center gap-1 px-1 py-1"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRenameSheet}
                      onKeyDown={(e) => { if (e.key === "Escape") setRenamingSheet(null); }}
                      className="bg-vscode-bg border border-vscode-accent text-vscode-text text-[10px] rounded px-1.5 py-0.5 w-24 focus:outline-none"
                    />
                  </form>
                ) : (
                  <div className="flex items-center group">
                    <button
                      onClick={() => {
                        setActiveSheetIdx(i);
                        setSelectedCell(null);
                        setSelectionEnd(null);
                        setEditingCell(null);
                      }}
                      onDoubleClick={() => { setRenamingSheet(i); setRenameValue(s.name); }}
                      className={`text-[10px] px-2 py-1.5 border-t-2 transition-colors ${
                        i === activeSheetIdx
                          ? "border-vscode-accent text-vscode-text bg-vscode-bg"
                          : "border-transparent text-vscode-muted hover:text-vscode-text hover:bg-vscode-panel"
                      }`}
                      title="Double-clic pour renommer"
                    >{s.name}</button>
                    {activeDoc.sheets.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSheet(i); }}
                        className="opacity-0 group-hover:opacity-100 text-[9px] text-vscode-muted hover:text-red-400 pr-1 transition-opacity leading-none"
                        title="Supprimer cette feuille"
                      >×</button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {addingSheet ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleAddSheet(); }}
                className="flex items-center gap-1 ml-1"
              >
                <input
                  autoFocus
                  value={newSheetName}
                  onChange={(e) => setNewSheetName(e.target.value)}
                  placeholder="Nom…"
                  className="bg-vscode-bg border border-vscode-accent text-vscode-text text-[10px] rounded px-1.5 py-0.5 w-24 focus:outline-none"
                />
                <button type="submit" className="text-vscode-accent text-[10px]">✓</button>
                <button type="button" onClick={() => setAddingSheet(false)} className="text-vscode-muted text-[10px]">✕</button>
              </form>
            ) : (
              <button
                onClick={() => setAddingSheet(true)}
                className="text-[10px] text-vscode-muted hover:text-vscode-text px-2 py-1.5 ml-1"
                title="Ajouter une feuille"
              >+</button>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
