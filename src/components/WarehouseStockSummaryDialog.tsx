"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Download, Loader2, RefreshCw, Warehouse } from 'lucide-react';
import { getTransfersByStatus } from '@/app/actions';
import type { TransferEntry } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const BIG_TF_THRESHOLD = 5;

type TfGroup = { numeroTF: string; destino: string; unidades: number; codigoAlterno: string; ubicacion: string; fueraDeBase: boolean };

const FUERA_BASE_OBS = 'No está en la base de transferencias: posiblemente ya entregada';

type DestinoSummary = {
    destino: string;
    tfs: number;
    unidades: number;
    tfsMayor: number;
    unidadesMayor: number;
    tfsMenor: number;
    unidadesMenor: number;
};

function groupByTf(lines: TransferEntry[]): TfGroup[] {
    const map = new Map<string, TfGroup>();
    lines.forEach((t) => {
        const destino = String(t.bodegaDestino || 'SIN DESTINO').trim();
        const key = `${t.numeroTF}|${destino.toUpperCase()}`;
        const g = map.get(key) || { numeroTF: String(t.numeroTF || ''), destino, unidades: 0, codigoAlterno: '', ubicacion: '', fueraDeBase: false };
        g.unidades += Number(t.cantidad) || 0;
        g.fueraDeBase = g.fueraDeBase || !!t.fueraDeBaseAt;
        g.codigoAlterno = g.codigoAlterno || t.codigoAlterno || '';
        g.ubicacion = g.ubicacion || t.ubicacion || '';
        map.set(key, g);
    });
    return Array.from(map.values());
}

function summarize(tfs: TfGroup[]): DestinoSummary[] {
    const map = new Map<string, DestinoSummary>();
    tfs.forEach((tf) => {
        const s = map.get(tf.destino) || {
            destino: tf.destino, tfs: 0, unidades: 0, tfsMayor: 0, unidadesMayor: 0, tfsMenor: 0, unidadesMenor: 0,
        };
        s.tfs += 1;
        s.unidades += tf.unidades;
        if (tf.unidades > BIG_TF_THRESHOLD) {
            s.tfsMayor += 1;
            s.unidadesMayor += tf.unidades;
        } else {
            s.tfsMenor += 1;
            s.unidadesMenor += tf.unidades;
        }
        map.set(tf.destino, s);
    });
    return Array.from(map.values()).sort((a, b) => b.unidades - a.unidades);
}

const sumBy = (rows: DestinoSummary[], k: keyof Omit<DestinoSummary, 'destino'>) => rows.reduce((acc, r) => acc + r[k], 0);

export function WarehouseStockSummaryButton() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="outline" onClick={() => setOpen(true)}>
                <Warehouse className="mr-2 h-4 w-4" /> Resumen en bodega
            </Button>
            {open && <WarehouseStockSummaryDialog open={open} onOpenChange={setOpen} />}
        </>
    );
}

function WarehouseStockSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [tfs, setTfs] = useState<TfGroup[]>([]);
    const [loadedAt, setLoadedAt] = useState<Date | null>(null);
    const [search, setSearch] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const res = await getTransfersByStatus('Recibido en Bodega', 10000);
        setLoading(false);
        if (res.error || !res.data) {
            toast({ variant: 'destructive', title: 'Error', description: res.error || 'No se pudo cargar.' });
            return;
        }
        setTfs(groupByTf(res.data));
        setLoadedAt(new Date());
    }, [toast]);

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    const summary = useMemo(() => summarize(tfs), [tfs]);
    const fueraDeBase = useMemo(() => tfs.filter((tf) => tf.fueraDeBase).length, [tfs]);
    const visible = useMemo(() => {
        const q = search.trim().toUpperCase();
        return q ? summary.filter((s) => s.destino.toUpperCase().includes(q)) : summary;
    }, [summary, search]);

    const handleExport = () => {
        const wb = XLSX.utils.book_new();
        const resumen = visible.map((s) => ({
            Destino: s.destino,
            'TF distintas': s.tfs,
            Unidades: s.unidades,
            [`TF > ${BIG_TF_THRESHOLD} unid`]: s.tfsMayor,
            [`Unid. TF > ${BIG_TF_THRESHOLD}`]: s.unidadesMayor,
            [`TF ≤ ${BIG_TF_THRESHOLD} unid`]: s.tfsMenor,
            [`Unid. TF ≤ ${BIG_TF_THRESHOLD}`]: s.unidadesMenor,
        }));
        resumen.push({
            Destino: 'TOTAL',
            'TF distintas': sumBy(visible, 'tfs'),
            Unidades: sumBy(visible, 'unidades'),
            [`TF > ${BIG_TF_THRESHOLD} unid`]: sumBy(visible, 'tfsMayor'),
            [`Unid. TF > ${BIG_TF_THRESHOLD}`]: sumBy(visible, 'unidadesMayor'),
            [`TF ≤ ${BIG_TF_THRESHOLD} unid`]: sumBy(visible, 'tfsMenor'),
            [`Unid. TF ≤ ${BIG_TF_THRESHOLD}`]: sumBy(visible, 'unidadesMenor'),
        });
        const destinos = new Set(visible.map((s) => s.destino));
        const detalle = tfs
            .filter((tf) => destinos.has(tf.destino))
            .sort((a, b) => a.destino.localeCompare(b.destino) || b.unidades - a.unidades)
            .map((tf) => ({
                Destino: tf.destino,
                TF: tf.numeroTF,
                'Código alterno': tf.codigoAlterno,
                Ubicación: tf.ubicacion,
                Unidades: tf.unidades,
                Tipo: tf.unidades > BIG_TF_THRESHOLD ? `> ${BIG_TF_THRESHOLD}` : `≤ ${BIG_TF_THRESHOLD}`,
                Observación: tf.fueraDeBase ? FUERA_BASE_OBS : '',
            }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen por destino');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), 'Detalle TF');
        XLSX.writeFile(wb, `Resumen_Recibido_Bodega_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Resumen en bodega (Recibido en Bodega)</DialogTitle>
                    <DialogDescription>
                        TF agrupadas por destino. Una TF cuenta como &quot;mayor a {BIG_TF_THRESHOLD}&quot; si la suma de sus unidades es mayor a {BIG_TF_THRESHOLD}.
                        {loadedAt && ` Actualizado ${format(loadedAt, 'dd/MM HH:mm')}.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        placeholder="Filtrar destino..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="max-w-xs"
                    />
                    <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Actualizar
                    </Button>
                    <Button size="sm" onClick={handleExport} disabled={loading || visible.length === 0}>
                        <Download className="mr-2 h-4 w-4" /> Excel
                    </Button>
                </div>
                {fueraDeBase > 0 && (
                    <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {fueraDeBase} TF no están en la última base de transferencias (posiblemente ya entregadas). En el Excel aparecen con
                        observación en la hoja &quot;Detalle TF&quot;.
                    </p>
                )}

                <div className="max-h-[60vh] overflow-auto border rounded-md">
                    <Table>
                        <TableHeader className="sticky top-0 bg-background">
                            <TableRow>
                                <TableHead>Destino</TableHead>
                                <TableHead className="text-right">TF distintas</TableHead>
                                <TableHead className="text-right">Unidades</TableHead>
                                <TableHead className="text-right">TF &gt; {BIG_TF_THRESHOLD} unid</TableHead>
                                <TableHead className="text-right">TF ≤ {BIG_TF_THRESHOLD} unid</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && tfs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8">
                                        <Loader2 className="inline h-5 w-5 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : visible.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                        No hay TF en Recibido en Bodega.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                visible.map((s) => (
                                    <TableRow key={s.destino}>
                                        <TableCell className="font-medium">{s.destino}</TableCell>
                                        <TableCell className="text-right">{s.tfs}</TableCell>
                                        <TableCell className="text-right">{s.unidades}</TableCell>
                                        <TableCell className="text-right">
                                            {s.tfsMayor} <span className="text-xs text-muted-foreground">({s.unidadesMayor} u)</span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {s.tfsMenor} <span className="text-xs text-muted-foreground">({s.unidadesMenor} u)</span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                        {visible.length > 0 && (
                            <TableFooter>
                                <TableRow className="font-bold">
                                    <TableCell>TOTAL ({visible.length} destinos)</TableCell>
                                    <TableCell className="text-right">{sumBy(visible, 'tfs')}</TableCell>
                                    <TableCell className="text-right">{sumBy(visible, 'unidades')}</TableCell>
                                    <TableCell className="text-right">
                                        {sumBy(visible, 'tfsMayor')} <span className="text-xs font-normal">({sumBy(visible, 'unidadesMayor')} u)</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {sumBy(visible, 'tfsMenor')} <span className="text-xs font-normal">({sumBy(visible, 'unidadesMenor')} u)</span>
                                    </TableCell>
                                </TableRow>
                            </TableFooter>
                        )}
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
}
