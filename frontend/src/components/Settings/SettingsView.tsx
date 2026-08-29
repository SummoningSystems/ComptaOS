import { useEffect, useState } from "react";
import { CategoryRule, TreasuryAlert, Category, AiConfig, AiConfigStatus, AiProvider, CompanyProfile } from "../../types";
import { GitSyncPanel } from "./GitSyncPanel";
import { api } from "../../api/client";
import {
  fetchCategoryRules,
  saveCategoryRules,
  fetchTreasuryAlert,
  saveTreasuryAlert,
  fetchAiConfig,
  saveAiConfig,
  fetchCompanyProfile,
  saveCompanyProfile,
  createCategory,
  deleteCategory,
} from "../../api/client";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";

const CATEGORIES: Category[] = [
  "hosting", "software", "salary", "subcontracting", "professional_fees", "external_services", "travel", "restaurant", "food",
  "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc",
];

const CATEGORY_LABELS: Record<Category, string> = {
  hosting: "Hébergement",
  software: "Logiciel",
  salary: "Salaire",
  subcontracting: "Sous-traitance",
  professional_fees: "Conseil et honoraires",
  external_services: "Autres prestations",
  travel: "Transport",
  restaurant: "Restaurant",
  food: "Alimentaire",
  taxes: "Impôts/Taxes",
  equipment: "Matériel",
  subscription: "Abonnement",
  rent: "Loyer",
  legal: "Juridique",
  insurance: "Assurance",
  misc: "Divers",
};

