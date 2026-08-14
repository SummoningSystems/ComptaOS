import Papa from "papaparse";
import { Transaction, CsvMappingConfig, Category } from "../types/index.js";
import { nanoid } from "../utils/id.js";
import { CategoryRule, applyCategoryRules } from "./settingsService.js";

/**
 * Parse un buffer CSV et retourne des transactions selon le mapping de colonnes fourni.
 */
export function parseCsv(raw: string, mapping: CsvMappingConfig, rules: CategoryRule[] = []): Transaction[] {
  const result = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const transactions: Transaction[] = [];

  for (const row of result.data) {
    const rawDate = row[mapping.date]?.trim() ?? "";
    const rawLabel = row[mapping.label]?.trim() ?? "";

    // Statut (auto-détecte "État" ou utilise mapping.status_col)
    const rawStatus = row["État"]?.trim() ?? (mapping.status_col ? row[mapping.status_col]?.trim() : undefined);
    const txnStatus: "validated" | "pending" | "rejected" =
      rawStatus === "Transaction finalisée" ? "validated"
      : rawStatus === "Transaction rejetée" ? "rejected"
      : "pending";

    let amountTtc = 0;

    if (mapping.debit && mapping.credit) {
      const debit = parseFrenchAmount(row[mapping.debit] ?? "0");
      const credit = parseFrenchAmount(row[mapping.credit] ?? "0");
      amountTtc = credit - debit;
    } else if (mapping.amount) {
      amountTtc = parseFrenchAmount(row[mapping.amount] ?? "0");
    }

    if (!rawDate || !rawLabel) continue;

    const vatRate = 0.2;
    const amountHt = parseFloat((amountTtc / (1 + vatRate)).toFixed(2));
    const vat = parseFloat((amountTtc - amountHt).toFixed(2));

    const notes = mapping.notes ? row[mapping.notes]?.trim() || undefined : undefined;
    const account = (mapping.account_col ? row[mapping.account_col]?.trim() : undefined) || row["Compte Bancaire"]?.trim() || "main";
    const tiers = (mapping.tiers_col ? row[mapping.tiers_col]?.trim() : undefined) || row["Tiers"]?.trim() || undefined;

    // Champs Penylane auto-détectés
    const justifiedRaw = row["Justifié"]?.trim();
    const justified: boolean | undefined =
      justifiedRaw === "Oui" ? true : justifiedRaw === "Non" ? false : undefined;

    const comment = row["Commentaires"]?.trim() || undefined;
    const paymentType = row["Type"]?.trim() || undefined;
    const cardHolder = row["Titulaire de la carte"]?.trim() || undefined;

    // Catégorie : règles utilisateur > colonne Penylane > libellé
    const rawCategory = (mapping.category_col ? row[mapping.category_col]?.trim() : undefined)
      || row["Types de dépenses / revenus"]?.trim()
      || undefined;
    const ruleCategory = applyCategoryRules(rawLabel, rules);
    const penylaneCategory = rawCategory ? mapPenylaneCategory(rawCategory) : null;
    const labelCategory = detectCategoryFromLabel(rawLabel);
    // Priorité : règles utilisateur > libellé > Penylane (si pas misc) > misc
    const category: Category = ruleCategory ?? labelCategory ?? (penylaneCategory !== "misc" ? penylaneCategory : null) ?? "misc";

    transactions.push({
      id: `txn_${nanoid()}`,
      date: normalizeDate(rawDate),
      label: rawLabel,
      amount_ht: amountHt,
      vat,
      amount_ttc: amountTtc,
      currency: "EUR",
      category,
      account,
      status: txnStatus,
      notes: notes || tiers || undefined,
      justified,
      comment,
      paymentType,
      cardHolder,
    });
  }

  return transactions;
}

/**
 * Parse un montant au format français :
 * - séparateur de milliers = espace (insécable ou normal)
 * - séparateur décimal = virgule
 * - symbole monétaire éventuel (€, $, £…)
 * Exemples : "1 060,80 €"  "-24,37 €"  "900,00 €"  "-1 059,96 €"
 */
