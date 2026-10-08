import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createCompanyApi, createPlatformHousehold, createPlatformPerson, createPlatformRelation, deletePlatformAccess, deletePlatformRelation, ensureAccountingDossier, fetchAccountingDossiers, fetchActiveCompany, fetchPlatformLayout, fetchPlatformState, fetchStructureIssues, savePlatformLayout, setActiveCompanyApi, setPlatformAccess, updatePlatformEntity, updatePlatformRelation } from "../../api/client";
import { fetchUsers, type AuthUser } from "../../api/auth";
import type { AccountingDossier, PlatformAccessRole, PlatformAccount, PlatformEntity, PlatformFiscalPeriod, PlatformHousehold, PlatformLayout, PlatformLegalType, PlatformPerson, PlatformRelation, PlatformRelationType, PlatformState, StructureIssue } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { LocalizedNumberInput } from "../Common/LocalizedNumberInput";

type Node = PlatformPerson | PlatformHousehold | PlatformEntity | PlatformAccount;

const relationLabels: Record<PlatformRelationType, string> = {
  family: "Famille", spouse: "Conjoint·e", parent: "Parent", child: "Enfant", member: "Membre du foyer",
  accountant: "Comptable", advisor: "Conseiller", owner: "Associé / propriétaire",
  director: "Dirigeant", employee: "Salarié", beneficiary: "Bénéficiaire",
  shareholder: "Participation", subsidiary: "Filiale", management: "Gestion",
  holder: "Titulaire", uses: "Utilise", other: "Autre lien",
};
const legalTypeLabels: Record<PlatformLegalType, string> = { company: "Société / entreprise", sci: "SCI", holding: "Holding", association: "Association", sole_proprietorship: "Entreprise individuelle", other: "Autre structure" };
const taxRegimeLabels = { is: "Impôt sur les sociétés", ir: "Impôt sur le revenu", micro: "Régime micro", non_profit: "Non lucratif", other: "Autre régime" } as const;
const vatRegimeLabels = { franchise: "Franchise en base", monthly_ca3: "Réel normal · CA3 mensuelle", quarterly_ca3: "CA3 trimestrielle", simplified_ca12: "Réel simplifié · CA12" } as const;
const financialLinkLabels = { none: "Aucun financement associé", shareholder_current_account: "Compte courant d’associé", intercompany_loan: "Prêt associé au lien" } as const;

function NodeCard({ node, dossier, selected, dimmed, onSelect }: { node: Node; dossier?: AccountingDossier; selected: boolean; dimmed?: boolean; onSelect: () => void }) {
  const meta = node.kind === "person"
    ? (node.profile === "professional" ? "Personne · activité professionnelle" : "Personne")
    : node.kind === "household" ? "Foyer" : node.kind === "entity" ? (node.legalType === "sci" ? "SCI" : node.legalType === "holding" ? "Holding" : "Entreprise") : node.sourceAccountId === "main" ? "Canal de saisie · pas une banque" : `${node.provider ?? "Compte bancaire"}${node.maskedIdentifier ? ` · ${node.maskedIdentifier}` : ""}`;
  return (
    <button onClick={onSelect} className={`w-full rounded border p-4 text-left shadow-sm transition-all ${dimmed ? "opacity-35" : "opacity-100"} ${selected ? "border-vscode-accent bg-blue-950/30 ring-1 ring-vscode-accent" : "border-vscode-border bg-vscode-panel hover:border-vscode-accent/60 hover:bg-vscode-highlight"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 h-4 w-4 shrink-0 ${node.kind === "person" ? "rounded-full border-2 border-blue-500" : node.kind === "household" ? "rounded border-2 border-purple-500" : node.kind === "entity" ? "rotate-45 border-2 border-cyan-500" : "border-2 border-sky-500"}`} />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-vscode-text">{node.name}</div><div className="mt-1 flex items-center gap-2 text-[11px] text-vscode-muted"><span>{meta}</span>{dossier && <span className={`rounded px-1.5 py-0.5 text-[9px] ${dossier.created ? "bg-green-950/60 text-green-300" : "bg-amber-950/50 text-amber-300"}`}>{dossier.created ? "Comptabilité active" : "Comptabilité à créer"}</span>}</div></div>
      </div>
    </button>
  );
}

function relationAppearance(type: PlatformRelationType): { color: string; dash?: string } {
  if (["family", "spouse", "parent", "child", "member", "beneficiary"].includes(type)) return { color: "#c084fc" };
  if (["owner", "shareholder", "subsidiary"].includes(type)) return { color: "#22d3ee" };
  if (["holder", "uses"].includes(type)) return { color: "#38bdf8", dash: type === "uses" ? "3 5" : undefined };
  if (["accountant", "advisor", "director", "employee", "management"].includes(type)) return { color: "#f59e0b", dash: "7 5" };
  return { color: "#94a3b8", dash: "4 4" };
}

const CARD_WIDTH = 250;
const CARD_HEIGHT = 76;
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 1100;
const EMPTY_LAYOUT: PlatformLayout = {};
const EMPTY_DOSSIERS: AccountingDossier[] = [];

const dossierKindLabels: Record<AccountingDossier["scopeKind"], string> = {
  person: "Comptabilité personnelle",
  household: "Comptabilité du foyer",
  entity: "Comptabilité de la structure",
};

export function AccountingDossierDirectory({ dossiers, busy, onOpen, onConnectBank, onShowDetails }: {
  dossiers: AccountingDossier[];
  busy?: boolean;
  onOpen: (dossier: AccountingDossier) => void;
  onConnectBank: (dossier: AccountingDossier) => void;
  onShowDetails: (dossier: AccountingDossier) => void;
}) {
  const active = dossiers.filter((dossier) => dossier.created).length;
  return <details className="group mx-4 mt-4 rounded border border-vscode-border bg-vscode-panel sm:mx-8">
    <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none">
      <span className="text-vscode-accent transition-transform group-open:rotate-90">▶</span>
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Dossiers comptables</h2><p className="mt-1 truncate text-[11px] text-vscode-muted">{dossiers.length} dossier{dossiers.length !== 1 ? "s" : ""} · {active} actif{active !== 1 ? "s" : ""} · déplier pour ouvrir une comptabilité ou connecter une banque</p></div>
      <span className="hidden rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-[10px] text-vscode-muted sm:inline">Afficher</span>
    </summary>
    <div className="grid gap-3 border-t border-vscode-border p-4 md:grid-cols-2 2xl:grid-cols-3">
      {dossiers.map((dossier) => <article key={dossier.scopeId} className="rounded border border-vscode-border bg-black/10 p-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-xs font-semibold">{dossier.name}</div><div className="mt-1 text-[10px] text-vscode-muted">{dossierKindLabels[dossier.scopeKind]}</div></div><span className={`shrink-0 rounded px-2 py-1 text-[9px] ${dossier.created ? "bg-green-950/60 text-green-300" : "bg-amber-950/50 text-amber-300"}`}>{dossier.created ? "Actif" : "À créer"}</span></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => onOpen(dossier)} className="rounded bg-vscode-accent px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{dossier.created ? "Ouvrir la comptabilité" : "Créer la comptabilité"}</button>
          <button disabled={busy} onClick={() => onConnectBank(dossier)} className="rounded border border-sky-700 px-3 py-2 text-[11px] text-sky-300 disabled:opacity-40">Connecter une banque</button>
          <button onClick={() => onShowDetails(dossier)} className="rounded border border-vscode-border px-3 py-2 text-[11px]">Voir la fiche et les liens</button>
        </div>
      </article>)}
      {dossiers.length === 0 && <p className="py-4 text-xs text-vscode-muted">Aucun dossier visible avec tes droits actuels.</p>}
    </div>
  </details>;
}

