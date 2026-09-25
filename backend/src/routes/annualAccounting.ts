import fs from "node:fs/promises";
import path from "node:path";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { buildAccountingPreview } from "../services/accountingExportService.js";
import {
  annualAccountingOptions, annualFingerprint, annualYearLocked, assertAnnualYearOpen, buildAnnualStatements,
  loadAnnualWorkspace, saveAnnualWorkspace, validateSchedule, validateSettlement,
  type AdjustmentEntry, type AnnualCheckId, type FiscalAdjustment, type FixedAsset, type RecurringEvidenceSchedule, type SettlementInvoice, type ThirdPartyAccount, type ThirdPartyDocument, validateThirdPartyDocument,
} from "../services/annualAccountingService.js";
import { loadAccountingConfig } from "../services/settingsService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { nanoid } from "../utils/id.js";
import { autoCommit } from "../services/gitService.js";

const yearOf = (date?: string) => date?.slice(0, 4) ?? "";
const finitePositive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const account = (value: unknown) => /^\d{3,}$/.test(String(value ?? "").trim());
const allowedAttachmentExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const allowedAttachmentMimes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/octet-stream"]);

async function commit(message: string) { await autoCommit(getWorkspaceRoot(), message).catch(() => undefined); }

async function annualContext(year: string) {
  const workspace = loadAnnualWorkspace(); const transactions = await loadAllTransactions();
  const options = annualAccountingOptions(workspace, year, transactions);
  const preview = buildAccountingPreview(transactions, loadAccountingConfig(), year, options);
  const statements = buildAnnualStatements(preview, workspace, year);
  const scheduleIssues = workspace.schedules.filter((schedule) => schedule.transactionIds.some((id) => transactions.some((item) => item.id === id && item.date.startsWith(year))) && schedule.settlement?.status !== "validated").map((schedule) => ({ code: "UNSETTLED_SCHEDULE", message: `${schedule.label} : facture de régularisation non validée.`, scheduleId: schedule.id }));
  const draftAdjustments = workspace.adjustments.filter((item) => item.year === year && item.status !== "validated");
  const draftDocuments = workspace.documents.filter((item) => item.date.startsWith(year) && item.status !== "validated");
  const closingRecord = workspace.closings.find((item) => item.year === year && item.status === "closed");
  const closing = closingRecord ? { ...closingRecord, integrity: closingRecord.fingerprint === annualFingerprint(workspace, preview, year) } : undefined;
  const ready = preview.anomalies.every((item) => item.severity !== "blocking") && scheduleIssues.length === 0 && draftAdjustments.length === 0 && draftDocuments.length === 0 && statements.checklist.every((item) => item.done);
  return { workspace, transactions, preview, statements, scheduleIssues, draftAdjustments: draftAdjustments.length, draftDocuments: draftDocuments.length, closing, ready };
}

