import type { SpreadsheetDoc } from "../components/Spreadsheet/spreadsheetTypes";

import { apiUrl } from "./client";
const BASE = apiUrl("spreadsheets");

export async function fetchSpreadsheets(): Promise<Omit<SpreadsheetDoc, "sheets">[]> {
  const r = await fetch(BASE);
  return r.json();
}

export async function fetchSpreadsheet(id: string): Promise<SpreadsheetDoc | null> {
  const r = await fetch(`${BASE}/${id}`);
  if (!r.ok) return null;
  return r.json();
}

export async function createSpreadsheet(name: string): Promise<SpreadsheetDoc> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return r.json();
}

export async function saveSpreadsheet(doc: SpreadsheetDoc): Promise<SpreadsheetDoc> {
  const r = await fetch(`${BASE}/${doc.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  return r.json();
}

export async function deleteSpreadsheetApi(id: string): Promise<void> {
  await fetch(`${BASE}/${id}`, { method: "DELETE" });
}

export async function fetchAccountingVariables(): Promise<Record<string, number>> {
  const r = await fetch(`${BASE}/variables`);
  return r.json();
}
