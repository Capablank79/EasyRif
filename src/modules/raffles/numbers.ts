/** Números como texto para conservar ceros a la izquierda. Debe coincidir con `raffle_numbers_format`. */
export const RAFFLE_NUMBER_PATTERN = /^[A-Z0-9]{1,12}$/;

/** Normaliza (recorta y pasa a mayúsculas) y valida. Lanza si es inválido. */
export function normalizeRaffleNumber(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!RAFFLE_NUMBER_PATTERN.test(value)) {
    throw new RangeError(`Número de rifa inválido: "${raw}"`);
  }
  return value;
}

/** Genera "001".."NNN" para una rifa de `count` números (ceros a la izquierda). */
export function generateSequentialNumbers(count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 10 ** 9) {
    throw new RangeError("La cantidad de números debe ser un entero positivo");
  }
  const width = String(count).length;
  return Array.from({ length: count }, (_, i) =>
    String(i + 1).padStart(width, "0"),
  );
}
