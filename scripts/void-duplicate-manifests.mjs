/**
 * Anula/limpia relaciones duplicadas dejando una válida.
 * Uso:
 *   node scripts/void-duplicate-manifests.mjs
 *   node scripts/void-duplicate-manifests.mjs --apply
 */
import { initializeApp } from 'firebase/app';
import {
  collection,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  getFirestore,
} from 'firebase/firestore';

const KEEP = Number(process.argv.find((a) => a.startsWith('--keep='))?.slice(7) || 1415);
const VOIDS = (
  process.argv.find((a) => a.startsWith('--void='))?.slice(7) || '1407,1408,1410,1414'
)
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n && n !== KEEP);
const APPLY = process.argv.includes('--apply');
const NOTE =
  process.argv.find((a) => a.startsWith('--note='))?.slice(7) ||
  'Error al crear varias relaciones con las mismas TF; queda solo la #1415.';

const TERMINAL = new Set([
  'Entregado en Tienda',
  'Entregado en Cajon',
  'Devuelto a Bodega',
  'Novedad de Entrega',
]);

const app = initializeApp({
  apiKey: 'AIzaSyAG6vc1P9x0FoMXmXZ_005-_Br7pu7myD8',
  authDomain: 'suite-logistica.firebaseapp.com',
  projectId: 'suite-logistica',
});
const db = getFirestore(app);

async function stripShared(manifestDocId, sharedIds, keepNum, note) {
  const manifestRef = doc(db, 'deliveryManifests', manifestDocId);
  const mSnap = await getDoc(manifestRef);
  if (!mSnap.exists()) return { removed: 0, remaining: 0 };
  const transferIds = (mSnap.data().transferIds || []).map(String);
  const remainingIds = transferIds.filter((id) => !sharedIds.has(id));
  const removed = transferIds.length - remainingIds.length;
  if (removed === 0) return { removed: 0, remaining: remainingIds.length };

  const stopsSnap = await getDocs(collection(db, 'deliveryManifests', manifestDocId, 'stops'));
  const plans = stopsSnap.docs.map((d) => {
    const s = d.data();
    const prev = (s.transferIds || []).map(String);
    return { ref: d.ref, stopTfs: prev.filter((id) => !sharedIds.has(id)), status: s.status || 'pendiente', storeCode: s.storeCode, s };
  });
  const lookup = Array.from(new Set(plans.flatMap((p) => p.stopTfs)));
  const meta = new Map();
  for (let i = 0; i < lookup.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'transfers'), where(documentId(), 'in', lookup.slice(i, i + 30))));
    snap.docs.forEach((d) => meta.set(d.id, { numeroTF: String(d.data().numeroTF || '').trim(), cantidad: Number(d.data().cantidad) || 0 }));
  }

  const batch = writeBatch(db);
  let stopsCount = 0;
  let stopsDone = 0;
  const storeOpenCodes = [];
  for (const p of plans) {
    if (p.stopTfs.length === 0) {
      batch.delete(p.ref);
      continue;
    }
    const numerosTF = Array.from(new Set(p.stopTfs.map((id) => meta.get(id)?.numeroTF).filter(Boolean)));
    const unidades = p.stopTfs.reduce((n, id) => n + (meta.get(id)?.cantidad || 0), 0);
    stopsCount++;
    if (p.status !== 'pendiente') stopsDone++;
    if (p.storeCode && p.status === 'pendiente') storeOpenCodes.push(String(p.storeCode));
    batch.update(p.ref, { transferIds: p.stopTfs, numerosTF, unidades });
  }
  const now = Timestamp.now();
  batch.update(manifestRef, {
    transferIds: remainingIds,
    stopsCount,
    stopsDone,
    storeOpenCodes: Array.from(new Set(storeOpenCodes)),
    strippedSharedOfManifestId: keepNum,
    strippedSharedAt: now,
    strippedSharedByName: 'script void-duplicate-manifests',
    strippedSharedNote: note.slice(0, 500),
  });
  await batch.commit();
  return { removed, remaining: remainingIds.length };
}

