'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Coffee,
  LayoutDashboard,
  Loader2,
  PauseCircle,
  PlayCircle,
  ScanLine,
  Users,
  FileDown,
  Utensils,
  Moon,
  MoreHorizontal,
  Radio,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import type {
  TalladoPause,
  TalladoPauseType,
  TalladoShift,
  TalladoTransferLookup,
  TalladoUnit,
} from '@/types';
import {
  listTalladoDashboard,
  listTalladoLiveMonitor,
  cleanupTalladoDuplicates,
  listTalladoShiftBundle,
  resumeTalladoPause,
  scanTalladoCode,
  startTalladoPause,
  startTalladoShift,
  startTalladoUnit,
  updateTalladoShiftPeople,
  importTalladoCatalog,
  getTalladoCatalogStats,
  clearTalladoCatalog,
} from '@/app/talladoMercanciaActions';
import {
  downloadTalladoDayConsolidatedPdf,
  downloadTalladoHourlyPdf,
  downloadTalladoReportPdf,
  localHourFromIso,
} from '@/lib/talladoMercanciaPdf';
import { downloadTalladoCatalogTemplate, parseTalladoCatalogSheet } from '@/lib/talladoCatalog';
import { TalladoCameraScanner } from '@/components/tallado-mercancia/TalladoCameraScanner';

interface TalladoMercanciaModuleProps {
  onReturnToSuite: () => void;
}

const PAUSE_LABELS: Record<TalladoPauseType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  fin_jornada: 'Fin jornada',
  otros: 'Otros',
};

function fmtDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

