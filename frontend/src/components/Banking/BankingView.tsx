import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";

interface BankAccount {
  id: number;
  iban?: string;
  name?: string;
  currency?: string;
  balance?: number;
  balanceUpdatedAt?: string;
  lastSyncAt?: string;
  importedCount?: number;
}

interface BankConnection {
  connectionId: number;
  connectorName: string;
  connectorLogo?: string;
  accounts: BankAccount[];
  createdAt: string;
  status: string;
}

interface PowensConfig {
  configured: boolean;
  mode?: "hosted" | "self_hosted";
  domain?: string;
  clientId?: string;
}

type Step = "connections" | "setup" | "waiting_webview";

export function BankingView() {
  const [config, setConfig] = useState<PowensConfig>({ configured: false });
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [step, setStep] = useState<Step>("connections");
  const [loading, setLoading] = useState(true);

  // Setup form
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [setupMsg, setSetupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  // Connexion en cours
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  // Sync
  const [syncStatus, setSyncStatus] = useState<Record<number, { loading: boolean; msg: string }>>({});

  const loadData = useCallback(async () => {
    try {
      const [cfg, conns] = await Promise.all([
        api.get<PowensConfig>("/banking/config"),
        api.get<BankConnection[]>("/banking/connections"),
      ]);
      setConfig(cfg.data);
      setConnections(conns.data);
    } catch {/* silent */}
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setSetupLoading(true);
    setSetupMsg(null);
    try {
      await api.post("/banking/config", { domain: domain.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setSetupMsg({ ok: true, text: "Credentials enregistrés !" });
      setConfig({ configured: true, mode: "self_hosted", domain: domain.trim(), clientId: clientId.trim() });
      setClientSecret("");
      setStep("connections");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur";
      setSetupMsg({ ok: false, text: msg });
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleConnect() {
    setConnectMsg(null);
    setConnectLoading(true);
    const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
    try {
      const { data } = await api.post<{ url: string }>("/banking/connect", { redirectUrl });
      setStep("waiting_webview");
      window.open(data.url, "powens_webview", "popup,width=600,height=700");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur de connexion";
      setConnectMsg(msg);
    } finally {
      setConnectLoading(false);
    }
  }

  async function handleRefresh() {
    setConnectMsg("Récupération des connexions…");
    try {
      const { data } = await api.post<BankConnection[]>("/banking/refresh");
      setConnections(data);
      setConnectMsg(null);
      setStep("connections");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur de synchronisation";
      setConnectMsg(msg);
    }
  }

  async function handleSyncAll(conn: BankConnection) {
    setSyncStatus((s) => ({ ...s, [conn.connectionId]: { loading: true, msg: "" } }));
    try {
      const { data } = await api.post<{ imported: number; skipped: number; errors: string[] }>(
        `/banking/sync-all/${conn.connectionId}`
      );
      const msg = `${data.imported} transaction(s) importée(s), ${data.skipped} déjà présente(s)${data.errors.length ? ` — ${data.errors.join(", ")}` : ""}`;
      setSyncStatus((s) => ({ ...s, [conn.connectionId]: { loading: false, msg } }));
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur de sync";
      setSyncStatus((s) => ({ ...s, [conn.connectionId]: { loading: false, msg: msg ?? "Erreur" } }));
    }
  }

  async function handleDeduplicate() {
    if (!confirm("Rejeter automatiquement les imports Powens qui existent déjà comme transactions manuelles ?")) return;
    try {
      const { data } = await api.post<{ rejected: number }>("/banking/deduplicate");
      alert(`${data.rejected} doublon(s) rejeté(s).`);
      await loadData();
    } catch {/* silent */}
  }

  async function handleDelete(conn: BankConnection) {
    if (!confirm(`Déconnecter ${conn.connectorName} ? Les transactions déjà importées seront conservées.`)) return;
    try {
      await api.delete(`/banking/connections/${conn.connectionId}`);
      await loadData();
    } catch {/* silent */}
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Chargement…</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-auto bg-vscode-bg text-vscode-text p-5">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">🏦 Connexion bancaire PSD2</h1>
            <p className="text-xs text-vscode-muted mt-0.5">
              Importez automatiquement vos transactions depuis votre banque via Open Banking (Powens).
            </p>
          </div>
          <div className="flex gap-2">
            {config.configured && step === "connections" && (
              <>
                <button
                  onClick={handleDeduplicate}
                  className="text-xs border border-orange-700 text-orange-400 px-3 py-1.5 rounded hover:bg-orange-900/20"
                  title="Rejeter les imports Powens en doublon avec des transactions existantes"
                >
                  🔁 Dédoublonner
                </button>
                <button
                  onClick={handleRefresh}
                  className="text-xs border border-vscode-border text-vscode-muted px-3 py-1.5 rounded hover:text-vscode-text"
                  title="Rafraîchir la liste des connexions depuis Powens"
                >
                  ↻ Rafraîchir
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connectLoading}
                  className="text-xs bg-vscode-accent text-white px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
                >
                  {connectLoading ? "Ouverture…" : "+ Connecter une banque"}
                </button>
                {config.mode === "self_hosted" && (
                  <button
                    onClick={() => setStep("setup")}
                    className="text-xs border border-vscode-border text-vscode-muted px-3 py-1.5 rounded hover:text-vscode-text"
                    title="Modifier les credentials Powens"
                  >
                    ⚙️ API
                  </button>
                )}
              </>
            )}
            {step !== "connections" && (
              <button
                onClick={() => { setStep("connections"); setConnectMsg(null); }}
                className="text-xs border border-vscode-border text-vscode-muted px-3 py-1.5 rounded hover:text-vscode-text"
              >
                ← Retour
              </button>
            )}
          </div>
        </div>

        {/* ── Mode hébergé non activé ── */}
        {!config.configured && config.mode === "hosted" && step === "connections" && (
          <div className="bg-vscode-panel border border-yellow-700/40 rounded-lg p-5 text-center">
            <p className="text-2xl mb-2">🔧</p>
            <p className="text-sm font-bold mb-1">Connexion bancaire non activée</p>
            <p className="text-xs text-vscode-muted">
              Le service Open Banking n'est pas encore configuré sur ce serveur.
            </p>
          </div>
        )}

        {/* ── Formulaire de configuration ── */}
        {(step === "setup" || (!config.configured && config.mode !== "hosted")) && (
          <div className="bg-vscode-panel border border-vscode-border rounded-lg p-5">
            <h2 className="text-sm font-bold mb-1">Configuration Open Banking — Powens</h2>
            <p className="text-xs text-vscode-muted mb-1">
              Créez un compte gratuit sur{" "}
              <a href="https://console.budget-insight.com/auth/register" target="_blank" rel="noopener noreferrer"
                className="text-vscode-accent hover:underline">
                console.budget-insight.com
              </a>
              , créez un domaine (ex : <code className="font-mono bg-vscode-bg px-1 rounded">monapp-sandbox</code>)
              et une application cliente, puis renseignez vos credentials ci-dessous.
            </p>
            <p className="text-[10px] text-vscode-muted mb-1">
              Dans la console Powens, ajoutez également l'URL de redirection suivante à votre application cliente :
            </p>
            <p className="text-[10px] font-mono bg-vscode-bg border border-vscode-border rounded px-2 py-1 mb-4 break-all">
              {window.location.origin}{import.meta.env.BASE_URL}
            </p>
            <form onSubmit={handleSetup} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Domaine</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="monapp-sandbox"
                  required
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-vscode-accent"
                />
                <p className="text-[10px] text-vscode-muted mt-0.5">Le sous-domaine biapi.pro (sans .biapi.pro)</p>
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="12345"
                  required
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <div>
                <label className="text-xs text-vscode-muted block mb-1">Client Secret</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  required
                  className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-vscode-accent"
                />
              </div>
              <button
                type="submit"
                disabled={setupLoading}
                className="self-start bg-vscode-accent text-white text-xs px-4 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
              >
                {setupLoading ? "Enregistrement…" : "Enregistrer"}
              </button>
            </form>
            {setupMsg && (
              <p className={`mt-2 text-xs ${setupMsg.ok ? "text-green-400" : "text-red-400"}`}>
                {setupMsg.text}
              </p>
            )}
          </div>
        )}

        {/* ── Attente retour webview ── */}
        {step === "waiting_webview" && (
          <div className="bg-vscode-panel border border-yellow-700/40 rounded-lg p-5 text-center">
            <p className="text-2xl mb-3">🔐</p>
            <h2 className="text-sm font-bold mb-2">Authentification bancaire en cours</h2>
            <p className="text-xs text-vscode-muted mb-4">
              Une fenêtre Powens s'est ouverte. Sélectionnez votre banque et authentifiez-vous.
              Une fois terminé, revenez ici et cliquez sur le bouton ci-dessous.
            </p>
            {connectMsg && <p className="text-xs text-vscode-muted mb-3">{connectMsg}</p>}
            <button
              onClick={handleRefresh}
              className="bg-vscode-accent text-white text-xs px-4 py-2 rounded hover:opacity-90"
            >
              ✓ J'ai terminé — importer mes comptes
            </button>
          </div>
        )}

        {/* ── Liste des connexions ── */}
        {step === "connections" && config.configured && (
          <>
            {connectMsg && <p className="text-xs text-red-400">{connectMsg}</p>}
            {connections.length === 0 ? (
              <div className="text-center py-12 text-vscode-muted">
                <p className="text-3xl mb-3">🏦</p>
                <p className="text-sm">Aucune banque connectée</p>
                <p className="text-xs mt-1">Cliquez sur "Connecter une banque" pour commencer.</p>
              </div>
            ) : (
              connections.map((conn) => (
                <div
                  key={conn.connectionId}
                  className="bg-vscode-panel border border-vscode-border rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {conn.connectorLogo ? (
                        <img src={conn.connectorLogo} alt={conn.connectorName}
                          className="w-8 h-8 object-contain rounded" />
                      ) : (
                        <span className="text-xl">🏦</span>
                      )}
                      <div>
                        <p className="text-sm font-bold">{conn.connectorName}</p>
                        <p className="text-[10px] text-vscode-muted">
                          Connecté le {new Date(conn.createdAt).toLocaleDateString("fr-FR")}
                          {" · "}
                          <span className={!conn.status || conn.status === "active" ? "text-green-400" : "text-yellow-400"}>
                            {!conn.status || conn.status === "active" ? "✓ Actif" : conn.status}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSyncAll(conn)}
                        disabled={syncStatus[conn.connectionId]?.loading}
                        className="text-xs bg-vscode-accent text-white px-3 py-1 rounded hover:opacity-90 disabled:opacity-50"
                      >
                        {syncStatus[conn.connectionId]?.loading ? "Sync…" : "🔄 Synchroniser"}
                      </button>
                      <button
                        onClick={() => handleDelete(conn)}
                        className="text-xs border border-red-800/50 text-red-400 px-3 py-1 rounded hover:bg-red-900/20"
                      >
                        Déconnecter
                      </button>
                    </div>
                  </div>

                  {syncStatus[conn.connectionId]?.msg && (
                    <p className="text-xs text-green-400 mb-2 px-1">
                      {syncStatus[conn.connectionId].msg}
                    </p>
                  )}

                  {/* Comptes */}
                  <div className="flex flex-col gap-1.5">
                    {conn.accounts.map((acc) => (
                      <div
                        key={acc.id}
                        className="flex items-center justify-between bg-vscode-bg rounded px-3 py-2 text-xs"
                      >
                        <div>
                          <span className="font-medium">{acc.name ?? acc.iban ?? String(acc.id)}</span>
                          {acc.iban && acc.name && (
                            <span className="text-vscode-muted ml-2 font-mono">{acc.iban}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-vscode-muted">
                          {acc.balance !== undefined && (
                            <span
                              title={acc.balanceUpdatedAt ? `Solde actualisé le ${new Date(acc.balanceUpdatedAt).toLocaleString("fr-FR")}` : "Dernier solde bancaire connu"}
                              className={acc.balance >= 0 ? "text-green-400 font-mono" : "text-red-400 font-mono"}
                            >
                              {acc.balance.toLocaleString("fr-FR", { style: "currency", currency: acc.currency ?? "EUR" })}
                            </span>
                          )}
                          {acc.lastSyncAt && (
                            <span title={new Date(acc.lastSyncAt).toLocaleString("fr-FR")}>
                              Synchro {new Date(acc.lastSyncAt).toLocaleDateString("fr-FR")}
                              {acc.importedCount ? ` · ${acc.importedCount} tx` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* Note */}
        <p className="text-[10px] text-vscode-muted text-center mt-2">
          Connexion via Open Banking (PSD2). Vos identifiants bancaires
          ne transitent jamais par ComptaOS — l'authentification se fait directement sur le site de votre banque.
        </p>
      </div>
    </div>
  );
}
