import {workspaceLock} from "./workspaceContext.js";
import {currentEcosystemCompany,loadEcosystem} from "./ecosystemService.js";
import {resolveVariables} from "../domain/ecosystemVariables.js";
import {atomicWriteFile} from "./atomicFile.js";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getWorkspaceRoot } from "./fileSystem.js";
import { loadAllTransactions } from "./transactionService.js";

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  bgColor?: string;
  numberFormat?: "default" | "euro" | "percent";
  align?: "left" | "center" | "right";
}

export interface SpreadsheetCell {
  value: string | number | null; // valeur brute ou formule (commence par =)
  format?: CellFormat;
}

export interface SpreadsheetSheet {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: Record<string, SpreadsheetCell>; // clé: "A1", "B2", etc.
}

export interface SpreadsheetDoc {
  revision?:number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sheets: SpreadsheetSheet[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sheetsDir(): string {
  return path.join(getWorkspaceRoot(), "spreadsheets");
}

function docPath(id: string): string {
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Object.assign(new Error("Identifiant de tableur invalide"),{statusCode:400});
  return path.join(sheetsDir(), `${id}.json`);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listSpreadsheets(): Promise<Omit<SpreadsheetDoc, "sheets">[]> {
  const dir = sheetsDir();
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const docs: Omit<SpreadsheetDoc, "sheets">[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf-8");
      const { id, name, createdAt, updatedAt } = JSON.parse(raw) as SpreadsheetDoc;
      docs.push({ id, name, createdAt, updatedAt });
    } catch { /* ignore */ }
  }
  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getSpreadsheet(id: string): Promise<SpreadsheetDoc | null> {
  const p = docPath(id);
  if (!fsSync.existsSync(p)) return null;
  const raw = await fs.readFile(p, "utf-8");
  return JSON.parse(raw) as SpreadsheetDoc;
}

export async function saveSpreadsheet(doc: SpreadsheetDoc): Promise<SpreadsheetDoc> {
 const target=docPath(doc.id);
 return workspaceLock(target,async()=>{
  const current=await getSpreadsheet(doc.id);
  if(current&&(current.revision??0)!==(doc.revision??0))throw Object.assign(new Error("Ce tableau a été modifié ailleurs. Rechargez-le avant de réessayer ; vos modifications locales sont conservées."),{statusCode:409});
  const saved={...doc,revision:(current?.revision??0)+1,updatedAt:new Date().toISOString()};
  await atomicWriteFile(target,JSON.stringify(saved,null,2));return saved;
 });
}

export async function createSpreadsheet(name: string): Promise<SpreadsheetDoc> {
  const id = `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const doc: SpreadsheetDoc = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    sheets: [
      {
        id: "sheet1",
        name: "Feuille 1",
        cols: 26,
        rows: 100,
        cells: {},
      },
    ],
  };
  return saveSpreadsheet(doc);
}

export async function deleteSpreadsheet(id: string): Promise<void> {
  const p = docPath(id);
  if (fsSync.existsSync(p)) await fs.unlink(p);
}

// ── Variables comptables ──────────────────────────────────────────────────────

export interface AccountingVariables {
  [key: string]: number;
}

export async function getAccountingVariables(): Promise<AccountingVariables> {
  const txns = await loadAllTransactions();
  const vars: AccountingVariables = {};

  const years = [...new Set(txns.map((t) => t.date.slice(0, 4)))];

  for (const year of years) {
    const yt = txns.filter((t) => t.date.startsWith(year) && t.status !== "rejected");

    const revenus = yt.filter((t) => t.amount_ttc > 0);
    const depenses = yt.filter((t) => t.amount_ttc < 0);

    vars[`revenus_${year}`]      = +revenus.reduce((s, t) => s + t.amount_ttc, 0).toFixed(2);
    vars[`depenses_${year}`]     = +Math.abs(depenses.reduce((s, t) => s + t.amount_ttc, 0)).toFixed(2);
    vars[`solde_${year}`]        = +(vars[`revenus_${year}`] - vars[`depenses_${year}`]).toFixed(2);
    vars[`revenus_ht_${year}`]   = +revenus.reduce((s, t) => s + t.amount_ht, 0).toFixed(2);
    vars[`depenses_ht_${year}`]  = +Math.abs(depenses.reduce((s, t) => s + t.amount_ht, 0)).toFixed(2);
    vars[`tva_collectee_${year}`]= +revenus.reduce((s, t) => s + (t.vat ?? 0), 0).toFixed(2);
    vars[`tva_deductible_${year}`]= +Math.abs(depenses.reduce((s, t) => s + (t.vat ?? 0), 0)).toFixed(2);
    vars[`tva_nette_${year}`]    = +(vars[`tva_collectee_${year}`] - vars[`tva_deductible_${year}`]).toFixed(2);

    // Par catégorie
    const categories = [...new Set(yt.map((t) => t.category))];
    for (const cat of categories) {
      const catTxns = yt.filter((t) => t.category === cat);
      const total = catTxns.reduce((s, t) => s + t.amount_ttc, 0);
      vars[`${cat}_${year}`] = +Math.abs(total).toFixed(2);
    }
  }

  // Globaux (toutes années confondues, non rejetées)
  const all = txns.filter((t) => t.status !== "rejected");
  vars["revenus_total"]   = +all.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0).toFixed(2);
  vars["depenses_total"]  = +Math.abs(all.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + t.amount_ttc, 0)).toFixed(2);
  vars["solde_total"]     = +(vars["revenus_total"] - vars["depenses_total"]).toFixed(2);

  const company=currentEcosystemCompany();
  if(company){const s=await loadEcosystem(company.ecosystemId!);for(const v of resolveVariables(s,s.variables??[]))if(v.value!==undefined)vars[v.symbol]=v.value;}
  return vars;
}
