/** @jsxImportSource react */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle, Clock } from 'lucide-react';
import { formatDateTimeBogota } from '@/lib/dateTimeBogota';
import {
  getReceptionIdleJustifications,
  saveReceptionIdleJustifications,
} from '@/app/reception/actions';
import { showError, showSuccess } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth-context';
import type {
  JustificationType,
  ReceptionIdleJustificationEntry,
  ReceptionIdleJustifications,
  ReceptionIdleTimeDetail,
} from '@/types';

interface IdleTimeReportData {
  reception_id: string;
  rk_identifier: string;
  total_idle_time_minutes: number;
  details: ReceptionIdleTimeDetail[];
}

interface IdleTimeDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: IdleTimeReportData | null;
}

const JUSTIFICATION_PRESETS: { label: string; type: JustificationType }[] = [
  { label: 'Desayuno', type: 'BREAKFAST' },
  { label: 'Almuerzo', type: 'LUNCH' },
  { label: 'Refrigerio', type: 'SNACK' },
  { label: 'Fin de jornada', type: 'SHIFT_END' },
  { label: 'Otra actividad', type: 'REASON' },
];

function getJustifiedMinutes(
  detail: ReceptionIdleTimeDetail,
  entry?: ReceptionIdleJustificationEntry
): number {
  if (!entry) return 0;
  return entry.customDuration ?? detail.idle_duration_minutes;
}

