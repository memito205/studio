
"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Upload, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  ScanLine, 
  Trash2,
  PackageCheck,
  XCircle,
  FileDown,
  Save,
  Loader2,
  PlayCircle,
  ArrowLeft,
  AlertTriangle,
  FileArchive
} from 'lucide-react';
import type { VerificationItem, SavedVerification } from '@/types';
import { parseVerificationExcel, exportVerificationToExcel } from '@/components/dispatch-manager/utils/excel';
import { cn } from '@/components/dispatch-manager/utils/cn';
import {
  buildTfVerificationIndex,
  getOtherSessionsForTf,
  normalizeTfKey,
} from '@/components/dispatch-manager/utils/duplicateVerifications';
import { saveVerificationSession, loadVerificationSessions, updateVerificationSession, lookupTransferForVerification } from '@/app/actions';
import { normalizeDestination } from '@/components/dispatch-manager/utils/excel';
import { weekdayShortEs } from '@/lib/warehouseLocations';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/use-auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  downloadStoreSummaryPdfs,
  verificationItemsToSummaryRows,
} from '@/components/dispatch-manager/utils/storeSummaryPdf';


const SaveVerificationDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (name: string) => Promise<void>;
    isLoading: boolean;
}> = ({ isOpen, onOpenChange, onSave, isLoading }) => {
    const [name, setName] = useState('');
    
    const handleSaveClick = async () => {
        if (name.trim()) {
            await onSave(name.trim());
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Guardar Sesión de Verificación</DialogTitle>
                    <DialogDescription>
                        Asigne un nombre descriptivo a esta verificación para guardarla en el historial.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="session-name">Nombre de la Sesión</Label>
                    <Input
                        id="session-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Verificación Despacho 28/07"
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSaveClick} disabled={isLoading || !name.trim()}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const upperKey = (value: unknown) => String(value ?? '').trim().toUpperCase();
const altKey = (value: unknown) => upperKey(value).replace(/\s+/g, '');

type ItemMatch = { index: number } | { ambiguous: string[] } | null;

/** Busca una lectura por código de rótulo, número de TF solo o código alterno. */
const findItemForCode = (items: VerificationItem[], code: string): ItemMatch => {
  const exact = items.findIndex((item) => upperKey(item.codigo) === code);
  if (exact !== -1) return { index: exact };

  const byTf = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => upperKey(item.tftCruce) === code || upperKey(item.tfOriginal) === code);
  if (byTf.length > 0) {
    const pending = byTf.filter(({ item }) => !item.scanned);
    const pool = pending.length > 0 ? pending : byTf;
    const destinos = Array.from(new Set(pool.map(({ item }) => item.destino)));
    if (destinos.length > 1) return { ambiguous: destinos };
    return { index: pool[0].index };
  }

  const alt = altKey(code);
  const byAlt = items.findIndex((item) => item.codigoAlterno && altKey(item.codigoAlterno) === alt);
  return byAlt !== -1 ? { index: byAlt } : null;
};

const arrivalLabel = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${weekdayShortEs(d)} ${format(d, 'dd/MM')}`;
};

const ScanningInterface: React.FC<{
  session: SavedVerification;
  allSessions: SavedVerification[];
  onBack: () => void;
}> = ({ session, allSessions, onBack }) => {
  const [data, setData] = useState<VerificationItem[]>(session.results);
  const [scanInput, setScanInput] = useState('');
  const [lastScanStatus, setLastScanStatus] = useState<{
    type: 'success' | 'error' | 'duplicate' | 'multi-session' | 'out-of-plan';
    message: string;
    code: string;
    detail?: string;
  } | null>(null);
  const [outOfPlanReads, setOutOfPlanReads] = useState<VerificationItem[]>(session.outOfPlanReads || []);
  const [allowOutOfPlan, setAllowOutOfPlan] = useState(false);
  const [sortMode, setSortMode] = useState<'plan' | 'ubicacion'>('ubicacion');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const sessionDestinos = useMemo(() => new Set(session.results.map((item) => item.destino)), [session.results]);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isClosingDispatch, setIsClosingDispatch] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('saved');
  const debounceTimer = useRef<NodeJS.Timeout>();

  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { role } = useAuth();
  const canCloseDispatch = role === 'admin' || role === 'supervisor';
  const isSessionOpen = session.status !== 'completed';
  
  const [filters, setFilters] = useState({ codigo: '', destino: '', tft: '', status: 'all' });

  const tfIndex = useMemo(() => buildTfVerificationIndex(allSessions), [allSessions]);

  const sessionDuplicateCount = useMemo(() => {
    let count = 0;
    const seen = new Set<string>();
    data.forEach((item) => {
      const key = normalizeTfKey(item.tftCruce) || normalizeTfKey(item.tfOriginal);
      if (!key || seen.has(key)) return;
      seen.add(key);
      if (getOtherSessionsForTf(tfIndex, key, session.id).length > 0) count += 1;
    });
    return count;
  }, [data, tfIndex, session.id]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const stats = useMemo(() => {
    const total = data.length;
    const scanned = data.filter(item => item.scanned).length;
    const pending = total - scanned;
    return { total, scanned, pending, isComplete: total > 0 && pending === 0 };
  }, [data]);
  const notFoundCount = useMemo(() => data.filter((item) => !item.scanned && item.notFound).length, [data]);
  const outOfPlanAdded = useMemo(() => data.filter((item) => item.outOfPlan).length, [data]);
  
  const saveProgress = useCallback(async (isFinalizing: boolean) => {
    setIsSaving(true);
    setSaveStatus('saving');
    
    const newStatus = isFinalizing ? 'completed' : session.status === 'pending' ? 'in-progress' : session.status;
    
    const result = await updateVerificationSession(session.id, {
        results: data,
        stats,
        status: newStatus,
        outOfPlanReads,
    });

    if (result.success) {
        if (isFinalizing) {
            toast({ title: "Verificación Finalizada", description: `La sesión ha sido completada.` });
            onBack();
        } else {
            setSaveStatus('saved');
        }
    } else {
        setSaveStatus('error');
        toast({ variant: 'destructive', title: "Error al Guardar", description: result.error });
    }
    setIsSaving(false);
  }, [data, outOfPlanReads, onBack, session.id, session.status, stats, toast]);

  useEffect(() => {
    if (saveStatus === 'idle') {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        saveProgress(false);
      }, 3000);
    }
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [data, saveStatus, saveProgress]);

  const registerOutOfPlan = (candidate: VerificationItem, code: string, reason: string) => {
    const item: VerificationItem = { ...candidate, scanned: true, scanTime: new Date(), outOfPlan: true, notFound: false };
    if (allowOutOfPlan) {
      setData((prev) => [...prev, item]);
      setLastScanStatus({ type: 'out-of-plan', message: 'AGREGADA FUERA DEL PLAN', code, detail: reason });
    } else {
      setOutOfPlanReads((prev) => [...prev, item]);
      setLastScanStatus({
        type: 'out-of-plan',
        message: 'FUERA DEL PLAN — quedó en la lista para agregar al final',
        code,
        detail: reason,
      });
    }
    setSaveStatus('idle');
  };

  const handleCodeNotInPlan = async (code: string) => {
    if (findItemForCode(outOfPlanReads, code)) {
      setLastScanStatus({ type: 'duplicate', message: 'YA ESTÁ EN LECTURAS FUERA DEL PLAN', code });
      return;
    }
    const excluded = session.excludedResults || [];
    const excludedMatch = findItemForCode(excluded, code);
    if (excludedMatch && 'index' in excludedMatch) {
      registerOutOfPlan(excluded[excludedMatch.index], code, 'Estaba excluida por el límite del destino.');
      return;
    }

    setIsLookingUp(true);
    const res = await lookupTransferForVerification(code);
    setIsLookingUp(false);
    if (res.error) {
      setLastScanStatus({ type: 'error', message: 'ERROR CONSULTANDO LA TF', code, detail: res.error });
      return;
    }
    if (res.pendingAlt) {
      setLastScanStatus({
        type: 'error',
        message: 'CÓDIGO ALTERNO SIN TF — NO SE PUEDE DESPACHAR',
        code,
        detail: `Déjela en su ubicación (${res.pendingAlt.ubicacion || 'sin ubicación'}) hasta que aparezca la TF.`,
      });
      return;
    }
    if (res.groups.length === 0) {
      setLastScanStatus({ type: 'error', message: '¡CÓDIGO NO ENCONTRADO!', code });
      return;
    }
    const received = res.groups.filter((g) => g.statuses.includes('Recibido en Bodega'));
    if (received.length === 0) {
      const states = Array.from(new Set(res.groups.flatMap((g) => g.statuses))).join(', ');
      setLastScanStatus({ type: 'error', message: 'TF NO ESTÁ EN RECIBIDO EN BODEGA', code, detail: `Estado actual: ${states}.` });
      return;
    }
    const inSessionDest = received.filter((g) => sessionDestinos.has(normalizeDestination(g.bodegaDestino)));
    if (inSessionDest.length === 0) {
      setLastScanStatus({
        type: 'error',
        message: 'DESTINO FUERA DE ESTA VALIDACIÓN',
        code,
        detail: `La TF va para ${received.map((g) => normalizeDestination(g.bodegaDestino)).join(', ')}.`,
      });
      return;
    }
    if (inSessionDest.length > 1) {
      setLastScanStatus({
        type: 'error',
        message: 'TF EN VARIOS DESTINOS — LEA EL RÓTULO DESTINO-TF',
        code,
        detail: inSessionDest.map((g) => normalizeDestination(g.bodegaDestino)).join(', '),
      });
      return;
    }
    const g = inSessionDest[0];
    const destino = normalizeDestination(g.bodegaDestino);
    const codigo = `${g.bodegaDestino.trim()}-${g.numeroTF}`.toUpperCase().replace(/'/g, '-');
    if (findItemForCode(outOfPlanReads, codigo) || findItemForCode(data, codigo)) {
      setLastScanStatus({ type: 'duplicate', message: '¡CÓDIGO YA ESCANEADO!', code });
      return;
    }
    registerOutOfPlan(
      {
        codigo,
        tftCruce: g.numeroTF,
        fechaTft: g.fecha ? format(new Date(g.fecha), 'dd/MM/yyyy') : '-',
        cantTft: String(g.cantidad || ''),
        destino,
        empacador: '',
        contenidoOriginal: g.numeroTF,
        tfOriginal: g.numeroTF,
        scanned: true,
        ...(g.marca ? { marca: g.marca } : {}),
        ...(g.ubicacion ? { ubicacion: g.ubicacion } : {}),
        ...(g.fechaLlegada ? { fechaLlegada: g.fechaLlegada } : {}),
        ...(g.codigoAlterno ? { codigoAlterno: g.codigoAlterno } : {}),
      },
      code,
      'No estaba en el cruce de esta validación.'
    );
  };

  const addOutOfPlanToList = (items: VerificationItem[]) => {
    if (items.length === 0) return;
    const keys = new Set(items.map((i) => i.codigo));
    setData((prev) => [...prev, ...items.map((i) => ({ ...i, scanned: true, outOfPlan: true }))]);
    setOutOfPlanReads((prev) => prev.filter((i) => !keys.has(i.codigo)));
    setSaveStatus('idle');
  };

  const discardOutOfPlan = (codigo: string) => {
    setOutOfPlanReads((prev) => prev.filter((i) => i.codigo !== codigo));
    setSaveStatus('idle');
  };

  const toggleNotFound = (codigo: string) => {
    setData((prev) =>
      prev.map((item) =>
        item.codigo === codigo && !item.scanned
          ? { ...item, notFound: !item.notFound, ...(item.notFound ? {} : { notFoundAt: new Date() }) }
          : item
      )
    );
    setSaveStatus('idle');
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanInput.trim().toUpperCase().replace(/['\/]/g, '-');
    if (!code || isLookingUp) return;
    setScanInput('');

    const match = findItemForCode(data, code);
    const index = match && 'index' in match ? match.index : -1;

    if (match && 'ambiguous' in match) {
      setLastScanStatus({
        type: 'error',
        message: 'TF EN VARIOS DESTINOS — LEA EL RÓTULO DESTINO-TF',
        code,
        detail: match.ambiguous.join(', '),
      });
    } else if (index === -1) {
      await handleCodeNotInPlan(code);
    } else if (data[index].scanned) {
      setLastScanStatus({ type: 'duplicate', message: '¡CÓDIGO YA ESCANEADO!', code });
      toast({
        title: "Código Duplicado",
        description: `La etiqueta "${code}" ya fue escaneada anteriormente.`,
        variant: 'default',
      });
    } else {
      const item = data[index];
      const tfKey = normalizeTfKey(item.tftCruce) || normalizeTfKey(item.tfOriginal);
      const otherHits = tfKey ? getOtherSessionsForTf(tfIndex, tfKey, session.id) : [];

      const newData = [...data];
      newData[index] = { ...newData[index], scanned: true, scanTime: new Date(), notFound: false };
      setData(newData);

      if (otherHits.length > 0) {
        const otherNames = otherHits.map((h) => h.sessionName).join(', ');
        setLastScanStatus({
          type: 'multi-session',
          message: '¡ALERTA: TF EN OTRA VALIDACIÓN!',
          code,
          detail: `TF ${tfKey} también está en: ${otherNames}. Posible no despacho en la primera oportunidad.`,
        });
        toast({
          title: 'TF en múltiples validaciones',
          description: `TF ${tfKey} aparece también en: ${otherNames}`,
          variant: 'destructive',
        });
      } else {
        setLastScanStatus({ type: 'success', message: '¡CÓDIGO VALIDADO!', code });
      }
      setSaveStatus('idle'); // Trigger auto-save
    }
    setScanInput('');
  };
  
  const summaryByDestination = useMemo(() => {
    const summary: Record<string, { total: number; scanned: number; pending: number }> = {};
    data.forEach(item => {
        const dest = item.destino || 'N/A';
        if (!summary[dest]) {
            summary[dest] = { total: 0, scanned: 0, pending: 0 };
        }
        summary[dest].total++;
        if (item.scanned) {
            summary[dest].scanned++;
        } else {
            summary[dest].pending++;
        }
    });
    return Object.entries(summary).map(([destino, stats]) => ({ destino, ...stats })).sort((a,b) => b.total - a.total);
  }, [data]);
  
   const filteredData = useMemo(() => {
    const rows = data.filter(item => {
        const statusMatch =
          filters.status === 'all' ||
          (filters.status === 'scanned' && item.scanned) ||
          (filters.status === 'pending' && !item.scanned) ||
          (filters.status === 'notfound' && !item.scanned && !!item.notFound) ||
          (filters.status === 'outofplan' && !!item.outOfPlan);
        const codigoMatch = !filters.codigo || item.codigo.toLowerCase().includes(filters.codigo.toLowerCase()) || (item.ubicacion || '').toLowerCase().includes(filters.codigo.toLowerCase());
        const destinoMatch = !filters.destino || item.destino.toLowerCase().includes(filters.destino.toLowerCase());
        const tftMatch = !filters.tft || (item.tftCruce && item.tftCruce.toLowerCase().includes(filters.tft.toLowerCase()));
        return statusMatch && codigoMatch && destinoMatch && tftMatch;
    });
    if (sortMode === 'ubicacion') {
      return [...rows].sort((a, b) => {
        const ua = a.ubicacion || '\uffff';
        const ub = b.ubicacion || '\uffff';
        const byUbic = ua.localeCompare(ub, 'es', { numeric: true });
        if (byUbic !== 0) return byUbic;
        return (a.fechaLlegada || '').localeCompare(b.fechaLlegada || '');
      });
    }
    return rows;
  }, [data, filters, sortMode]);

  const handleFinalize = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    saveProgress(true);
  };

  const handleCloseDispatch = async () => {
    if (!canCloseDispatch || !isSessionOpen) return;
    if (stats.scanned === 0) {
      toast({
        variant: 'destructive',
        title: 'Sin unidades leídas',
        description: 'Debe haber al menos una etiqueta escaneada para cerrar y generar el ZIP real.',
      });
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setIsClosingDispatch(true);
    setIsSaving(true);
    setSaveStatus('saving');

    const scannedItems = data.filter((item) => item.scanned);
    const result = await updateVerificationSession(session.id, {
      results: data,
      stats,
      status: 'completed',
      outOfPlanReads,
    });

    if (!result.success) {
      setSaveStatus('error');
      setIsSaving(false);
      setIsClosingDispatch(false);
      toast({ variant: 'destructive', title: 'Error al cerrar', description: result.error });
      return;
    }

    const pdfResult = await downloadStoreSummaryPdfs(
      verificationItemsToSummaryRows(scannedItems),
      { sessionName: session.name, variant: 'actual' }
    );

    setIsSaving(false);
    setIsClosingDispatch(false);

    if (pdfResult.success) {
      toast({
        title: 'Despacho cerrado',
        description:
          pdfResult.storeCount === 1
            ? `Sesión completada. ZIP real / cerrado: ${pdfResult.fileName}.`
            : `Sesión completada. ZIP real / cerrado con ${pdfResult.storeCount} PDF(s): ${pdfResult.fileName}.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Despacho cerrado, ZIP falló',
        description: pdfResult.error || 'La sesión se cerró pero no se pudo generar el ZIP real.',
      });
    }
    onBack();
  };

  
  const renderSaveStatus = () => {
    switch (saveStatus) {
        case 'saving':
            return <span className="flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin"/> Guardando...</span>;
        case 'saved':
            return <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3"/> Progreso guardado</span>;
        case 'error':
            return <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3"/> Error al guardar</span>;
        case 'idle':
            return <span className="flex items-center gap-1 text-orange-500">Cambios sin guardar...</span>
        default:
            return null;
    }
  };

  return (
     <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-6">
            <Button onClick={onBack} variant="outline" className="justify-start">
                <ArrowLeft className="mr-2 h-4 w-4"/> Volver a la Lista de Sesiones
            </Button>
          <Card>
            <CardHeader>
                <CardTitle>Escáner de Códigos</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleScan}>
                <Input ref={inputRef} type="text" value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="Rótulo, # TF o código alterno..." className="w-full  text-xl focus:outline-none" autoComplete="off" />
                </form>
                {isLookingUp && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Consultando TF fuera del plan...
                  </p>
                )}
                <label className="mt-3 flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox checked={allowOutOfPlan} onCheckedChange={(c) => setAllowOutOfPlan(!!c)} className="mt-0.5" />
                  <span>
                    <span className="font-semibold">Agregar fuera del plan</span>
                    <span className="block text-muted-foreground">
                      Activo: las TF fuera del plan se agregan de una vez. Inactivo: quedan en una lista para agregarlas al final.
                    </span>
                  </span>
                </label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
                <CardTitle>Progreso: {session.name}</CardTitle>
                {session.originalStats && (
                  <div className="text-[10px] text-muted-foreground mt-1 bg-muted/50 p-2 border border-border">
                    <span className="font-bold">PLANIFICACIÓN:</span> {session.filteredStats?.totalTFs} / {session.originalStats?.totalTFs} TFs seleccionadas 
                    ({session.filteredStats?.totalUnits} / {session.originalStats?.totalUnits} unidades)
                  </div>
                )}
                 <div className="text-xs text-muted-foreground  mt-2 h-4">{renderSaveStatus()}</div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-sm font-medium text-muted-foreground">Total</span><p className="text-2xl font-bold">{stats.total}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Escaneados</span><p className="text-2xl font-bold text-green-600">{stats.scanned}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Pendientes</span><p className="text-2xl font-bold text-orange-600">{stats.pending}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Completado</span><p className="text-2xl font-bold">{stats.total > 0 ? Math.round((stats.scanned / stats.total) * 100) : 0}%</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">No encontradas</span><p className="text-2xl font-bold text-red-600">{notFoundCount}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Fuera del plan</span><p className="text-2xl font-bold text-blue-700">{outOfPlanAdded}{outOfPlanReads.length > 0 ? ` (+${outOfPlanReads.length})` : ''}</p></div>
                </div>
                <div className="flex flex-col gap-2 mt-6">
                    {canCloseDispatch && isSessionOpen ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            disabled={isSaving || isClosingDispatch || stats.scanned === 0}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            {(isSaving || isClosingDispatch)
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                              : <FileArchive size={14} className="mr-2"/>}
                            Cerrar despacho
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Cerrar despacho?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Se marcará la sesión como completada y se descargará el ZIP real / cerrado
                              solo con las unidades realmente escaneadas ({stats.scanned} de {stats.total})
                              {stats.pending > 0
                                ? `. Quedarán ${stats.pending} unidad(es) pendientes fuera del ZIP (no encontradas / no leídas).`
                                : '.'}{' '}
                              {outOfPlanReads.length > 0 && (
                                <strong className="text-blue-700">
                                  Hay {outOfPlanReads.length} lectura(s) fuera del plan sin agregar: no saldrán en el ZIP.{' '}
                                </strong>
                              )}
                              El ZIP planificado (cruce completo) no se modifica; puede volver a descargarlo desde el historial.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-amber-600 hover:bg-amber-700"
                              onClick={() => void handleCloseDispatch()}
                            >
                              Cerrar y descargar ZIP real
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <Button onClick={handleFinalize} disabled={isSaving || !isSessionOpen}>
                          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PackageCheck size={14} className="mr-2"/>} Finalizar Verificación
                      </Button>
                    )}
                    {canCloseDispatch && isSessionOpen && (
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        Genera el <strong>ZIP real / cerrado</strong> con lo pistoleado. El ZIP planificado es el del cruce al guardar la sesión.
                      </p>
                    )}
                </div>
            </CardContent>
          </Card>
           {sessionDuplicateCount > 0 && (
                <div className="p-4 border-l-4 rounded-md bg-amber-50 border-amber-600 text-amber-900">
                    <p className="font-bold text-sm uppercase flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      {sessionDuplicateCount} TF(s) de esta sesión también están en otras validaciones
                    </p>
                    <p className="text-xs mt-1 opacity-80">
                      Revise el menú &quot;TF repetidas&quot; del Gestor de Despachos para el detalle.
                    </p>
                </div>
            )}
           {lastScanStatus && (
                <div className={cn(
                  "p-4 border-l-4 rounded-md",
                  lastScanStatus.type === 'success' && "bg-green-50 border-green-600 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300",
                  lastScanStatus.type === 'error' && "bg-red-50 border-red-600 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300",
                  lastScanStatus.type === 'duplicate' && "bg-orange-50 border-orange-600 text-orange-800 dark:bg-orange-900/20 dark:border-orange-700 dark:text-orange-300",
                  lastScanStatus.type === 'multi-session' && "bg-amber-50 border-amber-700 text-amber-950",
                  lastScanStatus.type === 'out-of-plan' && "bg-blue-50 border-blue-700 text-blue-950"
                )}>
                    <p className="font-bold text-sm uppercase">{lastScanStatus.message}</p>
                    <p className=" text-xs mt-1 opacity-70">Código: {lastScanStatus.code}</p>
                    {lastScanStatus.detail && (
                      <p className="text-xs mt-2 font-medium">{lastScanStatus.detail}</p>
                    )}
                </div>
            )}
            {outOfPlanReads.length > 0 && (
              <Card className="border-blue-300">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Leídas fuera del plan ({outOfPlanReads.length})</CardTitle>
                  <CardDescription>Revise y agréguelas a la validación cuando termine el recorrido.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button size="sm" className="w-full" onClick={() => addOutOfPlanToList(outOfPlanReads)} disabled={!isSessionOpen}>
                    Agregar todas ({outOfPlanReads.length})
                  </Button>
                  <ScrollArea className="max-h-56">
                    <div className="divide-y">
                      {outOfPlanReads.map((item) => (
                        <div key={item.codigo} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold truncate">{item.codigo}</p>
                            <p className="text-muted-foreground truncate">
                              {item.destino} · {item.ubicacion || 'sin ubicación'} · {item.cantTft} und
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => addOutOfPlanToList([item])} disabled={!isSessionOpen}>
                              Agregar
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => discardOutOfPlan(item.codigo)}>
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
            <Card>
                <CardHeader>
                    <CardTitle>Resumen por Destino</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-48">
                        <Table>
                            <TableHeader><TableRow><TableHead>Destino</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Leídos</TableHead><TableHead className="text-right">Faltan</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {summaryByDestination.map(dest => (
                                    <TableRow key={dest.destino}>
                                        <TableCell>{dest.destino}</TableCell>
                                        <TableCell className="text-right">{dest.total}</TableCell>
                                        <TableCell className="text-right text-green-600">{dest.scanned}</TableCell>
                                        <TableCell className="text-right text-orange-600">{dest.pending}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
        <Card className="lg:col-span-2 flex flex-col h-[calc(100vh-14rem)]">
          <CardHeader>
            <CardTitle>Lista de Verificación</CardTitle>
            <CardDescription className="flex justify-between items-center">
                <span>{stats.scanned} / {stats.total} LISTOS</span>
                <div className="flex gap-2">
                    <Select value={sortMode} onValueChange={(val) => setSortMode(val as 'plan' | 'ubicacion')}>
                        <SelectTrigger className="w-[150px] h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ubicacion">Orden: Ubicación</SelectItem>
                            <SelectItem value="plan">Orden: Plan</SelectItem>
                        </SelectContent>
                    </Select>
                    <Input 
                        placeholder="Código o ubicación..." 
                        value={filters.codigo} 
                        onChange={(e) => setFilters(prev => ({...prev, codigo: e.target.value}))}
                        className="max-w-[150px] h-8 text-xs"
                    />
                    <Input 
                        placeholder="Filtrar por Destino..." 
                        value={filters.destino} 
                        onChange={(e) => setFilters(prev => ({...prev, destino: e.target.value}))}
                        className="max-w-[150px] h-8 text-xs"
                    />
                    <Select value={filters.status} onValueChange={(val) => setFilters(prev => ({...prev, status: val}))}>
                        <SelectTrigger className="w-[150px] h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los Estados</SelectItem>
                            <SelectItem value="pending">Pendiente</SelectItem>
                            <SelectItem value="scanned">Escaneado</SelectItem>
                            <SelectItem value="notfound">No encontrada</SelectItem>
                            <SelectItem value="outofplan">Fuera del plan</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow overflow-hidden p-0">
            <ScrollArea className="h-full">
            <Table>
                <TableHeader className="sticky top-0 bg-secondary z-10"><TableRow><TableHead>Ubicación</TableHead><TableHead>Llegada</TableHead><TableHead>Estado</TableHead><TableHead>Código</TableHead><TableHead>Destino</TableHead><TableHead>TFT</TableHead><TableHead>Cant.</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                    {filteredData.map((item, idx) => {
                    const tfKey = normalizeTfKey(item.tftCruce) || normalizeTfKey(item.tfOriginal);
                    const multiSession = tfKey
                      ? getOtherSessionsForTf(tfIndex, tfKey, session.id).length > 0
                      : false;
                    return (
                    <TableRow
                      key={item.codigo + idx}
                      className={cn(
                        item.scanned && "bg-green-100/50 dark:bg-green-900/20",
                        multiSession && "bg-amber-50 dark:bg-amber-950/30",
                        !item.scanned && item.notFound && "bg-red-50 dark:bg-red-950/20"
                      )}
                    >
                        <TableCell className="text-base font-black whitespace-nowrap">{item.ubicacion || <span className="text-xs font-normal opacity-40">Sin ubicación</span>}</TableCell>
                        <TableCell className="text-xs font-bold whitespace-nowrap">{arrivalLabel(item.fechaLlegada)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            {item.scanned ? (
                              <Badge variant="success">LISTO</Badge>
                            ) : item.notFound ? (
                              <Badge variant="destructive">NO ENCONTRADA</Badge>
                            ) : (
                              <Badge variant="outline">PENDIENTE</Badge>
                            )}
                            {item.outOfPlan && (
                              <Badge className="bg-blue-600 text-white text-[9px]">Fuera del plan</Badge>
                            )}
                            {multiSession && (
                              <Badge variant="destructive" className="text-[9px]">
                                Multi-validación
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className=" text-xs font-bold">{item.codigo}</TableCell>
                        <TableCell className="text-xs">{item.destino}</TableCell>
                        <TableCell className=" text-xs opacity-60">{item.tftCruce}</TableCell>
                        <TableCell className="text-center font-medium">{item.cantTft}</TableCell>
                        <TableCell>
                          {!item.scanned && isSessionOpen && (
                            <Button
                              size="sm"
                              variant={item.notFound ? 'secondary' : 'ghost'}
                              className="h-7 px-2 text-[10px]"
                              onClick={() => toggleNotFound(item.codigo)}
                            >
                              {item.notFound ? 'Deshacer' : 'No encontrada'}
                            </Button>
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
    </div>
  );
};

const SupervisorView: React.FC<{
    sessions: SavedVerification[];
    onSelectSession: (session: SavedVerification) => void;
}> = ({ sessions, onSelectSession }) => {
    const pendingSessions = sessions.filter(s => s.status !== 'completed');
    return (
        <Card>
            <CardHeader>
                <CardTitle>Sesiones de Verificación Pendientes</CardTitle>
                <CardDescription>Seleccione una sesión para iniciar o continuar con el pistoleo.</CardDescription>
            </CardHeader>
            <CardContent>
                {pendingSessions.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No hay verificaciones pendientes.</p>
                ) : (
                    <Table>
                        <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Fecha Creación</TableHead><TableHead>Estado</TableHead><TableHead>Progreso</TableHead><TableHead></TableHead></TableRow></TableHeader>
                        <TableBody>
                            {pendingSessions.map(session => (
                                <TableRow key={session.id}>
                                    <TableCell>{session.name}</TableCell>
                                    <TableCell>{format(new Date(session.createdAt), 'dd/MM/yyyy')}</TableCell>
                                    <TableCell><Badge variant={session.status === 'in-progress' ? 'default' : 'secondary'}>{session.status}</Badge></TableCell>
                                    <TableCell>{session.stats.scanned} / {session.stats.total}</TableCell>
                                    <TableCell><Button onClick={() => onSelectSession(session)}><PlayCircle className="mr-2 h-4 w-4"/> Iniciar/Continuar</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
};

const AdminView: React.FC<{
    sessions: SavedVerification[];
    fetchSessions: () => void;
}> = ({ sessions, fetchSessions }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isUploading, setIsUploading] = useState(false);
    const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
    const [parsedDataForSave, setParsedDataForSave] = useState<VerificationItem[] | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const items = await parseVerificationExcel(file);
            const normalizedItems = items.map(item => ({ ...item, codigo: item.codigo.replace(/'/g, '-') }));
            setParsedDataForSave(normalizedItems);
            setIsSaveDialogOpen(true);
        } catch (error) {
            console.error('Error parsing verification excel:', error);
            toast({ variant: 'destructive', title: 'Error al procesar el archivo' });
        } finally {
            setIsUploading(false);
        }
    };

    const handleSaveVerification = async (name: string) => {
        if (!user || !parsedDataForSave) return;
        setIsSaving(true);
        const stats = {
            total: parsedDataForSave.length,
            scanned: 0,
            pending: parsedDataForSave.length,
        };
        const sessionData: Omit<SavedVerification, 'id'> = {
            name,
            createdAt: new Date(),
            savedById: user.uid,
            savedBy: user.displayName || user.email || 'Desconocido',
            results: parsedDataForSave,
            unmatchedResults: [], // Admin creates from a list, so no unmatched
            stats: stats,
            status: 'pending',
        };
        const result = await saveVerificationSession(sessionData);
        if (result.success) {
            toast({ title: 'Éxito', description: 'Sesión de verificación creada.' });
            fetchSessions();
            setIsSaveDialogOpen(false);
            setParsedDataForSave(null);
        } else {
            toast({ variant: 'destructive', title: 'Error al guardar', description: result.error });
        }
        setIsSaving(false);
    };

    return (
        <>
            <SaveVerificationDialog 
                isOpen={isSaveDialogOpen}
                onOpenChange={setIsSaveDialogOpen}
                onSave={handleSaveVerification}
                isLoading={isSaving}
            />
            <div className="p-12 border-2 border-dashed border-border rounded-2xl bg-card text-center">
                <h2 className="text-xl font-bold mb-2">Cargar Nueva Lista de Verificación</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">Suba un archivo Excel para crear una nueva sesión de verificación pendiente para los supervisores.</p>
                <label className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground cursor-pointer text-sm font-semibold rounded-md">
                    <Upload size={18} /> SELECCIONAR EXCEL
                    <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleUpload} disabled={isUploading} />
                </label>
            </div>
        </>
    );
};


export default function VerificationModule() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const isSupervisor = role === 'supervisor';
  
  const [sessions, setSessions] = useState<SavedVerification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<SavedVerification | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await loadVerificationSessions();
    if (error) alert(`Error al cargar sesiones: ${error}`);
    else setSessions(data || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);
  
  if (isLoading) {
    return <div className="p-8 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto"/></div>;
  }

  if (activeSession) {
    return (
      <ScanningInterface
        session={activeSession}
        allSessions={sessions}
        onBack={() => {
          setActiveSession(null);
          fetchSessions();
        }}
      />
    );
  }
  
  if (isAdmin) {
    return (
      <div className="space-y-8">
        <AdminView sessions={sessions} fetchSessions={fetchSessions} />
        <SupervisorView sessions={sessions} onSelectSession={setActiveSession} />
      </div>
    );
  }

  if (isSupervisor) {
    return <SupervisorView sessions={sessions} onSelectSession={setActiveSession} />;
  }

  return <p className="text-center opacity-50 p-8">Módulo de Verificación no disponible para su rol.</p>;
}

    