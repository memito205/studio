"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { ArrowLeft, Loader2, Truck, XCircle, FileArchive, ScanLine } from 'lucide-react';
import { firestore } from '@/services/firebase';
import type {
  SavedVerification,
  TransferActor,
  VerificationDispatchClass,
  VerificationItem,
  VerificationLoadScan,
} from '@/types';
import {
  closeVerificationDispatch,
  getVerificationLoadScans,
  recordVerificationLoadScan,
  removeVerificationLoadScan,
} from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/components/dispatch-manager/utils/cn';
import {
  arrivalLabel,
  findItemForCode,
  normalizeScanCode,
  resolveOutOfPlanCode,
} from '@/components/dispatch-manager/utils/verificationScan';
import {
  downloadStoreSummaryPdfs,
  verificationItemsToSummaryRows,
} from '@/components/dispatch-manager/utils/storeSummaryPdf';
import { DISPATCH_CLASS_LABEL as CLASS_LABEL, downloadAltCodesExcel } from '@/components/dispatch-manager/utils/dispatchReport';
import { mergeRemotePicks, useLiveVerificationSession } from '@/components/dispatch-manager/utils/liveSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const NOT_LOADED_REASONS = [
  'Sin cupo en el camión',
  'Dañada',
  'Se devolvió a la ubicación',
  'No apareció al cargar',
];

type CargueRow = VerificationItem & {
  picked: boolean;
  loaded: boolean;
  loadOnly: boolean;
  scan?: VerificationLoadScan;
  cls: VerificationDispatchClass;
};

const classify = (picked: boolean, loaded: boolean, notFound: boolean): VerificationDispatchClass => {
  if (picked && loaded) return 'ambas';
  if (loaded) return 'solo_cargue';
  if (picked) return 'solo_alistamiento';
  return notFound ? 'no_encontrada' : 'sin_leer';
};

const tsToDate = (v: unknown): Date => (v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : new Date());

const stripTimestamps = (v: any): any => {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map(stripTimestamps);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, stripTimestamps(val)]));
  }
  return v;
};

