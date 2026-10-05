import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import type { ArchivePhoto, ArchiveQuick } from '@/app/podArchiveActions';
import { PHOTO_CATEGORIES } from '@/lib/pod';

export type ArchiveFile = {
  /** Ruta relativa dentro de la carpeta / ZIP. */
  rel: string;
  url: string;
  kind: 'app' | 'quick';
  /** path de Storage (app) o link (Quick). */
  key: string;
};

export type ArchiveResult = {
  ok: Set<string>;
  failed: Array<{ file: ArchiveFile; error: string }>;
};

export type ArchiveProgress = { done: number; total: number; failed: number };

const CATEGORY_ORDER = PHOTO_CATEGORIES.map((c) => c.id);
const safe = (v: string) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'SIN_NOMBRE';
const extOf = (url: string) => {
  const m = /\.(jpe?g|png|webp|gif)(?:$|\?)/i.exec(new URL(url).pathname);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
};
const dayOf = (isoDate?: string) => (isoDate ? format(new Date(isoDate), 'yyyy-MM-dd') : 'SIN_FECHA');

/** Nombres deterministas: el mismo mes siempre produce los mismos archivos. */
export function planArchive(
  month: string,
  photos: ArchivePhoto[],
  quick: ArchiveQuick[],
  opts: { app: boolean; quick: boolean }
): { files: ArchiveFile[]; appFileByPath: Record<string, string> } {
  const files: ArchiveFile[] = [];
  const appFileByPath: Record<string, string> = {};

  const sorted = [...photos].sort(
    (a, b) =>
      a.storeName.localeCompare(b.storeName) ||
      (a.completedAt || '').localeCompare(b.completedAt || '') ||
      (a.manifestId || 0) - (b.manifestId || 0) ||
      a.stopId.localeCompare(b.stopId) ||
      Number(!!a.rejected) - Number(!!b.rejected) ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.path.localeCompare(b.path)
  );
  const counters = new Map<string, number>();
  sorted.forEach((p) => {
    const folder = `${month}/${safe(p.storeName)}/${dayOf(p.completedAt)}_REL-${p.manifestId ?? 'SN'}`;
    const label = `${p.rejected ? 'RECHAZADA-' : ''}${p.category}`;
    const counterKey = `${folder}|${label}`;
    const n = (counters.get(counterKey) || 0) + 1;
    counters.set(counterKey, n);
    const rel = p.archived && p.archivedFile ? p.archivedFile : `${folder}/${label}-${n}.jpg`;
    appFileByPath[p.path] = rel;
    if (opts.app && !p.archived && p.url) files.push({ rel, url: p.url, kind: 'app', key: p.path });
  });

  if (opts.quick) {
    [...quick]
      .sort((a, b) => a.bodegaDestino.localeCompare(b.bodegaDestino) || a.numeroTF.localeCompare(b.numeroTF, undefined, { numeric: true }))
      .forEach((q) =>
        q.links.forEach((link, i) => {
          try {
            files.push({
              rel: `${month}/QUICK/${safe(q.bodegaDestino)}/TF-${safe(q.numeroTF)}-${i + 1}.${extOf(link)}`,
              url: link,
              kind: 'quick',
              key: link,
            });
          } catch {
            /* link inválido */
          }
        })
      );
  }
  return { files, appFileByPath };
}

