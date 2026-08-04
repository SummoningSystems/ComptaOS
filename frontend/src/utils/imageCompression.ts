export interface CompressionResult {
  file: File;
  compressed: boolean;
  originalBytes: number;
  uploadedBytes: number;
  savedPercent: number;
}

export const IMAGE_COMPRESSION_THRESHOLD = 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 2200;

export function calculateTargetDimensions(width: number, height: number, maxDimension = IMAGE_MAX_DIMENSION) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function shouldCompressImage(file: Pick<File, "type" | "size">): boolean {
  return file.type.startsWith("image/") && file.type !== "image/gif" && (file.size > IMAGE_COMPRESSION_THRESHOLD || /hei[cf]/i.test(file.type));
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Cette image ne peut pas être décodée par le navigateur.")); image.src = url; });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("La compression de l'image a échoué.")), "image/jpeg", quality));
}

export async function compressAttachment(file: File): Promise<CompressionResult> {
  const base = { file, compressed: false, originalBytes: file.size, uploadedBytes: file.size, savedPercent: 0 };
  if (!shouldCompressImage(file)) return base;
  const image = await loadImage(file); const dimensions = calculateTargetDimensions(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas"); canvas.width = dimensions.width; canvas.height = dimensions.height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("La compression d'image n'est pas disponible.");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let blob = await canvasBlob(canvas, 0.84);
  if (blob.size > 1_500_000) blob = await canvasBlob(canvas, 0.72);
  if (blob.size > 1_500_000) blob = await canvasBlob(canvas, 0.62);
  const forcedConversion = /hei[cf]/i.test(file.type);
  if (!forcedConversion && blob.size >= file.size) return base;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  const compressed = new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  return { file: compressed, compressed: true, originalBytes: file.size, uploadedBytes: compressed.size, savedPercent: Math.max(0, Math.round((1 - compressed.size / file.size) * 100)) };
}
