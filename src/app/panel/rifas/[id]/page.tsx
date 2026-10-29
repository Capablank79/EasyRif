import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError, can } from "@/modules/organizations/permissions";
import {
  CURRENCIES,
  STATUS_LABEL,
  UUID_RE,
  formatMoney,
  getMaxRaffleNumbers,
  minorToInput,
  participationLabel,
  formatZoned,
  getAppTimeZone,
  utcToZonedDateInput,
} from "@/modules/raffles";
import { AddPrizeForm, GenerateNumbersForm, PrizeItem, PublishForm, RaffleForm } from "@/modules/raffles/forms";
import { ImageControl } from "@/modules/raffles/image-control";
import { nextDraftAction } from "@/modules/raffles/guidance";
import { RaffleError, checkPublishable, getRaffleDetail } from "@/modules/raffles/service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Administrar rifa" };
export const dynamic = "force-dynamic";

export default async function RifaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  let d;
  try {
    d = await getRaffleDetail(getDb(), user.id, id);
  } catch (e) {
    if (e instanceof RaffleError || e instanceof AuthorizationError) notFound();
    throw e;
  }
  const { raffle: r, role, prizes, numbers } = d;
  const isDraft = r.status === "draft";
  const canEdit = isDraft && can(role, "raffle:edit_draft");
  const canPublish = isDraft && can(role, "raffle:publish");
  const check = checkPublishable(r, prizes.length, numbers.total);
  const numbersDone = numbers.total === r.numberCount;
  const isBooklets = r.numberingMode === "booklets";
  const tz = getAppTimeZone();
  const next = nextDraftAction({ prizeCount: prizes.length, numberTotal: numbers.total, numberCount: r.numberCount });
  const prizesWithoutImage = prizes.filter((p) => !p.imageKey).length;

  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">Rifa</p>
          <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">{r.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={isDraft ? "neutral" : "demo"}>{STATUS_LABEL[r.status]}</Badge>
            <Badge>{formatMoney(r.priceCents, r.currency)} por número</Badge>
          </div>
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <PanelNav active="rifas" orgId={r.organizationId} />
        <ButtonLink href={`/panel/rifas?org=${r.organizationId}`} variant="ghost" className="w-full sm:w-auto">
          ← Volver a mis rifas
        </ButtonLink>

        {!canEdit && (
          <p role="note" className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
            {isDraft
              ? "Tu rol es de solo lectura: puedes consultar esta rifa pero no modificarla."
              : "Esta rifa está publicada: el precio, la moneda, la cantidad de números y la dirección ya no se pueden cambiar."}
          </p>
        )}

        {isDraft && canEdit && (
          <Card className="border-navy-900/30 bg-sky-50" aria-labelledby="siguiente-paso">
            <h2 id="siguiente-paso" className="text-lg font-semibold text-navy-900">
              Siguiente paso
            </h2>
            <p className="mt-1 text-sm text-navy-900">{next.label}.</p>
            <ButtonLink href={`#${next.anchor}`} className="mt-3 w-full sm:w-auto">
              {next.ready ? "Ir a publicar" : next.anchor === "premios" ? "Ir a premios" : "Ir a numeración"}
            </ButtonLink>
          </Card>
        )}

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">1. Configuración</h2>
          <div className="mt-4 max-w-2xl">
            {canEdit ? (
              <RaffleForm
                mode="edit"
                raffleId={r.id}
                defaults={{
                  title: r.title,
                  description: r.description ?? "",
                  price: minorToInput(r.priceCents, r.currency),
                  currency: r.currency,
                  numberCount: String(r.numberCount),
                  numbering: r.numberingMode,
                  bookletCount: r.bookletCount ? String(r.bookletCount) : undefined,
                  numbersPerBooklet: r.numbersPerBooklet ? String(r.numbersPerBooklet) : undefined,
                  firstFolio: r.firstFolio ? String(r.firstFolio) : undefined,
                  drawDate: utcToZonedDateInput(r.drawAt ?? r.endsAt, tz),
                }}
                timeZone={tz}
                currencies={Object.keys(CURRENCIES)}
                maxNumbers={getMaxRaffleNumbers()}
                lockNumberCount={numbers.total > 0}
              />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Precio</dt>
                  <dd className="font-semibold">{formatMoney(r.priceCents, r.currency)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Cantidad de números</dt>
                  <dd className="font-semibold">{r.numberCount}</dd>
                </div>
                {isBooklets && (
                  <div>
                    <dt className="text-muted">Talonarios</dt>
                    <dd className="font-semibold">
                      {r.bookletCount} × {r.numbersPerBooklet} números · folio inicial {r.firstFolio}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted">Fecha del sorteo</dt>
                  <dd className="font-semibold">{utcToZonedDateInput(r.drawAt ?? r.endsAt, tz) || "Sin definir"}</dd>
                </div>
                {(r.salesClosesAt || r.drawAt) && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted">Cierre de ventas · Sorteo</dt>
                    <dd className="font-semibold">
                      {r.salesClosesAt ? formatZoned(r.salesClosesAt, tz) : "Sin definir"} ·{" "}
                      {r.drawAt ? formatZoned(r.drawAt, tz) : "Sin definir"}
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-muted">Descripción</dt>
                  <dd className="whitespace-pre-line break-words">{r.description || "Sin descripción"}</dd>
                </div>
              </dl>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Imagen de la rifa</h2>
          <div className="mt-3">
            <ImageControl raffleId={r.id} imageKey={r.imageKey} editable={canEdit} label="Imagen de la rifa" />
          </div>
        </Card>

        <Card id="premios" className="scroll-mt-4">
          <h2 className="text-lg font-semibold text-navy-900">2. Premios</h2>
          {prizes.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {canEdit
                ? "Aún no hay premios. Agrega al menos uno abajo para poder publicar la rifa; puedes ponerle una foto a cada premio."
                : "Aún no hay premios."}
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {prizes.map((p, i) => (
                <PrizeItem key={p.id} raffleId={r.id} prize={p} index={i} total={prizes.length} editable={canEdit} />
              ))}
            </ol>
          )}
          {canEdit && (
            <div className="mt-5 max-w-2xl border-t border-line pt-4">
              <AddPrizeForm raffleId={r.id} />
            </div>
          )}
        </Card>

        <Card id="numeracion" className="scroll-mt-4">
          <h2 className="text-lg font-semibold text-navy-900">3. Numeración</h2>
          <p className="mt-2 text-sm">
            {numbers.total} de {r.numberCount} {isBooklets ? "participaciones" : "números"} generados
            {isBooklets ? ` (${r.bookletCount} talonarios × ${r.numbersPerBooklet} números).` : "."}
          </p>
          {numbers.total > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <div className="rounded-xl border border-line p-2">
                <dt className="text-xs text-muted">Disponibles</dt>
                <dd className="text-lg font-bold text-navy-900">{numbers.available}</dd>
              </div>
              <div className="rounded-xl border border-line p-2">
                <dt className="text-xs text-muted">Reservados temporalmente (demo)</dt>
                <dd className="text-lg font-bold text-navy-900">{numbers.reserved}</dd>
              </div>
              <div className="rounded-xl border border-line p-2">
                <dt className="text-xs text-muted">Vendidos (simulado)</dt>
                <dd className="text-lg font-bold text-violet-800">{numbers.simulatedSold}</dd>
              </div>
              <div className="rounded-xl border border-line p-2">
                <dt className="text-xs text-muted">Vendidos reales</dt>
                <dd className="text-lg font-bold text-navy-900">{numbers.sold}</dd>
              </div>
            </dl>
          )}
          {numbers.sample.length > 0 && (
            <p className="mt-2 break-words font-mono text-sm text-navy-700">
              {numbers.sample.map((s) => participationLabel(s, isBooklets)).join(", ")}
              {numbers.total > numbers.sample.length ? " …" : ""}
            </p>
          )}
          {isBooklets && numbers.total > 0 && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <ButtonLink href={`/panel/rifas/${r.id}/talonarios`} variant="secondary" className="w-full sm:w-auto">
                Ver talonarios y folios
              </ButtonLink>
              <ButtonLink href={`/panel/rifas/${r.id}/responsables`} variant="secondary" className="w-full sm:w-auto">
                Responsables y avance
              </ButtonLink>
            </div>
          )}
          {canEdit && !numbersDone && (
            <div className="mt-4">
              <GenerateNumbersForm raffleId={r.id} count={r.numberCount} />
            </div>
          )}
        </Card>

        <Card id="publicacion" className="scroll-mt-4">
          <h2 className="text-lg font-semibold text-navy-900">4. Publicación</h2>
          {isDraft ? (
            <>
              <p className="mt-2 text-sm text-muted">
                Publicar habilita la ficha pública en modo demostración: se pueden reservar números temporalmente, sin pagos ni ventas reales.
              </p>
              {!check.ok && (
                <div className="mt-3">
                  <p className="text-sm font-semibold text-navy-900">Antes de publicar te falta:</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-navy-900">
                    {check.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 rounded-xl border border-line bg-sky-50 p-3">
                <h3 className="text-sm font-semibold text-navy-900">Resumen antes de publicar</h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Nombre</dt>
                    <dd className="break-words font-semibold">{r.title}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Modalidad</dt>
                    <dd className="font-semibold">{isBooklets ? "Talonarios foliados" : "Numeración individual"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Participaciones</dt>
                    <dd className="font-semibold">
                      {r.numberCount}
                      {isBooklets ? ` (${r.bookletCount} talonarios × ${r.numbersPerBooklet})` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Precio por número</dt>
                    <dd className="font-semibold">{formatMoney(r.priceCents, r.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Fechas</dt>
                    <dd className="font-semibold">
                      {r.salesClosesAt || r.drawAt
                        ? `Cierre ${r.salesClosesAt ? formatZoned(r.salesClosesAt, tz) : "sin definir"} · Sorteo ${r.drawAt ? formatZoned(r.drawAt, tz) : "sin definir"}`
                        : utcToZonedDateInput(r.endsAt, tz) || "Sin fecha de sorteo"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Premios e imágenes</dt>
                    <dd className="font-semibold">
                      {prizes.length} {prizes.length === 1 ? "premio" : "premios"} · {r.imageKey ? "con imagen de la rifa" : "sin imagen de la rifa"}
                    </dd>
                  </div>
                </dl>
                {(!r.imageKey || prizesWithoutImage > 0) && (
                  <p role="note" className="mt-3 text-sm text-navy-900">
                    Aviso (no impide publicar):{" "}
                    {[
                      !r.imageKey && "la rifa no tiene imagen",
                      prizesWithoutImage > 0 && `${prizesWithoutImage} ${prizesWithoutImage === 1 ? "premio no tiene" : "premios no tienen"} imagen`,
                    ]
                      .filter(Boolean)
                      .join(" y ")}
                    .
                  </p>
                )}
                <p className="mt-3 text-xs text-navy-700">
                  Al publicar ya no se podrán cambiar el precio, la moneda ni la cantidad de números. La rifa queda en modo demostración, sin pagos ni ventas reales.
                </p>
              </div>
              {canPublish ? (
                <div className="mt-4">
                  <PublishForm raffleId={r.id} disabled={!check.ok} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Solo administradores y propietarios pueden publicar.</p>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm">Esta rifa está {STATUS_LABEL[r.status].toLowerCase()}.</p>
              {r.status === "published" && (
                <ButtonLink href={`/r/${r.slug}`} className="mt-4 w-full sm:w-auto">
                  Ver ficha pública
                </ButtonLink>
              )}
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Sorteos — Simulación</h2>
          <p className="mt-1 text-sm text-muted">Pruebe el motor de sorteo en dos etapas (folio y número). Las simulaciones no tienen validez ni afectan ventas o reservas.</p>
          <ButtonLink href={`/panel/rifas/${r.id}/sorteos`} variant="secondary" className="mt-3 w-full sm:w-auto">
            Abrir simulaciones
          </ButtonLink>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Próximamente</h2>
          <p className="mt-1 text-sm text-muted">Las ventas reales, el sorteo oficial y los pagos aún no están disponibles. Las reservas, comprobantes y simulaciones funcionan solo en modo demostración.</p>
        </Card>
      </Container>
    </>
  );
}
