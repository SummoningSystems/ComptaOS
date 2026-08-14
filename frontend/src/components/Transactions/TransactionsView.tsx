import { useEffect, useRef, useState } from "react";
import { Transaction, Category, VatSplit } from "../../types";
import { needsTransactionEvidence } from "../../utils/transactionEvidence";
import { api, analyzeAttachment, fetchTransactions, updateTransaction, deleteTransaction, deleteTransactions, createTransaction, uploadAttachment, deleteAttachment, attachmentUrl, bulkUpdateStatus, fetchSmartSuggestions, applySmartCategories, type ReceiptOcrProposal } from "../../api/client";
import { AddTransactionModal } from "./AddTransactionModal";
import { AttachmentDropZone } from "./AttachmentDropZone";
import { ReceiptOcrDialog } from "./ReceiptOcrDialog";
import { PendingReceiptsPanel } from "./PendingReceiptsPanel";
import { aiCategorize } from "../../api/ai";
import { fetchAllTags } from "../../api/search";

// ── Tag editor inline ─────────────────────────────────────────────────────────

function TagEditor({
  tags,
  allTags,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function addTag(tag: string) {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput("");
    setAdding(false);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  const suggestions = allTags.filter(
    (t) => !tags.includes(t) && t.includes(input.toLowerCase())
  );

  return (
    <div className="flex flex-wrap items-center gap-1 min-w-[100px]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 bg-vscode-border text-vscode-text text-[10px] px-1.5 py-0.5 rounded-full"
        >
          {tag}
          <button
            onClick={() => removeTag(tag)}
            className="text-vscode-muted hover:text-red-400 ml-0.5 leading-none"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag(input);
              if (e.key === "Escape") { setAdding(false); setInput(""); }
            }}
            onBlur={() => { if (!input) setAdding(false); }}
            className="bg-vscode-bg border border-vscode-accent text-vscode-text text-[10px] rounded px-1.5 py-0.5 w-24 focus:outline-none"
            placeholder="tag…"
          />
          {suggestions.length > 0 && input && (
            <div className="absolute top-full mt-0.5 left-0 bg-vscode-panel border border-vscode-border rounded shadow-lg z-10 min-w-[120px]">
              {suggestions.slice(0, 5).map((s) => (
                <button
                  key={s}
                  onMouseDown={() => addTag(s)}
                  className="block w-full text-left px-2 py-1 text-[10px] text-vscode-text hover:bg-vscode-border"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] text-vscode-muted hover:text-vscode-text border border-dashed border-vscode-border rounded-full px-1.5 py-0.5"
          title="Ajouter un tag"
        >
          +tag
        </button>
      )}
    </div>
  );
}

const CATEGORIES: Category[] = [
  "hosting", "software", "salary", "subcontracting", "professional_fees", "external_services", "travel", "restaurant", "food",
  "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc",
];
const CATEGORY_LABELS: Partial<Record<Category, string>> = {
  subcontracting: "Sous-traitance",
  professional_fees: "Conseil et honoraires",
  external_services: "Autres prestations",
};

const VAT_RATE_PRESETS = [0, 2.1, 5.5, 10, 20];

function roundVatRate(value: number): number {
  return Math.round(value * 100) / 100;
}

function snapVatRate(value: number): number {
  const rounded = roundVatRate(value);
  const preset = VAT_RATE_PRESETS.find((candidate) => Math.abs(candidate - rounded) <= 0.2);
  return preset ?? rounded;
}

function formatVatRateInput(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundVatRate(value));
}

function VatRateEditor({
  txn,
  value,
  onSave,
}: {
  txn: Transaction;
  value: number;
  onSave: (id: string, vat_rate: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(formatVatRateInput(value));

  useEffect(() => {
    setDraft(formatVatRateInput(value));
  }, [value, txn.id]);

  async function commit(rawValue: string) {
    const parsed = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(formatVatRateInput(value));
      return;
    }

    const normalized = roundVatRate(parsed);
    if (Math.abs(normalized - value) < 0.001) {
      setDraft(formatVatRateInput(value));
      return;
    }

    try {
      await onSave(txn.id, normalized);
    } catch {
      setDraft(formatVatRateInput(value));
    }
  }

  return (
    <input
      list="vat-rate-presets"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { void commit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(formatVatRateInput(value));
          e.currentTarget.blur();
        }
      }}
      className="mt-1 w-[72px] text-[10px] bg-vscode-bg border border-vscode-border rounded px-1 py-0.5 text-vscode-muted focus:outline-none focus:border-vscode-accent"
      title="Taux de TVA appliqué à la transaction"
      aria-label="Taux de TVA"
      placeholder="0"
    />
  );
}

