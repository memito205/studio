import type { TalladoEtiquetadoModo, TalladoUnit, TalladoTransferLookup } from '@/types';

/**
 * Modo etiquetado para costos: solo lo que el operario prendió en el check.
 * Sin check = normal (sin nada). Las sugerencias por camino son solo en la UI.
 */
export function resolveTalladoEtiquetadoModo(
  declared: TalladoEtiquetadoModo | null | undefined,
  _source?: TalladoUnit['source'] | TalladoTransferLookup['source']
): TalladoEtiquetadoModo | undefined {
  if (declared === 'ya_etiquetada' || declared === 'tallar_y_etiquetar') return declared;
  return undefined;
}

export function talladoEtiquetadoModoLabel(modo?: TalladoEtiquetadoModo | null): string {
  if (modo === 'ya_etiquetada') return 'Ya etiquetada';
  if (modo === 'tallar_y_etiquetar') return 'Tallar y etiquetar';
  return 'Normal';
}
