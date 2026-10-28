import sharp from "sharp";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MIN_DIMENSION = 200;
export const MAX_DIMENSION = 6000;
export const OUTPUT_MAX_SIDE = 1600;

export type ImageErrorCode = "empty" | "too_large" | "type" | "corrupt" | "dimensions";

export class ImageError extends Error {
  constructor(
    public code: ImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageError";
  }
}

/** Detecta el formato por firma binaria (no confia en el MIME ni la extension del cliente). */
export function sniffImageType(b: Buffer): "jpeg" | "png" | "webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP")
    return "webp";
  return null;
}

export interface ProcessedImage {
  data: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
}

/**
 * Valida y normaliza una imagen subida: tamano, firma, dimensiones y decodificacion real.
 * Se re-codifica a WebP: elimina EXIF/metadatos (incluida geolocalizacion) y cualquier carga embebida.
 */
export async function processImageUpload(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageError("empty", "El archivo esta vacio.");
  if (input.length > MAX_IMAGE_BYTES) throw new ImageError("too_large", "La imagen supera el maximo de 3 MB.");
  if (!sniffImageType(input)) throw new ImageError("type", "Formato no permitido. Use JPEG, PNG o WebP.");
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION }).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < MIN_DIMENSION || h < MIN_DIMENSION)
      throw new ImageError("dimensions", `La imagen debe medir al menos ${MIN_DIMENSION}x${MIN_DIMENSION} px.`);
    if (w > MAX_DIMENSION || h > MAX_DIMENSION)
      throw new ImageError("dimensions", `La imagen no puede superar ${MAX_DIMENSION} px por lado.`);
    const { data, info } = await sharp(input, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
      .rotate()
      .resize({ width: OUTPUT_MAX_SIDE, height: OUTPUT_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, contentType: "image/webp", width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("corrupt", "No se pudo leer la imagen: el archivo esta danado.");
  }
}
