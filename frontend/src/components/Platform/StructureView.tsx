import { useEffect, useMemo, useState } from "react";
import { createPlatformPerson, createPlatformRelation, deletePlatformAccess, deletePlatformRelation, fetchPlatformState, setActiveCompanyApi, setPlatformAccess } from "../../api/client";
import { fetchUsers, type AuthUser } from "../../api/auth";
import type { PlatformAccessRole, PlatformAccount, PlatformEntity, PlatformPerson, PlatformRelationType, PlatformState } from "../../types";

type Node = PlatformPerson | PlatformEntity | PlatformAccount;

const relationLabels: Record<PlatformRelationType, string> = {
  family: "Famille", spouse: "Conjoint·e", parent: "Parent", child: "Enfant",
  accountant: "Comptable", advisor: "Conseiller", owner: "Associé / propriétaire",
  director: "Dirigeant", employee: "Salarié", beneficiary: "Bénéficiaire",
  shareholder: "Participation", subsidiary: "Filiale", management: "Gestion",
  holder: "Titulaire", uses: "Utilise", other: "Autre lien",
};

function NodeCard({ node, selected, onSelect }: { node: Node; selected: boolean; onSelect: () => void }) {
  const meta = node.kind === "person"
    ? (node.profile === "professional" ? "Personne · activité professionnelle" : "Personne")
    : node.kind === "entity" ? "Entreprise" : `${node.provider ?? "Compte bancaire"}${node.maskedIdentifier ? ` · ${node.maskedIdentifier}` : ""}`;
  return (
    <button onClick={onSelect} className={`w-full rounded border p-4 text-left transition-colors ${selected ? "border-vscode-accent bg-blue-950/30" : "border-vscode-border bg-vscode-panel hover:border-vscode-accent/60"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 h-4 w-4 shrink-0 ${node.kind === "person" ? "rounded-full border-2 border-blue-500" : node.kind === "entity" ? "rotate-45 border-2 border-cyan-500" : "border-2 border-sky-500"}`} />
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-vscode-text">{node.name}</div><div className="mt-1 text-[11px] text-vscode-muted">{meta}</div></div>
      </div>
    </button>
  );
}