export async function annualAccountingRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.get<{ Querystring: { year?: string } }>("/", async (request, reply) => {
    const year = request.query.year ?? String(new Date().getFullYear());
    if (!/^20\d{2}$/.test(year)) return reply.status(400).send({ error: "Exercice invalide." });
    const context = await annualContext(year);
    return { workspace: context.workspace, statements: context.statements, preview: { ...context.preview, lines: undefined }, scheduleIssues: context.scheduleIssues, draftAdjustments: context.draftAdjustments, draftDocuments: context.draftDocuments, closing: context.closing, ready: context.ready,
      transactions: context.transactions.filter((item) => item.date.startsWith(year) && item.status !== "rejected").map(({ id, date, label, amount_ttc, status, reconciled }) => ({ id, date, label, amount_ttc, status, reconciled })) };
  });

  app.post<{ Body: Omit<ThirdPartyAccount, "id"> }>("/third-parties", async (request, reply) => {
    const body = request.body; if (!body?.name?.trim() || !["supplier", "client"].includes(body.kind) || !account(body.accountNumber)) return reply.status(400).send({ error: "Nom, type et compte PCG valide sont obligatoires." });
    const workspace = loadAnnualWorkspace(); const item: ThirdPartyAccount = { ...body, id: `tiers_${nanoid()}`, name: body.name.trim(), accountNumber: body.accountNumber.trim() };
    workspace.thirdParties.push(item); saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: ajout du tiers ${item.name}`); return reply.status(201).send(item);
  });

  app.post<{ Body: Omit<RecurringEvidenceSchedule, "id" | "createdAt"> }>("/schedules", async (request, reply) => {
    const errors = validateSchedule(request.body); if (errors.length) return reply.status(400).send({ error: errors.join(" ") });
    const workspace = loadAnnualWorkspace(); const year = yearOf(request.body.startDate); assertAnnualYearOpen(workspace, year);
    const item: RecurringEvidenceSchedule = { ...request.body, transactionIds: [...new Set(request.body.transactionIds ?? [])], id: `ech_${nanoid()}`, createdAt: new Date().toISOString(), advanceAccount: request.body.advanceAccount || "409100" };
    workspace.schedules.push(item); saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: ajout de l'échéancier ${item.label}`); return reply.status(201).send(item);
  });

  app.post<{ Body: Omit<ThirdPartyDocument, "id"> }>("/documents", async (request, reply) => {
    const errors = validateThirdPartyDocument(request.body); if (errors.length) return reply.status(400).send({ error: errors.join(" ") });
    const workspace = loadAnnualWorkspace(); assertAnnualYearOpen(workspace, yearOf(request.body.date));
    if (!workspace.thirdParties.some((item) => item.id === request.body.thirdPartyId)) return reply.status(400).send({ error: "Le compte tiers sélectionné n'existe pas." });
    const item: ThirdPartyDocument = { ...request.body, id: `fact_${nanoid()}`, paymentTransactionIds: [...new Set(request.body.paymentTransactionIds ?? [])], advanceTransactionIds: [...new Set(request.body.advanceTransactionIds ?? [])] };
    workspace.documents.push(item); saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: facture ${item.invoiceRef}`); return reply.status(201).send(item);
  });

  app.patch<{ Params: { id: string }; Body: Partial<ThirdPartyDocument> }>("/documents/:id", async (request, reply) => {
    const workspace = loadAnnualWorkspace(); const index = workspace.documents.findIndex((item) => item.id === request.params.id); if (index < 0) return reply.status(404).send({ error: "Facture introuvable." });
    const current = workspace.documents[index]; assertAnnualYearOpen(workspace, yearOf(current.date)); const next = { ...current, ...request.body, id: current.id, paymentTransactionIds: [...new Set(request.body.paymentTransactionIds ?? current.paymentTransactionIds)], advanceTransactionIds: [...new Set(request.body.advanceTransactionIds ?? current.advanceTransactionIds)] };
    const errors = validateThirdPartyDocument(next); if (errors.length) return reply.status(400).send({ error: errors.join(" ") }); workspace.documents[index] = next; saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: mise à jour facture ${next.invoiceRef}`); return next;
  });

  app.patch<{ Params: { id: string }; Body: Partial<RecurringEvidenceSchedule> }>("/schedules/:id", async (request, reply) => {
    const workspace = loadAnnualWorkspace(); const index = workspace.schedules.findIndex((item) => item.id === request.params.id); if (index < 0) return reply.status(404).send({ error: "Échéancier introuvable." });
    const current = workspace.schedules[index]; assertAnnualYearOpen(workspace, yearOf(current.startDate));
    const next = { ...current, ...request.body, id: current.id, createdAt: current.createdAt, transactionIds: [...new Set(request.body.transactionIds ?? current.transactionIds)] };
    const errors = validateSchedule(next); if (errors.length) return reply.status(400).send({ error: errors.join(" ") });
    workspace.schedules[index] = next; saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: mise à jour de l'échéancier ${next.label}`); return next;
  });

  app.put<{ Params: { id: string }; Body: SettlementInvoice }>("/schedules/:id/settlement", async (request, reply) => {
    const workspace = loadAnnualWorkspace(); const schedule = workspace.schedules.find((item) => item.id === request.params.id); if (!schedule) return reply.status(404).send({ error: "Échéancier introuvable." });
    assertAnnualYearOpen(workspace, yearOf(request.body.date)); const errors = validateSettlement(request.body); if (errors.length) return reply.status(400).send({ error: errors.join(" ") });
    schedule.settlement = { ...request.body, amountHt: Number(request.body.amountHt), amountVat: Number(request.body.amountVat), amountTtc: Number(request.body.amountTtc) };
    saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: régularisation ${schedule.label}`); return schedule;
  });

  app.post<{ Params: { kind: string; id: string }; Querystring: { target?: string } }>("/upload/:kind/:id", async (request, reply) => {
    const workspace = loadAnnualWorkspace(); const kind = request.params.kind;
    const target = kind === "schedule" || kind === "settlement" ? workspace.schedules.find((entry) => entry.id === request.params.id)
      : kind === "document" ? workspace.documents.find((entry) => entry.id === request.params.id)
      : kind === "adjustment" ? workspace.adjustments.find((entry) => entry.id === request.params.id)
        : kind === "asset" ? workspace.assets.find((entry) => entry.id === request.params.id) : undefined;
    if (!target || (kind === "settlement" && !(target as RecurringEvidenceSchedule).settlement)) return reply.status(404).send({ error: "Élément comptable introuvable." });
    const targetYear = kind === "schedule" ? yearOf((target as RecurringEvidenceSchedule).startDate)
      : kind === "settlement" ? yearOf((target as RecurringEvidenceSchedule).settlement?.date)
        : kind === "document" ? yearOf((target as ThirdPartyDocument).date)
          : kind === "adjustment" ? (target as AdjustmentEntry).year
            : yearOf((target as FixedAsset).acquisitionDate);
    assertAnnualYearOpen(workspace, targetYear);
    const part = await request.file(); if (!part) return reply.status(400).send({ error: "Fichier manquant." });
    const ext = path.extname(part.filename).toLowerCase();
    if (!allowedAttachmentExtensions.has(ext) || !allowedAttachmentMimes.has(part.mimetype)) return reply.status(415).send({ error: "Format refusé : utilise un PDF ou une image JPG, PNG, WebP ou HEIC." });
    const filename = `annual_${request.params.kind}_${request.params.id}_${Date.now()}${ext}`;
    const destination = path.join(getWorkspaceRoot(), "attachments", filename); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, await part.toBuffer());
    if (kind === "schedule") { const item = workspace.schedules.find((entry) => entry.id === request.params.id); if (!item) return reply.status(404).send({ error: "Échéancier introuvable." }); item.attachment = filename; }
    else if (kind === "settlement") { const item = workspace.schedules.find((entry) => entry.id === request.params.id); if (!item?.settlement) return reply.status(404).send({ error: "Régularisation introuvable." }); item.settlement.attachment = filename; }
    else if (kind === "adjustment") { const item = workspace.adjustments.find((entry) => entry.id === request.params.id); if (!item) return reply.status(404).send({ error: "Écriture introuvable." }); item.attachment = filename; }
    else if (kind === "asset") { const item = workspace.assets.find((entry) => entry.id === request.params.id); if (!item) return reply.status(404).send({ error: "Immobilisation introuvable." }); item.attachment = filename; }
    else if (kind === "document") { const item = workspace.documents.find((entry) => entry.id === request.params.id); if (!item) return reply.status(404).send({ error: "Facture introuvable." }); item.attachment = filename; }
    else return reply.status(400).send({ error: "Type de document invalide." });
    saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: ajout d'un justificatif ${kind}`); return { filename };
  });

  app.post<{ Body: Omit<AdjustmentEntry, "id"> }>("/adjustments", async (request, reply) => {
    const body = request.body; if (!/^20\d{2}$/.test(body?.year ?? "") || !body?.label?.trim() || !finitePositive(body.amount) || !account(body.debitAccount) || !account(body.creditAccount)) return reply.status(400).send({ error: "Écriture incomplète : exercice, libellé, montant et comptes PCG sont obligatoires." });
    const workspace = loadAnnualWorkspace(); assertAnnualYearOpen(workspace, body.year); const item: AdjustmentEntry = { ...body, id: `od_${nanoid()}`, amount: Number(body.amount), status: body.status === "validated" ? "validated" : "draft" };
    workspace.adjustments.push(item); saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: écriture ${item.label}`); return reply.status(201).send(item);
  });

  app.patch<{ Params: { id: string }; Body: Partial<AdjustmentEntry> }>("/adjustments/:id", async (request, reply) => {
    const workspace = loadAnnualWorkspace(); const index = workspace.adjustments.findIndex((item) => item.id === request.params.id); if (index < 0) return reply.status(404).send({ error: "Écriture introuvable." });
    const current = workspace.adjustments[index]; assertAnnualYearOpen(workspace, current.year); const next = { ...current, ...request.body, id: current.id, year: current.year };
    if (!next.label.trim() || !finitePositive(next.amount) || !account(next.debitAccount) || !account(next.creditAccount)) return reply.status(400).send({ error: "Écriture incomplète." });
    workspace.adjustments[index] = next; saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: mise à jour écriture ${next.label}`); return next;
  });

  app.post<{ Body: Omit<FixedAsset, "id"> }>("/assets", async (request, reply) => {
    const body = request.body; if (!body?.label?.trim() || !/^20\d{2}-\d{2}-\d{2}$/.test(body.acquisitionDate ?? "") || !finitePositive(body.cost) || !finitePositive(body.durationYears) || ![body.assetAccount, body.depreciationAccount, body.expenseAccount].every(account)) return reply.status(400).send({ error: "Immobilisation incomplète ou comptes PCG invalides." });
    const workspace = loadAnnualWorkspace(); assertAnnualYearOpen(workspace, yearOf(body.acquisitionDate)); const item: FixedAsset = { ...body, id: `immo_${nanoid()}`, cost: Number(body.cost), residualValue: Number(body.residualValue ?? 0), durationYears: Number(body.durationYears) };
    workspace.assets.push(item); saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: immobilisation ${item.label}`); return reply.status(201).send(item);
  });

  app.post<{ Body: Omit<FiscalAdjustment, "id"> }>("/fiscal-adjustments", async (request, reply) => {
    const body = request.body; if (!/^20\d{2}$/.test(body?.year ?? "") || !body?.label?.trim() || !finitePositive(body.amount) || !["reinstatement", "deduction"].includes(body.kind)) return reply.status(400).send({ error: "Correction fiscale incomplète." });
    const workspace = loadAnnualWorkspace(); assertAnnualYearOpen(workspace, body.year); const item: FiscalAdjustment = { ...body, id: `fiscal_${nanoid()}`, amount: Number(body.amount) };
    workspace.fiscalAdjustments.push(item); saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: correction fiscale ${item.label}`); return reply.status(201).send(item);
  });

  app.delete<{ Params: { collection: string; id: string }; Querystring: { year?: string } }>("/:collection/:id", async (request, reply) => {
    const workspace = loadAnnualWorkspace();
    const collections = { "third-parties": "thirdParties", documents: "documents", schedules: "schedules", adjustments: "adjustments", assets: "assets", "fiscal-adjustments": "fiscalAdjustments" } as const;
    const key = collections[request.params.collection as keyof typeof collections]; if (!key) return reply.status(400).send({ error: "Collection invalide." });
    const list = workspace[key] as Array<{ id: string; year?: string; startDate?: string; acquisitionDate?: string }>; const target = list.find((item) => item.id === request.params.id); if (!target) return reply.status(404).send({ error: "Élément introuvable." });
    const inferredYear = target.year ?? yearOf(target.startDate ?? target.acquisitionDate); const targetYear = /^20\d{2}$/.test(inferredYear) ? inferredYear : request.query.year ?? String(new Date().getFullYear()); assertAnnualYearOpen(workspace, targetYear);
    if (key === "thirdParties" && workspace.documents.some((item) => item.thirdPartyId === request.params.id)) return reply.status(409).send({ error: "Ce tiers est utilisé par une facture et ne peut pas être supprimé." });
    const next = list.filter((item) => item.id !== request.params.id);
    (workspace[key] as Array<{ id: string }>) = next; saveAnnualWorkspace(workspace); await commit(`comptabilité annuelle: suppression ${request.params.collection}`); return { ok: true };
  });

  app.put<{ Body: { year: string; check: AnnualCheckId; done: boolean; notes?: string } }>("/confirmation", async (request, reply) => {
    const { year, check, done, notes } = request.body; const allowed: AnnualCheckId[] = ["documents", "bank", "third_parties", "inventory", "assets", "vat", "payroll", "tax", "review"];
    if (!/^20\d{2}$/.test(year) || !allowed.includes(check)) return reply.status(400).send({ error: "Contrôle invalide." });
    const workspace = loadAnnualWorkspace(); assertAnnualYearOpen(workspace, year); let confirmation = workspace.confirmations.find((item) => item.year === year);
    if (!confirmation) { confirmation = { year, checks: {} }; workspace.confirmations.push(confirmation); } confirmation.checks[check] = Boolean(done); if (notes !== undefined) confirmation.notes = notes;
    saveAnnualWorkspace(workspace); return confirmation;
  });

  app.post<{ Body: { year: string } }>("/close", async (request, reply) => {
    if (!/^20\d{2}$/.test(request.body?.year ?? "")) return reply.status(400).send({ error: "Exercice invalide." });
    const context = await annualContext(request.body?.year); if (!context.ready) return reply.status(409).send({ error: "Tous les contrôles doivent être terminés avant la clôture annuelle.", scheduleIssues: context.scheduleIssues, anomalies: context.preview.anomalies, checklist: context.statements.checklist });
    if (annualYearLocked(context.workspace, request.body.year)) return reply.status(409).send({ error: "Cet exercice est déjà clôturé." });
    const record = { year: request.body.year, status: "closed" as const, closedAt: new Date().toISOString(), fingerprint: annualFingerprint(context.workspace, context.preview, request.body.year) };
    context.workspace.closings.unshift(record); saveAnnualWorkspace(context.workspace); await commit(`clôture annuelle: ${record.year} (${record.fingerprint.slice(0, 12)})`); return reply.status(201).send(record);
  });

  app.post<{ Body: { year: string; reason: string } }>("/reopen", async (request, reply) => {
    if (!request.body?.reason?.trim()) return reply.status(400).send({ error: "Un motif de réouverture est obligatoire." });
    const workspace = loadAnnualWorkspace(); const record = workspace.closings.find((item) => item.year === request.body.year && item.status === "closed"); if (!record) return reply.status(404).send({ error: "Exercice clôturé introuvable." });
    record.status = "reopened"; record.reopenedAt = new Date().toISOString(); record.reopenReason = request.body.reason.trim(); saveAnnualWorkspace(workspace); await commit(`réouverture exercice ${record.year}: ${record.reopenReason}`); return record;
  });
}
