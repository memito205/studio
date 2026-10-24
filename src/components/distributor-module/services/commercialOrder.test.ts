import { describe, expect, it } from 'vitest';
import { buildCommercialWorkbook, resolveCommercialLines, type CommercialHeader } from './commercialOrder';
import type { StockItem } from '../types';

const header: CommercialHeader = {
  nitUnico: '',
  sucursal: '001',
  tipoCliente: '0002',
  condPago: 'M30',
  vendedor: '1000',
  co: '999',
  bodegaDefault: 'BDIS2',
  listaPrecio: 'VME',
  dias: 3,
  nroPedido: 7617,
  fecha: '2026-09-30',
};

const stock: StockItem[] = [
  { REFERENCIA: '441920BEI', NOMBRE: 'ZAPATO', TALLA: '7', 'CANTD LEIDA': 6 },
  { REFERENCIA: '441920BEI', NOMBRE: 'ZAPATO', TALLA: '8', 'CANTD LEIDA': 6 },
];

describe('pedido comercial', () => {
  it('parte en partes iguales lo leído cuando la cantidad va vacía', () => {
    const { lines } = resolveCommercialLines(
      [
        { referencia: '441920BEI', nit: '805027987', cant: null, precio: 63070, bodega: 'BDIS2' },
        { referencia: '441920BEI', nit: '900123456', cant: null, precio: 63070, bodega: 'BODVI' },
      ],
      stock,
      header
    );
    expect(lines.map((line) => line.cant)).toEqual([6, 6]);
    const book = buildCommercialWorkbook(stock, lines, header);
    expect(book.pedidos).toHaveLength(2);
    expect(book.pedidos[0]).toMatchObject({
      NUMDOC: 1,
      FECHA_PEDIDO: 20260930,
      TERCERO: 805027987,
      SUCURSAL: '001',
      'NRO:DIAS_ENTREGA': 3,
      NRO_PEDIDO: 7617,
      PTO_ENVIO: '000',
    });
    expect(book.pedidos[1].NRO_PEDIDO).toBe(7618);
    expect(book.movto.every((line) => line.LISTA_PRECIO === 'VME')).toBe(true);
    const units = book.movto.reduce((sum, line) => sum + Number(line.CANT), 0);
    expect(units).toBe(12);
    const bodegas = new Set(book.movto.map((line) => line.BODEGA));
    expect(bodegas).toEqual(new Set(['BDIS2', 'BODVI']));
  });

  it('usa el NIT de pantalla cuando el archivo no lo trae', () => {
    const { lines } = resolveCommercialLines(
      [{ referencia: '441920BEI', nit: '', cant: null, precio: 1000, bodega: '' }],
      stock,
      { ...header, nitUnico: '805027987' }
    );
    expect(lines).toEqual([
      expect.objectContaining({ nit: '805027987', bodega: 'BDIS2', cant: 12 }),
    ]);
  });
});
