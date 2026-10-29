"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import { importSellerWorkbookAction, previewSellerImportAction } from "./actions";
import { MAX_SELLER_IMPORT_BYTES, MAX_SELLER_IMPORT_ROWS, type SellerImportPreview, type SellerImportResult } from "./import-types";

const STATUS: Record<string, string> = { ready: "Lista para crear", existing: "Perfil existente", error: "Error", conflict: "Conflicto" };

export function SellerExcelImport({ raffleId }: { raffleId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SellerImportPreview | null>(null);
  const [result, setResult] = useState<SellerImportResult | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setResult(null);
    setError("");
  }

  function data() {
    const fd = new FormData();
    fd.set("raffleId", raffleId);
    if (file) fd.set("file", file, file.name);
    return fd;
  }

  function showPreview() {
    if (!file) { setError("Selecciona primero un archivo .xlsx."); return; }
    startTransition(async () => {
      const response = await previewSellerImportAction(data());
      setError(response.error ?? "");
      setPreview(response.preview ?? null);
      setResult(null);
    });
  }

  function confirmImport() {
    if (!file || !preview) return;
    const candidates = preview.ready + preview.existing;
    if (!candidates || !window.confirm(`Se procesarán ${candidates} filas válidas. Los conflictos se omitirán y los folios asignados a otra persona no cambiarán. ¿Importar ahora?`)) return;
    startTransition(async () => {
      const response = await importSellerWorkbookAction(data());
      setError(response.error ?? "");
      setResult(response.result ?? null);
      if (response.result) {
        setPreview(null);
        setFile(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-line p-3" aria-labelledby="importar-responsables">
      <div>
        <h3 id="importar-responsables" className="font-semibold text-navy-900">Importar responsables desde Excel</h3>
        <p className="mt-1 text-sm text-muted">Solo .xlsx, máximo {MAX_SELLER_IMPORT_BYTES / 1024 / 1024} MB y {MAX_SELLER_IMPORT_ROWS} filas. Crea perfiles de esta rifa; no crea cuentas ni envía invitaciones.</p>
      </div>
      <a href="/api/plantilla-responsables" className="inline-flex min-h-11 items-center rounded-xl border border-navy-900/20 px-4 text-sm font-semibold text-navy-900 hover:bg-sky-50">
        Descargar plantilla .xlsx
      </a>
      <label className="block text-sm font-medium text-navy-900">
        Archivo Excel (.xlsx)
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="mt-1 block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-sky-100 file:px-3 file:font-semibold" />
      </label>
      {file && <p className="break-all text-xs text-muted">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {result && (
        <div role="status" className="rounded-xl bg-sky-50 p-3 text-sm text-navy-900">
          {result.messages.map((m) => <p key={m}>{m}</p>)}
        </div>
      )}
      <button type="button" onClick={showPreview} disabled={pending || !file} className="min-h-11 w-full rounded-xl border border-navy-900/20 px-4 text-sm font-semibold text-navy-900 disabled:opacity-50 sm:w-auto">
        {pending ? "Revisando…" : "Revisar archivo"}
      </button>
      {preview && (
        <div className="space-y-3 rounded-xl bg-sky-50 p-3">
          <div>
            <h4 className="font-semibold text-navy-900">Vista previa</h4>
            <p className="text-sm text-navy-900">{preview.ready} nuevos · {preview.existing} existentes · {preview.conflicts} conflictos · {preview.errors} errores</p>
          </div>
          <ul className="max-h-96 space-y-2 overflow-y-auto" aria-label="Filas de la importación">
            {preview.rows.map((row) => (
              <li key={row.line} className="rounded-lg border border-line bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy-900">Fila {row.line}: {row.displayName || "Sin nombre"}</span>
                  <span className={row.status === "error" || row.status === "conflict" ? "font-semibold text-red-700" : "font-semibold text-navy-700"}>{STATUS[row.status]}</span>
                </div>
                {row.email && <p className="break-all text-xs text-muted">{row.email}</p>}
                {row.folios.length > 0 && <p className="text-xs text-muted">Folios: {row.folios.join(", ")}</p>}
                {row.messages.map((message) => <p key={message} className="mt-1 text-xs text-navy-900">{message}</p>)}
              </li>
            ))}
          </ul>
          <button type="button" onClick={confirmImport} disabled={pending || preview.ready + preview.existing === 0} className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
            {pending ? "Importando…" : "Confirmar importación"}
          </button>
          <p className="text-xs text-muted">La confirmación vuelve a validar el archivo, los permisos y la disponibilidad vigente de cada folio.</p>
        </div>
      )}
    </section>
  );
}
