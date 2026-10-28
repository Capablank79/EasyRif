"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <p className="break-all rounded-lg bg-sky-50 p-2 font-mono text-xs text-navy-900">{url}</p>
      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Enlace copiado" : "Copiar enlace"}
      </Button>
    </div>
  );
}
