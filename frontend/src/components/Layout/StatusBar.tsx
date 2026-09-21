import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { useTheme } from "../../hooks/useTheme";
import { fetchGitSyncStatus, gitSyncPush, gitSyncPull, type GitSyncStatus } from "../../api/client";

export function StatusBar({ prototype = false }: { prototype?: boolean }) {
  const { tabs, activeTabId } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const { theme, toggle } = useTheme();

  const [sync, setSync] = useState<GitSyncStatus | null>(null);
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);

  async function loadSync() {
    try {
      const s = await fetchGitSyncStatus();
      setSync(s);
    } catch { /* silencieux */ }
  }

  useEffect(() => {
    if (prototype) return;
    loadSync();
    const id = setInterval(loadSync, 60_000); // Rafraîchit toutes les minutes
    return () => clearInterval(id);
  }, [prototype]);

  async function handlePush() {
    setSyncing("push");
    await gitSyncPush();
    setSyncing(null);
    loadSync();
  }

  async function handlePull() {
    setSyncing("pull");
    await gitSyncPull();
    setSyncing(null);
    loadSync();
  }

  return (
    <div className="flex items-center justify-between px-3 h-6 bg-vscode-accent text-white text-xs shrink-0 select-none">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-semibold">ComptaOS</span>
        {prototype && <span className="truncate">Prototype UX · données fictives · sauvegarde dans ce navigateur</span>}
        {!prototype && activeTab?.path && (
          <span className="text-blue-100 opacity-80">{activeTab.path}</span>
        )}
      </div>
      <div className="flex items-center gap-3 opacity-80 shrink-0">
        {/* Indicateur de synchronisation git */}
        {sync?.configured && (
          <span className="flex items-center gap-1.5">
            {syncing ? (
              <span className="animate-pulse">⏳</span>
            ) : (
              <>
                {sync.behind > 0 && (
                  <button
                    onClick={handlePull}
                    title={`${sync.behind} commit(s) disponible(s) — cliquer pour récupérer`}
                    className="flex items-center gap-0.5 hover:opacity-100 cursor-pointer text-orange-200"
                  >
                    ⬇ {sync.behind}
                  </button>
                )}
                {sync.ahead > 0 && (
                  <button
                    onClick={handlePush}
                    title={`${sync.ahead} commit(s) locaux — cliquer pour envoyer`}
                    className="flex items-center gap-0.5 hover:opacity-100 cursor-pointer text-blue-200"
                  >
                    ⬆ {sync.ahead}
                  </button>
                )}
                {sync.ahead === 0 && sync.behind === 0 && (
                  <span title="Synchronisé" className="text-green-200">✓ sync</span>
                )}
              </>
            )}
          </span>
        )}
        <button
          onClick={toggle}
          title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
          className="hover:opacity-100 transition-opacity cursor-pointer"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <span>UTF-8</span>
        <span>YAML</span>
      </div>
    </div>
  );
}
