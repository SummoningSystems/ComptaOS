import type { Transaction } from "../../types";

const powensImportPrefix = /^importé via PSD2 \(Powens\)(?:\s*[-–—]\s*|\s*$)/i;
// Les références de facture séparées du nom (F-2026-07-4, F2025 011, Facture 012)
// permettent d'identifier le payeur sans tronquer les noms contenant un tiret.
const invoiceSuffix = /\s+[-–—]\s+(?:f[- ]?\d{4}(?:[- /]\d+)+|facture\s+(?:n[°º]\s*)?(?=[\p{L}\d/-]*\d)[\p{L}\d/-]+)(?=\s|$)/iu;

export function tierName(transaction: Pick<Transaction, "amount_ttc" | "label" | "notes">): string {
  const note = transaction.notes?.trim() ?? "";
  if (note && !powensImportPrefix.test(note)) return note.replace(/\s+/g, " ");

  const label = (transaction.label.trim() || note).replace(powensImportPrefix, "").trim().replace(/\s+/g, " ");
  const referenceIndex = transaction.amount_ttc > 0 ? label.search(invoiceSuffix) : -1;
  return (referenceIndex > 0 ? label.slice(0, referenceIndex) : label) || "(sans tiers)";
}

export function tierKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}
