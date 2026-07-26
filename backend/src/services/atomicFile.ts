import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";

/**
 * Écrit un fichier sans exposer de contenu partiel : les octets sont d'abord
 * synchronisés dans un fichier temporaire voisin, puis renommés sur la cible.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await fs.mkdir(directory, { recursive: true });

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Variante synchrone pour les services dont l'API publique est synchrone. */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  mkdirSync(directory, { recursive: true });

  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, content, "utf-8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* déjà fermé */ }
    }
    try { unlinkSync(temporaryPath); } catch { /* rien à nettoyer */ }
    throw error;
  }
}
