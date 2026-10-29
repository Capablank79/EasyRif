import { NextResponse } from "next/server";
import { rateLimit } from "@/modules/reservations/rate-limit";
import { getPublicCounts, listBookletSummaries, listPublicNumbers, type NumberFilter } from "@/modules/reservations/service";
import { getPublicRaffleWithId } from "@/modules/raffles/service";
import { getSellerPortal } from "@/modules/campaigns/service";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";

const FILTERS: NumberFilter[] = ["all", "available", "reserved", "simulated_sold", "sold"];

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 64);
  if (!rateLimit(`numeros:${ip}`, 120, 60_000))
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
  const { slug } = await ctx.params;
  const db = getDb();
  const raffle = await getPublicRaffleWithId(db, slug.slice(0, 120));
  if (!raffle) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const f = sp.get("filter") as NumberFilter;
  const folioRaw = sp.get("folio");
  let folio = folioRaw && /^\d{1,5}$/.test(folioRaw) ? Number(folioRaw) : null;
  // Modo responsable: solo sus talonarios vigentes (enlace opaco revocable).
  let allowed: number[] | null = null;
  const sellerToken = sp.get("seller");
  if (sellerToken) {
    const portal = await getSellerPortal(db, sellerToken.slice(0, 100));
    if (!portal || portal.raffle.slug !== raffle.slug) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    allowed = portal.folios.map((x) => x.folio);
    if (allowed.length === 0) return NextResponse.json({ error: "Sin talonarios asignados" }, { status: 404 });
    if (folio === null || !allowed.includes(folio)) folio = allowed[0];
  }
  const [page, counts, allBooklets] = await Promise.all([
    listPublicNumbers(db, raffle.id, {
      q: sp.get("q") ?? "",
      filter: FILTERS.includes(f) ? f : "all",
      page: Number(sp.get("page")) || 1,
      pageSize: Number(sp.get("pageSize")) || 100,
      folio,
    }),
    getPublicCounts(db, raffle.id, folio),
    raffle.numberingMode === "booklets" ? listBookletSummaries(db, raffle.id) : Promise.resolve(null),
  ]);
  const booklets = allBooklets && allowed ? allBooklets.filter((b) => allowed.includes(b.folio)) : allBooklets;
  return NextResponse.json(
    { ...page, counts, booklets, salesClosesAt: raffle.salesClosesAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
