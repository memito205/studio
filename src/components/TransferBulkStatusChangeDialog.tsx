"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Loader2, Download, Upload, FileSpreadsheet } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { TransferActor, TransferEntry, TransferStatus } from '@/types';
import {
    applyBulkTransferStatusUpdates,
    previewBulkTransferStatusFromFile,
    type BulkTransferStatusFileRow,
    type BulkTransferStatusPreviewItem,
} from '@/app/actions';
import { findCaseInsensitiveKey, parseTransferStatusValue } from '@/lib/transferRouteKey';

const ALL_STATUSES: TransferStatus[] = [
    'En Tránsito',
    'Recolectado en Ruta',
    'Entregado en Ruta',
    'Validado Supervisor',
    'Recibido en Bodega',
    'Enviado a Destino',
];

function parseBulkStatusFileRows(workbook: XLSX.WorkBook): BulkTransferStatusFileRow[] {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    return raw
        .map((row) => {
            const tfKey = findCaseInsensitiveKey(row, ['Numero TF', 'Número TF', 'NUMERO TF', 'TF', 'NumeroTF']);
            const origenKey = findCaseInsensitiveKey(row, ['Bodega Origen', 'BOD. SALIDA', 'Origen', 'Bodega origen']);
            const destinoKey = findCaseInsensitiveKey(row, ['Bodega Destino', 'BOD. ENTRADA', 'BOD DESTINO', 'Destino', 'Bodega destino']);
            const estadoKey = findCaseInsensitiveKey(row, ['Estado Destino', 'ESTADO DESTINO', 'Estado', 'Nuevo Estado']);

            return {
                numeroTF: String(tfKey ? row[tfKey] : '').trim(),
                bodegaOrigen: String(origenKey ? row[origenKey] : '').trim(),
                bodegaDestino: String(destinoKey ? row[destinoKey] : '').trim(),
                estadoDestino: String(estadoKey ? row[estadoKey] : '').trim(),
            };
        })
        .filter((r) => r.numeroTF || r.bodegaOrigen || r.bodegaDestino || r.estadoDestino);
}

export function downloadBulkStatusTemplate() {
    const headers = ['Numero TF', 'Bodega Origen', 'Bodega Destino', 'Estado Destino'];
    const exampleData = [
        {
            'Numero TF': 'TF-101',
            'Bodega Origen': 'BODEGA PPA',
            'Bodega Destino': 'TIENDA BELLO',
            'Estado Destino': 'Recibido en Bodega',
        },
    ];
    const worksheet = XLSX.utils.json_to_sheet(exampleData, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cambio Estado');
    XLSX.writeFile(workbook, 'Plantilla_Cambio_Estado_Transferencias.xlsx');
}

interface TransferBulkStatusChangeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialTab?: 'selection' | 'file';
    selectedTransferIds: string[];
    transfers: TransferEntry[];
    actor?: TransferActor;
    onSuccess: () => void;
}