function VatSplitDialog({
  txn,
  onSave,
  onClose,
}: {
  txn: Transaction;
  onSave: (id: string, splits: VatSplit[]) => Promise<void>;
  onClose: () => void;
}) {
  const sign = txn.amount_ttc < 0 ? -1 : 1;
  const initial = txn.vat_splits && txn.vat_splits.length >= 2
    ? txn.vat_splits
    : [
        { rate: 10, amount_ttc: 0 },
        { rate: 20, amount_ttc: txn.amount_ttc },
      ];
  const [splits, setSplits] = useState<VatSplit[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const total = round2(splits.reduce((sum, split) => sum + split.amount_ttc, 0));
  const remaining = round2(txn.amount_ttc - total);
  const isBalanced = splits.length >= 2 && Math.abs(remaining) < 0.005;

  function updateSplit(index: number, patch: Partial<VatSplit>) {
    setSplits((current) => current.map((split, i) => i === index ? { ...split, ...patch } : split));
    setError("");
  }

  function fillRemaining(index: number) {
    const otherTotal = splits.reduce((sum, split, i) => i === index ? sum : sum + split.amount_ttc, 0);
    updateSplit(index, { amount_ttc: round2(txn.amount_ttc - otherTotal) });
  }

  async function save(nextSplits: VatSplit[]) {
    setSaving(true);
    setError("");
    try {
      await onSave(txn.id, nextSplits);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "La ventilation TVA n'a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Ventilation TVA">
      <div className="w-full max-w-lg rounded-lg border border-vscode-border bg-vscode-panel p-4 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-vscode-text">Ventiler la TVA du repas</h3>
            <p className="mt-1 text-xs text-vscode-muted">{txn.label} · Total TTC {Math.abs(txn.amount_ttc).toFixed(2)} €</p>
          </div>
          <button onClick={onClose} className="text-vscode-muted hover:text-vscode-text" aria-label="Fermer">×</button>
        </div>

        <div className="space-y-2">
          {splits.map((split, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={split.rate}
                onChange={(event) => updateSplit(index, { rate: Number(event.target.value) })}
                className="rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs text-vscode-text"
                aria-label={`Taux TVA ligne ${index + 1}`}
              >
                {VAT_RATE_PRESETS.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-vscode-muted">
                TTC
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={Math.abs(split.amount_ttc)}
                  onChange={(event) => updateSplit(index, { amount_ttc: round2(sign * (Number(event.target.value) || 0)) })}
                  className="w-28 rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-right font-mono text-vscode-text"
                  aria-label={`Montant TTC ligne ${index + 1}`}
                />
                €
              </label>
              <button onClick={() => fillRemaining(index)} className="rounded border border-vscode-border px-2 py-1 text-xs text-vscode-muted hover:text-vscode-text" title="Affecter le montant restant">Solde</button>
              <button
                onClick={() => setSplits((current) => current.filter((_, i) => i !== index))}
                disabled={splits.length <= 2}
                className="px-1 text-vscode-muted hover:text-red-400 disabled:opacity-30"
                aria-label={`Supprimer la ligne ${index + 1}`}
              >×</button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => setSplits((current) => [...current, { rate: 20, amount_ttc: remaining }])}
            className="rounded border border-vscode-border px-2 py-1 text-xs text-vscode-muted hover:text-vscode-text"
          >+ Ajouter un taux</button>
          <span className={`text-xs font-mono ${isBalanced ? "text-green-400" : "text-orange-400"}`}>
            {isBalanced ? "Total équilibré" : `Reste ${Math.abs(remaining).toFixed(2)} €`}
          </span>
        </div>

        {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {txn.vat_splits && txn.vat_splits.length >= 2 && (
            <button onClick={() => void save([])} disabled={saving} className="mr-auto rounded px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20">Supprimer la ventilation</button>
          )}
          <button onClick={onClose} disabled={saving} className="rounded px-3 py-1.5 text-xs text-vscode-muted hover:text-vscode-text">Annuler</button>
          <button
            onClick={() => void save(splits)}
            disabled={!isBalanced || saving}
            className="rounded bg-vscode-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >{saving ? "Enregistrement…" : "Enregistrer la TVA"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Smart Catégoriser ─────────────────────────────────────────────────────────

interface SmartSuggestion {
  id: string;
  label: string;
  amount_ttc: number;
  suggestedCategory: string;
  suggestedVatRate?: number;
  confidenceLevel: "high" | "medium" | "low";
  confidenceScore: number;
  matchedKeyword: string;
  reason: string;
}

function SmartCategorizeModal({
  suggestions,
  selected,
  applying,
  onToggle,
  onToggleAll,
  onApply,
  onClose,
}: {
  suggestions: SmartSuggestion[];
  selected: Set<string>;
  applying: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const CONF_COLORS = {
    high:   "bg-green-800 text-green-300",
    medium: "bg-yellow-800 text-yellow-300",
    low:    "bg-red-800 text-red-300",
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-vscode-panel border border-vscode-border rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-vscode-border shrink-0">
          <span className="text-sm font-semibold text-vscode-text">
            ✨ Smart Catégoriser — {suggestions.length} suggestion{suggestions.length > 1 ? "s" : ""}
          </span>
          <button onClick={onClose} className="text-vscode-muted hover:text-vscode-text text-lg leading-none">×</button>
        </div>
        <div className="px-4 py-2 border-b border-vscode-border shrink-0 flex items-center gap-3">
          <button
            onClick={onToggleAll}
            className="text-xs text-vscode-accent hover:underline"
          >
            {selected.size === suggestions.length ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
          <span className="text-vscode-muted text-xs">{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
          <span className="text-vscode-muted text-[10px] ml-auto">Pattern matching local — aucun LLM requis</span>
        </div>
        <div className="overflow-auto flex-1 divide-y divide-vscode-border">
          {suggestions.map((s) => (
            <label key={s.id} className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-vscode-sidebar transition-colors ${selected.has(s.id) ? "bg-vscode-sidebar/60" : ""}`}>
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => onToggle(s.id)}
                className="accent-vscode-accent shrink-0"
              />
              <span className="flex-1 text-xs text-vscode-text truncate" title={s.label}>{s.label}</span>
              <span className={`text-xs tabular-nums shrink-0 ${s.amount_ttc < 0 ? "text-red-400" : "text-green-400"}`}>
                {s.amount_ttc >= 0 ? "+" : ""}{s.amount_ttc.toFixed(2)} €
              </span>
              <span className="text-xs text-vscode-accent shrink-0 w-28 text-right">{s.suggestedCategory}</span>
              {s.suggestedVatRate !== undefined && <span className="text-[10px] text-purple-300 shrink-0">TVA {s.suggestedVatRate} %</span>}
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${CONF_COLORS[s.confidenceLevel]}`}>
                {s.confidenceLevel}
              </span>
              <span className="text-[10px] text-vscode-muted max-w-40 truncate" title={s.reason}>ⓘ {s.reason}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-vscode-border shrink-0">
          <button onClick={onClose} className="text-xs text-vscode-muted hover:text-vscode-text px-3 py-1.5">Annuler</button>
          <button
            onClick={onApply}
            disabled={applying || selected.size === 0}
            className="text-xs bg-vscode-accent hover:brightness-110 disabled:opacity-50 text-white px-4 py-1.5 rounded font-medium"
          >
            {applying ? "Application…" : `Appliquer (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_COLORS: Record<Category, string> = {
  hosting: "bg-blue-900 text-blue-300",
  software: "bg-purple-900 text-purple-300",
  salary: "bg-green-900 text-green-300",
  subcontracting: "bg-cyan-900 text-cyan-300",
  professional_fees: "bg-violet-900 text-violet-300",
  external_services: "bg-slate-700 text-slate-200",
  travel: "bg-yellow-900 text-yellow-300",
  restaurant: "bg-orange-900 text-orange-300",
  food: "bg-lime-900 text-lime-300",
  taxes: "bg-red-900 text-red-300",
  equipment: "bg-cyan-900 text-cyan-300",
  subscription: "bg-pink-900 text-pink-300",
  rent: "bg-teal-900 text-teal-300",
  legal: "bg-indigo-900 text-indigo-300",
  insurance: "bg-sky-900 text-sky-300",
  misc: "bg-gray-700 text-gray-300",
};

type WorkFilter = "unjustified" | "misc" | "pending" | "duplicates" | "receipt-inbox";
const WORK_FILTER_LABELS: Partial<Record<WorkFilter, string>> = { unjustified: "Transactions sans justificatif", misc: "Transactions à catégoriser", duplicates: "Doublons potentiels", "receipt-inbox": "Justificatifs en attente de rapprochement" };

export function TransactionsView({ workFilter, month }: { workFilter?: WorkFilter; month?: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{
    id: string;
    category: string;
    vat_rate: number;
    reasoning: string;
    confidence: string;
  } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<Category | "">(workFilter === "misc" ? "misc" : "")
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "validated" | "rejected">(workFilter === "pending" ? "pending" : "")
  const [dateFrom, setDateFrom] = useState(month ? `${month}-01` : "")
  const [dateTo, setDateTo] = useState(month ? `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}` : "")
  const [showUnjustified, setShowUnjustified] = useState(workFilter === "unjustified");
  const [hideRejected, setHideRejected] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [holderFilter, setHolderFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [flowFilter, setFlowFilter] = useState<"" | "in" | "out">("");
  const [editingInvoiceRef, setEditingInvoiceRef] = useState<string | null>(null);
  const [invoiceRefInput, setInvoiceRefInput] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState<string | null>(null);
  const [ocrAnalyzingAttachment, setOcrAnalyzingAttachment] = useState<string | null>(null);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const [smartSuggestions, setSmartSuggestions] = useState<SmartSuggestion[] | null>(null);
  const [smartApplying, setSmartApplying] = useState(false);
  const [smartSelected, setSmartSelected] = useState<Set<string>>(new Set());
  const [vatSplitTransaction, setVatSplitTransaction] = useState<Transaction | null>(null);
  const [vatSaveMessage, setVatSaveMessage] = useState<{ id: string; type: "success" | "error"; text: string } | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [ocrReview, setOcrReview] = useState<{ transaction: Transaction; proposal: ReceiptOcrProposal } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [data, tags] = await Promise.all([fetchTransactions(), fetchAllTags()]);
      const safeData = Array.isArray(data) ? data : [];
      const safeTags = Array.isArray(tags) ? tags : [];
      setTransactions(safeData);
      setAllTags(safeTags);
      // Tout replier par défaut
      const keys = new Set<string>();
      for (const t of safeData) {
        const year = t.date.slice(0, 4);
        const month = t.date.slice(5, 7);
        keys.add(year);
        keys.add(`${year}-${month}`);
      }
      setCollapsed(keys);
    } catch (err) {
      console.error("[TransactionsView] load() error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSmartCategorize() {
    const { suggestions } = await fetchSmartSuggestions();
    if (suggestions.length === 0) { alert("Aucune suggestion — toutes les transactions sont déjà catégorisées ou aucun pattern connu."); return; }
    setSmartSuggestions(suggestions);
    // Pré-sélectionner les suggestions "high"
    setSmartSelected(new Set(suggestions.filter((s) => s.confidenceLevel === "high").map((s) => s.id)));
  }

  async function handleSmartApply() {
    if (!smartSuggestions) return;
    setSmartApplying(true);
    try {
      const changes = smartSuggestions
        .filter((s) => smartSelected.has(s.id))
        .map((s) => ({ id: s.id, category: s.suggestedCategory as Category, vat_rate: s.suggestedVatRate }));
      await applySmartCategories(changes);
      setSmartSuggestions(null);
      await load();
    } finally {
      setSmartApplying(false);
    }
  }

  async function handleCategoryChange(id: string, category: Category) {    const updated = await updateTransaction(id, { category });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    setAttachmentMessage({ type: "success", text: "Catégorie enregistrée. ComptaOS mémorisera ce fournisseur pour les prochaines transactions similaires." });
  }

  async function handleStatusChange(id: string, status: Transaction["status"]) {
    const updated = await updateTransaction(id, { status });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }

  function inferredVatRate(txn: Transaction): number {
    if (typeof txn.vat_rate === "number" && Number.isFinite(txn.vat_rate)) return roundVatRate(txn.vat_rate);
    const ttcAbs = Math.abs(txn.amount_ttc ?? 0);
    const vatAbs = Math.abs(txn.vat ?? 0);
    const htAbs = Math.max(0, ttcAbs - vatAbs);
    if (htAbs <= 0) return 0;
    return snapVatRate((vatAbs / htAbs) * 100);
  }

  async function handleVatRateChange(id: string, vat_rate: number) {
    setVatSaveMessage(null);
    try {
      const updated = await updateTransaction(id, { vat_rate, vat_splits: [] });
      setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setVatSaveMessage({ id, type: "success", text: "TVA enregistrée" });
    } catch (err) {
      setVatSaveMessage({
        id,
        type: "error",
        text: err instanceof Error ? err.message : "Échec de l'enregistrement de la TVA",
      });
      throw err;
    }
  }

  async function handleVatSplitsChange(id: string, vat_splits: VatSplit[]) {
    const updated = await updateTransaction(id, { vat_splits });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    setVatSplitTransaction(updated);
    setVatSaveMessage({ id, type: "success", text: vat_splits.length >= 2 ? "Ventilation TVA enregistrée" : "Ventilation supprimée" });
  }

  async function handleTagsChange(id: string, tags: string[]) {
    const updated = await updateTransaction(id, { tags });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    const newTags = tags.filter((t) => !allTags.includes(t));
    if (newTags.length > 0) setAllTags((prev) => [...prev, ...newTags].sort());
  }

  async function handleDeleteOne(id: string) {
    if (!confirm("Supprimer cette transaction ?")) return;
    await deleteTransaction(id);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Supprimer les ${selected.size} transactions sélectionnées ?`)) return;
    setBulkDeleting(true);
    try {
      await deleteTransactions([...selected]);
      setTransactions((prev) => prev.filter((t) => !selected.has(t.id)));
      setSelected(new Set());
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleAiCategorize(txn: Transaction) {
    setAiLoading(txn.id);
    setAiSuggestion(null);
    try {
      const result = await aiCategorize(txn.label, txn.amount_ttc);
      setAiSuggestion({ id: txn.id, ...result });
    } catch {
      alert("Erreur catégorisation IA — vérifiez ANTHROPIC_API_KEY.");
    } finally {
      setAiLoading(null);
    }
  }

  async function handleJustifiedToggle(id: string, current: boolean | undefined) {
    const updated = await updateTransaction(id, { justified: !current });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }

  async function handleCreateTransaction(txn: Omit<import("../../types").Transaction, "id">) {
    const created = await createTransaction(txn);
    setTransactions((prev) =>
      [created, ...prev].sort((a, b) => b.date.localeCompare(a.date))
    );
  }

  async function handleAttachmentUpload(txnId: string, file: File) {
    setUploadingAttachment(txnId);
    setAttachmentMessage(null);
    try {
      const { transaction, compression } = await uploadAttachment(txnId, file, { skipOcr: true });
      setTransactions((prev) => prev.map((t) => (t.id === txnId ? transaction : t)));
      const uploadedMb = (compression.uploadedBytes / 1024 / 1024).toFixed(1);
      setAttachmentMessage({ type: "success", text: compression.compressed ? `Photo compressée de ${compression.savedPercent} % (${uploadedMb} Mo), puis enregistrée. Analyse OCR en cours…` : "Pièce justificative enregistrée. Analyse OCR en cours…" });
      const controller = new AbortController();
      ocrAbortRef.current = controller;
      setOcrAnalyzingAttachment(txnId);
      const { ocr } = await analyzeAttachment(txnId, controller.signal);
      if (ocr.status === "success" && ocr.proposal) setOcrReview({ transaction, proposal: ocr.proposal });
      else if (ocr.status === "unavailable") setAttachmentMessage({ type: "success", text: "Pièce enregistrée. OCR local indisponible : la saisie manuelle reste disponible." });
      else if (ocr.status === "error") setAttachmentMessage({ type: "success", text: "Pièce enregistrée, mais l'analyse OCR a échoué. La saisie manuelle reste disponible." });
    } catch (error) {
      const cancelled = error && typeof error === "object" && ("code" in error && error.code === "ERR_CANCELED" || "name" in error && error.name === "CanceledError");
      setAttachmentMessage(cancelled
        ? { type: "success", text: "Analyse OCR arrêtée. La pièce justificative est bien conservée." }
        : { type: "error", text: error instanceof Error ? error.message : "Erreur lors de l'envoi de la pièce jointe." });
    } finally {
      ocrAbortRef.current = null;
      setOcrAnalyzingAttachment(null);
      setUploadingAttachment(null);
    }
  }

  function cancelAttachmentOcr() {
    ocrAbortRef.current?.abort();
  }

  async function handleAttachmentDelete(txnId: string, filename: string) {
    if (!confirm("Supprimer la pièce jointe ?")) return;
    const updated = await deleteAttachment(txnId, filename);
    setTransactions((prev) => prev.map((t) => (t.id === txnId ? updated : t)));
  }

  async function applyOcrProposal(values: { category: Category; invoiceRef?: string; vatSplits: Array<{ rate: number; amountTtc: number }> }) {
    if (!ocrReview) return;
    const sign = ocrReview.transaction.amount_ttc < 0 ? -1 : 1;
    const updated = await updateTransaction(ocrReview.transaction.id, { category: values.category, invoiceRef: values.invoiceRef, vat_splits: values.vatSplits.map((split) => ({ rate: split.rate, amount_ttc: sign * split.amountTtc })) });
    setTransactions((current) => current.map((transaction) => transaction.id === updated.id ? updated : transaction));
    setAttachmentMessage({ type: "success", text: "TVA et informations du justificatif appliquées. Tu peux encore les modifier manuellement." });
    setOcrReview(null);
  }

  async function handleInvoiceRefSave(id: string) {
    const ref = invoiceRefInput.trim() || undefined;
    const updated = await updateTransaction(id, { invoiceRef: ref });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    setEditingInvoiceRef(null);
    setInvoiceRefInput("");
  }

  async function handleAcceptSuggestion() {
    if (!aiSuggestion) return;
    const updated = await updateTransaction(aiSuggestion.id, {
      category: aiSuggestion.category as Category,
      vat_rate: aiSuggestion.vat_rate,
    });
    setTransactions((prev) => prev.map((t) => (t.id === aiSuggestion.id ? updated : t)));
    setAiSuggestion(null);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleGroup(ids: string[], allChecked: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (allChecked) ids.forEach((id) => s.delete(id));
      else ids.forEach((id) => s.add(id));
      return s;
    });
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  }

  // ── Filtering & grouping ───────────────────────────────────────────────────

  const filtered = transactions.filter((t) => {
    const matchesText =
      filter === "" ||
      t.label.toLowerCase().includes(filter.toLowerCase()) ||
      t.category.includes(filter.toLowerCase()) ||
      (t.notes?.toLowerCase().includes(filter.toLowerCase()) ?? false);
    const matchesTag = tagFilter === null || (t.tags?.includes(tagFilter) ?? false);
    const matchesCategory = categoryFilter === "" || t.category === categoryFilter;
    const matchesStatus = statusFilter === "" || t.status === statusFilter;
    const matchesDateFrom = dateFrom === "" || t.date >= dateFrom;
    const matchesDateTo = dateTo === "" || t.date <= dateTo;
    const matchesJustified = !showUnjustified || needsTransactionEvidence(t);
    const matchesRejected = !hideRejected || t.status !== "rejected";
    const matchesType = typeFilter === "" || t.paymentType === typeFilter;
    const matchesHolder = holderFilter === "" || t.cardHolder === holderFilter;
    const matchesYear = yearFilter === "" || t.date.startsWith(yearFilter);
    const matchesFlow = flowFilter === "" || (flowFilter === "in" ? t.amount_ttc > 0 : t.amount_ttc < 0);
    return matchesText && matchesTag && matchesCategory && matchesStatus && matchesDateFrom && matchesDateTo && matchesJustified && matchesRejected && matchesType && matchesHolder && matchesYear && matchesFlow;
  });

  const availableTypes = [...new Set(transactions.map((t) => t.paymentType).filter(Boolean) as string[])].sort();
  const availableHolders = [...new Set(transactions.map((t) => t.cardHolder).filter(Boolean) as string[])].sort();
  const availableYears = [...new Set(transactions.map((t) => t.date.slice(0, 4)))].sort().reverse();


  const balanceIn = filtered.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0);
  const balanceOut = filtered.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + Math.abs(t.amount_ttc), 0);
  const balance = balanceIn - balanceOut;

  // Détection de doublons : même date + libellé norm. + montant (hors rejected)
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(workFilter === "duplicates");
  const hasActiveFilters = Boolean(filter || tagFilter || categoryFilter || statusFilter || dateFrom || dateTo || showUnjustified || hideRejected || typeFilter || holderFilter || yearFilter || flowFilter || showDuplicatesOnly);

  function resetAllFilters() {
    setFilter("");
    setTagFilter(null);
    setCategoryFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setShowUnjustified(false);
    setHideRejected(false);
    setTypeFilter("");
    setHolderFilter("");
    setYearFilter("");
    setFlowFilter("");
    setShowDuplicatesOnly(false);
  }
  const duplicateIds = (() => {
    const seen = new Map<string, string[]>();
    for (const t of transactions) {
      if (t.status === "rejected") continue;
      const key = `${t.date}|${t.label.trim().toLowerCase()}|${t.amount_ttc}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(t.id);
    }
    const ids = new Set<string>();
    for (const group of seen.values()) {
      if (group.length > 1) group.forEach((id) => ids.add(id));
    }
    return ids;
  })();

  const displayedFiltered = showDuplicatesOnly ? filtered.filter((t) => duplicateIds.has(t.id)) : filtered;

  function exportCsv() {
    const headers = ["Date", "Libellé", "Montant TTC", "Catégorie", "Statut", "Notes", "Tags"];
    const rows = displayedFiltered.map((t) => [
      t.date,
      `"${t.label.replace(/"/g, '""')}"`,
      t.amount_ttc.toFixed(2),
      t.category,
      t.status,
      `"${(t.notes ?? "").replace(/"/g, '""')}"`,
      `"${(t.tags ?? []).join(";").replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportFec() {
    const year = yearFilter || dateFrom.slice(0, 4) || new Date().getFullYear().toString();
    const { data } = await api.get(`/accounting/fec?year=${year}`, { responseType: "blob" });
    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FEC_${year}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  type MonthGroup = { key: string; month: number; txns: Transaction[] };
  type YearGroup = { year: string; months: MonthGroup[] };

  const yearGroups: YearGroup[] = [];
  const byYear = new Map<string, Map<number, Transaction[]>>();
  for (const t of displayedFiltered) {
    const year = t.date.slice(0, 4);
    const month = parseInt(t.date.slice(5, 7), 10);
    if (!byYear.has(year)) byYear.set(year, new Map());
    const byMonth = byYear.get(year)!;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(t);
  }
  for (const [year, byMonth] of [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const months: MonthGroup[] = [];
    for (const [month, txns] of [...byMonth.entries()].sort((a, b) => b[0] - a[0])) {
      months.push({ key: `${year}-${String(month).padStart(2, "0")}`, month, txns: txns.sort((a, b) => b.date.localeCompare(a.date)) });
    }
    yearGroups.push({ year, months });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {attachmentMessage && <div role={attachmentMessage.type === "error" ? "alert" : "status"} className={`fixed right-4 top-14 z-50 max-w-sm rounded border px-4 py-2 text-xs shadow-lg ${attachmentMessage.type === "success" ? "border-green-700 bg-green-950 text-green-300" : "border-red-700 bg-red-950 text-red-300"}`}>{attachmentMessage.text}<button onClick={() => setAttachmentMessage(null)} className="ml-3 text-vscode-muted">×</button></div>}
      {ocrReview && <ReceiptOcrDialog transaction={ocrReview.transaction} proposal={ocrReview.proposal} onApply={applyOcrProposal} onClose={() => setOcrReview(null)} />}
      <datalist id="vat-rate-presets">
        {VAT_RATE_PRESETS.map((rate) => (
          <option key={rate} value={rate} />
        ))}
      </datalist>
      {vatSplitTransaction && (
        <VatSplitDialog
          txn={vatSplitTransaction}
          onSave={handleVatSplitsChange}
          onClose={() => setVatSplitTransaction(null)}
        />
      )}
      {showAddModal && (
        <AddTransactionModal
          onClose={() => setShowAddModal(false)}
          onSave={handleCreateTransaction}
        />
      )}
      {smartSuggestions && (
        <SmartCategorizeModal
          suggestions={smartSuggestions}
          selected={smartSelected}
          applying={smartApplying}
          onToggle={(id) => setSmartSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; })}
          onToggleAll={() => setSmartSelected((prev) =>
            prev.size === smartSuggestions.length ? new Set() : new Set(smartSuggestions.map((s) => s.id))
          )}
          onApply={handleSmartApply}
          onClose={() => setSmartSuggestions(null)}
        />
      )}
      <PendingReceiptsPanel
        transactions={transactions}
        onLinked={(transaction, proposal) => {
          setTransactions((current) => current.map((item) => item.id === transaction.id ? transaction : item));
          setAttachmentMessage({ type: "success", text: "Justificatif en attente associé à la transaction." });
          if (proposal) setOcrReview({ transaction, proposal });
        }}
      />
      {workFilter && (
        <div className="flex items-center gap-3 border-b border-blue-700 bg-blue-900/25 px-4 py-2 text-xs text-blue-200 shrink-0">
          <strong>{WORK_FILTER_LABELS[workFilter]}</strong>
          <span>{workFilter === "receipt-inbox" ? "La boîte de justificatifs est affichée ci-dessus." : `${displayedFiltered.length} transaction${displayedFiltered.length > 1 ? "s" : ""} affichée${displayedFiltered.length > 1 ? "s" : ""}.`}</span>
          {workFilter !== "receipt-inbox" && <button onClick={resetAllFilters} className="ml-auto rounded border border-blue-600 px-2 py-0.5 hover:bg-blue-800">Afficher toutes les transactions</button>}
        </div>
      )}
      {/* Toolbar row 1 */}
      <div className="flex items-center gap-3 px-4 py-2 bg-vscode-panel border-b border-vscode-border shrink-0 flex-wrap">
        <span className="text-vscode-muted text-xs">
          {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
          {(filter || tagFilter || categoryFilter || statusFilter || dateFrom || dateTo) ? ` · ${filtered.length} affichées` : ""}
        </span>
        <input
          type="text"
          placeholder="Filtrer…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded w-48 focus:outline-none focus:border-vscode-accent"
        />
        {allTags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-vscode-muted text-[10px]">Tags :</span>
            {allTags.map((tag) => (
              <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${tagFilter === tag ? "bg-vscode-accent text-white border-vscode-accent" : "bg-vscode-border text-vscode-muted border-vscode-border hover:text-vscode-text"}`}>
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-vscode-muted">{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-2.5 py-1 rounded">
                {bulkDeleting ? "Suppression…" : `🗑 Supprimer (${selected.size})`}
              </button>
              <button
                onClick={async () => {
                  await bulkUpdateStatus([...selected], "validated");
                  setSelected(new Set());
                  await load();
                }}
                className="flex items-center gap-1 text-xs bg-green-700 hover:bg-green-600 text-white px-2.5 py-1 rounded">
                ✓ Valider ({selected.size})
              </button>
              <button
                onClick={async () => {
                  await bulkUpdateStatus([...selected], "rejected");
                  setSelected(new Set());
                  await load();
                }}
                className="flex items-center gap-1 text-xs bg-orange-700 hover:bg-orange-600 text-white px-2.5 py-1 rounded">
                ✕ Rejeter ({selected.size})
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-vscode-muted hover:text-vscode-text">
                Désélectionner
              </button>
            </>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 text-xs bg-vscode-accent hover:brightness-110 text-white px-2.5 py-1 rounded font-medium"
            title="Ajouter une transaction manuelle (espèces, note de frais…)">
            + Transaction
          </button>
          <button
            onClick={handleSmartCategorize}
            className="flex items-center gap-1 text-xs bg-purple-700 hover:bg-purple-600 text-white px-2.5 py-1 rounded font-medium"
            title="Catégoriser automatiquement par pattern matching (sans LLM)">
            ✨ Smart Catégoriser
          </button>
        <button onClick={load} className="text-xs text-vscode-muted hover:text-vscode-text">↺</button>
        </div>
      </div>

      {/* Toolbar row 2 — filtres avancés + balance + export */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-vscode-sidebar border-b border-vscode-border shrink-0 flex-wrap">
        {/* Catégorie */}
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | "")}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5 focus:outline-none focus:border-vscode-accent">
          <option value="">Toutes catég.</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
        </select>
        {/* Statut */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5 focus:outline-none focus:border-vscode-accent">
          <option value="">Tous statuts</option>
          <option value="pending">pending</option>
          <option value="validated">validated</option>
          <option value="rejected">rejected</option>
        </select>
        {/* Date range */}
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5 focus:outline-none focus:border-vscode-accent" />
        <span className="text-vscode-muted text-xs">→</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5 focus:outline-none focus:border-vscode-accent" />
        {hasActiveFilters && (
          <button onClick={resetAllFilters}
            className="rounded border border-vscode-border px-2 py-0.5 text-[10px] text-vscode-muted hover:border-vscode-accent hover:text-vscode-text"
            title="Effacer la recherche, les dates, l'année et tous les filtres actifs">
            × Réinitialiser tous les filtres
          </button>
        )}
        {/* Type paiement */}
        {availableTypes.length > 0 && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5 focus:outline-none focus:border-vscode-accent">
            <option value="">Tous types</option>
            {availableTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {/* Titulaire carte */}
        {availableHolders.length > 0 && (
          <select value={holderFilter} onChange={(e) => setHolderFilter(e.target.value)}
            className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5 focus:outline-none focus:border-vscode-accent">
            <option value="">Tous titulaires</option>
            {availableHolders.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        )}
        {/* Année */}
        {availableYears.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-vscode-muted">Année :</span>
            {availableYears.map((y) => (
              <button key={y} onClick={() => setYearFilter(yearFilter === y ? "" : y)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  yearFilter === y
                    ? "bg-vscode-accent text-white border-vscode-accent"
                    : "border-vscode-border text-vscode-muted hover:text-vscode-text"
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}
        {/* Recettes / Dépenses */}
        <div className="flex rounded border border-vscode-border overflow-hidden">
          {(["", "in", "out"] as const).map((v) => (
            <button key={v} onClick={() => setFlowFilter(v)}
              className={`text-[10px] px-2 py-0.5 transition-colors ${
                flowFilter === v
                  ? "bg-vscode-accent text-white"
                  : "text-vscode-muted hover:text-vscode-text hover:bg-vscode-panel"
              }`}>
              {v === "" ? "Tout" : v === "in" ? "↑ Recettes" : "↓ Dépenses"}
            </button>
          ))}
        </div>
        {/* Toggle rejetées */}
        {transactions.some((t) => t.status === "rejected") && (
          <button
            onClick={() => setHideRejected((v) => !v)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              hideRejected
                ? "border-vscode-border text-vscode-muted hover:text-vscode-text"
                : "bg-red-900/40 border-red-700 text-red-300"
            }`}
            title={hideRejected ? "Afficher les transactions rejetées" : "Masquer les transactions rejetées"}
          >
            {hideRejected ? `↥ rejetées (${transactions.filter((t) => t.status === "rejected").length})` : "↧ masquer rejetées"}
          </button>
        )}
        {/* Filtre À justifier */}
        {(() => {
          const unjustifiedCount = transactions.filter(needsTransactionEvidence).length;
          return unjustifiedCount > 0 ? (
            <button
              onClick={() => setShowUnjustified((v) => !v)}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                showUnjustified
                  ? "bg-yellow-700 border-yellow-600 text-white"
                  : "border-yellow-700 text-yellow-400 hover:bg-yellow-900/30"
              }`}
            >
              ⚠ À justifier
              <span className="bg-yellow-600 text-white rounded-full px-1 text-[9px]">{unjustifiedCount}</span>
            </button>
          ) : null;
        })()}
        {/* Balance */}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {duplicateIds.size > 0 && (
            <button
              onClick={() => setShowDuplicatesOnly((v) => !v)}
              className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                showDuplicatesOnly
                  ? "bg-orange-700 border-orange-600 text-white"
                  : "border-orange-700 text-orange-400 hover:bg-orange-900/30"
              }`}
              title="Transactions potentiellement en doublon"
            >
              ⚠ {duplicateIds.size} doublon{duplicateIds.size > 1 ? "s" : ""}
            </button>
          )}
          <span className="text-green-400 tabular-nums">+{balanceIn.toFixed(2)} €</span>
          <span className="text-red-400 tabular-nums">−{balanceOut.toFixed(2)} €</span>
          <span className={`font-semibold tabular-nums ${balance >= 0 ? "text-green-300" : "text-red-300"}`}>
            Solde {balance >= 0 ? "+" : ""}{balance.toFixed(2)} €
          </span>
          <button onClick={exportCsv}
            className="text-xs bg-vscode-border hover:bg-vscode-panel text-vscode-text px-2 py-0.5 rounded ml-2">
            ↓ CSV
          </button>
          <button onClick={exportFec}
            className="text-xs bg-vscode-border hover:bg-vscode-panel text-vscode-text px-2 py-0.5 rounded"
            title="Exporter le Fichier des Écritures Comptables (FEC) — format légal DGFiP">
            ↓ FEC
          </button>
        </div>
      </div>

      {/* Suggestion IA */}
      {aiSuggestion && (
        <div className="flex items-center gap-3 px-4 py-2 bg-purple-900/30 border-b border-purple-700 text-xs flex-wrap">
          <span className="text-purple-300">✨ IA suggère :</span>
          <span className="font-semibold text-white">{aiSuggestion.category}</span>
          <span className="text-purple-300">TVA {aiSuggestion.vat_rate}%</span>
          <span className="text-vscode-muted italic truncate max-w-xs">{aiSuggestion.reasoning}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${aiSuggestion.confidence === "high" ? "bg-green-800 text-green-300" : aiSuggestion.confidence === "medium" ? "bg-yellow-800 text-yellow-300" : "bg-red-800 text-red-300"}`}>
            {aiSuggestion.confidence}
          </span>
          <button onClick={handleAcceptSuggestion} className="bg-purple-700 hover:bg-purple-600 text-white px-2 py-0.5 rounded ml-2">Accepter</button>
          <button onClick={() => setAiSuggestion(null)} className="text-vscode-muted hover:text-vscode-text px-1">✕</button>
        </div>
      )}

      {/* Content groupé par année → mois */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-vscode-muted text-sm p-4">Chargement…</div>
        ) : yearGroups.length === 0 ? (
          <div className="text-center text-vscode-muted py-16 text-sm">
            Aucune transaction{tagFilter ? ` avec le tag « ${tagFilter} »` : ""}
          </div>
        ) : yearGroups.map(({ year, months }) => {
          const yearCollapsed = collapsed.has(year);
          const yearIds = months.flatMap((m) => m.txns.map((t) => t.id));
          const yearAllChecked = yearIds.length > 0 && yearIds.every((id) => selected.has(id));
          const yearSomeChecked = yearIds.some((id) => selected.has(id));

          return (
            <div key={year}>
              {/* En-tête année */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-vscode-bg border-b border-vscode-border sticky top-0 z-10 select-none">
                <input type="checkbox" checked={yearAllChecked}
                  ref={(el) => { if (el) el.indeterminate = yearSomeChecked && !yearAllChecked; }}
                  onChange={() => toggleGroup(yearIds, yearAllChecked)}
                  className="accent-vscode-accent cursor-pointer"
                  onClick={(e) => e.stopPropagation()} />
                <button onClick={() => toggleCollapse(year)} className="flex items-center gap-2 flex-1 text-left">
                  <span className={`text-[10px] text-vscode-muted transition-transform duration-150 inline-block ${yearCollapsed ? "" : "rotate-90"}`}>▶</span>
                  <span className="text-sm font-semibold text-vscode-text">{year}</span>
                  <span className="text-xs text-vscode-muted">{yearIds.length} transaction{yearIds.length !== 1 ? "s" : ""}</span>
                </button>
              </div>

              {!yearCollapsed && months.map(({ key, month, txns: mt }) => {
                const monthCollapsed = collapsed.has(key);
                const monthIds = mt.map((t) => t.id);
                const monthAllChecked = monthIds.every((id) => selected.has(id));
                const monthSomeChecked = monthIds.some((id) => selected.has(id));
                const revenue = mt.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0);
                const expenses = mt.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + Math.abs(t.amount_ttc), 0);

                return (
                  <div key={key}>
                    {/* En-tête mois */}
                    <div className="flex items-center gap-2 px-4 py-1 bg-vscode-sidebar border-b border-vscode-border sticky top-[33px] z-[9] select-none">
                      <input type="checkbox" checked={monthAllChecked}
                        ref={(el) => { if (el) el.indeterminate = monthSomeChecked && !monthAllChecked; }}
                        onChange={() => toggleGroup(monthIds, monthAllChecked)}
                        className="accent-vscode-accent cursor-pointer"
                        onClick={(e) => e.stopPropagation()} />
                      <button onClick={() => toggleCollapse(key)} className="flex items-center gap-2 flex-1 text-left">
                        <span className={`text-[10px] text-vscode-muted inline-block transition-transform duration-150 ${monthCollapsed ? "" : "rotate-90"}`}>▶</span>
                        <span className="text-xs font-medium text-vscode-text w-20">{MONTHS_FR[month - 1]}</span>
                        <span className="text-[10px] text-vscode-muted">{mt.length} op.</span>
                        {revenue > 0 && <span className="text-[10px] text-green-400 ml-2">+{revenue.toFixed(2)} €</span>}
                        {expenses > 0 && <span className="text-[10px] text-red-400">−{expenses.toFixed(2)} €</span>}
                      </button>
                    </div>

                    {!monthCollapsed && (
                      <table className="w-full text-xs">
                        <tbody>
                          {mt.map((txn) => (
                            <tr key={txn.id} className={`border-b border-vscode-border transition-colors ${selected.has(txn.id) ? "bg-blue-900/20" : "hover:bg-vscode-panel"}`}>
                              <td className="pl-6 pr-1 py-1.5 w-6">
                                <input type="checkbox" checked={selected.has(txn.id)} onChange={() => toggleOne(txn.id)} className="accent-vscode-accent cursor-pointer" />
                              </td>
                              <td className="px-2 py-1.5 text-vscode-muted whitespace-nowrap w-12 tabular-nums">{txn.date.slice(8)}/{txn.date.slice(5, 7)}</td>
                              <td className="px-2 py-1.5 max-w-[240px]">
                                <div className="truncate" title={txn.label}>
                                  {txn.status === "rejected" && <span className="text-[9px] bg-red-900 text-red-300 rounded px-1 mr-1">rejetée</span>}
                                  {txn.label}
                                </div>
                                {txn.notes && <div className="text-vscode-muted text-[10px] truncate">{txn.notes}</div>}
                                {txn.comment && <div className="text-blue-400 text-[10px] truncate italic" title={txn.comment}>{txn.comment}</div>}
                                {(txn.paymentType || txn.cardHolder) && (
                                  <div className="flex gap-1 mt-0.5">
                                    {txn.paymentType && <span className="text-[9px] bg-vscode-border text-vscode-muted rounded px-1">{txn.paymentType}</span>}
                                    {txn.cardHolder && <span className="text-[9px] text-vscode-muted">{txn.cardHolder}</span>}
                                  </div>
                                )}
                                {/* Rapprochement facture */}
                                {editingInvoiceRef === txn.id ? (
                                  <input
                                    autoFocus
                                    value={invoiceRefInput}
                                    onChange={(e) => setInvoiceRefInput(e.target.value)}
                                    onBlur={() => handleInvoiceRefSave(txn.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleInvoiceRefSave(txn.id);
                                      if (e.key === "Escape") { setEditingInvoiceRef(null); }
                                    }}
                                    placeholder="Réf. facture…"
                                    className="mt-0.5 bg-vscode-bg border border-vscode-accent text-vscode-text text-[10px] rounded px-1.5 py-0.5 w-32 focus:outline-none"
                                  />
                                ) : (
                                  <button
                                    onClick={() => { setEditingInvoiceRef(txn.id); setInvoiceRefInput(txn.invoiceRef ?? ""); }}
                                    className={`mt-0.5 text-[10px] rounded px-1.5 py-0.5 border border-dashed transition-colors ${
                                      txn.invoiceRef
                                        ? "border-blue-600 text-blue-400"
                                        : "border-vscode-border text-vscode-muted hover:text-vscode-text"
                                    }`}
                                    title="Rapprochement : lier à une référence de facture"
                                  >
                                    {txn.invoiceRef ? `🔗 ${txn.invoiceRef}` : "🔗"}
                                  </button>
                                )}
                              </td>
                              <td className={`px-2 py-1.5 whitespace-nowrap font-mono ${txn.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                                <div>{txn.amount_ttc >= 0 ? "+" : ""}{txn.amount_ttc.toFixed(2)} €</div>
                                <div className="mt-1 flex items-center gap-1">
                                  <VatRateEditor
                                    txn={txn}
                                    value={inferredVatRate(txn)}
                                    onSave={handleVatRateChange}
                                  />
                                  <span className="text-[10px] text-vscode-muted">%</span>
                                  <button
                                    onClick={() => setVatSplitTransaction(txn)}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${txn.vat_splits && txn.vat_splits.length >= 2 ? "border-purple-500 text-purple-300" : "border-vscode-border text-vscode-muted hover:text-vscode-text"}`}
                                    title="Détailler plusieurs taux de TVA sur cette transaction"
                                  >
                                    {txn.vat_splits && txn.vat_splits.length >= 2 ? `${txn.vat_splits.length} taux` : "Multi-TVA"}
                                  </button>
                                </div>
                                {vatSaveMessage?.id === txn.id && (
                                  <div role={vatSaveMessage.type === "error" ? "alert" : "status"} className={`mt-1 text-[9px] ${vatSaveMessage.type === "success" ? "text-green-400" : "text-red-400"}`}>
                                    {vatSaveMessage.text}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <select value={txn.category} onChange={(e) => handleCategoryChange(txn.id, e.target.value as Category)}
                                  className={`text-xs rounded px-1 py-0.5 border-0 focus:outline-none cursor-pointer ${CATEGORY_COLORS[txn.category] ?? "bg-gray-700 text-gray-300"}`}>
                                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-1.5">
                                <TagEditor tags={txn.tags ?? []} allTags={allTags} onChange={(tags) => handleTagsChange(txn.id, tags)} />
                              </td>
                              <td className="px-2 py-1.5">
                                <select value={txn.status} onChange={(e) => handleStatusChange(txn.id, e.target.value as Transaction["status"])}
                                  className="text-xs bg-vscode-bg border border-vscode-border rounded px-1 py-0.5 text-vscode-text focus:outline-none">
                                  <option value="pending">pending</option>
                                  <option value="validated">validated</option>
                                  <option value="rejected">rejected</option>
                                </select>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex gap-1.5 items-center">
                                  {/* Justifié */}
                                  <button
                                    onClick={() => handleJustifiedToggle(txn.id, txn.justified)}
                                    className={`w-6 h-6 flex items-center justify-center rounded transition-colors text-base ${
                                      txn.justified
                                        ? "text-green-400 hover:text-green-300 hover:bg-green-900/30"
                                        : "text-vscode-muted hover:text-yellow-400 hover:bg-yellow-900/20"
                                    }`}
                                    title={txn.justified ? "Justifié — cliquer pour annuler" : "Non justifié — cliquer pour valider"}
                                  >
                                    {txn.justified ? "✓" : "○"}
                                  </button>
                                  {/* Pièce jointe */}
                                  {(txn.attachments?.length || txn.attachment) ? (
                                    <div className="flex items-center gap-0.5">
                                      {ocrAnalyzingAttachment === txn.id && <button onClick={cancelAttachmentOcr} className="flex h-6 w-6 animate-pulse items-center justify-center rounded text-base text-amber-400 hover:bg-amber-900/30 hover:text-amber-300" title="Arrêter l’OCR et conserver la pièce" aria-label="Arrêter l’OCR et conserver la pièce">⏳</button>}
                                      {[...new Set([...(txn.attachments ?? []), ...(txn.attachment ? [txn.attachment] : [])])].map((filename, index) => <span key={filename} className="flex items-center gap-0.5"><a href={attachmentUrl(filename)} target="_blank" rel="noopener noreferrer" className="flex h-6 min-w-6 items-center justify-center rounded px-1 text-sm text-blue-400 transition-colors hover:bg-blue-900/30 hover:text-blue-300" title={`Voir la pièce jointe : ${filename}`}>📎{index === 0 && (txn.attachments?.length ?? 1) > 1 ? <small className="ml-0.5 text-[9px]">{txn.attachments?.length}</small> : null}</a><button onClick={() => handleAttachmentDelete(txn.id, filename)} className="flex h-4 w-4 items-center justify-center rounded text-xs text-vscode-muted transition-colors hover:bg-red-900/20 hover:text-red-400" title={`Supprimer ${filename}`}>×</button></span>)}
                                    </div>
                                  ) : (
                                    <AttachmentDropZone
                                      txnId={txn.id}
                                      onDrop={handleAttachmentUpload}
                                      uploading={uploadingAttachment === txn.id}
                                      hasAttachment={!!txn.attachment}
                                    >
                                    <label
                                      className={`w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors text-base ${
                                        uploadingAttachment === txn.id
                                          ? "text-vscode-muted animate-pulse"
                                          : "text-vscode-muted hover:text-blue-400 hover:bg-blue-900/30"
                                      }`}
                                      title="Joindre une pièce justificative (PDF, image)"
                                    >
                                      {uploadingAttachment === txn.id ? "⏳" : "📎"}
                                      <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                                        className="hidden"
                                        disabled={uploadingAttachment !== null}
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) handleAttachmentUpload(txn.id, file);
                                          e.target.value = "";
                                        }}
                                      />
                                    </label>
                                    </AttachmentDropZone>
                                  )}
                                  {/* IA */}
                                  <button
                                    onClick={() => handleAiCategorize(txn)}
                                    disabled={aiLoading === txn.id}
                                    className="w-6 h-6 flex items-center justify-center rounded text-purple-400 hover:text-purple-300 hover:bg-purple-900/30 disabled:opacity-50 transition-colors text-base"
                                    title="Catégoriser avec l'IA"
                                  >
                                    {aiLoading === txn.id ? "…" : "✨"}
                                  </button>
                                  {/* Supprimer */}
                                  <button
                                    onClick={() => handleDeleteOne(txn.id)}
                                    className="w-6 h-6 flex items-center justify-center rounded text-vscode-muted hover:text-red-400 hover:bg-red-900/30 transition-colors text-base"
                                    title="Supprimer"
                                  >
                                    🗑
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
