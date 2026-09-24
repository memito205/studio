'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, RefreshCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import type { TalladoCyclicAggLine, TalladoUnit } from '@/types';
import {
  confirmTalladoManualFromCyclic,
  getTalladoCyclicAggForLocation,
  getTalladoCyclicDayBundle,
  getTalladoCyclicLocationsForReference,
} from '@/app/talladoMercanciaActions';
import { talladoLocalDayKey } from '@/lib/talladoProductivity';

type PathMode = 'ubicacion' | 'referencia';

type DraftQty = Record<string, string>;

function lineKey(l: Pick<TalladoCyclicAggLine, 'reference' | 'location'>): string {
  return `${String(l.reference || '').trim().toUpperCase()}|${String(l.location || '').trim()}`;
}

function filterSuggestions(options: string[], query: string, limit = 25): string[] {
  const q = String(query || '')
    .trim()
    .toUpperCase();
  if (!q) return options.slice(0, limit);
  return options.filter((o) => o.toUpperCase().includes(q)).slice(0, limit);
}

export function TalladoCyclicLocationPanel(props: {
  shiftId: string;
  grupo: string;
  userId: string;
  userName: string;
  disabled?: boolean;
  onConfirmed: (unit: TalladoUnit) => void;
}) {
  const { toast } = useToast();
  const inventoryDate = talladoLocalDayKey();
  const [pathMode, setPathMode] = useState<PathMode>('ubicacion');
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [locations, setLocations] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);

  const [locQuery, setLocQuery] = useState('');
  const [refQuery, setRefQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedRef, setSelectedRef] = useState('');
  const [highlightRef, setHighlightRef] = useState('');

  const [locSuggestionsOpen, setLocSuggestionsOpen] = useState(false);
  const [refSuggestionsOpen, setRefSuggestionsOpen] = useState(false);
  const [refLocOptions, setRefLocOptions] = useState<{ location: string; expectedQtyAgg: number }[]>([]);

  const [aggLines, setAggLines] = useState<TalladoCyclicAggLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [draftQty, setDraftQty] = useState<DraftQty>({});
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    setLoadingIndex(true);
    try {
      const res = await getTalladoCyclicDayBundle(inventoryDate);
      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Inventario cíclico',
          description: res.error || 'No se pudo cargar el día.',
        });
        setLocations([]);
        setReferences([]);
        return;
      }
      setLocations(res.locations || []);
      setReferences(res.references || []);
    } finally {
      setLoadingIndex(false);
    }
  }, [inventoryDate, toast]);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  const locSuggestions = useMemo(
    () => filterSuggestions(locations, locQuery),
    [locations, locQuery]
  );
  const refSuggestions = useMemo(
    () => filterSuggestions(references, refQuery),
    [references, refQuery]
  );

  const resetLines = () => {
    setAggLines([]);
    setDraftQty({});
    setHighlightRef('');
  };

  const loadLocationLines = async (location: string, highlight?: string) => {
    const loc = String(location || '').trim();
    if (!loc) return;
    setLoadingLines(true);
    resetLines();
    try {
      const res = await getTalladoCyclicAggForLocation({ inventoryDate, location: loc });
      if (!res.success || !res.lines) {
        toast({
          variant: 'destructive',
          title: 'Ubicación',
          description: res.error || 'Sin líneas.',
        });
        return;
      }
      setSelectedLocation(res.location || loc);
      setLocQuery(res.location || loc);
      setAggLines(res.lines);
      const next: DraftQty = {};
      for (const l of res.lines) {
        next[lineKey(l)] = String(l.expectedQtyAgg);
      }
      setDraftQty(next);
      if (highlight) setHighlightRef(String(highlight).trim().toUpperCase());
    } finally {
      setLoadingLines(false);
    }
  };

  const pickLocation = (loc: string) => {
    setLocSuggestionsOpen(false);
    setSelectedLocation(loc);
    setLocQuery(loc);
    void loadLocationLines(loc);
  };

  const searchLocationsForRef = async (reference: string) => {
    const ref = String(reference || '').trim().toUpperCase();
    if (!ref) return;
    // Only allow refs from index (no free inventing).
    const exact = references.find((r) => r.toUpperCase() === ref);
    if (!exact) {
      toast({
        variant: 'destructive',
        title: 'Referencia',
        description: 'Elija una referencia del inventario cíclico del día (autocompletado).',
      });
      return;
    }
    setSelectedRef(exact);
    setRefQuery(exact);
    setRefSuggestionsOpen(false);
    setLoadingLines(true);
    resetLines();
    setSelectedLocation('');
    try {
      const res = await getTalladoCyclicLocationsForReference({
        inventoryDate,
        reference: exact,
      });
      if (!res.success || !res.locations) {
        toast({
          variant: 'destructive',
          title: 'Referencia',
          description: res.error || 'Sin ubicaciones.',
        });
        setRefLocOptions([]);
        return;
      }
      setRefLocOptions(res.locations);
      if (res.locations.length === 1) {
        await loadLocationLines(res.locations[0].location, exact);
      }
    } finally {
      setLoadingLines(false);
    }
  };

  const handleConfirmLine = async (line: TalladoCyclicAggLine) => {
    if (props.disabled) {
      toast({ variant: 'destructive', title: 'En pausa', description: 'Reanude antes de confirmar.' });
      return;
    }
    const key = lineKey(line);
    const raw = draftQty[key];
    const qty = Math.floor(Number(String(raw ?? '').replace(',', '.')));
    if (Number.isNaN(qty) || qty < 0) {
      toast({ variant: 'destructive', title: 'Cantidad', description: 'Ingrese un entero ≥ 0.' });
      return;
    }
    setConfirmingKey(key);
    try {
      const res = await confirmTalladoManualFromCyclic({
        shiftId: props.shiftId,
        userId: props.userId,
        userName: props.userName,
        grupo: props.grupo,
        inventoryDate,
        location: line.location,
        reference: line.reference,
        cantidad: qty,
      });
      if (!res.success || !res.data) {
        toast({ variant: 'destructive', title: 'Confirmar', description: res.error || 'Error' });
        return;
      }
      props.onConfirmed(res.data);
      toast({
        title: 'Línea confirmada',
        description: `${res.data.referencia} @ ${res.data.ubicacion} · ${res.data.cantidad} und. · Normal`,
      });
      // Remove confirmed line from local list (already tallado for day).
      setAggLines((prev) => prev.filter((l) => lineKey(l) !== key));
    } finally {
      setConfirmingKey(null);
    }
  };

  return (
    <Card className="border-teal-700/25">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Por ubicación (cíclico)</CardTitle>
            <CardDescription>
              Inventario del día <span className="font-medium text-foreground">{inventoryDate}</span>. Solo
              ubicaciones/referencias del cíclico (sin inventar). Etiquetado forzado a{' '}
              <strong>Normal</strong>. Sin tallas.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingIndex}
            onClick={() => void loadIndex()}
          >
            {loadingIndex ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={pathMode === 'ubicacion' ? 'default' : 'outline'}
            onClick={() => {
              setPathMode('ubicacion');
              setRefLocOptions([]);
              setSelectedRef('');
              setRefQuery('');
            }}
          >
            <MapPin className="mr-1.5 h-4 w-4" />
            Ubicación
          </Button>
          <Button
            type="button"
            size="sm"
            variant={pathMode === 'referencia' ? 'default' : 'outline'}
            onClick={() => {
              setPathMode('referencia');
              resetLines();
              setSelectedLocation('');
              setLocQuery('');
            }}
          >
            <Search className="mr-1.5 h-4 w-4" />
            Referencia
          </Button>
          <Badge variant="secondary" className="tabular-nums">
            {locations.length} ubic. · {references.length} refs
          </Badge>
        </div>

        {pathMode === 'ubicacion' ? (
          <div className="relative space-y-1">
            <Label>Ubicación (autocompletado)</Label>
            <Input
              value={locQuery}
              placeholder="Escriba y elija de la lista…"
              autoComplete="off"
              onFocus={() => setLocSuggestionsOpen(true)}
              onChange={(e) => {
                setLocQuery(e.target.value);
                setLocSuggestionsOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = locSuggestions[0];
                  if (first) pickLocation(first);
                }
              }}
              onBlur={() => {
                // Delay so click on suggestion registers.
                setTimeout(() => setLocSuggestionsOpen(false), 150);
              }}
            />
            {locSuggestionsOpen && locSuggestions.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
                {locSuggestions.map((loc) => (
                  <li key={loc}>
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickLocation(loc)}
                    >
                      {loc}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative space-y-1">
              <Label>Referencia (autocompletado)</Label>
              <div className="flex gap-2">
                <Input
                  value={refQuery}
                  placeholder="Escriba y elija de la lista…"
                  autoComplete="off"
                  className="flex-1"
                  onFocus={() => setRefSuggestionsOpen(true)}
                  onChange={(e) => {
                    setRefQuery(e.target.value);
                    setRefSuggestionsOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const first = refSuggestions[0];
                      if (first) void searchLocationsForRef(first);
                    }
                  }}
                  onBlur={() => setTimeout(() => setRefSuggestionsOpen(false), 150)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingLines}
                  onClick={() => void searchLocationsForRef(refQuery)}
                >
                  Buscar
                </Button>
              </div>
              {refSuggestionsOpen && refSuggestions.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
                  {refSuggestions.map((ref) => (
                    <li key={ref}>
                      <button
                        type="button"
                        className="w-full rounded-sm px-2 py-1.5 text-left font-mono text-xs hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void searchLocationsForRef(ref)}
                      >
                        {ref}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {refLocOptions.length > 1 ? (
              <div className="space-y-2">
                <Label>Elija ubicación donde está {selectedRef || 'la referencia'}</Label>
                <div className="flex flex-wrap gap-2">
                  {refLocOptions.map((o) => (
                    <Button
                      key={o.location}
                      type="button"
                      size="sm"
                      variant={selectedLocation === o.location ? 'default' : 'outline'}
                      onClick={() => void loadLocationLines(o.location, selectedRef)}
                    >
                      {o.location}
                      <span className="ml-1.5 tabular-nums text-muted-foreground">({o.expectedQtyAgg})</span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {loadingLines ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : aggLines.length > 0 ? (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="w-32">Cantidad</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggLines.map((line) => {
                  const key = lineKey(line);
                  const isHi =
                    highlightRef &&
                    String(line.reference || '')
                      .trim()
                      .toUpperCase() === highlightRef;
                  return (
                    <TableRow key={key} className={isHi ? 'bg-teal-50/80 dark:bg-teal-950/30' : undefined}>
                      <TableCell className="font-mono text-sm">
                        {line.reference}
                        {isHi ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Buscada
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {line.expectedQtyAgg}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          className="h-8 tabular-nums"
                          value={draftQty[key] ?? ''}
                          onChange={(e) =>
                            setDraftQty((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!!confirmingKey || props.disabled}
                          onClick={() => void handleConfirmLine(line)}
                        >
                          {confirmingKey === key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Confirmar
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : selectedLocation || selectedRef ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Sin líneas pendientes para mostrar.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            {pathMode === 'ubicacion'
              ? 'Elija una ubicación del día para ver referencias agregadas.'
              : 'Busque una referencia y luego elija la ubicación.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
