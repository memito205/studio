"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Download, Loader2, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/hooks/use-auth-context';
import { getAnalyzerSnapshotGlobal, getAnalyzerSnapshotStore } from '@/app/analyzerSnapshotActions';
import type {
  AnalyzerSnapshotGlobalPayload,
  AnalyzerSnapshotMeta,
  AnalyzerSnapshotStorePayload,
  SnapshotKpi,
} from '@/lib/analyzerSnapshot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const MAX_VISIBLE_ROWS = 300;

const fmtAt = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, 'dd/MM/yyyy HH:mm') : 'N/D';
};

function KpiGrid({ kpi }: { kpi: SnapshotKpi }) {
  const items = [
    ['TF únicas', kpi.uniqueTfCount],
    ['Líneas', kpi.totalDocs],
    ['Entregadas', kpi.deliveredCount],
    ['Pendientes', kpi.pendingCount],
    ['Unid. entregadas', kpi.deliveredQty],
    ['Unid. pendientes', kpi.pendingQty],
    ['Cumplimiento', kpi.compliancePercentage],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border bg-slate-50 px-3 py-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value || '0'}</p>
        </div>
      ))}
    </div>
  );
}

function MetaLine({ meta }: { meta: AnalyzerSnapshotMeta }) {
  return (
    <p className="text-xs text-muted-foreground">
      Foto del {fmtAt(meta.at)}
      {meta.byName ? ` · Guardada por ${meta.byName}` : ''}
      {meta.fileName ? ` · Base: ${meta.fileName}` : ''}
    </p>
  );
}