async function main() {
  const allNums = [KEEP, ...VOIDS];
  const byNumber = new Map();
  for (let i = 0; i < allNums.length; i += 30) {
    const snap = await getDocs(
      query(collection(db, 'deliveryManifests'), where('manifestId', 'in', allNums.slice(i, i + 30)))
    );
    snap.docs.forEach((d) => byNumber.set(Number(d.data().manifestId), { id: d.id, data: d.data() }));
  }
  const keep = byNumber.get(KEEP);
  if (!keep) throw new Error(`No existe #${KEEP}`);
  const keepTfs = new Set((keep.data.transferIds || []).map(String));
  console.log(`KEEP #${KEEP} ${keep.id} status=${keep.data.deliveryStatus} tfs=${keepTfs.size}`);

  const exclusiveIds = [];
  for (const n of VOIDS) {
    const m = byNumber.get(n);
    if (!m) throw new Error(`No existe #${n}`);
    for (const id of (m.data.transferIds || []).map(String)) {
      if (!keepTfs.has(id)) exclusiveIds.push(id);
    }
  }
  const exclusiveStatus = new Map();
  const uniqEx = Array.from(new Set(exclusiveIds));
  for (let i = 0; i < uniqEx.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'transfers'), where(documentId(), 'in', uniqEx.slice(i, i + 30))));
    snap.docs.forEach((d) => exclusiveStatus.set(d.id, String(d.data().status || '')));
  }

  const plans = VOIDS.map((n) => {
    const m = byNumber.get(n);
    const ids = (m.data.transferIds || []).map(String);
    const shared = ids.filter((id) => keepTfs.has(id));
    const exclusive = ids.filter((id) => !keepTfs.has(id));
    const exclusiveLive = exclusive.filter((id) => !TERMINAL.has(exclusiveStatus.get(id) || ''));
    const status = m.data.deliveryStatus || 'en_ruta';
    let action = 'close';
    if (status === 'cerrada') action = 'mark_only';
    else if (exclusiveLive.length > 0) action = 'strip_shared';
    console.log(`#${n} overlap=${shared.length}/${ids.length} exclusiveLive=${exclusiveLive.length} → ${action}`);
    return { n, id: m.id, data: m.data, ids, shared, action };
  });

  let transfersToFix = 0;
  const keepList = Array.from(keepTfs);
  for (let i = 0; i < keepList.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'transfers'), where(documentId(), 'in', keepList.slice(i, i + 30))));
    snap.docs.forEach((d) => {
      if (String(d.data().podManifestDocId || '') !== keep.id || Number(d.data().manifestId) !== KEEP) transfersToFix++;
    });
  }
  console.log(`TF keep a alinear: ${transfersToFix}`);

  if (!APPLY) {
    console.log('\nDry-run OK. Use --apply para escribir.');
    process.exit(0);
  }

  const now = Timestamp.now();
  const closeNote = `Duplicado de relación #${KEEP}. ${NOTE}`.slice(0, 500);
  for (const p of plans) {
    if (p.action === 'mark_only') {
      await updateDoc(doc(db, 'deliveryManifests', p.id), {
        duplicateOfManifestId: KEEP,
        duplicateVoidedAt: now,
        duplicateVoidedByName: 'script void-duplicate-manifests',
        closedNote: closeNote,
      });
      console.log(`Marcada #${p.n}`);
      continue;
    }
    if (p.action === 'strip_shared') {
      const r = await stripShared(p.id, keepTfs, KEEP, NOTE);
      console.log(`Limpiada #${p.n}: quitadas ${r.removed}, quedan ${r.remaining}`);
      continue;
    }
    await updateDoc(doc(db, 'deliveryManifests', p.id), {
      deliveryStatus: 'cerrada',
      closedWithoutApp: true,
      closedAt: now,
      closedById: 'script',
      closedByName: 'script void-duplicate-manifests',
      closedNote: closeNote,
      duplicateOfManifestId: KEEP,
      duplicateVoidedAt: now,
      duplicateVoidedByName: 'script void-duplicate-manifests',
      storeOpenCodes: [],
      driverUserId: deleteField(),
    });
    console.log(`Cerrada #${p.n}`);
  }

  // alinear solo TF de la válida
  const fixIds = [];
  for (let i = 0; i < keepList.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'transfers'), where(documentId(), 'in', keepList.slice(i, i + 30))));
    snap.docs.forEach((d) => {
      if (String(d.data().podManifestDocId || '') !== keep.id || Number(d.data().manifestId) !== KEEP) fixIds.push(d.id);
    });
  }
  for (let i = 0; i < fixIds.length; i += 400) {
    const batch = writeBatch(db);
    fixIds.slice(i, i + 400).forEach((id) => {
      batch.update(doc(db, 'transfers', id), { podManifestDocId: keep.id, manifestId: KEEP });
    });
    await batch.commit();
  }
  console.log(`TF alineadas: ${fixIds.length}`);
  console.log('Listo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
