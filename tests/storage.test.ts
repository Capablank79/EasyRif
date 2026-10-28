import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageError, MAX_IMAGE_BYTES, processImageUpload, sniffImageType } from "@/modules/storage/image";
import { LocalDiskStorage, newStorageKey } from "@/modules/storage/provider";
import { deriveAccessToken, getReservationConfig, validateBuyer } from "@/modules/reservations/service";
import { rateLimit } from "@/modules/reservations/rate-limit";

const solid = (w: number, h: number, fmt: "jpeg" | "png" | "webp" = "png") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 80, b: 200 } } })[fmt]().toBuffer();

describe("subida de imagenes", () => {
  it("acepta JPEG, PNG y WebP validos y re-codifica a WebP", async () => {
    for (const f of ["jpeg", "png", "webp"] as const) {
      const out = await processImageUpload(await solid(400, 300, f));
      expect(sniffImageType(out.data)).toBe("webp");
      expect(out).toMatchObject({ contentType: "image/webp", width: 400, height: 300 });
    }
  });

  it("elimina EXIF (incluida geolocalizacion)", async () => {
    const withExif = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#123456" } })
      .withExif({ IFD0: { Copyright: "SECRETO-EXIF" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processImageUpload(withExif);
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
    expect(out.data.toString("latin1")).not.toContain("SECRETO-EXIF");
  });

  it("reduce imagenes grandes al lado maximo", async () => {
    const out = await processImageUpload(await solid(3000, 2000, "jpeg"));
    expect(Math.max(out.width, out.height)).toBe(1600);
  });

  it("rechaza vacio, tipo falso, MIME falso, danado, pequeno y demasiado grande", async () => {
    await expect(processImageUpload(Buffer.alloc(0))).rejects.toMatchObject({ code: "empty" });
    await expect(processImageUpload(Buffer.from("<svg onload=alert(1)></svg>"))).rejects.toMatchObject({ code: "type" });
    await expect(processImageUpload(Buffer.from("MZ\x90\x00 ejecutable.png"))).rejects.toMatchObject({ code: "type" });
    const png = await solid(300, 300);
    const truncated = png.subarray(0, 60);
    await expect(processImageUpload(truncated)).rejects.toMatchObject({ code: "corrupt" });
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("basura".repeat(50))]);
    await expect(processImageUpload(fakeJpeg)).rejects.toBeInstanceOf(ImageError);
    await expect(processImageUpload(await solid(100, 100))).rejects.toMatchObject({ code: "dimensions" });
    await expect(processImageUpload(Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]))).rejects.toMatchObject({
      code: "too_large",
    });
  });
});

describe("almacenamiento local", () => {
  let dir = "";
  let store: LocalDiskStorage;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "easyrif-st-"));
    store = new LocalDiskStorage(dir);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("guarda, lee y borra con clave opaca", async () => {
    const k = newStorageKey();
    await store.put(k, Buffer.from("abc"), "image/webp");
    expect(await store.get(k)).toMatchObject({ contentType: "image/webp" });
    await store.delete(k);
    expect(await store.get(k)).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it("impide path traversal y claves no opacas", async () => {
    for (const bad of ["../x", "..\\x", "a/b", "C:\\Windows\\win.ini", "x".repeat(36), ""]) {
      expect(await store.get(bad)).toBeNull();
      await expect(store.put(bad, Buffer.from("x"), "image/webp")).rejects.toThrow();
      await expect(store.delete(bad)).rejects.toThrow();
    }
  });
});

describe("reservas: utilidades puras", () => {
  it("configuracion con valores por defecto y limites", () => {
    expect(getReservationConfig({})).toEqual({ ttlMinutes: 10, maxSelection: 10 });
    expect(getReservationConfig({ RESERVATION_TTL_MINUTES: "5", RESERVATION_MAX_SELECTION: "20" })).toEqual({
      ttlMinutes: 5,
      maxSelection: 20,
    });
    expect(getReservationConfig({ RESERVATION_TTL_MINUTES: "0", RESERVATION_MAX_SELECTION: "9999" })).toEqual({
      ttlMinutes: 10,
      maxSelection: 10,
    });
  });

  it("token derivado: estable, opaco y dependiente del secreto", () => {
    const k = "abcdefghijklmnop1234";
    expect(deriveAccessToken(k, "s1")).toBe(deriveAccessToken(k, "s1"));
    expect(deriveAccessToken(k, "s1")).not.toBe(deriveAccessToken(k, "s2"));
    expect(deriveAccessToken(k, "s1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => deriveAccessToken(k, "")).toThrow();
  });

  it("valida datos minimos del comprador", () => {
    expect(validateBuyer({ name: "Ana", email: "A@B.CL" })).toMatchObject({ ok: true, value: { email: "a@b.cl" } });
    expect(validateBuyer({ name: "Ana" }).ok).toBe(false);
    expect(validateBuyer({ name: "A", email: "a@b.cl" }).ok).toBe(false);
    expect(validateBuyer({ name: "Ana", email: "malo" }).ok).toBe(false);
    expect(validateBuyer({ name: "Ana", phone: "<script>" }).ok).toBe(false);
  });

  it("limitador de tasa", () => {
    const k = "k" + Math.random();
    expect([1, 2, 3, 4].map(() => rateLimit(k, 3, 1000, 0))).toEqual([true, true, true, false]);
    expect(rateLimit(k, 3, 1000, 2000)).toBe(true);
  });
});
