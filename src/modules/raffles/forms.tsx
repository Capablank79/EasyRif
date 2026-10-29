"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ImageControl } from "./image-control";
import { CREATE_STEPS, firstStepWithError, missingRequiredInStep, type CreateStepId } from "./guidance";
import { campaignScheduleForDate } from "./campaign";
import {
  addPrizeAction,
  createRaffleAction,
  deletePrizeAction,
  generateNumbersAction,
  movePrizeAction,
  publishRaffleAction,
  updatePrizeAction,
  updateRaffleAction,
  type RaffleFormState,
} from "./actions";

const FIELD_LABEL: Record<string, string> = {
  title: "Nombre",
  description: "Descripción",
  price: "Precio",
  currency: "Moneda",
  numbering: "Tipo de numeración",
  numberCount: "Cantidad de números",
  bookletCount: "Cantidad de talonarios",
  numbersPerBooklet: "Números por talonario",
  firstFolio: "Folio inicial",
  drawDate: "Fecha del sorteo",
};

const inputCls =
  "mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-navy-950 focus:border-navy-700 focus:outline-2 focus:outline-offset-2 focus:outline-navy-700 disabled:bg-sky-50 disabled:text-muted";

function Msg({ state }: { state: RaffleFormState }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
        {state.ok}
      </p>
    );
  return null;
}

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium text-navy-900">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-navy-700">{hint}</p>}
      {error && (
        <p id={`${name}-err`} className="mt-1 text-sm font-medium text-red-700">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}

export interface RaffleFormValues {
  title: string;
  description: string;
  price: string;
  currency: string;
  numberCount: string;
  drawDate: string;
  numbering?: "individual" | "booklets";
  bookletCount?: string;
  numbersPerBooklet?: string;
  firstFolio?: string;
}

export function RaffleForm({
  mode,
  organizationId,
  raffleId,
  defaults,
  currencies,
  maxNumbers,
  lockNumberCount = false,
  timeZone = "America/Santiago",
}: {
  mode: "create" | "edit";
  organizationId?: string;
  raffleId?: string;
  defaults: RaffleFormValues;
  currencies: string[];
  maxNumbers: number;
  lockNumberCount?: boolean;
  timeZone?: string;
}) {
  const isCreate = mode === "create";
  const [state, action, pending] = useActionState<RaffleFormState, FormData>(
    isCreate ? createRaffleAction : updateRaffleAction,
    {},
  );
  const [numbering, setNumbering] = useState<"individual" | "booklets">(defaults.numbering ?? "individual");
  // Todos los valores viven en el cliente: cambiar de paso (o un error del servidor) no los pierde.
  const [v, setV] = useState({
    title: defaults.title,
    description: defaults.description,
    price: defaults.price,
    currency: defaults.currency,
    numberCount: defaults.numberCount,
    drawDate: defaults.drawDate,
    bookletCount: defaults.bookletCount ?? "10",
    numbersPerBooklet: defaults.numbersPerBooklet ?? "20",
    firstFolio: defaults.firstFolio ?? "1",
  });
  const set =
    (k: keyof typeof v) => (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setV((p) => ({ ...p, [k]: ev.target.value }));

  const [step, setStep] = useState<CreateStepId>(1);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    // Respuesta nueva del servidor: llevar al usuario al primer paso con errores.
    setSeenState(state);
    setClientErrors({});
    const s = firstStepWithError(state.fieldErrors as Record<string, string | undefined> | undefined);
    if (s) setStep(s);
  }
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const errs: Record<string, string | undefined> = { ...(state.fieldErrors ?? {}), ...clientErrors };
  const errList = Object.entries(errs).filter(([, m]) => m) as [string, string][];
  const err = (k: string) => ({
    "aria-invalid": Boolean(errs[k]),
    "aria-describedby": errs[k] ? `${k}-err` : undefined,
  });
  const show = (n: CreateStepId) => !isCreate || step === n;
  const computedTotal =
    /^\d{1,5}$/.test(v.bookletCount) && /^\d{1,5}$/.test(v.numbersPerBooklet)
      ? Number(v.bookletCount) * Number(v.numbersPerBooklet)
      : null;
  const totalParticipations = numbering === "booklets" ? computedTotal : /^\d{1,6}$/.test(v.numberCount) ? Number(v.numberCount) : null;

  function goNext() {
    const missing = missingRequiredInStep(step, { ...v, numbering });
    setClientErrors(missing);
    if (Object.keys(missing).length === 0 && step < 3) setStep((step + 1) as CreateStepId);
  }
  function goBack() {
    setClientErrors({});
    if (step > 1) setStep((step - 1) as CreateStepId);
  }

  return (
    <form
      action={action}
      className="space-y-5"
      noValidate
      onSubmit={(ev) => {
        const errors: Record<string, string> = {};
        if (!v.drawDate.trim()) errors.drawDate = "Elige la fecha del sorteo.";
        else if (isCreate || v.drawDate !== defaults.drawDate) {
          const schedule = campaignScheduleForDate(v.drawDate, timeZone);
          if (!schedule || schedule.salesClosesAt.getTime() <= Date.now()) {
            errors.drawDate = "El cierre de ventas a las 22:00 (hora de Santiago) debe estar en el futuro.";
          }
        }
        if (Object.keys(errors).length) {
          ev.preventDefault();
          setClientErrors(errors);
          setStep(3);
        }
      }}
      onKeyDown={(ev) => {
        // En el asistente, Enter avanza de paso en vez de enviar el formulario incompleto.
        const t = ev.target as HTMLElement;
        if (isCreate && step < 3 && ev.key === "Enter" && t.tagName === "INPUT") {
          ev.preventDefault();
          goNext();
        }
      }}
    >
      {organizationId && <input type="hidden" name="organizationId" value={organizationId} />}
      {raffleId && <input type="hidden" name="raffleId" value={raffleId} />}

      {isCreate && (
        <div>
          <p className="text-sm font-semibold text-navy-700">
            Paso {step} de {CREATE_STEPS.length}
          </p>
          <ol className="mt-2 grid grid-cols-3 gap-2" aria-label="Pasos para crear la rifa">
            {CREATE_STEPS.map((s) => (
              <li
                key={s.id}
                aria-current={s.id === step ? "step" : undefined}
                className={
                  "rounded-xl border px-2 py-2 text-center text-xs font-semibold sm:text-sm " +
                  (s.id === step
                    ? "border-navy-900 bg-navy-900 text-white"
                    : s.id < step
                      ? "border-navy-900/30 bg-sky-100 text-navy-900"
                      : "border-line bg-white text-muted")
                }
              >
                <span className="block">{s.id}</span>
                {s.title}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">
            Después de crear el borrador seguirás con: 4. Premios e imágenes · 5. Publicar.
          </p>
        </div>
      )}

      {errList.length > 0 && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Revisa estos campos para continuar:</p>
          <ul className="mt-1 list-disc pl-5">
            {errList.map(([k, m]) => (
              <li key={k}>
                {FIELD_LABEL[k] ?? k}: {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Msg state={state} />

      {/* Paso 1 */}
      <div hidden={!show(1)} className="space-y-4">
        {isCreate ? (
          <h2 ref={step === 1 ? headingRef : undefined} tabIndex={-1} className="text-lg font-semibold text-navy-900 outline-none">
            Cuéntanos de tu rifa
          </h2>
        ) : (
          <h3 className="text-base font-semibold text-navy-900">Datos básicos</h3>
        )}
        <Field label="Nombre de la rifa" name="title" error={errs.title} hint="Ejemplo: Rifa solidaria 2026.">
          <input id="title" name="title" required maxLength={200} value={v.title} onChange={set("title")} className={inputCls} {...err("title")} />
        </Field>
        <Field label="Descripción (opcional)" name="description" error={errs.description} hint="Cuenta para qué es la rifa y cómo se entregan los premios.">
          <textarea id="description" name="description" rows={4} maxLength={2000} value={v.description} onChange={set("description")} className={inputCls + " py-2"} {...err("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Precio por número" name="price" error={errs.price} hint="Lo que paga cada persona por un número, sin símbolo. Ejemplo: 1000.">
            <input id="price" name="price" inputMode="decimal" required value={v.price} onChange={set("price")} className={inputCls} {...err("price")} />
          </Field>
          <Field label="Moneda" name="currency" error={errs.currency}>
            <select id="currency" name="currency" value={v.currency} onChange={set("currency")} className={inputCls}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Paso 2 */}
      <div hidden={!show(2)} className="space-y-4">
        {isCreate ? (
          <h2 ref={step === 2 ? headingRef : undefined} tabIndex={-1} className="text-lg font-semibold text-navy-900 outline-none">
            ¿Cómo se numera la rifa?
          </h2>
        ) : (
          <h3 className="text-base font-semibold text-navy-900">Numeración y modalidad</h3>
        )}
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-medium text-navy-900">Tipo de numeración</legend>
          {lockNumberCount && <input type="hidden" name="numbering" value={numbering} />}
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["individual", "Numeración individual", "Números sueltos: 001, 002, 003… Cada persona elige los que quiera."],
                ["booklets", "Talonarios foliados", "Grupos de números impresos. Cada uno se identifica con folio y número, por ejemplo T-0003 / N-15 (talonario 3, número 15)."],
              ] as const
            ).map(([value, title, hint]) => (
              <label
                key={value}
                className={
                  "flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm " +
                  (numbering === value ? "border-navy-900 bg-sky-50" : "border-line")
                }
              >
                <input
                  type="radio"
                  name={lockNumberCount ? undefined : "numbering"}
                  value={value}
                  checked={numbering === value}
                  disabled={lockNumberCount}
                  onChange={() => setNumbering(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-navy-900">{title}</span>
                  <span className="text-xs text-navy-700">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {lockNumberCount && (
            <p className="mt-2 text-xs text-navy-700">Ya hay números generados: la numeración no se puede cambiar.</p>
          )}
        </fieldset>
        {isCreate && (
          <p role="note" className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
            <strong>Importante:</strong> cuando generes los números, la modalidad y la cantidad ya no se podrán cambiar. Al publicar,
            tampoco el precio ni la moneda.
          </p>
        )}
        {numbering === "individual" ? (
          <Field
            label="Cantidad de números"
            name="numberCount"
            error={errs.numberCount}
            hint={lockNumberCount ? "Ya hay números generados: la cantidad no se puede cambiar." : `Entre 1 y ${maxNumbers}. Ejemplo: 100.`}
          >
            <input id="numberCount" name="numberCount" inputMode="numeric" required value={v.numberCount} onChange={set("numberCount")} readOnly={lockNumberCount} className={inputCls} {...err("numberCount")} />
          </Field>
        ) : (
          <>
            <input type="hidden" name="numberCount" value={defaults.numberCount} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cantidad de talonarios" name="bookletCount" error={errs.bookletCount} hint="Ejemplo: 10 talonarios.">
                <input id="bookletCount" name="bookletCount" inputMode="numeric" required value={v.bookletCount} onChange={set("bookletCount")} readOnly={lockNumberCount} className={inputCls} {...err("bookletCount")} />
              </Field>
              <Field label="Números por talonario" name="numbersPerBooklet" error={errs.numbersPerBooklet} hint="Ejemplo: 20 números en cada uno.">
                <input id="numbersPerBooklet" name="numbersPerBooklet" inputMode="numeric" required value={v.numbersPerBooklet} onChange={set("numbersPerBooklet")} readOnly={lockNumberCount} className={inputCls} {...err("numbersPerBooklet")} />
              </Field>
              <Field label="Folio inicial" name="firstFolio" error={errs.firstFolio} hint="Número del primer talonario. Normalmente 1.">
                <input id="firstFolio" name="firstFolio" inputMode="numeric" value={v.firstFolio} onChange={set("firstFolio")} readOnly={lockNumberCount} className={inputCls} {...err("firstFolio")} />
              </Field>
            </div>
            <p className="text-sm text-navy-900" aria-live="polite">
              {computedTotal !== null
                ? `Total: ${computedTotal} participaciones únicas (${v.bookletCount} talonarios × ${v.numbersPerBooklet} números).`
                : "Indica cantidades enteras para calcular el total."}
            </p>
          </>
        )}
      </div>

      {/* Paso 3 */}
      <div hidden={!show(3)} className="space-y-4">
        {isCreate ? (
          <h2 ref={step === 3 ? headingRef : undefined} tabIndex={-1} className="text-lg font-semibold text-navy-900 outline-none">
            Fechas y revisión
          </h2>
        ) : (
          <h3 className="text-base font-semibold text-navy-900">Fechas</h3>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha del sorteo" name="drawDate" error={errs.drawDate} hint={`Selecciona un día. Cierre de ventas 22:00 y sorteo 22:30 (${timeZone}).`}>
            <input id="drawDate" name="drawDate" type="date" value={v.drawDate} onChange={set("drawDate")} className={inputCls} {...err("drawDate")} />
          </Field>
        </div>
        {isCreate && (
          <div className="rounded-xl border border-line bg-sky-50 p-3">
            <h3 className="text-sm font-semibold text-navy-900">Resumen antes de crear</h3>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Nombre</dt>
                <dd className="break-words font-semibold">{v.title || "Sin nombre"}</dd>
              </div>
              <div>
                <dt className="text-muted">Modalidad</dt>
                <dd className="font-semibold">{numbering === "booklets" ? "Talonarios foliados" : "Numeración individual"}</dd>
              </div>
              <div>
                <dt className="text-muted">Participaciones</dt>
                <dd className="font-semibold">
                  {totalParticipations ?? "—"}
                  {numbering === "booklets" && computedTotal !== null ? ` (${v.bookletCount} talonarios × ${v.numbersPerBooklet})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Precio por número</dt>
                <dd className="font-semibold">{v.price ? `${v.price} ${v.currency}` : "Sin precio"}</dd>
              </div>
              <div>
                <dt className="text-muted">Fecha del sorteo</dt>
                <dd className="font-semibold">{v.drawDate || "Sin definir"}</dd>
              </div>
              {v.drawDate && (
                <div>
                  <dt className="text-muted">Cierre de ventas · Sorteo</dt>
                  <dd className="font-semibold">
                    {v.drawDate} 22:00 · {v.drawDate} 22:30 ({timeZone})
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-navy-700">
              Se guardará como borrador: todavía no es pública. En la pantalla siguiente agregas premios e imágenes y luego la publicas.
              Funciona en modo demostración, sin pagos ni ventas reales.
            </p>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {pending ? "Guardando…" : ""}
      </p>
      {isCreate ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {step > 1 ? (
            <Button type="button" variant="ghost" onClick={goBack} disabled={pending} className="w-full sm:w-auto">
              ← Atrás
            </Button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <Button type="button" onClick={goNext} className="w-full sm:w-auto">
              Siguiente →
            </Button>
          ) : (
            <Button type="submit" disabled={pending} className="w-full sm:w-auto">
              {pending ? "Guardando…" : "Crear borrador"}
            </Button>
          )}
        </div>
      ) : (
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      )}
    </form>
  );
}

export function AddPrizeForm({ raffleId }: { raffleId: string }) {
  const [state, action, pending] = useActionState<RaffleFormState, FormData>(addPrizeAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ?? "f"}>
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <Field label="Nombre del premio" name="prize-title" error={e.title}>
        <input id="prize-title" name="title" required maxLength={200} className={inputCls} />
      </Field>
      <Field label="Descripción (opcional)" name="prize-description" error={e.description}>
        <textarea id="prize-description" name="description" rows={2} maxLength={1000} className={inputCls + " py-2"} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Agregando…" : "Agregar premio"}
      </Button>
    </form>
  );
}

function MiniForm({
  action,
  fields,
  children,
  confirm,
}: {
  action: (s: RaffleFormState, fd: FormData) => Promise<RaffleFormState>;
  fields: Record<string, string>;
  children: ReactNode;
  confirm?: string;
}) {
  const [state, act, pending] = useActionState<RaffleFormState, FormData>(action, {});
  return (
    <form
      action={act}
      onSubmit={(ev) => {
        if (confirm && !window.confirm(confirm)) ev.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {/* Bloquea el botón mientras se procesa: evita envíos duplicados. */}
      <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
        {children}
      </fieldset>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}

const small =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-navy-900/20 bg-white px-3 text-sm font-medium text-navy-900 hover:bg-sky-100 disabled:opacity-40";

export function PrizeItem({
  raffleId,
  prize,
  index,
  total,
  editable,
}: {
  raffleId: string;
  prize: { id: string; title: string; description: string | null; imageKey: string | null };
  index: number;
  total: number;
  editable: boolean;
}) {
  const [state, action, pending] = useActionState<RaffleFormState, FormData>(updatePrizeAction, {});
  const e = state.fieldErrors ?? {};
  const base = { raffleId, prizeId: prize.id };
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-900 break-words">{prize.title}</p>
          {prize.description && <p className="mt-1 text-sm text-muted break-words">{prize.description}</p>}
        </div>
      </div>
      <div className="mt-3">
        <ImageControl
          raffleId={raffleId}
          prizeId={prize.id}
          imageKey={prize.imageKey}
          editable={editable}
          label={`Imagen del premio ${prize.title}`}
        />
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          {index > 0 && (
            <MiniForm action={movePrizeAction} fields={{ ...base, direction: "up" }}>
              <button type="submit" className={small} aria-label={`Subir ${prize.title}`}>
                ↑
              </button>
            </MiniForm>
          )}
          {index < total - 1 && (
            <MiniForm action={movePrizeAction} fields={{ ...base, direction: "down" }}>
              <button type="submit" className={small} aria-label={`Bajar ${prize.title}`}>
                ↓
              </button>
            </MiniForm>
          )}
          <MiniForm action={deletePrizeAction} fields={base} confirm="¿Eliminar este premio?">
            <button type="submit" className={small}>
              Eliminar
            </button>
          </MiniForm>
          <details className="w-full">
            <summary className={small + " cursor-pointer"}>Editar</summary>
            <form action={action} className="mt-3 space-y-3" noValidate>
              <input type="hidden" name="raffleId" value={raffleId} />
              <input type="hidden" name="prizeId" value={prize.id} />
              <Msg state={state} />
              <Field label="Nombre" name={`t-${prize.id}`} error={e.title}>
                <input id={`t-${prize.id}`} name="title" defaultValue={prize.title} maxLength={200} required className={inputCls} />
              </Field>
              <Field label="Descripción" name={`d-${prize.id}`} error={e.description}>
                <textarea id={`d-${prize.id}`} name="description" rows={2} defaultValue={prize.description ?? ""} maxLength={1000} className={inputCls + " py-2"} />
              </Field>
              <Button type="submit" variant="secondary" disabled={pending}>
                Guardar premio
              </Button>
            </form>
          </details>
        </div>
      )}
    </li>
  );
}

export function GenerateNumbersForm({ raffleId, count }: { raffleId: string; count: number }) {
  const [state, action, pending] = useActionState<RaffleFormState, FormData>(generateNumbersAction, {});
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (!window.confirm(`Se generarán ${count} números únicos. ¿Continuar?`)) ev.preventDefault();
      }}
      className="space-y-3"
    >
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Generando…" : "Generar números"}
      </Button>
    </form>
  );
}

export function PublishForm({ raffleId, disabled }: { raffleId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<RaffleFormState, FormData>(publishRaffleAction, {});
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (
          !window.confirm(
            "Al publicar, el precio, la moneda, la cantidad de números y la dirección ya no se podrán cambiar. ¿Publicar?",
          )
        )
          ev.preventDefault();
      }}
      className="space-y-3"
    >
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <Button type="submit" disabled={disabled || pending} className="w-full sm:w-auto">
        {pending ? "Publicando…" : "Publicar rifa"}
      </Button>
    </form>
  );
}
