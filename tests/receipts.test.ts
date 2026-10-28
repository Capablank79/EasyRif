import { describe, expect, it } from "vitest";
import { PublicUrlError, resolvePublicBaseUrl } from "@/modules/receipts/base-url";
import { deadlineLabel, formatDateTimeUtc } from "@/modules/receipts/labels";
import { buildReceiptPdf, pdfSafe, verificationUrl } from "@/modules/receipts/pdf";
import type { ReceiptData } from "@/modules/receipts/service";
import { deriveVerificationCode, hashVerificationCode, publicReference, VERIFICATION_CODE_RE } from "@/modules/receipts/verification";
import { deriveAccessToken } from "@/modules/reservations/service";
import { decodeQr, pageTexts } from "./helpers/pdf";

const SECRET = "secreto-de-prueba-0123456789";
const ORDER = "7f3c2a10-1111-4222-8333-444455556666";
const BASE = "https://easyrif.example";

const data = (numbers: string[], over: Partial<ReceiptData> = {}): ReceiptData => ({
  orderId: ORDER,
  status: "pending",
  raffleTitle: "Rifa Solidaria 2026",
  organizerName: "Colegio Los Andes",
  numbers,
  unitPriceCents: 5000,
  totalCents: 5000 * numbers.length,
  currency: "CLP",
  issuedAt: new Date("2026-10-27T13:00:00Z"),
  expiresAt: new Date("2026-10-27T13:10:00Z"),
  verificationCode: deriveVerificationCode(ORDER, SECRET),
  ...over,
});

const range = (n: number, width = 3) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(width, "0"));

