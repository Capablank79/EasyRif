"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/modules/auth/actions";
import { PRIVATE_LINKS, PUBLIC_LINKS } from "./nav-links";

const linkClass =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-navy-900 hover:bg-sky-100";

export function SiteHeaderNav({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  // El menú se considera abierto solo en la ruta donde se abrió; al navegar se cierra.
  const open = openAt === pathname;
  const setOpen = (fn: (v: boolean) => boolean) => setOpenAt(fn(open) ? pathname : null);

  const links = authenticated ? PRIVATE_LINKS : PUBLIC_LINKS;
  const current = (href: string) => (pathname === href ? "page" : undefined);

  const actions = authenticated ? (
    <form action={logoutAction}>
      <Button type="submit" variant="ghost" className="w-full md:w-auto">
        Cerrar sesión
      </Button>
    </form>
  ) : (
    <>
      <Link href="/iniciar-sesion" aria-current={current("/iniciar-sesion")} className={linkClass}>
        Iniciar sesión
      </Link>
      <ButtonLink href="/registro" className="w-full md:w-auto">
        Registrarse
      </ButtonLink>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" className="text-xl font-bold tracking-tight text-navy-900">
          Easy<span className="rounded bg-lime-400 px-1 text-navy-950">Rif</span>
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={current(l.href)}
              className={cn(linkClass, pathname === l.href && "bg-sky-100")}
            >
              {l.label}
            </Link>
          ))}
          <span className="ml-2 flex items-center gap-2">{actions}</span>
        </nav>

        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </Container>

      {open && (
        <nav id="mobile-nav" aria-label="Principal móvil" className="border-t border-line bg-white md:hidden">
          <Container className="flex flex-col gap-1 py-3">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={current(l.href)} className={linkClass}>
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">{actions}</div>
          </Container>
        </nav>
      )}
    </header>
  );
}