export function buildArchiveIndex(
  month: string,
  photos: ArchivePhoto[],
  quick: ArchiveQuick[],
  appFileByPath: Record<string, string>,
  result: ArchiveResult | null,
  quickFiles: ArchiveFile[]
): Blob {
  const failedKeys = new Map(result?.failed.map((f) => [f.file.key, f.error]) || []);
  const catLabel = (c: string) => PHOTO_CATEGORIES.find((p) => p.id === c)?.label || c;
  const appRows = photos.map((p) => ({
    Mes: month,
    Relación: p.manifestId ?? '',
    Placa: p.placa || '',
    Conductor: p.driver || '',
    Tienda: p.storeName,
    'Estado parada': p.stopStatus,
    TF: p.numerosTF.join(', '),
    'Quién recibió': p.receivedByName || '',
    'Registrada': p.completedAt ? format(new Date(p.completedAt), 'dd/MM/yyyy HH:mm') : '',
    'Registró': p.completedByName || '',
    Latitud: p.lat ?? '',
    Longitud: p.lng ?? '',
    'Distancia (m)': p.distanceM ?? '',
    Categoría: catLabel(p.category),
    Rechazada: p.rejected ? `Sí: ${p.rejectionNote || ''}` : '',
    Archivo: appFileByPath[p.path] || '',
    Descarga: failedKeys.has(p.path) ? `ERROR: ${failedKeys.get(p.path)}` : p.archived ? 'Ya archivada' : result ? 'OK' : '',
  }));
  const fileByLink = new Map(quickFiles.map((f) => [f.key, f.rel]));
  const quickRows = quick.flatMap((q) =>
    q.links.map((link) => ({
      Mes: month,
      TF: q.numeroTF,
      Destino: q.bodegaDestino,
      'Fecha servicio': q.fechaFinalizado ? format(new Date(q.fechaFinalizado), 'dd/MM/yyyy') : '',
      Placa: q.placaEntrega || '',
      Archivo: fileByLink.get(link) || '',
      Descarga: failedKeys.has(link) ? `ERROR: ${failedKeys.get(link)}` : fileByLink.has(link) && result ? 'OK' : 'No descargada',
      Link: link,
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(appRows.length ? appRows : [{ Mes: month }]), 'Fotos app');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quickRows.length ? quickRows : [{ Mes: month }]), 'Quick');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function fetchPhoto(url: string): Promise<Blob> {
  const res = await fetch(`/api/pod-photo?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
  return res.blob();
}

export async function forEachPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export const supportsFolderPicker = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickArchiveFolder(): Promise<FileSystemDirectoryHandle> {
  return (window as any).showDirectoryPicker({ mode: 'readwrite' });
}

export async function writeToFolder(
  root: FileSystemDirectoryHandle,
  files: ArchiveFile[],
  onProgress: (p: ArchiveProgress) => void
): Promise<ArchiveResult> {
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  const dirFor = (path: string): Promise<FileSystemDirectoryHandle> => {
    if (!path) return Promise.resolve(root);
    if (!dirs.has(path)) {
      const parts = path.split('/');
      const name = parts.pop()!;
      dirs.set(path, dirFor(parts.join('/')).then((parent) => parent.getDirectoryHandle(name, { create: true })));
    }
    return dirs.get(path)!;
  };
  const result: ArchiveResult = { ok: new Set(), failed: [] };
  let done = 0;
  await forEachPool(files, 6, async (file) => {
    try {
      const blob = await fetchPhoto(file.url);
      const parts = file.rel.split('/');
      const name = parts.pop()!;
      const dir = await dirFor(parts.join('/'));
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await (handle as any).createWritable();
      await writable.write(blob);
      await writable.close();
      result.ok.add(file.key);
    } catch (e: any) {
      result.failed.push({ file, error: e?.message || 'Error' });
    }
    done++;
    onProgress({ done, total: files.length, failed: result.failed.length });
  });
  return result;
}

export async function writeBlobToFolder(root: FileSystemDirectoryHandle, rel: string, blob: Blob) {
  const parts = rel.split('/');
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await (handle as any).createWritable();
  await writable.write(blob);
  await writable.close();
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** ZIP en partes de ~maxBytes para no agotar la memoria del navegador. El índice va en la última parte. */
export async function downloadAsZips(
  baseName: string,
  files: ArchiveFile[],
  onProgress: (p: ArchiveProgress) => void,
  buildIndex: (result: ArchiveResult) => { rel: string; blob: Blob },
  maxBytes = 300 * 1024 * 1024
): Promise<ArchiveResult & { parts: number }> {
  const JSZip = (await import('jszip')).default;
  const result: ArchiveResult = { ok: new Set(), failed: [] };
  let zip = new JSZip();
  let bytes = 0;
  let part = 0;
  let done = 0;
  const flush = async () => {
    part++;
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    saveBlob(blob, `${baseName}_parte${part}.zip`);
    zip = new JSZip();
    bytes = 0;
  };
  for (let i = 0; i < files.length; i += 24) {
    const batch = files.slice(i, i + 24);
    await forEachPool(batch, 6, async (file) => {
      try {
        const blob = await fetchPhoto(file.url);
        zip.file(file.rel, blob);
        bytes += blob.size;
        result.ok.add(file.key);
      } catch (e: any) {
        result.failed.push({ file, error: e?.message || 'Error' });
      }
      done++;
      onProgress({ done, total: files.length, failed: result.failed.length });
    });
    if (bytes >= maxBytes) await flush();
  }
  const index = buildIndex(result);
  zip.file(index.rel, index.blob);
  await flush();
  return { ...result, parts: part };
}
