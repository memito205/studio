export type CyclicCountDiffStatus = 'pending' | 'cuadrado' | 'faltante' | 'sobrante';

export function getCyclicCountDiff(
  expectedQty: number,
  countedQty: number | null | undefined
): { status: CyclicCountDiffStatus; diff: number; label: string } {
  if (countedQty === null || countedQty === undefined || Number.isNaN(Number(countedQty))) {
    return { status: 'pending', diff: 0, label: 'Pendiente' };
  }
  const c = Number(countedQty);
  const e = Number(expectedQty);
  const diff = c - e;
  if (diff === 0) {
    return { status: 'cuadrado', diff: 0, label: 'Cuadrado' };
  }
  if (diff < 0) {
    return { status: 'faltante', diff, label: `Faltan ${Math.abs(diff)}` };
  }
  return { status: 'sobrante', diff, label: `Sobran ${diff}` };
}
