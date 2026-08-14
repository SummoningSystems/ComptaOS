import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface TransactionTemplate {
  id: string;
  name: string;
  label: string;
  amount_ttc: number;
  amount_ht: number;
  vat: number;
  category: string;
  account: string;
  tags?: string[];
  notes?: string;
}

const EMPTY: Omit<TransactionTemplate, "id"> = {
  name: "",
  label: "",
  amount_ttc: 0,
  amount_ht: 0,
  vat: 20,
  category: "misc",
  account: "",
  tags: [],
  notes: "",
};

const CATEGORIES = ["revenue", "salary", "subcontracting", "professional_fees", "external_services", "hosting", "software", "travel", "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc"];

export function TemplatesView() {
  const [templates, setTemplates] = useState<TransactionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<TransactionTemplate, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<TransactionTemplate[]>("/templates");
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    if (!form.name.trim() || !form.label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/templates", form);
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api.delete(`/templates/${id}`);
      setTemplates((t) => t.filter((x) => x.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  function computeHt() {
    const vat = form.vat ?? 20;
    const ht = form.amount_ttc / (1 + vat / 100);
    setForm((f) => ({ ...f, amount_ht: parseFloat(ht.toFixed(2)) }));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-vscode-border shrink-0 bg-vscode-panel">
        <span className="text-xs font-semibold text-vscode-text">📋 Modèles de transactions</span>
        <span className="text-[10px] text-vscode-muted ml-1">{templates.length} modèle{templates.length > 1 ? "s" : ""}</span>
        <button
          onClick={() => { setShowForm(true); setForm(EMPTY); setError(null); }}
          className="ml-auto text-xs bg-vscode-accent hover:bg-blue-600 text-white px-3 py-1.5 rounded"
        >
          + Nouveau modèle
        </button>
      </div>

      {/* Formulaire */}
      {showForm && (
        <div className="border-b border-vscode-border bg-vscode-sidebar px-4 py-4 shrink-0">
          <p className="text-xs font-semibold text-vscode-text mb-3">Nouveau modèle</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-vscode-muted block mb-1">Nom du modèle *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="ex: Abonnement SaaS"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none focus:border-vscode-accent"
              />
            </div>
            <div>
              <label className="text-vscode-muted block mb-1">Libellé transaction *</label>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="ex: Abonnement GitHub"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none focus:border-vscode-accent"
              />
            </div>
            <div>
              <label className="text-vscode-muted block mb-1">Montant TTC (€)</label>
              <input
                type="number"
                value={form.amount_ttc}
                onChange={(e) => setForm((f) => ({ ...f, amount_ttc: parseFloat(e.target.value) || 0 }))}
                onBlur={computeHt}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none focus:border-vscode-accent"
              />
            </div>
            <div>
              <label className="text-vscode-muted block mb-1">TVA (%)</label>
              <select
                value={form.vat}
                onChange={(e) => setForm((f) => ({ ...f, vat: parseFloat(e.target.value) }))}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none"
              >
                <option value={0}>0 %</option>
                <option value={5.5}>5,5 %</option>
                <option value={10}>10 %</option>
                <option value={20}>20 %</option>
              </select>
            </div>
            <div>
              <label className="text-vscode-muted block mb-1">Catégorie</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-vscode-muted block mb-1">Compte bancaire</label>
              <input
                value={form.account}
                onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
                placeholder="ex: Compte courant"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none focus:border-vscode-accent"
              />
            </div>
            <div className="col-span-2">
              <label className="text-vscode-muted block mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Notes optionnelles…"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text px-2 py-1.5 rounded focus:outline-none focus:border-vscode-accent"
              />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.label.trim()}
              className="text-xs bg-vscode-accent hover:bg-blue-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-3 py-1.5"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-vscode-muted text-xs">Chargement…</div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-vscode-muted gap-2">
          <span className="text-3xl">📋</span>
          <p className="text-sm">Aucun modèle. Créez-en un pour accélérer la saisie.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-vscode-text text-xs font-semibold truncate">{t.name}</p>
                <button
                  onClick={() => handleDelete(t.id)}
                  disabled={deleting === t.id}
                  className="text-vscode-muted hover:text-red-400 text-xs shrink-0"
                  title="Supprimer"
                >
                  {deleting === t.id ? "…" : "✕"}
                </button>
              </div>
              <p className="text-vscode-muted text-[11px] truncate">{t.label}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-mono font-bold ${t.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {t.amount_ttc >= 0 ? "+" : ""}{t.amount_ttc.toFixed(2)} €
                </span>
                <span className="text-[10px] text-vscode-muted">HT {t.amount_ht.toFixed(2)} €</span>
                <span className="text-[10px] bg-vscode-panel border border-vscode-border rounded px-1.5 py-0.5">{t.category}</span>
                {t.vat > 0 && <span className="text-[10px] text-yellow-300">TVA {t.vat}%</span>}
              </div>
              {t.account && (
                <p className="text-[10px] text-vscode-muted">🏦 {t.account}</p>
              )}
              {t.notes && (
                <p className="text-[10px] text-vscode-muted italic truncate">{t.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
