import { describe, expect, it } from "vitest";
import { parseReceiptTextLocally } from "../services/receiptParser.js";

describe("analyse comptable locale d'un ticket", () => {
  it("reconstruit une ventilation multi-TVA à partir des bases HT et TVA", () => {
    const result = parseReceiptTextLocally(`BISTRO DU TEST\nFACTURE N-42\n04/08/2026\nTVA 10 % 16,18 1,62\nTVA 20 % 7,50 1,50\nTOTAL HT 23,68\nTOTAL TTC 26,80`);
    expect(result).toMatchObject({ supplier: "BISTRO DU TEST", date: "2026-08-04", invoiceRef: "N-42", amountHt: 23.68, amountVat: 3.12, amountTtc: 26.8, category: "restaurant", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountHt: 16.18, amountVat: 1.62, amountTtc: 17.8 }, { rate: 20, amountHt: 7.5, amountVat: 1.5, amountTtc: 9 }]);
  });

  it("refuse une ventilation incohérente avec le total", () => {
    const result = parseReceiptTextLocally(`RESTAURANT TEST\nTVA 10 % TTC 12,00\nTOTAL TTC 30,00`);
    expect(result.vatSplits).toEqual([]);
    expect(result.confidence).not.toBe("high");
  });

  it("associe correctement un récapitulatif PDF lu colonne par colonne", () => {
    const result = parseReceiptTextLocally(`Scaleaway\nBill 5419116\nDesignation\nTotal HT\nTaux TVA\nTotal TVA\nTotal TTC\n72,99 Euros\n20,00 %\n14,60 Euros\n87,59 Euros`);
    expect(result).toMatchObject({ supplier: "Scaleaway", invoiceRef: "5419116", amountHt: 72.99, amountTtc: 87.59, confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 20, amountHt: 72.99, amountVat: 14.6, amountTtc: 87.59 }]);
  });

  it("reconstruit un ticket multi-TVA lu verticalement", () => {
    const result = parseReceiptTextLocally(`YANKEE GRILL\nHT\nTVA\nTTC\nTVA 10 %\n16,18\n1,62\n17,80\nTVA 20 %\n7,50\n1,50\n9,00\nTOTAL\n26,80\nEUR`);
    expect(result).toMatchObject({ supplier: "YANKEE GRILL", amountHt: 23.68, amountTtc: 26.8, category: "restaurant", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountHt: 16.18, amountVat: 1.62, amountTtc: 17.8 }, { rate: 20, amountHt: 7.5, amountVat: 1.5, amountTtc: 9 }]);
  });

  it("analyse une facture numérique Unity en anglais", () => {
    const result = parseReceiptTextLocally(`Unity Technologies SF
Invoice
Invoice No.
IN010102957943
Date
August 07, 2026
Salesperson Unity Asset Store
Tower Defense Pack Orcs - Low Poly 3D Art
1
20%
€ 36.79
Total Excl. TAX*
€ 36.79
Total TAX*
€ 7.36
Total Incl. TAX*
€ 44.15`);
    expect(result).toMatchObject({ supplier: "Unity Technologies SF", invoiceRef: "IN010102957943", date: "2026-08-07", amountHt: 36.79, amountVat: 7.36, amountTtc: 44.15, category: "software", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 20, amountHt: 36.79, amountVat: 7.36, amountTtc: 44.15 }]);
  });
  it("reconstruit les deux TVA d'un justificatif Lightspeed tourné", () => {
    const result = parseReceiptTextLocally(`* JUSTIFICATIF DE PAIEMENT #2 *
LA TABLE DE LAURENT
13/08/2026 13:32:12
Repas complet
Total
31.50
(HT: € 28.34)
A: TVA 10% sur 25.08: € 2.51 (27.58)
B: TVA 20% sur 3.26: € 0.65 (3.92)`);
    expect(result).toMatchObject({ amountHt: 28.34, amountVat: 3.16, amountTtc: 31.5, category: "restaurant", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountHt: 25.07, amountVat: 2.51, amountTtc: 27.58 }, { rate: 20, amountHt: 3.27, amountVat: 0.65, amountTtc: 3.92 }]);
  });

  it("analyse un ticket de boulangerie avec le récapitulatif français sur plusieurs lignes", () => {
    const result = parseReceiptTextLocally(`SAS BOULANGERIES BG
Marie Blachère
15/07/2026 à 12:12:55
Hors taxe
4,45 €
TVA
0,45 €
Total TTC
4,90 €
CODE
TAUX
HT
TVA
3
10.00 %
4.45
0.45`);
    expect(result).toMatchObject({ supplier: "SAS BOULANGERIES BG", date: "2026-07-15", amountHt: 4.45, amountVat: 0.45, amountTtc: 4.9, category: "restaurant", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountHt: 4.45, amountVat: 0.45, amountTtc: 4.9 }]);
  });

  it("analyse une facture Free Pro dont le taux est placé dans la ligne Total TVA", () => {
    const result = parseReceiptTextLocally(`SUMMONING SYSTEMS
Synthèse de votre facture
Total HT 39.99 €
Total TVA 20% 8.00 €
TOTAL TTC 47.99 €
Date d'échéance : comptant
Référence mandat: JNRUMSUMMONINGSYSTEM020260302104129
DATE
01/07/2026
N° DE FACTURE
F202607078452
Free Pro commercialise les offres fixes Freebox Pro.`);
    expect(result).toMatchObject({ supplier: "Free Pro", invoiceRef: "F202607078452", date: "2026-07-01", amountHt: 39.99, amountVat: 8, amountTtc: 47.99, category: "telecom", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 20, amountHt: 39.99, amountVat: 8, amountTtc: 47.99 }]);
  });
  it("ne confond pas la TVA avec le total simple d'un ticket de restaurant", () => {
    const result = parseReceiptTextLocally(`LES ASIATIDES
13/07/2026
TICKET N° 0019187/8
TOTAL 15,50 EUR
TVA 1,41 EUR`);
    expect(result).toMatchObject({ supplier: "LES ASIATIDES", date: "2026-07-13", invoiceRef: "0019187/8", amountHt: 14.09, amountVat: 1.41, amountTtc: 15.5, confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountHt: 14.09, amountVat: 1.41, amountTtc: 15.5 }]);
  });

  it("associe les valeurs quand les en-têtes TVA TTC HT sont regroupés avant elles", () => {
    const result = parseReceiptTextLocally(`LES ASIATIDES
Ticket #0019187/8
15,50
TVA
TTC
HT
1,41
15,50
14,09
TVA 10 %
15,50 EUR
TOTAL`);
    expect(result).toMatchObject({ supplier: "LES ASIATIDES", invoiceRef: "0019187/8", amountHt: 14.09, amountVat: 1.41, amountTtc: 15.5, confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountHt: 14.09, amountVat: 1.41, amountTtc: 15.5 }]);
  });

  it("analyse une facture avec le symbole euro entre Total et HT ou TTC", () => {
    const result = parseReceiptTextLocally(`KANDBAZ
Total € HT 37,00
TVA_20 (20%) 7,40
Total € TTC 44,40€
Paiement effectué (-) 44,40
Date de facture : 01-07-2026
FACTURE
N° de facture FZ-707242`);
    expect(result).toMatchObject({ supplier: "KANDBAZ", invoiceRef: "FZ-707242", date: "2026-07-01", amountHt: 37, amountVat: 7.4, amountTtc: 44.4, category: "subscription", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 20, amountHt: 37, amountVat: 7.4, amountTtc: 44.4 }]);
  });
});
