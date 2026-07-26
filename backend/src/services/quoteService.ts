import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Quote } from "../types/index.js";
import { getActiveCompanyPath } from "./companiesService.js";
import { atomicWriteFileSync } from "./atomicFile.js";

function getQuotesFile(): string {
  return join(getActiveCompanyPath(), "settings", "quotes.json");
}

export function loadQuotes(): Quote[] {
  const file = getQuotesFile();
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Quote[];
  } catch {
    return [];
  }
}

export function saveQuotes(quotes: Quote[]): void {
  const file = getQuotesFile();
  atomicWriteFileSync(file, JSON.stringify(quotes, null, 2));
}
