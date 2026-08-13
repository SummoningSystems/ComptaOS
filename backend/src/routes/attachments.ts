import { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { loadAllTransactions, updateTransaction } from "../services/transactionService.js";
import { extractReceiptFromDocument, type ReceiptProposal } from "../services/ocrService.js";
import { loadAiConfig } from "../services/settingsService.js";
import { localOcrUrl, rotateImageLocally } from "../services/localOcrService.js";
import { nanoid } from "../utils/id.js";
import { addPendingReceipt, loadPendingReceipts, removePendingReceipt, updatePendingReceipt, type PendingReceipt } from "../services/receiptInboxService.js";

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
  async function analyzeInboxReceipt(receipt: PendingReceipt): Promise<PendingReceipt> {
    const filePath = path.join(getWorkspaceRoot(), "attachments", path.basename(receipt.filename));
    if (!fsSync.existsSync(filePath)) throw new Error("Fichier justificatif introuvable");
    try { receipt.ocr = { status: "success", proposal: (await extractReceiptFromDocument(await fs.readFile(filePath), receipt.mimetype)).proposal }; }
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
      try { ocr = { status: "success", proposal: (await extractReceiptFromDocument(buffer, data.mimetype)).proposal }; }
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

  app.post<{ Params: { id: string }; Body: { transactionId: string } }>("/inbox/:id/link", async (req, reply) => {
    const receipts = await loadPendingReceipts();
    const receipt = receipts.find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    const current = (await loadAllTransactions()).find((item) => item.id === req.body?.transactionId);
    if (!current) return reply.status(404).send({ error: "Transaction introuvable" });
    const filenames = [...new Set([...(current.attachments ?? []), ...(current.attachment ? [current.attachment] : []), receipt.filename])];
    const proposal = receipt.ocr.proposal;
    const details = [...(current.attachment_details ?? []).filter((item) => item.filename !== receipt.filename), {
      filename: receipt.filename, originalName: receipt.originalName,
      amount_ht: proposal?.amountHt, vat: proposal?.amountVat, amount_ttc: proposal?.amountTtc,
      invoiceRef: proposal?.invoiceRef,
      vat_splits: proposal?.vatSplits.map((split) => ({ rate: split.rate, amount_ttc: split.amountTtc })),
    }];
    const transaction = await updateTransaction(current.id, { attachment: filenames[0], attachments: filenames, attachment_details: details, justified: true });
    await removePendingReceipt(receipt.id);
    const analyzed = details.filter((item) => Number.isFinite(item.amount_ttc));
    const aggregateProposal = analyzed.length ? {
      supplier: analyzed.length > 1 ? `${analyzed.length} justificatifs` : proposal?.supplier ?? receipt.originalName,
      invoiceRef: analyzed.map((item) => item.invoiceRef).filter(Boolean).join(" + ") || undefined,
      amountHt: analyzed.reduce((sum, item) => sum + (item.amount_ht ?? 0), 0),
      amountVat: analyzed.reduce((sum, item) => sum + (item.vat ?? 0), 0),
      amountTtc: analyzed.reduce((sum, item) => sum + (item.amount_ttc ?? 0), 0),
      category: proposal?.category ?? current.category, confidence: "high" as const,
      vatSplits: analyzed.flatMap((item) => item.vat_splits ?? []).reduce<Array<{ rate: number; amountTtc: number }>>((items, split) => {
        const existing = items.find((item) => item.rate === split.rate);
        if (existing) existing.amountTtc += Math.abs(split.amount_ttc); else items.push({ rate: split.rate, amountTtc: Math.abs(split.amount_ttc) });
        return items;
      }, []),
    } : proposal;
    return reply.send({ transaction, proposal: aggregateProposal });
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
          const result = await extractReceiptFromDocument(buffer, data.mimetype);
          ocr = { status: "success", proposal: result.proposal };
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
      const result = await extractReceiptFromDocument(await fs.readFile(filePath), mimetype);
      return reply.send({ transaction, ocr: { status: "success", proposal: result.proposal } });
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
