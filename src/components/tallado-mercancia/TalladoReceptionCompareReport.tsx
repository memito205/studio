"use client";

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Download, Loader2, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  getTalladoReceptionCompare,
  listTalladoReceptionOptions,
  type TalladoCompareRow,
} from '@/app/talladoMercanciaActions';
import { talladoLocalDayKey } from '@/lib/talladoProductivity';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const NO_RK = '__none__';
const sumModes = (m: TalladoCompareRow['rk']) => m.normal + m.tallarEtiquetar + m.yaEtiquetada;
const fmtAt = (iso?: string) => (iso ? format(new Date(iso), 'dd/MM HH:mm') : '');

type Estado = { label: string; className: string };
function estadoDe(base: number | null, hecho: number): Estado | null {
  if (base === null) return null;
  if (hecho === 0 && base > 0) return { label: 'Sin tallar', className: 'bg-gray-500 text-white' };
  if (hecho < base) return { label: 'Pendiente', className: 'bg-red-600 text-white' };
  if (hecho > base) return { label: 'Sobrante', className: 'bg-amber-500 text-white' };
  return { label: 'Completo', className: 'bg-green-600 text-white' };
}

const Diff: React.FC<{ value: number | null }> = ({ value }) =>
  value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className={cn('font-semibold', value < 0 ? 'text-red-700' : value > 0 ? 'text-amber-700' : 'text-green-700')}>
      {value > 0 ? `+${value}` : value}
    </span>
  );

