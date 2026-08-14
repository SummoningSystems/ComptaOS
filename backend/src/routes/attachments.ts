import { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { loadAllTransactions, updateTransaction } from "../services/transactionService.js";
import { extractReceiptFromDocument, normalizeReceiptProposal, type ReceiptProposal } from "../services/ocrService.js";
import { learnMerchantRule, loadAiConfig, loadMerchantRules, merchantPattern } from "../services/settingsService.js";
import { localOcrUrl, rotateImageLocally, transformImageLocally } from "../services/localOcrService.js";
import { nanoid } from "../utils/id.js";
import { addPendingReceipt, loadPendingReceipts, removePendingReceipt, removePendingReceipts, updatePendingReceipt, type PendingReceipt } from "../services/receiptInboxService.js";
import { recordReconciliation, loadReconciliationHistory } from "../services/reconciliationHistoryService.js";
import { assertMonthOpen } from "../services/closingService.js";

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

  let batchOcr = { running: false, done: 0, total: 0, succeeded: 0, failed: 0, currentName: "" };
  function applyLearnedRule(proposal: ReceiptProposal): ReceiptProposal {
    const rule = loadMerchantRules().find((item) => item.pattern === merchantPattern(proposal.supplier));
    if (!rule) return proposal;
    const vatSplits = proposal.vatSplits.length || rule.vatRate === undefined || proposal.amountTtc <= 0 ? proposal.vatSplits : [{ rate: rule.vatRate, amountTtc: proposal.amountTtc }];
    return { ...proposal, category: rule.category ?? proposal.category, vatSplits, confidence: "high" };
  }
  async function analyzeInboxReceipt(receipt: PendingReceipt): Promise<PendingReceipt> {
    const filePath = path.join(getWorkspaceRoot(), "attachments", path.basename(receipt.filename));
    if (!fsSync.existsSync(filePath)) throw new Error("Fichier justificatif introuvable");
    try { const result = await extractReceiptFromDocument(await fs.readFile(filePath), receipt.mimetype); const proposal = applyLearnedRule(result.proposal); receipt.ocr = { status: "success", proposal, automaticProposal: result.proposal, rawText: result.rawText }; }
    catch (error) { receipt.ocr = { status: "error", message: error instanceof Error ? error.message : "Analyse OCR impossible" }; }
    await updatePendingReceipt(receipt);
    return receipt;
  }

  app.get("/inbox", async (_req, reply) => reply.send(await loadPendingReceipts()));

  app.get("/inbox/analyze-batch", async (_req, reply) => reply.send(batchOcr));

  app.post<{ Body: { ids?: string[] } }>("/inbox/analyze-batch", async (req, reply) => {
    if (batchOcr.running) return reply.status(202).send(batchOcr);
    const requestedIds = new Set(Array.isArray(req.body?.ids) ? req.body.ids : []);
    const receipts = (await loadPendingReceipts()).filter((receipt) => requestedIds.size ? requestedIds.has(receipt.id) : receipt.ocr.status !== "success");
    batchOcr = { running: receipts.length > 0, done: 0, total: receipts.length, succeeded: 0, failed: 0, currentName: receipts[0]?.originalName ?? "" };
    if (receipts.length > 0) void (async () => {
      for (const receipt of receipts) {
        batchOcr.currentName = receipt.originalName;
        try { const analyzed = await analyzeInboxReceipt(receipt); analyzed.ocr.status === "success" ? batchOcr.succeeded += 1 : batchOcr.failed += 1; }
        catch { batchOcr.failed += 1; }
        batchOcr.done += 1;
      }
      batchOcr.running = false; batchOcr.currentName = "";
    })();
    return reply.status(202).send(batchOcr);
  });

  app.post<{ Querystring: { skipOcr?: string } }>("/inbox", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: "Aucun fichier reçu" });
    if (!ALLOWED_MIMES.has(data.mimetype)) return reply.status(400).send({ error: "Type de fichier non accepté. Formats acceptés : PDF, JPEG, PNG, WEBP, GIF." });

    const id = `receipt_${nanoid()}`;
    const ext = path.extname(data.filename) || ".bin";
    const filename = `${id}_${Date.now()}${ext}`;
    const attachmentsDir = path.join(getWorkspaceRoot(), "attachments");
    await fs.mkdir(attachmentsDir, { recursive: true });
    const buffer = await data.toBuffer();
    await fs.writeFile(path.join(attachmentsDir, filename), buffer);

    let ocr: PendingReceipt["ocr"] = { status: "unavailable", message: "OCR non configuré" };
    const aiConfig = loadAiConfig();
    const hasRemoteOcr = Boolean(aiConfig?.mistralApiKey ?? process.env.MISTRAL_API_KEY) && Boolean(aiConfig?.apiKey);
    if (req.query.skipOcr !== "true" && (localOcrUrl() || hasRemoteOcr)) {
      try { const result = await extractReceiptFromDocument(buffer, data.mimetype); ocr = { status: "success", proposal: applyLearnedRule(result.proposal), automaticProposal: result.proposal, rawText: result.rawText }; }
      catch (error) { ocr = { status: "error", message: error instanceof Error ? error.message : "Analyse OCR impossible" }; }
    }
    const receipt: PendingReceipt = { id, filename, originalName: path.basename(data.filename), mimetype: data.mimetype, createdAt: new Date().toISOString(), ocr };
    await addPendingReceipt(receipt);
    return reply.status(201).send(receipt);
  });

  app.post<{ Params: { id: string } }>("/inbox/:id/analyze", async (req, reply) => {
    const receipt = (await loadPendingReceipts()).find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    try { return reply.send(await analyzeInboxReceipt(receipt)); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : "Analyse impossible" }); }
  });

  app.patch<{ Params: { id: string }; Body: { proposal: unknown } }>("/inbox/:id/ocr", async (req, reply) => {
    const receipt = (await loadPendingReceipts()).find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    const proposal = normalizeReceiptProposal(req.body?.proposal);
    if (proposal.amountTtc <= 0) return reply.status(400).send({ error: "Le montant TTC doit être supérieur à zéro" });
    if (proposal.vatSplits.length && Math.abs(proposal.vatSplits.reduce((sum, row) => sum + row.amountTtc, 0) - proposal.amountTtc) >= 0.02) return reply.status(400).send({ error: "La somme de la ventilation TVA doit correspondre au TTC" });
    receipt.ocr = { ...receipt.ocr, status: "success", automaticProposal: receipt.ocr.automaticProposal ?? receipt.ocr.proposal, proposal, validatedAt: new Date().toISOString(), message: "Données vérifiées manuellement" };
    learnMerchantRule(proposal.supplier, { category: proposal.category, vatRate: proposal.vatSplits.length === 1 ? proposal.vatSplits[0].rate : undefined });
    await updatePendingReceipt(receipt); return reply.send(receipt);
  });

  app.post<{ Params: { id: string }; Body: { degrees: -90 | 90 | 180 } }>("/inbox/:id/rotate", async (req, reply) => {
    const receipt = (await loadPendingReceipts()).find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    if (!receipt.mimetype.startsWith("image/")) return reply.status(415).send({ error: "Seules les images peuvent être tournées" });
    if (![-90, 90, 180].includes(req.body?.degrees)) return reply.status(400).send({ error: "Rotation invalide" });
    const filePath = path.join(getWorkspaceRoot(), "attachments", path.basename(receipt.filename));
    if (!fsSync.existsSync(filePath)) return reply.status(404).send({ error: "Fichier justificatif introuvable" });
    try {
      const rotated = await rotateImageLocally(await fs.readFile(filePath), receipt.mimetype, req.body.degrees);
      await fs.writeFile(filePath, rotated);
      receipt.mimetype = "image/jpeg";
      receipt.ocr = { status: "unavailable", message: `Orientation corrigée ${Date.now()}, OCR à relancer` };
      await updatePendingReceipt(receipt);
      return reply.send(receipt);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : "Rotation impossible" });
    }
  });

  app.post<{ Params: { id: string }; Body: { operation: "enhance" | "crop" } }>("/inbox/:id/transform", async (req, reply) => {
    const receipt = (await loadPendingReceipts()).find((item) => item.id === req.params.id);
    if (!receipt || !receipt.mimetype.startsWith("image/")) return reply.status(404).send({ error: "Image en attente introuvable" });
    if (!['enhance', 'crop'].includes(req.body?.operation)) return reply.status(400).send({ error: "Transformation invalide" });
    const filePath = path.join(getWorkspaceRoot(), "attachments", path.basename(receipt.filename));
    const transformed = await transformImageLocally(await fs.readFile(filePath), receipt.mimetype, req.body.operation);
    await fs.writeFile(filePath, transformed); receipt.mimetype = "image/jpeg"; receipt.ocr = { status: "unavailable", message: `Image préparée ${Date.now()}, OCR à relancer` }; await updatePendingReceipt(receipt); return reply.send(receipt);
  });

  type LinkBody = { transactionId: string; applyProposal?: boolean; score?: number; reasons?: string[] };
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  function aggregateProposal(receipts: PendingReceipt[]) {
    const proposals = receipts.map((item) => item.ocr.proposal).filter((item): item is ReceiptProposal => Boolean(item));
    if (!proposals.length) return undefined;
    return {
      supplier: proposals.length > 1 ? `${proposals.length} justificatifs` : proposals[0].supplier,
      invoiceRef: proposals.map((item) => item.invoiceRef).filter(Boolean).join(" + ") || undefined,
      amountHt: round(proposals.reduce((sum, item) => sum + item.amountHt, 0)),
      amountVat: round(proposals.reduce((sum, item) => sum + (item.amountVat ?? item.amountTtc - item.amountHt), 0)),
      amountTtc: round(proposals.reduce((sum, item) => sum + item.amountTtc, 0)),
      category: proposals.find((item) => item.category !== "misc")?.category ?? proposals[0].category,
      confidence: "high" as const,
      vatSplits: proposals.flatMap((item) => item.vatSplits).reduce<Array<{ rate: number; amountTtc: number }>>((rows, split) => {
        const row = rows.find((item) => item.rate === split.rate);
        if (row) row.amountTtc = round(row.amountTtc + Math.abs(split.amountTtc));
        else rows.push({ rate: split.rate, amountTtc: Math.abs(split.amountTtc) });
        return rows;
      }, []),
    };
  }
  function transactionPatch(current: Awaited<ReturnType<typeof loadAllTransactions>>[number], receipts: PendingReceipt[], applyProposal: boolean, ratio = 1) {
    const filenames = [...new Set([...(current.attachments ?? []), ...(current.attachment ? [current.attachment] : []), ...receipts.map((item) => item.filename)])];
    const details = [...(current.attachment_details ?? []).filter((item) => !receipts.some((receipt) => receipt.filename === item.filename)), ...receipts.map((receipt) => {
      const proposal = receipt.ocr.proposal;
      return { filename: receipt.filename, originalName: receipt.originalName, amount_ht: proposal ? round(proposal.amountHt * ratio) : undefined, vat: proposal ? round((proposal.amountVat ?? proposal.amountTtc - proposal.amountHt) * ratio) : undefined, amount_ttc: proposal ? round(proposal.amountTtc * ratio) : undefined, invoiceRef: proposal?.invoiceRef, vat_splits: proposal?.vatSplits.map((split) => ({ rate: split.rate, amount_ttc: round(split.amountTtc * ratio) })) };
    })];
    const proposal = aggregateProposal(receipts);
    const sign = current.amount_ttc < 0 ? -1 : 1;
    const accountingSplits = details.flatMap((item) => item.vat_splits ?? []).reduce<Array<{ rate: number; amount_ttc: number }>>((rows, split) => {
      const row = rows.find((item) => item.rate === split.rate);
      if (row) row.amount_ttc = round(row.amount_ttc + Math.abs(split.amount_ttc)); else rows.push({ rate: split.rate, amount_ttc: Math.abs(split.amount_ttc) });
      return rows;
    }, []);
    const accounting = applyProposal && proposal ? {
      amount_ht: round(sign * details.reduce((sum, item) => sum + Math.abs(item.amount_ht ?? 0), 0)),
      vat: round(sign * details.reduce((sum, item) => sum + Math.abs(item.vat ?? 0), 0)),
      vat_splits: accountingSplits.map((split) => ({ rate: split.rate, amount_ttc: round(sign * split.amount_ttc) })),
      category: proposal.category,
      invoiceRef: details.map((item) => item.invoiceRef).filter(Boolean).join(" + ") || current.invoiceRef,
    } : {};
    return { attachment: filenames[0], attachments: filenames, attachment_details: details, justified: true, ...accounting };
  }

  app.get("/inbox/reconciliation-history", async (_req, reply) => reply.send((await loadReconciliationHistory()).slice(0, 25)));

  app.post<{ Params: { id: string }; Body: LinkBody }>("/inbox/:id/link", async (req, reply) => {
    const receipt = (await loadPendingReceipts()).find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    const current = (await loadAllTransactions()).find((item) => item.id === req.body?.transactionId);
    if (!current) return reply.status(404).send({ error: "Transaction introuvable" });
    const proposal = aggregateProposal([receipt]);
    const documented = current.attachment_details?.reduce((sum, item) => sum + Math.abs(item.amount_ttc ?? 0), 0) ?? 0;
    const apply = req.body.applyProposal !== false && Boolean(proposal) && Math.abs(Math.abs(current.amount_ttc) - documented - (proposal?.amountTtc ?? 0)) <= 0.05;
    const transaction = await updateTransaction(current.id, transactionPatch(current, [receipt], apply));
    await removePendingReceipt(receipt.id);
    await recordReconciliation({ mode: "single", receiptIds: [receipt.id], transactionIds: [current.id], score: req.body.score, reasons: req.body.reasons ?? [], appliedProposal: apply });
    return reply.send({ transactions: [transaction], transaction, proposal, appliedProposal: apply });
  });

  app.post<{ Body: { receiptIds: string[]; transactionId: string; score?: number; reasons?: string[] } }>("/inbox/link-group", async (req, reply) => {
    const wanted = new Set(req.body?.receiptIds ?? []);
    const receipts = (await loadPendingReceipts()).filter((item) => wanted.has(item.id));
    if (!wanted.size || receipts.length !== wanted.size) return reply.status(404).send({ error: "Un justificatif en attente est introuvable" });
    const current = (await loadAllTransactions()).find((item) => item.id === req.body.transactionId);
    if (!current) return reply.status(404).send({ error: "Transaction introuvable" });
    const proposal = aggregateProposal(receipts);
    const documented = current.attachment_details?.reduce((sum, item) => sum + Math.abs(item.amount_ttc ?? 0), 0) ?? 0;
    const apply = Boolean(proposal) && Math.abs(Math.abs(current.amount_ttc) - documented - (proposal?.amountTtc ?? 0)) <= 0.05;
    const transaction = await updateTransaction(current.id, transactionPatch(current, receipts, apply));
    await removePendingReceipts(receipts.map((item) => item.id));
    await recordReconciliation({ mode: "many-receipts", receiptIds: receipts.map((item) => item.id), transactionIds: [current.id], score: req.body.score, reasons: req.body.reasons ?? [], appliedProposal: apply });
    return reply.send({ transactions: [transaction], transaction, proposal, appliedProposal: apply });
  });

  app.post<{ Params: { id: string }; Body: { transactionIds: string[]; score?: number; reasons?: string[] } }>("/inbox/:id/link-many", async (req, reply) => {
    const receipt = (await loadPendingReceipts()).find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    const wanted = new Set(req.body?.transactionIds ?? []);
    const transactions = (await loadAllTransactions()).filter((item) => wanted.has(item.id));
    if (wanted.size < 2 || transactions.length !== wanted.size) return reply.status(404).send({ error: "Une transaction est introuvable" });
    await Promise.all(transactions.map((item) => assertMonthOpen(item.date)));
    const total = transactions.reduce((sum, item) => sum + Math.abs(item.amount_ttc), 0);
    const proposal = aggregateProposal([receipt]);
    if (!proposal || Math.abs(total - proposal.amountTtc) > 0.05) return reply.status(400).send({ error: "La somme des paiements ne correspond pas au TTC du justificatif" });
    const updated = [];
    for (const current of transactions) updated.push(await updateTransaction(current.id, transactionPatch(current, [receipt], true, Math.abs(current.amount_ttc) / total)));
    await removePendingReceipt(receipt.id);
    await recordReconciliation({ mode: "split-payment", receiptIds: [receipt.id], transactionIds: transactions.map((item) => item.id), score: req.body.score, reasons: req.body.reasons ?? [], appliedProposal: true });
    return reply.send({ transactions: updated, transaction: updated[0], proposal, appliedProposal: true });
  });

  app.delete<{ Params: { id: string } }>("/inbox/:id", async (req, reply) => {
    const receipt = await removePendingReceipt(req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    try { await fs.unlink(path.join(getWorkspaceRoot(), "attachments", path.basename(receipt.filename))); } catch { /* fichier absent */ }
    return reply.send({ ok: true });
  });

  /**
   * POST /api/attachments/upload/:txnId
   * Multipart field "file" → PDF ou image
   * Sauvegarde dans workspace/attachments/, met à jour transaction.attachment
   */
  app.post<{ Params: { txnId: string }; Querystring: { skipOcr?: string } }>(
    "/upload/:txnId",
    async (req, reply) => {
      const { txnId } = req.params;
      const current = (await loadAllTransactions()).find((transaction) => transaction.id === txnId);

      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: "Aucun fichier reçu" });
      }

      if (!ALLOWED_MIMES.has(data.mimetype)) {
        return reply.status(400).send({
          error: "Type de fichier non accepté. Formats acceptés : PDF, JPEG, PNG, WEBP, GIF.",
        });
      }

      const ext = path.extname(data.filename) || ".bin";
      // Nom unique : txnId + timestamp + ext
      const filename = `${txnId}_${Date.now()}${ext}`;

      const attachmentsDir = path.join(getWorkspaceRoot(), "attachments");
      await fs.mkdir(attachmentsDir, { recursive: true });
      const buffer = await data.toBuffer();
      await fs.writeFile(path.join(attachmentsDir, filename), buffer);

      // Attacher d'abord la pièce : une indisponibilité OCR ne doit jamais faire perdre l'upload.
      const filenames = [...new Set([...(current?.attachments ?? []), ...(current?.attachment ? [current.attachment] : []), filename])];
      const updated = await updateTransaction(txnId, { attachment: filenames[0], attachments: filenames, justified: true });

      let ocr: { status: "success" | "unavailable" | "error"; proposal?: ReceiptProposal; message?: string } = { status: "unavailable", message: "OCR non configuré" };
      if (req.query.skipOcr === "true") return reply.status(201).send({ filename, transaction: updated, ocr: { status: "unavailable", message: "OCR différé" } });
      const aiConfig = loadAiConfig();
      const hasRemoteOcr = Boolean(aiConfig?.mistralApiKey ?? process.env.MISTRAL_API_KEY) && Boolean(aiConfig?.apiKey);
      if (localOcrUrl() || hasRemoteOcr) {
        try {
          const result = await extractReceiptFromDocument(buffer, data.mimetype, { expectedTtc: Math.abs(updated.amount_ttc) });
          ocr = { status: "success", proposal: result.proposal.category === "misc" && updated.category !== "misc" ? { ...result.proposal, category: updated.category } : result.proposal };
        } catch (error) {
          ocr = { status: "error", message: error instanceof Error ? error.message : "Analyse OCR impossible" };
        }
      }

      return reply.status(201).send({ filename, transaction: updated, ocr });
    }
  );

  /** Analyse à la demande une pièce déjà enregistrée. */
  app.post<{ Params: { txnId: string } }>("/analyze/:txnId", async (req, reply) => {
    const transaction = (await loadAllTransactions()).find((item) => item.id === req.params.txnId);
    if (!transaction?.attachment) return reply.status(404).send({ error: "Aucune pièce jointe à analyser" });
    const safe = path.basename(transaction.attachment);
    const filePath = path.join(getWorkspaceRoot(), "attachments", safe);
    if (!fsSync.existsSync(filePath)) return reply.status(404).send({ error: "Fichier joint introuvable" });
    const ext = path.extname(safe).toLowerCase();
    const mimeMap: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
    const mimetype = mimeMap[ext];
    if (!mimetype) return reply.status(400).send({ error: "Format non compatible avec l’OCR" });
    try {
      const result = await extractReceiptFromDocument(await fs.readFile(filePath), mimetype, { expectedTtc: Math.abs(transaction.amount_ttc) });
      const proposal = result.proposal.category === "misc" && transaction.category !== "misc" ? { ...result.proposal, category: transaction.category } : result.proposal;
      return reply.send({ transaction, ocr: { status: "success", proposal } });
    } catch (error) {
      return reply.send({ transaction, ocr: { status: "error", message: error instanceof Error ? error.message : "Analyse OCR impossible" } });
    }
  });

  /**
   * DELETE /api/attachments/:txnId
   * Supprime la pièce jointe et remet attachment à undefined
   */
  app.delete<{ Params: { txnId: string }; Body: { filename: string } }>(
    "/:txnId",
    async (req, reply) => {
      const { txnId } = req.params;
      const { filename } = req.body ?? {};

      if (filename) {
        const filePath = path.join(getWorkspaceRoot(), "attachments", path.basename(filename));
        try { await fs.unlink(filePath); } catch { /* ignore si déjà absent */ }
      }

      const transaction = (await loadAllTransactions()).find((item) => item.id === txnId);
      const remaining = [...new Set([...(transaction?.attachments ?? []), ...(transaction?.attachment ? [transaction.attachment] : [])])].filter((item) => item !== filename);
      const updated = await updateTransaction(txnId, { attachment: remaining[0], attachments: remaining, attachment_details: transaction?.attachment_details?.filter((item) => item.filename !== filename), justified: remaining.length > 0 });
      return reply.send({ ok: true, transaction: updated });
    }
  );

  /**
   * GET /api/attachments/:filename
   * Sert le fichier depuis workspace/attachments/
   */
  app.get<{ Params: { filename: string } }>("/file/:filename", async (req, reply) => {
    // Sanitize : interdire traversal (../)
    const safe = path.basename(req.params.filename);
    const filePath = path.join(getWorkspaceRoot(), "attachments", safe);

    if (!fsSync.existsSync(filePath)) {
      return reply.status(404).send({ error: "Fichier non trouvé" });
    }

    const ext = path.extname(safe).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";

    const stream = fsSync.createReadStream(filePath);
    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `inline; filename="${safe}"`)
      .send(stream);
  });
}
