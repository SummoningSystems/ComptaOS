import { useEffect, useState } from "react";
import { OutgoingInvoice, Category } from "../../types";
import { fetchInvoices, createInvoice, updateInvoice, deleteInvoice, downloadInvoicePdf } from "../../api/client";

const TODAY = new Date().toISOString().slice(0, 10);

const STATUS_LABELS: Record<OutgoingInvoice["status"], string> = {
  draft: "Brouillon",
  sent: "Envoyée",
  paid: "Payée",
  overdue: "En retard",
};

const STATUS_COLORS: Record<OutgoingInvoice["status"], string> = {
  draft: "text-vscode-muted bg-vscode-border/40",
  sent: "text-yellow-300 bg-yellow-900/30",
  paid: "text-green-300 bg-green-900/30",
  overdue: "text-red-300 bg-red-900/30",
};

const EMPTY_FORM: Omit<OutgoingInvoice, "id"> = {
  number: "",
  client: "",
  date: new Date().toISOString().slice(0, 10),
  dueDate: "",
  description: "",
  amount_ht: 0,
  vat_rate: 20,
  amount_ttc: 0,
  status: "draft",
  notes: "",
};

export function InvoicesView() {
  const [invoices, setInvoices] = useState<OutgoingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Omit<OutgoingInvoice, "id">>(EMPTY_FORM);
  const [reminderInv, setReminderInv] = useState<OutgoingInvoice | null>(null);

  useEffect(() => {
    fetchInvoices().then((list) => {
      // Auto-marquer comme "overdue" les factures envoyées dont l'échéance est passée
      const updated = list.map((inv) =>
        inv.status === "sent" && inv.dueDate && inv.dueDate < TODAY
          ? { ...inv, status: "overdue" as const }
          : inv
      );
      setInvoices(updated);
    }).finally(() => setLoading(false));
  }, []);

  async function quickStatus(inv: OutgoingInvoice, status: OutgoingInvoice["status"]) {
    const patch = status === "paid"
      ? { ...inv, status, paidDate: TODAY }
      : { ...inv, status };
    const updated = await updateInvoice(inv.id, patch);
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? updated : i)));
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, number: `FA-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(3, "0")}` });
    setEditingId("new");
  }

  function openEdit(inv: OutgoingInvoice) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...rest } = inv;
    setForm(rest);
    setEditingId(id);
  }

  function recalcTtc(ht: number, vatRate: number) {
    return parseFloat((ht * (1 + vatRate / 100)).toFixed(2));
  }

  function handleAmountHtChange(val: number) {
    setForm((f) => ({ ...f, amount_ht: val, amount_ttc: recalcTtc(val, f.vat_rate) }));
  }

  function handleVatRateChange(val: number) {
    setForm((f) => ({ ...f, vat_rate: val, amount_ttc: recalcTtc(f.amount_ht, val) }));
  }

  async function handleSave() {
    if (editingId === "new") {
      const created = await createInvoice({ ...form, id: crypto.randomUUID() });
      setInvoices((prev) => [...prev, created]);
    } else if (editingId) {
      const updated = await updateInvoice(editingId, { ...form, id: editingId });
      setInvoices((prev) => prev.map((inv) => (inv.id === editingId ? updated : inv)));
    }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await deleteInvoice(id);
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
  }

  // ── Résumé ────────────────────────────────────────────────────────────────
  const totalEmis = invoices.reduce((s, inv) => s + inv.amount_ttc, 0);
  const totalPaid = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount_ttc, 0);
  const totalPending = invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.amount_ttc, 0);
  const totalOverdue = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + i.amount_ttc, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-muted text-sm">
        Chargement…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden text-vscode-text">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-vscode-border shrink-0">
        <h1 className="text-base font-semibold">Factures clients</h1>
        <button
          onClick={openNew}
          className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded transition-colors"
        >
          ＋ Nouvelle facture
        </button>
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-vscode-border shrink-0">
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-vscode-muted mb-1">Total émis</div>
          <div className="text-sm font-semibold">{totalEmis.toFixed(2)} €</div>
        </div>
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-green-400 mb-1">Encaissé</div>
          <div className="text-sm font-semibold text-green-300">{totalPaid.toFixed(2)} €</div>
        </div>
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-yellow-400 mb-1">En attente</div>
          <div className="text-sm font-semibold text-yellow-300">{totalPending.toFixed(2)} €</div>
        </div>
        <div className="bg-vscode-panel rounded p-3">
          <div className="text-xs text-red-400 mb-1">En retard</div>
          <div className="text-sm font-semibold text-red-300">{totalOverdue.toFixed(2)} €</div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-vscode-muted text-sm gap-2">
            <span className="text-3xl">🧾</span>
            <span>Aucune facture. Créez-en une ci-dessus.</span>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-vscode-muted border-b border-vscode-border text-xs">
                <th className="pb-2 pr-3 font-medium">N°</th>
                <th className="pb-2 pr-3 font-medium">Client</th>
                <th className="pb-2 pr-3 font-medium">Date</th>
                <th className="pb-2 pr-3 font-medium">Échéance</th>
                <th className="pb-2 pr-3 font-medium text-right">HT</th>
                <th className="pb-2 pr-3 font-medium text-right">TTC</th>
                <th className="pb-2 pr-3 font-medium">Statut</th>
                <th className="pb-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className={`border-b border-vscode-border/50 hover:bg-vscode-panel/50 ${
                    inv.status === "overdue" ? "bg-red-950/20" : ""
                  }`}
                >
                  <td className="py-2 pr-3 font-mono text-xs">{inv.number}</td>
                  <td className="py-2 pr-3">{inv.client}</td>
                  <td className="py-2 pr-3 text-vscode-muted">{inv.date}</td>
                  <td className="py-2 pr-3 text-vscode-muted">{inv.dueDate || "—"}</td>
                  <td className="py-2 pr-3 text-right">{inv.amount_ht.toFixed(2)} €</td>
                  <td className="py-2 pr-3 text-right font-medium">{inv.amount_ttc.toFixed(2)} €</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[inv.status]}`}>
                      {STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5 items-center">
                      {inv.status === "draft" && (
                        <button onClick={() => quickStatus(inv, "sent")}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-300 hover:bg-yellow-800/60 transition-colors" title="Marquer comme envoyée">
                          Envoyée
                        </button>
                      )}
                      {(inv.status === "sent" || inv.status === "overdue") && (
                        <>
                          <button onClick={() => quickStatus(inv, "paid")}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800/60 transition-colors" title="Marquer comme payée">
                            Payée
                          </button>
                          <button onClick={() => setReminderInv(inv)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-vscode-border/60 text-vscode-muted hover:text-vscode-text transition-colors" title="Générer relance">
                            Relance
                          </button>
                        </>
                      )}
                      <button onClick={() => openEdit(inv)}
                        className="text-xs text-vscode-muted hover:text-vscode-text transition-colors">
                        Éditer
                      </button>
                      <button onClick={() => downloadInvoicePdf(inv.id, inv.number)} title="Télécharger le PDF"
                        className="text-xs text-vscode-accent hover:text-blue-300 transition-colors">
                        PDF
                      </button>
                      <button onClick={() => handleDelete(inv.id)}
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

      {/* Formulaire modal */}
      {editingId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <h2 className="text-sm font-semibold">
              {editingId === "new" ? "Nouvelle facture" : "Modifier la facture"}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-vscode-muted block mb-1">N° facture</label>
                <input
                  type="text"
                  value={form.number}
                  onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Client</label>
                <input
                  type="text"
                  aria-label="Client"
                  value={form.client}
                  onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Échéance</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-vscode-muted block mb-1">Description</label>
                <input
                  type="text"
                  aria-label="Description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Montant HT (€)</label>
                <input
                  type="number"
                  aria-label="Montant HT"
                  min={0}
                  step={0.01}
                  value={form.amount_ht}
                  onChange={(e) => handleAmountHtChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">TVA (%)</label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={form.vat_rate}
                  onChange={(e) => handleVatRateChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Montant TTC (€)</label>
                <input
                  type="number"
                  readOnly
                  value={form.amount_ttc}
                  className="w-full bg-vscode-bg border border-vscode-border/50 rounded px-2 py-1.5 text-sm text-vscode-muted cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Statut</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as OutgoingInvoice["status"] }))}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
                >
                  <option value="draft">Brouillon</option>
                  <option value="sent">Envoyée</option>
                  <option value="paid">Payée</option>
                  <option value="overdue">En retard</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-vscode-muted block mb-1">Notes</label>
                <textarea
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingId(null)}
                className="text-sm text-vscode-muted hover:text-vscode-text px-3 py-1.5 rounded transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded transition-colors"
              >
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal relance */}
      {reminderInv && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <h2 className="text-sm font-semibold">Email de relance — {reminderInv.number}</h2>
            <textarea
              readOnly
              rows={12}
              className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-2 text-xs font-mono focus:outline-none resize-none"
              value={`Objet : Relance facture ${reminderInv.number} — échéance dépassée\n\nBonjour,\n\nSauf erreur de notre part, nous n'avons pas reçu le règlement de la facture ci-dessous :\n\n  Facture n° : ${reminderInv.number}\n  Date       : ${reminderInv.date}\n  Échéance   : ${reminderInv.dueDate}\n  Montant TTC: ${reminderInv.amount_ttc.toFixed(2)} €\n\nNous vous remercions de bien vouloir procéder au règlement de cette somme dans les meilleurs délais.\n\nEn cas de règlement récent, veuillez ne pas tenir compte de ce message.\n\nCordialement,`}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `Objet : Relance facture ${reminderInv.number}\n\nBonjour,\n\nSauf erreur de notre part, nous n'avons pas reçu le règlement de la facture n° ${reminderInv.number} du ${reminderInv.date} d'un montant de ${reminderInv.amount_ttc.toFixed(2)} € (échéance : ${reminderInv.dueDate}).\n\nMerci de procéder au règlement dans les meilleurs délais.\n\nCordialement,`
                  );
                }}
                className="text-sm text-vscode-muted hover:text-vscode-text px-3 py-1.5 rounded border border-vscode-border transition-colors"
              >
                Copier
              </button>
              <button
                onClick={() => setReminderInv(null)}
                className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
