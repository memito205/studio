'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { loadVerificationSessions } from '@/app/actions';
import type { SavedVerification } from '@/types';
import {
  getDuplicateTfAlerts,
  groupDuplicateAlertsBySession,
  lastHitDate,
  uniqueSessionCount,
  type DuplicateTfAlert,
} from './utils/duplicateVerifications';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type DatePreset = '7' | '15' | '30' | '90' | 'all';
type ViewMode = 'por-tf' | 'por-sesion';

const sessionCreatedAt = (session: SavedVerification): Date | null => {
  if (session.createdAt instanceof Date && !Number.isNaN(session.createdAt.getTime())) {
    return session.createdAt;
  }
  const parsed = new Date(session.createdAt as unknown as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function DuplicateVerificationAlerts() {
  const [sessions, setSessions] = useState<SavedVerification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('30');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('por-tf');
  const [expandedTfs, setExpandedTfs] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: err } = await loadVerificationSessions();
    if (err) setError(err);
    else setSessions(data || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const applyPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    setStartDate('');
    setEndDate('');
    setExpandedTfs(new Set());
    setExpandedSessions(new Set());
  };

  const rangedSessions = useMemo(() => {
    if (datePreset === 'all' && !startDate && !endDate) return sessions;

    let from: Date | null = null;
    let to: Date | null = null;

    if (startDate) from = startOfDay(new Date(startDate + 'T00:00:00'));
    if (endDate) to = endOfDay(new Date(endDate + 'T00:00:00'));

    if (!from && !to && datePreset !== 'all') {
      const days = Number(datePreset);
      from = startOfDay(subDays(new Date(), days));
      to = endOfDay(new Date());
    }

    return sessions.filter((session) => {
      const at = sessionCreatedAt(session);
      if (!at) return false;
      if (from && at < from) return false;
      if (to && at > to) return false;
      return true;
    });
  }, [sessions, datePreset, startDate, endDate]);

  const alerts = useMemo(() => getDuplicateTfAlerts(rangedSessions), [rangedSessions]);

  const filteredAlerts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return alerts;
    return alerts.filter((a) => {
      if (a.tfKey.toLowerCase().includes(q)) return true;
      return a.hits.some(
        (h) =>
          h.sessionName.toLowerCase().includes(q) ||
          h.destino.toLowerCase().includes(q) ||
          h.codigo.toLowerCase().includes(q)
      );
    });
  }, [alerts, filter]);

  const sessionGroups = useMemo(
    () => groupDuplicateAlertsBySession(filteredAlerts),
    [filteredAlerts]
  );

  const toggleTf = (tfKey: string) => {
    setExpandedTfs((prev) => {
      const next = new Set(prev);
      if (next.has(tfKey)) next.delete(tfKey);
      else next.add(tfKey);
      return next;
    });
  };

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const dateHint =
    datePreset === 'all' && !startDate && !endDate
      ? 'Todas las sesiones'
      : startDate || endDate
        ? `Rango ${startDate || '…'} → ${endDate || 'hoy'}`
        : `Últimos ${datePreset} días`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              TF en múltiples validaciones
            </CardTitle>
            <CardDescription className="mt-1">
              Lista compacta de TFs que aparecen en dos o más sesiones. Expanda una fila para ver en
              qué validaciones salió. Use fechas recientes para no saturar la vista.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchSessions()} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualizar
          </Button>
        </div>

        <div className="pt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Periodo:</span>
            {(['7', '15', '30', '90'] as DatePreset[]).map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={datePreset === p && !startDate && !endDate ? 'default' : 'outline'}
                className="h-8"
                onClick={() => applyPreset(p)}
              >
                {p} días
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={datePreset === 'all' && !startDate && !endDate ? 'default' : 'outline'}
              className="h-8"
              onClick={() => applyPreset('all')}
            >
              Todas
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Desde</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDatePreset('all');
                  setExpandedTfs(new Set());
                  setExpandedSessions(new Set());
                }}
                className="w-[160px] h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Hasta</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDatePreset('all');
                  setExpandedTfs(new Set());
                  setExpandedSessions(new Set());
                }}
                className="w-[160px] h-9"
              />
            </div>
            <Input
              placeholder="Filtrar por TF, sesión, destino o código..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-md h-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
            Cargando sesiones...
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="mb-3">
              <TabsTrigger value="por-tf">Por TF</TabsTrigger>
              <TabsTrigger value="por-sesion">Por validación</TabsTrigger>
            </TabsList>

            <p className="text-sm text-muted-foreground mb-3">
              {dateHint}
              {' · '}
              {rangedSessions.length} sesión(es) en el periodo
              {' · '}
              {filteredAlerts.length} TF(s) repetida(s)
              {filter ? ' con el filtro' : ''}
            </p>

            <TabsContent value="por-tf" className="mt-0">
              {filteredAlerts.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No hay transferencias repetidas en este periodo
                  {filter ? ' con ese filtro' : ''}.
                </p>
              ) : (
                <div className="max-h-[70vh] overflow-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>TF</TableHead>
                        <TableHead>Destinos</TableHead>
                        <TableHead>Última sesión</TableHead>
                        <TableHead># Sesiones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAlerts.map((alert: DuplicateTfAlert) => {
                        const destinos = Array.from(new Set(alert.hits.map((h) => h.destino).filter(Boolean)));
                        const sessionsN = uniqueSessionCount(alert.hits);
                        const last = lastHitDate(alert.hits);
                        const open = expandedTfs.has(alert.tfKey);
                        return (
                          <React.Fragment key={alert.tfKey}>
                            <TableRow className="bg-amber-50/40">
                              <TableCell className="py-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => toggleTf(alert.tfKey)}
                                  title={open ? 'Ocultar sesiones' : 'Ver sesiones'}
                                >
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                              <TableCell className="font-bold font-mono">{alert.tfKey}</TableCell>
                              <TableCell className="text-sm">{destinos.join(', ') || 'N/D'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {last ? format(last, 'dd/MM/yy') : 'N/D'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="destructive">{sessionsN}</Badge>
                              </TableCell>
                            </TableRow>
                            {open && (
                              <TableRow>
                                <TableCell colSpan={5} className="bg-muted/40 py-3">
                                  <p className="text-xs font-medium mb-2 px-2">Sesiones donde se validó</p>
                                  <div className="grid gap-1.5 px-2">
                                    {alert.hits.map((h) => (
                                      <div key={`${alert.tfKey}-${h.sessionId}`} className="text-xs">
                                        <span className="font-medium">{h.sessionName}</span>
                                        <span className="text-muted-foreground">
                                          {' · '}
                                          {h.sessionStatus || 'N/D'}
                                          {h.sessionCreatedAt ? ` · ${format(h.sessionCreatedAt, 'dd/MM/yy')}` : ''}
                                          {h.scanned ? ' · leída' : ' · pendiente'}
                                          {h.destino ? ` · ${h.destino}` : ''}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="por-sesion" className="mt-0">
              {sessionGroups.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No hay validaciones con TFs repetidas en este periodo
                  {filter ? ' con ese filtro' : ''}.
                </p>
              ) : (
                <div className="max-h-[70vh] overflow-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Validación</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>TFs repetidas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessionGroups.map((group) => {
                        const open = expandedSessions.has(group.sessionId);
                        return (
                          <React.Fragment key={group.sessionId}>
                            <TableRow>
                              <TableCell className="py-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => toggleSession(group.sessionId)}
                                  title={open ? 'Ocultar TFs' : 'Ver TFs'}
                                >
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium">{group.sessionName}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {group.sessionCreatedAt ? format(group.sessionCreatedAt, 'dd/MM/yy') : 'N/D'}
                              </TableCell>
                              <TableCell className="text-sm">{group.sessionStatus || 'N/D'}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{group.tfs.length}</Badge>
                              </TableCell>
                            </TableRow>
                            {open && (
                              <TableRow>
                                <TableCell colSpan={5} className="bg-muted/40 py-3">
                                  <p className="text-xs font-medium mb-2 px-2">
                                    TFs de esta validación que también salen en otras
                                  </p>
                                  <div className="grid gap-1 px-2">
                                    {group.tfs.map((t) => (
                                      <div key={`${group.sessionId}-${t.tfKey}`} className="text-xs flex flex-wrap gap-x-2">
                                        <span className="font-mono font-bold">{t.tfKey}</span>
                                        <span className="text-muted-foreground">
                                          {t.destinos.join(', ') || 'N/D'} · {t.sessionCount} sesiones
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