export function StructureView({ currentUser }: { currentUser: AuthUser | null }) {
  const [state, setState] = useState<PlatformState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<"individual" | "professional">("individual");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [relationType, setRelationType] = useState<PlatformRelationType>("family");
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
    setBusy(true); setError("");
    try { setState(await createPlatformRelation({ fromId, toId, type: relationType, expectedRevision: state.revision })); }
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
        <section className="rounded border border-vscode-border bg-black/10 p-6">
          <div className="grid gap-8 md:grid-cols-3">
            <div><h2 className="mb-4 text-[10px] uppercase tracking-[0.18em] text-vscode-muted">Personnes</h2><div className="space-y-3">{state.people.map((node) => <NodeCard key={node.id} node={node} selected={node.id === selectedId} onSelect={() => setSelectedId(node.id)} />)}{state.people.length === 0 && <p className="text-xs text-vscode-muted">Ajoute la première personne du portefeuille ou de la famille.</p>}</div></div>
            <div><h2 className="mb-4 text-[10px] uppercase tracking-[0.18em] text-vscode-muted">Entreprises et structures</h2><div className="space-y-3">{state.entities.map((node) => <NodeCard key={node.id} node={node} selected={node.id === selectedId} onSelect={() => setSelectedId(node.id)} />)}</div></div>
            <div><h2 className="mb-4 text-[10px] uppercase tracking-[0.18em] text-vscode-muted">Comptes bancaires</h2><div className="space-y-3">{state.accounts.map((node) => <NodeCard key={node.id} node={node} selected={node.id === selectedId} onSelect={() => setSelectedId(node.id)} />)}{state.accounts.length === 0 && <p className="text-xs text-vscode-muted">Les comptes PSD2 apparaîtront ici automatiquement.</p>}</div></div>
          </div>
        </section>

        <aside className="space-y-4">
          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Ajouter une personne</h2><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom ou libellé" className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs" /><select value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs"><option value="individual">Vie personnelle</option><option value="professional">Activité professionnelle</option></select><button disabled={busy || !name.trim()} onClick={() => void addPerson()} className="mt-3 w-full rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">+ Ajouter</button></section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Créer un lien</h2><p className="mt-1 text-[10px] text-vscode-muted">Famille, comptable, participation, direction ou titulaire d’un compte.</p><select value={fromId} onChange={(e) => setFromId(e.target.value)} className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Élément de départ…</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select value={relationType} onChange={(e) => setRelationType(e.target.value as PlatformRelationType)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs">{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={toId} onChange={(e) => setToId(e.target.value)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Élément d’arrivée…</option>{nodes.filter((node) => node.id !== fromId).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><button disabled={busy || !fromId || !toId} onClick={() => void addRelation()} className="mt-3 w-full rounded border border-vscode-accent px-3 py-2 text-xs text-vscode-accent disabled:opacity-40">Relier</button></section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Droits du portefeuille</h2><p className="mt-1 text-[10px] text-vscode-muted">Attribue séparément chaque personne ou entreprise à un utilisateur.</p><select value={accessUserId} onChange={(e) => setAccessUserId(e.target.value)} className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Utilisateur…</option>{users.filter((user) => user.role !== "owner" && user.role !== "admin").map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select><select value={accessScopeId} onChange={(e) => setAccessScopeId(e.target.value)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Périmètre…</option>{[...state.people, ...state.entities].map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select value={accessRole} onChange={(e) => setAccessRole(e.target.value as PlatformAccessRole)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="viewer">Lecture seule</option><option value="manager">Gestionnaire / comptable</option><option value="owner">Responsable du périmètre</option></select><button disabled={busy || !accessUserId || !accessScopeId} onClick={() => void saveAccess()} className="mt-3 w-full rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Attribuer l’accès</button><div className="mt-3 space-y-1">{state.grants.map((grant) => <div key={grant.id} className="flex items-center gap-2 rounded border border-vscode-border px-2 py-1 text-[10px]"><span className="min-w-0 flex-1 truncate">{users.find((user) => user.id === grant.userId)?.displayName ?? grant.userId} · {nodeName(grant.scopeId)} · {grant.role === "viewer" ? "lecture" : grant.role === "manager" ? "gestion" : "responsable"}</span><button className="text-vscode-muted hover:text-red-400" onClick={() => void deletePlatformAccess(grant.id, state.revision).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Suppression impossible"))}>×</button></div>)}</div></section>}
        </aside>
      </main>

      <section className="mx-8 mb-8 rounded border border-vscode-border bg-vscode-panel p-5">
        <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">{selected ? selected.name : "Relations de la structure"}</h2><p className="mt-1 text-[11px] text-vscode-muted">{selected?.kind === "person" ? "La comptabilité personnelle détaillée sera ajoutée dans la tranche suivante." : "Sélectionne un élément pour isoler ses relations."}</p></div>{selected?.kind === "entity" && <button disabled={busy} onClick={() => void openEntity(selected)} className="rounded bg-vscode-accent px-4 py-2 text-xs font-semibold text-white">Ouvrir l’espace comptable →</button>}</div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">{relations.map((relation) => <div key={relation.id} className="flex items-center gap-2 rounded border border-vscode-border px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{nodeName(relation.fromId)} <span className="text-vscode-accent">— {relationLabels[relation.type]} →</span> {nodeName(relation.toId)}</span>{canAdminister && relation.source === "manual" && <button title="Supprimer le lien" className="text-vscode-muted hover:text-red-400" onClick={() => state && void deletePlatformRelation(relation.id, state.revision).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Suppression impossible"))}>×</button>}</div>)}{relations.length === 0 && <p className="text-xs text-vscode-muted">Aucun lien à afficher.</p>}</div>
      </section>
    </div>
  );
}
