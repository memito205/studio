/**
 * Auditoría recepción ↔ control de muestras.
 *
 * Solo se consideran lecturas de recepción con scanned_at >= esta marca temporal.
 * Las verificaciones guardadas antes de esta fecha no cuentan como “validación registrada”
 * para este reporte (histórico de validaciones a partir del arranque del proceso).
 *
 * Ajuste aquí si cambia la fecha oficial (hora UTC).
 */
export const RECEPTION_SAMPLE_AUDIT_START_ISO = '2026-02-02T00:00:00.000Z';