function fmtClock(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

function fmtElapsedSince(iso?: string) {
  if (!iso) return '—';
  const start = new Date(iso).getTime();
  if (!Number.isFinite(start)) return '—';
  return fmtDuration(Date.now() - start);
}

/** Misma normalización visual que el servidor: ' y , → - */
function displayScanCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\u2018\u2019\u201A\uFF07`´′ʼ']/g, '-')
    .replace(/[,;]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function TalladoMercanciaModule({ onReturnToSuite }: TalladoMercanciaModuleProps) {
  const { toast } = useToast();
  const { user, role } = useAuth() as { user: any; role?: string };
  const canAdmin = role === 'admin' || role === 'supervisor';
  const scanRef = useRef<HTMLInputElement>(null);

  const [mainTab, setMainTab] = useState<'operario' | 'admin' | 'vivo'>(canAdmin ? 'operario' : 'operario');
  const [grupo, setGrupo] = useState('Grupo 1');
  const [peopleCount, setPeopleCount] = useState(1);
  const [shift, setShift] = useState<TalladoShift | null>(null);
  const [units, setUnits] = useState<TalladoUnit[]>([]);
  const [pauses, setPauses] = useState<TalladoPause[]>([]);
  const [startingShift, setStartingShift] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pendingLookup, setPendingLookup] = useState<TalladoTransferLookup | null>(null);
  const [busyUnit, setBusyUnit] = useState(false);
  const [otrosNote, setOtrosNote] = useState('');
  const [showOtros, setShowOtros] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const [dashLoading, setDashLoading] = useState(false);
  const [dashShifts, setDashShifts] = useState<TalladoShift[]>([]);
  const [dashUnits, setDashUnits] = useState<TalladoUnit[]>([]);
  const [dashPauses, setDashPauses] = useState<TalladoPause[]>([]);
  const [reportHour, setReportHour] = useState(() => String(new Date().getHours()));
  const [dashReportHour, setDashReportHour] = useState(() => String(new Date().getHours()));

  const [liveLoading, setLiveLoading] = useState(false);
  const [liveShifts, setLiveShifts] = useState<TalladoShift[]>([]);
  const [liveActiveUnits, setLiveActiveUnits] = useState<TalladoUnit[]>([]);
  const [liveTodayUnits, setLiveTodayUnits] = useState<TalladoUnit[]>([]);
  const [liveOpenPauses, setLiveOpenPauses] = useState<TalladoPause[]>([]);
  const [liveFilter, setLiveFilter] = useState<'activos' | 'todos'>('activos');
  const [liveTick, setLiveTick] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [catalogQty, setCatalogQty] = useState(0);
  const [catalogLastAt, setCatalogLastAt] = useState<string | undefined>();
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogReplaceAll, setCatalogReplaceAll] = useState(false);
  const catalogFileRef = useRef<HTMLInputElement>(null);
  const [scanFlash, setScanFlash] = useState<{
    code: string;
    label: string;
    variant: 'ok' | 'fin' | 'error';
  } | null>(null);
  const scanFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPause = useMemo(() => pauses.find((p) => p.status === 'open') || null, [pauses]);
  const inProgress = useMemo(() => units.filter((u) => u.status === 'in_progress'), [units]);
  const doneUnits = useMemo(() => units.filter((u) => u.status === 'done'), [units]);
  const hourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` })),
    []
  );

  const focusScanInput = useCallback(
    (delayMs = 50) => {
      if (openPause) return;
      window.setTimeout(() => {
        const el = scanRef.current;
        if (!el || el.disabled) return;
        el.focus({ preventScroll: true });
        try {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        } catch {
          /* ignore */
        }
      }, delayMs);
    },
    [openPause]
  );

  const showScanFlash = useCallback(
    (code: string, label: string, variant: 'ok' | 'fin' | 'error' = 'ok') => {
      if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current);
      setScanFlash({ code: displayScanCode(code) || code, label, variant });
      focusScanInput(30);
      scanFlashTimerRef.current = setTimeout(() => {
        setScanFlash(null);
        scanFlashTimerRef.current = null;
        focusScanInput(30);
      }, 2000);
    },
    [focusScanInput]
  );

  useEffect(() => {
    return () => {
      if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current);
    };
  }, []);

  const loadCatalogStats = useCallback(async () => {
    const res = await getTalladoCatalogStats();
    if (!res.success) return;
    setCatalogCount(res.count || 0);
    setCatalogQty(res.totalQty || 0);
    setCatalogLastAt(res.lastUploadedAt);
  }, []);

  useEffect(() => {
    void loadCatalogStats();
  }, [loadCatalogStats]);

  const handleCatalogFile = async (file: File | null) => {
    if (!file || !user?.uid) return;
    setCatalogImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const parsed = parseTalladoCatalogSheet(wb);
      if (parsed.rows.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Catálogo',
          description: parsed.errors[0] || 'Sin filas válidas. Use columnas: Codigo Barras, Referencia, Talla, Cantidad.',
        });
        return;
      }
      const res = await importTalladoCatalog({
        rows: parsed.rows,
        userId: user.uid,
        userName: user.displayName || user.email || 'Admin',
        replaceAll: catalogReplaceAll,
      });
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Importación', description: res.error });
        return;
      }
      toast({
        title: 'Catálogo cargado',
        description: `Códigos: ${res.upserted || 0}${res.deleted ? ` · borrados previos: ${res.deleted}` : ''}${
          parsed.skipped ? ` · filas omitidas: ${parsed.skipped}` : ''
        }. Al escanear: destino MERCANCIA SIN REMISIONAR.`,
      });
      await loadCatalogStats();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Archivo', description: e?.message || 'No se pudo leer el Excel.' });
    } finally {
      setCatalogImporting(false);
      if (catalogFileRef.current) catalogFileRef.current.value = '';
    }
  };

  const handleClearCatalog = async () => {
    if (!canAdmin) return;
    setCatalogImporting(true);
    const res = await clearTalladoCatalog();
    setCatalogImporting(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Vaciar', description: res.error });
      return;
    }
    toast({ title: 'Catálogo vacío', description: `Eliminados: ${res.deleted || 0}` });
    await loadCatalogStats();
  };

  const refreshShift = useCallback(async (shiftId: string) => {
    const res = await listTalladoShiftBundle(shiftId);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    if (res.shift) setShift(res.shift);
    setUnits(res.units || []);
    setPauses(res.pauses || []);
  }, [toast]);

  useEffect(() => {
    if (shift?.id) void refreshShift(shift.id);
  }, [shift?.id, refreshShift]);

  useEffect(() => {
    if (shift && !openPause) focusScanInput(100);
  }, [shift, openPause, pendingLookup, scanning, focusScanInput]);

  const handleStartShift = async () => {
    if (!user?.uid) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Debe iniciar sesión.' });
      return;
    }
    setStartingShift(true);
    const res = await startTalladoShift({
      grupo: grupo.trim(),
      peopleCount,
      userId: user.uid,
      userName: user.displayName || user.email || 'Operario',
    });
    setStartingShift(false);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'No se inició el turno', description: res.error });
      return;
    }
    setShift(res.data);
    setUnits([]);
    setPauses([]);
    setPendingLookup(null);
    if (res.rejoined) {
      toast({
        title: 'Turno ya activo',
        description: `Se reanudó el turno existente de ${res.data.grupo} (no se creó otro).`,
      });
      await refreshShift(res.data.id);
    } else {
      toast({ title: 'Turno iniciado', description: `${res.data.grupo} · ${res.data.peopleCount} persona(s)` });
    }
  };

  const processScanCode = useCallback(
    async (raw: string) => {
      if (!shift?.id || !user?.uid) return;
      if (openPause) {
        toast({ variant: 'destructive', title: 'En pausa', description: 'Reanude la pausa antes de escanear.' });
        return;
      }
      const code = String(raw || '').trim();
      if (!code) return;

      showScanFlash(code, 'Código leído…', 'ok');
      setScanning(true);
      try {
        const res = await scanTalladoCode({
          shiftId: shift.id,
          rawCode: code,
          userId: user.uid,
          userName: user.displayName || user.email || 'Operario',
          grupo: shift.grupo,
          autoStart: false,
        });
        setScanCode('');
        if (!res.success) {
          showScanFlash(code, res.error || 'No se pudo leer', 'error');
          toast({ variant: 'destructive', title: 'Escaneo', description: res.error });
          setPendingLookup(null);
          return;
        }
        if (res.action === 'finished') {
          const finCode = res.unit?.scanCode || code;
          showScanFlash(finCode, 'FIN registrado', 'fin');
          setPendingLookup(null);
          toast({
            title: 'Fin registrado',
            description: `${finCode} · neto ${fmtDuration(res.unit?.durationNetMs)}`,
          });
          await refreshShift(shift.id);
          return;
        }
        if (res.lookup) {
          showScanFlash(res.lookup.scanCode || code, 'Listo — confirme Inicio', 'ok');
          setPendingLookup(res.lookup);
          toast({ title: 'TF encontrada', description: 'Confirme Inicio para registrar el comienzo.' });
        }
      } finally {
        setScanning(false);
        setScanCode('');
        focusScanInput(50);
        focusScanInput(200);
        focusScanInput(600);
      }
    },
    [shift, user, openPause, toast, refreshShift, showScanFlash, focusScanInput]
  );

  const handleScanSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await processScanCode(scanCode);
  };

  const handleCameraDetected = useCallback(
    (code: string) => {
      void processScanCode(code);
    },
    [processScanCode]
  );

  const handleConfirmStart = async () => {
    if (!shift?.id || !pendingLookup || !user?.uid) return;
    setBusyUnit(true);
    const res = await startTalladoUnit({
      shiftId: shift.id,
      lookup: pendingLookup,
      userId: user.uid,
      userName: user.displayName || user.email || 'Operario',
      grupo: shift.grupo,
    });
    setBusyUnit(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Inicio', description: res.error });
      return;
    }
    setPendingLookup(null);
    showScanFlash(res.data?.scanCode || pendingLookup.scanCode, 'INICIO registrado', 'ok');
    toast({ title: 'Inicio', description: `${res.data?.scanCode} · cant. ${res.data?.cantidad}` });
    await refreshShift(shift.id);
    focusScanInput(80);
    focusScanInput(300);
  };

  const handleStartPause = async (type: TalladoPauseType) => {
    if (!shift?.id || !user?.uid) return;
    if (type === 'otros' && !otrosNote.trim()) {
      setShowOtros(true);
      toast({ variant: 'destructive', title: 'Motivo', description: 'Digite el motivo de la pausa Otros.' });
      return;
    }
    setPauseBusy(true);
    const res = await startTalladoPause({
      shiftId: shift.id,
      grupo: shift.grupo,
      type,
      note: type === 'otros' ? otrosNote.trim() : undefined,
      userId: user.uid,
      userName: user.displayName || user.email || 'Operario',
    });
    setPauseBusy(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Pausa', description: res.error });
      return;
    }
    setShowOtros(false);
    setOtrosNote('');
    setPendingLookup(null);
    toast({ title: 'Pausa iniciada', description: PAUSE_LABELS[type] });
    await refreshShift(shift.id);
  };

  const handleResumePause = async () => {
    if (!shift?.id) return;
    setPauseBusy(true);
    const res = await resumeTalladoPause(shift.id);
    setPauseBusy(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Reanudar', description: res.error });
      return;
    }
    toast({ title: 'Pausa cerrada', description: fmtDuration(res.data?.durationMs) });
    await refreshShift(shift.id);
  };

  const handleUpdatePeople = async () => {
    if (!shift?.id) return;
    const res = await updateTalladoShiftPeople(shift.id, peopleCount);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Personas', description: res.error });
      return;
    }
    setShift((s) => (s ? { ...s, peopleCount } : s));
    toast({ title: 'Personas actualizadas', description: String(peopleCount) });
  };

  const handlePdfTurno = () => {
    if (!shift) return;
    downloadTalladoReportPdf({ shift, units, pauses });
  };

  const handlePdfHoraTurno = () => {
    if (!shift) return;
    downloadTalladoHourlyPdf({
      hour: Number(reportHour),
      shift,
      units,
      pauses,
      scopeLabel: `Turno ${shift.grupo}`,
      dayLabel: new Date().toLocaleDateString('es-CO'),
    });
  };

  const handlePdfDiaConsolidado = async () => {
    let shifts = dashShifts;
    let dayUnits = dashUnits;
    let dayPauses = dashPauses;
    if (!shifts.length) {
      const res = await listTalladoDashboard();
      if (res.success) {
        shifts = res.shifts || [];
        dayUnits = res.units || [];
        dayPauses = res.pauses || [];
        setDashShifts(shifts);
        setDashUnits(dayUnits);
        setDashPauses(dayPauses);
      }
    }
    if (!shifts.length && shift) {
      shifts = [shift];
      dayUnits = units;
      dayPauses = pauses;
    }
    downloadTalladoDayConsolidatedPdf({
      shifts,
      units: dayUnits,
      pauses: dayPauses,
      dayLabel: new Date().toLocaleDateString('es-CO'),
    });
  };

  const handlePdfHoraDashboard = () => {
    downloadTalladoHourlyPdf({
      hour: Number(dashReportHour),
      units: dashUnits,
      pauses: dashPauses,
      scopeLabel: 'Consolidado del día',
      dayLabel: new Date().toLocaleDateString('es-CO'),
    });
  };

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    const res = await listTalladoDashboard();
    setDashLoading(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Dashboard', description: res.error });
      return;
    }
    setDashShifts(res.shifts || []);
    setDashUnits(res.units || []);
    setDashPauses(res.pauses || []);
  }, [toast]);

  const loadLiveMonitor = useCallback(async (withCleanup = false) => {
    setLiveLoading(true);
    const res = await listTalladoLiveMonitor({ cleanup: withCleanup });
    setLiveLoading(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'En vivo', description: res.error });
      return;
    }
    setLiveShifts(res.shifts || []);
    setLiveActiveUnits(res.activeUnits || []);
    setLiveTodayUnits(res.todayUnits || []);
    setLiveOpenPauses(res.openPauses || []);
    if (res.cleanup && (res.cleanup.deletedUnits > 0 || res.cleanup.closedShifts > 0)) {
      toast({
        title: 'Duplicados limpiados',
        description: `Unidades borradas: ${res.cleanup.deletedUnits}. Turnos cerrados: ${res.cleanup.closedShifts}. Se dejó la hora más antigua.`,
      });
    }
  }, [toast]);

  const handleCleanupDuplicates = async () => {
    setLiveLoading(true);
    const res = await cleanupTalladoDuplicates();
    if (!res.success) {
      setLiveLoading(false);
      toast({ variant: 'destructive', title: 'Limpieza', description: res.error });
      return;
    }
    toast({
      title: 'Limpieza hecha',
      description: `Unidades borradas: ${res.deletedUnits || 0}. Turnos cerrados: ${res.closedShifts || 0}. Reasignadas: ${res.reassignedUnits || 0}.`,
    });
    await loadLiveMonitor(false);
  };

  useEffect(() => {
    if (mainTab === 'admin' && canAdmin) void loadDashboard();
  }, [mainTab, canAdmin, loadDashboard]);

  useEffect(() => {
    if (mainTab === 'vivo' && canAdmin) void loadLiveMonitor(true);
  }, [mainTab, canAdmin, loadLiveMonitor]);

  // Auto-refresh del monitor en vivo cada 20s + tick para tiempos transcurridos
  useEffect(() => {
    if (mainTab !== 'vivo' || !canAdmin) return;
    const refreshId = setInterval(() => void loadLiveMonitor(false), 20000);
    const tickId = setInterval(() => setLiveTick((n) => n + 1), 1000);
    return () => {
      clearInterval(refreshId);
      clearInterval(tickId);
    };
  }, [mainTab, canAdmin, loadLiveMonitor]);

  const liveShiftById = useMemo(() => {
    const m = new Map<string, TalladoShift>();
    for (const s of liveShifts) m.set(s.id, s);
    return m;
  }, [liveShifts]);

  const livePausedShiftIds = useMemo(
    () => new Set(liveOpenPauses.map((p) => p.shiftId)),
    [liveOpenPauses]
  );

  const liveRows = useMemo(() => {
    const list = liveFilter === 'activos' ? liveActiveUnits : liveTodayUnits;
    return list;
  }, [liveFilter, liveActiveUnits, liveTodayUnits]);

  // liveTick fuerza re-render de duraciones en curso
  void liveTick;

  const dashStats = useMemo(() => {
    const done = dashUnits.filter((u) => u.status === 'done');
    const qty = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
    const netMs = done.reduce((s, u) => s + (Number(u.durationNetMs ?? u.durationMs) || 0), 0);
    const pauseMs = dashPauses.reduce((s, p) => s + (Number(p.durationMs) || 0), 0);
    const people = dashShifts.reduce((s, sh) => s + (Number(sh.peopleCount) || 0), 0) || 1;
    const netHours = netMs / 3600000;
    const perPersonHour = netHours > 0 ? qty / (netHours * people) : 0;

    const byHour = new Map<string, { qty: number; units: number; pauseMin: number }>();
    for (const u of done) {
      const hn = localHourFromIso(u.endedAt || u.startedAt);
      const h = hn == null ? '??' : String(hn).padStart(2, '0');
      const prev = byHour.get(h) || { qty: 0, units: 0, pauseMin: 0 };
      prev.qty += Number(u.cantidad) || 0;
      prev.units += 1;
      byHour.set(h, prev);
    }
    for (const p of dashPauses) {
      const hn = localHourFromIso(p.pausedAt);
      const h = hn == null ? '??' : String(hn).padStart(2, '0');
      const prev = byHour.get(h) || { qty: 0, units: 0, pauseMin: 0 };
      prev.pauseMin += Math.round((Number(p.durationMs) || 0) / 60000);
      byHour.set(h, prev);
    }

    const byMarca = new Map<string, number>();
    for (const u of done) {
      const m = u.marca || 'Sin marca';
      byMarca.set(m, (byMarca.get(m) || 0) + (Number(u.cantidad) || 0));
    }

    return {
      qty,
      doneCount: done.length,
      netMs,
      pauseMs,
      perPersonHour,
      hourRows: Array.from(byHour.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([hour, v]) => ({ hour, ...v })),
      marcaRows: Array.from(byMarca.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([marca, cant]) => ({ marca, cant })),
    };
  }, [dashUnits, dashPauses, dashShifts]);

  return (
    <div className="space-y-4 p-3 sm:p-5 relative">
      {scanFlash ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 animate-in fade-in-0 duration-150 pointer-events-none"
          role="status"
          aria-live="assertive"
        >
          <div
            className={`pointer-events-auto w-full max-w-xl rounded-2xl border-2 px-6 py-8 text-center shadow-2xl ${
              scanFlash.variant === 'error'
                ? 'border-red-500 bg-red-950 text-white'
                : scanFlash.variant === 'fin'
                  ? 'border-emerald-400 bg-emerald-950 text-white'
                  : 'border-sky-400 bg-slate-950 text-white'
            }`}
            onClick={() => {
              if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current);
              setScanFlash(null);
              focusScanInput(30);
            }}
          >
            <div className="flex justify-center mb-3">
              {scanFlash.variant === 'error' ? (
                <XCircle className="h-12 w-12 text-red-300" />
              ) : (
                <CheckCircle2
                  className={`h-12 w-12 ${scanFlash.variant === 'fin' ? 'text-emerald-300' : 'text-sky-300'}`}
                />
              )}
            </div>
            <p className="text-sm uppercase tracking-widest text-white/70 mb-2">{scanFlash.label}</p>
            <p className="font-mono text-4xl sm:text-5xl font-bold tracking-wide break-all leading-tight">
              {scanFlash.code}
            </p>
            <p className="mt-4 text-xs text-white/50">Se cierra en ~2 s · toque para cerrar</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onReturnToSuite} aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ScanLine className="h-6 w-6 text-sky-700" />
              Tallado de mercancía
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Escanee Número TF / Código Alterno (transferencias) o Código de barras de caja (catálogo Excel). Destino
              del catálogo: <strong>MERCANCIA SIN REMISIONAR</strong>.
            </p>
          </div>
        </div>
      </div>

      <Card className="border-violet-600/25">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-violet-700" />
            Catálogo de cajas (sin remisión / sin TF)
          </CardTitle>
          <CardDescription>
            Suba Excel con <strong>Codigo Barras</strong>, <strong>Referencia</strong>, <strong>Talla</strong> y{' '}
            <strong>Cantidad</strong>. Al leer el código, si no está en transferencias se busca aquí. Destino fijo:{' '}
            MERCANCIA SIN REMISIONAR.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{catalogCount} código(s)</Badge>
            <Badge variant="outline" className="tabular-nums">
              {catalogQty.toLocaleString()} pares/uds
            </Badge>
            {catalogLastAt ? (
              <span className="text-xs text-muted-foreground">
                Última carga: {new Date(catalogLastAt).toLocaleString('es-CO')}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Sin catálogo cargado aún</span>
            )}
          </div>
          {canAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => downloadTalladoCatalogTemplate()}>
                <FileDown className="mr-1.5 h-4 w-4" />
                Plantilla
              </Button>
              <input
                ref={catalogFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => void handleCatalogFile(e.target.files?.[0] || null)}
              />
              <Button
                type="button"
                size="sm"
                disabled={catalogImporting}
                onClick={() => catalogFileRef.current?.click()}
              >
                {catalogImporting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Subir Excel
              </Button>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="catalogReplace"
                  checked={catalogReplaceAll}
                  onCheckedChange={(v) => setCatalogReplaceAll(v === true)}
                />
                <Label htmlFor="catalogReplace" className="text-xs font-normal cursor-pointer">
                  Reemplazar todo al subir
                </Label>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={catalogImporting || catalogCount === 0}
                onClick={() => void handleClearCatalog()}
              >
                Vaciar catálogo
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Solo admin/supervisor cargan el Excel. Usted puede escanear códigos ya cargados.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'operario' | 'admin' | 'vivo')}>
        <TabsList>
          <TabsTrigger value="operario">
            <PlayCircle className="mr-1.5 h-4 w-4" />
            Operario
          </TabsTrigger>
          {canAdmin ? (
            <TabsTrigger value="vivo">
              <Radio className="mr-1.5 h-4 w-4" />
              En vivo
            </TabsTrigger>
          ) : null}
          {canAdmin ? (
            <TabsTrigger value="admin">
              <LayoutDashboard className="mr-1.5 h-4 w-4" />
              Dashboard
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="operario" className="space-y-4 mt-4">
          {!shift ? (
            <Card className="max-w-lg border-sky-600/30">
              <CardHeader>
                <CardTitle className="text-base">Ingreso al turno</CardTitle>
                <CardDescription>Indique el grupo y cuántas personas están laborando.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="grupo">Grupo</Label>
                  <Input
                    id="grupo"
                    value={grupo}
                    onChange={(e) => setGrupo(e.target.value)}
                    placeholder="Grupo 1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="people">Personas laborando</Label>
                  <Input
                    id="people"
                    type="number"
                    min={1}
                    className="tabular-nums"
                    value={peopleCount}
                    onChange={(e) => setPeopleCount(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <Button type="button" onClick={() => void handleStartShift()} disabled={startingShift}>
                  {startingShift ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                  Entrar
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{shift.grupo}</Badge>
                <Badge variant="outline" className="tabular-nums">
                  {shift.peopleCount} persona(s)
                </Badge>
                {openPause ? (
                  <Badge variant="destructive">
                    En pausa: {PAUSE_LABELS[openPause.type]}
                    {openPause.note ? ` · ${openPause.note}` : ''}
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-800">Activo</Badge>
                )}
                <Badge variant="outline">{inProgress.length} en proceso</Badge>
                <Badge variant="outline">{doneUnits.length} cerradas</Badge>
              </div>

              <Card className="border-sky-600/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Reportes PDF</CardTitle>
                  <CardDescription>
                    Turno actual, franja horaria específica o consolidado del día (usa datos del dashboard si ya se
                    cargaron).
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={handlePdfTurno}>
                    <FileDown className="mr-1.5 h-4 w-4" />
                    PDF turno
                  </Button>
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Hora</Label>
                      <Select value={reportHour} onValueChange={setReportHour}>
                        <SelectTrigger className="w-[100px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {hourOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={handlePdfHoraTurno}>
                      <FileDown className="mr-1.5 h-4 w-4" />
                      PDF por hora
                    </Button>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void handlePdfDiaConsolidado()}>
                    <FileDown className="mr-1.5 h-4 w-4" />
                    PDF día consolidado
                  </Button>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Escanear código</CardTitle>
                      <CardDescription>
                        Número TF o Código Alterno. Primera vez = preparar Inicio; segunda = Fin automático.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <form onSubmit={(e) => void handleScanSubmit(e)} className="flex gap-2">
                        <Input
                          ref={scanRef}
                          value={scanCode}
                          onChange={(e) => setScanCode(e.target.value)}
                          placeholder="Escanee o digite aquí…"
                          className="font-mono text-lg h-12"
                          disabled={!!openPause}
                          readOnly={scanning}
                          autoComplete="off"
                          inputMode="text"
                          autoFocus
                          onBlur={(e) => {
                            const next = e.relatedTarget as HTMLElement | null;
                            if (next && (next.closest('button') || next.closest('[role="button"]') || next.closest('textarea') || next.closest('input'))) {
                              return;
                            }
                            // Tras error/lectura, recuperar foco para el lector de barras
                            if (shift && !openPause && !scanning) focusScanInput(150);
                          }}
                        />
                        <Button type="submit" disabled={!!openPause || scanning || !scanCode.trim()}>
                          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : 'OK'}
                        </Button>
                      </form>

                      <TalladoCameraScanner
                        disabled={!!openPause || scanning}
                        onDetected={handleCameraDetected}
                      />

                      {pendingLookup ? (
                        <div className="rounded-md border border-sky-600/30 bg-sky-50/50 dark:bg-sky-950/20 p-3 space-y-2">
                          <div className="font-semibold flex flex-wrap items-center gap-2">
                            {pendingLookup.matchedBy === 'catalogo'
                              ? 'Catálogo (caja)'
                              : pendingLookup.matchedBy === 'codigoAlterno'
                                ? 'Código alterno'
                                : 'Número TF'}
                            : {pendingLookup.scanCode}
                            {pendingLookup.source === 'catalogo' ? (
                              <Badge className="bg-violet-500/15 text-violet-900">Sin remisión</Badge>
                            ) : (
                              <Badge variant="secondary">Transferencias</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">
                                {pendingLookup.source === 'catalogo' ? 'Referencia' : 'TF'}
                              </span>
                              <div className="font-semibold">
                                {pendingLookup.source === 'catalogo'
                                  ? pendingLookup.referencia || pendingLookup.numeroTF
                                  : pendingLookup.numeroTF}
                              </div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Destino</span>
                              <div className="font-semibold">{pendingLookup.bodegaDestino}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                {pendingLookup.source === 'catalogo' ? 'Talla' : 'Marca'}
                              </span>
                              <div className="font-semibold">
                                {pendingLookup.source === 'catalogo'
                                  ? pendingLookup.talla || '—'
                                  : pendingLookup.marca || '—'}
                              </div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Cantidad</span>
                              <div className="font-semibold tabular-nums text-lg">{pendingLookup.cantidad}</div>
                            </div>
                          </div>
                          {pendingLookup.lineCount > 1 ? (
                            <p className="text-xs text-muted-foreground">
                              {pendingLookup.lineCount} líneas de TF agrupadas (suma de cantidades).
                            </p>
                          ) : null}
                          <Button type="button" onClick={() => void handleConfirmStart()} disabled={busyUnit || !!openPause}>
                            {busyUnit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                            Iniciar unidad
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Unidades del turno</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Código</TableHead>
                            <TableHead>Destino</TableHead>
                            <TableHead className="text-right">Cant.</TableHead>
                            <TableHead>Inicio</TableHead>
                            <TableHead>Fin</TableHead>
                            <TableHead>Neto</TableHead>
                            <TableHead>Estado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {units.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                                Sin unidades aún.
                              </TableCell>
                            </TableRow>
                          ) : (
                            units.map((u) => (
                              <TableRow key={u.id}>
                                <TableCell className="font-mono text-xs">
                                  <div>{u.scanCode}</div>
                                  <div className="text-muted-foreground">{u.marca}</div>
                                </TableCell>
                                <TableCell>{u.bodegaDestino}</TableCell>
                                <TableCell className="text-right tabular-nums">{u.cantidad}</TableCell>
                                <TableCell className="tabular-nums text-xs">{fmtClock(u.startedAt)}</TableCell>
                                <TableCell className="tabular-nums text-xs">{fmtClock(u.endedAt)}</TableCell>
                                <TableCell className="text-xs">{fmtDuration(u.durationNetMs ?? u.durationMs)}</TableCell>
                                <TableCell>
                                  {u.status === 'done' ? (
                                    <Badge variant="secondary">Fin</Badge>
                                  ) : (
                                    <Badge className="bg-amber-500/20 text-amber-900">En proceso</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card className="border-amber-600/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <PauseCircle className="h-4 w-4" />
                        Pausas colectivas
                      </CardTitle>
                      <CardDescription>
                        Descansos del grupo. No se mezclan con otros tiempos de la Suite; sí se restan del rendimiento
                        neto.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {openPause ? (
                        <Button
                          type="button"
                          className="w-full"
                          variant="default"
                          disabled={pauseBusy}
                          onClick={() => void handleResumePause()}
                        >
                          {pauseBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Reanudar trabajo
                        </Button>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pauseBusy}
                            onClick={() => void handleStartPause('desayuno')}
                          >
                            <Coffee className="mr-1.5 h-4 w-4" />
                            Desayuno
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pauseBusy}
                            onClick={() => void handleStartPause('almuerzo')}
                          >
                            <Utensils className="mr-1.5 h-4 w-4" />
                            Almuerzo
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pauseBusy}
                            onClick={() => void handleStartPause('fin_jornada')}
                          >
                            <Moon className="mr-1.5 h-4 w-4" />
                            Fin jornada
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pauseBusy}
                            onClick={() => setShowOtros((v) => !v)}
                          >
                            <MoreHorizontal className="mr-1.5 h-4 w-4" />
                            Otros
                          </Button>
                        </div>
                      )}
                      {showOtros && !openPause ? (
                        <div className="space-y-2 pt-1">
                          <Textarea
                            placeholder="Motivo de la pausa…"
                            value={otrosNote}
                            onChange={(e) => setOtrosNote(e.target.value)}
                            rows={2}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={pauseBusy || !otrosNote.trim()}
                            onClick={() => void handleStartPause('otros')}
                          >
                            Iniciar pausa Otros
                          </Button>
                        </div>
                      ) : null}
                      <div className="space-y-1 pt-2 max-h-40 overflow-y-auto">
                        {pauses.map((p) => (
                          <div key={p.id} className="text-xs flex justify-between gap-2 border-b py-1">
                            <span>
                              {PAUSE_LABELS[p.type]}
                              {p.note ? ` · ${p.note}` : ''}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {fmtClock(p.pausedAt)} · {fmtDuration(p.durationMs)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Personas en el turno</CardTitle>
                    </CardHeader>
                    <CardContent className="flex gap-2 items-end">
                      <div className="space-y-1 flex-1">
                        <Label>Cantidad</Label>
                        <Input
                          type="number"
                          min={1}
                          className="tabular-nums"
                          value={peopleCount}
                          onChange={(e) => setPeopleCount(Math.max(1, Number(e.target.value) || 1))}
                        />
                      </div>
                      <Button type="button" variant="secondary" onClick={() => void handleUpdatePeople()}>
                        Guardar
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {canAdmin ? (
          <TabsContent value="vivo" className="space-y-4 mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Monitor en vivo</h2>
                <p className="text-sm text-muted-foreground">
                  Códigos leídos y unidades activas (sin cerrar). Se actualiza cada 20 s.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={liveFilter} onValueChange={(v) => setLiveFilter(v as 'activos' | 'todos')}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activos">Solo activos</SelectItem>
                    <SelectItem value="todos">Todos hoy</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={liveLoading}
                  onClick={() => void loadLiveMonitor(true)}
                >
                  {liveLoading ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-1.5 h-4 w-4" />
                  )}
                  Actualizar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={liveLoading}
                  onClick={() => void handleCleanupDuplicates()}
                >
                  Limpiar duplicados
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Unidades activas (sin cerrar)</CardDescription>
                  <CardTitle className="text-2xl tabular-nums text-amber-700">
                    {liveActiveUnits.length}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Códigos leídos hoy</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{liveTodayUnits.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Grupos en pausa</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{liveOpenPauses.length}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            {liveOpenPauses.length > 0 ? (
              <Card className="border-amber-600/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Pausas abiertas ahora</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {liveOpenPauses.map((p) => (
                    <div key={p.id} className="text-sm flex flex-wrap justify-between gap-2 border-b py-1.5">
                      <span>
                        <Badge variant="destructive" className="mr-2">
                          {PAUSE_LABELS[p.type]}
                        </Badge>
                        {p.grupo}
                        {p.note ? ` · ${p.note}` : ''}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        desde {fmtClock(p.pausedAt)} · {fmtElapsedSince(p.pausedAt)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {liveFilter === 'activos' ? 'Unidades activas (sin Fin)' : 'Códigos leídos hoy'}
                </CardTitle>
                <CardDescription>
                  {liveFilter === 'activos'
                    ? 'Unidades con Inicio registrado que aún no tienen Fin.'
                    : 'Todos los códigos escaneados del día (activos y cerrados).'}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Estado</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Destino</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead>Inicio</TableHead>
                      <TableHead>Transcurrido / Neto</TableHead>
                      <TableHead>Operario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          {liveLoading
                            ? 'Cargando…'
                            : liveFilter === 'activos'
                              ? 'No hay unidades activas en este momento.'
                              : 'Sin códigos leídos hoy.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      liveRows.map((u) => {
                        const sh = liveShiftById.get(u.shiftId);
                        const paused = livePausedShiftIds.has(u.shiftId);
                        return (
                          <TableRow key={u.id} className={u.status === 'in_progress' ? 'bg-amber-50/60 dark:bg-amber-950/20' : undefined}>
                            <TableCell>
                              {u.status === 'in_progress' ? (
                                <div className="flex flex-col gap-1">
                                  <Badge className="bg-amber-500/20 text-amber-900 w-fit">En proceso</Badge>
                                  {paused ? (
                                    <Badge variant="destructive" className="w-fit text-[10px]">
                                      Grupo en pausa
                                    </Badge>
                                  ) : null}
                                </div>
                              ) : (
                                <Badge variant="secondary">Cerrada</Badge>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{u.scanCode}</TableCell>
                            <TableCell className="font-mono text-xs">{u.numeroTF}</TableCell>
                            <TableCell>{u.grupo || sh?.grupo || '—'}</TableCell>
                            <TableCell>{u.bodegaDestino}</TableCell>
                            <TableCell className="text-sm">{u.marca || '—'}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{u.cantidad}</TableCell>
                            <TableCell className="tabular-nums text-xs">{fmtClock(u.startedAt)}</TableCell>
                            <TableCell className="tabular-nums text-xs">
                              {u.status === 'in_progress'
                                ? fmtElapsedSince(u.startedAt)
                                : fmtDuration(u.durationNetMs ?? u.durationMs)}
                            </TableCell>
                            <TableCell className="text-xs">{u.userName || '—'}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Turnos del día</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Estado</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Personas</TableHead>
                      <TableHead>Inicio</TableHead>
                      <TableHead>Operario</TableHead>
                      <TableHead className="text-right">Activas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveShifts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Sin turnos hoy.
                        </TableCell>
                      </TableRow>
                    ) : (
                      liveShifts.map((s) => {
                        const actives = liveActiveUnits.filter((u) => u.shiftId === s.id).length;
                        return (
                          <TableRow key={s.id}>
                            <TableCell>
                              {s.status === 'active' ? (
                                <Badge className="bg-emerald-500/15 text-emerald-800">Activo</Badge>
                              ) : (
                                <Badge variant="secondary">Cerrado</Badge>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{s.grupo}</TableCell>
                            <TableCell className="tabular-nums">{s.peopleCount}</TableCell>
                            <TableCell className="tabular-nums text-xs">{fmtClock(s.startedAt)}</TableCell>
                            <TableCell className="text-xs">{s.userName}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold text-amber-700">
                              {actives}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canAdmin ? (
          <TabsContent value="admin" className="space-y-4 mt-4">
            <div className="flex flex-wrap justify-end gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Hora PDF</Label>
                <Select value={dashReportHour} onValueChange={setDashReportHour}>
                  <SelectTrigger className="w-[100px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hourOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handlePdfHoraDashboard}>
                <FileDown className="mr-1.5 h-4 w-4" />
                PDF por hora
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void handlePdfDiaConsolidado()}>
                <FileDown className="mr-1.5 h-4 w-4" />
                PDF día consolidado
              </Button>
              <Button type="button" variant="outline" disabled={dashLoading} onClick={() => void loadDashboard()}>
                {dashLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Actualizar
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Cantidad cerrada (hoy)</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{dashStats.qty.toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Unidades cerradas</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{dashStats.doneCount}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Tiempo neto / pausas</CardDescription>
                  <CardTitle className="text-lg tabular-nums">
                    {fmtDuration(dashStats.netMs)} · {fmtDuration(dashStats.pauseMs)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Rendimiento neto (cant / persona·h)</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{dashStats.perPersonHour.toFixed(1)}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Avance por hora</CardTitle>
                  <CardDescription>Cantidad cerrada y minutos en pausa (no castigan el neto).</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hora</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                        <TableHead className="text-right">Unidades</TableHead>
                        <TableHead className="text-right">Pausa min</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashStats.hourRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                            Sin datos de hoy.
                          </TableCell>
                        </TableRow>
                      ) : (
                        dashStats.hourRows.map((r) => (
                          <TableRow key={r.hour}>
                            <TableCell className="tabular-nums">{r.hour}:00</TableCell>
                            <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.units}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.pauseMin}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Marcas (cantidad)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Marca</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashStats.marcaRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                            Sin datos.
                          </TableCell>
                        </TableRow>
                      ) : (
                        dashStats.marcaRows.map((r) => (
                          <TableRow key={r.marca}>
                            <TableCell>{r.marca}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.cant}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
