"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { removeImageAction, uploadImageAction } from "./actions";

// Constantes duplicadas a propósito: este módulo es de cliente y no debe importar sharp.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Feedback = { kind: "error" | "ok"; text: string } | null;

/**
 * Imagen opcional de la rifa o de un premio (solo editable en borrador).
 * Al elegir un archivo se sube y guarda automaticamente; si falla se conserva la imagen anterior.
 */
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [working, setWorking] = useState<"upload" | "remove" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function baseForm() {
    const fd = new FormData();
    fd.set("raffleId", raffleId);
    fd.set("kind", kind);
    if (prizeId) fd.set("prizeId", prizeId);
    return fd;
  }

  function run(mode: "upload" | "remove", fd: FormData) {
    setWorking(mode);
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = mode === "upload" ? await uploadImageAction({}, fd) : await removeImageAction({}, fd);
        if (res.error) setFeedback({ kind: "error", text: res.error });
        else setFeedback({ kind: "ok", text: res.ok ?? "Listo." });
      } catch {
        setFeedback({ kind: "error", text: "No se pudo completar la operación. Se conservó la imagen anterior. Inténtelo de nuevo." });
      } finally {
        setWorking(null);
      }
    });
  }

  function onFileChosen(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || busy) return;
    let error: string | null = null;
    if (!ALLOWED_TYPES.includes(file.type)) error = "Formato no permitido. Use JPEG, PNG o WebP.";
    else if (file.size > MAX_IMAGE_BYTES) {
      error = `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el máximo de 3 MB. Reduzca su tamaño e inténtelo de nuevo.`;
    }
    if (error) {
      setFeedback({ kind: "error", text: `${error} Se conservó la imagen anterior.` });
    } else {
      const fd = baseForm();
      fd.set("image", file);
      run("upload", fd);
    }
    input.value = ""; // permite volver a elegir el mismo archivo
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-xl bg-sky-100">
        {imageKey ? (
          <Image src={`/api/imagenes/${imageKey}`} alt={label} fill unoptimized sizes="320px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">Sin imagen</div>
        )}
        {working === "upload" && (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm font-semibold text-navy-900"
          >
            Subiendo imagen…
          </div>
        )}
      </div>
      {editable && (
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={label}
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={(e) => onFileChosen(e.currentTarget)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="min-h-11 rounded-xl border border-navy-900/20 bg-white px-4 text-sm font-semibold text-navy-900 hover:bg-sky-100 disabled:opacity-60"
            >
              {working === "upload" ? "Subiendo imagen…" : imageKey ? "Reemplazar imagen" : "Seleccionar imagen"}
            </button>
            {imageKey && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run("remove", baseForm())}
                className="min-h-11 text-sm font-semibold text-red-700 underline disabled:opacity-60"
              >
                {working === "remove" ? "Quitando…" : "Quitar imagen"}
              </button>
            )}
          </div>
          <p className="text-xs text-muted">JPEG, PNG o WebP, hasta 3 MB, mínimo 200×200 px. Se eliminan los metadatos.</p>
          {feedback?.kind === "error" && (
            <p role="alert" className="text-sm text-red-700">
              {feedback.text}
            </p>
          )}
          {feedback?.kind === "ok" && (
            <p role="status" className="text-sm text-green-800">
              {feedback.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}