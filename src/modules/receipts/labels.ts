export type DeadlineStatus = "pending" | "cancelled" | "expired";

/** Etiqueta de la fecha limite segun el estado de la reserva (PDF, verificacion y pagina de reserva). */
export function deadlineLabel(status: DeadlineStatus): string {
  if (status === "pending") return "Válida hasta";
  if (status === "expired") return "Venció el";
  return "Fecha límite original";
}

/** Formato unico de fecha y hora, siempre en UTC y con la zona indicada. */
export function formatDateTimeUtc(d: Date): string {
  return `${d.toLocaleString("es-CL", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  })} UTC`;
}
