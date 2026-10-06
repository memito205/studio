/**
 * Reemplaza a `firebase/firestore` (alias en next.config.ts): reexporta todo y cuenta los documentos
 * que devuelve cada lectura, agrupados por colección + filtros. Se guarda en `readMeter/{día}_{shard}`
 * con pocas escrituras (acumula y envía cada 20 s en servidor / 5 min en navegador).
 * No cubre `transaction.get` (lecturas puntuales dentro de transacciones).
 */
import * as fs from '@firebase/firestore';

export * from '@firebase/firestore';

const IS_SERVER = typeof window === 'undefined';
const FLUSH_MS = IS_SERVER ? 20_000 : 300_000;
const SHARD = Math.floor(Math.random() * 20);

type Bucket = { calls: number; docs: number };
const pending = new Map<string, Bucket>();
let lastFlush = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const bogotaDay = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9_\-|=<>!,{}*+]/g, '_').slice(0, 300);

/** Generaliza ids en rutas: receptionOperations/abc/referenceStats → receptionOperations/{id}/referenceStats */
const generalize = (path: string) =>
  path
    .split('/')
    .map((seg, i) => (i % 2 === 1 ? '{id}' : seg))
    .join('/');

function describe(target: any): string {
  try {
    if (target?.type === 'document') return `${generalize(String(target.parent?.path || ''))}#doc`;
    const core = target?._query;
    const path = core?.collectionGroup
      ? `*${core.collectionGroup}`
      : generalize(String(core?.path?.canonicalString?.() ?? target?.path ?? 'desconocido'));
    const fields: string[] = [];
    const walk = (f: any) => {
      if (!f) return;
      if (f.field?.canonicalString) fields.push(`${f.field.canonicalString()}${f.op}`);
      else if (Array.isArray(f.filters)) f.filters.forEach(walk);
    };
    (core?.filters || []).forEach(walk);
    const lim = typeof core?.limit === 'number' ? `|lim${core.limit}` : '';
    return `${path}|${fields.sort().join(',')}${lim}`;
  } catch {
    return 'desconocido';
  }
}

async function flush() {
  if (flushing || pending.size === 0) return;
  flushing = true;
  timer = null;
  lastFlush = Date.now();
  const entries = Array.from(pending.entries());
  pending.clear();
  try {
    const side = IS_SERVER ? 'servidor' : 'navegador';
    let total = 0;
    const q: Record<string, { calls: fs.FieldValue; docs: fs.FieldValue }> = {};
    entries.forEach(([k, v]) => {
      total += v.docs;
      q[safeKey(`${side}|${k}`)] = { calls: fs.increment(v.calls), docs: fs.increment(v.docs) };
    });
    const day = bogotaDay();
    await fs.setDoc(
      fs.doc(fs.getFirestore(), 'readMeter', `${day}_${SHARD}`),
      { day, q, total: fs.increment(total), [side]: fs.increment(total), updatedAt: fs.serverTimestamp() },
      { merge: true }
    );
  } catch {
    /* el medidor nunca debe romper la app */
  } finally {
    flushing = false;
  }
}

function record(target: unknown, docs: number) {
  try {
    const key = describe(target);
    const b = pending.get(key) || { calls: 0, docs: 0 };
    b.calls += 1;
    b.docs += docs;
    pending.set(key, b);
    if (Date.now() - lastFlush >= FLUSH_MS) void flush();
    else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
  } catch {
    /* ignorar */
  }
}

if (!IS_SERVER) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

export const getDocs: typeof fs.getDocs = (async (q: any) => {
  const snap = await fs.getDocs(q);
  record(q, Math.max(1, snap.size));
  return snap;
}) as typeof fs.getDocs;

export const getDoc: typeof fs.getDoc = (async (ref: any) => {
  const snap = await fs.getDoc(ref);
  record(ref, 1);
  return snap;
}) as typeof fs.getDoc;

export const getCountFromServer: typeof fs.getCountFromServer = (async (q: any) => {
  const res = await fs.getCountFromServer(q);
  record(q, Math.max(1, Math.ceil(Number(res.data().count || 0) / 1000)));
  return res;
}) as typeof fs.getCountFromServer;

/** Solo cuenta snapshots del servidor: la carga inicial (todos los docs) y luego los docs que cambian. */
export const onSnapshot: typeof fs.onSnapshot = ((target: any, ...rest: any[]) => {
  const count = (snap: any) => {
    try {
      if (snap?.metadata?.fromCache) return;
      if (typeof snap?.docChanges === 'function') {
        const n = snap.docChanges().length;
        if (n > 0) record(target, n);
      } else {
        record(target, 1);
      }
    } catch {
      /* ignorar */
    }
  };
  const idx = rest.findIndex((a) => typeof a === 'function' || (a && typeof a === 'object' && typeof a.next === 'function'));
  if (idx >= 0) {
    const a = rest[idx];
    if (typeof a === 'function') {
      rest[idx] = (snap: any) => {
        count(snap);
        return a(snap);
      };
    } else {
      const next = a.next.bind(a);
      rest[idx] = { ...a, next: (snap: any) => { count(snap); return next(snap); } };
    }
  }
  return (fs.onSnapshot as any)(target, ...rest);
}) as typeof fs.onSnapshot;
