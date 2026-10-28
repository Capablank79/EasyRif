import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/*
 * Filtro optimista: solo comprueba que exista la cookie de sesión.
 * La validación real (sesión vigente en PostgreSQL y pertenencia a la
 * organización) se hace en el servidor con `requireUser`.
 */
export function proxy(request: NextRequest) {
  const hasCookie = Boolean(getSessionCookie(request));
  const { pathname } = request.nextUrl;
  if (!hasCookie && pathname.startsWith("/panel")) {
    return NextResponse.redirect(new URL("/iniciar-sesion", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/panel/:path*"] };