function organicLayout(nodes: Node[], state: PlatformState): PlatformLayout {
  const positions: PlatformLayout = {};
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  state.relations.forEach((relation) => {
    degree.set(relation.fromId, (degree.get(relation.fromId) ?? 0) + 1);
    degree.set(relation.toId, (degree.get(relation.toId) ?? 0) + 1);
  });
  const columns = (["person", "household", "entity", "account"] as Node["kind"][])
    .map((kind) => nodes.filter((node) => node.kind === kind).sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.name.localeCompare(b.name, "fr")))
    .filter((column) => column.length > 0);
  const columnGap = 310;
  const rowGap = 122;
  const totalWidth = CARD_WIDTH + Math.max(0, columns.length - 1) * columnGap;
  const startX = (CANVAS_WIDTH - totalWidth) / 2;
  columns.forEach((column, columnIndex) => {
    const columnHeight = CARD_HEIGHT + Math.max(0, column.length - 1) * rowGap;
    const startY = (CANVAS_HEIGHT - columnHeight) / 2;
    column.forEach((node, rowIndex) => { positions[node.id] = { x: startX + columnIndex * columnGap, y: startY + rowIndex * rowGap }; });
  });
  return positions;
}

export function StructureGraph({ nodes, state, dossiers = EMPTY_DOSSIERS, selectedId, onSelect, initialPositions = EMPTY_LAYOUT, onPositionsChange }: { nodes: Node[]; state: PlatformState; dossiers?: AccountingDossier[]; selectedId: string | null; onSelect: (id: string | null) => void; initialPositions?: PlatformLayout; onPositionsChange?: (positions: PlatformLayout) => void }) {
  const markerId = useId().replace(/:/g, "");
  const viewportRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const generated = useMemo(() => organicLayout(nodes, state), [nodes, state.relations]);
  const [positions, setPositions] = useState<PlatformLayout>(() => Object.fromEntries(nodes.map((node) => [node.id, initialPositions[node.id] ?? generated[node.id]])));
  const [view, setView] = useState({ x: -430, y: -245, zoom: .82 });
  const viewRef = useRef(view);
  const drag = useRef<{ mode: "node" | "canvas"; id?: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  useEffect(() => { setPositions((current) => Object.fromEntries(nodes.map((node) => [node.id, current[node.id] ?? initialPositions[node.id] ?? generated[node.id]]))); }, [nodes, initialPositions, generated]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const current = viewRef.current;
      const rect = viewport.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.1 : .9;
      const zoom = Math.max(.25, Math.min(1.8, current.zoom * factor));
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      setView({ zoom, x: mouseX - (mouseX - current.x) * zoom / current.zoom, y: mouseY - (mouseY - current.y) * zoom / current.zoom });
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);
  const linked = new Set<string>(selectedId ? [selectedId] : []);
  if (selectedId) state.relations.filter((relation) => relation.fromId === selectedId || relation.toId === selectedId).forEach((relation) => { linked.add(relation.fromId); linked.add(relation.toId); });

  function fit(nextPositions = positions) {
    if (!nodes.length || !viewportRef.current) return;
    const values = nodes.map((node) => nextPositions[node.id]).filter(Boolean); const minX = Math.min(...values.map((p) => p.x)); const maxX = Math.max(...values.map((p) => p.x + CARD_WIDTH)); const minY = Math.min(...values.map((p) => p.y)); const maxY = Math.max(...values.map((p) => p.y + CARD_HEIGHT));
    const rect = viewportRef.current.getBoundingClientRect(); const zoom = Math.max(.35, Math.min(1.35, Math.min((rect.width - 90) / Math.max(1, maxX - minX), (rect.height - 90) / Math.max(1, maxY - minY))));
    setView({ zoom, x: (rect.width - (minX + maxX) * zoom) / 2, y: (rect.height - (minY + maxY) * zoom) / 2 });
  }
  function reorganize() { const next = organicLayout(nodes, state); setPositions(next); onPositionsChange?.(next); window.setTimeout(() => fit(next), 0); }
  function pointerMove(event: React.PointerEvent) {
    // React peut exécuter les fonctions de mise à jour après pointerUp. On garde
    // donc un instantané du déplacement au lieu de relire drag.current, qui a
    // déjà pu être remis à null lors d'un mouvement rapide.
    const activeDrag = drag.current;
    if (!activeDrag) return;
    const deltaX = event.clientX - activeDrag.startX;
    const deltaY = event.clientY - activeDrag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) suppressClick.current = activeDrag.mode === "node";
    if (activeDrag.mode === "canvas") {
      setView((current) => ({ ...current, x: activeDrag.originX + deltaX, y: activeDrag.originY + deltaY }));
      return;
    }
    if (!activeDrag.id) return;
    const zoom = viewRef.current.zoom;
    setPositions((current) => ({ ...current, [activeDrag.id!]: { x: activeDrag.originX + deltaX / zoom, y: activeDrag.originY + deltaY / zoom } }));
  }
  function pointerUp() { if (drag.current?.mode === "node") onPositionsChange?.(positions); drag.current = null; }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2"><button onClick={() => setView((current) => ({ ...current, zoom: Math.min(1.8, current.zoom * 1.18) }))} className="rounded border border-vscode-border px-3 py-1 text-xs">＋</button><button onClick={() => setView((current) => ({ ...current, zoom: Math.max(.25, current.zoom / 1.18) }))} className="rounded border border-vscode-border px-3 py-1 text-xs">−</button><button onClick={() => fit()} className="rounded border border-vscode-border px-3 py-1 text-xs">Recentrer</button><button onClick={reorganize} className="rounded border border-vscode-accent px-3 py-1 text-xs text-vscode-accent">Réorganiser automatiquement</button><span className="ml-auto text-[10px] text-vscode-muted">Glisser le fond pour naviguer · molette pour zoomer · glisser les cartes pour les ranger</span></div>
      <div ref={viewportRef} style={{ contain: "layout paint size", overflow: "hidden", overscrollBehavior: "contain" }} className="relative h-[620px] cursor-grab touch-none overflow-hidden rounded border border-vscode-border bg-[radial-gradient(circle,_var(--vscode-border)_0.7px,_transparent_0.8px)] bg-[length:18px_18px] active:cursor-grabbing" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { mode: "canvas", startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y }; }} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <svg className="pointer-events-none absolute inset-0" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} aria-label="Carte des liens entre les personnes, entreprises et comptes">
            <defs>
              {Object.entries({ personal: "#c084fc", ownership: "#22d3ee", account: "#38bdf8", professional: "#f59e0b", other: "#94a3b8" }).map(([key, color]) => <marker key={key} id={`${markerId}-${key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker>)}
            </defs>
            {state.relations.map((relation, relationIndex) => {
              const from = positions[relation.fromId]; const to = positions[relation.toId];
              if (!from || !to) return null;
              const appearance = relationAppearance(relation.type);
              const active = !selectedId || relation.fromId === selectedId || relation.toId === selectedId;
              const reversePair = state.relations.some((candidate) => candidate.id !== relation.id && candidate.fromId === relation.toId && candidate.toId === relation.fromId);
              const fromCenter = { x: from.x + CARD_WIDTH / 2, y: from.y + CARD_HEIGHT / 2 }; const toCenter = { x: to.x + CARD_WIDTH / 2, y: to.y + CARD_HEIGHT / 2 }; const dx = toCenter.x - fromCenter.x; const dy = toCenter.y - fromCenter.y; const distance = Math.max(1, Math.hypot(dx, dy)); const ux = dx / distance; const uy = dy / distance; const boundaryDistance = Math.min(Math.abs((CARD_WIDTH / 2) / (ux || .0001)), Math.abs((CARD_HEIGHT / 2) / (uy || .0001))); const startX = fromCenter.x + ux * boundaryDistance; const startY = fromCenter.y + uy * boundaryDistance; const endX = toCenter.x - ux * (boundaryDistance + 5); const endY = toCenter.y - uy * (boundaryDistance + 5); const curve = reversePair ? (relation.fromId < relation.toId ? -38 : 38) : ((relationIndex % 3) - 1) * 10; const normalX = -uy * curve; const normalY = ux * curve; const controlX = (startX + endX) / 2 + normalX; const controlY = (startY + endY) / 2 + normalY; const path = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`; const labelX = controlX; const labelY = controlY - 7;
              const markerKey = ["family", "spouse", "parent", "child", "member", "beneficiary"].includes(relation.type) ? "personal" : ["owner", "shareholder", "subsidiary"].includes(relation.type) ? "ownership" : ["holder", "uses"].includes(relation.type) ? "account" : ["accountant", "advisor", "director", "employee", "management"].includes(relation.type) ? "professional" : "other";
              return <g key={relation.id} opacity={active ? 1 : 0.18}>
                <path d={path} fill="none" stroke={appearance.color} strokeWidth={active && selectedId ? 2.6 : 1.7} strokeDasharray={appearance.dash} markerEnd={`url(#${markerId}-${markerKey})`}><title>{`${relationLabels[relation.type]} : ${nodes.find((node) => node.id === relation.fromId)?.name} → ${nodes.find((node) => node.id === relation.toId)?.name}`}</title></path>
                {active && <text x={labelX} y={labelY} textAnchor="middle" fill={appearance.color} stroke="var(--vscode-bg)" strokeWidth="5" paintOrder="stroke" className="text-[10px] font-semibold">{relationLabels[relation.type]}</text>}
              </g>;
            })}
          </svg>
          {nodes.map((node) => {
            const position = positions[node.id]; if (!position) return null;
            return <div key={node.id} className="absolute cursor-move select-none" style={{ left: position.x, top: position.y, width: CARD_WIDTH }} onPointerDown={(event) => { event.stopPropagation(); suppressClick.current = false; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { mode: "node", id: node.id, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y }; }} onPointerMove={pointerMove} onPointerUp={(event) => { event.stopPropagation(); pointerUp(); }} onPointerCancel={pointerUp}><NodeCard node={node} dossier={dossiers.find((item) => item.scopeId === node.id)} selected={node.id === selectedId} dimmed={Boolean(selectedId && !linked.has(node.id))} onSelect={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(node.id === selectedId ? null : node.id); }} /></div>;
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-vscode-muted">
        <span className="text-purple-400">━ Liens personnels</span><span className="text-cyan-400">━ Propriété / participation</span><span className="text-sky-400">┄ Comptes et usages</span><span className="text-amber-400">┄ Liens professionnels</span><span>Les flèches indiquent le sens du lien.</span>
      </div>
    </div>
  );
}

