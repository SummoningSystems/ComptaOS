import { useEffect, useId, useMemo, useState } from "react";
import { createPlatformPerson, createPlatformRelation, deletePlatformAccess, deletePlatformRelation, fetchPlatformState, setActiveCompanyApi, setPlatformAccess } from "../../api/client";
import { fetchUsers, type AuthUser } from "../../api/auth";
import type { PlatformAccessRole, PlatformAccount, PlatformEntity, PlatformPerson, PlatformRelationType, PlatformState } from "../../types";
import { useAppStore } from "../../stores/appStore";

type Node = PlatformPerson | PlatformEntity | PlatformAccount;

const relationLabels: Record<PlatformRelationType, string> = {
  family: "Famille", spouse: "Conjoint·e", parent: "Parent", child: "Enfant",
  accountant: "Comptable", advisor: "Conseiller", owner: "Associé / propriétaire",
  director: "Dirigeant", employee: "Salarié", beneficiary: "Bénéficiaire",
  shareholder: "Participation", subsidiary: "Filiale", management: "Gestion",
  holder: "Titulaire", uses: "Utilise", other: "Autre lien",
};

function NodeCard({ node, selected, dimmed, onSelect }: { node: Node; selected: boolean; dimmed?: boolean; onSelect: () => void }) {
  const meta = node.kind === "person"
    ? (node.profile === "professional" ? "Personne · activité professionnelle" : "Personne")
    : node.kind === "entity" ? "Entreprise" : `${node.provider ?? "Compte bancaire"}${node.maskedIdentifier ? ` · ${node.maskedIdentifier}` : ""}`;
  return (
    <button onClick={onSelect} className={`w-full rounded border p-4 text-left shadow-sm transition-all ${dimmed ? "opacity-35" : "opacity-100"} ${selected ? "border-vscode-accent bg-blue-950/30 ring-1 ring-vscode-accent" : "border-vscode-border bg-vscode-panel hover:border-vscode-accent/60 hover:bg-vscode-highlight"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 h-4 w-4 shrink-0 ${node.kind === "person" ? "rounded-full border-2 border-blue-500" : node.kind === "entity" ? "rotate-45 border-2 border-cyan-500" : "border-2 border-sky-500"}`} />
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-vscode-text">{node.name}</div><div className="mt-1 text-[11px] text-vscode-muted">{meta}</div></div>
      </div>
    </button>
  );
}

const graphColumns = [
  { kind: "person", label: "PERSONNES" },
  { kind: "entity", label: "ENTREPRISES ET STRUCTURES" },
  { kind: "account", label: "COMPTES BANCAIRES" },
] as const;

function relationAppearance(type: PlatformRelationType): { color: string; dash?: string } {
  if (["family", "spouse", "parent", "child", "beneficiary"].includes(type)) return { color: "#c084fc" };
  if (["owner", "shareholder", "subsidiary"].includes(type)) return { color: "#22d3ee" };
  if (["holder", "uses"].includes(type)) return { color: "#38bdf8", dash: type === "uses" ? "3 5" : undefined };
  if (["accountant", "advisor", "director", "employee", "management"].includes(type)) return { color: "#f59e0b", dash: "7 5" };
  return { color: "#94a3b8", dash: "4 4" };
}

