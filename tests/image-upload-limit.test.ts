import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { MAX_IMAGE_BYTES, processImageUpload } from "@/modules/storage/image";

const MB = 1024 * 1024;

function toBytes(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(v ?? "1mb");
  if (!m) throw new Error(`bodySizeLimit no reconocido: ${v}`);
  return Number(m[1]) * { b: 1, kb: 1024, mb: MB, gb: 1024 * MB }[m[2].toLowerCase() as "b" | "kb" | "mb" | "gb"];
}

const noise = (w: number, h: number) => {
  const b = randomBytes(w * h * 3);
  return sharp(b, { raw: { width: w, height: h, channels: 3 } });
};

describe("regresión: subida de imágenes de hasta 3 MB", () => {
  it("el límite de cuerpo de Server Actions (por defecto 1 MB) admite el máximo de imagen más la sobrecarga multipart", () => {
    const limit = toBytes(nextConfig.experimental?.serverActions?.bodySizeLimit);
    expect(limit).toBeGreaterThan(MAX_IMAGE_BYTES + 64 * 1024);
  });

  it("el control de cliente usa el mismo máximo que el servidor", () => {
    const src = readFileSync(path.join(__dirname, "../src/modules/raffles/image-control.tsx"), "utf8");
    expect(src).toMatch(/MAX_IMAGE_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/);
    expect(MAX_IMAGE_BYTES).toBe(3 * MB);
  });

  it.each(["jpeg", "png", "webp"] as const)("procesa un %s válido de más de 1 MB sin superar 3 MB", async (fmt) => {
    const opts = { jpeg: { quality: 95 }, png: {}, webp: { quality: 95, effort: 0 } }[fmt];
    const [w, h] = { jpeg: [1400, 1000], png: [700, 500], webp: [1400, 1000] }[fmt];
    const buf = await noise(w, h)[fmt](opts as never).toBuffer();
    expect(buf.length).toBeGreaterThan(1 * MB);
    expect(buf.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const out = await processImageUpload(buf);
    expect(out.contentType).toBe("image/webp");
    expect(out.data.length).toBeGreaterThan(0);
  });
});