function periodDuration(period: PlatformFiscalPeriod): string {
  if (!period.startDate || !period.endDate || period.endDate < period.startDate) return "Durée à calculer";
  const start = new Date(`${period.startDate}T00:00:00Z`);
  const end = new Date(`${period.endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + (end.getUTCDate() >= start.getUTCDate() ? 1 : 0);
  return `${months} mois · ${days} jours`;
}

function FiscalPeriodsEditor({ periods, disabled, saving, onChange, onSave }: { periods: PlatformFiscalPeriod[]; disabled: boolean; saving: boolean; onChange: (periods: PlatformFiscalPeriod[]) => void; onSave: () => void }) {
  const update = (index: number, patch: Partial<PlatformFiscalPeriod>) => onChange(periods.map((period, current) => current === index ? { ...period, ...patch } : period));
  return <div className="mt-5 border-t border-vscode-border pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-xs font-semibold">Exercices comptables datés</h4><p className="mt-1 max-w-3xl text-[10px] text-vscode-muted">Conserve ici chaque période réelle, y compris un exercice exceptionnel de 15 mois. Les champs MM-JJ de la fiche définissent seulement le cycle annuel habituel qui s’appliquera ensuite.</p></div><div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => onChange([...periods, { id: crypto.randomUUID(), startDate: "", endDate: "", label: periods.length ? "Exercice suivant" : "Exercice en cours" }])} className="rounded border border-cyan-700 px-3 py-2 text-[10px] text-cyan-300 disabled:opacity-40">+ Ajouter un exercice</button><button type="button" disabled={disabled || saving} onClick={onSave} className="rounded bg-cyan-700 px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-40">{saving ? "Enregistrement…" : "Enregistrer les exercices"}</button></div></div>
    <div className="mt-3 space-y-2">{periods.map((period, index) => <div key={period.id} className="grid gap-2 rounded border border-vscode-border bg-black/10 p-3 sm:grid-cols-[minmax(150px,1fr)_150px_150px_130px_auto]"><label className="text-[10px]">Libellé<input disabled={disabled} value={period.label ?? ""} onChange={(event) => update(index, { label: event.target.value })} placeholder="Exercice transitoire" className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Début<input disabled={disabled} aria-label={`Début exercice daté ${index + 1}`} type="date" value={period.startDate} onChange={(event) => update(index, { startDate: event.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Fin<input disabled={disabled} aria-label={`Fin exercice daté ${index + 1}`} type="date" value={period.endDate} onChange={(event) => update(index, { endDate: event.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><div className="self-end rounded bg-vscode-bg px-2 py-2 text-[10px] text-vscode-muted">{periodDuration(period)}</div><button type="button" disabled={disabled} onClick={() => onChange(periods.filter((_, current) => current !== index))} className="self-end px-2 py-2 text-xs text-red-400 disabled:opacity-40" title="Supprimer cet exercice">×</button></div>)}{periods.length === 0 && <p className="rounded border border-dashed border-vscode-border p-3 text-[10px] text-vscode-muted">Aucun exercice daté enregistré. Ajoute l’exercice qui vient de se terminer, puis la période transitoire.</p>}</div>
  </div>;
}

export function StructureView({ currentUser }: { currentUser: AuthUser | null }) {
  const openTab = useAppStore((store) => store.openTab);
  const detailsRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<PlatformState | null>(null);
  const [layout, setLayout] = useState<PlatformLayout>({});
  const [dossiers, setDossiers] = useState<AccountingDossier[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<"individual" | "professional">("individual");
  const [householdName, setHouseholdName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [legalType, setLegalType] = useState<PlatformLegalType>("company");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [relationType, setRelationType] = useState<PlatformRelationType>("family");
  const [ownershipPercent, setOwnershipPercent] = useState(100);
  const [shareCount, setShareCount] = useState(0);
  const [ultimateBeneficiaryId, setUltimateBeneficiaryId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [financialLinkType, setFinancialLinkType] = useState<PlatformRelation["financialLinkType"]>("none");
  const [financialAmount, setFinancialAmount] = useState(0);
  const [interestRate, setInterestRate] = useState(0);
  const [issues, setIssues] = useState<StructureIssue[]>([]);
  const [entityDraft, setEntityDraft] = useState<Partial<PlatformEntity>>({});
  const [relationDraft, setRelationDraft] = useState<PlatformRelation | null>(null);
  const [relationNotice, setRelationNotice] = useState<{ kind: "created" | "existing"; message: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [accessUserId, setAccessUserId] = useState("");
  const [accessScopeId, setAccessScopeId] = useState("");
  const [accessRole, setAccessRole] = useState<PlatformAccessRole>("viewer");
  const canAdminister = !currentUser || currentUser.role === "owner" || currentUser.role === "admin";

  useEffect(() => { Promise.all([fetchPlatformState(), fetchPlatformLayout(), fetchAccountingDossiers(), fetchStructureIssues()]).then(([nextState, nextLayout, nextDossiers, nextIssues]) => { setState(nextState); setLayout(nextLayout); setDossiers(nextDossiers); setIssues(nextIssues); }).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible")); }, []);
  useEffect(() => { if (canAdminister) fetchUsers().then(setUsers).catch(() => setUsers([])); }, [canAdminister]);
  const nodes = useMemo<Node[]>(() => state ? [...state.people, ...state.households, ...state.entities, ...state.accounts.filter((account) => !account.technical)] : [], [state]);
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const visibleAccountCount = state?.accounts.filter((account) => !account.technical).length ?? 0;
  const visibleRelationCount = state?.relations.filter((relation) => visibleNodeIds.has(relation.fromId) && visibleNodeIds.has(relation.toId)).length ?? 0;
  const selected = nodes.find((node) => node.id === selectedId);
  useEffect(() => { if (selected?.kind === "entity") setEntityDraft({ ...selected }); else setEntityDraft({}); }, [selectedId, state?.revision]);
  const selectedDossier = dossiers.find((dossier) => dossier.scopeId === selectedId);
  const relations = state?.relations.filter((relation) => !selectedId || relation.fromId === selectedId || relation.toId === selectedId) ?? [];
  const nodeName = (id: string) => nodes.find((node) => node.id === id)?.name ?? "Élément inconnu";
  const persistLayout = (positions: PlatformLayout) => { setLayout(positions); void savePlatformLayout(positions).catch((e) => setError(e instanceof Error ? e.message : "Enregistrement de la disposition impossible")); };

  function openIssue(issue: StructureIssue) {
    setSelectedId(issue.scopeId);
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function addPerson() {
    if (!state || !name.trim()) return;
    setBusy(true); setError("");
    try { const next = await createPlatformPerson({ name: name.trim(), profile, expectedRevision: state.revision }); setState(next); setName(""); setSelectedId(next.people.at(-1)?.id ?? null); setDossiers(await fetchAccountingDossiers()); }
    catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); }
    finally { setBusy(false); }
  }

  async function addHousehold() {
    if (!state || !householdName.trim()) return;
    setBusy(true); setError("");
    try { const next = await createPlatformHousehold({ name: householdName.trim(), expectedRevision: state.revision }); setState(next); setHouseholdName(""); setSelectedId(next.households.at(-1)?.id ?? null); setDossiers(await fetchAccountingDossiers()); }
    catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); }
    finally { setBusy(false); }
  }

  async function addLegalStructure() {
    if (!legalName.trim()) return;
    setBusy(true); setError("");
    try { const company = await createCompanyApi(legalName.trim(), legalType); const [next, nextDossiers, nextIssues] = await Promise.all([fetchPlatformState(), fetchAccountingDossiers(), fetchStructureIssues()]); setState(next); setDossiers(nextDossiers); setIssues(nextIssues); setLegalName(""); setSelectedId(`entity_${company.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Création du dossier impossible"); }
    finally { setBusy(false); }
  }

  async function createOrOpenDossier(dossier: AccountingDossier) {
    setBusy(true); setError("");
    try {
      const ready = await ensureAccountingDossier(dossier.scopeId);
      if (!dossier.created) setDossiers((current) => current.map((item) => item.scopeId === ready.scopeId ? ready : item));
      if (ready.workspaceId && ready.scopeKind !== "entity") { const businessWorkspace = await fetchActiveCompany(); if (businessWorkspace) sessionStorage.setItem("comptaos:last-business-workspace", businessWorkspace.id); await setActiveCompanyApi(ready.workspaceId); }
      const workspaceParam = ready.workspaceId ? `&workspace=${encodeURIComponent(ready.workspaceId)}` : "";
      if (ready.scopeKind === "person") openTab({ id: `personal:${ready.scopeId}`, title: ready.name, type: "personal", path: `person=${encodeURIComponent(ready.scopeId)}${workspaceParam}` });
      else if (ready.scopeKind === "household") openTab({ id: `household:${ready.scopeId}`, title: ready.name, type: "household", path: `household=${encodeURIComponent(ready.scopeId)}${workspaceParam}` });
      else { const entity = state?.entities.find((item) => item.id === ready.scopeId); if (entity) await openEntity(entity); }
    } catch (e) { setError(e instanceof Error ? e.message : "Ouverture du dossier impossible"); setBusy(false); }
    finally { if (dossier.scopeKind !== "entity") setBusy(false); }
  }

  async function connectBank(dossier: AccountingDossier) {
    setBusy(true); setError("");
    try {
      const ready = await ensureAccountingDossier(dossier.scopeId);
      if (!dossier.created) setDossiers((current) => current.map((item) => item.scopeId === ready.scopeId ? ready : item));
      if (!ready.workspaceId) throw new Error("Espace comptable indisponible pour ce dossier.");
      const businessWorkspace = await fetchActiveCompany();
      if (businessWorkspace && businessWorkspace.id !== ready.workspaceId) sessionStorage.setItem("comptaos:last-business-workspace", businessWorkspace.id);
      await setActiveCompanyApi(ready.workspaceId);
      openTab({ id: `dossier:${ready.scopeKind}:${ready.scopeId}:banking`, title: `Banque · ${ready.name}`, type: "banking", path: `workspace=${encodeURIComponent(ready.workspaceId)}&dossier=${encodeURIComponent(ready.name)}` });
    } catch (e) { setError(e instanceof Error ? e.message : "Connexion bancaire impossible"); }
    finally { setBusy(false); }
  }

  function showDossierDetails(dossier: AccountingDossier) {
    setSelectedId(dossier.scopeId);
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function addRelation() {
    if (!state || !fromId || !toId) return;
    setBusy(true); setError(""); setRelationNotice(null);
    try {
      const ownershipLink = ["owner", "shareholder", "subsidiary"].includes(relationType);
      const result = await createPlatformRelation({ fromId, toId, type: relationType, ownershipPercent: ownershipLink ? ownershipPercent : undefined, shareCount: ownershipLink && shareCount > 0 ? shareCount : undefined, ultimateBeneficiaryId: ownershipLink && ultimateBeneficiaryId ? ultimateBeneficiaryId : undefined, effectiveFrom: effectiveFrom || undefined, effectiveTo: effectiveTo || undefined, financialLinkType, financialAmount: financialLinkType !== "none" && financialAmount > 0 ? financialAmount : undefined, interestRate: financialLinkType === "intercompany_loan" && interestRate > 0 ? interestRate : undefined, expectedRevision: state.revision });
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

  async function saveEntityProfile() {
    if (!state || selected?.kind !== "entity") return; setBusy(true); setError("");
    try { const next = await updatePlatformEntity(selected.id, { ...entityDraft, expectedRevision: state.revision }); setState(next); setIssues(await fetchStructureIssues()); }
    catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); } finally { setBusy(false); }
  }

  async function saveRelationDraft() {
    if (!state || !relationDraft) return;
    setBusy(true); setError("");
    try {
      const next = await updatePlatformRelation(relationDraft.id, { ownershipPercent: relationDraft.ownershipPercent, shareCount: relationDraft.shareCount, ultimateBeneficiaryId: relationDraft.ultimateBeneficiaryId || undefined, effectiveFrom: relationDraft.effectiveFrom || undefined, effectiveTo: relationDraft.effectiveTo || undefined, financialLinkType: relationDraft.financialLinkType ?? "none", financialAmount: relationDraft.financialLinkType === "none" ? undefined : relationDraft.financialAmount, interestRate: relationDraft.financialLinkType === "intercompany_loan" ? relationDraft.interestRate : undefined, expectedRevision: state.revision });
      setState(next); setIssues(await fetchStructureIssues()); setRelationDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible"); }
    finally { setBusy(false); }
  }

  async function openEntity(entity: PlatformEntity) {
    setBusy(true);
    try { sessionStorage.setItem("comptaos:last-business-workspace", entity.workspaceId); await setActiveCompanyApi(entity.workspaceId); window.location.reload(); }
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
    <div style={{ overflowX: "hidden" }} className="h-full max-w-full overflow-x-hidden overflow-y-auto bg-vscode-bg">
      <header className="border-b border-vscode-border px-4 py-5 sm:px-8 sm:py-6">
        <div className="text-[10px] uppercase tracking-[0.22em] text-vscode-muted">Écosystème / vue d’ensemble</div>
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="mt-2 text-2xl font-semibold text-vscode-text">Structure financière</h1><div className="flex gap-2"><button onClick={() => openTab({ id: "allocation", title: "Affectation des flux", type: "allocation" })} className="rounded border border-vscode-accent px-4 py-2 text-xs font-semibold text-vscode-accent">Affecter les flux aux dossiers</button><button onClick={() => openTab({ id: "portfolio", title: "Consolidation", type: "portfolio" })} className="rounded bg-vscode-accent px-4 py-2 text-xs font-semibold text-white">Voir la big picture →</button></div></div>
        <p className="mt-2 max-w-3xl text-xs text-vscode-muted">Plusieurs personnes peuvent partager des liens familiaux, professionnels ou patrimoniaux et être reliées à plusieurs structures. Chaque entreprise conserve son espace ComptaOS complet.</p>
      </header>

      <div className="border-b border-vscode-border px-4 py-3 text-xs text-vscode-muted sm:px-8">
        <span className="text-vscode-text">{state.people.length} personne{state.people.length !== 1 ? "s" : ""}</span> · {state.households.length} foyer{state.households.length !== 1 ? "s" : ""} · {state.entities.length} entreprise{state.entities.length !== 1 ? "s" : ""} · {visibleAccountCount} compte{visibleAccountCount !== 1 ? "s" : ""} bancaire{visibleAccountCount !== 1 ? "s" : ""} · {visibleRelationCount} lien{visibleRelationCount !== 1 ? "s" : ""}
      </div>

      <section className="mx-4 mt-4 grid gap-2 rounded border border-blue-900 bg-blue-950/10 p-4 text-[11px] text-vscode-muted sm:mx-8 lg:grid-cols-3">
        <div><strong className="text-vscode-text">1. Modéliser</strong><br/>Crée les personnes et foyers réels, puis relie-les aux structures.</div>
        <div><strong className="text-vscode-text">2. Activer la comptabilité</strong><br/>Utilise directement le dossier correspondant ci-dessous, sans passer par le graphe.</div>
        <div><strong className="text-vscode-text">3. Connecter les comptes</strong><br/>Clique sur « Connecter une banque » dans le bon dossier. Le compte apparaîtra ensuite automatiquement dans la structure.</div>
      </section>

      <AccountingDossierDirectory dossiers={dossiers} busy={busy} onOpen={(dossier) => void createOrOpenDossier(dossier)} onConnectBank={(dossier) => void connectBank(dossier)} onShowDetails={showDossierDetails} />

      {error && <div className="mx-4 mt-4 rounded border border-red-700 bg-red-950/30 px-4 py-2 text-xs text-red-300 sm:mx-8">{error}</div>}
      {issues.length > 0 && <section className="mx-4 mt-4 rounded border border-amber-700 bg-amber-950/20 p-4 sm:mx-8"><h2 className="text-sm font-semibold text-amber-300">Assistant · Structure incomplète</h2><p className="mt-1 text-[10px] text-vscode-muted">{issues.length} point(s) à compléter avant une consolidation fiable. La forme, le capital et la TVA déjà présents dans le profil entreprise sont repris automatiquement. Les informations nouvelles, comme le régime fiscal, les dates d’activité et l’exercice, doivent être complétées dans la fiche ci-dessous.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{issues.map((issue) => <button key={issue.id} onClick={() => openIssue(issue)} className={`group flex items-center gap-3 rounded border p-2 text-left text-xs ${issue.severity === "blocking" ? "border-red-800 text-red-300" : "border-amber-800 text-amber-200"}`}><span className="min-w-0 flex-1">{issue.message}</span><span className="shrink-0 text-[10px] text-vscode-accent group-hover:underline">Corriger ↓</span></button>)}</div></section>}

      <main className="grid gap-4 p-4 sm:gap-6 sm:p-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded border border-vscode-border bg-black/10 p-5">
          <div className="mb-4"><h2 className="text-sm font-semibold">Carte des relations</h2><p className="mt-1 text-[10px] text-vscode-muted">Le graphe sert à comprendre et modifier les liens. L’accès aux comptabilités se fait toujours depuis le bloc « Dossiers comptables » ci-dessus.</p></div>
          <StructureGraph nodes={nodes} state={state} dossiers={dossiers} selectedId={selectedId} onSelect={setSelectedId} initialPositions={layout} onPositionsChange={persistLayout} />
          {selected && <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-vscode-accent/60 bg-blue-950/20 p-3 text-xs"><div className="min-w-0 flex-1"><strong>{selected.name}</strong><div className="mt-0.5 text-[10px] text-vscode-muted">{selectedDossier ? selectedDossier.created ? "Dossier comptable actif" : "Dossier disponible, pas encore activé" : "Compte bancaire rattaché à sa source"}</div></div>{selectedDossier && <button disabled={busy} onClick={() => void createOrOpenDossier(selectedDossier)} className="rounded bg-vscode-accent px-3 py-2 font-semibold text-white disabled:opacity-40">{selectedDossier.created ? "Ouvrir la comptabilité" : "Créer la comptabilité"}</button>}<button onClick={() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="rounded border border-vscode-border px-3 py-2">Voir la fiche et les liens</button></div>}
        </section>

        <aside className="space-y-4">
          {canAdminister && <section className="rounded border border-blue-900 bg-blue-950/10 p-4"><h2 className="text-xs font-semibold">Inviter puis donner accès</h2><p className="mt-1 text-[10px] text-vscode-muted">Un associé doit d’abord avoir un compte ComptaOS. Une fois son invitation acceptée, utilise « Droits du portefeuille » plus bas pour lui attribuer uniquement son périmètre. Les liens du graphe ne donnent aucun droit automatiquement.</p><button onClick={() => openTab({ id: "users", title: "Utilisateurs", type: "users" })} className="mt-3 w-full rounded border border-vscode-accent px-3 py-2 text-xs text-vscode-accent">Inviter ou créer un utilisateur</button><button onClick={() => void fetchUsers().then(setUsers).catch(() => setUsers([]))} className="mt-2 w-full text-[10px] text-vscode-muted hover:text-vscode-text">Actualiser les utilisateurs après inscription</button></section>}
          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Ajouter une personne</h2><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom ou libellé" className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs" /><select value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs"><option value="individual">Vie personnelle</option><option value="professional">Activité professionnelle</option></select><button disabled={busy || !name.trim()} onClick={() => void addPerson()} className="mt-3 w-full rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">+ Ajouter</button></section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Ajouter un foyer</h2><p className="mt-1 text-[10px] text-vscode-muted">Le foyer consolide plusieurs personnes sans dupliquer les transactions.</p><input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="Ex. Foyer Jurado" className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs"/><button disabled={busy || !householdName.trim()} onClick={() => void addHousehold()} className="mt-3 w-full rounded bg-purple-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">+ Ajouter le foyer</button></section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Créer une structure comptable</h2><p className="mt-1 text-[10px] text-vscode-muted">Crée immédiatement un dossier complet utilisant le moteur comptable de ComptaOS.</p><input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Nom de la société ou structure" className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs"/><select value={legalType} onChange={(e) => setLegalType(e.target.value as typeof legalType)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-3 py-2 text-xs"><option value="company">Société / entreprise</option><option value="sci">SCI</option><option value="holding">Holding</option><option value="association">Association</option><option value="sole_proprietorship">Entreprise individuelle</option><option value="other">Autre structure</option></select><button disabled={busy || !legalName.trim()} onClick={() => void addLegalStructure()} className="mt-3 w-full rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">+ Créer le dossier comptable</button></section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Créer un lien enrichi</h2><select value={fromId} onChange={(e) => { setFromId(e.target.value); setRelationNotice(null); }} className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Détenteur direct / départ…</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select value={relationType} onChange={(e) => { setRelationType(e.target.value as PlatformRelationType); setRelationNotice(null); }} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs">{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={toId} onChange={(e) => { setToId(e.target.value); setRelationNotice(null); }} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Structure / arrivée…</option>{nodes.filter((node) => node.id !== fromId).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select>{["owner","shareholder","subsidiary"].includes(relationType) && <div className="mt-2 grid grid-cols-2 gap-2"><input type="number" min="0" max="100" value={ownershipPercent} onChange={(e) => setOwnershipPercent(Number(e.target.value))} placeholder="Détention %" className="rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/><input type="number" min="0" step="1" value={shareCount} onChange={(e) => setShareCount(Number(e.target.value))} placeholder="Nombre de parts" className="rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/><select value={ultimateBeneficiaryId} onChange={(e) => setUltimateBeneficiaryId(e.target.value)} className="col-span-2 rounded border border-vscode-border bg-vscode-bg p-2 text-xs"><option value="">Bénéficiaire effectif…</option>{state.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>}<div className="mt-2 grid grid-cols-2 gap-2"><input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/><input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className="rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></div><select value={financialLinkType} onChange={(e) => setFinancialLinkType(e.target.value as PlatformRelation["financialLinkType"])} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"><option value="none">Aucun financement associé</option><option value="shareholder_current_account">Compte courant d’associé</option><option value="intercompany_loan">Prêt associé au lien</option></select>{financialLinkType !== "none" && <div className="mt-2 grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" value={financialAmount} onChange={(e) => setFinancialAmount(Number(e.target.value))} placeholder="Montant" className="rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/><input type="number" min="0" max="100" step="0.01" value={interestRate} onChange={(e) => setInterestRate(Number(e.target.value))} placeholder="Taux %" className="rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></div>}<button disabled={busy || !fromId || !toId} onClick={() => void addRelation()} className="mt-3 w-full rounded border border-vscode-accent px-3 py-2 text-xs text-vscode-accent disabled:opacity-40">{busy ? "Création…" : "Relier"}</button>{relationNotice && <p aria-live="polite" className={`mt-3 rounded border px-3 py-2 text-[11px] ${relationNotice.kind === "created" ? "border-green-700 bg-green-950/30 text-green-300" : "border-amber-700 bg-amber-950/30 text-amber-300"}`}>{relationNotice.message}</p>}</section>}

          {canAdminister && <section className="rounded border border-vscode-border bg-vscode-panel p-4"><h2 className="text-xs font-semibold">Droits du portefeuille</h2><p className="mt-1 text-[10px] text-vscode-muted">Attribue séparément chaque personne, foyer ou entreprise à un utilisateur.</p><select value={accessUserId} onChange={(e) => setAccessUserId(e.target.value)} className="mt-3 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Utilisateur…</option>{users.filter((user) => user.role !== "owner" && user.role !== "admin").map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select><select value={accessScopeId} onChange={(e) => setAccessScopeId(e.target.value)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="">Périmètre…</option>{[...state.people, ...state.households, ...state.entities].map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select value={accessRole} onChange={(e) => setAccessRole(e.target.value as PlatformAccessRole)} className="mt-2 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-2 text-xs"><option value="viewer">Lecture seule</option><option value="manager">Gestionnaire / comptable</option><option value="owner">Responsable du périmètre</option></select><button disabled={busy || !accessUserId || !accessScopeId} onClick={() => void saveAccess()} className="mt-3 w-full rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Attribuer l’accès</button><div className="mt-3 space-y-1">{state.grants.map((grant) => <div key={grant.id} className="flex items-center gap-2 rounded border border-vscode-border px-2 py-1 text-[10px]"><span className="min-w-0 flex-1 truncate">{users.find((user) => user.id === grant.userId)?.displayName ?? grant.userId} · {nodeName(grant.scopeId)} · {grant.role === "viewer" ? "lecture" : grant.role === "manager" ? "gestion" : "responsable"}</span><button className="text-vscode-muted hover:text-red-400" onClick={() => void deletePlatformAccess(grant.id, state.revision).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Suppression impossible"))}>×</button></div>)}</div></section>}
        </aside>
      </main>

      <section ref={detailsRef} className="mx-4 mb-4 scroll-mt-4 rounded border border-vscode-border bg-vscode-panel p-4 sm:mx-8 sm:mb-8 sm:p-5">
        {selected?.kind === "entity" && <p className="mb-4 rounded border border-cyan-900 bg-cyan-950/10 p-3 text-[10px] text-vscode-muted">La fiche de structure complète les Paramètres du dossier : le profil comptable existant reste la source pour le SIREN, l’adresse et la facturation ; cette fiche ajoute le régime fiscal, les dates d’activité, les exercices datés et les relations capitalistiques.</p>}
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">{selected ? selected.name : "Relations de la structure"}</h2><p className="mt-1 text-[11px] text-vscode-muted">{selectedDossier ? selectedDossier.mode === "full" ? `Dossier comptable complet · ${selectedDossier.legalType === "sci" ? "SCI" : selectedDossier.legalType === "holding" ? "holding" : "entreprise"}.` : selectedDossier.created ? "Dossier comptable actif, alimenté par les transactions qui lui sont affectées." : "Ce périmètre existe dans la structure mais son dossier comptable n’a pas encore été activé." : "Sélectionne une personne, un foyer ou une structure pour ouvrir sa comptabilité."}</p>{selectedDossier && <div className="mt-2 flex flex-wrap gap-1">{selectedDossier.features.map((feature) => <span key={feature} className="rounded border border-vscode-border bg-black/15 px-2 py-0.5 text-[9px] text-vscode-muted">{feature}</span>)}</div>}</div><div>{selectedDossier && <button disabled={busy} onClick={() => void createOrOpenDossier(selectedDossier)} className={`rounded px-4 py-2 text-xs font-semibold text-white ${selectedDossier.scopeKind === "household" ? "bg-purple-700" : selectedDossier.scopeKind === "entity" ? "bg-cyan-700" : "bg-vscode-accent"}`}>{selectedDossier.created ? "Ouvrir la comptabilité →" : "Créer la comptabilité →"}</button>}</div></div>
        {selected?.kind === "entity" && <section className="mt-5 rounded border border-cyan-900 bg-cyan-950/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Fiche complète de la structure</h3><p className="text-[10px] text-vscode-muted">Ces informations alimentent les contrôles fiscaux, la consolidation et les exercices.</p></div>{canAdminister && <button disabled={busy} onClick={() => void saveEntityProfile()} className="rounded bg-cyan-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Enregistrer la fiche</button>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label className="text-[10px]">Nom<input disabled={!canAdminister} value={entityDraft.name ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, name: e.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Forme juridique<select disabled={!canAdminister} value={entityDraft.legalType ?? "company"} onChange={(e) => setEntityDraft({ ...entityDraft, legalType: e.target.value as PlatformLegalType })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs">{Object.entries(legalTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[10px]">Capital<input disabled={!canAdminister} type="number" min="0" step="0.01" value={entityDraft.capitalAmount ?? 0} onChange={(e) => setEntityDraft({ ...entityDraft, capitalAmount: Number(e.target.value) })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Régime fiscal<select disabled={!canAdminister} value={entityDraft.taxRegime ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, taxRegime: e.target.value as PlatformEntity["taxRegime"] })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"><option value="">À renseigner…</option>{Object.entries(taxRegimeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[10px]">Régime de TVA<select disabled={!canAdminister} value={entityDraft.vatRegime ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, vatRegime: e.target.value as PlatformEntity["vatRegime"] })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"><option value="">À renseigner…</option>{Object.entries(vatRegimeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[10px]">Début d’activité<input disabled={!canAdminister} type="date" value={entityDraft.startDate ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, startDate: e.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Fin d’activité<input disabled={!canAdminister} type="date" value={entityDraft.endDate ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, endDate: e.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Exercice comptable<input disabled={!canAdminister} value={`${entityDraft.fiscalYearStart ?? ""}${entityDraft.fiscalYearEnd ? ` → ${entityDraft.fiscalYearEnd}` : ""}`} readOnly className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs text-vscode-muted"/></label><label className="text-[10px]">Début exercice (MM-JJ)<input disabled={!canAdminister} placeholder="01-01" value={entityDraft.fiscalYearStart ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, fiscalYearStart: e.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Fin exercice (MM-JJ)<input disabled={!canAdminister} placeholder="12-31" value={entityDraft.fiscalYearEnd ?? ""} onChange={(e) => setEntityDraft({ ...entityDraft, fiscalYearEnd: e.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label></div></section>}
        <div className="mt-4 grid gap-2 md:grid-cols-2">{relations.map((relation) => <article key={relation.id} className="rounded border border-vscode-border px-3 py-2 text-xs"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{nodeName(relation.fromId)} <span className="text-vscode-accent">— {relationLabels[relation.type]} →</span> {nodeName(relation.toId)}</span>{canAdminister && relation.source === "manual" && <><button title="Compléter ou modifier le lien" className="rounded border border-vscode-border px-2 py-1 text-[10px] hover:border-vscode-accent" onClick={() => setRelationDraft({ ...relation, financialLinkType: relation.financialLinkType ?? "none" })}>Modifier</button><button title="Supprimer le lien" className="text-vscode-muted hover:text-red-400" onClick={() => state && void deletePlatformRelation(relation.id, state.revision).then(setState).catch((e) => setError(e instanceof Error ? e.message : "Suppression impossible"))}>×</button></>}</div><div className="mt-2 flex flex-wrap gap-1 text-[9px] text-vscode-muted">{relation.ownershipPercent !== undefined && <span className="rounded bg-vscode-bg px-2 py-1">Détention {relation.ownershipPercent} %</span>}{relation.shareCount !== undefined && <span className="rounded bg-vscode-bg px-2 py-1">{relation.shareCount} part(s)</span>}{relation.ultimateBeneficiaryId && <span className="rounded bg-vscode-bg px-2 py-1">Bénéficiaire : {nodeName(relation.ultimateBeneficiaryId)}</span>}{relation.effectiveFrom && <span className="rounded bg-vscode-bg px-2 py-1">Depuis le {relation.effectiveFrom}</span>}{relation.financialLinkType && relation.financialLinkType !== "none" && <span className="rounded bg-vscode-bg px-2 py-1">{financialLinkLabels[relation.financialLinkType]} · {(relation.financialAmount ?? 0).toLocaleString("fr-FR")} €{relation.interestRate ? ` · ${relation.interestRate} %` : ""}</span>}</div></article>)}{relations.length === 0 && <p className="text-xs text-vscode-muted">Aucun lien à afficher.</p>}</div>
        {selected?.kind === "entity" && <FiscalPeriodsEditor periods={entityDraft.fiscalPeriods ?? []} disabled={!canAdminister} saving={busy} onChange={(fiscalPeriods) => setEntityDraft({ ...entityDraft, fiscalPeriods })} onSave={() => void saveEntityProfile()}/>}
      </section>
      {relationDraft && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setRelationDraft(null); }}><form role="dialog" aria-modal="true" aria-label="Modifier le lien" onSubmit={(event) => { event.preventDefault(); void saveRelationDraft(); }} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded border border-vscode-border bg-vscode-panel p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Modifier le lien</h2><p className="mt-1 text-[10px] text-vscode-muted">{nodeName(relationDraft.fromId)} — {relationLabels[relationDraft.type]} → {nodeName(relationDraft.toId)}</p></div><button type="button" disabled={busy} onClick={() => setRelationDraft(null)}>×</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[10px]">Pourcentage de détention<LocalizedNumberInput min={0} max={100} value={relationDraft.ownershipPercent ?? 0} onValueChange={(ownershipPercent) => setRelationDraft({ ...relationDraft, ownershipPercent })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2"/></label><label className="text-[10px]">Nombre de parts<LocalizedNumberInput min={0} value={relationDraft.shareCount ?? 0} onValueChange={(shareCount) => setRelationDraft({ ...relationDraft, shareCount })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2"/></label><label className="text-[10px]">Bénéficiaire effectif<select value={relationDraft.ultimateBeneficiaryId ?? ""} onChange={(event) => setRelationDraft({ ...relationDraft, ultimateBeneficiaryId: event.target.value || undefined })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"><option value="">À renseigner…</option>{state.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="text-[10px]">Type de financement<select value={relationDraft.financialLinkType ?? "none"} onChange={(event) => setRelationDraft({ ...relationDraft, financialLinkType: event.target.value as PlatformRelation["financialLinkType"] })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs">{Object.entries(financialLinkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[10px]">Date d’effet<input type="date" value={relationDraft.effectiveFrom ?? ""} onChange={(event) => setRelationDraft({ ...relationDraft, effectiveFrom: event.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label><label className="text-[10px]">Date de fin<input type="date" value={relationDraft.effectiveTo ?? ""} onChange={(event) => setRelationDraft({ ...relationDraft, effectiveTo: event.target.value })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2 text-xs"/></label>{relationDraft.financialLinkType !== "none" && <label className="text-[10px]">Montant associé<LocalizedNumberInput min={0} value={relationDraft.financialAmount ?? 0} onValueChange={(financialAmount) => setRelationDraft({ ...relationDraft, financialAmount })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2"/></label>}{relationDraft.financialLinkType === "intercompany_loan" && <label className="text-[10px]">Taux d’intérêt (%)<LocalizedNumberInput min={0} max={100} value={relationDraft.interestRate ?? 0} onValueChange={(interestRate) => setRelationDraft({ ...relationDraft, interestRate })} className="mt-1 w-full rounded border border-vscode-border bg-vscode-bg p-2"/></label>}</div><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setRelationDraft(null)} className="rounded border border-vscode-border px-3 py-2 text-xs">Fermer</button><button type="submit" disabled={busy} className="rounded bg-vscode-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Enregistrer le lien</button></div></form></div>}
    </div>
  );
}
