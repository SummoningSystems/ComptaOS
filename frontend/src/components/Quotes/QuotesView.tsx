import { useEffect, useState } from "react";
import { Quote } from "../../types";
import { fetchQuotes, createQuote, updateQuote, deleteQuote, convertQuoteToInvoice } from "../../api/client";
import { LocalizedNumberInput } from "../Common/LocalizedNumberInput";

const STATUS_LABELS: Record<Quote["status"], string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  accepted: "Accepté",
  refused: "Refusé",
  converted: "Converti",
};

const STATUS_COLORS: Record<Quote["status"], string> = {
  draft: "text-vscode-muted bg-vscode-border/40",
  sent: "text-yellow-300 bg-yellow-900/30",
  accepted: "text-green-300 bg-green-900/30",
  refused: "text-red-300 bg-red-900/30",
  converted: "text-purple-300 bg-purple-900/30",
};

const TODAY = new Date().toISOString().slice(0, 10);

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

const EMPTY_FORM: Omit<Quote, "id"> = {
  number: "",
  client: "",
  date: TODAY,
  validUntil: defaultValidUntil(),
  description: "",
  amount_ht: 0,
  vat_rate: 20,
  amount_ttc: 0,
  status: "draft",
  notes: "",
};

export function QuotesView() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Omit<Quote, "id">>(EMPTY_FORM);
  const [converting, setConverting] = useState<string | null>(null);

  useEffect(() => {
    fetchQuotes().then(setQuotes).finally(() => setLoading(false));
  }, []);

  function openNew() {
    setForm({
      ...EMPTY_FORM,
      number: `DEV-${new Date().getFullYear()}-${String(quotes.length + 1).padStart(3, "0")}`,
    });
    setEditingId("new");
  }

  function openEdit(q: Quote) {
    const { id, ...rest } = q;
    setForm(rest);
    setEditingId(id);
  }

  function recalcTtc(ht: number, vatRate: number) {
    return parseFloat((ht * (1 + vatRate / 100)).toFixed(2));
  }

  async function handleSave() {
    if (editingId === "new") {
      const created = await createQuote({ ...form, id: crypto.randomUUID() } as Quote);
      setQuotes((prev) => [...prev, created]);
    } else if (editingId) {
      const updated = await updateQuote(editingId, { ...form, id: editingId } as Quote);
      setQuotes((prev) => prev.map((q) => (q.id === editingId ? updated : q)));
    }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await deleteQuote(id);
    setQuotes((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleConvert(q: Quote) {
    setConverting(q.id);
    try {
      await convertQuoteToInvoice(q.id);
      // Rafraîchir la liste des devis
      const updated = await fetchQuotes();
      setQuotes(updated);
    } finally {
      setConverting(null);
    }
  }

  async function quickStatus(q: Quote, status: Quote["status"]) {
    const updated = await updateQuote(q.id, { ...q, status });
    setQuotes((prev) => prev.map((x) => (x.id === q.id ? updated : x)));
  }

  const totalDraft    = quotes.filter((q) => q.status === "draft").length;
  const totalSent     = quotes.filter((q) => q.status === "sent").length;
  const totalAccepted = quotes.filter((q) => q.status === "accepted").reduce((s, q) => s + q.amount_ttc, 0);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Chargement…</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden text-vscode-text">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-vscode-border shrink-0">
        <h1 className="text-base font-semibold">Devis</h1>
        <button
          onClick={openNew}
          className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded transition-colors"
        >
          ＋ Nouveau devis
        </button>
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-3 gap-3 px-6 py-3 border-b border-vscode-border shrink-0">
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-vscode-muted mb-1">Brouillons</div>
          <div className="text-sm font-semibold">{totalDraft}</div>
        </div>
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-yellow-400 mb-1">En attente de réponse</div>
          <div className="text-sm font-semibold text-yellow-300">{totalSent}</div>
        </div>
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-green-400 mb-1">Acceptés (TTC)</div>
          <div className="text-sm font-semibold text-green-300">{totalAccepted.toFixed(2)} €</div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-vscode-muted text-sm gap-2">
            <span className="text-3xl">📄</span>
            <span>Aucun devis. Créez-en un ci-dessus.</span>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-vscode-muted border-b border-vscode-border text-xs">
                <th className="pb-2 pr-3 font-medium">N°</th>
                <th className="pb-2 pr-3 font-medium">Client</th>
                <th className="pb-2 pr-3 font-medium">Date</th>
                <th className="pb-2 pr-3 font-medium">Validité</th>
                <th className="pb-2 pr-3 font-medium text-right">HT</th>
                <th className="pb-2 pr-3 font-medium text-right">TTC</th>
                <th className="pb-2 pr-3 font-medium">Statut</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr
                  key={q.id}
                  className={`border-b border-vscode-border/50 hover:bg-vscode-panel/50 ${
                    q.status === "refused" ? "opacity-50" : ""
                  }`}
                >
                  <td className="py-2 pr-3 font-mono text-xs">{q.number}</td>
                  <td className="py-2 pr-3">{q.client}</td>
                  <td className="py-2 pr-3 text-vscode-muted">{q.date}</td>
                  <td className="py-2 pr-3 text-vscode-muted">
                    <span className={q.validUntil < TODAY && q.status === "sent" ? "text-red-400" : ""}>
                      {q.validUntil}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{q.amount_ht.toFixed(2)} €</td>
                  <td className="py-2 pr-3 text-right font-medium">{q.amount_ttc.toFixed(2)} €</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[q.status]}`}>
                      {STATUS_LABELS[q.status]}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5 items-center flex-wrap">
                      {q.status === "draft" && (
                        <button onClick={() => quickStatus(q, "sent")}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-300 hover:bg-yellow-800/60 transition-colors">
                          Envoyer
                        </button>
                      )}
                      {q.status === "sent" && (
                        <>
                          <button onClick={() => quickStatus(q, "accepted")}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800/60 transition-colors">
                            Accepté
                          </button>
                          <button onClick={() => quickStatus(q, "refused")}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 hover:bg-red-800/60 transition-colors">
                            Refusé
                          </button>
                        </>
                      )}
                      {q.status === "accepted" && (
                        <button
                          onClick={() => handleConvert(q)}
                          disabled={converting === q.id}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 hover:bg-purple-800/60 disabled:opacity-50 transition-colors">
                          {converting === q.id ? "…" : "→ Facture"}
                        </button>
                      )}
                      {q.status !== "converted" && (
                        <button onClick={() => openEdit(q)}
                          className="text-xs text-vscode-muted hover:text-vscode-text transition-colors">
                          Éditer
                        </button>
                      )}
                      {q.status === "converted" && q.invoiceId && (
                        <span className="text-[10px] text-purple-400 font-mono">{q.invoiceId.slice(0, 8)}…</span>
                      )}
                      <button onClick={() => handleDelete(q.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal édition */}
      {editingId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <h2 className="text-sm font-semibold">
              {editingId === "new" ? "Nouveau devis" : "Modifier le devis"}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-vscode-muted block mb-1">N° devis</label>
                <input type="text" value={form.number}
                  onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Client</label>
                <input type="text" aria-label="Client" value={form.client}
                  onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Date</label>
                <input type="date" value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Valide jusqu'au</label>
                <input type="date" value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-vscode-muted block mb-1">Description</label>
                <input type="text" aria-label="Description" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Montant HT (€)</label>
                <LocalizedNumberInput aria-label="Montant HT" min={0} value={form.amount_ht}
                  onValueChange={(ht) => {
                    setForm((f) => ({ ...f, amount_ht: ht, amount_ttc: parseFloat((ht * (1 + f.vat_rate / 100)).toFixed(2)) }));
                  }}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">TVA (%)</label>
                <LocalizedNumberInput min={0} max={100} value={form.vat_rate}
                  onValueChange={(rate) => {
                    setForm((f) => ({ ...f, vat_rate: rate, amount_ttc: parseFloat((f.amount_ht * (1 + rate / 100)).toFixed(2)) }));
                  }}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Montant TTC (€)</label>
                <input type="number" readOnly value={form.amount_ttc}
                  className="w-full bg-vscode-bg border border-vscode-border/50 rounded px-2 py-1.5 text-sm text-vscode-muted cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Statut</label>
                <select value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Quote["status"] }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent">
                  <option value="draft">Brouillon</option>
                  <option value="sent">Envoyé</option>
                  <option value="accepted">Accepté</option>
                  <option value="refused">Refusé</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-vscode-muted block mb-1">Notes</label>
                <textarea value={form.notes ?? ""} rows={2}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent resize-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingId(null)}
                className="text-sm text-vscode-muted hover:text-vscode-text px-3 py-1.5 rounded transition-colors">
                Annuler
              </button>
              <button onClick={handleSave}
                className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded transition-colors">
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
