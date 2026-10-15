/** Mensaje para el usuario cuando una server action falla en el navegador (p. ej. pestaña abierta antes de un despliegue). */
export function serverActionErrorText(error: unknown): string {
  const msg = String((error as { message?: string })?.message || error || '');
  if (/server action|failed to fetch|unexpected response|network/i.test(msg)) {
    return 'La aplicación se actualizó o se perdió la conexión. Recargue la página (Ctrl+F5) e intente de nuevo.';
  }
  return msg || 'Error inesperado. Recargue la página e intente de nuevo.';
}
