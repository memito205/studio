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
  Search,
  Trash2,
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
  TalladoEtiquetadoModo,
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
  listTalladoActiveShiftsForDay,
  listTalladoReceptionOptions,
  enterTalladoShift,
  resumeTalladoPause,
  scanTalladoCode,
  startTalladoPause,
  startTalladoShift,
  confirmTalladoUnitFromLookup,
  adminCloseTalladoShift,
  adminDeleteTalladoShift,
  adminUpdateTalladoUnitCantidad,
  adminDeleteTalladoUnit,
  updateTalladoUnitEtiquetadoModo,
  repairTalladoUnitReceptionQty,
  repairTalladoShiftReceptionQtys,
  updateTalladoShiftPeople,
  updateTalladoShiftProductivityStart,
  importTalladoCatalog,
  getTalladoCatalogStats,
  clearTalladoCatalog,
  auditTalladoUnitsByCode,
} from '@/app/talladoMercanciaActions';
import { talladoEtiquetadoModoLabel } from '@/lib/talladoEtiquetado';
import {
  downloadTalladoDayConsolidatedPdf,
  downloadTalladoHourlyPdf,
  downloadTalladoReportPdf,
  localHourFromIso,
} from '@/lib/talladoMercanciaPdf';
import { downloadTalladoDayConsolidatedExcel } from '@/lib/talladoMercanciaExcel';
import { downloadTalladoCatalogTemplate, parseTalladoCatalogSheet, TALLADO_DEFAULT_DESTINO } from '@/lib/talladoCatalog';
import { talladoLocalDayKey, talladoPauseMs, talladoPerPersonHour } from '@/lib/talladoProductivity';
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

const TALLADO_SS_SHIFT = 'tallado.activeShiftId';
const TALLADO_SS_DAY = 'tallado.activeDayKey';
const TALLADO_SS_RECEPTION = 'tallado.receptionOperationId';

function persistTalladoShiftSession(shift: TalladoShift) {
  try {
    const day = shift.dayKey || talladoLocalDayKey(new Date(shift.startedAt));
    sessionStorage.setItem(TALLADO_SS_SHIFT, shift.id);
    sessionStorage.setItem(TALLADO_SS_DAY, day);
  } catch {
    /* ignore */
  }
}

function clearTalladoShiftSession() {
  try {
    sessionStorage.removeItem(TALLADO_SS_SHIFT);
    sessionStorage.removeItem(TALLADO_SS_DAY);
  } catch {
    /* ignore */
  }
}

function persistReceptionScope(receptionOperationId: string) {
  try {
    if (receptionOperationId) sessionStorage.setItem(TALLADO_SS_RECEPTION, receptionOperationId);
    else sessionStorage.removeItem(TALLADO_SS_RECEPTION);
  } catch {
    /* ignore */
  }
}

function readReceptionScope(): string {
  try {
    return sessionStorage.getItem(TALLADO_SS_RECEPTION) || '';
  } catch {
    return '';
  }
}

const START_SOURCE_LABEL: Record<'admin' | 'primera_lectura' | 'turno', string> = {
  admin: 'Admin',
  primera_lectura: '1ª lectura',
  turno: 'Inicio turno',
};

