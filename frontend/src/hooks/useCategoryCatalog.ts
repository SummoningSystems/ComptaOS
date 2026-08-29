import { useCallback, useEffect, useState } from "react";
import { fetchCategories } from "../api/client";
import type { CategoryDefinition } from "../types";

export const FALLBACK_CATEGORIES: CategoryDefinition[] = [
  ["telecom", "Internet et télécommunications"], ["hosting", "Hébergement web et cloud"],
  ["software", "Logiciels et licences"], ["salary", "Salaires"], ["social_charges", "Charges sociales"],
  ["subcontracting", "Sous-traitance"], ["professional_fees", "Conseil et honoraires"],
  ["external_services", "Autres prestations"], ["travel", "Déplacements"], ["restaurant", "Repas et réceptions"],
  ["food", "Alimentation"], ["taxes", "Impôts et taxes"], ["equipment", "Petit équipement"],
  ["office_supplies", "Fournitures de bureau"], ["subscription", "Abonnements et cotisations"],
  ["rent", "Loyers et locations"], ["leasing", "Crédit-bail"], ["legal", "Frais juridiques"],
  ["insurance", "Assurances"], ["bank_fees", "Frais bancaires"], ["advertising", "Publicité et communication"],
  ["training", "Formation"], ["maintenance", "Entretien et maintenance"], ["utilities", "Énergie et eau"],
  ["shipping", "Transport et livraison"], ["recruitment", "Recrutement"], ["vehicle", "Véhicules et carburant"],
  ["interest", "Intérêts et frais financiers"], ["misc", "Divers"],
].map(([id, label]) => ({ id, label, account: { number: "", label: "" }, kind: "expense" as const, builtin: true, active: true }));

FALLBACK_CATEGORIES.push(
  ...[["service_revenue", "Prestations de services facturées"], ["goods_sales", "Ventes de marchandises"], ["product_sales", "Ventes de produits fabriqués"], ["royalty_revenue", "Licences et redevances perçues"], ["operating_grant", "Subventions d’exploitation"], ["financial_revenue", "Produits financiers"], ["exceptional_revenue", "Produits exceptionnels"], ["other_revenue", "Autres recettes"]]
    .map(([id, label]) => ({ id, label, account: { number: "", label: "" }, kind: "revenue" as const, builtin: true, active: true })),
);

let cached: CategoryDefinition[] | null = null;

export function useCategoryCatalog() {
  const [categories, setCategories] = useState<CategoryDefinition[]>(cached ?? FALLBACK_CATEGORIES);
  const reload = useCallback(async () => {
    try { cached = await fetchCategories(); setCategories(cached); } catch { /* fallback keeps the UI usable */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { categories: categories.filter((item) => item.active), allCategories: categories, reload };
}
