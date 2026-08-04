import { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import path from "path";
import fs from "fs/promises";
import { extractInvoiceFromPdf } from "../services/ocrService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { loadAiConfig } from "../services/settingsService.js";
import { localOcrUrl } from "../services/localOcrService.js";

export async function ocrRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  app.post("/invoice", async (req, reply) => {
    const config = loadAiConfig();
    const remoteConfigured = Boolean(config?.mistralApiKey ?? process.env.MISTRAL_API_KEY) && Boolean(config?.apiKey);
    if (!localOcrUrl() && !remoteConfigured) {
      return reply.status(503).send({ error: "OCR local indisponible. La saisie manuelle reste disponible." });
    }

    const data = await req.file();
    if (!data) return reply.status(400).send({ error: "Aucun fichier reçu" });
    if (data.mimetype !== "application/pdf") return reply.status(400).send({ error: "Seuls les fichiers PDF sont acceptés" });

    const buffer = await data.toBuffer();
    const filename = path.basename(data.filename);
    const attachmentsDir = path.join(getWorkspaceRoot(), "attachments");
    await fs.mkdir(attachmentsDir, { recursive: true });
    await fs.writeFile(path.join(attachmentsDir, filename), buffer);

    const { invoice, rawText } = await extractInvoiceFromPdf(buffer, filename);
    return reply.send({ invoice, rawText: rawText.slice(0, 500) });
  });
}
