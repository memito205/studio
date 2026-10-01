"use client";

import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Loader2, Plus, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { saveWarehouseLocationConfig } from '@/app/actions';
import type { WarehouseLocationConfig } from '@/types';
import {
  normalizeLocationDestino,
  parseLocationRows,
  parsePrefixList,
  suggestLocationsForDestino,
} from '@/lib/warehouseLocations';

type PrefixRow = { destino: string; prefixes: string };

const toRows = (prefixes: Record<string, string[]>): PrefixRow[] =>
  Object.entries(prefixes)
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([destino, list]) => ({ destino, prefixes: list.join(', ') }));

export function WarehouseLocationsDialog({
  open,
  onOpenChange,
  config,
  onSaved,
  updatedByName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: WarehouseLocationConfig;
  onSaved: (config: WarehouseLocationConfig) => void;
  updatedByName?: string;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [codes, setCodes] = useState<string[]>(config.codes);
  const [rows, setRows] = useState<PrefixRow[]>(toRows(config.prefixes));
  const [pendingFileName, setPendingFileName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCodes(config.codes);
    setRows(toRows(config.prefixes));
    setPendingFileName('');
  }, [open, config]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = parseLocationRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }));
      if (parsed.length === 0) {
        toast({ variant: 'destructive', title: 'Archivo sin ubicaciones', description: 'Use una columna UBICACION (o la primera columna).' });
        return;
      }
      setCodes(parsed);
      setPendingFileName(file.name);
      toast({ title: 'Archivo leído', description: `${parsed.length} ubicaciones. Pulse Guardar para reemplazar el maestro.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error leyendo archivo', description: error.message });
    }
  };

  const buildPrefixes = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    rows.forEach((r) => {
      const dest = normalizeLocationDestino(r.destino);
      const list = parsePrefixList(r.prefixes);
      if (dest && list.length > 0) out[dest] = Array.from(new Set([...(out[dest] || []), ...list]));
    });
    return out;
  };

  const handleSave = async () => {
    setIsSaving(true);
    const prefixes = buildPrefixes();
    const result = await saveWarehouseLocationConfig({ codes, prefixes }, updatedByName);
    setIsSaving(false);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'No se guardó', description: result.error });
      return;
    }
    onSaved({ ...config, codes, prefixes, updatedByName });
    toast({ title: 'Maestro de ubicaciones guardado', description: `${codes.length} ubicaciones · ${Object.keys(prefixes).length} destinos con prefijo.` });
    onOpenChange(false);
  };

  const previewConfig: WarehouseLocationConfig = { codes, prefixes: buildPrefixes() };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Maestro de ubicaciones</DialogTitle>
          <DialogDescription>
            Suba el listado de ubicaciones y configure el prefijo de cada destino para que el sistema las sugiera (ej. B8 → 208-).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="text-sm">
              <p className="font-semibold">{codes.length} ubicaciones cargadas</p>
              <p className="text-xs text-muted-foreground">
                {pendingFileName ? `Nuevo archivo: ${pendingFileName} (sin guardar)` : 'Excel con columna UBICACION o la primera columna.'}
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <UploadCloud className="mr-2 h-4 w-4" /> Subir Excel
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Prefijos por destino</Label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRows((prev) => [...prev, { destino: '', prefixes: '' }])}>
                <Plus className="mr-1 h-4 w-4" /> Agregar destino
              </Button>
            </div>
            <ScrollArea className="h-64 rounded-md border">
              <div className="divide-y">
                {rows.length === 0 && (
                  <p className="p-4 text-center text-sm text-muted-foreground">Sin prefijos. Agregue un destino (ej. B8) y su prefijo (ej. 208-).</p>
                )}
                {rows.map((row, idx) => {
                  const matchCount = suggestLocationsForDestino(previewConfig, row.destino).length;
                  return (
                    <div key={idx} className="flex items-center gap-2 p-2">
                      <Input
                        value={row.destino}
                        placeholder="Destino (B8)"
                        className="w-32"
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, destino: e.target.value.toUpperCase() } : r)))}
                      />
                      <Input
                        value={row.prefixes}
                        placeholder="Prefijos (208-, 209-)"
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, prefixes: e.target.value.toUpperCase() } : r)))}
                      />
                      <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{matchCount} ubic.</span>
                      <Button type="button" size="icon" variant="ghost" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