export const TransferBulkStatusChangeDialog: React.FC<TransferBulkStatusChangeDialogProps> = ({
    open,
    onOpenChange,
    initialTab = 'selection',
    selectedTransferIds,
    transfers,
    actor,
    onSuccess,
}) => {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [tab, setTab] = useState<'selection' | 'file'>(initialTab);
    const [newStatus, setNewStatus] = useState<TransferStatus | ''>('');
    const [justification, setJustification] = useState('');
    const [isApplying, setIsApplying] = useState(false);
    const [isPreviewingFile, setIsPreviewingFile] = useState(false);
    const [filePreview, setFilePreview] = useState<{
        matched: BulkTransferStatusPreviewItem[];
        notFound: BulkTransferStatusFileRow[];
        invalidStatus: BulkTransferStatusFileRow[];
    } | null>(null);
    const [fileName, setFileName] = useState('');

    useEffect(() => {
        if (open) {
            setTab(initialTab);
            setNewStatus('');
            setJustification('');
            setFilePreview(null);
            setFileName('');
        }
    }, [open, initialTab]);

    const selectionPreview = useMemo((): BulkTransferStatusPreviewItem[] => {
        if (!newStatus || selectedTransferIds.length === 0) return [];
        const idSet = new Set(selectedTransferIds);
        return transfers
            .filter((t) => idSet.has(t.id))
            .map((t) => ({
                transferId: t.id,
                numeroTF: t.numeroTF,
                bodegaOrigen: t.bodegaOrigen,
                bodegaDestino: t.bodegaDestino,
                currentStatus: t.status,
                newStatus: newStatus as TransferStatus,
                marca: t.marca,
                grupo: t.grupo,
                cantidad: t.cantidad,
            }));
    }, [transfers, selectedTransferIds, newStatus]);

    const activePreview = tab === 'selection' ? selectionPreview : filePreview?.matched ?? [];

    const unchangedCount = useMemo(
        () => activePreview.filter((item) => item.currentStatus === item.newStatus).length,
        [activePreview]
    );

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;

            setFileName(file.name);
            setIsPreviewingFile(true);
            setFilePreview(null);

            try {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array' });
                const rows = parseBulkStatusFileRows(workbook);

                if (rows.length === 0) {
                    toast({
                        variant: 'destructive',
                        title: 'Archivo vacío',
                        description: 'No se encontraron filas válidas en el archivo.',
                    });
                    return;
                }

                const result = await previewBulkTransferStatusFromFile(rows);
                if (!result.success) {
                    throw new Error(result.error || 'No se pudo generar la vista previa.');
                }

                setFilePreview({
                    matched: result.matched,
                    notFound: result.notFound,
                    invalidStatus: result.invalidStatus,
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Error al leer el archivo.';
                toast({ variant: 'destructive', title: 'Error', description: message });
            } finally {
                setIsPreviewingFile(false);
            }
        },
        [toast]
    );

    const handleApply = async () => {
        if (!justification.trim()) {
            toast({
                variant: 'destructive',
                title: 'Justificación requerida',
                description: 'Debe indicar el motivo del cambio masivo.',
            });
            return;
        }

        let updates: { transferId: string; newStatus: TransferStatus }[] = [];

        if (tab === 'selection') {
            if (!newStatus) {
                toast({ variant: 'destructive', title: 'Estado requerido', description: 'Seleccione el estado destino.' });
                return;
            }
            updates = selectionPreview.map((item) => ({
                transferId: item.transferId,
                newStatus: item.newStatus,
            }));
        } else {
            if (!filePreview?.matched.length) {
                toast({
                    variant: 'destructive',
                    title: 'Sin coincidencias',
                    description: 'Cargue un archivo con transferencias válidas antes de aplicar.',
                });
                return;
            }
            updates = filePreview.matched.map((item) => ({
                transferId: item.transferId,
                newStatus: item.newStatus,
            }));
        }

        const toApply = updates.filter((u) => {
            const current = activePreview.find((p) => p.transferId === u.transferId);
            return !current || current.currentStatus !== u.newStatus;
        });

        if (toApply.length === 0) {
            toast({
                title: 'Nada que actualizar',
                description: 'Todas las líneas seleccionadas ya están en el estado destino.',
            });
            return;
        }

        setIsApplying(true);
        try {
            const result = await applyBulkTransferStatusUpdates(toApply, justification.trim(), actor);
            if (result.success) {
                toast({
                    title: 'Cambio masivo aplicado',
                    description: `Se actualizaron ${result.updatedCount ?? toApply.length} línea(s).`,
                });
                onSuccess();
                onOpenChange(false);
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result.error });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error inesperado al aplicar cambios.';
            toast({ variant: 'destructive', title: 'Error', description: message });
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Cambio masivo de estado</DialogTitle>
                    <DialogDescription>
                        Solo administradores. Las transiciones son libres, igual que el cambio manual unitario. La justificación
                        queda registrada en el historial de cada línea.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={tab} onValueChange={(v) => setTab(v as 'selection' | 'file')} className="flex-1 overflow-hidden flex flex-col">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="selection" disabled={selectedTransferIds.length === 0 && initialTab !== 'selection'}>
                            Selección en tabla ({selectedTransferIds.length} ids)
                        </TabsTrigger>
                        <TabsTrigger value="file">Desde archivo</TabsTrigger>
                    </TabsList>

                    <TabsContent value="selection" className="space-y-4 mt-4 overflow-auto">
                        {selectedTransferIds.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                Seleccione filas en la tabla de búsqueda con los checkboxes y vuelva a abrir esta ventana.
                            </p>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="bulk-new-status">Estado destino</Label>
                                        <Select value={newStatus} onValueChange={(val) => setNewStatus(val as TransferStatus)}>
                                            <SelectTrigger id="bulk-new-status">
                                                <SelectValue placeholder="Seleccione estado..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ALL_STATUSES.map((s) => (
                                                    <SelectItem key={s} value={s}>
                                                        {s}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="bulk-justification">Justificación (obligatoria)</Label>
                                        <Input
                                            id="bulk-justification"
                                            value={justification}
                                            onChange={(e) => setJustification(e.target.value)}
                                            placeholder="Motivo del cambio masivo..."
                                        />
                                    </div>
                                </div>
                                {selectionPreview.length > 0 && (
                                    <PreviewTable items={selectionPreview} unchangedCount={unchangedCount} />
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="file" className="space-y-4 mt-4 overflow-auto">
                        <div className="flex flex-wrap gap-2 items-center">
                            <Button type="button" variant="secondary" size="sm" onClick={downloadBulkStatusTemplate}>
                                <Download className="mr-2 h-4 w-4" />
                                Descargar plantilla
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isPreviewingFile}
                            >
                                {isPreviewingFile ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Upload className="mr-2 h-4 w-4" />
                                )}
                                Cargar archivo
                            </Button>
                            {fileName && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <FileSpreadsheet className="h-3.5 w-3.5" />
                                    {fileName}
                                </span>
                            )}
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Columnas: Numero TF, Bodega Origen, Bodega Destino, Estado Destino. También acepta encabezados
                            alternativos (BOD. SALIDA, BOD. ENTRADA, etc.).
                        </p>

                        <div className="space-y-2">
                            <Label htmlFor="bulk-file-justification">Justificación (obligatoria)</Label>
                            <Input
                                id="bulk-file-justification"
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                placeholder="Motivo del cambio masivo desde archivo..."
                            />
                        </div>

                        {isPreviewingFile && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Generando vista previa...
                            </div>
                        )}

                        {filePreview && (
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary">{filePreview.matched.length} línea(s) encontrada(s)</Badge>
                                    {filePreview.notFound.length > 0 && (
                                        <Badge variant="destructive">{filePreview.notFound.length} ruta(s) no encontrada(s)</Badge>
                                    )}
                                    {filePreview.invalidStatus.length > 0 && (
                                        <Badge variant="outline">{filePreview.invalidStatus.length} estado(s) inválido(s)</Badge>
                                    )}
                                    {unchangedCount > 0 && (
                                        <Badge variant="outline">{unchangedCount} ya en estado destino</Badge>
                                    )}
                                </div>

                                {filePreview.matched.length > 0 && (
                                    <PreviewTable items={filePreview.matched} unchangedCount={unchangedCount} />
                                )}

                                {filePreview.notFound.length > 0 && (
                                    <IssueTable title="Rutas no encontradas" rows={filePreview.notFound} />
                                )}

                                {filePreview.invalidStatus.length > 0 && (
                                    <IssueTable title="Estados inválidos" rows={filePreview.invalidStatus} showInvalid />
                                )}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleApply}
                        disabled={
                            isApplying ||
                            !justification.trim() ||
                            (tab === 'selection' && (!newStatus || selectionPreview.length === 0)) ||
                            (tab === 'file' && !filePreview?.matched.length)
                        }
                    >
                        {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Aplicar cambios
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

function PreviewTable({
    items,
    unchangedCount,
}: {
    items: BulkTransferStatusPreviewItem[];
    unchangedCount: number;
}) {
    return (
        <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
                Vista previa: {items.length} línea(s)
                {unchangedCount > 0 ? ` (${unchangedCount} sin cambio)` : ''}
            </div>
            <ScrollArea className="h-[280px] border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>TF</TableHead>
                            <TableHead>Origen</TableHead>
                            <TableHead>Destino</TableHead>
                            <TableHead>Actual</TableHead>
                            <TableHead>Nuevo</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => (
                            <TableRow
                                key={item.transferId}
                                className={item.currentStatus === item.newStatus ? 'opacity-60' : undefined}
                            >
                                <TableCell className="font-mono text-xs">{item.numeroTF}</TableCell>
                                <TableCell className="text-xs">{item.bodegaOrigen}</TableCell>
                                <TableCell className="text-xs">{item.bodegaDestino}</TableCell>
                                <TableCell className="text-xs">{item.currentStatus}</TableCell>
                                <TableCell className="text-xs font-medium">{item.newStatus}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
    );
}

function IssueTable({
    title,
    rows,
    showInvalid,
}: {
    title: string;
    rows: BulkTransferStatusFileRow[];
    showInvalid?: boolean;
}) {
    return (
        <div className="space-y-2">
            <p className="text-sm font-medium">{title}</p>
            <ScrollArea className="h-[120px] border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>TF</TableHead>
                            <TableHead>Origen</TableHead>
                            <TableHead>Destino</TableHead>
                            {showInvalid && <TableHead>Estado</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row, idx) => (
                            <TableRow key={`${row.numeroTF}-${idx}`}>
                                <TableCell className="text-xs">{row.numeroTF || '—'}</TableCell>
                                <TableCell className="text-xs">{row.bodegaOrigen || '—'}</TableCell>
                                <TableCell className="text-xs">{row.bodegaDestino || '—'}</TableCell>
                                {showInvalid && (
                                    <TableCell className="text-xs text-destructive">
                                        {row.estadoDestino || '—'}
                                        {!parseTransferStatusValue(row.estadoDestino) && row.estadoDestino ? ' (inválido)' : ''}
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
    );
}
