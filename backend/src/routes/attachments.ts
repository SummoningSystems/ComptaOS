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

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

  /**
   * POST /api/attachments/upload/:txnId
   * Multipart field "file" → PDF ou image
   * Sauvegarde dans workspace/attachments/, met à jour transaction.attachment
   */
  app.post<{ Params: { txnId: string } }>(
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
