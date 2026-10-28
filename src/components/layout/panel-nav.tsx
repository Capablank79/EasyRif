import Link from "next/link";

const ITEMS = [
  { key: "resumen", label: "Resumen", href: "/panel" },
  { key: "rifas", label: "Rifas", href: "/panel/rifas" },
] as const;

const SOON = ["Organización"];

export function PanelNav({ active, orgId }: { active: "resumen" | "rifas"; orgId?: string }) {
  const q = orgId ? `?org=${orgId}` : "";
  return (
    <nav aria-label="Panel" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {ITEMS.map((i) => (
        <Link
          key={i.key}
          href={`${i.href}${q}`}
          aria-current={i.key === active ? "page" : undefined}
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-line px-4 text-sm font-medium text-navy-900 hover:bg-sky-100 aria-[current=page]:border-navy-900 aria-[current=page]:bg-navy-900 aria-[current=page]:text-white"
        >
          {i.label}
        </Link>
      ))}
      {SOON.map((s) => (
        <span
          key={s}
          aria-disabled="true"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line px-4 text-sm text-muted"
        >
          {s}
          <span className="text-xs">(pronto)</span>
        </span>
      ))}
    </nav>
  );
}