function parseFrenchAmount(raw: string): number {
  let cleaned = raw
    .replace(/[€$£¥]/g, "")        // supprimer symboles monétaires
    .replace(/[\u00a0\u202f ]/g, "") // supprimer espaces (y compris insécables)
    .trim();

  // Format US (export XLSX) : "4,200.00" ou "1,059.96" — la virgule est séparateur de milliers
  if (/\d,\d{3}/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");  // retirer toutes les virgules de milliers
  } else {
    // Format français : "4200,00" — la virgule est le séparateur décimal
    cleaned = cleaned.replace(",", ".");
  }

  return parseFloat(cleaned) || 0;
}

/** Tente de normaliser diverses formats de date vers ISO (YYYY-MM-DD). */
function normalizeDate(raw: string): string {
  // D/M/YYYY ou DD/MM/YYYY (jour et mois à 1 ou 2 chiffres)
  const dmyMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    return `${dmyMatch[3]}-${month}-${day}`;
  }
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  return raw;
}

/**
 * Détecte la catégorie à partir du libellé de la transaction (prioritaire sur Penylane).
 * Retourne null si aucun mot-clé reconnu.
 */
function detectCategoryFromLabel(label: string): Category | null {
  const l = label.toLowerCase();
  if (l.includes("loyer") || l.includes(" bail ") || l.includes("garantie locat")) return "rent";
  if (l.includes("github") || l.includes("legalstart") || l.includes("comptalib")) return "software";
  if (l.includes("steam") || l.includes("valve")) return "software";
  if (l.includes("airbnb") || l.includes("volotea") || l.includes("air france") || l.includes("kiwi.com") || l.includes("sncf") || l.includes("navigo") || l.includes("aerhotel") || l.includes("alilaguna")) return "travel";
  if (l.includes("amazon")) return "equipment";
  if (l.includes("ikea") || l.includes("leroy merlin") || l.includes("bricoman") || l.includes("bureau vallee")) return "equipment";
  if (l.includes("hiscox")) return "insurance";
  if (l.includes("free pro") || l.includes("hostinger") || l.includes("google")) return "hosting";
  if (l.includes("kandbaz")) return "subscription";
  if (l.includes("fnac")) return "equipment";
  if (l.includes("carrefour") || l.includes("spar") || l.includes("tommy")) return "restaurant";
  if (l.includes("impôt") || l.includes("impots") || l.includes(" is 20")) return "taxes";
  return null;
}

/**
 * Mappe une valeur de catégorie Penylane vers nos catégories internes.
 * La comparaison est insensible à la casse.
 */
function mapPenylaneCategory(raw: string): Category {
  const v = raw.toLowerCase();
  if (v.includes("logiciel") || v.includes("service web") || v.includes("software")) return "software";
  if (v.includes("hébergement") || v.includes("hosting")) return "hosting";
  if (v.includes("loyer")) return "rent";
  if (v.includes("déplacement") || v.includes("transport") || v.includes("voyage") || v.includes("travel")) return "travel";
  if (v.includes("alimentaire") || v.includes("épicerie") || v.includes("courses")) return "food";
  if (v.includes("restaurant") || v.includes("repas")) return "restaurant";
  if (v.includes("salaire") || v.includes("salary") || v.includes("rémunération")) return "salary";
  if (v.includes("sous-traitance") || v.includes("sous traitance") || v.includes("subcontract")) return "subcontracting";
  if (v.includes("honoraire") || v.includes("consultant") || v.includes("conseil")) return "professional_fees";
  if (v.includes("prestataire") || v.includes("prestation de service") || v.includes("service extérieur")) return "external_services";
  if (v.includes("impôt") || v.includes("taxe") || v.includes("tax")) return "taxes";
  if (v.includes("bureau") || v.includes("ordinateur") || v.includes("équipement") || v.includes("matériel")) return "equipment";
  if (v.includes("téléphone") || v.includes("internet") || v.includes("abonnement")) return "subscription";
  if (v.includes("juridique") || v.includes("legal") || v.includes("droit")) return "legal";
  if (v.includes("assurance") || v.includes("insurance")) return "insurance";
  return "misc";
}
