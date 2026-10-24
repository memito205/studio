'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  listRecentReceptionsForCommercial,
  loadReceptionStockForCommercial,
  type CommercialReceptionOption,
} from '@/app/commercialOrderActions';
import { parseExcelFile } from '../services/parser';
import {
  buildCommercialWorkbook,
  downloadCommercialTemplate,
  downloadCommercialWorkbook,
  parseCommercialRows,
  resolveCommercialLines,
  type CommercialHeader,
} from '../services/commercialOrder';
import type { StockItem } from '../types';

const today = () => new Date().toISOString().slice(0, 10);

const CommercialOrderPanel = () => {
  const [header, setHeader] = useState<CommercialHeader>({
    nitUnico: '',
    sucursal: '001',
    tipoCliente: '0002',
    condPago: 'M30',
    vendedor: '1000',
    co: '999',
    bodegaDefault: 'BDIS2',
    listaPrecio: 'VME',
    dias: 3,
    nroPedido: 1,
    fecha: today(),
  });
  const [receptions, setReceptions] = useState<CommercialReceptionOption[] | null>(null);
  const [receptionId, setReceptionId] = useState('');
  const [stock, setStock] = useState<StockItem[] | null>(null);
  const [stockLabel, setStockLabel] = useState('');
  const [rows, setRows] = useState<ReturnType<typeof parseCommercialRows> | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const setField = (key: keyof CommercialHeader, value: string) => {
    setHeader((prev) => ({
      ...prev,
      [key]: key === 'dias' || key === 'nroPedido' ? Number(value) : value,
    }));
  };

  const loadList = async () => {
    setBusy(true);
    setError('');
    const res = await listRecentReceptionsForCommercial();
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error || 'No se pudieron leer las recepciones.');
      return;
    }
    setReceptions(res.data);
  };

  const loadReception = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const res = await loadReceptionStockForCommercial(receptionId);
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error || 'No se pudo leer la recepción.');
      return;
    }
    if (res.data.length === 0) {
      setError('Esa recepción no tiene lecturas con referencia y talla.');
      return;
    }
    const next: StockItem[] = res.data.map((line) => ({
      REFERENCIA: line.referencia,
      NOMBRE: line.nombre,
      TALLA: line.talla,
      'CANTD LEIDA': line.cantidad,
    }));
    setStock(next);
    const units = next.reduce((sum, line) => sum + line['CANTD LEIDA'], 0);
    const rk = receptions?.find((item) => item.id === receptionId);
    setStockLabel(`${rk?.rk || receptionId}: ${units} unidades leídas`);
    setMessage(res.truncated ? 'Se leyeron las primeras 8000 lecturas de esa recepción.' : '');
  };

  const onQuantities = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const json = await parseExcelFile<Record<string, unknown>>(file);
      const parsed = parseCommercialRows(json);
      if (parsed.length === 0) throw new Error('El archivo no tiene referencias.');
      setRows(parsed);
      setFileName(file.name);
    } catch (e: unknown) {
      setRows(null);
      setFileName('');
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  };

  const generate = () => {
    setError('');
    setMessage('');
    if (!stock) {
      setError('Cargue una recepción para tomar las tallas.');
      return;
    }
    if (!rows) {
      setError('Suba el archivo de cantidades.');
      return;
    }
    try {
      const resolved = resolveCommercialLines(rows, stock, header);
      const book = buildCommercialWorkbook(stock, resolved.lines, header);
      downloadCommercialWorkbook(book.pedidos, book.movto);
      const units = book.movto.reduce((sum, line) => sum + Number(line.CANT || 0), 0);
      const notes = [
        `${book.pedidos.length} pedido(s), ${book.movto.length} líneas, ${units} unidades.`,
        ...resolved.notes,
      ];
      if (book.short > 0) notes.push(`${book.short} unidades pedidas no alcanzaron en las tallas leídas.`);
      setMessage(notes.join(' '));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo armar el pedido.');
    }
  };

  return (
    <section className="mb-10 rounded-2xl border border-gray-200 bg-gray-50 p-5">
      <h2 className="text-xl font-bold text-gray-800">Pedido comercial para clientes</h2>
      <p className="mt-1 text-sm text-gray-600">
        Las tallas salen de la recepción. El archivo trae referencia, cantidad, precio y bodega. Si son varios clientes, el NIT va en el archivo. Si es uno solo, escríbalo abajo y deje el NIT vacío.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="NIT de un solo cliente" value={header.nitUnico} onChange={(v) => setField('nitUnico', v)} />
        <Field label="Sucursal" value={header.sucursal} onChange={(v) => setField('sucursal', v)} />
        <Field label="Tipo de cliente" value={header.tipoCliente} onChange={(v) => setField('tipoCliente', v)} />
        <Field label="Condición de pago" value={header.condPago} onChange={(v) => setField('condPago', v)} />
        <Field label="Vendedor" value={header.vendedor} onChange={(v) => setField('vendedor', v)} />
        <Field label="Centro de operación" value={header.co} onChange={(v) => setField('co', v)} />
        <Field label="Bodega si el archivo la deja vacía" value={header.bodegaDefault} onChange={(v) => setField('bodegaDefault', v)} />
        <Field label="Lista de precio" value={header.listaPrecio} onChange={(v) => setField('listaPrecio', v)} />
        <Field label="Días de entrega" value={String(header.dias)} onChange={(v) => setField('dias', v)} type="number" />
        <Field label="Número de pedido inicial" value={String(header.nroPedido)} onChange={(v) => setField('nroPedido', v)} type="number" />
        <Field label="Fecha" value={header.fecha} onChange={(v) => setField('fecha', v)} type="date" />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Button type="button" variant="secondary" onClick={() => void loadList()} disabled={busy}>
          Ver recepciones
        </Button>
        <select
          className="h-10 min-w-64 rounded-md border bg-white px-2 text-sm"
          value={receptionId}
          onChange={(e) => setReceptionId(e.target.value)}
        >
          <option value="">Elija la recepción</option>
          {(receptions || []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.rk} · {item.supplier || 'Sin proveedor'} · {item.scanned} leídas
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => void loadReception()} disabled={busy || !receptionId}>
          Usar lo leído
        </Button>
        <Button type="button" variant="outline" onClick={downloadCommercialTemplate}>
          Plantilla de cantidades
        </Button>
        <label className="inline-flex h-10 cursor-pointer items-center rounded-md border bg-white px-3 text-sm">
          Subir cantidades
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => void onQuantities(e.target.files?.[0])}
          />
        </label>
        <Button type="button" onClick={generate} disabled={busy}>
          Descargar pedido
        </Button>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {stockLabel || 'Todavía no hay tallas cargadas.'}
        {fileName ? ` Archivo: ${fileName}.` : ''}
      </p>
      {message ? <p className="mt-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </section>
  );
};

const Field = ({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

export default CommercialOrderPanel;
