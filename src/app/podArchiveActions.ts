'use server';

import {
  arrayUnion,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { DeliveryPhotoCategory, TransferActor } from '@/types';

const ARCHIVE_COLLECTION = 'podArchives';
const QUICK_LEGACY_COLLECTION = 'podLegacyQuick';
const PLATFORM_COLLECTION = 'tf_platform_status';

export type ArchivePhoto = {
  path: string;
  url: string;
  category: DeliveryPhotoCategory;
  manifestDocId: string;
  manifestId?: number;
  placa?: string;
  driver?: string;
  stopId: string;
  storeName: string;
  stopStatus: string;
  numerosTF: string[];
  receivedByName?: string;
  completedAt?: string;
  completedByName?: string;
  lat?: number;
  lng?: number;
  distanceM?: number;
  /** Foto de un registro que el admin rechazó. */
  rejected?: boolean;
  rejectionNote?: string;
  archived?: boolean;
  archivedFile?: string;
};

export type ArchiveQuick = {
  id: string;
  numeroTF: string;
  bodegaDestino: string;
  fechaFinalizado?: string;
  placaEntrega?: string;
  links: string[];
};

export type ArchiveMonthSummary = {
  month: string;
  appPhotos: number;
  rejectedPhotos: number;
  archivedPhotos: number;
  stops: number;
  quickTfs: number;
  quickLinks: number;
  appBackedUpAt?: string;
  appBackedUpByName?: string;
  /** Fotos app bajadas sin error en ese respaldo; si hoy hay más, hay que volver a descargar. */
  appBackedUpCount?: number;
  lastDownloadAt?: string;
  lastDownloadByName?: string;
  lastDownloadMode?: string;
  releasedAt?: string;
  releasedByName?: string;
};

const toDate = (v: any): Date | null => {
  if (!v) return null;
  const d = v instanceof Timestamp ? v.toDate() : typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const iso = (v: any) => toDate(v)?.toISOString();
/** Mes calendario en Colombia (UTC-5). */
const monthOfDate = (d: Date) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 7);
const monthOfPath = (path: string) => {
  const m = String(path || '').split('/')[1] || '';
  return /^\d{4}-\d{2}$/.test(m) ? m : '';
};

async function loadPodStops() {
  const snap = await getDocs(collectionGroup(firestore, 'stops'));
  const stops = snap.docs.filter((d) => d.ref.parent.parent?.parent.id === 'deliveryManifests');
  const manifestIds = Array.from(new Set(stops.map((d) => d.ref.parent.parent!.id)));
  const manifests = new Map<string, DocumentData>();
  for (let i = 0; i < manifestIds.length; i += 30) {
    const ms = await getDocs(
      query(collection(firestore, 'deliveryManifests'), where(documentId(), 'in', manifestIds.slice(i, i + 30)))
    );
    ms.forEach((m) => manifests.set(m.id, m.data()));
  }
  return stops.map((d) => ({ ref: d.ref, id: d.id, data: d.data() as any, manifestDocId: d.ref.parent.parent!.id, manifest: manifests.get(d.ref.parent.parent!.id) }));
}

function photosOfStop(s: Awaited<ReturnType<typeof loadPodStops>>[number]): ArchivePhoto[] {
  const st = s.data;
  const base = {
    manifestDocId: s.manifestDocId,
    manifestId: s.manifest?.manifestId,
    placa: s.manifest?.resource,
    driver: s.manifest?.driver,
    stopId: s.id,
    storeName: String(st.storeName || st.destino || 'SIN_TIENDA'),
    numerosTF: Array.isArray(st.numerosTF) ? st.numerosTF.map(String) : [],
  };
  const out: ArchivePhoto[] = [];
  (Array.isArray(st.photos) ? st.photos : []).forEach((p: any) => {
    if (!p?.path) return;
    out.push({
      ...base,
      path: p.path,
      url: p.url,
      category: p.category,
      stopStatus: String(st.status || ''),
      receivedByName: st.receivedByName,
      completedAt: iso(st.completedAt),
      completedByName: st.completedByName,
      lat: st.gps?.lat,
      lng: st.gps?.lng,
      distanceM: st.distanceM,
      archived: !!p.archived,
      archivedFile: p.archivedFile,
    });
  });
  (Array.isArray(st.rejections) ? st.rejections : []).forEach((r: any) => {
    const prev = r?.previous || {};
    (Array.isArray(prev.photos) ? prev.photos : []).forEach((p: any) => {
      if (!p?.path) return;
      out.push({
        ...base,
        path: p.path,
        url: p.url,
        category: p.category,
        stopStatus: String(prev.status || ''),
        receivedByName: prev.receivedByName ?? undefined,
        completedAt: iso(prev.completedAt),
        completedByName: prev.completedByName ?? undefined,
        lat: prev.gps?.lat,
        lng: prev.gps?.lng,
        distanceM: prev.distanceM ?? undefined,
        rejected: true,
        rejectionNote: r.note,
        archived: !!p.archived,
        archivedFile: p.archivedFile,
      });
    });
  });
  return out;
}

/** Meses con fotos de la app y/o pruebas Quick, con su estado de respaldo. */
export async function getPodArchiveMonths(): Promise<{ data?: ArchiveMonthSummary[]; error?: string }> {
  try {
    const [stops, legacySnap, archivesSnap] = await Promise.all([
      loadPodStops(),
      getDocs(collection(firestore, QUICK_LEGACY_COLLECTION)),
      getDocs(collection(firestore, ARCHIVE_COLLECTION)),
    ]);
    const months = new Map<string, ArchiveMonthSummary>();
    const get = (month: string) => {
      if (!months.has(month)) {
        months.set(month, { month, appPhotos: 0, rejectedPhotos: 0, archivedPhotos: 0, stops: 0, quickTfs: 0, quickLinks: 0 });
      }
      return months.get(month)!;
    };
    stops.forEach((s) => {
      const seen = new Set<string>();
      photosOfStop(s).forEach((p) => {
        const month = monthOfPath(p.path);
        if (!month) return;
        const m = get(month);
        if (p.archived) m.archivedPhotos++;
        else if (p.rejected) m.rejectedPhotos++;
        else m.appPhotos++;
        if (!seen.has(month)) {
          seen.add(month);
          m.stops++;
        }
      });
    });
    legacySnap.forEach((d) => {
      const r = d.data() as any;
      const f = toDate(r.fechaFinalizado);
      if (!f) return;
      const m = get(monthOfDate(f));
      m.quickTfs++;
      m.quickLinks += Array.isArray(r.evidenceLinks) ? r.evidenceLinks.length : 0;
    });
    archivesSnap.forEach((d) => {
      const a = d.data() as any;
      const m = get(d.id);
      m.appBackedUpAt = iso(a.appBackedUpAt);
      m.appBackedUpByName = a.appBackedUpByName;
      m.appBackedUpCount = Number(a.appBackedUpCount || 0);
      m.lastDownloadAt = iso(a.lastDownloadAt);
      m.lastDownloadByName = a.lastDownloadByName;
      m.lastDownloadMode = a.lastDownloadMode;
      m.releasedAt = iso(a.releasedAt);
      m.releasedByName = a.releasedByName;
    });
    return { data: Array.from(months.values()).sort((a, b) => b.month.localeCompare(a.month)) };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar los meses.' };
  }
}

/** Fotos de la app (incluye registros rechazados) y pruebas Quick del mes. */
export async function getPodArchiveMonth(
  month: string
): Promise<{ photos?: ArchivePhoto[]; quick?: ArchiveQuick[]; error?: string }> {
  try {
    const stops = await loadPodStops();
    const photos = stops.flatMap(photosOfStop).filter((p) => monthOfPath(p.path) === month);
    const [y, mo] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, mo - 1, 1) - 86400000);
    const to = new Date(Date.UTC(y, mo, 1) + 86400000);
    const legacySnap = await getDocs(
      query(
        collection(firestore, QUICK_LEGACY_COLLECTION),
        where('fechaFinalizado', '>=', Timestamp.fromDate(from)),
        where('fechaFinalizado', '<', Timestamp.fromDate(to))
      )
    );
    const quick: ArchiveQuick[] = [];
    legacySnap.forEach((d) => {
      const r = d.data() as any;
      const f = toDate(r.fechaFinalizado);
      if (!f || monthOfDate(f) !== month) return;
      quick.push({
        id: d.id,
        numeroTF: String(r.numeroTF || ''),
        bodegaDestino: String(r.bodegaDestino || ''),
        fechaFinalizado: f.toISOString(),
        placaEntrega: r.placaEntrega || undefined,
        links: Array.isArray(r.evidenceLinks) ? r.evidenceLinks.filter((l: unknown) => typeof l === 'string') : [],
      });
    });
    return { photos, quick };
  } catch (error: any) {
    return { error: error.message || 'No se pudo cargar el mes.' };
  }
}

