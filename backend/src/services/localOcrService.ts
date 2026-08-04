const DEFAULT_TIMEOUT_MS = 45_000;

export function localOcrUrl(): string | undefined {
  return process.env.OCR_LOCAL_URL?.replace(/\/$/, "");
}

export async function extractTextLocally(buffer: Buffer, mimetype: string): Promise<string> {
  const baseUrl = localOcrUrl();
  if (!baseUrl) throw new Error("Service OCR local non configuré");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OCR_LOCAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Mime-Type": mimetype },
      body: buffer as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OCR local indisponible (${response.status})`);
    const result = await response.json() as { text?: unknown };
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("Aucun texte reconnu par l'OCR local");
    return result.text;
  } finally {
    clearTimeout(timeout);
  }
}
