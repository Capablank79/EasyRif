import { getSessionUser } from "@/modules/auth/session";
import { canViewImage } from "@/modules/raffles/images";
import { getStorage, STORAGE_KEY_RE } from "@/modules/storage/provider";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";

const notFound = () => new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!STORAGE_KEY_RE.test(key)) return notFound();
  const db = getDb();
  // Las imagenes publicas no requieren sesion; las de borradores si.
  let allowed = await canViewImage(db, key, null);
  let isPublic = allowed;
  if (!allowed) {
    const user = await getSessionUser();
    allowed = Boolean(user) && (await canViewImage(db, key, user!.id));
    isPublic = false;
  }
  if (!allowed) return notFound();
  const file = await getStorage().get(key);
  if (!file) return notFound();
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": isPublic ? "public, max-age=3600, stale-while-revalidate=86400" : "private, no-store",
    },
  });
}
