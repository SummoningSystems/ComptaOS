import { useEffect, useState } from "react";
import {
  fetchGitSyncStatus,
  configureGitSync,
  testGitSync,
  gitSyncPush,
  gitSyncPull,
  deleteGitSync,
  type GitSyncStatus,
  type GitSyncConfig,
  type GitProvider,
} from "../../api/client";

// ── Providers ─────────────────────────────────────────────────────────────────

const PROVIDERS: { id: GitProvider; label: string; icon: string; urlHint: string; tokenUrl: string }[] = [
  {
    id: "github",
    label: "GitHub",
    icon: "🐙",
    urlHint: "https://github.com/votre-compte/nom-du-depot.git",
    tokenUrl: "https://github.com/settings/tokens/new?scopes=repo&description=ComptaOS",
  },
  {
    id: "gitlab",
    label: "GitLab",
    icon: "🦊",
    urlHint: "https://gitlab.com/votre-compte/nom-du-depot.git",
    tokenUrl: "https://gitlab.com/-/profile/personal_access_tokens",
  },
  {
    id: "gitea",
    label: "Gitea / Forgejo",
    icon: "🍵",
    urlHint: "https://votre-instance.com/compte/depot.git",
    tokenUrl: "",
  },
  {
    id: "custom",
    label: "Autre serveur git",
    icon: "🔧",
    urlHint: "https://git.example.com/compte/depot.git",
    tokenUrl: "",
  },
];

// ── Sous-composant : étape ────────────────────────────────────────────────────

function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-xs ${active ? "text-vscode-accent font-semibold" : done ? "text-green-400" : "text-vscode-muted"}`}>
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border shrink-0
        ${active ? "border-vscode-accent bg-vscode-accent/20" : done ? "border-green-400 bg-green-400/10" : "border-vscode-border"}`}>
        {done ? "✓" : n}
      </span>
      {label}
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────

