const BOGOTA_TZ = 'America/Bogota';

/** Formato legible en hora Colombia (sin depender del timezone del servidor). */
export function formatDateTimeBogota(input: Date | number): string {
  const date = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatTimeBogota(input: Date | number): string {
  const date = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
