"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { removeImageAction, uploadImageAction, type RaffleFormState } from "./actions";

// Constantes duplicadas a propósito: este módulo es de cliente y no debe importar sharp.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Imagen opcional de la rifa o de un premio (solo editable en borrador). */
export function ImageControl({
  raffleId,
  prizeId,
  imageKey,
  editable,
  label,
}: {
  raffleId: string;
  prizeId?: string;
  imageKey: string | null;
  editable: boolean;
  label: string;
}) {
  const kind = prizeId ? "prize" : "raffle";
  const [up, upAction, upPending] = useActionState<RaffleFormState, FormData>(uploadImageAction, {});
  const [rm, rmAction, rmPending] = useActionState<RaffleFormState, FormData>(removeImageAction, {});
  const [localError, setLocalError] = useState<string | null>(null);
  const msg = localError ?? up.error ?? rm.error;

  function checkFile(file: File | undefined) {
    if (!file) return setLocalError(null);
    if (!ALLOWED_TYPES.includes(file.type)) return setLocalError("Formato no permitido. Use JPEG, PNG o WebP.");
    if (file.size > MAX_IMAGE_BYTES) {
      return setLocalError(
        `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el máximo de 3 MB. Reduzca su tamaño e inténtelo de nuevo.`,
      );
    }
    setLocalError(null);
  }
  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-xl bg-sky-100">
        {imageKey ? (
          <Image src={`/api/imagenes/${imageKey}`} alt={label} fill unoptimized sizes="320px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">Sin imagen</div>
        )}
      </div>
      {editable && (
        <div className="space-y-2">
          <form action={upAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="raffleId" value={raffleId} />
            <input type="hidden" name="kind" value={kind} />
            {prizeId && <input type="hidden" name="prizeId" value={prizeId} />}
            <label className="text-sm">
              <span className="sr-only">{label}</span>
              <input
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp"
                required
                onChange={(e) => checkFile(e.target.files?.[0])}
                aria-invalid={localError ? true : undefined}
                className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-navy-900 file:px-4 file:text-white"
              />
            </label>
            <button
              type="submit"
              disabled={upPending || Boolean(localError)}
              className="min-h-11 rounded-xl border border-navy-900/20 bg-white px-4 text-sm font-semibold text-navy-900 hover:bg-sky-100 disabled:opacity-60"
            >
              {upPending ? "Subiendo…" : imageKey ? "Reemplazar" : "Subir imagen"}
            </button>
          </form>
          {imageKey && (
            <form action={rmAction}>
              <input type="hidden" name="raffleId" value={raffleId} />
              <input type="hidden" name="kind" value={kind} />
              {prizeId && <input type="hidden" name="prizeId" value={prizeId} />}
              <button type="submit" disabled={rmPending} className="min-h-11 text-sm font-semibold text-red-700 underline">
                Quitar imagen
              </button>
            </form>
          )}
          <p className="text-xs text-muted">JPEG, PNG o WebP, hasta 3 MB, mínimo 200×200 px. Se eliminan los metadatos.</p>
          {msg && (
            <p role="alert" className="text-sm text-red-700">
              {msg}
            </p>
          )}
          {!msg && (up.ok || rm.ok) && <p role="status" className="text-sm text-green-800">{up.ok ?? rm.ok}</p>}
        </div>
      )}
    </div>
  );
}