function StoreDetail({ data }: { data: AnalyzerSnapshotStorePayload }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const statusIdx = data.headers.indexOf('ESTADO PLATAFORMA');
  const docIdx = data.headers.indexOf('NRO DOCUMENTO.2');
  const linkIdx = data.headers.indexOf('LINK IMAGENES.1.1.1');

  const statuses = useMemo(
    () => (statusIdx < 0 ? [] : Array.from(new Set(data.rows.map((r) => String(r[statusIdx] || '')))).filter(Boolean).sort()),
    [data.rows, statusIdx]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return data.rows.filter(
      (r) =>
        (status === 'all' || String(r[statusIdx]) === status) &&
        (!q || (docIdx >= 0 && String(r[docIdx]).toUpperCase().includes(q)))
    );
  }, [data.rows, search, status, statusIdx, docIdx]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([data.headers, ...data.rows]), 'Reporte');
    const pendingRows = data.pending.flatMap((p) =>
      p.pendingRecords.flatMap((rec) =>
        rec.detailedDocs.map((d) => ({
          'BOD. ENTRADA': p.warehouse,
          MARCA: rec.marca,
          GRUPO: rec.grupo,
          'NRO DOCUMENTO': d.docNumber,
          'FECHA DOC': d.docDate,
          CANTIDAD: d.quantity,
          'DIAS PENDIENTE': d.daysPending,
          'EN RUTA': d.enRuta,
          'BOD. SALIDA': d.warehouseOut,
        }))
      )
    );
    if (pendingRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendingRows), 'Pendientes');
    if (data.brands.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.brands), 'Marcas');
    XLSX.writeFile(wb, `reporte_bodega_${data.storeCode || data.key}.xlsx`);
  };

  const pendingRecords = data.pending.flatMap((p) => p.pendingRecords.map((rec) => ({ ...rec, warehouse: p.warehouse })));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{data.label}</h3>
        <Button variant="outline" size="sm" onClick={exportExcel}>
          <Download className="h-4 w-4 mr-2" />
          Excel
        </Button>
      </div>
      <KpiGrid kpi={data.kpi} />

      {data.sla.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {data.sla.map((s) => (
            <Badge key={s.warehouse} variant="secondary">
              SLA {s.warehouse}: {s.compliance.toFixed(1)}% · {s.totalFinalized} finalizadas · {s.overdueCount} vencidas
            </Badge>
          ))}
        </div>
      )}

      {pendingRecords.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">Pendientes por marca / grupo</p>
          <div className="max-h-64 overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marca</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">TF</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Días prom.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRecords.map((r, i) => (
                  <TableRow key={`${r.warehouse}-${r.marca}-${r.grupo}-${i}`}>
                    <TableCell>{r.marca}</TableCell>
                    <TableCell>{r.grupo}</TableCell>
                    <TableCell className="text-right">{r.docCount}</TableCell>
                    <TableCell className="text-right">{r.totalQuantity.toLocaleString('es-CO')}</TableCell>
                    <TableCell className="text-right">{r.avgDaysPending.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Buscar TF" value={search} onChange={(e) => setSearch(e.target.value)} />
          {statuses.length > 0 && (
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Estado plataforma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground self-center">
            {filtered.length} de {data.rows.length} líneas
            {filtered.length > MAX_VISIBLE_ROWS ? ` (se muestran ${MAX_VISIBLE_ROWS}; use Excel para ver todo)` : ''}
          </span>
        </div>
        <div className="max-h-[480px] overflow-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                {data.headers.map((h) => (
                  <TableHead key={h} className="whitespace-nowrap">
                    {h === 'NRO DOCUMENTO.2' ? 'TF' : h === 'LINK IMAGENES.1.1.1' ? 'EVIDENCIAS' : h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, MAX_VISIBLE_ROWS).map((r, i) => (
                <TableRow key={i}>
                  {r.map((v, j) => (
                    <TableCell key={j} className="whitespace-nowrap text-xs">
                      {j === linkIdx && String(v).includes('http')
                        ? String(v)
                            .split('|')
                            .map((l) => l.trim())
                            .filter((l) => l.startsWith('http'))
                            .map((l, k) => (
                              <a key={k} href={l} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline mr-2">
                                Evidencia {k + 1}
                              </a>
                            ))
                        : String(v)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/** Última foto guardada del Analizador de Bodega. Tiendas: solo su tienda. Office/admin: resumen y detalle por tienda. */
export function AnalyzerSnapshotView() {
  const { role, storeCode } = useAuth();
  const isStore = role === 'tiendas';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [global, setGlobal] = useState<{ meta: AnalyzerSnapshotMeta; payload: AnalyzerSnapshotGlobalPayload } | null>(null);
  const [store, setStore] = useState<{ meta: AnalyzerSnapshotMeta; payload: AnalyzerSnapshotStorePayload } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStore = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const res = await getAnalyzerSnapshotStore(key);
    if (res.error) setError(res.error);
    else if (!res.data) {
      setStore(null);
      setNotice(
        res.lastAt
          ? `Su tienda no tiene TF en la última foto del reporte (${fmtAt(res.lastAt)}).`
          : 'Aún no hay foto guardada del reporte de bodega.'
      );
    } else setStore(res.data);
    setLoading(false);
  }, []);

  const loadGlobal = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setStore(null);
    const res = await getAnalyzerSnapshotGlobal();
    if (res.error) setError(res.error);
    else {
      setGlobal(res.data ?? null);
      if (!res.data) setNotice('Aún no hay foto guardada del reporte de bodega.');
    }
    setLoading(false);
  }, []);

  const reload = useCallback(() => {
    if (isStore) {
      if (storeCode) void loadStore(storeCode);
      else setNotice('Su usuario no tiene tienda asignada.');
    } else void loadGlobal();
  }, [isStore, storeCode, loadStore, loadGlobal]);

  useEffect(() => {
    reload();
  }, [reload]);

  const exportStores = () => {
    if (!global) return;
    const rows = global.payload.stores.map((s) => ({
      Tienda: s.label,
      'TF únicas': s.kpi.uniqueTfCount,
      Líneas: s.kpi.totalDocs,
      Entregadas: s.kpi.deliveredCount,
      Pendientes: s.kpi.pendingCount,
      'Unid. pendientes': s.kpi.pendingQty,
      Cumplimiento: s.kpi.compliancePercentage,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tiendas');
    if (global.payload.brands.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(global.payload.brands), 'Marcas');
    XLSX.writeFile(wb, `reporte_bodega_resumen.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {!isStore && store ? (
          <Button variant="ghost" size="sm" onClick={() => setStore(null)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Todas las tiendas
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Actualizar
        </Button>
      </div>

      {error && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>}
      {notice && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">{notice}</div>}

      {store ? (
        <>
          <MetaLine meta={store.meta} />
          <StoreDetail data={store.payload} />
        </>
      ) : (
        !isStore &&
        global && (
          <div className="space-y-4">
            <MetaLine meta={global.meta} />
            <KpiGrid kpi={global.payload.kpi} />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Tiendas ({global.payload.stores.length}) · clic para ver el detalle</p>
              <Button variant="outline" size="sm" onClick={exportStores}>
                <Download className="h-4 w-4 mr-2" />
                Excel
              </Button>
            </div>
            <div className="max-h-[520px] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tienda</TableHead>
                    <TableHead className="text-right">TF únicas</TableHead>
                    <TableHead className="text-right">Entregadas</TableHead>
                    <TableHead className="text-right">Pendientes</TableHead>
                    <TableHead className="text-right">Unid. pend.</TableHead>
                    <TableHead className="text-right">Cumplimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {global.payload.stores.map((s) => (
                    <TableRow key={s.key} className="cursor-pointer hover:bg-slate-50" onClick={() => void loadStore(s.key)}>
                      <TableCell className="font-medium">{s.label}</TableCell>
                      <TableCell className="text-right">{s.kpi.uniqueTfCount}</TableCell>
                      <TableCell className="text-right">{s.kpi.deliveredCount}</TableCell>
                      <TableCell className="text-right">{s.kpi.pendingCount}</TableCell>
                      <TableCell className="text-right">{s.kpi.pendingQty}</TableCell>
                      <TableCell className="text-right">{s.kpi.compliancePercentage}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
