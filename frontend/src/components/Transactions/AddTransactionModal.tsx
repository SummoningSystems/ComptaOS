import { useRef, useEffect, useState } from "react";
import { Category, Transaction } from "../../types";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";

const VAT_RATE_PRESETS = [0, 2.1, 5.5, 10, 20];

interface Props {
  onClose: () => void;
  onSave: (txn: Omit<Transaction, "id">) => Promise<void>;
}

export function AddTransactionModal({ onClose, onSave }: Props) {
  const { categories } = useCategoryCatalog();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [label, setLabel] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [category, setCategory] = useState<Category>("misc");
  const [vatRate, setVatRate] = useState(20);
  const [paymentType, setPaymentType] = useState("Espèces");
  const [notes, setNotes] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // Focus on label on mount
  useEffect(() => { labelRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function parseAmount(raw: string): number | null {
    // Accepte : "-24,37 €", "1 060.80", "1060,80", "-1 059,96 €"
    const cleaned = raw.replace(/\s/g, "").replace("€", "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amount_ttc = parseAmount(amountRaw);
    if (!label.trim()) { setError("Le libellé est obligatoire."); return; }
    if (amount_ttc === null) { setError("Montant invalide (ex: -24.37 ou 1060,80)."); return; }

    const vatFactor = vatRate / 100;
    const amount_ht = amount_ttc / (1 + vatFactor);
    const vat = amount_ttc - amount_ht;

    const txn: Omit<Transaction, "id"> = {
      date,
      label: label.trim(),
      amount_ttc,
      amount_ht: Math.round(amount_ht * 100) / 100,
      vat: Math.round(vat * 100) / 100,
      vat_rate: vatRate,
      currency: "EUR",
      category,
      account: "main",
      status: "pending",
      paymentType: paymentType || undefined,
      notes: notes.trim() || undefined,
      invoiceRef: invoiceRef.trim() || undefined,
      justified: false,
    };

    setSaving(true);
    try {
      await onSave(txn);
      onClose();
    } catch {
      setError("Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-vscode-panel border border-vscode-border rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-vscode-border">
          <h2 className="text-sm font-semibold text-vscode-text">Nouvelle transaction</h2>
          <button onClick={onClose} className="text-vscode-muted hover:text-vscode-text text-lg leading-none">×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-3">
          {/* Date + Libellé */}
          <div className="grid grid-cols-[130px_1fr] gap-2">
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">Libellé *</label>
              <input
                ref={labelRef}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex: Café client, Billet train…"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
                required
              />
            </div>
          </div>

          {/* Montant + TVA */}
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">
                Montant TTC *
                <span className="ml-1 text-vscode-muted/60">(négatif = dépense)</span>
              </label>
              <input
                type="text"
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="-24,37  ou  1060,80"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">TVA %</label>
              <input
                list="vat-rate-presets-create"
                type="number"
                min={0}
                step="0.01"
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
              />
              <datalist id="vat-rate-presets-create">
                {VAT_RATE_PRESETS.map((rate) => (
                  <option key={rate} value={rate} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Catégorie + Mode de paiement */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">Catégorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
              >
                <optgroup label="Recettes">
                  {categories.filter((c) => c.kind === "revenue" || c.kind === "both").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
                <optgroup label="Dépenses">
                  {categories.filter((c) => c.kind === "expense" || c.kind === "both").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">Mode de paiement</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
              >
                <option>Espèces</option>
                <option>Virement</option>
                <option>Paiement par carte</option>
                <option>Prélèvement</option>
                <option>Chèque</option>
              </select>
            </div>
          </div>

          {/* Notes + Réf. facture */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">Notes / Tiers</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Nom du tiers, contexte…"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
              />
            </div>
            <div>
              <label className="block text-[10px] text-vscode-muted mb-0.5">Réf. facture (rapprochement)</label>
              <input
                type="text"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                placeholder="ex: F2025 012"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent font-mono"
              />
            </div>
          </div>

          {/* Preview HT */}
          {amountRaw && parseAmount(amountRaw) !== null && (
            <div className="flex items-center gap-4 text-[10px] bg-vscode-bg rounded px-3 py-2 border border-vscode-border">
              {(() => {
                const ttc = parseAmount(amountRaw)!;
                const ht = ttc / (1 + vatRate / 100);
                const vat = ttc - ht;
                const isOut = ttc < 0;
                return (
                  <>
                    <span className={isOut ? "text-red-400" : "text-green-400"}>
                      TTC {ttc.toFixed(2)} €
                    </span>
                    <span className="text-vscode-muted">HT {ht.toFixed(2)} €</span>
                    <span className="text-vscode-muted">TVA {vat.toFixed(2)} €</span>
                    <span className={`ml-auto font-semibold ${isOut ? "text-red-300" : "text-green-300"}`}>
                      {isOut ? "💸 Dépense" : "💰 Recette"}
                    </span>
                  </>
                );
              })()}
            </div>
          )}

          {error && <p className="text-red-400 text-[10px]">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-vscode-muted hover:text-vscode-text px-3 py-1.5 rounded border border-vscode-border"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-xs bg-vscode-accent hover:brightness-110 disabled:opacity-50 text-white px-4 py-1.5 rounded font-medium"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