/** Recepción (RK) vs lo tallado por modo, y registrado por ubicación vs inventario cíclico del día. */
export function TalladoReceptionCompareReport() {
  const { toast } = useToast();
  const [rkOptions, setRkOptions] = useState<Array<{ id: string; rk: string; supplier: string; status: string }>>([]);
  const [rkId, setRkId] = useState<string>(NO_RK);
  const [day, setDay] = useState(() => talladoLocalDayKey());
  const [rows, setRows] = useState<TalladoCompareRow[] | null>(null);
  const [rkLabel, setRkLabel] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void listTalladoReceptionOptions().then((r) => r.success && setRkOptions(r.data || []));
  }, []);

  const load = async () => {
    setLoading(true);
    const res = await getTalladoReceptionCompare({ receptionOperationId: rkId === NO_RK ? undefined : rkId, inventoryDate: day });
    setLoading(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se pudo armar el reporte', description: res.error });
      return;
    }
    setRows(res.data || []);
    setRkLabel(res.rk);
    setOpen(null);
  };

  const computed = useMemo(
    () =>
      (rows || []).map((r) => {
        const rkTotal = sumModes(r.rk);
        const ubTotal = sumModes(r.ubicacion);
        return {
          r,
          rkTotal,
          ubTotal,
          difRk: r.recibido === null ? null : rkTotal - r.recibido,
          difInv: r.inventario === null && ubTotal === 0 ? null : ubTotal - (r.inventario ?? 0),
          estadoRk: estadoDe(r.recibido, rkTotal),
          estadoUb: ubTotal > 0 || r.inventario !== null ? estadoDe(r.inventario ?? 0, ubTotal) : null,
        };
      }),
    [rows]
  );

  const visible = useMemo(() => {
    const needle = text.trim().toUpperCase();
    return computed.filter(
      (c) =>
        (!needle || c.r.reference.includes(needle) || String(c.r.marca || '').toUpperCase().includes(needle)) &&
        (!onlyDiff || (c.difRk !== null && c.difRk !== 0) || (c.difInv !== null && c.difInv !== 0))
    );
  }, [computed, text, onlyDiff]);

  const totals = useMemo(
    () =>
      computed.reduce(
        (t, c) => ({
          recibido: t.recibido + (c.r.recibido ?? 0),
          rk: t.rk + c.rkTotal,
          ub: t.ub + c.ubTotal,
          inv: t.inv + (c.r.inventario ?? 0),
        }),
        { recibido: 0, rk: 0, ub: 0, inv: 0 }
      ),
    [computed]
  );

  const exportXlsx = () => {
    const main = visible.map((c) => ({
      Referencia: c.r.reference,
      Marca: c.r.marca || '',
      'Llegó en recepción': c.r.recibido ?? '',
      'RK · Normal': c.r.rk.normal,
      'RK · Tallar y etiquetar': c.r.rk.tallarEtiquetar,
      'RK · Ya etiquetada': c.r.rk.yaEtiquetada,
      'RK · Total tallado': c.rkTotal,
      'Dif. vs recepción': c.difRk ?? '',
      'Estado RK': c.estadoRk?.label || '',
      'Ubic. · Normal': c.r.ubicacion.normal,
      'Ubic. · Tallar y etiquetar': c.r.ubicacion.tallarEtiquetar,
      'Ubic. · Ya etiquetada': c.r.ubicacion.yaEtiquetada,
      'Ubic. · Total registrado': c.ubTotal,
      'Inventario del día': c.r.inventario ?? '',
      'Dif. vs inventario': c.difInv ?? '',
      'Estado ubicación': c.estadoUb?.label || '',
    }));
    const boxes = visible.flatMap((c) =>
      c.r.boxes.map((b) => ({
        Referencia: c.r.reference,
        Caja: b.unitNumber ?? '',
        Recibido: b.recibido,
        Tallado: b.tallado,
        Diferencia: b.tallado - b.recibido,
        Modo: b.modo || '',
        Operario: b.userName || '',
        Hora: fmtAt(b.at),
      }))
    );
    const locs = visible.flatMap((c) =>
      c.r.locations.map((l) => ({
        Referencia: c.r.reference,
        Ubicación: l.location,
        Inventario: l.inventario,
        Registrado: l.registrado,
        Diferencia: l.registrado - l.inventario,
        Modo: l.modo || '',
        Operario: l.userName || '',
        Hora: fmtAt(l.at),
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(main), 'Por referencia');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(boxes), 'Por caja');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(locs), 'Por ubicacion');
    XLSX.writeFile(wb, `Recepcion_vs_Tallado_${rkLabel || 'sin_RK'}_${day}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recepción vs Tallado</CardTitle>
        <CardDescription>
          Por referencia: lo que llegó en la RK contra lo tallado de esa RK (Normal, Tallar y etiquetar, Ya etiquetada), y lo registrado por
          ubicación contra el inventario cíclico del día. Se consulta solo al oprimir Consultar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Recepción (RK)</Label>
            <Select value={rkId} onValueChange={setRkId}>
              <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RK}>Sin RK (solo ubicación vs inventario)</SelectItem>
                {rkOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.rk} · {o.supplier}
                    {o.status === 'completed' ? ' · cerrada' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fecha inventario (ubicación)</Label>
            <Input type="date" className="h-9 w-44" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </div>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Consultar
          </Button>
          {rows && rows.length > 0 && (
            <>
              <Input className="h-9 w-56" placeholder="Buscar referencia o marca" value={text} onChange={(e) => setText(e.target.value)} />
              <Button variant={onlyDiff ? 'default' : 'outline'} size="sm" onClick={() => setOnlyDiff((v) => !v)}>
                Solo con diferencia
              </Button>
              <Button variant="outline" size="sm" onClick={exportXlsx}>
                <Download className="mr-2 h-4 w-4" /> Excel
              </Button>
            </>
          )}
        </div>

        {rows && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Llegó en recepción', totals.recibido, rkLabel ? `RK ${rkLabel}` : 'Sin RK elegida'],
              ['Tallado de la RK', totals.rk, totals.recibido ? `${Math.round((totals.rk / totals.recibido) * 100)}% de lo recibido` : ''],
              ['Registrado por ubicación', totals.ub, `Inventario ${day}`],
              ['Inventario del día (esas refs)', totals.inv, totals.inv ? `${Math.round((totals.ub / totals.inv) * 100)}% registrado` : ''],
            ].map(([label, value, hint]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{Number(value).toLocaleString('es-CO')}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
        )}

        {rows && (
          <div className="max-h-[65vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="w-6" />
                  <TableHead rowSpan={2}>Referencia</TableHead>
                  <TableHead rowSpan={2} className="text-right">Llegó RK</TableHead>
                  <TableHead colSpan={5} className="border-l text-center">Tallado de la RK</TableHead>
                  <TableHead colSpan={6} className="border-l text-center">Por ubicación vs inventario del día</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="border-l text-right">Normal</TableHead>
                  <TableHead className="text-right">Tallar y etiq.</TableHead>
                  <TableHead className="text-right">Ya etiq.</TableHead>
                  <TableHead className="text-right">Dif.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="border-l text-right">Normal</TableHead>
                  <TableHead className="text-right">Tallar y etiq.</TableHead>
                  <TableHead className="text-right">Ya etiq.</TableHead>
                  <TableHead className="text-right">Inventario</TableHead>
                  <TableHead className="text-right">Dif.</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="h-16 text-center text-muted-foreground">Sin referencias con esos filtros.</TableCell>
                  </TableRow>
                ) : (
                  visible.map((c) => {
                    const isOpen = open === c.r.reference;
                    return (
                      <Fragment key={c.r.reference}>
                        <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : c.r.reference)}>
                          <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          <TableCell className="font-medium">
                            {c.r.reference}
                            {c.r.marca && <span className="block text-xs text-muted-foreground">{c.r.marca}</span>}
                          </TableCell>
                          <TableCell className="text-right">{c.r.recibido ?? '—'}</TableCell>
                          <TableCell className="border-l text-right">{c.r.rk.normal || ''}</TableCell>
                          <TableCell className="text-right">{c.r.rk.tallarEtiquetar || ''}</TableCell>
                          <TableCell className="text-right">{c.r.rk.yaEtiquetada || ''}</TableCell>
                          <TableCell className="text-right"><Diff value={c.difRk} /></TableCell>
                          <TableCell>{c.estadoRk && <Badge className={c.estadoRk.className}>{c.estadoRk.label}</Badge>}</TableCell>
                          <TableCell className="border-l text-right">{c.r.ubicacion.normal || ''}</TableCell>
                          <TableCell className="text-right">{c.r.ubicacion.tallarEtiquetar || ''}</TableCell>
                          <TableCell className="text-right">{c.r.ubicacion.yaEtiquetada || ''}</TableCell>
                          <TableCell className="text-right">{c.r.inventario ?? '—'}</TableCell>
                          <TableCell className="text-right"><Diff value={c.difInv} /></TableCell>
                          <TableCell>{c.estadoUb && <Badge className={c.estadoUb.className}>{c.estadoUb.label}</Badge>}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={14} className="bg-muted/30">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div>
                                  <p className="mb-1 text-xs font-semibold">Por caja (RK)</p>
                                  {c.r.boxes.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Sin cajas de recepción.</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-left text-muted-foreground">
                                          <th>Caja</th><th className="text-right">Recibido</th><th className="text-right">Tallado</th><th>Modo</th><th>Operario · hora</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {c.r.boxes.map((b) => (
                                          <tr key={b.packingUnitId} className={cn(b.tallado !== b.recibido && (b.tallado < b.recibido ? 'text-red-700' : 'text-amber-700'))}>
                                            <td>#{b.unitNumber ?? '—'}</td>
                                            <td className="text-right">{b.recibido}</td>
                                            <td className="text-right">{b.tallado}</td>
                                            <td>{b.modo || (b.tallado === 0 ? 'Sin tallar' : '')}</td>
                                            <td>{[b.userName, fmtAt(b.at)].filter(Boolean).join(' · ')}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                                <div>
                                  <p className="mb-1 text-xs font-semibold">Por ubicación (inventario {day})</p>
                                  {c.r.locations.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Sin ubicaciones en el inventario ni registros por ubicación.</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-left text-muted-foreground">
                                          <th>Ubicación</th><th className="text-right">Inventario</th><th className="text-right">Registrado</th><th>Modo</th><th>Operario · hora</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {c.r.locations.map((l) => (
                                          <tr key={l.location} className={cn(l.registrado !== l.inventario && (l.registrado < l.inventario ? 'text-red-700' : 'text-amber-700'))}>
                                            <td>{l.location || '—'}</td>
                                            <td className="text-right">{l.inventario}</td>
                                            <td className="text-right">{l.registrado}</td>
                                            <td>{l.modo || (l.registrado === 0 ? 'Sin registrar' : '')}</td>
                                            <td>{[l.userName, fmtAt(l.at)].filter(Boolean).join(' · ')}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
