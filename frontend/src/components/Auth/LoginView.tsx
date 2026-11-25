import { useState } from "react";
import { login, type AuthUser } from "../../api/auth";

interface Props {
  onLogin: (user: AuthUser) => void;
}

export function LoginView({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) { setError("Identifiants requis."); return; }
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      onLogin(user);
    } catch {
      setError("Identifiants incorrects ou compte inactif.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-vscode-bg">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={`${import.meta.env.BASE_URL}comptaos.svg`} alt="" width={56} height={56} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-vscode-text">ComptaOS</h1>
          <p className="text-sm text-vscode-muted mt-1">Connectez-vous pour continuer</p>
        </div>

        <div className="bg-vscode-sidebar border border-vscode-border rounded-xl p-8 shadow-xl">
          <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs text-vscode-muted mb-1">Nom d'utilisateur</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Votre identifiant"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-vscode-accent"
                autoFocus
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-vscode-muted mb-1">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-vscode-accent"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 text-red-300 text-xs rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full bg-vscode-accent text-white text-sm font-semibold rounded-lg px-4 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
