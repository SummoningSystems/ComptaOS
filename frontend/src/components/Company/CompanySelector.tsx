import { useEffect, useRef, useState } from "react";
import { fetchCompanies, fetchActiveCompany, setActiveCompanyApi } from "../../api/client";
import { Company } from "../../types";

interface Props {
  onCreateNew: () => void;
}

export function CompanySelector({ onCreateNew }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [active, setActive] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([fetchCompanies(), fetchActiveCompany()]).then(([list, act]) => {
      setCompanies(list);
      setActive(act);
    });
  }, []);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function handleSwitch(id: string) {
    if (id === active?.id) {
      setOpen(false);
      return;
    }
    sessionStorage.setItem("comptaos:last-business-workspace", id);
    await setActiveCompanyApi(id);
    window.location.reload();
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-vscode-text bg-vscode-bg border border-vscode-border rounded px-2 py-0.5 hover:border-vscode-accent transition-colors max-w-44"
        title="Changer d'entreprise"
      >
        <span>🏛️</span>
        <span className="truncate flex-1 text-left">{active?.name ?? "…"}</span>
        <span className="text-vscode-muted shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-vscode-panel border border-vscode-border rounded shadow-xl z-50 py-1">
          <div className="px-3 py-1 text-[10px] text-vscode-muted uppercase tracking-wider">Entreprises</div>
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSwitch(c.id)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-vscode-bg transition-colors flex items-start gap-2 ${
                c.id === active?.id ? "text-vscode-accent" : "text-vscode-text"
              }`}
            >
              <span className="mt-0.5 w-3">{c.id === active?.id ? "✓" : ""}</span>
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-vscode-muted text-[10px]">
                  {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                </div>
              </div>
            </button>
          ))}

          <div className="border-t border-vscode-border mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); onCreateNew(); }}
              className="w-full text-left px-3 py-2 text-xs text-vscode-accent hover:bg-vscode-bg transition-colors"
            >
              + Nouvelle entreprise
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
