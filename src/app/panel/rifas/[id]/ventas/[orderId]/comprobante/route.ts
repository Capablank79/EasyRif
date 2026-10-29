import { NextResponse } from "next/server";
import { getSessionUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { getExistingSalesReceipt, SalesError } from "@/modules/orders/sales-service";
import { resolvePublicBaseUrl, PublicUrlError } from "@/modules/receipts/base-url";
import { buildReceiptPdf } from "@/modules/receipts/pdf";
import { ReceiptError } from "@/modules/receipts/service";
import { publicReference } from "@/modules/receipts/verification";
import { rateLimit } from "@/modules/reservations/rate-limit";
import { UUID_RE } from "@/modules/raffles";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECURITY = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function GET(req: Request, ctx: { params: Promise<{ id: string; orderId: string }> }) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 64);
  if (!rateLimit(`panel-receipt:${ip}`, 30, 60_000)) return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: SECURITY });
  const { id, orderId } = await ctx.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(orderId)) return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: SECURITY });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Autenticación requerida" }, { status: 401, headers: SECURITY });
  try {
    const base = resolvePublicBaseUrl();
    const data = await getExistingSalesReceipt(getDb(), user.id, id, orderId);
    const pdf = await buildReceiptPdf(data, base);
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...SECURITY,
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename="comprobante-demo-${publicReference(data.orderId)}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ReceiptError || error instanceof SalesError || error instanceof AuthorizationError)
      return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: SECURITY });
    if (error instanceof PublicUrlError) return NextResponse.json({ error: "Comprobante no disponible: configuración pendiente" }, { status: 503, headers: SECURITY });
    console.error("panel_receipt_failed");
    return NextResponse.json({ error: "No se pudo generar el comprobante" }, { status: 500, headers: SECURITY });
  }
}
