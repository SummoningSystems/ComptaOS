import { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { loadAllTransactions, updateTransaction } from "../services/transactionService.js";
import { extractReceiptFromDocument, type ReceiptProposal } from "../services/ocrService.js";
import { loadAiConfig } from "../services/settingsService.js";
import { localOcrUrl } from "../services/localOcrService.js";
import { nanoid } from "../utils/id.js";
import { addPendingReceipt, loadPendingReceipts, removePendingReceipt, type PendingReceipt } from "../services/receiptInboxService.js";

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

  app.get("/inbox", async (_req, reply) => reply.send(await loadPendingReceipts()));

  app.post("/inbox", async (req, reply) => {
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
    if (localOcrUrl() || hasRemoteOcr) {
      try { ocr = { status: "success", proposal: (await extractReceiptFromDocument(buffer, data.mimetype)).proposal }; }
      catch (error) { ocr = { status: "error", message: error instanceof Error ? error.message : "Analyse OCR impossible" }; }
    }
    const receipt: PendingReceipt = { id, filename, originalName: path.basename(data.filename), mimetype: data.mimetype, createdAt: new Date().toISOString(), ocr };
    await addPendingReceipt(receipt);
    return reply.status(201).send(receipt);
  });

  app.post<{ Params: { id: string }; Body: { transactionId: string } }>("/inbox/:id/link", async (req, reply) => {
    const receipts = await loadPendingReceipts();
    const receipt = receipts.find((item) => item.id === req.params.id);
    if (!receipt) return reply.status(404).send({ error: "Justificatif en attente introuvable" });
    const current = (await loadAllTransactions()).find((item) => item.id === req.body?.transactionId);
    if (!current) return reply.status(404).send({ error: "Transaction introuvable" });
    const transaction = await updateTransaction(current.id, { attachment: receipt.filename, justified: true });
    await removePendingReceipt(receipt.id);
    if (current.attachment && current.attachment !== receipt.filename) {
      try { await fs.unlink(path.join(getWorkspaceRoot(), "attachments", path.basename(current.attachment))); } catch { /* ancien fichier absent */ }
    }
    return reply.send({ transaction, proposal: receipt.ocr.proposal });
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
      const previousAttachment = (await loadAllTransactions()).find((transaction) => transaction.id === txnId)?.attachment;

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
      const updated = await updateTransaction(txnId, { attachment: filename, justified: true });
      if (previousAttachment && previousAttachment !== filename) {
        try { await fs.unlink(path.join(attachmentsDir, path.basename(previousAttachment))); } catch { /* ancien fichier déjà absent */ }
      }

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

      const updated = await updateTransaction(txnId, { attachment: undefined });
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
