import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { buildReceiptPdf } from "@/modules/receipts/pdf";
import { deriveVerificationCode } from "@/modules/receipts/verification";
import { renderPage } from "./helpers/pdf";

// Genera PNG de revision visual solo si se pide: VISUAL_OUT=<carpeta> npx vitest run tests/visual-pdf.test.ts
const OUT = process.env.VISUAL_OUT;
describe.skipIf(!OUT)("render visual del PDF", () => {
  it("renderiza uno y muchos numeros", async () => {
    const id = "7f3c2a10-1111-4222-8333-444455556666";
    const base = {
      orderId: id, status: "expired" as const, raffleTitle: "Gran Rifa Solidaria del Colegio — Día de la Familia, Año Nuevo ñandú Ōtāhuhu Łódź", organizerName: "Colegio Santa María de Ñuñoa",
      unitPriceCents: 5000, currency: "CLP", issuedAt: new Date("2026-10-27T13:00:00Z"), expiresAt: new Date("2026-10-27T13:10:00Z"),
      verificationCode: deriveVerificationCode(id, "secreto-visual-0000000000"),
    };
    for (const [name, n] of [["uno", 1], ["varios", 12], ["muchos", 130]] as const) {
      const nums = Array.from({ length: n }, (_, i) => String(i * 7 + 1).padStart(4, "0"));
      const pdf = await buildReceiptPdf({ ...base, numbers: nums, totalCents: 5000 * n }, "http://localhost:3000");
      writeFileSync(path.join(OUT!, `${name}.pdf`), pdf);
      const pages = Number((await import("./helpers/pdf").then((m) => m.pageTexts(pdf))).length);
      for (let p = 1; p <= pages; p++) writeFileSync(path.join(OUT!, `${name}-p${p}.png`), (await renderPage(pdf, p, 1.4)).png);
    }
  }, 60_000);
});