export async function markPodArchiveDownloaded(input: {
  month: string;
  mode: 'carpeta' | 'zip';
  appOk: number;
  appFailed: number;
  quickOk: number;
  quickFailed: number;
  actor: TransferActor;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const now = Timestamp.now();
    const name = (input.actor.displayName || '').trim() || input.actor.userId;
    const entry = {
      at: now,
      byName: name,
      mode: input.mode,
      appOk: input.appOk,
      appFailed: input.appFailed,
      quickOk: input.quickOk,
      quickFailed: input.quickFailed,
    };
    await setDoc(
      doc(firestore, ARCHIVE_COLLECTION, input.month),
      {
        month: input.month,
        lastDownloadAt: now,
        lastDownloadByName: name,
        lastDownloadMode: input.mode,
        downloads: arrayUnion(entry),
        ...(input.appOk > 0 && input.appFailed === 0
          ? { appBackedUpAt: now, appBackedUpByName: name, appBackedUpCount: input.appOk }
          : {}),
      },
      { merge: true }
    );
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo registrar la descarga.' };
  }
}

/**
 * Tras borrar las fotos del Storage: marca cada foto como archivada con su archivo local
 * y quita los links de la app de la plataforma TF (quedan los de Quick).
 */
export async function markPodMonthReleased(input: {
  month: string;
  /** path de Storage -> archivo relativo en la carpeta/ZIP */
  files: Record<string, string>;
  deleted: number;
  actor: TransferActor;
}): Promise<{ success: boolean; stops?: number; error?: string }> {
  try {
    const name = (input.actor.displayName || '').trim() || input.actor.userId;
    const now = Timestamp.now();
    const archive = (p: any) =>
      p?.path && input.files[p.path] ? { ...p, archived: true, archivedFile: input.files[p.path], url: '' } : p;

    const stops = await loadPodStops();
    const touched: Array<{ ref: (typeof stops)[number]['ref']; update: Record<string, any> }> = [];
    const releasedStops = new Set<string>();
    stops.forEach((s) => {
      const st = s.data;
      const photos = Array.isArray(st.photos) ? st.photos : [];
      const rejections = Array.isArray(st.rejections) ? st.rejections : [];
      const hit = (p: any) => !!(p?.path && input.files[p.path]);
      const photosHit = photos.some(hit);
      const rejHit = rejections.some((r: any) => (r?.previous?.photos || []).some(hit));
      if (!photosHit && !rejHit) return;
      const update: Record<string, any> = { photosArchivedAt: now };
      if (photosHit) {
        update.photos = photos.map(archive);
        releasedStops.add(`${s.manifestDocId}|${s.id}`);
      }
      if (rejHit) {
        update.rejections = rejections.map((r: any) =>
          r?.previous?.photos ? { ...r, previous: { ...r.previous, photos: r.previous.photos.map(archive) } } : r
        );
      }
      touched.push({ ref: s.ref, update });
    });
    for (let i = 0; i < touched.length; i += 400) {
      const batch = writeBatch(firestore);
      touched.slice(i, i + 400).forEach((t) => batch.update(t.ref, t.update));
      await batch.commit();
    }

    const platformSnap = await getDocs(query(collection(firestore, PLATFORM_COLLECTION), where('podSource', '==', 'app')));
    const platformDocs = platformSnap.docs.filter((d) => {
      const pod = (d.data() as any).pod;
      return pod && releasedStops.has(`${pod.manifestDocId}|${pod.stopId}`);
    });
    for (let i = 0; i < platformDocs.length; i += 400) {
      const batch = writeBatch(firestore);
      platformDocs.slice(i, i + 400).forEach((d) => {
        const r = d.data() as any;
        batch.set(
          d.ref,
          { evidenceLinks: Array.isArray(r.quickEvidenceLinks) ? r.quickEvidenceLinks : [], podPhotosArchived: true, updatedAt: now },
          { merge: true }
        );
      });
      await batch.commit();
    }

    await setDoc(
      doc(firestore, ARCHIVE_COLLECTION, input.month),
      { month: input.month, releasedAt: now, releasedByName: name, releasedPhotos: input.deleted },
      { merge: true }
    );
    return { success: true, stops: touched.length };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo marcar el mes como liberado.' };
  }
}
