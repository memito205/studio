"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { buildAltCodeStickerPdf, openPdfForPrint } from '@/lib/labelPdf';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, Link2, Loader2, MapPin, Pencil, Printer, RefreshCw, ScanLine, Upload, XCircle } from 'lucide-react';
import { AltCodeBulkLoadDialog } from './AltCodeBulkLoadDialog';import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import {
  correctAltCodeReceipt,
  getAltCodeReceipts,
  getWarehouseLocationConfig,
  linkPendingAltCodeReceipts,
  loadOperatorMappings,
  manualLinkAltCodeReceipt,
  registerAltCodeReceipt,
  relocateAltCodeReceipt,
  voidAltCodeReceipt,
} from '@/app/actions';
import type { AltCodeReceipt, TransferActor, WarehouseLocationConfig } from '@/types';
import { EMPTY_WAREHOUSE_LOCATION_CONFIG, suggestLocationsForDestino, weekdayShortEs } from '@/lib/warehouseLocations';
import { SearchableSelect, type SearchableOption } from './SearchableSelect';
import { cn } from '@/lib/utils';

const PACKER_STORAGE_KEY = 'suite.transfers.receptionPackerId';
const LOCATION_STORAGE_KEY = 'suite.transfers.altCodeLocation';
const DESTINO_STORAGE_KEY = 'suite.transfers.altCodeDestino';
const STALE_HOURS = 24;

const readStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // localStorage no disponible
  }
};

const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;

