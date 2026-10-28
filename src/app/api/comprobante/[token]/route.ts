import { NextResponse } from "next/server";
import { PublicUrlError, resolvePublicBaseUrl } from "@/modules/receipts/base-url";
import { buildReceiptPdf } from "@/modules/receipts/pdf";
import { getReceiptData, ReceiptError } from "@/modules/receipts/service";
import { publicReference } from "@/modules/receipts/verification";
import { rateLimit } from "@/modules/reservations/rate-limit";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECURITY = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** Descarga del comprobante PDF; la credencial es el token privado de la reserva (nunca va en el PDF). */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 64);
  if (!rateLimit(`pdf:${ip}`, 30, 60_000))
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: SECURITY });
  const { token } = await ctx.params;
  try {
    const base = resolvePublicBaseUrl();
    const data = await getReceiptData(getDb(), token);
    const pdf = await buildReceiptPdf(data, base);
    const inline = new URL(req.url).searchParams.get("ver") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...SECURITY,
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="comprobante-demo-${publicReference(data.orderId)}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof ReceiptError)
      return NextResponse.json({ error: e.code === "not_found" ? "No encontrado" : "No disponible" }, { status: e.code === "not_found" ? 404 : 422, headers: SECURITY });
    if (e instanceof PublicUrlError) {
      console.error("receipt_public_url_invalid");
      return NextResponse.json({ error: "Comprobante no disponible: configuración pendiente" }, { status: 503, headers: SECURITY });
    }
    console.error("receipt_failed");
    return NextResponse.json({ error: "No se pudo generar el comprobante" }, { status: 500, headers: SECURITY });
  }
}
