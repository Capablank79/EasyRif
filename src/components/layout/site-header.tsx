import { getSessionUser } from "@/modules/auth/session";
import { SiteHeaderNav } from "./site-header-nav";

/** Resuelve la sesión en el servidor; si la base no está disponible, muestra el menú público. */
export async function SiteHeader() {
  let authenticated = false;
  try {
    authenticated = Boolean(await getSessionUser());
  } catch {
    authenticated = false;
  }
  return <SiteHeaderNav authenticated={authenticated} />;
}