const formatAge = (iso: string) => {
  const h = hoursSince(iso);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.floor(h)} h`;
  return `${Math.floor(h / 24)} días`;
};

const AltCodeSticker: React.FC<{ receipt: AltCodeReceipt }> = ({ receipt }) => {
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const registeredAt = new Date(receipt.registeredAt);

  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, receipt.codigoAlterno, { format: 'CODE128', displayValue: false, margin: 0, height: 14, width: 1.2 });
    } catch (e) {
      console.error('Error generating barcode', e);
    }
  }, [receipt.codigoAlterno]);

  const linked = receipt.status === 'linked';

  return (
    <div
      id={`alt-code-sticker-${receipt.id}`}
      className="border border-gray-300 rounded-lg bg-white text-black flex overflow-hidden font-sans"
      style={{ width: '10cm', height: '4.8cm' }}
    >
      <div className="bg-black text-white flex flex-col items-center justify-center shrink-0" style={{ width: '2.5cm' }}>
        <span className="text-[30px] font-black leading-none">{weekdayShortEs(registeredAt)}</span>
        <span className="text-[24px] font-black leading-none mt-1">{format(registeredAt, 'dd/MM')}</span>
      </div>
      <div className="flex-1 min-w-0 flex flex-col px-2 py-1">
        <p className="text-[9px] font-bold leading-none truncate">
          {linked ? `CÓDIGO ALTERNO · TF ${receipt.linkedNumeroTF || ''}` : 'CÓDIGO ALTERNO - PENDIENTE TF'}
        </p>
        <div className="text-[24px] font-black leading-none tracking-wide mt-1 truncate">ALT {receipt.codigoAlterno}</div>
        {linked && receipt.linkedDestino && (
          <div className="text-[12px] font-bold leading-none mt-0.5 truncate">DESTINO {receipt.linkedDestino}</div>
        )}
        {receipt.ubicacion && (
          <div className="border-2 border-black rounded-sm px-1.5 py-0.5 mt-1 text-[13px] font-black leading-none truncate">
            UBIC: {receipt.ubicacion}
          </div>
        )}
        <div className="flex flex-col items-center mt-auto">
          <canvas ref={barcodeRef} style={{ maxWidth: '100%', height: 'auto' }} />
          <p className="text-[8px] font-bold leading-none mt-0.5 truncate w-full text-center">
            Registro: {receipt.packerName || receipt.registeredByName || '—'} - {format(registeredAt, 'h:mm a')}
          </p>
        </div>
      </div>
    </div>
  );
};

type ActionMode = 'correct' | 'link' | 'void';

export function AltCodeRegistrationView() {
  const { user, userName, role } = useAuth();
  const { toast } = useToast();
  const canManage = role === 'admin' || role === 'supervisor';
  const actor = useMemo<TransferActor | undefined>(
    () => (user?.uid ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' } : undefined),
    [user, userName]
  );

  const codeInputRef = useRef<HTMLInputElement>(null);
  const [locationConfig, setLocationConfig] = useState<WarehouseLocationConfig>(EMPTY_WAREHOUSE_LOCATION_CONFIG);
  const [packerOptions, setPackerOptions] = useState<SearchableOption[]>([]);
  const [packerId, setPackerId] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [destinoHint, setDestinoHint] = useState('');
  const [code, setCode] = useState('');
  const [autoPrint, setAutoPrint] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ type: 'ok' | 'duplicate'; receipt: AltCodeReceipt } | null>(null);

  const [todayList, setTodayList] = useState<AltCodeReceipt[]>([]);
  const [pendingList, setPendingList] = useState<AltCodeReceipt[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);
  const [isRelinking, setIsRelinking] = useState(false);

  const [stickerToPrint, setStickerToPrint] = useState<AltCodeReceipt | null>(null);
  const [action, setAction] = useState<{ mode: ActionMode; receipt: AltCodeReceipt } | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [actionDestino, setActionDestino] = useState('');
  const [isActing, setIsActing] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const refreshLists = useCallback(async () => {
    setIsLoadingLists(true);
    const res = await getAltCodeReceipts();
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setTodayList(res.today || []);
    setPendingList(res.pending || []);
    setIsLoadingLists(false);
  }, [toast]);

  useEffect(() => {
    getWarehouseLocationConfig().then((res) => res.data && setLocationConfig(res.data));
    loadOperatorMappings().then((res) => {
      if (!res.data) return;
      setPackerOptions(
        Object.entries(res.data)
          .filter(([id, name]) => id && name)
          .map(([id, name]) => ({ value: id, label: String(name).trim().toUpperCase() }))
          .sort((a, b) => a.label.localeCompare(b.label, 'es'))
      );
    });
    setPackerId(readStorage(PACKER_STORAGE_KEY));
    setUbicacion(readStorage(LOCATION_STORAGE_KEY));
    setDestinoHint(readStorage(DESTINO_STORAGE_KEY));
    refreshLists();
    codeInputRef.current?.focus();
  }, [refreshLists]);

  const locationOptions = useMemo(() => locationConfig.codes.map((c) => ({ value: c, label: c })), [locationConfig.codes]);
  const destinoOptions = useMemo(
    () => Object.keys(locationConfig.prefixes).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((d) => ({ value: d, label: d })),
    [locationConfig.prefixes]
  );
  const suggested = useMemo(() => suggestLocationsForDestino(locationConfig, destinoHint), [locationConfig, destinoHint]);

  useEffect(() => {
    if (!stickerToPrint) return;
    const run = async () => {
      try {
        openPdfForPrint(buildAltCodeStickerPdf(stickerToPrint));
      } catch (error) {
        console.error('Error printing sticker', error);
        toast({ variant: 'destructive', title: 'Error de impresión', description: 'No se pudo generar el sticker.' });
      } finally {
        setStickerToPrint(null);
      }
    };
    run();
  }, [stickerToPrint, toast]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || isSubmitting) return;
    const packer = packerOptions.find((p) => p.value === packerId);
    if (packerOptions.length > 0 && !packer) {
      toast({ variant: 'destructive', title: 'Falta el empacador', description: 'Seleccione quién registra.' });
      return;
    }
    if (locationOptions.length > 0 && !ubicacion) {
      toast({ variant: 'destructive', title: 'Falta la ubicación', description: 'Seleccione dónde queda la caja.' });
      return;
    }
    setIsSubmitting(true);
    const res = await registerAltCodeReceipt(
      { codigoAlterno: trimmed, ubicacion, destinoHint, packer: packer ? { id: packer.value, name: packer.label } : undefined },
      actor
    );
    setIsSubmitting(false);
    if (res.duplicate) {
      setLastResult({ type: 'duplicate', receipt: res.duplicate });
      toast({ variant: 'destructive', title: 'Código ya registrado', description: `${res.duplicate.codigoAlterno} está en ${res.duplicate.ubicacion || 'sin ubicación'}.` });
    } else if (!res.success || !res.receipt) {
      toast({ variant: 'destructive', title: 'No se registró', description: res.error });
      return;
    } else {
      const saved = res.receipt;
      setLastResult({ type: 'ok', receipt: saved });
      if (saved.registroTardio) {
        toast({
          title: 'Registro tardío',
          description: `La TF ${saved.linkedNumeroTF || ''} ya existía: la llegada a bodega quedó con la fecha del documento TF.`,
        });
      }
      if (autoPrint) setStickerToPrint(saved);
      setTodayList((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
      if (saved.status === 'pending') setPendingList((prev) => [...prev.filter((r) => r.id !== saved.id), saved]);
    }
    setCode('');
    codeInputRef.current?.focus();
  };

  const handleRelocateDuplicate = async (receipt: AltCodeReceipt) => {
    const res = await relocateAltCodeReceipt(receipt.id, ubicacion);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se reubicó', description: res.error });
      return;
    }
    const updated = { ...receipt, ubicacion };
    setLastResult({ type: 'ok', receipt: updated });
    toast({ title: 'Reubicado', description: `${receipt.codigoAlterno} → ${ubicacion}` });
    if (autoPrint) setStickerToPrint(updated);
    const patch = (list: AltCodeReceipt[]) => list.map((r) => (r.id === updated.id ? updated : r));
    setTodayList(patch);
    setPendingList(patch);
  };

  const handleRelink = async () => {
    setIsRelinking(true);
    const res = await linkPendingAltCodeReceipts();
    setIsRelinking(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    toast({ title: 'Enlace ejecutado', description: `${res.linked} enlazadas · ${res.pending} siguen pendientes.` });
    refreshLists();
  };

  const openAction = (mode: ActionMode, receipt: AltCodeReceipt) => {
    setAction({ mode, receipt });
    setActionValue(mode === 'correct' ? receipt.codigoAlterno : '');
    setActionDestino('');
  };

  const handleAction = async () => {
    if (!action) return;
    setIsActing(true);
    let res: { success: boolean; error?: string; linked?: boolean };
    if (action.mode === 'correct') res = await correctAltCodeReceipt(action.receipt.id, actionValue);
    else if (action.mode === 'link') res = await manualLinkAltCodeReceipt(action.receipt.id, actionValue, actionDestino);
    else res = await voidAltCodeReceipt(action.receipt.id, actionValue, actor);
    setIsActing(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se pudo completar', description: res.error });
      return;
    }
    const messages: Record<ActionMode, string> = {
      correct: res.linked ? 'Código corregido y enlazado con su TF.' : 'Código corregido; sigue pendiente de TF.',
      link: 'Registro enlazado con la TF.',
      void: 'Registro anulado.',
    };
    toast({ title: 'Listo', description: messages[action.mode] });
    setAction(null);
    refreshLists();
  };

  const visiblePending = onlyStale ? pendingList.filter((r) => hoursSince(r.registeredAt) >= STALE_HOURS) : pendingList;
  const staleCount = pendingList.filter((r) => hoursSince(r.registeredAt) >= STALE_HOURS).length;
  const todayLinked = todayList.filter((r) => r.status === 'linked').length;
  const todayPending = todayList.filter((r) => r.status === 'pending').length;

  const statusBadge = (r: AltCodeReceipt) =>
    r.status === 'linked' ? (
      <Badge variant="success" className="whitespace-nowrap">Enlazada TF {r.linkedNumeroTF}</Badge>
    ) : r.status === 'void' ? (
      <Badge variant="outline">Anulada</Badge>
    ) : (
      <Badge variant="warning" className="whitespace-nowrap">Pendiente TF</Badge>
    );

  return (
    <div className="space-y-6">
      {role === 'admin' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3">
          <p className="text-xs text-muted-foreground">
            ¿Arrancando? Cargue el inventario de cajas de código alterno que ya están en bodega para enlazarlas con su TF.
          </p>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Carga inicial (Excel)
          </Button>
          <AltCodeBulkLoadDialog open={bulkOpen} onOpenChange={setBulkOpen} actor={actor} onApplied={refreshLists} />
        </div>
      )}
      {(role === 'admin' || role === 'supervisor' || role === 'operator') && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-blue-300 bg-blue-50/50 p-3">
          <p className="text-xs text-muted-foreground">
            ¿Llegaron muchas cajas (p. ej. operador externo)? Registre el listado en Excel: código alterno, ubicación y quién registra. Queda igual que el registro manual.
          </p>
          <Button size="sm" variant="outline" onClick={() => setListOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Registrar listado (Excel)
          </Button>
          <AltCodeBulkLoadDialog mode="listado" open={listOpen} onOpenChange={setListOpen} actor={actor} onApplied={refreshLists} />
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_1fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Registrar caja de código alterno</CardTitle>
            <CardDescription>Registre la caja al ubicarla. Si la TF aún no existe, queda pendiente y se enlaza sola al actualizar transferencias.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Quién registra (empacador)</Label>
                <SearchableSelect
                  value={packerId}
                  onChange={(v) => { setPackerId(v); writeStorage(PACKER_STORAGE_KEY, v); }}
                  options={packerOptions}
                  placeholder={packerOptions.length ? 'Escriba su nombre...' : 'Sin Maestro de Empacadores'}
                  searchPlaceholder="Buscar empacador..."
                  emptyText="No está en el Maestro de Empacadores."
                  disabled={packerOptions.length === 0}
                />
                <p className="text-[10px] text-muted-foreground">Se recuerda hasta que lo cambie.</p>
              </div>
              {destinoOptions.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Destino (opcional, para sugerir ubicación)</Label>
                  <SearchableSelect
                    value={destinoHint}
                    onChange={(v) => { setDestinoHint(v); writeStorage(DESTINO_STORAGE_KEY, v); }}
                    options={destinoOptions}
                    placeholder="Sin destino"
                    searchPlaceholder="Buscar destino..."
                    allowClear
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Ubicación</Label>
                <SearchableSelect
                  value={ubicacion}
                  onChange={(v) => { setUbicacion(v); writeStorage(LOCATION_STORAGE_KEY, v); }}
                  options={locationOptions}
                  suggestedValues={suggested}
                  suggestedLabel={destinoHint ? `Sugeridas ${destinoHint}` : 'Sugeridas'}
                  placeholder={locationOptions.length ? 'Seleccionar ubicación...' : 'Sin maestro de ubicaciones'}
                  searchPlaceholder="Buscar ubicación..."
                  disabled={locationOptions.length === 0}
                  allowClear
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Código alterno</Label>
                <Input
                  ref={codeInputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Escanee o digite el código..."
                  className="h-12 text-lg font-bold"
                  autoComplete="off"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={autoPrint} onCheckedChange={(c) => setAutoPrint(!!c)} /> Imprimir sticker al registrar
              </label>
              <Button type="submit" className="w-full h-11" disabled={isSubmitting || !code.trim()}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                Registrar{autoPrint ? ' e imprimir sticker' : ''}
              </Button>
            </form>

            {lastResult && (
              <div
                className={cn(
                  'mt-4 rounded-md border-l-4 p-3 text-sm',
                  lastResult.type === 'ok' ? 'border-green-600 bg-green-50 text-green-900' : 'border-amber-600 bg-amber-50 text-amber-950'
                )}
              >
                {lastResult.type === 'ok' ? (
                  <p className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    {lastResult.receipt.codigoAlterno} ·{' '}
                    {lastResult.receipt.status === 'linked'
                      ? `ENLAZADA TF ${lastResult.receipt.linkedNumeroTF}${lastResult.receipt.linkNote ? ` (${lastResult.receipt.linkNote})` : ''}`
                      : 'PENDIENTE TF'}{' '}
                    · {lastResult.receipt.ubicacion || 'sin ubicación'}
                  </p>
                ) : (
                  <>
                    <p className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4" /> Ya registrado: {lastResult.receipt.codigoAlterno}
                    </p>
                    <p className="mt-1 text-xs">
                      {format(new Date(lastResult.receipt.registeredAt), 'dd/MM HH:mm')} · {lastResult.receipt.ubicacion || 'sin ubicación'} ·{' '}
                      {lastResult.receipt.packerName || lastResult.receipt.registeredByName || '—'} ·{' '}
                      {lastResult.receipt.status === 'linked' ? `TF ${lastResult.receipt.linkedNumeroTF}` : 'Pendiente TF'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ubicacion && ubicacion !== lastResult.receipt.ubicacion && (
                        <Button size="sm" variant="outline" onClick={() => handleRelocateDuplicate(lastResult.receipt)}>
                          <MapPin className="mr-1 h-3.5 w-3.5" /> Reubicar a {ubicacion}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setStickerToPrint(lastResult.receipt)}>
                        <Printer className="mr-1 h-3.5 w-3.5" /> Reimprimir sticker
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Registros de hoy</CardTitle>
              <CardDescription>
                {todayList.length} registros · <span className="text-green-700 font-semibold">{todayLinked} enlazadas</span> ·{' '}
                <span className="text-amber-700 font-semibold">{todayPending} pendientes</span>
              </CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={refreshLists} disabled={isLoadingLists}>
              <RefreshCw className={cn('h-4 w-4', isLoadingLists && 'animate-spin')} />
            </Button>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Código alterno</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Registró</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {todayList.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Sin registros hoy.</TableCell></TableRow>
                  ) : todayList.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{format(new Date(r.registeredAt), 'HH:mm')}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{r.codigoAlterno}</TableCell>
                      <TableCell className="text-xs">{r.ubicacion || '—'}</TableCell>
                      <TableCell className="text-xs">{r.packerName || r.registeredByName || '—'}</TableCell>
                      <TableCell>{statusBadge(r)}</TableCell>
                      <TableCell>
                        {r.status !== 'void' && (
                          <Button size="icon" variant="ghost" title="Reimprimir sticker" onClick={() => setStickerToPrint(r)}>
                            <Printer className="h-4 w-4" />
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
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Pendientes sin TF ({pendingList.length})</CardTitle>
            <CardDescription>
              Cajas en bodega cuyo código aún no aparece en transferencias.{' '}
              {staleCount > 0 && <span className="font-semibold text-red-600">{staleCount} con más de {STALE_HOURS} h.</span>}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={onlyStale} onCheckedChange={(c) => setOnlyStale(!!c)} /> Solo más de {STALE_HOURS} h
            </label>
            <Button size="sm" variant="outline" onClick={handleRelink} disabled={isRelinking}>
              {isRelinking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />} Reintentar enlace
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registrado</TableHead>
                  <TableHead>Antigüedad</TableHead>
                  <TableHead>Código alterno</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Destino (indicado)</TableHead>
                  <TableHead>Registró</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePending.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">Sin pendientes.</TableCell></TableRow>
                ) : visiblePending.map((r) => {
                  const stale = hoursSince(r.registeredAt) >= STALE_HOURS;
                  return (
                    <TableRow key={r.id} className={cn(stale && 'bg-red-50 dark:bg-red-950/20')}>
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.registeredAt), 'dd/MM HH:mm')}</TableCell>
                      <TableCell className={cn('text-xs font-semibold', stale && 'text-red-600')}>{formatAge(r.registeredAt)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{r.codigoAlterno}</TableCell>
                      <TableCell className="text-xs">{r.ubicacion || '—'}</TableCell>
                      <TableCell className="text-xs">{r.destinoHint || '—'}</TableCell>
                      <TableCell className="text-xs">{r.packerName || r.registeredByName || '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" title="Reimprimir sticker" onClick={() => setStickerToPrint(r)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                        {canManage && (
                          <>
                            <Button size="icon" variant="ghost" title="Corregir código" onClick={() => openAction('correct', r)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" title="Enlazar con TF" onClick={() => openAction('link', r)}>
                              <Link2 className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" title="Anular" onClick={() => openAction('void', r)}>
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action?.mode === 'correct' ? 'Corregir código alterno' : action?.mode === 'link' ? 'Enlazar con TF' : 'Anular registro'}
            </DialogTitle>
            <DialogDescription>
              Registro {action?.receipt.codigoAlterno} · {action?.receipt.ubicacion || 'sin ubicación'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                {action?.mode === 'correct' ? 'Código correcto' : action?.mode === 'link' ? 'Número de TF' : 'Motivo'}
              </Label>
              <Input value={actionValue} onChange={(e) => setActionValue(e.target.value)} autoFocus />
            </div>
            {action?.mode === 'link' && (
              <div className="space-y-1">
                <Label className="text-xs">Destino (solo si la TF tiene varios)</Label>
                <Input value={actionDestino} onChange={(e) => setActionDestino(e.target.value.toUpperCase())} placeholder="Ej. B8" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAction(null)}>Cancelar</Button>
            <Button
              onClick={handleAction}
              disabled={isActing || !actionValue.trim()}
              variant={action?.mode === 'void' ? 'destructive' : 'default'}
            >
              {isActing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        {stickerToPrint && <AltCodeSticker receipt={stickerToPrint} />}
      </div>
    </div>
  );
}
