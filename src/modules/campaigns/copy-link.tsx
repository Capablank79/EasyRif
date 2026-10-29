"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyLink({ url, label = "Copiar enlace", compact = false }: { url: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2">
      {!compact && <p className="break-all rounded-lg bg-sky-50 p-2 font-mono text-xs text-navy-900">{url}</p>}
      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setFailed(false);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
            setFailed(true);
          }
        }}
      >
        {copied ? "Enlace copiado" : label}
      </Button>
      {failed && <span role="status" className="text-xs text-red-700">No se pudo copiar el enlace desde este navegador.</span>}
    </div>
  );
}