export function StructureGraph({ nodes, state, selectedId, onSelect }: { nodes: Node[]; state: PlatformState; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const markerId = useId().replace(/:/g, "");
  const cardWidth = 280;
  const columnGap = 76;
  const rowGap = 112;
  const left = 28;
  const top = 54;
  const positions = new Map<string, { x: number; y: number }>();
  graphColumns.forEach((column, columnIndex) => {
    nodes.filter((node) => node.kind === column.kind).forEach((node, rowIndex) => {
      positions.set(node.id, { x: left + columnIndex * (cardWidth + columnGap), y: top + rowIndex * rowGap });
    });
  });
  const maxRows = Math.max(1, ...graphColumns.map((column) => nodes.filter((node) => node.kind === column.kind).length));
  const width = left * 2 + cardWidth * 3 + columnGap * 2;
  const height = Math.max(330, top + maxRows * rowGap + 30);
  const linked = new Set<string>(selectedId ? [selectedId] : []);
  if (selectedId) state.relations.filter((relation) => relation.fromId === selectedId || relation.toId === selectedId).forEach((relation) => { linked.add(relation.fromId); linked.add(relation.toId); });

  return (
    <div>
      <div className="overflow-auto rounded border border-vscode-border bg-[radial-gradient(circle,_var(--vscode-border)_0.7px,_transparent_0.8px)] bg-[length:18px_18px]">
        <div className="relative" style={{ width, height }}>
          <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-label="Carte des liens entre les personnes, entreprises et comptes">
            <defs>
              {Object.entries({ personal: "#c084fc", ownership: "#22d3ee", account: "#38bdf8", professional: "#f59e0b", other: "#94a3b8" }).map(([key, color]) => <marker key={key} id={`${markerId}-${key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker>)}
            </defs>
            {state.relations.map((relation, relationIndex) => {
              const from = positions.get(relation.fromId); const to = positions.get(relation.toId);
              if (!from || !to) return null;
              const appearance = relationAppearance(relation.type);
              const active = !selectedId || relation.fromId === selectedId || relation.toId === selectedId;
              const forward = from.x <= to.x;
              const sameColumn = Math.abs(from.x - to.x) < 10;
              const reversePair = state.relations.some((candidate) => candidate.id !== relation.id && candidate.fromId === relation.toId && candidate.toId === relation.fromId);
              let path: string; let labelX: number; let labelY: number;
              if (sameColumn) {
                const side = from.x + cardWidth + 34 + (relationIndex % 2) * 18;
                path = `M ${from.x + cardWidth} ${from.y + 36} C ${side} ${from.y + 36}, ${side} ${to.y + 36}, ${to.x + cardWidth} ${to.y + 36}`;
                labelX = side + 3; labelY = (from.y + to.y) / 2 + 30;
              } else {
                const startX = from.x + (forward ? cardWidth : 0); const endX = to.x + (forward ? 0 : cardWidth);
                const curve = reversePair ? (relation.fromId < relation.toId ? -24 : 24) : 0;
                path = `M ${startX} ${from.y + 36} C ${startX + (forward ? 58 : -58)} ${from.y + 36 + curve}, ${endX + (forward ? -58 : 58)} ${to.y + 36 + curve}, ${endX} ${to.y + 36}`;
                labelX = (startX + endX) / 2; labelY = (from.y + to.y) / 2 + 31 + curve;
              }
              const markerKey = ["family", "spouse", "parent", "child", "beneficiary"].includes(relation.type) ? "personal" : ["owner", "shareholder", "subsidiary"].includes(relation.type) ? "ownership" : ["holder", "uses"].includes(relation.type) ? "account" : ["accountant", "advisor", "director", "employee", "management"].includes(relation.type) ? "professional" : "other";
              return <g key={relation.id} opacity={active ? 1 : 0.18}>
                <path d={path} fill="none" stroke={appearance.color} strokeWidth={active && selectedId ? 2.6 : 1.7} strokeDasharray={appearance.dash} markerEnd={`url(#${markerId}-${markerKey})`}><title>{`${relationLabels[relation.type]} : ${nodes.find((node) => node.id === relation.fromId)?.name} → ${nodes.find((node) => node.id === relation.toId)?.name}`}</title></path>
                {active && <text x={labelX} y={labelY} textAnchor="middle" fill={appearance.color} stroke="var(--vscode-bg)" strokeWidth="5" paintOrder="stroke" className="text-[10px] font-semibold">{relationLabels[relation.type]}</text>}
              </g>;
            })}
          </svg>
          {graphColumns.map((column, index) => <div key={column.kind} className="absolute top-5 text-[10px] tracking-[0.16em] text-vscode-muted" style={{ left: left + index * (cardWidth + columnGap) }}>{column.label}</div>)}
          {nodes.map((node) => {
            const position = positions.get(node.id)!;
            return <div key={node.id} className="absolute" style={{ left: position.x, top: position.y, width: cardWidth }}><NodeCard node={node} selected={node.id === selectedId} dimmed={Boolean(selectedId && !linked.has(node.id))} onSelect={() => onSelect(node.id === selectedId ? null : node.id)} /></div>;
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-vscode-muted">
        <span className="text-purple-400">━ Liens personnels</span><span className="text-cyan-400">━ Propriété / participation</span><span className="text-sky-400">┄ Comptes et usages</span><span className="text-amber-400">┄ Liens professionnels</span><span>Les flèches indiquent le sens du lien.</span>
      </div>
    </div>
  );
}

export function StructureView({ currentUser }: { currentUser: AuthUser | null }) {
  const openTab = useAppStore((store) => store.openTab);
  const [state, setState] = useState<PlatformState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<"individual" | "professional">("individual");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [relationType, setRelationType] = useState<PlatformRelationType>("family");
  const [relationNotice, setRelationNotice] = useState<{ kind: "created" | "existing"; message: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [accessUserId, setAccessUserId] = useState("");
  const [accessScopeId, setAccessScopeId] = useState("");
  const [accessRole, setAccessRole] = useState<PlatformAccessRole>("viewer");
  const canAdminister = !currentUser || currentUser.role === "owner" || currentUser.role === "admin";

  useEffect(() => { fetchPlatformState().then(setState).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible")); }, []);
  useEffect(() => { if (canAdminister) fetchUsers().then(setUsers).catch(() => setUsers([])); }, [canAdminister]);
  const nodes = useMemo<Node[]>(() => state ? [...state.people, ...state.entities, ...state.accounts] : [], [state]);
  const selected = nodes.find((node) => node.id === selectedId);
  const relations = state?.relations.filter((relation) => !selectedId || relation.fromId === selectedId || relation.toId === selectedId) ?? [];
  const nodeName = (id: string) => nodes.find((node) => node.id === id)?.name ?? "Élément inconnu";

  async function addPerson() {
    if (!state || !name.trim()) return;
    setBusy(true); setError("");
    try { const next = await createPlatformPerson({ name: name.trim(), profile, expectedRevision: state.revision }); setState(next); setName(""); setSelectedId(next.people.at(-1)?.id ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); }
    finally { setBusy(false); }
  }

  async function addRelation() {
    if (!state || !fromId || !toId) return;
    setBusy(true); setError(""); setRelationNotice(null);
    try {
      const result = await createPlatformRelation({ fromId, toId, type: relationType, expectedRevision: state.revision });
      setState(result.state);
      setSelectedId(result.relation.fromId);
      setRelationNotice({
        kind: result.created ? "created" : "existing",
        message: result.created ? "Lien créé et affiché ci-dessous." : "Ce lien existe déjà ; il est affiché ci-dessous.",
      });
      if (result.created) { setFromId(""); setToId(""); }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Relation impossible"); }
    finally { setBusy(false); }
  }

  async function openEntity(entity: PlatformEntity) {
    setBusy(true);
    try { await setActiveCompanyApi(entity.workspaceId); window.location.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Ouverture impossible"); setBusy(false); }
  }

  async function saveAccess() {
    if (!state || !accessUserId || !accessScopeId) return;
    setBusy(true); setError("");
    try { setState(await setPlatformAccess({ userId: accessUserId, scopeId: accessScopeId, role: accessRole, expectedRevision: state.revision })); }
    catch (e) { setError(e instanceof Error ? e.message : "Autorisation impossible"); }
    finally { setBusy(false); }
  }

  if (!state) return <div className="flex h-full items-center justify-center text-sm text-vscode-muted">Chargement de la structure…</div>;

  return (
    <div className="h-full overflow-auto bg-vscode-bg">
      <header className="border-b border-vscode-border px-8 py-6">
        <div className="text-[10px] uppercase tracking-[0.22em] text-vscode-muted">Écosystème / vue d’ensemble</div>
        <h1 className="mt-2 text-2xl font-semibold text-vscode-text">Structure financière</h1>
        <p className="mt-2 max-w-3xl text-xs text-vscode-muted">Plusieurs personnes peuvent partager des liens familiaux, professionnels ou patrimoniaux et être reliées à plusieurs structures. Chaque entreprise conserve son espace ComptaOS complet.</p>
      </header>

      <div className="border-b border-vscode-border px-8 py-3 text-xs text-vscode-muted">
        <span className="text-vscode-text">{state.people.length} personne{state.people.length !== 1 ? "s" : ""}</span> · {state.entities.length} entreprise{state.entities.length !== 1 ? "s" : ""} · {state.accounts.length} compte{state.accounts.length !== 1 ? "s" : ""} · {state.relations.length} lien{state.relations.length !== 1 ? "s" : ""}
      </div>

      {error && <div className="mx-8 mt-4 rounded border border-red-700 bg-red-950/30 px-4 py-2 text-xs text-red-300">{error}</div>}

      <main className="grid gap-6 p-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded border border-vscode-border bg-black/10 p-5">
          <StructureGraph nodes={nodes} state={state} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <aside className="space-y-4">
          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Ajouter une personne</h2><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom ou libellé" className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs" /><select value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs"><option value="individual">Vie personnelle</option><option value="professional">Activité professionnelle</option></select><button disabled={busy || !name.trim()} onClick={() => void addPerson()} className="mt-3 w-full rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">+ Ajouter</button></section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Créer un lien</h2><p className="mt-1 text-[10px] text-vscode-muted">Famille, comptable, participation, direction ou titulaire d’un compte.</p><select value={fromId} onChange={(e) => { setFromId(e.target.value); setRelationNotice(null); }} className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Élément de départ…</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select value={relationType} onChange={(e) => { setRelationType(e.target.value as PlatformRelationType); setRelationNotice(null); }} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs">{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={toId} onChange={(e) => { setToId(e.target.value); setRelationNotice(null); }} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Élément d’arrivée…</option>{nodes.filter((node) => node.id !== fromId).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><button disabled={busy || !fromId || !toId} onClick={() => void addRelation()} className="mt-3 w-full rounded border border-vscode-accent px-3 py-2 text-xs text-vscode-accent disabled:opacity-40">{busy ? "Création…" : "Relier"}</button>{relationNotice && <p aria-live="polite" className={`mt-3 rounded border px-3 py-2 text-[11px] ${relationNotice.kind === "created" ? "border-green-700 bg-green-950/30 text-green-300" : "border-amber-700 bg-amber-950/30 text-amber-300"}`}>{relationNotice.message}</p>}</section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Droits du portefeuille</h2><p className="mt-1 text-[10px] text-vscode-muted">Attribue séparément chaque personne ou entreprise à un utilisateur.</p><select value={accessUserId} onChange={(e) => setAccessUserId(e.target.value)} className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Utilisateur…</option>{users.filter((user) => user.role !== "owner" && user.role !== "admin").map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select><select value={accessScopeId} onChange={(e) => setAccessScopeId(e.target.value)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Périmètre…</option>{[...state.people, ...state.entities].map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select value={accessRole} onChange={(e) => setAccessRole(e.target.value as PlatformAccessRole)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="viewer">Lecture seule</option><option value="manager">Gestionnaire / comptable</option><option value="owner">Responsable du périmètre</option></select><button disabled={busy || !accessUserId || !accessScopeId} onClick={() => void saveAccess()} className="mt-3 w-full rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Attribuer l’accès</button><div className="mt-3 space-y-1">{state.grants.map((grant) => <div key={grant.id} className="flex items-center gap-2 rounded border border-vscode-border px-2 py-1 text-[10px]"><span className="min-w-0 flex-1 truncate">{users.find((user) => user.id === grant.userId)?.displayName ?? grant.userId} · {nodeName(grant.scopeId)} · {grant.role === "viewer" ? "lecture" : grant.role === "manager" ? "gestion" : "responsable"}</span><button className="text-vscode-muted hover:text-red-400" onClick={() => void deletePlatformAccess(grant.id, state.revision).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Suppression impossible"))}>×</button></div>)}</div></section>}
        </aside>
      </main>

      <section className="mx-8 mb-8 rounded border border-vscode-border bg-vscode-panel p-5">
        <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">{selected ? selected.name : "Relations de la structure"}</h2><p className="mt-1 text-[11px] text-vscode-muted">{selected?.kind === "person" ? "Ses comptes, mouvements, catégories et budgets personnels restent séparés des entreprises." : "Sélectionne un élément pour isoler ses relations."}</p></div><div className="flex gap-2">{selected?.kind === "person" && <button onClick={() => openTab({ id: `personal:${selected.id}`, title: selected.name, type: "personal", path: `person=${encodeURIComponent(selected.id)}` })} className="rounded bg-vscode-accent px-4 py-2 text-xs font-semibold text-white">Ouvrir l’espace personnel →</button>}{selected?.kind === "entity" && <button disabled={busy} onClick={() => void openEntity(selected)} className="rounded bg-vscode-accent px-4 py-2 text-xs font-semibold text-white">Ouvrir l’espace comptable →</button>}</div></div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">{relations.map((relation) => <div key={relation.id} className="flex items-center gap-2 rounded border border-vscode-border px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{nodeName(relation.fromId)} <span className="text-vscode-accent">— {relationLabels[relation.type]} →</span> {nodeName(relation.toId)}</span>{canAdminister && relation.source === "manual" && <button title="Supprimer le lien" className="text-vscode-muted hover:text-red-400" onClick={() => state && void deletePlatformRelation(relation.id, state.revision).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Suppression impossible"))}>×</button>}</div>)}{relations.length === 0 && <p className="text-xs text-vscode-muted">Aucun lien à afficher.</p>}</div>
      </section>
    </div>
  );
}