export function SettingsView() {
  const { categories, allCategories, reload: reloadCategories } = useCategoryCatalog();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [alert, setAlert] = useState<TreasuryAlert>({ threshold: 5000, enabled: false });
  const [aiStatus, setAiStatus] = useState<AiConfigStatus>({ configured: false });
  const [aiForm, setAiForm] = useState<AiConfig>({ provider: "github-models", apiKey: "", model: "gpt-4o-mini" });
  const [profile, setProfile] = useState<CompanyProfile>({ name: "" });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showMistralKey, setShowMistralKey] = useState(false);

  // Chiffrement
  const [encEnabled, setEncEnabled] = useState(false);
  const [encPassphrase, setEncPassphrase] = useState("");
  const [encConfirm, setEncConfirm] = useState("");
  const [encMsg, setEncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [encLoading, setEncLoading] = useState(false);

  // Form pour nouvelle règle
  const [newPattern, setNewPattern] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("misc");
  const [customCategory, setCustomCategory] = useState({ id: "", label: "", accountNumber: "", accountLabel: "", kind: "expense" as "expense" | "revenue" | "both" });
  const [categoryError, setCategoryError] = useState("");

  useEffect(() => {
    Promise.all([fetchCategoryRules(), fetchTreasuryAlert(), fetchAiConfig(), fetchCompanyProfile()])
      .then(([r, a, ai, prof]) => {
        setRules(r);
        setAlert(a);
        setAiStatus(ai);
        setProfile(prof);
        if (ai.configured && ai.provider) {
          setAiForm((f) => ({ ...f, provider: ai.provider!, model: ai.model ?? f.model, baseUrl: ai.baseUrl ?? undefined }));
        }
      })
      .finally(() => setLoading(false));

    // Statut chiffrement
    api.get<{ enabled: boolean }>("/encryption/status").then(({ data }) => {
      setEncEnabled(data.enabled);
    }).catch(() => {});
  }, []);

  async function handleSaveRules(updated: CategoryRule[]) {
    setRules(updated);
    await saveCategoryRules(updated);
    flashSaved();
  }

  async function handleAddRule() {
    if (!newPattern.trim()) return;
    const rule: CategoryRule = { id: crypto.randomUUID(), pattern: newPattern.trim(), category: newCategory };
    await handleSaveRules([...rules, rule]);
    setNewPattern("");
    setNewCategory("misc");
  }

  async function handleDeleteRule(id: string) {
    await handleSaveRules(rules.filter((r) => r.id !== id));
  }

  async function handleCreateCategory() {
    setCategoryError("");
    try {
      await createCategory({ id: customCategory.id, label: customCategory.label, account: { number: customCategory.accountNumber, label: customCategory.accountLabel }, kind: customCategory.kind, active: true });
      setCustomCategory({ id: "", label: "", accountNumber: "", accountLabel: "", kind: "expense" });
      await reloadCategories();
      flashSaved();
    } catch (error) {
      setCategoryError((error as { response?: { data?: { error?: string } } }).response?.data?.error ?? "Impossible de créer la catégorie.");
    }
  }

  async function handleDeleteCustomCategory(id: string) {
    await deleteCategory(id);
    await reloadCategories();
    flashSaved();
  }

  async function handleSaveAlert() {
    await saveTreasuryAlert(alert);
    flashSaved();
  }

  async function handleSaveAi() {
    await saveAiConfig(aiForm);
    const updated = await fetchAiConfig();
    setAiStatus(updated);
    flashSaved();
  }

  async function handleSaveProfile() {
    await saveCompanyProfile(profile);
    flashSaved();
  }

  function profileField(key: keyof CompanyProfile) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setProfile((p) => ({ ...p, [key]: e.target.value }));
  }

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-muted text-sm">
        Chargement…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8 text-vscode-text">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Paramètres</h1>
        {saved && (
          <span className="text-xs text-green-400 bg-green-900/30 px-3 py-1 rounded">
            ✓ Sauvegardé
          </span>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-vscode-muted uppercase tracking-wider">Catalogue de catégories</h2>
        <p className="text-xs text-vscode-muted">Catégories standard et catégories propres à votre activité, chacune avec son compte PCG.</p>
        <div className="grid md:grid-cols-2 gap-2 text-xs">{allCategories.filter((c) => c.active).map((c) => <div key={c.id} className="flex items-center gap-2 rounded border border-vscode-border p-2"><span className="flex-1"><strong>{c.label}</strong><span className="block text-vscode-muted">{c.kind === "revenue" ? "Recette" : c.kind === "expense" ? "Dépense" : "Recette et dépense"} · {c.account.number} · {c.account.label}</span></span>{!c.builtin && <button onClick={() => void handleDeleteCustomCategory(c.id)} className="text-red-400">Désactiver</button>}</div>)}</div>
        <div className="grid md:grid-cols-[1fr_1.3fr_0.8fr_0.8fr_1.3fr_auto] gap-2">
          <input value={customCategory.id} onChange={(e) => setCustomCategory((v) => ({ ...v, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))} placeholder="code_interne" className="bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm" />
          <input value={customCategory.label} onChange={(e) => setCustomCategory((v) => ({ ...v, label: e.target.value }))} placeholder="Libellé visible" className="bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm" />
          <select value={customCategory.kind} onChange={(e) => setCustomCategory((v) => ({ ...v, kind: e.target.value as typeof v.kind }))} className="bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm"><option value="expense">Dépense</option><option value="revenue">Recette</option><option value="both">Les deux</option></select>
          <input value={customCategory.accountNumber} onChange={(e) => setCustomCategory((v) => ({ ...v, accountNumber: e.target.value.replace(/\D/g, "") }))} placeholder="Compte PCG" className="bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm" />
          <input value={customCategory.accountLabel} onChange={(e) => setCustomCategory((v) => ({ ...v, accountLabel: e.target.value }))} placeholder="Libellé du compte" className="bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm" />
          <button onClick={() => void handleCreateCategory()} className="bg-vscode-accent text-white rounded px-3 py-1.5 text-sm">Créer</button>
        </div>
        {categoryError && <p className="text-xs text-red-400">{categoryError}</p>}
      </section>

      {/* ── Profil entreprise ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-vscode-muted uppercase tracking-wider">
          Profil de l'entreprise
        </h2>
        <p className="text-xs text-vscode-muted">
          Ces informations apparaissent sur vos factures PDF et rapports.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "name" as const, label: "Nom *", placeholder: "Ma Société SAS" },
            { key: "legalForm" as const, label: "Forme juridique", placeholder: "SAS, SARL…" },
            { key: "siren" as const, label: "SIREN", placeholder: "123 456 789" },
            { key: "vatNumber" as const, label: "N° TVA", placeholder: "FR 12 123456789" },
            { key: "capital" as const, label: "Capital", placeholder: "10 000 €" },
            { key: "rcs" as const, label: "RCS", placeholder: "Paris B 123 456 789" },
            { key: "email" as const, label: "Email", placeholder: "contact@societe.fr" },
            { key: "phone" as const, label: "Téléphone", placeholder: "+33 1 23 45 67 89" },
            { key: "website" as const, label: "Site web", placeholder: "https://masociete.fr" },
            { key: "iban" as const, label: "IBAN", placeholder: "FR76 …" },
            { key: "bankName" as const, label: "Banque", placeholder: "BNP Paribas" },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-vscode-muted">{label}</label>
              <input
                type="text"
                aria-label={key === "name" ? "Nom de l'entreprise" : label}
                value={(profile[key] as string) ?? ""}
                onChange={profileField(key)}
                placeholder={placeholder}
                className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
              />
            </div>
          ))}
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-vscode-muted">Adresse</label>
            <input
              type="text"
              value={profile.address ?? ""}
              onChange={profileField("address")}
              placeholder="12 rue de la Paix, 75001 Paris"
              className="w-full bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
            />
          </div>
          <div className="col-span-2 mt-2 rounded border border-vscode-border bg-vscode-sidebar p-4">
            <h3 className="text-xs font-semibold text-vscode-text">Régime de TVA et provision de trésorerie</h3>
            <p className="mt-1 text-[10px] text-vscode-muted">Configuration propre à cette société. Elle pilote la trésorerie réellement disponible et l’échéancier indicatif.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-vscode-muted">Régime de TVA<select aria-label="Régime de TVA" value={profile.vatRegime ?? "monthly_ca3"} onChange={(event) => setProfile((current) => ({ ...current, vatRegime: event.target.value as CompanyProfile["vatRegime"] }))} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-sm text-vscode-text"><option value="monthly_ca3">Réel normal — CA3 mensuelle</option><option value="quarterly_ca3">Réel normal — CA3 trimestrielle</option><option value="simplified_ca12">Régime simplifié — CA12 + acomptes</option><option value="franchise">Franchise en base — sans TVA</option></select></label>
              <label className="text-xs text-vscode-muted">Dette TVA au 1er janvier (€)<input aria-label="Dette TVA au 1er janvier" type="number" min="0" step="0.01" value={profile.vatOpeningBalance ?? 0} onChange={(event) => setProfile((current) => ({ ...current, vatOpeningBalance: Number(event.target.value) || 0 }))} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-sm text-vscode-text" /></label>
              {profile.vatRegime === "simplified_ca12" && <><label className="text-xs text-vscode-muted">Année de référence N-1<input aria-label="Année de référence TVA" type="number" min="2020" max="2100" value={profile.vatReferenceYear ?? new Date().getFullYear() - 1} onChange={(event) => setProfile((current) => ({ ...current, vatReferenceYear: Number(event.target.value) }))} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-sm text-vscode-text" /></label><label className="text-xs text-vscode-muted">TVA de référence CA12 (€)<input aria-label="TVA de référence CA12" type="number" min="0" step="0.01" value={profile.vatReferenceAmount ?? 0} onChange={(event) => setProfile((current) => ({ ...current, vatReferenceAmount: Number(event.target.value) || 0 }))} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-sm text-vscode-text" /></label><p className="sm:col-span-2 text-[10px] text-amber-300">Les acomptes indicatifs sont calculés à 55 % en juillet et 40 % en décembre. Vérifie toujours l’échéancier réel dans l’espace professionnel impots.gouv.fr. Le régime simplifié est annoncé comme supprimé au 1er janvier 2027.</p></>}
            </div>
          </div>
        </div>
        <button
          onClick={handleSaveProfile}
          className="bg-vscode-accent hover:bg-blue-600 text-white text-xs px-4 py-1.5 rounded transition-colors"
        >
          Sauvegarder le profil
        </button>
      </section>

      {/* ── Règles de catégorie ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-vscode-muted uppercase tracking-wider">
          Règles de catégorisation automatique
        </h2>
        <p className="text-xs text-vscode-muted">
          Si le libellé d'une transaction importée contient le motif (insensible à la casse), la
          catégorie indiquée est assignée en priorité.
        </p>

        {/* Table des règles */}
        {rules.length > 0 ? (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-vscode-muted border-b border-vscode-border">
                <th className="pb-2 pr-4 font-medium">Motif</th>
                <th className="pb-2 pr-4 font-medium">Catégorie</th>
                <th className="pb-2 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-vscode-border/50 hover:bg-vscode-panel/50">
                  <td className="py-2 pr-4">
                    <code className="bg-vscode-bg px-1.5 py-0.5 rounded text-xs text-yellow-300">
                      {rule.pattern}
                    </code>
                  </td>
                  <td className="py-2 pr-4 text-vscode-muted">
                    {categories.find((category) => category.id === rule.category)?.label ?? rule.category}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-vscode-muted italic">Aucune règle définie.</p>
        )}

        {/* Formulaire d'ajout */}
        <div className="flex gap-2 items-center pt-1">
          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRule()}
            placeholder="Motif (ex: AWS, Stripe, Loyer…)"
            className="flex-1 bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as Category)}
            className="bg-vscode-bg border border-vscode-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddRule}
            className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded transition-colors"
          >
            Ajouter
          </button>
        </div>
      </section>

      {/* ── Alerte trésorerie ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-vscode-muted uppercase tracking-wider">
          Alerte trésorerie
        </h2>
        <p className="text-xs text-vscode-muted">
          Une bannière d'avertissement s'affiche dans la vue Frais récurrents si le solde prévu
          descend sous ce seuil.
        </p>

        <div className="flex gap-4 items-center">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <div
              onClick={() => setAlert((a) => ({ ...a, enabled: !a.enabled }))}
              className={`w-10 h-5 rounded-full transition-colors cursor-pointer ${
                alert.enabled ? "bg-vscode-accent" : "bg-vscode-border"
              } relative`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  alert.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </div>
            {alert.enabled ? "Activée" : "Désactivée"}
          </label>

          <div className="flex items-center gap-2">
            <span className="text-sm text-vscode-muted">Seuil :</span>
            <input
              type="number"
              min={0}
              step={100}
              value={alert.threshold}
              onChange={(e) => setAlert((a) => ({ ...a, threshold: parseFloat(e.target.value) || 0 }))}
              className="w-32 bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
            />
            <span className="text-sm text-vscode-muted">€</span>
          </div>

          <button
            onClick={handleSaveAlert}
            className="bg-vscode-accent hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded transition-colors"
          >
            Sauvegarder
          </button>
        </div>
      </section>

      {/* ── Intelligence Artificielle ─────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-vscode-text">Intelligence Artificielle</h2>
          {aiStatus.configured && (
            <span className="text-xs bg-green-700/30 text-green-400 border border-green-700 px-2 py-0.5 rounded-full">
              Configuré · {aiStatus.provider} · {aiStatus.model}
            </span>
          )}
        </div>
        <p className="text-sm text-vscode-muted">
          Utilisé pour la catégorisation automatique des transactions et le copilote financier.
        </p>

        {aiStatus.configured && aiStatus.apiKeyPreview && (
          <p className="text-xs text-vscode-muted">
            Clé actuelle : <span className="font-mono text-vscode-text">{aiStatus.apiKeyPreview}</span>
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 max-w-xl">
          {/* Provider */}
          <div className="space-y-1">
            <label className="text-xs text-vscode-muted uppercase tracking-wide">Fournisseur</label>
            <select
              value={aiForm.provider}
              onChange={(e) => {
                const p = e.target.value as AiProvider;
                const defaults: Record<AiProvider, string> = {
                  anthropic: "claude-sonnet-4-5",
                  openai: "gpt-4o-mini",
                  "github-models": "gpt-4o-mini",
                  ollama: "llama3.2",
                };
                setAiForm((f) => ({ ...f, provider: p, model: defaults[p], baseUrl: p === "ollama" ? "http://localhost:11434" : undefined }));
              }}
              className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
            >
              <option value="github-models">GitHub Models (GitHub PAT)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </div>

          {/* Modèle */}
          <div className="space-y-1">
            <label className="text-xs text-vscode-muted uppercase tracking-wide">Modèle</label>
            <input
              type="text"
              value={aiForm.model}
              onChange={(e) => setAiForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="gpt-4o-mini"
              className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
            />
            <p className="text-xs text-vscode-muted">
              {aiForm.provider === "github-models" && "Ex : gpt-4o, gpt-4o-mini, Meta-Llama-3.1-70B-Instruct"}
              {aiForm.provider === "openai" && "Ex : gpt-4o, gpt-4o-mini, o1-mini"}
              {aiForm.provider === "anthropic" && "Ex : claude-sonnet-4-5, claude-3-5-haiku-20241022"}
              {aiForm.provider === "ollama" && "Ex : llama3.2, mistral, phi3"}
            </p>
          </div>

          {/* Clé API */}
          <div className="space-y-1">
            <label className="text-xs text-vscode-muted uppercase tracking-wide">Clé API</label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={aiForm.apiKey}
                onChange={(e) => setAiForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={
                  aiForm.provider === "github-models" ? "github_pat_..." :
                  aiForm.provider === "openai" ? "sk-..." :
                  aiForm.provider === "anthropic" ? "sk-ant-..." :
                  "ollama (optionnel)"
                }
                className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 pr-10 text-sm focus:outline-none focus:border-vscode-accent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-vscode-muted hover:text-vscode-text text-xs"
              >
                {showApiKey ? "Cacher" : "Voir"}
              </button>
            </div>
            <p className="text-xs text-vscode-muted">
              {aiForm.provider === "github-models" && "Personal Access Token GitHub (github_pat_… ou token classique avec accès Models)"}
              {aiForm.provider === "openai" && "Clé API OpenAI depuis platform.openai.com"}
              {aiForm.provider === "anthropic" && "Clé API Anthropic depuis console.anthropic.com"}
              {aiForm.provider === "ollama" && "Non requis — laisser vide ou mettre 'ollama'"}
            </p>
          </div>

          {/* URL de base (Ollama ou custom) */}
          {(aiForm.provider === "ollama" || aiForm.baseUrl) && (
            <div className="space-y-1">
              <label className="text-xs text-vscode-muted uppercase tracking-wide">URL de base (optionnel)</label>
              <input
                type="text"
                value={aiForm.baseUrl ?? ""}
                onChange={(e) => setAiForm((f) => ({ ...f, baseUrl: e.target.value || undefined }))}
                placeholder="http://localhost:11434"
                className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-vscode-accent"
              />
            </div>
          )}

          <button
            onClick={handleSaveAi}
            className="self-start bg-vscode-accent hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded transition-colors"
          >
            Enregistrer la configuration IA
          </button>
        </div>
      </section>

      {/* ── Synchronisation Git ────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-vscode-muted uppercase tracking-wider">
            Sauvegarde &amp; Synchronisation
          </h2>
        </div>
        <p className="text-xs text-vscode-muted">
          Sauvegardez automatiquement vos données sur votre propre dépôt git privé.
          Aucune donnée ne transite par les serveurs ComptaOS.
        </p>
        <GitSyncPanel />
      </section>

      {/* OCR local et secours distant facultatif */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-vscode-text border-b border-vscode-border pb-2">
          OCR local des justificatifs (Mistral facultatif)
        </h2>
        <p className="text-xs text-vscode-muted">
          PaddleOCR traite gratuitement les justificatifs sur le serveur ComptaOS. La clé Mistral ci-dessous est facultative et reste inutilisée tant que le recours distant est désactivé.
          Pour activer volontairement ce secours, obtenez une clé sur{" "}
          <a href="https://console.mistral.ai" target="_blank" rel="noreferrer" className="text-vscode-accent underline">
            console.mistral.ai
          </a>.
        </p>
        <div className="space-y-1">
          <label className="text-xs text-vscode-muted uppercase tracking-wide">Clé API Mistral facultative</label>
          <div className="relative">
            <input
              type={showMistralKey ? "text" : "password"}
              value={aiForm.mistralApiKey ?? ""}
              onChange={(e) => setAiForm((f) => ({ ...f, mistralApiKey: e.target.value || undefined }))}
              placeholder="..."
              className="w-full bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 pr-10 text-sm focus:outline-none focus:border-vscode-accent font-mono"
            />
            <button
              type="button"
              onClick={() => setShowMistralKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-vscode-muted hover:text-vscode-text text-xs"
            >
              {showMistralKey ? "Cacher" : "Voir"}
            </button>
          </div>
        </div>
        <button
          onClick={handleSaveAi}
          className="self-start bg-vscode-accent hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded transition-colors"
        >
          Enregistrer
        </button>
      </section>

      {/* ── Chiffrement du workspace ─────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-vscode-text border-b border-vscode-border pb-2 flex items-center gap-2">
          🔒 Chiffrement du workspace
        </h2>
        <p className="text-xs text-vscode-muted">
          Chiffrement AES-256-GCM avec dérivation de clé PBKDF2 (100 000 itérations).
          La passphrase n'est jamais stockée — seul son hash SHA-256 est conservé pour vérification.
        </p>

        <div className={`flex items-center gap-2 px-3 py-2 rounded border ${encEnabled ? "border-green-700/60 bg-green-900/20" : "border-vscode-border bg-vscode-panel/30"}`}>
          <span className={`text-xl ${encEnabled ? "text-green-400" : "text-vscode-muted"}`}>{encEnabled ? "🔒" : "🔓"}</span>
          <div className="flex-1">
            <p className="text-xs font-semibold text-vscode-text">{encEnabled ? "Chiffrement actif" : "Chiffrement inactif"}</p>
            <p className="text-[11px] text-vscode-muted">{encEnabled ? "Les nouvelles données peuvent être chiffrées avec votre passphrase." : "Les données sont stockées en clair."}</p>
          </div>
        </div>

        {encMsg && (
          <div className={`text-xs px-3 py-2 rounded border ${encMsg.ok ? "border-green-700/50 bg-green-900/20 text-green-300" : "border-red-700/50 bg-red-900/20 text-red-300"}`}>
            {encMsg.text}
          </div>
        )}

        {!encEnabled ? (
          <div className="space-y-2">
            <label className="text-xs text-vscode-muted uppercase tracking-wide">Passphrase (min. 8 caractères)</label>
            <input
              type="password"
              value={encPassphrase}
              onChange={(e) => setEncPassphrase(e.target.value)}
              placeholder="Passphrase secrète…"
              className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-3 py-2 focus:outline-none focus:border-vscode-accent"
            />
            <label className="text-xs text-vscode-muted uppercase tracking-wide">Confirmer la passphrase</label>
            <input
              type="password"
              value={encConfirm}
              onChange={(e) => setEncConfirm(e.target.value)}
              placeholder="Confirmer…"
              className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-3 py-2 focus:outline-none focus:border-vscode-accent"
            />
            <button
              disabled={encLoading || encPassphrase.length < 8 || encPassphrase !== encConfirm}
              onClick={async () => {
                setEncLoading(true); setEncMsg(null);
                try {
                  await api.post("/encryption/enable", { passphrase: encPassphrase });
                  setEncEnabled(true);
                  setEncPassphrase(""); setEncConfirm("");
                  setEncMsg({ ok: true, text: "Chiffrement activé avec succès." });
                } catch (e: unknown) {
                  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur";
                  setEncMsg({ ok: false, text: msg });
                } finally { setEncLoading(false); }
              }}
              className="bg-vscode-accent hover:bg-blue-600 disabled:opacity-40 text-white text-xs px-4 py-1.5 rounded transition-colors"
            >
              {encLoading ? "Activation…" : "Activer le chiffrement"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs text-vscode-muted uppercase tracking-wide">Passphrase actuelle (pour désactiver)</label>
            <input
              type="password"
              value={encPassphrase}
              onChange={(e) => setEncPassphrase(e.target.value)}
              placeholder="Passphrase…"
              className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-3 py-2 focus:outline-none focus:border-vscode-accent"
            />
            <button
              disabled={encLoading || !encPassphrase}
              onClick={async () => {
                setEncLoading(true); setEncMsg(null);
                try {
                  await api.post("/encryption/disable", { passphrase: encPassphrase });
                  setEncEnabled(false);
                  setEncPassphrase("");
                  setEncMsg({ ok: true, text: "Chiffrement désactivé." });
                } catch {
                  setEncMsg({ ok: false, text: "Passphrase incorrecte." });
                } finally { setEncLoading(false); }
              }}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs px-4 py-1.5 rounded transition-colors"
            >
              {encLoading ? "Désactivation…" : "Désactiver le chiffrement"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
