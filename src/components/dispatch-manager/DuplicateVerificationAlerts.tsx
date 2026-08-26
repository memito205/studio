'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { loadVerificationSessions } from '@/app/actions';
import type { SavedVerification } from '@/types';
import { getDuplicateTfAlerts, type DuplicateTfAlert } from './utils/duplicateVerifications';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export default function DuplicateVerificationAlerts() {
  const [sessions, setSessions] = useState<SavedVerification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

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

  const alerts = useMemo(() => getDuplicateTfAlerts(sessions), [sessions]);

  const filtered = useMemo(() => {
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
              Transferencias que aparecen en dos o más sesiones de verificación. Suele indicar que no se
              despacharon en la primera oportunidad y conviene revisarlas.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchSessions()} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualizar
          </Button>
        </div>
        <div className="pt-2">
          <Input
            placeholder="Filtrar por TF, sesión, destino o código..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-md"
          />
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
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No hay transferencias repetidas entre validaciones
            {filter ? ' con ese filtro' : ''}.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {filtered.length} TF(s) en más de una validación
            </p>
            <div className="max-h-[70vh] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TF</TableHead>
                    <TableHead>Destinos</TableHead>
                    <TableHead>Validaciones</TableHead>
                    <TableHead># Sesiones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((alert: DuplicateTfAlert) => {
                    const destinos = Array.from(new Set(alert.hits.map((h) => h.destino).filter(Boolean)));
                    return (
                      <TableRow key={alert.tfKey} className="bg-amber-50/40">
                        <TableCell className="font-bold font-mono">{alert.tfKey}</TableCell>
                        <TableCell className="text-sm">{destinos.join(', ') || 'N/D'}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5 py-1">
                            {alert.hits.map((h) => (
                              <div key={`${alert.tfKey}-${h.sessionId}`} className="text-xs">
                                <span className="font-medium">{h.sessionName}</span>
                                <span className="text-muted-foreground">
                                  {' · '}
                                  {h.sessionStatus || 'N/D'}
                                  {h.sessionCreatedAt
                                    ? ` · ${format(h.sessionCreatedAt, 'dd/MM/yy')}`
                                    : ''}
                                  {h.scanned ? ' · leída' : ' · pendiente'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive">{new Set(alert.hits.map((h) => h.sessionId)).size}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