describe("codigo de verificacion", () => {
  it("es determinista, opaco, de 43 caracteres y distinto del token de acceso", () => {
    const a = deriveVerificationCode(ORDER, SECRET);
    expect(a).toBe(deriveVerificationCode(ORDER, SECRET));
    expect(a).toMatch(VERIFICATION_CODE_RE);
    expect(a).not.toContain(ORDER.slice(0, 8));
    expect(a).not.toBe(deriveAccessToken("clave-de-reserva-1234567890", SECRET));
    expect(deriveVerificationCode(ORDER, "otro-secreto-000000")).not.toBe(a);
    expect(deriveVerificationCode("otro-pedido", SECRET)).not.toBe(a);
  });
  it("el hash es sha256 hex y la referencia publica son 8 caracteres", () => {
    expect(hashVerificationCode("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(publicReference(ORDER)).toBe("7F3C2A10");
  });
  it("rechaza codigos mal formados", () => {
    for (const bad of ["", "abc", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "/", "../".repeat(15)])
      expect(VERIFICATION_CODE_RE.test(bad)).toBe(false);
  });
});

describe("pdfSafe", () => {
  it("conserva acentos, ñ y signos; limpia controles y bidi", () => {
    expect(pdfSafe("Año ñandú — «ok» Ł ő ș")).toBe("Año ñandú — «ok» Ł ő ș");
    expect(pdfSafe("a\u0000b\nc\u202e")).toBe("a b c");
  });
  it("sustituye por ? lo que la fuente no puede dibujar", () => {
    expect(pdfSafe("Premio 🎁 日本", (c) => c < 0x3000 && c !== 0x1f381)).toBe("Premio ? ??");
  });
});

describe("etiquetas de fecha", () => {
  it("segun el estado de la reserva", () => {
    expect(deadlineLabel("pending")).toBe("Válida hasta");
    expect(deadlineLabel("expired")).toBe("Venció el");
    expect(deadlineLabel("cancelled")).toBe("Fecha límite original");
    expect(formatDateTimeUtc(new Date("2026-10-27T13:10:00Z"))).toMatch(/2026, 13:10 UTC$/);
  });
});

describe("URL publica del QR", () => {
  it("en produccion exige https y host publico", () => {
    const prod = (u?: string) => resolvePublicBaseUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: u, BETTER_AUTH_URL: "https://otro.example" });
    expect(prod("https://easyrif.example/x?y#z")).toBe("https://easyrif.example");
    for (const bad of [undefined, "", "http://easyrif.example", "https://localhost:3000", "https://127.0.0.1", "https://[::1]", "https://intranet", "https://u:p@easyrif.example", "ftp://x.example", "no-url"])
      expect(() => prod(bad)).toThrow(PublicUrlError);
  });
  it("fuera de produccion admite localhost y nunca usa cabeceras", () => {
    expect(resolvePublicBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(resolvePublicBaseUrl({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:4000" })).toBe("http://localhost:4000");
    expect(resolvePublicBaseUrl.length).toBeLessThanOrEqual(1);
  });
});

describe("tipografia Unicode", () => {
  it("el PDF muestra acentos, ñ y caracteres latinos extendidos en titulo y organizador", async () => {
    const d = data(["001"], { raffleTitle: "Rifa Año Nuevo ñandú — Ōtāhuhu Łódź Çağrı", organizerName: "Colegio Santa María Ñuñoa" });
    const pdf = await buildReceiptPdf(d, BASE);
    const t = (await pageTexts(pdf)).join(" ");
    expect(t).toContain("Rifa Año Nuevo ñandú — Ōtāhuhu Łódź Çağrı");
    expect(t).toContain("Colegio Santa María Ñuñoa");
    expect(t).not.toContain("?");
  });
  it("etiqueta de fecha segun estado en el PDF", async () => {
    for (const [status, label] of [["pending", "Válida hasta"], ["expired", "Venció el"], ["cancelled", "Fecha límite original"]] as const) {
      const t = (await pageTexts(await buildReceiptPdf(data(["001"], { status }), BASE))).join(" ");
      expect(t.toLowerCase()).toContain(label.toLowerCase());
      expect(t).toContain("13:10 UTC");
    }
  });
});

describe("PDF del comprobante", () => {
  it("un numero: legible, con leyenda de demostracion y un QR que abre la verificacion", async () => {
    const d = data(["042"]);
    const pdf = await buildReceiptPdf(d, BASE);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const texts = await pageTexts(pdf);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Comprobante digital — demostración");
    expect(texts[0]).toContain("DEMOSTRACIÓN — SIN VALIDEZ DE COMPRA NI PARTICIPACIÓN");
    expect(texts[0]).toContain("042");
    expect(texts[0]).toContain("7F3C2A10");
    expect(texts[0]).toContain("Rifa Solidaria 2026");
    expect(await decodeQr(pdf)).toBe(verificationUrl(BASE, d.verificationCode));
  });

  it("varios numeros: todos y solo esos, un unico QR, y el codigo no contiene datos personales", async () => {
    const nums = ["003", "010", "027", "100", "250", "999"];
    const d = data(nums);
    const pdf = await buildReceiptPdf(d, BASE);
    const texts = await pageTexts(pdf);
    const grid = texts.join(" ");
    for (const n of nums) expect(grid).toContain(n);
    expect(grid).not.toContain("004");
    expect(await decodeQr(pdf)).toBe(`${BASE}/verificar/${d.verificationCode}`);
    expect(await decodeQr(pdf)).not.toMatch(/Colegio|@|reserva\//);
  });

  it("muchos numeros: salto de pagina, leyenda en todas las paginas, QR solo en la primera", async () => {
    const nums = range(200);
    const pdf = await buildReceiptPdf(data(nums), BASE);
    const texts = await pageTexts(pdf);
    expect(texts.length).toBeGreaterThan(1);
    for (const t of texts) expect(t).toContain("DEMOSTRACIÓN — SIN VALIDEZ DE COMPRA NI PARTICIPACIÓN");
    const all = texts.join(" ");
    for (const n of nums) expect(all).toContain(n);
    expect(texts[0]).toContain(`Página 1 de ${texts.length}`);
    expect(await decodeQr(pdf, 1)).not.toBeNull();
    expect(await decodeQr(pdf, 2)).toBeNull();
  });

  it("es estable: mismo pedido, mismo contenido byte a byte", async () => {
    const a = await buildReceiptPdf(data(["001", "002"]), BASE);
    const b = await buildReceiptPdf(data(["001", "002"]), BASE);
    expect(a.equals(b)).toBe(true);
  });

  it("textos hostiles no rompen el PDF ni inyectan contenido", async () => {
    const d = data(["001"], { raffleTitle: "<script>alert(1)</script> 🎉 " + "x".repeat(500), organizerName: "(\\) /Type /Page\n%%EOF" });
    const pdf = await buildReceiptPdf(d, BASE);
    const texts = await pageTexts(pdf);
    expect(texts).toHaveLength(1);
    expect(await decodeQr(pdf)).toBe(verificationUrl(BASE, d.verificationCode));
  });
});
