"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Archive, FolderDown, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { deleteObject, getStorage, ref } from 'firebase/storage';
import { app } from '@/services/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  getPodArchiveMonth,
  getPodArchiveMonths,
  markPodArchiveDownloaded,
  markPodMonthReleased,
  type ArchiveMonthSummary,
} from '@/app/podArchiveActions';
import {
  buildArchiveIndex,
  downloadAsZips,
  forEachPool,
  pickArchiveFolder,
  planArchive,
  supportsFolderPicker,
  writeBlobToFolder,
  writeToFolder,
  type ArchiveFile,
  type ArchiveProgress,
  type ArchiveResult,
} from '@/lib/podArchive';
import type { TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** Debe coincidir con firebase/lifecycle.json (borrado automático de entregas/). */
const AUTO_DELETE_DAYS = 210;
const WARN_DAYS = 165;

const monthStart = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
};
const monthLabel = (month: string) => format(monthStart(month), 'MMMM yyyy', { locale: es });
const fmt = (v?: string) => (v ? format(new Date(v), 'dd/MM/yyyy HH:mm') : '');

type Job = { month: string; label: string; progress: ArchiveProgress | null };
type DownloadRequest = { month: string; mode: 'carpeta' | 'zip' };

export function PodArchiveTab({ actor, isAdmin }: { actor: TransferActor; isAdmin: boolean }) {
  const { toast } = useToast();
  const [months, setMonths] = useState<ArchiveMonthSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [request, setRequest] = useState<DownloadRequest | null>(null);
  const [incApp, setIncApp] = useState(true);
  const [incQuick, setIncQuick] = useState(true);
  const [releaseMonth, setReleaseMonth] = useState<ArchiveMonthSummary | null>(null);
  const [lastFailures, setLastFailures] = useState<{ month: string; failed: ArchiveResult['failed'] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPodArchiveMonths();
    setLoading(false);
    if (res.error) return toast({ variant: 'destructive', title: 'Error', description: res.error });
    setMonths(res.data || []);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentMonth = format(new Date(), 'yyyy-MM');
  const pending = (m: ArchiveMonthSummary) => m.appPhotos + m.rejectedPhotos;
  const canRelease = (m: ArchiveMonthSummary) =>
    isAdmin && m.month < currentMonth && pending(m) > 0 && !!m.appBackedUpAt && (m.appBackedUpCount || 0) >= pending(m);
  const warnings = months.filter(
    (m) => pending(m) > 0 && Date.now() >= addDays(monthStart(m.month), WARN_DAYS).getTime()
  );

  const runDownload = async ({ month, mode }: DownloadRequest) => {
    let root: FileSystemDirectoryHandle | null = null;
    if (mode === 'carpeta') {
      try {
        root = await pickArchiveFolder();
      } catch {
        return;
      }
    }
    setRequest(null);
    setLastFailures(null);
    setJob({ month, label: 'Preparando lista de fotos…', progress: null });
    try {
      const data = await getPodArchiveMonth(month);
      if (data.error || !data.photos || !data.quick) throw new Error(data.error || 'Sin datos');
      const { photos, quick } = data;
      const { files, appFileByPath } = planArchive(month, photos, quick, { app: incApp, quick: incQuick });
      if (files.length === 0) {
        toast({ title: 'Nada para descargar', description: 'Este mes no tiene fotos pendientes con esa selección.' });
        return;
      }
      const quickFiles = files.filter((f) => f.kind === 'quick');
      const indexFor = (result: ArchiveResult) => ({
        rel: `${month}/INDICE_${month}.xlsx`,
        blob: buildArchiveIndex(month, photos, quick, appFileByPath, result, quickFiles),
      });
      const onProgress = (progress: ArchiveProgress) => setJob({ month, label: 'Descargando fotos…', progress });

      let result: ArchiveResult;
      if (root) {
        result = await writeToFolder(root, files, onProgress);
        const index = indexFor(result);
        await writeBlobToFolder(root, index.rel, index.blob);
      } else {
        result = await downloadAsZips(`Entregas_${month}`, files, onProgress, indexFor);
      }

      const count = (kind: ArchiveFile['kind'], ok: boolean) =>
        ok
          ? files.filter((f) => f.kind === kind && result.ok.has(f.key)).length
          : result.failed.filter((f) => f.file.kind === kind).length;
      await markPodArchiveDownloaded({
        month,
        mode,
        appOk: count('app', true),
        appFailed: count('app', false),
        quickOk: count('quick', true),
        quickFailed: count('quick', false),
        actor,
      });
      if (result.failed.length > 0) setLastFailures({ month, failed: result.failed });
      toast({
        variant: result.failed.length > 0 ? 'destructive' : 'default',
        title: `Respaldo de ${monthLabel(month)}`,
        description: `${result.ok.size} foto(s) descargadas${result.failed.length ? ` · ${result.failed.length} con error (ver lista)` : ''}.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo descargar', description: e?.message });
    } finally {
      setJob(null);
      void load();
    }
  };

  const runRelease = async (m: ArchiveMonthSummary) => {
    setReleaseMonth(null);
    setJob({ month: m.month, label: 'Borrando fotos del almacenamiento…', progress: null });
    try {
      const data = await getPodArchiveMonth(m.month);
      if (data.error || !data.photos) throw new Error(data.error || 'Sin datos');
      const { appFileByPath } = planArchive(m.month, data.photos, [], { app: true, quick: false });
      const toDelete = data.photos.filter((p) => !p.archived);
      const storage = getStorage(app);
      const files: Record<string, string> = {};
      let done = 0;
      let failed = 0;
      await forEachPool(toDelete, 6, async (p) => {
        try {
          await deleteObject(ref(storage, p.path));
          files[p.path] = appFileByPath[p.path];
        } catch (e: any) {
          if (e?.code === 'storage/object-not-found') files[p.path] = appFileByPath[p.path];
          else failed++;
        }
        done++;
        setJob({ month: m.month, label: 'Borrando fotos del almacenamiento…', progress: { done, total: toDelete.length, failed } });
      });
      const res = await markPodMonthReleased({ month: m.month, files, deleted: Object.keys(files).length, actor });
      if (!res.success) throw new Error(res.error);
      toast({
        variant: failed ? 'destructive' : 'default',
        title: `${monthLabel(m.month)} liberado`,
        description: `${Object.keys(files).length} foto(s) borradas del almacenamiento${failed ? ` · ${failed} no se pudieron borrar (reintente)` : ''}.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo liberar', description: e?.message });
    } finally {
      setJob(null);
      void load();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Respaldo de fotos por mes</CardTitle>
          <CardDescription>
            Descargue cada mes a una carpeta del PC (Chrome/Edge) o en ZIP, con un Excel índice. Luego confirme para liberar el
            almacenamiento. Los datos de cada entrega se conservan siempre; la foto queda marcada como archivada con su nombre de
            archivo. Las fotos de la app se borran solas a los {AUTO_DELETE_DAYS} días si nadie las libera.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || !!job}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Actualizar
          </Button>
          {!supportsFolderPicker() && (
            <span className="text-xs text-amber-700">Este navegador no permite elegir carpeta: use ZIP o abra en Chrome/Edge.</span>
          )}
        </CardContent>
      </Card>

      {warnings.map((m) => (
        <div key={m.month} className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Las fotos de {monthLabel(m.month)} se empiezan a borrar automáticamente el{' '}
          {format(addDays(monthStart(m.month), AUTO_DELETE_DAYS), 'dd/MM/yyyy')}. Descárguelas y libere el mes.
        </div>
      ))}

      {job && (
        <div className="rounded-md border p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" /> {monthLabel(job.month)} · {job.label}
          </div>
          {job.progress && (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((job.progress.done / Math.max(1, job.progress.total)) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {job.progress.done}/{job.progress.total}
                {job.progress.failed ? ` · ${job.progress.failed} con error` : ''} · no cierre esta pestaña
              </p>
            </>
          )}
        </div>
      )}

      {lastFailures && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          <p className="mb-1 font-bold">
            {lastFailures.failed.length} foto(s) de {monthLabel(lastFailures.month)} no se descargaron (también quedan marcadas en el índice):
          </p>
          <ul className="max-h-40 list-disc overflow-y-auto pl-5">
            {lastFailures.failed.slice(0, 50).map((f) => (
              <li key={f.file.key}>
                {f.file.rel}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mes</TableHead>
              <TableHead>Fotos app</TableHead>
              <TableHead>Pruebas Quick</TableHead>
              <TableHead>Borrado automático</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {loading ? 'Cargando…' : 'No hay fotos para respaldar.'}
                </TableCell>
              </TableRow>
            ) : (
              months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="font-bold capitalize">{monthLabel(m.month)}</TableCell>
                  <TableCell className="text-sm">
                    {pending(m)} pendiente(s)
                    {m.rejectedPhotos ? <span className="text-xs text-muted-foreground"> · {m.rejectedPhotos} de rechazos</span> : null}
                    {m.archivedPhotos ? <span className="block text-xs text-green-700">{m.archivedPhotos} archivada(s)</span> : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {m.quickTfs} TF · {m.quickLinks} foto(s)
                  </TableCell>
                  <TableCell className="text-xs">
                    {pending(m) > 0 ? `desde ${format(addDays(monthStart(m.month), AUTO_DELETE_DAYS), 'dd/MM/yyyy')}` : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.releasedAt && pending(m) === 0 ? (
                      <Badge className="bg-green-700 text-white">Liberado</Badge>
                    ) : m.appBackedUpAt && (m.appBackedUpCount || 0) >= pending(m) && pending(m) > 0 ? (
                      <Badge className="bg-blue-600 text-white">Respaldado</Badge>
                    ) : pending(m) > 0 ? (
                      <Badge variant="outline">Sin respaldo</Badge>
                    ) : null}
                    {m.lastDownloadAt && (
                      <span className="mt-1 block text-muted-foreground">
                        Última descarga {fmt(m.lastDownloadAt)} · {m.lastDownloadByName} ({m.lastDownloadMode})
                      </span>
                    )}
                    {m.releasedAt && <span className="block text-muted-foreground">Liberado {fmt(m.releasedAt)} · {m.releasedByName}</span>}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap text-right">
                    {supportsFolderPicker() && (
                      <Button size="sm" variant="outline" disabled={!!job} onClick={() => setRequest({ month: m.month, mode: 'carpeta' })}>
                        <FolderDown className="mr-1 h-3.5 w-3.5" /> Carpeta
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={!!job} onClick={() => setRequest({ month: m.month, mode: 'zip' })}>
                      <Archive className="mr-1 h-3.5 w-3.5" /> ZIP
                    </Button>
                    {isAdmin && pending(m) > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!!job || !canRelease(m)}
                        title={
                          m.month >= currentMonth
                            ? 'Solo meses cerrados'
                            : !canRelease(m)
                              ? 'Primero descargue todas las fotos app del mes sin errores'
                              : undefined
                        }
                        onClick={() => setReleaseMonth(m)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Liberar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {request && (
        <Dialog open onOpenChange={(o) => !o && setRequest(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Descargar {monthLabel(request.month)} {request.mode === 'carpeta' ? 'a una carpeta' : 'en ZIP'}
              </DialogTitle>
              <DialogDescription>
                {request.mode === 'carpeta'
                  ? 'Elija la carpeta del PC (ej. D:\\Pruebas de entrega). Se crea la carpeta del mes con tiendas, días y relaciones, más el Excel índice.'
                  : 'Se descargan uno o varios ZIP de hasta ~300 MB. El Excel índice va en la última parte.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Checkbox checked={incApp} onCheckedChange={(c) => setIncApp(!!c)} /> Fotos de la app del conductor
              </Label>
              <Label className="flex items-center gap-2">
                <Checkbox checked={incQuick} onCheckedChange={(c) => setIncQuick(!!c)} /> Fotos de Quick (desde la base histórica)
              </Label>
              <p className="text-xs text-muted-foreground">Para poder liberar el mes deben bajarse todas las fotos de la app sin errores.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRequest(null)}>Cancelar</Button>
              <Button disabled={!incApp && !incQuick} onClick={() => void runDownload(request)}>
                {request.mode === 'carpeta' ? 'Elegir carpeta y descargar' : 'Descargar ZIP'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {releaseMonth && (
        <Dialog open onOpenChange={(o) => !o && setReleaseMonth(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar respaldo y liberar {monthLabel(releaseMonth.month)}</DialogTitle>
              <DialogDescription>
                Se borrarán del almacenamiento {pending(releaseMonth)} foto(s) de la app. Confirme que la carpeta o los ZIP del
                {' '}{fmt(releaseMonth.appBackedUpAt)} están guardados en el PC. Esta acción no se puede deshacer. Las pruebas de Quick no
                se tocan.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReleaseMonth(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={() => void runRelease(releaseMonth)}>
                Sí, ya está respaldado: liberar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