export function GitSyncPanel() {
  const [status, setStatus] = useState<GitSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Formulaire
  const [provider, setProvider] = useState<GitProvider>("github");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [token, setToken] = useState("");
  const [branch, setBranch] = useState("main");
  const [showToken, setShowToken] = useState(false);

  // Actions
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const s = await fetchGitSyncStatus();
      setStatus(s);
      if (s.configured) {
        setProvider(s.provider ?? "custom");
        setRemoteUrl(s.remoteUrl ?? "");
        setBranch(s.branch ?? "main");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const selectedProvider = PROVIDERS.find((p) => p.id === provider)!;
  const localStatusCard = status?.local && <div className={`rounded-lg border p-3 text-xs ${status.local.ready ? "border-green-500/30 bg-green-500/10" : "border-red-500/40 bg-red-500/10"}`}>
    <div className={`font-semibold ${status.local.ready ? "text-green-400" : "text-red-400"}`}>{status.local.ready ? "✓ Historique local opérationnel" : "✕ Historique local indisponible"}</div>
    {status.local.ready ? <div className="mt-1 space-y-0.5 text-[11px] text-vscode-muted"><p>{status.local.uncommitted ? `${status.local.uncommitted} modification(s) en attente du prochain commit automatique` : "Toutes les données versionnables sont enregistrées"}</p>{status.local.lastCommit && <p>Dernier commit : <span className="text-vscode-text">{status.local.lastCommit}</span></p>}<p>Les photos et PDF restent hors de Git ; leur chemin est conservé dans les données de transaction.</p></div> : <p className="mt-1 break-words text-[11px] text-red-300">{status.local.error || "Git ne peut pas enregistrer le workspace."}</p>}
  </div>;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testGitSync({ provider, remoteUrl, token, branch });
      setTestResult(r);
      if (r.ok) setStep(3);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSyncMsg(null);
    try {
      await configureGitSync({ provider, remoteUrl, token, branch });
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur";
      setSyncMsg({ ok: false, message: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handlePush() {
    setSyncing("push");
    setSyncMsg(null);
    const r = await gitSyncPush();
    setSyncMsg(r);
    setSyncing(null);
    if (r.ok) load();
  }

  async function handlePull() {
    setSyncing("pull");
    setSyncMsg(null);
    const r = await gitSyncPull();
    setSyncMsg(r);
    setSyncing(null);
    if (r.ok) load();
  }

  async function handleDisconnect() {
    if (!confirm("Supprimer la configuration de synchronisation ?")) return;
    await deleteGitSync();
    setToken("");
    setRemoteUrl("");
    setStep(1);
    await load();
  }

  if (loading) return <div className="text-vscode-muted text-xs py-4">Chargement…</div>;

  // ── Vue : synchronisation configurée ─────────────────────────────────────
  if (status?.configured) {
    return (
      <div className="space-y-4">
        {localStatusCard}
        {/* En-tête statut */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <span className="text-xl">{PROVIDERS.find((p) => p.id === status.provider)?.icon ?? "🔧"}</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-green-400">Synchronisation active</div>
            <div className="text-[11px] text-vscode-muted truncate">{status.remoteUrl}</div>
            <div className="text-[11px] text-vscode-muted">Branche : <span className="text-vscode-text">{status.branch}</span></div>
          </div>
        </div>

        {/* Indicateurs ahead/behind */}
        <div className="flex gap-3">
          <div className={`flex-1 text-center p-2 rounded border text-xs ${status.ahead > 0 ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-vscode-border text-vscode-muted"}`}>
            <div className="text-lg font-bold">{status.ahead}</div>
            <div>commit{status.ahead > 1 ? "s" : ""} à envoyer</div>
          </div>
          <div className={`flex-1 text-center p-2 rounded border text-xs ${status.behind > 0 ? "border-orange-500/40 bg-orange-500/10 text-orange-300" : "border-vscode-border text-vscode-muted"}`}>
            <div className="text-lg font-bold">{status.behind}</div>
            <div>commit{status.behind > 1 ? "s" : ""} à récupérer</div>
          </div>
        </div>

        {/* Boutons sync */}
        <div className="flex gap-2">
          <button
            onClick={handlePush}
            disabled={syncing !== null}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-vscode-accent/90 hover:bg-vscode-accent text-white text-xs transition-colors disabled:opacity-50"
          >
            {syncing === "push" ? "⏳" : "⬆"} Envoyer
          </button>
          <button
            onClick={handlePull}
            disabled={syncing !== null}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-vscode-panel border border-vscode-border hover:border-vscode-accent text-vscode-text text-xs transition-colors disabled:opacity-50"
          >
            {syncing === "pull" ? "⏳" : "⬇"} Récupérer
          </button>
        </div>

        {syncMsg && (
          <div className={`text-xs px-3 py-2 rounded ${syncMsg.ok ? "bg-green-500/10 text-green-400 border border-green-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>
            {syncMsg.ok ? "✓ " : "✗ "}{syncMsg.message}
          </div>
        )}

        {/* Modifier / Déconnecter */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { setStatus({ ...status, configured: false }); setStep(1); }}
            className="text-xs text-vscode-accent hover:underline"
          >
            Modifier la configuration
          </button>
          <span className="text-vscode-muted">·</span>
          <button onClick={handleDisconnect} className="text-xs text-red-400 hover:underline">
            Déconnecter
          </button>
        </div>
      </div>
    );
  }

  // ── Vue : assistant de configuration ─────────────────────────────────────
  return (
    <div className="space-y-5">
      {localStatusCard}
      {/* Intro */}
      <div className="p-3 rounded-lg bg-vscode-accent/10 border border-vscode-accent/30 text-xs text-vscode-text leading-relaxed">
        <p className="font-semibold text-vscode-accent mb-1">🔒 Vos données restent chez vous</p>
        <p>
          ComptaOS stocke toutes vos données localement. La synchronisation utilise
          votre propre dépôt git privé — ni ComptaOS ni aucun tiers n'y a accès.
        </p>
      </div>

      {/* Progression */}
      <div className="flex items-center gap-3">
        <Step n={1} label="Choisir" active={step === 1} done={step > 1} />
        <div className="flex-1 h-px bg-vscode-border" />
        <Step n={2} label="Configurer" active={step === 2} done={step > 2} />
        <div className="flex-1 h-px bg-vscode-border" />
        <Step n={3} label="Confirmer" active={step === 3} done={false} />
      </div>

      {/* Étape 1 : choix du provider */}
      {step === 1 && (
        <div className="space-y-2">
          <p className="text-xs text-vscode-muted">Où souhaitez-vous stocker la sauvegarde ?</p>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setProvider(p.id); setStep(2); }}
                className="flex items-center gap-2 p-3 rounded-lg border border-vscode-border hover:border-vscode-accent bg-vscode-panel text-left transition-colors"
              >
                <span className="text-xl">{p.icon}</span>
                <span className="text-xs font-medium text-vscode-text">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Étape 2 : URL + token */}
      {step === 2 && (
        <div className="space-y-4">
          <button onClick={() => setStep(1)} className="text-xs text-vscode-muted hover:text-vscode-text flex items-center gap-1">
            ← Retour
          </button>

          <div className="flex items-center gap-2">
            <span className="text-2xl">{selectedProvider.icon}</span>
            <span className="text-sm font-semibold text-vscode-text">{selectedProvider.label}</span>
          </div>

          {/* URL du dépôt */}
          <div className="space-y-1">
            <label className="text-xs text-vscode-muted">URL du dépôt (HTTPS)</label>
            <input
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder={selectedProvider.urlHint}
              className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-xs text-vscode-text placeholder:text-vscode-muted focus:outline-none focus:border-vscode-accent"
            />
            <p className="text-[10px] text-vscode-muted">
              Créez d'abord un dépôt <strong>privé vide</strong> chez votre hébergeur, puis collez son URL ici.
            </p>
          </div>

          {/* Token */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-vscode-muted">Token d'accès personnel</label>
              {selectedProvider.tokenUrl && (
                <a
                  href={selectedProvider.tokenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-vscode-accent hover:underline"
                >
                  Créer un token {selectedProvider.label} →
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 pr-8 text-xs text-vscode-text placeholder:text-vscode-muted focus:outline-none focus:border-vscode-accent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-vscode-muted hover:text-vscode-text text-[10px]"
              >
                {showToken ? "masquer" : "voir"}
              </button>
            </div>
            <p className="text-[10px] text-vscode-muted">
              Le token est stocké uniquement sur votre machine, dans le dossier .git local.
            </p>
          </div>

          {/* Branche */}
          <div className="space-y-1">
            <label className="text-xs text-vscode-muted">Branche</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-xs text-vscode-text focus:outline-none focus:border-vscode-accent font-mono"
            />
          </div>

          {/* Résultat test */}
          {testResult && (
            <div className={`text-xs px-3 py-2 rounded ${testResult.ok ? "bg-green-500/10 text-green-400 border border-green-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>
              {testResult.ok ? "✓ Connexion réussie !" : `✗ ${testResult.error}`}
            </div>
          )}

          <button
            onClick={handleTest}
            disabled={!remoteUrl || !token || testing}
            className="w-full py-1.5 rounded bg-vscode-accent/90 hover:bg-vscode-accent disabled:opacity-40 text-white text-xs font-medium transition-colors"
          >
            {testing ? "⏳ Test en cours…" : "Tester la connexion →"}
          </button>
        </div>
      )}

      {/* Étape 3 : confirmation */}
      {step === 3 && (
        <div className="space-y-4">
          <button onClick={() => setStep(2)} className="text-xs text-vscode-muted hover:text-vscode-text flex items-center gap-1">
            ← Retour
          </button>

          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 space-y-1">
            <p className="text-xs text-green-400 font-semibold">✓ Connexion vérifiée</p>
            <p className="text-[11px] text-vscode-muted break-all">{remoteUrl}</p>
          </div>

          <p className="text-xs text-vscode-muted leading-relaxed">
            En confirmant, ComptaOS sauvegarde la configuration localement et
            active la synchronisation automatique après chaque modification.
          </p>

          {syncMsg && !syncMsg.ok && (
            <div className="text-xs px-3 py-2 rounded bg-red-500/10 text-red-400 border border-red-500/30">
              ✗ {syncMsg.message}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2 rounded bg-vscode-accent/90 hover:bg-vscode-accent disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            {saving ? "⏳ Enregistrement…" : "✓ Activer la synchronisation"}
          </button>
        </div>
      )}
    </div>
  );
}
