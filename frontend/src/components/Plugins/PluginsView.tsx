import {useCallback} from "react";
import { useEffect, useState } from "react";
import {useWorkspaceApi} from '../../api/WorkspaceApi';

interface Plugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  hooks: string[];
  enabled: boolean;
}

export function PluginsView() {
 const {api}=useWorkspaceApi();

  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasting, setToasting] = useState<string | null>(null);

  const load=useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Plugin[]>("/plugins");
      setPlugins(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function toggle(plugin: Plugin) {
    const action = plugin.enabled ? "disable" : "enable";
    await api.post(`/plugins/${encodeURIComponent(plugin.name)}/${action}`);
    setToasting(plugin.enabled ? `Plugin "${plugin.name}" désactivé` : `Plugin "${plugin.name}" activé`);
    setTimeout(() => setToasting(null), 2500);
    load();
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-vscode-text">Plugins</h2>
        <p className="text-xs text-vscode-muted mt-1">
          Les plugins étendent ComptaOS avec des hooks personnalisés. Placez vos plugins dans{" "}
          <code className="bg-vscode-panel px-1 rounded font-mono">workspace/plugins/</code>.
        </p>
      </div>

      {/* Toast */}
      {toasting && (
        <div className="fixed top-4 right-4 z-50 bg-green-700 text-white text-xs px-4 py-2 rounded shadow-lg">
          {toasting}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-vscode-muted">Chargement…</p>
      ) : plugins.length === 0 ? (
        <div className="border border-dashed border-vscode-border rounded p-8 text-center text-vscode-muted text-sm">
          Aucun plugin trouvé.<br />
          <span className="text-xs mt-1 block">Un plugin exemple a été créé dans <code className="font-mono">workspace/plugins/example-plugin/</code>.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map((p) => (
            <div
              key={p.name}
              className="border border-vscode-border rounded p-4 flex items-start gap-4 bg-vscode-panel/50"
            >
              <div className="text-2xl mt-0.5">🧩</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-vscode-text">{p.name}</span>
                  <span className="text-[10px] text-vscode-muted border border-vscode-border rounded px-1">v{p.version}</span>
                  {p.author && <span className="text-[10px] text-vscode-muted">par {p.author}</span>}
                </div>
                <p className="text-xs text-vscode-muted mt-1">{p.description}</p>
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {p.hooks.map((h) => (
                    <span key={h} className="text-[10px] bg-blue-900/40 text-blue-300 border border-blue-800/50 rounded px-1.5 py-0.5">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => toggle(p)}
                className={`text-xs px-3 py-1.5 rounded border transition-colors shrink-0 ${
                  p.enabled
                    ? "bg-green-800/30 border-green-700/50 text-green-300 hover:bg-red-800/30 hover:border-red-700/50 hover:text-red-300"
                    : "bg-vscode-bg border-vscode-border text-vscode-muted hover:bg-vscode-accent/20 hover:text-vscode-text"
                }`}
              >
                {p.enabled ? "✓ Activé" : "Activer"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Documentation */}
      <details className="border border-vscode-border rounded">
        <summary className="px-4 py-3 cursor-pointer text-xs text-vscode-muted hover:text-vscode-text select-none">
          📖 Comment créer un plugin ?
        </summary>
        <div className="px-4 pb-4 space-y-2 text-xs text-vscode-muted">
          <p>1. Créez un dossier <code className="font-mono bg-vscode-panel px-1 rounded">workspace/plugins/mon-plugin/</code></p>
          <p>2. Ajoutez un fichier <code className="font-mono bg-vscode-panel px-1 rounded">manifest.json</code> :</p>
          <pre className="bg-vscode-bg rounded p-3 font-mono text-[11px] overflow-x-auto">{`{
  "name": "mon-plugin",
  "version": "1.0.0",
  "description": "Ma description",
  "hooks": ["hook-transaction"],
  "enabled": false
}`}</pre>
          <p>3. Ajoutez <code className="font-mono bg-vscode-panel px-1 rounded">plugin.cjs</code> (CommonJS) :</p>
          <pre className="bg-vscode-bg rounded p-3 font-mono text-[11px] overflow-x-auto">{`exports["hook-transaction"] = function(transaction) {
  // modifier la transaction
  return transaction;
};`}</pre>
          <p className="text-yellow-400/80">⚠ Les plugins s'exécutent dans une sandbox Node.js (vm). Accès limité : pas de require, pas de fs, timeout 2s.</p>
        </div>
      </details>
    </div>
  );
}
