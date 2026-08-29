import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getActiveCompanyPath } from "./companiesService.js";

export interface CategoryDefinition {
  id: string;
  label: string;
  account: { number: string; label: string };
  kind: "expense" | "revenue" | "both";
  builtin: boolean;
  active: boolean;
}

const builtin = (id: string, label: string, number: string, accountLabel: string, kind: CategoryDefinition["kind"] = "expense"): CategoryDefinition =>
  ({ id, label, account: { number, label: accountLabel }, kind, builtin: true, active: true });

export const BUILTIN_CATEGORIES: CategoryDefinition[] = [
  builtin("telecom", "Internet et télécommunications", "626000", "Frais postaux et télécommunications"),
  builtin("hosting", "Hébergement web et cloud", "626000", "Hébergement et services en ligne"),
  builtin("software", "Logiciels et licences", "615600", "Maintenance et logiciels"),
  builtin("salary", "Salaires", "641000", "Rémunérations du personnel"),
  builtin("social_charges", "Charges sociales", "645000", "Charges de sécurité sociale et de prévoyance"),
  builtin("subcontracting", "Sous-traitance", "611000", "Sous-traitance générale"),
  builtin("professional_fees", "Conseil et honoraires", "622600", "Honoraires"),
  builtin("external_services", "Autres prestations", "628000", "Autres services extérieurs"),
  builtin("travel", "Déplacements", "625100", "Voyages et déplacements"),
  builtin("restaurant", "Repas et réceptions", "625700", "Réceptions"),
  builtin("food", "Alimentation", "625700", "Réceptions"),
  builtin("taxes", "Impôts et taxes", "635000", "Autres impôts et taxes"),
  builtin("equipment", "Petit équipement", "606300", "Petit équipement"),
  builtin("office_supplies", "Fournitures de bureau", "606400", "Fournitures administratives"),
  builtin("subscription", "Abonnements et cotisations", "628100", "Cotisations"),
  builtin("rent", "Loyers et locations", "613200", "Locations immobilières"),
  builtin("leasing", "Crédit-bail", "612000", "Redevances de crédit-bail"),
  builtin("legal", "Frais juridiques", "622700", "Frais d'actes et de contentieux"),
  builtin("insurance", "Assurances", "616000", "Primes d'assurances"),
  builtin("bank_fees", "Frais bancaires", "627000", "Services bancaires et assimilés"),
  builtin("advertising", "Publicité et communication", "623000", "Publicité, publications et relations publiques"),
  builtin("training", "Formation", "618500", "Frais de colloques, séminaires, conférences"),
  builtin("maintenance", "Entretien et maintenance", "615000", "Entretien et réparations"),
  builtin("utilities", "Énergie et eau", "606100", "Fournitures non stockables"),
  builtin("shipping", "Transport et livraison", "624100", "Transports sur achats"),
  builtin("recruitment", "Recrutement", "628400", "Frais de recrutement de personnel"),
  builtin("vehicle", "Véhicules et carburant", "625100", "Voyages et déplacements"),
  builtin("interest", "Intérêts et frais financiers", "661000", "Charges d'intérêts"),
  builtin("misc", "Divers (dépense)", "658000", "Charges diverses de gestion courante"),
  builtin("service_revenue", "Prestations de services facturées", "706000", "Prestations de services", "revenue"),
  builtin("goods_sales", "Ventes de marchandises", "707000", "Ventes de marchandises", "revenue"),
  builtin("product_sales", "Ventes de produits fabriqués", "701000", "Ventes de produits finis", "revenue"),
  builtin("royalty_revenue", "Licences et redevances perçues", "751000", "Redevances pour concessions, brevets et licences", "revenue"),
  builtin("operating_grant", "Subventions d’exploitation", "740000", "Subventions d'exploitation", "revenue"),
  builtin("financial_revenue", "Produits financiers", "760000", "Produits financiers", "revenue"),
  builtin("exceptional_revenue", "Produits exceptionnels", "770000", "Produits exceptionnels", "revenue"),
  builtin("other_revenue", "Autres recettes", "758000", "Autres produits de gestion courante", "revenue"),
];

const file = () => join(getActiveCompanyPath(), "settings", "categories.json");

function customCategories(): CategoryDefinition[] {
  if (!existsSync(file())) return [];
  try {
    const value = JSON.parse(readFileSync(file(), "utf-8"));
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.label === "string" && typeof item.account?.number === "string").map((item) => ({ ...item, kind: ["expense", "revenue", "both"].includes(item.kind) ? item.kind : "both" })) : [];
  } catch { return []; }
}

export function loadCategoryCatalog(): CategoryDefinition[] {
  return [...BUILTIN_CATEGORIES, ...customCategories()].map((item) => ({ ...item, account: { ...item.account } }));
}

export function upsertCustomCategory(input: Omit<CategoryDefinition, "builtin">): CategoryDefinition {
  const category: CategoryDefinition = { ...input, id: input.id.trim().toLowerCase(), label: input.label.trim(), account: { number: input.account.number.trim(), label: input.account.label.trim() }, builtin: false };
  const categories = customCategories();
  const index = categories.findIndex((item) => item.id === category.id);
  if (index >= 0) categories[index] = category; else categories.push(category);
  mkdirSync(join(getActiveCompanyPath(), "settings"), { recursive: true });
  atomicWriteFileSync(file(), JSON.stringify(categories, null, 2));
  return category;
}

export function deactivateCustomCategory(id: string): boolean {
  const categories = customCategories();
  const category = categories.find((item) => item.id === id);
  if (!category) return false;
  category.active = false;
  atomicWriteFileSync(file(), JSON.stringify(categories, null, 2));
  return true;
}
