import { describe, expect, it } from 'vitest';
import { historyRangeFromProcessedRows } from './historyRangeFromProcessedRows';

describe('historyRangeFromProcessedRows', () => {
  it('devuelve undefined si no hay filas', () => {
    expect(historyRangeFromProcessedRows([])).toBeUndefined();
  });

  it('calcula min y max en yyyy-MM-dd', () => {
    // Mediodía local evita desfases al parsear ISO solo-fecha como UTC vs getFullYear/getDate local.
    const rows = [
      { itemCode: 'A', docType: 'RMV', quantity: 1, date: new Date(2023, 0, 15, 12, 0, 0), bodega: 'B1' },
      { itemCode: 'A', docType: 'RMV', quantity: 2, date: new Date(2026, 3, 2, 12, 0, 0), bodega: 'B1' },
    ];
    expect(historyRangeFromProcessedRows(rows)).toEqual({ from: '2023-01-15', to: '2026-04-02' });
  });
});
