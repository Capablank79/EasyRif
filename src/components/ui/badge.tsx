import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Tone = "demo" | "neutral";

const tones: Record<Tone, string> = {
  demo: "bg-lime-400 text-navy-950",
  neutral: "bg-sky-100 text-navy-900",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