const IdleTimeDetailsDialog: React.FC<IdleTimeDetailsDialogProps> = ({ open, onOpenChange, report }) => {
  const { role } = useAuth();
  const canJustify = role === 'admin';

  const [justifications, setJustifications] = useState<ReceptionIdleJustifications>({});
  const [loadingJustifications, setLoadingJustifications] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userFilter, setUserFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'justified' | 'unjustified'>('all');

  const [justifyOpen, setJustifyOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<ReceptionIdleTimeDetail | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>(JUSTIFICATION_PRESETS[4].label);
  const [customReason, setCustomReason] = useState('');

  const loadJustifications = useCallback(async () => {
    if (!report?.reception_id) return;
    setLoadingJustifications(true);
    const result = await getReceptionIdleJustifications(report.reception_id);
    if (result.success) {
      setJustifications(result.data || {});
    } else {
      showError('Error al cargar justificaciones', result.error);
    }
    setLoadingJustifications(false);
  }, [report?.reception_id]);

  useEffect(() => {
    if (open && report?.reception_id) {
      loadJustifications();
      setUserFilter('all');
      setStatusFilter('all');
    }
  }, [open, report?.reception_id, loadJustifications]);

  const usersInReport = useMemo(() => {
    if (!report) return [];
    const map = new Map<string, string>();
    report.details.forEach(d => map.set(d.userId, d.userName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [report]);

  const filteredDetails = useMemo(() => {
    if (!report) return [];
    return report.details.filter(detail => {
      if (userFilter !== 'all' && detail.userId !== userFilter) return false;
      const isJustified = !!justifications[detail.id];
      if (statusFilter === 'justified' && !isJustified) return false;
      if (statusFilter === 'unjustified' && isJustified) return false;
      return true;
    });
  }, [report, userFilter, statusFilter, justifications]);

  const summary = useMemo(() => {
    if (!report) return { total: 0, justified: 0, unjustified: 0 };
    let justified = 0;
    report.details.forEach(detail => {
      const entry = justifications[detail.id];
      if (entry) justified += getJustifiedMinutes(detail, entry);
    });
    const total = report.total_idle_time_minutes;
    return {
      total,
      justified,
      unjustified: Math.max(0, total - justified),
    };
  }, [report, justifications]);

  const persistJustifications = async (next: ReceptionIdleJustifications) => {
    if (!report?.reception_id) return;
    setSaving(true);
    const result = await saveReceptionIdleJustifications(report.reception_id, next);
    if (result.success) {
      setJustifications(next);
      showSuccess('Justificación guardada');
    } else {
      showError('No se pudo guardar', result.error);
    }
    setSaving(false);
  };

  const handleOpenJustify = (detail: ReceptionIdleTimeDetail) => {
    setSelectedDetail(detail);
    const existing = justifications[detail.id];
    if (existing) {
      const preset = JUSTIFICATION_PRESETS.find(p => p.type === existing.type);
      setSelectedPreset(preset?.label || JUSTIFICATION_PRESETS[4].label);
      setCustomReason(existing.reasonText || '');
    } else {
      setSelectedPreset(JUSTIFICATION_PRESETS[4].label);
      setCustomReason('');
    }
    setJustifyOpen(true);
  };

  const handleConfirmJustify = async () => {
    if (!selectedDetail || !report) return;
    const preset = JUSTIFICATION_PRESETS.find(p => p.label === selectedPreset) || JUSTIFICATION_PRESETS[4];
    const reasonText = preset.type === 'REASON'
      ? (customReason.trim() || 'Otra actividad')
      : preset.label;

    const entry: ReceptionIdleJustificationEntry = {
      type: preset.type,
      reasonText,
      fromMs: selectedDetail.from_ms,
      toMs: selectedDetail.to_ms,
      userId: selectedDetail.userId,
    };

    const next = { ...justifications, [selectedDetail.id]: entry };
    await persistJustifications(next);
    setJustifyOpen(false);
    setSelectedDetail(null);
  };

  const handleRemoveJustification = async (detailId: string) => {
    const next = { ...justifications };
    delete next[detailId];
    await persistJustifications(next);
  };

  if (!report) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalles de Tiempo Muerto — RK: {report.rk_identifier}</DialogTitle>
            <DialogDescription>
              Horas en zona Colombia (America/Bogota).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm text-muted-foreground -mt-2">
            <p>
              Total: {summary.total.toFixed(2)} min · Justificado: {summary.justified.toFixed(2)} min ·
              Sin justificar: {summary.unjustified.toFixed(2)} min
            </p>
            {canJustify && (
              <p className="text-xs">
                Los tiempos muertos justificados se descuentan del tiempo efectivo en el reporte de productividad.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 py-2">
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los usuarios</SelectItem>
                {usersInReport.map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="unjustified">Sin justificar</SelectItem>
                <SelectItem value="justified">Justificados</SelectItem>
              </SelectContent>
            </Select>
            {loadingJustifications && (
              <span className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando justificaciones…
              </span>
            )}
          </div>

          <div className="py-2">
            {filteredDetails.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">
                No hay tiempos muertos para los filtros seleccionados.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Desde</TableHead>
                      <TableHead>Hasta</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead className="text-right">Duración (min)</TableHead>
                      <TableHead>Estado</TableHead>
                      {canJustify && <TableHead className="text-right">Acción</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDetails.map(detail => {
                      const entry = justifications[detail.id];
                      const isJustified = !!entry;
                      return (
                        <TableRow key={detail.id}>
                          <TableCell className="whitespace-nowrap">{formatDateTimeBogota(detail.from_ms)}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDateTimeBogota(detail.to_ms)}</TableCell>
                          <TableCell>{detail.userName}</TableCell>
                          <TableCell className="text-right">{detail.idle_duration_minutes.toFixed(2)}</TableCell>
                          <TableCell>
                            {isJustified ? (
                              <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">
                                <CheckCircle className="mr-1 h-3 w-3" />
                                {entry.reasonText || entry.type}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/30">
                                <Clock className="mr-1 h-3 w-3" />
                                Sin justificar
                              </Badge>
                            )}
                          </TableCell>
                          {canJustify && (
                            <TableCell className="text-right space-x-2">
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0"
                                disabled={saving}
                                onClick={() => handleOpenJustify(detail)}
                              >
                                {isJustified ? 'Editar' : 'Justificar'}
                              </Button>
                              {isJustified && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-destructive"
                                  disabled={saving}
                                  onClick={() => handleRemoveJustification(detail.id)}
                                >
                                  Quitar
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={justifyOpen} onOpenChange={setJustifyOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Justificar tiempo muerto</DialogTitle>
            <DialogDescription>
              {selectedDetail && (
                <>
                  {selectedDetail.userName}: {formatDateTimeBogota(selectedDetail.from_ms)} →{' '}
                  {formatDateTimeBogota(selectedDetail.to_ms)} ({selectedDetail.idle_duration_minutes.toFixed(2)} min)
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JUSTIFICATION_PRESETS.map(p => (
                    <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPreset === 'Otra actividad' && (
              <div className="space-y-2">
                <Label>Detalle (opcional)</Label>
                <Input
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Ej. reunión, avería, descargue…"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJustifyOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmJustify} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar justificación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default IdleTimeDetailsDialog;