const VerificationCargue: React.FC<{
  session: SavedVerification;
  data: VerificationItem[];
  onBack: () => void;
  onGoToPicking?: () => void;
}> = ({ session, data: initialData, onBack, onGoToPicking }) => {
  const { user, userName, role } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<VerificationItem[]>(initialData);
  useLiveVerificationSession(session.id, (live) => {
    setData((prev) => mergeRemotePicks(prev, live.results));
  });
  const canClose = role === 'admin' || role === 'supervisor';
  const actor: TransferActor | undefined = useMemo(
    () =>
      user?.uid
        ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' }
        : undefined,
    [user, userName]
  );

  const [scans, setScans] = useState<VerificationLoadScan[]>([]);
  const [scansReady, setScansReady] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastScan, setLastScan] = useState<{
    type: 'success' | 'warning' | 'error' | 'duplicate';
    message: string;
    code: string;
    detail?: string;
  } | null>(null);
  const [filter, setFilter] = useState<'all' | VerificationDispatchClass>('all');
  const [search, setSearch] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [isClosing, setIsClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionDestinos = useMemo(() => new Set(session.results.map((i) => i.destino)), [session.results]);

  const [polling, setPolling] = useState(false);

  const refreshScans = useCallback(async () => {
    const res = await getVerificationLoadScans(session.id);
    if (res.success && res.scans) {
      setScans(res.scans);
      setScansReady(true);
    } else if (!res.success) {
      toast({ variant: 'destructive', title: 'Error leyendo el cargue', description: res.error });
    }
  }, [session.id, toast]);

  useEffect(() => {
    if (!polling) return;
    void refreshScans();
    const t = setInterval(() => void refreshScans(), 4000);
    return () => clearInterval(t);
  }, [polling, refreshScans]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(firestore, 'verificationSessions', session.id, 'loadScans'),
      (snap) => {
        setScans(
          snap.docs.map((d) => {
            const raw = d.data();
            return {
              id: d.id,
              codigo: String(raw.codigo || ''),
              at: tsToDate(raw.at),
              byId: raw.byId,
              byName: raw.byName,
              inPicking: !!raw.inPicking,
              ...(raw.item ? { item: stripTimestamps(raw.item) as VerificationItem } : {}),
            };
          })
        );
        setScansReady(true);
      },
      (err) => {
        console.warn('loadScans snapshot no disponible, se consulta cada 4 s', err);
        setPolling(true);
      }
    );
    return () => unsub();
  }, [session.id, toast]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const scanByCode = useMemo(() => new Map(scans.map((s) => [s.codigo, s])), [scans]);
  const loadOnlyItems = useMemo(
    () => scans.filter((s) => s.item && !data.some((d) => d.codigo === s.codigo)).map((s) => s.item as VerificationItem),
    [scans, data]
  );

  const rows: CargueRow[] = useMemo(() => {
    const base = data.map((item) => {
      const scan = scanByCode.get(item.codigo);
      const loaded = !!scan;
      return { ...item, picked: item.scanned, loaded, loadOnly: false, scan, cls: classify(item.scanned, loaded, !!item.notFound) };
    });
    const extra = loadOnlyItems.map((item) => ({
      ...item,
      picked: false,
      loaded: true,
      loadOnly: true,
      scan: scanByCode.get(item.codigo),
      cls: 'solo_cargue' as VerificationDispatchClass,
    }));
    return [...base, ...extra];
  }, [data, loadOnlyItems, scanByCode]);

  const counts = useMemo(() => {
    const c: Record<VerificationDispatchClass, number> = { ambas: 0, solo_cargue: 0, solo_alistamiento: 0, no_encontrada: 0, sin_leer: 0 };
    rows.forEach((r) => (c[r.cls] += 1));
    return c;
  }, [rows]);
  const pickedTotal = useMemo(() => data.filter((i) => i.scanned).length, [data]);
  const loadedTotal = counts.ambas + counts.solo_cargue;

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' || r.cls === filter)
      .filter(
        (r) =>
          !q ||
          r.codigo.toLowerCase().includes(q) ||
          (r.ubicacion || '').toLowerCase().includes(q) ||
          r.destino.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (a.loaded !== b.loaded) return a.loaded ? 1 : -1;
        return (a.ubicacion || '\uffff').localeCompare(b.ubicacion || '\uffff', 'es', { numeric: true });
      });
  }, [rows, filter, search]);

  const record = async (codigo: string, inPicking: boolean, item?: VerificationItem) => {
    const res = await recordVerificationLoadScan(session.id, { codigo, inPicking, item }, actor);
    if (res.duplicate) {
      setLastScan({ type: 'duplicate', message: 'YA ESTÁ CARGADA EN EL CAMIÓN', code: codigo });
      return false;
    }
    if (!res.success) {
      setLastScan({ type: 'error', message: 'ERROR REGISTRANDO EL CARGUE', code: codigo, detail: res.error });
      return false;
    }
    if (polling) void refreshScans();
    return true;
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeScanCode(scanInput);
    setScanInput('');
    if (!code || busy) return;
    setBusy(true);
    try {
      const match = findItemForCode(data, code);
      if (match && 'ambiguous' in match) {
        setLastScan({ type: 'error', message: 'TF EN VARIOS DESTINOS — LEA EL RÓTULO DESTINO-TF', code, detail: match.ambiguous.join(', ') });
        return;
      }
      if (match && 'index' in match) {
        const item = data[match.index];
        if (scanByCode.has(item.codigo)) {
          setLastScan({ type: 'duplicate', message: 'YA ESTÁ CARGADA EN EL CAMIÓN', code: item.codigo });
          return;
        }
        if (!(await record(item.codigo, item.scanned))) return;
        setLastScan(
          item.scanned
            ? { type: 'success', message: 'CARGADA', code: item.codigo, detail: `${item.destino} · ${item.cantTft} und` }
            : {
                type: 'warning',
                message: 'CARGADA SIN ALISTAMIENTO',
                code: item.codigo,
                detail: 'No se había leído en alistamiento; queda como "Solo cargue".',
              }
        );
        return;
      }

      const loadOnlyMatch = findItemForCode(loadOnlyItems, code);
      if (loadOnlyMatch) {
        setLastScan({ type: 'duplicate', message: 'YA ESTÁ CARGADA EN EL CAMIÓN', code });
        return;
      }
      const res = await resolveOutOfPlanCode(code, {
        excluded: session.excludedResults || [],
        sessionDestinos,
        existing: [data, loadOnlyItems],
      });
      if (!res.ok) {
        setLastScan({ type: res.type === 'duplicate' ? 'duplicate' : 'error', message: res.message, code, detail: res.detail });
        return;
      }
      const item: VerificationItem = { ...res.item, scanned: false, outOfPlan: true };
      if (!(await record(item.codigo, false, item))) return;
      setLastScan({ type: 'warning', message: 'CARGADA FUERA DEL PLAN', code: item.codigo, detail: res.reason });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const handleRemove = async (codigo: string) => {
    const res = await removeVerificationLoadScan(session.id, codigo);
    if (!res.success) toast({ variant: 'destructive', title: 'No se pudo quitar', description: res.error });
    else if (polling) void refreshScans();
  };

  const pendingReasonRows = rows.filter((r) => r.cls === 'solo_alistamiento');
  const missingReasons = pendingReasonRows.filter((r) => !reasons[r.codigo]).length;

  const handleCloseDispatch = async () => {
    if (!session.cargue || missingReasons > 0) return;
    if (loadedTotal === 0) {
      toast({ variant: 'destructive', title: 'Camión vacío', description: 'Lea al menos una caja en el camión.' });
      return;
    }
    setIsClosing(true);
    const now = new Date();
    const results: VerificationItem[] = rows.map(({ picked, loaded, loadOnly, scan, cls, ...item }) => ({
      ...item,
      dispatchClass: cls,
      ...(scan ? { loadedAt: scan.at, loadedByName: scan.byName || '' } : {}),
      ...(cls === 'solo_alistamiento' ? { notLoadedReason: reasons[item.codigo] } : {}),
    }));
    const loadedRows = rows.filter((r) => r.loaded);
    const stats = {
      total: results.length,
      scanned: results.filter((i) => i.scanned).length,
      pending: results.filter((i) => !i.scanned).length,
    };
    const res = await closeVerificationDispatch(
      session.id,
      {
        sessionName: session.name,
        results,
        stats,
        loaded: loadedRows.map((r) => ({ codigo: r.codigo, tf: r.tftCruce || r.tfOriginal, destino: r.destino })),
        summary: counts,
        cargue: session.cargue,
      },
      actor
    );
    if (!res.success) {
      setIsClosing(false);
      toast({ variant: 'destructive', title: 'No se cerró el despacho', description: res.error, duration: 10000 });
      return;
    }

    const loadedItems = results.filter((i) => i.dispatchClass === 'ambas' || i.dispatchClass === 'solo_cargue');
    await downloadStoreSummaryPdfs(verificationItemsToSummaryRows(loadedItems), { sessionName: session.name, variant: 'actual' });
    if (res.altRows && res.altRows.length > 0) {
      downloadAltCodesExcel(res.altRows, {
        sessionName: session.name,
        manifestId: res.manifestId,
        placa: session.cargue.placa,
        fecha: now,
      });
    }

    toast({
      title: `Despacho cerrado${res.manifestId ? ` · Relación #${res.manifestId}` : ''}`,
      description: `${loadedItems.length} caja(s) pasaron a Enviado a Destino (${format(now, 'HH:mm')}).${
        res.altRows?.length ? ` Se descargó el Excel de ${res.altRows.length} código(s) alterno(s).` : ''
      }`,
      duration: 10000,
    });
    if (res.skipped && res.skipped.length > 0) {
      toast({
        variant: 'destructive',
        title: `${res.skipped.length} TF cargada(s) no entraron en la relación`,
        description: res.skipped.slice(0, 5).map((s) => `${s.codigo}: ${s.reason}`).join(' · '),
        duration: 15000,
      });
    }
    setIsClosing(false);
    setCloseOpen(false);
    onBack();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 flex flex-col gap-6">
        <Button onClick={onBack} variant="outline" className="justify-start">
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver a la Lista de Sesiones
        </Button>
        {onGoToPicking && (
          <Button onClick={onGoToPicking} variant="secondary" className="justify-start">
            <ScanLine className="mr-2 h-4 w-4" /> Seguir alistando (validación)
          </Button>
        )}
        <Card className="border-indigo-300">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> Cargue: {session.name}
            </CardTitle>
            <CardDescription>
              Placa <strong>{session.cargue?.placa}</strong> · Conductor <strong>{session.cargue?.conductor}</strong>
              {session.cargue?.auxiliares ? ` · Aux: ${session.cargue.auxiliares}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleScan}>
              <Input
                ref={inputRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Leer caja al subirla al camión..."
                className="w-full text-xl"
                autoComplete="off"
                disabled={!scansReady}
              />
            </form>
            {busy && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Registrando...
              </p>
            )}
          </CardContent>
        </Card>

        {lastScan && (
          <div
            className={cn(
              'p-4 border-l-4 rounded-md',
              lastScan.type === 'success' && 'bg-green-50 border-green-600 text-green-800',
              lastScan.type === 'warning' && 'bg-blue-50 border-blue-700 text-blue-950',
              lastScan.type === 'error' && 'bg-red-50 border-red-600 text-red-800',
              lastScan.type === 'duplicate' && 'bg-orange-50 border-orange-600 text-orange-800'
            )}
          >
            <p className="font-bold text-sm uppercase">{lastScan.message}</p>
            <p className="text-xs mt-1 opacity-70">Código: {lastScan.code}</p>
            {lastScan.detail && <p className="text-xs mt-2 font-medium">{lastScan.detail}</p>}
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Doble lectura</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-sm text-muted-foreground">Alistadas</span><p className="text-2xl font-bold">{pickedTotal}</p></div>
              <div><span className="text-sm text-muted-foreground">En camión</span><p className="text-2xl font-bold text-green-600">{loadedTotal}</p></div>
              <div><span className="text-sm text-muted-foreground">Alistadas sin cargar</span><p className="text-2xl font-bold text-orange-600">{counts.solo_alistamiento}</p></div>
              <div><span className="text-sm text-muted-foreground">Solo cargue</span><p className="text-2xl font-bold text-blue-700">{counts.solo_cargue}</p></div>
              <div><span className="text-sm text-muted-foreground">No encontradas</span><p className="text-2xl font-bold text-red-600">{counts.no_encontrada}</p></div>
              <div><span className="text-sm text-muted-foreground">Sin leer</span><p className="text-2xl font-bold text-muted-foreground">{counts.sin_leer}</p></div>
            </div>
            {canClose && (
              <Button
                className="mt-6 w-full bg-amber-600 hover:bg-amber-700 text-white"
                disabled={isClosing || loadedTotal === 0}
                onClick={() => setCloseOpen(true)}
              >
                {isClosing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
                Cerrar despacho
              </Button>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
              Solo lo leído en el camión pasa a <strong>Enviado a Destino</strong> y entra en la relación de entrega y el ZIP real.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="lg:col-span-2 flex flex-col h-[calc(100vh-14rem)]">
        <CardHeader>
          <CardTitle>Lista de cargue</CardTitle>
          <CardDescription className="flex justify-between items-center gap-2">
            <span>{loadedTotal} en camión</span>
            <div className="flex gap-2">
              <Input
                placeholder="Código, ubicación o destino..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-[200px] h-8 text-xs"
              />
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className="w-[190px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {(Object.keys(CLASS_LABEL) as VerificationDispatchClass[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CLASS_LABEL[k]} ({counts[k]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-grow overflow-hidden p-0">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader className="sticky top-0 bg-secondary z-10">
                <TableRow>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Llegada</TableHead>
                  <TableHead>Alistada</TableHead>
                  <TableHead>Camión</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Cant.</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((r, idx) => (
                  <TableRow
                    key={r.codigo + idx}
                    className={cn(
                      r.cls === 'ambas' && 'bg-green-100/50',
                      r.cls === 'solo_cargue' && 'bg-blue-50',
                      r.cls === 'solo_alistamiento' && 'bg-orange-50',
                      r.cls === 'no_encontrada' && 'bg-red-50'
                    )}
                  >
                    <TableCell className="text-base font-black whitespace-nowrap">
                      {r.ubicacion || <span className="text-xs font-normal opacity-40">Sin ubicación</span>}
                    </TableCell>
                    <TableCell className="text-xs font-bold whitespace-nowrap">{arrivalLabel(r.fechaLlegada)}</TableCell>
                    <TableCell>
                      {r.picked ? (
                        <Badge variant="success">SÍ</Badge>
                      ) : r.notFound ? (
                        <Badge variant="destructive">NO ENCONTRADA</Badge>
                      ) : (
                        <Badge variant="outline">{r.loadOnly ? 'FUERA PLAN' : 'NO'}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.loaded ? (
                        <div className="flex flex-col">
                          <Badge className="bg-indigo-600 text-white w-fit">CARGADA</Badge>
                          <span className="opacity-60 mt-0.5">
                            {r.scan ? format(r.scan.at, 'HH:mm') : ''} {r.scan?.byName || ''}
                          </span>
                        </div>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-bold">{r.codigo}</TableCell>
                    <TableCell className="text-xs">{r.destino}</TableCell>
                    <TableCell className="text-center font-medium">{r.cantTft}</TableCell>
                    <TableCell>
                      {r.loaded && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => void handleRemove(r.codigo)}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Quitar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={closeOpen} onOpenChange={(o) => !isClosing && setCloseOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cerrar despacho</DialogTitle>
            <DialogDescription>
              {loadedTotal} caja(s) en el camión pasarán a Enviado a Destino y se creará la relación de entrega
              (placa {session.cargue?.placa}). Se descargará el ZIP real y, si hay TF con código alterno, el Excel para
              cambiarlas en el otro sistema.
            </DialogDescription>
          </DialogHeader>
          {pendingReasonRows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-orange-700">
                {pendingReasonRows.length} caja(s) alistadas no se cargaron. Indique el motivo de cada una:
              </p>
              <ScrollArea className="max-h-72">
                <div className="divide-y">
                  {pendingReasonRows.map((r) => (
                    <div key={r.codigo} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-bold truncate">{r.codigo}</p>
                        <p className="text-muted-foreground">{r.ubicacion || 'sin ubicación'} · {r.cantTft} und</p>
                      </div>
                      <Select value={reasons[r.codigo] || ''} onValueChange={(v) => setReasons((prev) => ({ ...prev, [r.codigo]: v }))}>
                        <SelectTrigger className="w-[220px] h-8 text-xs">
                          <SelectValue placeholder="Motivo..." />
                        </SelectTrigger>
                        <SelectContent>
                          {NOT_LOADED_REASONS.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex gap-2">
                {NOT_LOADED_REASONS.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    onClick={() => setReasons(Object.fromEntries(pendingReasonRows.map((r) => [r.codigo, reasons[r.codigo] || m])))}
                  >
                    Resto: {m}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-green-700">Todo lo alistado está en el camión.</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={isClosing}>Cancelar</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={isClosing || missingReasons > 0}
              onClick={() => void handleCloseDispatch()}
            >
              {isClosing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {missingReasons > 0 ? `Faltan ${missingReasons} motivo(s)` : 'Cerrar y crear relación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VerificationCargue;
