"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ImageControl } from "./image-control";
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
        <p id={`${name}-err`} className="mt-1 text-sm text-red-700">
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
  salesClosesAt?: string;
  drawAt?: string;
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
  const [state, action, pending] = useActionState<RaffleFormState, FormData>(
    mode === "create" ? createRaffleAction : updateRaffleAction,
    {},
  );
  const e = state.fieldErrors ?? {};
  const [numbering, setNumbering] = useState(defaults.numbering ?? "individual");
  const [bookletCount, setBookletCount] = useState(defaults.bookletCount ?? "10");
  const [perBooklet, setPerBooklet] = useState(defaults.numbersPerBooklet ?? "20");
  const [firstFolio, setFirstFolio] = useState(defaults.firstFolio ?? "1");
  const computedTotal =
    /^\d{1,5}$/.test(bookletCount) && /^\d{1,5}$/.test(perBooklet) ? Number(bookletCount) * Number(perBooklet) : null;
  const err = (k: keyof typeof e) => ({
    "aria-invalid": Boolean(e[k]),
    "aria-describedby": e[k] ? `${k}-err` : undefined,
  });
  return (
    <form action={action} className="space-y-4" noValidate>
      {organizationId && <input type="hidden" name="organizationId" value={organizationId} />}
      {raffleId && <input type="hidden" name="raffleId" value={raffleId} />}
      <Msg state={state} />
      <Field label="Nombre de la rifa" name="title" error={e.title}>
        <input id="title" name="title" required maxLength={200} defaultValue={defaults.title} className={inputCls} {...err("title")} />
      </Field>
      <Field label="Descripción (opcional)" name="description" error={e.description}>
        <textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={defaults.description} className={inputCls + " py-2"} {...err("description")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Precio por número" name="price" error={e.price}>
          <input id="price" name="price" inputMode="decimal" required defaultValue={defaults.price} className={inputCls} {...err("price")} />
        </Field>
        <Field label="Moneda" name="currency" error={e.currency}>
          <select id="currency" name="currency" defaultValue={defaults.currency} className={inputCls}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        {numbering === "individual" ? (
          <Field
            label="Cantidad de números"
            name="numberCount"
            error={e.numberCount}
            hint={
              lockNumberCount
                ? "Ya hay números generados: la cantidad no se puede cambiar."
                : `Entre 1 y ${maxNumbers}.`
            }
          >
            <input
              id="numberCount"
              name="numberCount"
              inputMode="numeric"
              required
              defaultValue={defaults.numberCount}
              readOnly={lockNumberCount}
              className={inputCls}
              {...err("numberCount")}
            />
          </Field>
        ) : (
          <input type="hidden" name="numberCount" value={defaults.numberCount} />
        )}
        <Field label="Fecha estimada del sorteo (opcional)" name="drawDate" error={e.drawDate} hint="Solo informativa.">
          <input id="drawDate" name="drawDate" type="date" defaultValue={defaults.drawDate} className={inputCls} {...err("drawDate")} />
        </Field>
      </div>
      <fieldset className="rounded-xl border border-line p-3" disabled={false}>
        <legend className="px-1 text-sm font-medium text-navy-900">Tipo de numeración</legend>
        {lockNumberCount && <input type="hidden" name="numbering" value={numbering} />}
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["individual", "Numeración individual", "Números 001, 002, 003…"],
              ["booklets", "Talonarios foliados", "Folio + número interno (T-0007 / N-14)"],
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
        {numbering === "booklets" && (
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Cantidad de talonarios" name="bookletCount" error={e.bookletCount}>
              <input id="bookletCount" name="bookletCount" inputMode="numeric" required value={bookletCount} onChange={(ev) => setBookletCount(ev.target.value)} readOnly={lockNumberCount} className={inputCls} {...err("bookletCount")} />
            </Field>
            <Field label="Números por talonario" name="numbersPerBooklet" error={e.numbersPerBooklet}>
              <input id="numbersPerBooklet" name="numbersPerBooklet" inputMode="numeric" required value={perBooklet} onChange={(ev) => setPerBooklet(ev.target.value)} readOnly={lockNumberCount} className={inputCls} {...err("numbersPerBooklet")} />
            </Field>
            <Field label="Folio inicial" name="firstFolio" error={e.firstFolio}>
              <input id="firstFolio" name="firstFolio" inputMode="numeric" value={firstFolio} onChange={(ev) => setFirstFolio(ev.target.value)} readOnly={lockNumberCount} className={inputCls} {...err("firstFolio")} />
            </Field>
            <Field label="Cierre de ventas" name="salesClosesAt" error={e.salesClosesAt} hint={`Hora de ${timeZone}.`}>
              <input id="salesClosesAt" name="salesClosesAt" type="datetime-local" required defaultValue={defaults.salesClosesAt} className={inputCls} {...err("salesClosesAt")} />
            </Field>
            <Field label="Fecha del sorteo" name="drawAt" error={e.drawAt} hint="Posterior al cierre. El sorteo no se ejecuta en esta fase.">
              <input id="drawAt" name="drawAt" type="datetime-local" required defaultValue={defaults.drawAt} className={inputCls} {...err("drawAt")} />
            </Field>
            <p className="text-sm text-navy-900 sm:col-span-3" aria-live="polite">
              {computedTotal !== null
                ? `Total: ${computedTotal} participaciones únicas (${bookletCount} talonarios × ${perBooklet} números).`
                : "Indique cantidades enteras para calcular el total."}
            </p>
          </div>
        )}
      </fieldset>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Guardando…" : mode === "create" ? "Crear borrador" : "Guardar cambios"}
      </Button>
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
  const [state, act] = useActionState<RaffleFormState, FormData>(action, {});
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
      {children}
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
