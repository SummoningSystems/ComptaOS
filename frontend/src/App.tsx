import { useEffect, useState, Component, lazy, Suspense, type ReactNode } from "react";
import { api, fetchCompanies } from "./api/client";
import { Sidebar, type SidebarSection } from "./components/Layout/Sidebar";
import { TabBar } from "./components/Layout/TabBar";
import { StatusBar } from "./components/Layout/StatusBar";
import { CopilotPanel } from "./components/Copilot/CopilotPanel";
import { SearchOverlay } from "./components/Search/SearchOverlay";
import { CommandPalette } from "./components/Layout/CommandPalette";
import { OnboardingWizard } from "./components/Onboarding/OnboardingWizard";
import { useAppStore } from "./stores/appStore";
import { CompanySelector } from "./components/Company/CompanySelector";
import { LoginView } from "./components/Auth/LoginView";
import { SetupView } from "./components/Auth/SetupView";
import { AcceptInviteView } from "./components/Auth/AcceptInviteView";
import { fetchAuthStatus, fetchMe, logout, type AuthUser } from "./api/auth";
import type { TabType } from "./types";
import { MobileCaptureView } from "./components/Mobile/MobileCaptureView";

const FileEditor = lazy(() => import("./components/Editor/FileEditor").then((m) => ({ default: m.FileEditor })));
const Dashboard = lazy(() => import("./components/Dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const ImportView = lazy(() => import("./components/Import/ImportView").then((m) => ({ default: m.ImportView })));
const PdfImporter = lazy(() => import("./components/Import/PdfImporter").then((m) => ({ default: m.PdfImporter })));
const TransactionsView = lazy(() => import("./components/Transactions/TransactionsView").then((m) => ({ default: m.TransactionsView })));
const ReportsView = lazy(() => import("./components/Reports/ReportsView").then((m) => ({ default: m.ReportsView })));
const RecurringView = lazy(() => import("./components/Recurring/RecurringView").then((m) => ({ default: m.RecurringView })));
const SettingsView = lazy(() => import("./components/Settings/SettingsView").then((m) => ({ default: m.SettingsView })));
const InvoicesView = lazy(() => import("./components/Invoices/InvoicesView").then((m) => ({ default: m.InvoicesView })));
const QuotesView = lazy(() => import("./components/Quotes/QuotesView").then((m) => ({ default: m.QuotesView })));
const TiersView = lazy(() => import("./components/Tiers/TiersView").then((m) => ({ default: m.TiersView })));
const VatView = lazy(() => import("./components/Vat/VatView").then((m) => ({ default: m.VatView })));
const BudgetsView = lazy(() => import("./components/Budgets/BudgetsView").then((m) => ({ default: m.BudgetsView })));
const SpreadsheetView = lazy(() => import("./components/Spreadsheet/SpreadsheetView").then((m) => ({ default: m.SpreadsheetView })));
const HistoryView = lazy(() => import("./components/History/HistoryView").then((m) => ({ default: m.HistoryView })));
const JournalView = lazy(() => import("./components/Journal/JournalView").then((m) => ({ default: m.JournalView })));
const AlertsView = lazy(() => import("./components/Alerts/AlertsView").then((m) => ({ default: m.AlertsView })));
const ClosingView = lazy(() => import("./components/Closing/ClosingView").then((m) => ({ default: m.ClosingView })));
const TemplatesView = lazy(() => import("./components/Templates/TemplatesView").then((m) => ({ default: m.TemplatesView })));
const ReconcileView = lazy(() => import("./components/Reconcile/ReconcileView").then((m) => ({ default: m.ReconcileView })));
const TreasuryView = lazy(() => import("./components/Treasury/TreasuryView").then((m) => ({ default: m.TreasuryView })));
const ExportView = lazy(() => import("./components/Export/ExportView").then((m) => ({ default: m.ExportView })));
const ProfitLossView = lazy(() => import("./components/ProfitLoss/ProfitLossView").then((m) => ({ default: m.ProfitLossView })));
const PluginsView = lazy(() => import("./components/Plugins/PluginsView").then((m) => ({ default: m.PluginsView })));
const PricingView = lazy(() => import("./components/Pricing/PricingView").then((m) => ({ default: m.PricingView })));
const BankingView = lazy(() => import("./components/Banking/BankingView").then((m) => ({ default: m.BankingView })));
const UsersView = lazy(() => import("./components/Auth/UsersView").then((m) => ({ default: m.UsersView })));
const HrView = lazy(() => import("./components/Hr/HrView").then((m) => ({ default: m.HrView })));

function ViewLoading() {
  return <div className="flex h-full items-center justify-center text-sm text-vscode-muted">Chargement de la vue…</div>;
}

const TAB_LABELS: Record<TabType, string> = {
  dashboard:    "Dashboard",
  editor:       "Éditeur",
  import:       "Import",
  transactions: "Transactions",
  ocr:          "OCR PDF",
  reports:      "Rapports",
  recurring:    "Frais récurrents",
  invoices:     "Factures",
  quotes:       "Devis",
  settings:     "Paramètres",
  tiers:        "Tiers",
  vat:          "TVA",
  budgets:      "Budgets",
  spreadsheets: "Tableaux",
  history:      "Historique",
  journal:      "Journal",
  alerts:       "À traiter",
  closing:      "Clôture mensuelle",
  templates:    "Modèles",
  reconcile:    "Rapprochement",
  treasury:     "Trésorerie",
  export:       "Export",
  profitloss:   "Bilan / P&L",
  plugins:      "Plugins",
  pricing:      "Plans & Licence",
  banking:      "Connexion bancaire",
  users:        "Utilisateurs",
  hr:           "RH & Paie",
};

// ── ErrorBoundary — empêche les pages blanches sur crash d'un composant ──────
class ViewErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-vscode-muted">
          <span className="text-3xl">⚠️</span>
          <p className="text-sm text-red-400">Erreur dans cette vue</p>
          <p className="text-xs text-vscode-muted max-w-md text-center">{this.state.error}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs text-vscode-accent hover:underline mt-2"
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Rendu d'une vue par son type (partagé fenêtre principale + popup) */
function ViewContent({ type, tabId, path, currentUser }: { type: TabType; tabId?: string; path?: string; currentUser: AuthUser | null }) {
  const params = new URLSearchParams(path ?? "");
  const workFilter = params.get("filter") ?? path;
  const contextMonth = params.get("month") ?? undefined;
  return (
    <Suspense fallback={<ViewLoading />}>
      {type === "dashboard"    && <Dashboard />}
      {type === "editor"       && tabId && path && <FileEditor key={tabId} tabId={tabId} path={path} />}
      {type === "import"       && <ImportView />}
      {type === "ocr"          && <PdfImporter />}
      {type === "transactions" && <TransactionsView workFilter={workFilter as "unjustified" | "misc" | "pending" | "duplicates" | "receipt-inbox" | undefined} month={contextMonth} />}
      {type === "reports"      && <ReportsView />}
      {type === "recurring"    && <RecurringView />}
      {type === "invoices"     && <InvoicesView />}
      {type === "quotes"       && <QuotesView />}
      {type === "settings"     && <SettingsView />}
      {type === "tiers"        && <TiersView />}
      {type === "vat"          && <VatView />}
      {type === "budgets"      && <BudgetsView />}
      {type === "spreadsheets" && <SpreadsheetView />}
      {type === "history"      && <HistoryView />}
      {type === "journal"      && <JournalView />}
      {type === "alerts"       && <AlertsView />}
      {type === "closing"      && <ClosingView />}
      {type === "templates"    && <TemplatesView />}
      {type === "reconcile"    && <ReconcileView initialMonth={contextMonth} />}
      {type === "treasury"     && <TreasuryView />}
      {type === "export"       && <ExportView />}
      {type === "profitloss"   && <ProfitLossView />}
      {type === "plugins"       && <PluginsView />}
      {type === "pricing"       && <PricingView />}
      {type === "banking"       && <BankingView />}
      {type === "users"         && currentUser && <UsersView currentUser={currentUser} />}
      {type === "hr"            && <HrView />}
    </Suspense>
  );
}

export default function App() {
  // ── TOUS les hooks en premier (Rules of Hooks) ────────────────────────────
  type AuthState = "loading" | "setup" | "login" | "invite" | "app";
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("compta");
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [showAlertDrop, setShowAlertDrop] = useState(false);
  const [alertMessages, setAlertMessages] = useState<{ level: string; message: string }[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [showCompanyWizard, setShowCompanyWizard] = useState(false);
  const [wizardCanCancel, setWizardCanCancel] = useState(false);
  const [showMobileCapture, setShowMobileCapture] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mobile") === "1" || (params.get("desktop") !== "1" && window.matchMedia("(max-width: 767px)").matches);
  });
  const { tabs, activeTabId, openTab } = useAppStore();

  useEffect(() => {
    // Détecter un lien d'invitation dans l'URL
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      setInviteToken(invite);
      setAuthState("invite");
      return;
    }
    void checkAuth();
  }, []);

  useEffect(() => {
    if (authState !== "app") return;
    api.get<{ alerts: { level: string; message: string }[]; count: number }>("/alerts")
      .then(({ data }) => { setAlertCount(data.count); setAlertMessages(data.alerts.slice(0, 5)); })
      .catch(() => {});
    api.get<import("./types").Transaction[]>("/transactions")
      .then(({ data }) => setPendingCount(data.filter((t) => t.status === "pending").length))
      .catch(() => {});
    // Ouvrir automatiquement le wizard si aucune entreprise (non annulable)
    fetchCompanies().then((list) => {
      if (list.length === 0) {
        setWizardCanCancel(false);
        setShowCompanyWizard(true);
      }
    });
  }, [authState]);

  // Raccourci Ctrl+K / Cmd+K → ouvre la recherche globale
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // ── Fonctions ─────────────────────────────────────────────────────────────
  async function checkAuth() {
    try {
      const status = await fetchAuthStatus();
      if (!status.authEnabled) { setAuthState("app"); return; }
      if (status.needsSetup) { setAuthState("setup"); return; }
      const user = await fetchMe();
      setCurrentUser(user);
      setAuthState("app");
    } catch {
      setAuthState("login");
    }
  }

  async function handleLogout() {
    await logout().catch(() => {});
    setCurrentUser(null);
    setAuthState("login");
    setShowUserMenu(false);
  }

  function handleSectionChange(section: SidebarSection) {
    setSidebarSection(section);
  }

  // ── Retours conditionnels (après tous les hooks) ──────────────────────────
  if (authState === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-vscode-bg">
        <span className="text-vscode-muted text-sm">Chargement…</span>
      </div>
    );
  }

  if (authState === "invite" && inviteToken) {
    return (
      <AcceptInviteView
        token={inviteToken}
        onAccepted={(user) => { setCurrentUser(user); setInviteToken(null); setAuthState("app"); }}
      />
    );
  }

  if (authState === "setup") {
    return <SetupView onSetup={(user) => { setCurrentUser(user); setAuthState("app"); }} />;
  }

  if (authState === "login") {
    return <LoginView onLogin={(user) => { setCurrentUser(user); setAuthState("app"); }} />;
  }

  // ── Mode fenêtre autonome (?view=<type>) ──────────────────────────────────
  const standaloneView = new URLSearchParams(window.location.search).get("view") as TabType | null;
  if (standaloneView && standaloneView in TAB_LABELS) {
    return (
      <div className="flex flex-col h-screen bg-vscode-bg text-vscode-text">
        <div className="flex items-center justify-between px-3 h-8 bg-vscode-panel border-b border-vscode-border shrink-0 select-none">
          <span className="text-xs text-vscode-muted font-semibold">
            ComptaOS — {TAB_LABELS[standaloneView]}
          </span>
          <button
            onClick={() => window.close()}
            className="text-xs text-vscode-muted hover:text-red-400 transition-colors"
            title="Fermer la fenêtre"
          >✕ Fermer</button>
        </div>
        <div className="flex-1 min-h-0">
          <ViewContent type={standaloneView} currentUser={currentUser} />
        </div>
      </div>
    );
  }

  if (showMobileCapture) {
    return <MobileCaptureView onOpenDesktop={() => setShowMobileCapture(false)} onLogout={currentUser ? handleLogout : undefined} />;
  }

  return (
    <div className="flex flex-col h-screen bg-vscode-bg text-vscode-text">
      {showCompanyWizard && (
        <OnboardingWizard
          onDone={() => { setShowCompanyWizard(false); window.location.reload(); }}
          onCancel={wizardCanCancel ? () => setShowCompanyWizard(false) : undefined}
        />
      )}
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 h-10 bg-vscode-panel border-b border-vscode-border shrink-0 select-none">
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-vscode-muted font-semibold tracking-wide">ComptaOS</span>
          <CompanySelector onCreateNew={() => { setWizardCanCancel(true); setShowCompanyWizard(true); }} />
        </div>
        <div className="flex-1" />
        {/* Actions fixes */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="text-xs text-vscode-muted hover:text-vscode-text transition-colors border border-vscode-border rounded px-2 py-0.5"
            title="Recherche globale (Ctrl+K)"
          >
            🔍 Ctrl+K
          </button>
          {/* Bell alertes */}
          <div className="relative">
            <button
              onClick={() => { setShowAlertDrop((o) => !o); }}
              className="text-xs text-vscode-muted hover:text-vscode-text transition-colors relative"
              title="Alertes"
            >
              🔔
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </button>
            {showAlertDrop && alertMessages.length > 0 && (
              <div className="absolute right-0 top-6 z-50 w-80 bg-vscode-panel border border-vscode-border rounded-lg shadow-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-vscode-border">
                  <span className="text-[11px] font-semibold text-vscode-text">Alertes ({alertCount})</span>
                  <button onClick={() => { openTab({ id: "alerts", title: "Alertes", type: "alerts" }); setShowAlertDrop(false); }} className="text-[10px] text-vscode-accent hover:underline">Tout voir →</button>
                </div>
                {alertMessages.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 border-b border-vscode-border/50 text-[11px]">
                    <span>{a.level === "error" ? "🔴" : a.level === "warn" ? "🟡" : "🔵"}</span>
                    <span className="text-vscode-text">{a.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setCopilotOpen((o) => !o)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${copilotOpen ? "bg-purple-700 text-white" : "text-purple-400 hover:text-purple-300"}`}
          >
            ✨ Copilote
          </button>
          {/* Menu utilisateur */}
          {currentUser && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu((o) => !o)}
                className="text-xs flex items-center gap-1.5 text-vscode-muted hover:text-vscode-text transition-colors border border-vscode-border rounded px-2 py-0.5"
                title="Compte utilisateur"
              >
                👤 {currentUser.displayName}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-6 z-50 w-52 bg-vscode-panel border border-vscode-border rounded-lg shadow-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-vscode-border">
                    <p className="text-xs font-semibold text-vscode-text">{currentUser.displayName}</p>
                    <p className="text-[10px] text-vscode-muted">{currentUser.username} · {currentUser.role}</p>
                  </div>
                  {(currentUser.role === "owner" || currentUser.role === "admin") && (
                    <button
                      onClick={() => { openTab({ id: "users", title: "Utilisateurs", type: "users" }); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-vscode-text hover:bg-vscode-bg transition-colors"
                    >
                      👥 Gérer les utilisateurs
                    </button>
                  )}
                  <button
                    onClick={() => { void handleLogout(); }}
                    className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
                  >
                    🚪 Se déconnecter
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        <Sidebar activeSection={sidebarSection} onSectionChange={handleSectionChange} pendingCount={pendingCount} />

        <div className="flex flex-col flex-1 min-w-0">
          <TabBar />

          <div className="flex-1 min-h-0">
            <ViewErrorBoundary key={activeTab?.id ?? "empty"}>
              {activeTab
                ? <ViewContent type={activeTab.type} tabId={activeTab.id} path={(activeTab as { path?: string }).path} currentUser={currentUser} />
                : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-vscode-muted select-none">
                    <span className="text-4xl">📊</span>
                    <span className="text-sm">Bienvenue dans ComptaOS</span>
                    <span className="text-xs">Ouvrez un fichier ou naviguez dans le workspace</span>
                  </div>
                )
              }
            </ViewErrorBoundary>
          </div>
        </div>
      </div>

      <StatusBar />
      <CommandPalette />
      <CopilotPanel open={copilotOpen} onClose={() => setCopilotOpen(false)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
