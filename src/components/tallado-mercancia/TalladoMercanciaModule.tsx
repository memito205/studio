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
} from 'lucide-react';
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
  listTalladoShiftBundle,
  resumeTalladoPause,
  scanTalladoCode,
  startTalladoPause,
  startTalladoShift,
  startTalladoUnit,
  updateTalladoShiftPeople,
} from '@/app/talladoMercanciaActions';
import {
  downloadTalladoDayConsolidatedPdf,
  downloadTalladoHourlyPdf,
  downloadTalladoReportPdf,
  localHourFromIso,
} from '@/lib/talladoMercanciaPdf';
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

export function TalladoMercanciaModule({ onReturnToSuite }: TalladoMercanciaModuleProps) {
  const { toast } = useToast();
  const { user, role } = useAuth() as { user: any; role?: string };
  const canAdmin = role === 'admin' || role === 'supervisor';
  const scanRef = useRef<HTMLInputElement>(null);

  const [mainTab, setMainTab] = useState<'operario' | 'admin'>(canAdmin ? 'operario' : 'operario');
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

  const openPause = useMemo(() => pauses.find((p) => p.status === 'open') || null, [pauses]);
  const inProgress = useMemo(() => units.filter((u) => u.status === 'in_progress'), [units]);
  const doneUnits = useMemo(() => units.filter((u) => u.status === 'done'), [units]);
  const hourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` })),
    []
  );

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
    if (shift && !openPause) {
      const t = setTimeout(() => scanRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [shift, openPause, pendingLookup]);

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
    toast({ title: 'Turno iniciado', description: `${res.data.grupo} · ${res.data.peopleCount} persona(s)` });
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
      setScanning(true);
      const res = await scanTalladoCode({
        shiftId: shift.id,
        rawCode: code,
        userId: user.uid,
        userName: user.displayName || user.email || 'Operario',
        grupo: shift.grupo,
        autoStart: false,
      });
      setScanning(false);
      setScanCode('');
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Escaneo', description: res.error });
        setPendingLookup(null);
        return;
      }
      if (res.action === 'finished') {
        setPendingLookup(null);
        toast({
          title: 'Fin registrado',
          description: `${res.unit?.scanCode} · neto ${fmtDuration(res.unit?.durationNetMs)}`,
        });
        await refreshShift(shift.id);
        return;
      }
      if (res.lookup) {
        setPendingLookup(res.lookup);
        toast({ title: 'TF encontrada', description: 'Confirme Inicio para registrar el comienzo.' });
      }
    },
    [shift, user, openPause, toast, refreshShift]
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
    toast({ title: 'Inicio', description: `${res.data?.scanCode} · cant. ${res.data?.cantidad}` });
    await refreshShift(shift.id);
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

  useEffect(() => {
    if (mainTab === 'admin' && canAdmin) void loadDashboard();
  }, [mainTab, canAdmin, loadDashboard]);

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
    <div className="space-y-4 p-3 sm:p-5">
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
              Escanee Número TF o Código Alterno de transferencias. Inicio / Fin por unidad. Pausas colectivas no
              castigan el rendimiento neto.
            </p>
          </div>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'operario' | 'admin')}>
        <TabsList>
          <TabsTrigger value="operario">
            <PlayCircle className="mr-1.5 h-4 w-4" />
            Operario
          </TabsTrigger>
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
                          disabled={!!openPause || scanning}
                          autoComplete="off"
                          inputMode="text"
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
                          <div className="font-semibold">
                            {pendingLookup.matchedBy === 'codigoAlterno' ? 'Código alterno' : 'Número TF'}:{' '}
                            {pendingLookup.scanCode}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">TF</span>
                              <div className="font-semibold">{pendingLookup.numeroTF}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Destino</span>
                              <div className="font-semibold">{pendingLookup.bodegaDestino}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Marca</span>
                              <div className="font-semibold">{pendingLookup.marca || '—'}</div>
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