function isoToDatetimeLocalBogota(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

function datetimeLocalBogotaToIso(value: string): string {
  // Interpreta el valor del input como hora Colombia
  return new Date(`${value}:00.000-05:00`).toISOString();
}

function firstUnitStartIsoForShift(units: TalladoUnit[], shiftId: string, dayKey: string, grupo?: string): string | null {
  let best: number | null = null;
  for (const u of units) {
    const sameShift = u.shiftId === shiftId;
    const sameGrupo = !!grupo && u.grupo === grupo;
    if (!sameShift && !sameGrupo) continue;
    const iso = u.startedAt;
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    if (key !== dayKey) continue;
    const ms = d.getTime();
    if (best == null || ms < best) best = ms;
  }
  return best == null ? null : new Date(best).toISOString();
}

function isTalladoSinRemision(u: Pick<TalladoUnit, 'source' | 'bodegaDestino' | 'marca'>): boolean {
  if (u.source === 'catalogo' || u.source === 'recepcion') return true;
  const dest = String(u.bodegaDestino || '').toUpperCase();
  const marca = String(u.marca || '').toUpperCase();
  return (
    dest.includes('SIN REMISION') ||
    marca.includes('SIN REMISION') ||
    dest === TALLADO_DEFAULT_DESTINO ||
    marca === TALLADO_DEFAULT_DESTINO
  );
}

function displayTalladoMarca(u: TalladoUnit): string {
  // En cruce recepción mostrar refs de la caja (no marcas TF ajenas).
  if (u.source === 'recepcion') {
    const refs = String(u.referencia || '').trim();
    if (refs) return refs;
    return TALLADO_DEFAULT_DESTINO;
  }
  if (isTalladoSinRemision(u)) return TALLADO_DEFAULT_DESTINO;
  return u.marca || '—';
}

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

function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
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
  const [todayShifts, setTodayShifts] = useState<TalladoShift[]>([]);
  const [loadingEntry, setLoadingEntry] = useState(true);
  const [entryMode, setEntryMode] = useState<'pick' | 'create'>('create');
  const [selectedTodayShiftId, setSelectedTodayShiftId] = useState<string>('');
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [receptionCandidates, setReceptionCandidates] = useState<TalladoTransferLookup[]>([]);
  const [confirmingCandidate, setConfirmingCandidate] = useState(false);
  const [receptionScopeId, setReceptionScopeId] = useState(() => readReceptionScope());
  const [etiquetadoModo, setEtiquetadoModo] = useState<TalladoEtiquetadoModo | null>(null);
  const [receptionOptions, setReceptionOptions] = useState<
    Array<{ id: string; rk: string; supplier: string; status: string }>
  >([]);
  const [loadingReceptionOptions, setLoadingReceptionOptions] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);
  const [updatingUnitId, setUpdatingUnitId] = useState<string | null>(null);
  const [repairingQtys, setRepairingQtys] = useState(false);
  const [otrosNote, setOtrosNote] = useState('');
  const [showOtros, setShowOtros] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const [dashLoading, setDashLoading] = useState(false);
  const [dashDayKey, setDashDayKey] = useState(() => talladoLocalDayKey());
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
  const [auditCode, setAuditCode] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditUnits, setAuditUnits] = useState<TalladoUnit[] | null>(null);
  const [auditQueriedCode, setAuditQueriedCode] = useState('');
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
    (code: string, label: string, variant: 'ok' | 'fin' | 'error' = 'ok', holdMs = 2000) => {
      if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current);
      setScanFlash({ code: displayScanCode(code) || code, label, variant });
      focusScanInput(30);
      scanFlashTimerRef.current = setTimeout(() => {
        setScanFlash(null);
        scanFlashTimerRef.current = null;
        focusScanInput(30);
      }, Math.max(1200, holdMs));
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

  const handleAuditUnit = async () => {
    const code = auditCode.trim();
    if (!code) {
      toast({ variant: 'destructive', title: 'Auditor', description: 'Digite un código (TF / alterno / barras).' });
      return;
    }
    setAuditLoading(true);
    setAuditUnits(null);
    const res = await auditTalladoUnitsByCode(code);
    setAuditLoading(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Auditor', description: res.error });
      return;
    }
    setAuditQueriedCode(res.normalizedCode || code);
    setAuditUnits(res.data || []);
    if ((res.data || []).length === 0) {
      toast({ title: 'Sin historial', description: `No hay lecturas talladas para “${res.normalizedCode || code}”.` });
    }
  };

  const refreshShift = useCallback(async (shiftId: string) => {
    const res = await listTalladoShiftBundle(shiftId);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    if (res.shift) {
      if (res.shift.status === 'closed') {
        clearTalladoShiftSession();
        setShift(null);
        setUnits([]);
        setPauses([]);
        return;
      }
      setShift(res.shift);
      persistTalladoShiftSession(res.shift);
    }
    setUnits(res.units || []);
    setPauses(res.pauses || []);
  }, [toast]);

  const reloadTodayShifts = useCallback(async () => {
    const dayKey = talladoLocalDayKey();
    const res = await listTalladoActiveShiftsForDay(dayKey);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Turnos del día', description: res.error });
      return [];
    }
    const list = res.data || [];
    setTodayShifts(list);
    if (list.length > 0) {
      setSelectedTodayShiftId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0].id));
      setEntryMode('pick');
    } else {
      setEntryMode('create');
      setSelectedTodayShiftId('');
    }
    return list;
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingEntry(true);
      const dayKey = talladoLocalDayKey();
      const listRes = await listTalladoActiveShiftsForDay(dayKey);
      if (cancelled) return;
      const list = listRes.success ? listRes.data || [] : [];
      setTodayShifts(list);
      if (list.length > 0) {
        setEntryMode('pick');
        setSelectedTodayShiftId(list[0].id);
      } else {
        setEntryMode('create');
      }

      try {
        const sid = sessionStorage.getItem(TALLADO_SS_SHIFT);
        const sday = sessionStorage.getItem(TALLADO_SS_DAY);
        if (sid && sday === dayKey) {
          const bundle = await listTalladoShiftBundle(sid);
          if (
            !cancelled &&
            bundle.success &&
            bundle.shift?.status === 'active' &&
            (bundle.shift.dayKey ? bundle.shift.dayKey === dayKey : true)
          ) {
            const s = bundle.shift;
            const sameDay =
              s.dayKey === dayKey ||
              talladoLocalDayKey(new Date(s.startedAt)) === dayKey;
            if (sameDay) {
              setShift(s);
              setUnits(bundle.units || []);
              setPauses(bundle.pauses || []);
              setGrupo(s.grupo);
              setPeopleCount(s.peopleCount);
              persistTalladoShiftSession(s);
              setLoadingEntry(false);
              return;
            }
          }
          clearTalladoShiftSession();
        }
      } catch {
        clearTalladoShiftSession();
      }
      if (!cancelled) setLoadingEntry(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (shift?.id) void refreshShift(shift.id);
  }, [shift?.id, refreshShift]);

  useEffect(() => {
    if (shift && !openPause) focusScanInput(100);
  }, [shift, openPause, scanning, focusScanInput]);

  useEffect(() => {
    if (!shift?.id) return;
    let cancelled = false;
    (async () => {
      setLoadingReceptionOptions(true);
      const res = await listTalladoReceptionOptions();
      if (cancelled) return;
      setLoadingReceptionOptions(false);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Recepciones', description: res.error });
        return;
      }
      const list = res.data || [];
      setReceptionOptions(list);
      if (receptionScopeId && !list.some((o) => o.id === receptionScopeId)) {
        setReceptionScopeId('');
        persistReceptionScope('');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when entering shift
  }, [shift?.id, toast]);

  const applyEnteredShift = async (next: TalladoShift, rejoined?: boolean) => {
    setShift(next);
    setGrupo(next.grupo);
    setPeopleCount(next.peopleCount);
    persistTalladoShiftSession(next);
    setReceptionCandidates([]);
    if (rejoined) {
      toast({
        title: 'Turno ya activo',
        description: `Se reanudó el turno de ${next.grupo} (no se creó otro).`,
      });
      await refreshShift(next.id);
    } else {
      setUnits([]);
      setPauses([]);
      toast({ title: 'Turno iniciado', description: `${next.grupo} · ${next.peopleCount} persona(s)` });
    }
    void reloadTodayShifts();
  };

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
    await applyEnteredShift(res.data, res.rejoined);
  };

  const handleEnterExistingShift = async () => {
    if (!selectedTodayShiftId) {
      toast({ variant: 'destructive', title: 'Grupo', description: 'Seleccione un grupo activo de hoy.' });
      return;
    }
    setStartingShift(true);
    const res = await enterTalladoShift(selectedTodayShiftId);
    setStartingShift(false);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'No se pudo entrar', description: res.error });
      void reloadTodayShifts();
      return;
    }
    await applyEnteredShift(res.data, true);
  };

  const handleLeaveShiftLocally = () => {
    clearTalladoShiftSession();
    setShift(null);
    setUnits([]);
    setPauses([]);
    setReceptionCandidates([]);
    void reloadTodayShifts();
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
          receptionOperationId: receptionScopeId || undefined,
          etiquetadoModo,
        });
        setScanCode('');
        if (!res.success) {
          showScanFlash(code, res.error || 'No se pudo leer', 'error');
          toast({ variant: 'destructive', title: 'Escaneo', description: res.error });
          setReceptionCandidates([]);
          return;
        }
        if (res.action === 'finished') {
          const finCode = res.unit?.scanCode || code;
          showScanFlash(finCode, 'Cerrada (legado)', 'fin');
          setReceptionCandidates([]);
          toast({
            title: 'Unidad cerrada',
            description: `${finCode} · se cerró un Inicio pendiente del modelo anterior`,
          });
          if (res.unit) {
            setUnits((prev) => {
              const idx = prev.findIndex((u) => u.id === res.unit!.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = res.unit!;
                return next;
              }
              return [res.unit!, ...prev];
            });
          }
          return;
        }
        if (res.action === 'pick_reception' && res.candidates?.length) {
          setReceptionCandidates(res.candidates);
          showScanFlash(code, 'Varias RK — elija caja', 'ok');
          toast({
            title: 'Varias recepciones',
            description: res.error || 'Elija la RK / caja: al elegir queda confirmada.',
          });
          return;
        }
        if (res.action === 'confirmed' && res.unit) {
          const u = res.unit;
          const label =
            u.source === 'recepcion'
              ? `Caja #${u.unitNumber ?? u.scanCode} confirmada · ${u.cantidad} und.`
              : u.source === 'catalogo'
                ? `Catálogo confirmado · ${u.cantidad} und.`
                : `Confirmada · ${u.cantidad} und.`;
          // Banner de éxito más visible/largo (lookups de recepción pueden tardar >2s).
          showScanFlash(u.scanCode || code, label, 'ok', 3200);
          setReceptionCandidates([]);
          toast({
            title: 'Unidad confirmada',
            description: `${
              u.source === 'recepcion'
                ? `Caja #${u.unitNumber ?? u.scanCode}`
                : u.source === 'catalogo'
                  ? 'Catálogo'
                  : u.numeroTF || u.scanCode
            } · ${u.cantidad} und. · ${talladoEtiquetadoModoLabel(u.etiquetadoModo)}`,
          });
          setUnits((prev) => [u, ...prev.filter((x) => x.id !== u.id)]);
          return;
        }
      } finally {
        setScanning(false);
        setScanCode('');
        focusScanInput(50);
        focusScanInput(200);
      }
    },
    [shift, user, openPause, toast, showScanFlash, focusScanInput, receptionScopeId, etiquetadoModo]
  );

  const handleAdminCloseShift = async (shiftId: string) => {
    if (!window.confirm('¿Cerrar este turno? Dejará de aparecer para reingreso del día.')) return;
    setDeletingShiftId(shiftId);
    const res = await adminCloseTalladoShift(shiftId);
    setDeletingShiftId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Cerrar turno', description: res.error });
      return;
    }
    toast({ title: 'Turno cerrado' });
    if (shift?.id === shiftId) {
      clearTalladoShiftSession();
      setShift(null);
      setUnits([]);
      setPauses([]);
    }
    void loadDashboard();
    void reloadTodayShifts();
  };

  const handleAdminDeleteShift = async (shiftId: string) => {
    if (
      !window.confirm(
        '¿Eliminar este turno y todas sus unidades/pausas de tallado? Esta acción no se puede deshacer. No afecta recepción.'
      )
    ) {
      return;
    }
    setDeletingShiftId(shiftId);
    const res = await adminDeleteTalladoShift(shiftId);
    setDeletingShiftId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Eliminar turno', description: res.error });
      return;
    }
    toast({
      title: 'Turno eliminado',
      description: `Unidades: ${res.deletedUnits || 0} · Pausas: ${res.deletedPauses || 0}`,
    });
    if (shift?.id === shiftId) {
      clearTalladoShiftSession();
      setShift(null);
      setUnits([]);
      setPauses([]);
    }
    void loadDashboard();
    void reloadTodayShifts();
  };

  const handleUpdateUnitEtiquetado = async (
    unitId: string,
    next: TalladoEtiquetadoModo | null
  ) => {
    setUpdatingUnitId(unitId);
    const res = await updateTalladoUnitEtiquetadoModo({ unitId, etiquetadoModo: next });
    setUpdatingUnitId(null);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'Etiquetado', description: res.error });
      return;
    }
    setUnits((prev) => prev.map((u) => (u.id === unitId ? res.data! : u)));
    toast({
      title: 'Etiquetado actualizado',
      description: talladoEtiquetadoModoLabel(res.data.etiquetadoModo),
    });
  };

  const handleRepairUnitQty = async (unitId: string) => {
    setUpdatingUnitId(unitId);
    const res = await repairTalladoUnitReceptionQty(unitId);
    setUpdatingUnitId(null);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'Cantidad', description: res.error });
      return;
    }
    setUnits((prev) => prev.map((u) => (u.id === unitId ? res.data! : u)));
    toast({
      title: 'Cantidad corregida',
      description: `${res.data.scanCode} · ${res.data.cantidad} und.`,
    });
  };

  const handleRepairShiftReceptionQtys = async () => {
    if (!shift?.id) return;
    setRepairingQtys(true);
    const res = await repairTalladoShiftReceptionQtys(shift.id);
    setRepairingQtys(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Corregir cantidades', description: res.error });
      return;
    }
    toast({
      title: 'Cantidades recepción',
      description: `Corregidas: ${res.fixed || 0} · Sin datos: ${res.skipped || 0}`,
    });
    await refreshShift(shift.id);
  };

  const handleAdminEditUnitCantidad = async (unit: TalladoUnit) => {
    if (!canAdmin) return;
    const current = Number(unit.cantidad) || 0;
    const raw = window.prompt(
      `Cantidad real tallada${
        unit.source === 'recepcion' ? ` (caja Rec #${unit.unitNumber ?? unit.scanCode})` : ''
      }:\nPuede ser menor a la del plan de recepción.`,
      String(current)
    );
    if (raw == null) return;
    const qty = Math.round(Number(String(raw).trim().replace(',', '.')));
    if (!Number.isFinite(qty) || qty < 0) {
      toast({ variant: 'destructive', title: 'Cantidad', description: 'Ingrese un número ≥ 0.' });
      return;
    }
    if (qty === current) return;
    setUpdatingUnitId(unit.id);
    const res = await adminUpdateTalladoUnitCantidad({ unitId: unit.id, cantidad: qty });
    setUpdatingUnitId(null);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'Cantidad', description: res.error });
      return;
    }
    setUnits((prev) => prev.map((u) => (u.id === unit.id ? res.data! : u)));
    toast({
      title: 'Cantidad actualizada',
      description: `${res.data.scanCode} · ${res.data.cantidad} und.`,
    });
  };

  const handleAdminDeleteUnit = async (unit: TalladoUnit) => {
    if (!canAdmin) return;
    const label =
      unit.source === 'recepcion'
        ? `Rec #${unit.unitNumber ?? unit.scanCode}`
        : unit.scanCode;
    if (
      !window.confirm(
        `¿Eliminar el registro ${label} (${unit.cantidad} und.)?\nNo se puede deshacer. No modifica recepción.`
      )
    ) {
      return;
    }
    setUpdatingUnitId(unit.id);
    const res = await adminDeleteTalladoUnit(unit.id);
    setUpdatingUnitId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Eliminar', description: res.error });
      return;
    }
    setUnits((prev) => prev.filter((u) => u.id !== unit.id));
    toast({ title: 'Registro eliminado', description: label });
  };

  const handleConfirmReceptionCandidate = async (lookup: TalladoTransferLookup) => {
    if (!shift?.id || !user?.uid) return;
    if (openPause) {
      toast({ variant: 'destructive', title: 'En pausa', description: 'Reanude la pausa antes de confirmar.' });
      return;
    }
    setConfirmingCandidate(true);
    const res = await confirmTalladoUnitFromLookup({
      shiftId: shift.id,
      lookup,
      userId: user.uid,
      userName: user.displayName || user.email || 'Operario',
      grupo: shift.grupo,
      skipOpenPauseCheck: true,
      etiquetadoModo,
    });
    setConfirmingCandidate(false);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'No se confirmó', description: res.error });
      return;
    }
    const u = res.data;
    setReceptionCandidates([]);
    showScanFlash(
      u.scanCode,
      `Caja #${u.unitNumber ?? u.scanCode} confirmada · ${u.cantidad} und.`,
      'ok',
      3200
    );
    toast({
      title: 'Unidad confirmada',
      description: `Caja #${u.unitNumber ?? u.scanCode} · RK ${u.rkIdentifier || '—'} · ${u.cantidad} und. · ${talladoEtiquetadoModoLabel(u.etiquetadoModo)}`,
    });
    setUnits((prev) => [u, ...prev.filter((x) => x.id !== u.id)]);
    focusScanInput(80);
  };

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
    setReceptionCandidates([]);
    toast({ title: 'Pausa iniciada', description: PAUSE_LABELS[type] });
    if (type === 'fin_jornada') {
      clearTalladoShiftSession();
      setShift(null);
      setUnits([]);
      setPauses([]);
      void reloadTodayShifts();
      return;
    }
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

  const [peopleDrafts, setPeopleDrafts] = useState<Record<string, number>>({});
  const [startDrafts, setStartDrafts] = useState<Record<string, string>>({});
  const [savingPeopleId, setSavingPeopleId] = useState<string | null>(null);
  const [savingStartId, setSavingStartId] = useState<string | null>(null);

  const handleAdminUpdatePeople = async (shiftId: string, nextCount?: number) => {
    const n = Math.max(1, Math.round(Number(nextCount ?? peopleDrafts[shiftId]) || 0));
    setSavingPeopleId(shiftId);
    const res = await updateTalladoShiftPeople(shiftId, n);
    if (!res.success) {
      setSavingPeopleId(null);
      toast({ variant: 'destructive', title: 'Personas', description: res.error });
      return;
    }
    setPeopleDrafts((prev) => ({ ...prev, [shiftId]: n }));
    if (shift?.id === shiftId) {
      setPeopleCount(n);
      setShift((s) => (s ? { ...s, peopleCount: n } : s));
    }
    // Recargar desde Firestore para que el KPI use el peopleCount nuevo
    const [dashRes, liveRes] = await Promise.all([
      listTalladoDashboard({ dayKey: dashDayKey }),
      listTalladoLiveMonitor({ cleanup: false }),
    ]);
    setSavingPeopleId(null);
    if (dashRes.success) {
      setDashShifts(dashRes.shifts || []);
      setDashUnits(dashRes.units || []);
      setDashPauses(dashRes.pauses || []);
    } else {
      setDashShifts((prev) => prev.map((s) => (s.id === shiftId ? { ...s, peopleCount: n } : s)));
    }
    if (liveRes.success) {
      setLiveShifts(liveRes.shifts || []);
      setLiveActiveUnits(liveRes.activeUnits || []);
      setLiveTodayUnits(liveRes.todayUnits || []);
      setLiveOpenPauses(liveRes.openPauses || []);
    } else {
      setLiveShifts((prev) => prev.map((s) => (s.id === shiftId ? { ...s, peopleCount: n } : s)));
    }
    toast({
      title: 'Personas actualizadas',
      description: `${n} persona(s). El rendimiento (cant / persona·h) se recalculó.`,
    });
  };

  const reloadDashAndLive = async () => {
    const [dashRes, liveRes] = await Promise.all([
      listTalladoDashboard({ dayKey: dashDayKey }),
      listTalladoLiveMonitor({ cleanup: false }),
    ]);
    if (dashRes.success) {
      setDashShifts(dashRes.shifts || []);
      setDashUnits(dashRes.units || []);
      setDashPauses(dashRes.pauses || []);
    }
    if (liveRes.success) {
      setLiveShifts(liveRes.shifts || []);
      setLiveActiveUnits(liveRes.activeUnits || []);
      setLiveTodayUnits(liveRes.todayUnits || []);
      setLiveOpenPauses(liveRes.openPauses || []);
    }
  };

  const handleAdminUpdateStart = async (shiftId: string, mode: 'save' | 'first_unit' | 'clear') => {
    let iso: string | null = null;
    if (mode === 'clear') {
      iso = null;
    } else if (mode === 'first_unit') {
      iso = firstUnitStartIsoForShift(dashUnits, shiftId, dashDayKey, dashShifts.find((x) => x.id === shiftId)?.grupo);
      if (!iso) {
        toast({
          variant: 'destructive',
          title: 'Inicio',
          description: 'No hay lecturas de este turno en la fecha seleccionada.',
        });
        return;
      }
    } else {
      const draft = startDrafts[shiftId];
      if (!draft) {
        toast({ variant: 'destructive', title: 'Inicio', description: 'Indique fecha y hora.' });
        return;
      }
      iso = datetimeLocalBogotaToIso(draft);
    }

    setSavingStartId(shiftId);
    const res = await updateTalladoShiftProductivityStart(shiftId, iso);
    if (!res.success) {
      setSavingStartId(null);
      toast({ variant: 'destructive', title: 'Inicio', description: res.error });
      return;
    }
    await reloadDashAndLive();
    setSavingStartId(null);
    if (iso) {
      setStartDrafts((prev) => ({ ...prev, [shiftId]: isoToDatetimeLocalBogota(iso) }));
    } else {
      setStartDrafts((prev) => {
        const next = { ...prev };
        delete next[shiftId];
        return next;
      });
    }
    toast({
      title: 'Hora de inicio actualizada',
      description:
        mode === 'clear'
          ? 'Se volvió al cálculo automático (1ª lectura / turno).'
          : mode === 'first_unit'
            ? 'Se usó la primera lectura del día.'
            : 'Inicio productivo fijado por admin.',
    });
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

  const loadTodayConsolidatedBundle = async (dayKey = talladoLocalDayKey()) => {
    const res = await listTalladoDashboard({ dayKey });
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Consolidado', description: res.error });
      return null;
    }
    const shifts = res.shifts || [];
    const dayUnits = res.units || [];
    const dayPauses = res.pauses || [];
    if (dayKey === dashDayKey) {
      setDashShifts(shifts);
      setDashUnits(dayUnits);
      setDashPauses(dayPauses);
    }
    return { dayKey, shifts, units: dayUnits, pauses: dayPauses };
  };

  const handlePdfDiaConsolidado = async () => {
    const dayKey = mainTab === 'admin' ? dashDayKey : talladoLocalDayKey();
    const bundle = await loadTodayConsolidatedBundle(dayKey);
    if (!bundle) return;
    if (!bundle.shifts.length && !bundle.units.length) {
      toast({
        variant: 'destructive',
        title: 'Sin datos',
        description: `No hay turnos ni unidades de tallado para ${dayKey}.`,
      });
      return;
    }
    downloadTalladoDayConsolidatedPdf({
      dayKey: bundle.dayKey,
      shifts: bundle.shifts,
      units: bundle.units,
      pauses: bundle.pauses,
      dayLabel: bundle.dayKey,
    });
    toast({
      title: 'PDF generado',
      description: `Consolidado del día ${bundle.dayKey}.`,
    });
  };

  const handleExcelDiaConsolidado = async () => {
    const dayKey = mainTab === 'admin' ? dashDayKey : talladoLocalDayKey();
    const bundle = await loadTodayConsolidatedBundle(dayKey);
    if (!bundle) return;
    if (!bundle.shifts.length && !bundle.units.length) {
      toast({
        variant: 'destructive',
        title: 'Sin datos',
        description: `No hay turnos ni unidades de tallado para ${dayKey}.`,
      });
      return;
    }
    downloadTalladoDayConsolidatedExcel({
      dayKey: bundle.dayKey,
      shifts: bundle.shifts,
      units: bundle.units,
      pauses: bundle.pauses,
      dayLabel: bundle.dayKey,
    });
    toast({
      title: 'Excel generado',
      description: `Consolidado del día ${bundle.dayKey}.`,
    });
  };

  const handlePdfHoraDashboard = () => {
    downloadTalladoHourlyPdf({
      hour: Number(dashReportHour),
      units: dashUnits,
      pauses: dashPauses,
      scopeLabel: `Día ${dashDayKey}`,
      dayLabel: dashDayKey,
    });
  };

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    const res = await listTalladoDashboard({ dayKey: dashDayKey });
    setDashLoading(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Dashboard', description: res.error });
      return;
    }
    setDashShifts(res.shifts || []);
    setDashUnits(res.units || []);
    setDashPauses(res.pauses || []);
  }, [toast, dashDayKey]);

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
    const boxNetMs = done.reduce((s, u) => s + (Number(u.durationNetMs ?? u.durationMs) || 0), 0);
    const pauseMs = talladoPauseMs(dashPauses, dashDayKey);
    const { qty, personHours, perPersonHour, peopleTotal, workedMsTotal, formulaLabel, shiftRows } =
      talladoPerPersonHour({
        shifts: dashShifts,
        units: dashUnits,
        pauses: dashPauses,
        dayKey: dashDayKey,
      });

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
      const m = displayTalladoMarca(u);
      byMarca.set(m, (byMarca.get(m) || 0) + (Number(u.cantidad) || 0));
    }

    return {
      qty,
      doneCount: done.length,
      netMs: workedMsTotal,
      boxNetMs,
      pauseMs,
      personHours,
      peopleTotal,
      perPersonHour,
      formulaLabel,
      shiftRows,
      hourRows: Array.from(byHour.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([hour, v]) => ({ hour, ...v })),
      marcaRows: Array.from(byMarca.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([marca, cant]) => ({ marca, cant })),
    };
  }, [dashUnits, dashPauses, dashShifts, dashDayKey]);

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
              Un solo escaneo confirma (TF/alterno o catálogo). Para cruce recepción: elija la RK y luego el # de
              caja (el # se reinicia en cada operación). El tiempo lo marca el grupo. Recepción no se modifica.
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

      <Card className="border-violet-600/25">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-violet-600" />
            Auditor de unidades
          </CardTitle>
          <CardDescription>
            Digite TF, código alterno o barras para ver cuándo se leyó (Inicio) y cuándo se cerró el tallado (Fin).
            No inicia ni finaliza unidades.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAuditUnit();
            }}
          >
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label htmlFor="audit-code">Código</Label>
              <Input
                id="audit-code"
                value={auditCode}
                onChange={(e) => setAuditCode(e.target.value)}
                placeholder="Ej: TF… / código barras"
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={auditLoading}>
              {auditLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Consultar
            </Button>
            {auditUnits !== null ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAuditUnits(null);
                  setAuditQueriedCode('');
                  setAuditCode('');
                }}
              >
                Limpiar
              </Button>
            ) : null}
          </form>

          {auditUnits !== null ? (
            <div className="rounded-md border overflow-x-auto">
              <div className="px-3 py-2 text-xs text-muted-foreground border-b bg-muted/30">
                Resultados para <span className="font-mono font-semibold text-foreground">{auditQueriedCode}</span>
                {' · '}
                {auditUnits.length} registro(s)
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead>Cant.</TableHead>
                    <TableHead>Inicio (se leyó)</TableHead>
                    <TableHead>Fin (cerró)</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditUnits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                        Sin lecturas talladas para este código.
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditUnits.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono text-xs">
                          <div>{u.scanCode || u.numeroTF}</div>
                          {u.codigoAlterno ? (
                            <div className="text-muted-foreground">Alt: {u.codigoAlterno}</div>
                          ) : null}
                          {u.referencia ? (
                            <div className="text-muted-foreground">
                              {u.referencia}
                              {u.talla ? ` / ${u.talla}` : ''}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">{u.grupo || '—'}</TableCell>
                        <TableCell className="text-sm">{u.userName || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.cantidad ?? '—'}</TableCell>
                        <TableCell className="tabular-nums text-xs whitespace-nowrap">
                          {fmtDateTime(u.startedAt)}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs whitespace-nowrap">
                          {fmtDateTime(u.endedAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {fmtDuration(u.durationNetMs ?? u.durationMs)}
                        </TableCell>
                        <TableCell>
                          {u.status === 'done' ? (
                            <Badge variant="secondary">Cerrada</Badge>
                          ) : u.status === 'in_progress' ? (
                            <Badge className="bg-amber-500/20 text-amber-900">En proceso</Badge>
                          ) : (
                            <Badge variant="outline">{u.status}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : null}
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
                <CardDescription>
                  {loadingEntry
                    ? 'Cargando turnos del día…'
                    : todayShifts.length > 0 && entryMode === 'pick'
                      ? 'Elija un grupo ya activo hoy. No hace falta volver a digitar personas.'
                      : 'Primera vez hoy: indique el grupo y cuántas personas están laborando.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingEntry ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparando ingreso…
                  </div>
                ) : todayShifts.length > 0 && entryMode === 'pick' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>Grupo activo hoy</Label>
                      <Select value={selectedTodayShiftId} onValueChange={setSelectedTodayShiftId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione grupo" />
                        </SelectTrigger>
                        <SelectContent>
                          {todayShifts.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.grupo} · {s.peopleCount} persona(s)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => void handleEnterExistingShift()}
                        disabled={startingShift || !selectedTodayShiftId}
                      >
                        {startingShift ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Users className="mr-2 h-4 w-4" />
                        )}
                        Entrar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEntryMode('create')}
                        disabled={startingShift}
                      >
                        Crear otro grupo
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
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
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => void handleStartShift()} disabled={startingShift}>
                        {startingShift ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Users className="mr-2 h-4 w-4" />
                        )}
                        Entrar
                      </Button>
                      {todayShifts.length > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEntryMode('pick')}
                          disabled={startingShift}
                        >
                          Elegir grupo existente
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
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
                <Button type="button" size="sm" variant="ghost" onClick={handleLeaveShiftLocally}>
                  Cambiar grupo
                </Button>
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
                  <Button type="button" size="sm" variant="outline" onClick={() => void handleExcelDiaConsolidado()}>
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    Excel día consolidado
                  </Button>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Escanear código</CardTitle>
                      <CardDescription>
                        TF, código alterno o catálogo: un escaneo confirma. Para # caja de recepción: elija primero la
                        RK abajo (el # se reinicia en cada recepción).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="rounded-md border-2 border-emerald-600/40 bg-emerald-50/60 dark:bg-emerald-950/25 p-3 space-y-2">
                        <Label className="text-sm font-semibold">Etiquetado (costos)</Label>
                        <div className="flex flex-wrap gap-3">
                          <Button
                            type="button"
                            size="sm"
                            variant={etiquetadoModo === null ? 'default' : 'outline'}
                            onClick={() => setEtiquetadoModo(null)}
                          >
                            Normal
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={etiquetadoModo === 'ya_etiquetada' ? 'default' : 'outline'}
                            className={
                              etiquetadoModo === 'ya_etiquetada'
                                ? 'bg-emerald-700 hover:bg-emerald-800'
                                : ''
                            }
                            onClick={() => setEtiquetadoModo('ya_etiquetada')}
                          >
                            Ya etiquetada
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={etiquetadoModo === 'tallar_y_etiquetar' ? 'default' : 'outline'}
                            className={
                              etiquetadoModo === 'tallar_y_etiquetar'
                                ? 'bg-amber-700 hover:bg-amber-800'
                                : ''
                            }
                            onClick={() => setEtiquetadoModo('tallar_y_etiquetar')}
                          >
                            Tallar y etiquetar
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Aplica a las próximas lecturas. También puede cambiarlo en cada fila de unidades ya
                          cerradas.
                        </p>
                      </div>
                      <div className="rounded-md border border-violet-600/25 bg-violet-50/40 dark:bg-violet-950/20 p-3 space-y-2">
                        <Label>Recepción (RK) para cruce por # caja</Label>
                        <Select
                          value={receptionScopeId || '__none__'}
                          onValueChange={(v) => {
                            const next = v === '__none__' ? '' : v;
                            setReceptionScopeId(next);
                            persistReceptionScope(next);
                            // Sugerencia flexible: cruce recepción → ya etiquetada (se puede quitar).
                            if (next) setEtiquetadoModo('ya_etiquetada');
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                loadingReceptionOptions ? 'Cargando recepciones…' : 'Seleccione RK / recepción'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sin recepción (solo TF / catálogo)</SelectItem>
                            {receptionOptions.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.rk}
                                {o.supplier ? ` · ${o.supplier}` : ''} · {o.status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Obligatorio si va a digitar solo el número de caja. No modifica el módulo de recepción.
                        </p>
                      </div>
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

                      {receptionCandidates.length > 0 ? (
                        <div className="rounded-md border border-amber-600/30 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
                          <div className="font-semibold">
                            Elija la recepción (caja #{receptionCandidates[0]?.unitNumber})
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Al elegir la RK la unidad queda confirmada (un solo paso).
                          </p>
                          <div className="space-y-2">
                            {receptionCandidates.map((c) => (
                              <button
                                key={c.packingUnitId || `${c.receptionOperationId}-${c.scanCode}`}
                                type="button"
                                disabled={confirmingCandidate || !!openPause}
                                className="w-full text-left rounded-md border bg-background px-3 py-2 text-sm hover:border-sky-600/50 disabled:opacity-60"
                                onClick={() => void handleConfirmReceptionCandidate(c)}
                              >
                                <div className="font-semibold flex flex-wrap items-center gap-2">
                                  RK {c.rkIdentifier || c.receptionOperationId || '—'}
                                  {c.yaEtiquetada ? (
                                    <Badge className="bg-emerald-500/15 text-emerald-900">Ya etiquetada</Badge>
                                  ) : (
                                    <Badge variant="outline">Sin confirmar en etiquetado</Badge>
                                  )}
                                </div>
                                <div className="text-muted-foreground text-xs mt-0.5">
                                  Ref {c.referencia || c.numeroTF} · cant. {c.cantidad}
                                  {c.talla ? ` · talla ${c.talla}` : ''}
                                </div>
                              </button>
                            ))}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={confirmingCandidate}
                            onClick={() => setReceptionCandidates([])}
                          >
                            Cancelar
                          </Button>
                          {confirmingCandidate ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Confirmando…
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">Unidades del turno</CardTitle>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={repairingQtys || !shift?.id}
                        onClick={() => void handleRepairShiftReceptionQtys()}
                      >
                        {repairingQtys ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : null}
                        Corregir cant. recepción en 0
                      </Button>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Código</TableHead>
                            <TableHead>Destino</TableHead>
                            <TableHead className="text-right">Cant.</TableHead>
                            <TableHead>Etiquetado</TableHead>
                            <TableHead>Inicio</TableHead>
                            <TableHead>Fin</TableHead>
                            <TableHead>Neto</TableHead>
                            <TableHead>Estado</TableHead>
                            {canAdmin ? <TableHead className="text-right">Admin</TableHead> : null}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {units.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={canAdmin ? 9 : 8}
                                className="text-center text-muted-foreground py-6"
                              >
                                Sin unidades aún.
                              </TableCell>
                            </TableRow>
                          ) : (
                            units.map((u) => (
                              <TableRow key={u.id}>
                                <TableCell className="font-mono text-xs">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span>{u.scanCode}</span>
                                    {u.source === 'recepcion' ? (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                                        Rec #{u.unitNumber ?? u.scanCode}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="text-muted-foreground">{displayTalladoMarca(u)}</div>
                                </TableCell>
                                <TableCell>{u.bodegaDestino}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <div className="flex flex-col items-end gap-1">
                                    <span className={Number(u.cantidad) <= 0 ? 'text-destructive font-semibold' : ''}>
                                      {u.cantidad}
                                    </span>
                                    {u.source === 'recepcion' && Number(u.cantidad) <= 0 ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={updatingUnitId === u.id}
                                        onClick={() => void handleRepairUnitQty(u.id)}
                                      >
                                        {updatingUnitId === u.id ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          'Corregir'
                                        )}
                                      </Button>
                                    ) : null}
                                    {canAdmin ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-xs px-2"
                                        disabled={updatingUnitId === u.id}
                                        onClick={() => void handleAdminEditUnitCantidad(u)}
                                      >
                                        Editar cant.
                                      </Button>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={u.etiquetadoModo || '__normal__'}
                                    onValueChange={(v) => {
                                      const next =
                                        v === '__normal__'
                                          ? null
                                          : (v as TalladoEtiquetadoModo);
                                      void handleUpdateUnitEtiquetado(u.id, next);
                                    }}
                                    disabled={updatingUnitId === u.id}
                                  >
                                    <SelectTrigger className="h-8 w-[150px] text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__normal__">Normal</SelectItem>
                                      <SelectItem value="ya_etiquetada">Ya etiquetada</SelectItem>
                                      <SelectItem value="tallar_y_etiquetar">Tallar y etiquetar</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="tabular-nums text-xs">{fmtClock(u.startedAt)}</TableCell>
                                <TableCell className="tabular-nums text-xs">{fmtClock(u.endedAt)}</TableCell>
                                <TableCell className="text-xs">{fmtDuration(u.durationNetMs ?? u.durationMs)}</TableCell>
                                <TableCell>
                                  {u.status === 'done' ? (
                                    <Badge variant="secondary">Fin</Badge>
                                  ) : (
                                    <Badge className="bg-amber-500/20 text-amber-900">En curso</Badge>
                                  )}
                                </TableCell>
                                {canAdmin ? (
                                  <TableCell className="text-right">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                      title="Eliminar registro"
                                      disabled={updatingUnitId === u.id}
                                      onClick={() => void handleAdminDeleteUnit(u)}
                                    >
                                      {updatingUnitId === u.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TableCell>
                                ) : null}
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
                            <TableCell className="text-sm">{displayTalladoMarca(u)}</TableCell>
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
                <CardDescription>
                  Si el turno se abrió con mal número de personas, corríjalo aquí para recalcular u/persona·h.
                </CardDescription>
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
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveShifts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          Sin turnos hoy.
                        </TableCell>
                      </TableRow>
                    ) : (
                      liveShifts.map((s) => {
                        const actives = liveActiveUnits.filter((u) => u.shiftId === s.id).length;
                        const draft = peopleDrafts[s.id] ?? s.peopleCount;
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
                            <TableCell>
                              <Input
                                type="number"
                                min={1}
                                className="h-8 w-20 tabular-nums"
                                value={draft}
                                onChange={(e) =>
                                  setPeopleDrafts((prev) => ({
                                    ...prev,
                                    [s.id]: Math.max(1, Number(e.target.value) || 1),
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell className="tabular-nums text-xs">{fmtClock(s.startedAt)}</TableCell>
                            <TableCell className="text-xs">{s.userName}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold text-amber-700">
                              {actives}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={savingPeopleId === s.id || draft === s.peopleCount}
                                onClick={() => void handleAdminUpdatePeople(s.id, draft)}
                              >
                                {savingPeopleId === s.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  'Guardar'
                                )}
                              </Button>
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
                <Label className="text-xs">Fecha</Label>
                <Input
                  type="date"
                  className="h-9 w-[160px]"
                  value={dashDayKey}
                  onChange={(e) => setDashDayKey(e.target.value || talladoLocalDayKey())}
                />
              </div>
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
              <Button type="button" variant="outline" size="sm" onClick={() => void handleExcelDiaConsolidado()}>
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                Excel día consolidado
              </Button>
              <Button type="button" variant="outline" disabled={dashLoading} onClick={() => void loadDashboard()}>
                {dashLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Actualizar
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Mostrando solo el día <span className="font-semibold text-foreground">{dashDayKey}</span> (Colombia).
              Bodega LIVE siempre usa el día de hoy.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Cantidad cerrada ({dashDayKey})</CardDescription>
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
                  <CardDescription>Jornada neta / pausas</CardDescription>
                  <CardTitle className="text-lg tabular-nums">
                    {fmtDuration(dashStats.netMs)} · {fmtDuration(dashStats.pauseMs)}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground pt-1">{dashStats.formulaLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    No es suma de cajas ({fmtDuration(dashStats.boxNetMs)}).
                  </p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardDescription>Rendimiento neto (cant / persona·h)</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{dashStats.perPersonHour.toFixed(1)}</CardTitle>
                  <p className="text-xs text-muted-foreground pt-1">
                    {dashStats.qty.toLocaleString()} und ÷ {dashStats.personHours.toFixed(2)} persona·h
                    ({dashStats.peopleTotal || 0} pers.)
                  </p>
                </CardHeader>
              </Card>
            </div>

            {dashStats.shiftRows.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Cómo se calcula la jornada / hora de inicio</CardTitle>
                  <CardDescription>
                    Prioridad: 1) hora fijada por admin · 2) primera lectura del día · 3) inicio del turno.
                    Puede corregir la hora real aquí; los KPIs y Bodega LIVE se recalculan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grupo</TableHead>
                        <TableHead>Personas</TableHead>
                        <TableHead>Origen</TableHead>
                        <TableHead>Inicio usado</TableHead>
                        <TableHead>Fin</TableHead>
                        <TableHead className="text-right">Jornada</TableHead>
                        <TableHead className="text-right">Persona·h</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashStats.shiftRows.map((r) => (
                        <TableRow key={r.shiftId}>
                          <TableCell className="font-medium">{r.grupo}</TableCell>
                          <TableCell className="tabular-nums">{r.people}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{START_SOURCE_LABEL[r.startSource]}</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">{r.startClock}</TableCell>
                          <TableCell className="tabular-nums">{r.endClock}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(r.workedMs)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.personHours.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="space-y-3 border-t pt-3">
                    {dashShifts.map((s) => {
                      const draft =
                        startDrafts[s.id] ??
                        isoToDatetimeLocalBogota(s.productivityStartedAt) ??
                        isoToDatetimeLocalBogota(
                          firstUnitStartIsoForShift(dashUnits, s.id, dashDayKey, s.grupo) || undefined
                        );
                      return (
                        <div
                          key={`start-${s.id}`}
                          className="flex flex-wrap items-end gap-2 rounded-lg border p-3 bg-muted/20"
                        >
                          <div className="min-w-[120px]">
                            <div className="text-sm font-semibold">{s.grupo}</div>
                            <div className="text-xs text-muted-foreground">{s.userName}</div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Hora real de inicio</Label>
                            <Input
                              type="datetime-local"
                              className="h-9 w-[210px]"
                              value={draft || ''}
                              onChange={(e) =>
                                setStartDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={savingStartId === s.id || !draft}
                            onClick={() => void handleAdminUpdateStart(s.id, 'save')}
                          >
                            {savingStartId === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Guardar inicio'
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={savingStartId === s.id}
                            onClick={() => void handleAdminUpdateStart(s.id, 'first_unit')}
                          >
                            Usar 1ª lectura
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={savingStartId === s.id}
                            onClick={() => void handleAdminUpdateStart(s.id, 'clear')}
                          >
                            Quitar fijo
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : null}

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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Corregir personas / cerrar o eliminar turno</CardTitle>
                <CardDescription>
                  Ajuste personas si el turno se inició mal. Cerrar quita el reingreso del día. Eliminar borra el
                  turno y sus unidades de tallado (no toca recepción).
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Estado</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Operario</TableHead>
                      <TableHead>Personas</TableHead>
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashShifts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          Sin turnos hoy.
                        </TableCell>
                      </TableRow>
                    ) : (
                      dashShifts.map((s) => {
                        const draft = peopleDrafts[s.id] ?? s.peopleCount;
                        const busy = deletingShiftId === s.id || savingPeopleId === s.id;
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
                            <TableCell className="text-xs">{s.userName}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={1}
                                className="h-8 w-20 tabular-nums"
                                value={draft}
                                onChange={(e) =>
                                  setPeopleDrafts((prev) => ({
                                    ...prev,
                                    [s.id]: Math.max(1, Number(e.target.value) || 1),
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy || draft === s.peopleCount}
                                  onClick={() => void handleAdminUpdatePeople(s.id, draft)}
                                >
                                  {savingPeopleId === s.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Users className="mr-1.5 h-3.5 w-3.5" />
                                      Guardar
                                    </>
                                  )}
                                </Button>
                                {s.status === 'active' ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void handleAdminCloseShift(s.id)}
                                  >
                                    Cerrar
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  disabled={busy}
                                  onClick={() => void handleAdminDeleteShift(s.id)}
                                >
                                  {deletingShiftId === s.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                                      Eliminar
                                    </>
                                  )}
                                </Button>
                              </div>
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
      </Tabs>
    </div>
  );
}
