// Carga inicial de códigos alternos (bulkLoad): las TF que no estaban en Recibido en Bodega quedaron con
// llegada = hora de la carga. Este script las lista y (con --apply) les pone la mejor fecha real conocida:
// primer Recolectado en Ruta / Validado Supervisor del historial, o si no hay, la fecha del documento TF.
// Uso: node scripts/fix-bulk-arrival.mjs            (solo diagnóstico, escribe scripts/out/bulk-arrival.csv)
//      node scripts/fix-bulk-arrival.mjs --apply    (corrige)
import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, documentId, doc, updateDoc, Timestamp } from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
const db = getFirestore(
  initializeApp({ apiKey: 'AIzaSyAG6vc1P9x0FoMXmXZ_005-_Br7pu7myD8', authDomain: 'suite-logistica.firebaseapp.com', projectId: 'suite-logistica' })
);

const toMs = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : v ? new Date(v).getTime() : NaN);
const fmt = (ms) => (Number.isFinite(ms) ? new Date(ms - 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');

const receipts = await getDocs(query(collection(db, 'altCodeReceipts'), where('bulkLoad', '==', true)));
const regByLine = new Map();
receipts.forEach((r) => {
  const d = r.data();
  const reg = toMs(d.registeredAt);
  (d.linkedTransferIds || []).forEach((id) => regByLine.set(id, { reg, code: d.codigoAlterno, ubic: d.ubicacion || '' }));
});
console.log(`Registros de carga inicial: ${receipts.size} · líneas TF enlazadas: ${regByLine.size}`);

const ids = [...regByLine.keys()];
const lines = [];
for (let i = 0; i < ids.length; i += 30) {
  const snap = await getDocs(query(collection(db, 'transfers'), where(documentId(), 'in', ids.slice(i, i + 30))));
  snap.forEach((d) => lines.push({ id: d.id, ref: d.ref, data: d.data() }));
}

const rows = [];
const fixes = [];
for (const { id, ref, data } of lines) {
  const { reg, code, ubic } = regByLine.get(id);
  const history = Array.isArray(data.statusHistory) ? data.statusHistory : [];
  const received = history.filter((h) => h?.status === 'Recibido en Bodega').map((h) => toMs(h.at)).sort((a, b) => a - b);
  const firstArrival = received[0];
  const affected = Number.isFinite(firstArrival) && Math.abs(firstArrival - reg) < 2000;
  const prior = history
    .filter((h) => (h?.status === 'Recolectado en Ruta' || h?.status === 'Validado Supervisor') && toMs(h.at) < reg)
    .map((h) => toMs(h.at))
    .sort((a, b) => a - b)[0];
  const docDate = toMs(data.fecha);
  const estimate = Number.isFinite(prior) ? prior : Number.isFinite(docDate) && docDate < reg ? docDate : NaN;
  const source = Number.isFinite(prior) ? 'historial (recolección/validación)' : Number.isFinite(estimate) ? 'fecha documento TF' : 'sin fecha mejor';
  rows.push({
    tf: data.numeroTF, destino: data.bodegaDestino, estado: data.status, codigo: code, ubicacion: data.ubicacion || ubic,
    afectada: affected ? 'SI' : 'no', llegadaActual: fmt(firstArrival), fechaDoc: fmt(docDate),
    nuevaLlegada: affected ? fmt(estimate) : '', fuente: affected ? source : '',
  });
  if (affected && Number.isFinite(estimate)) {
    const at = Timestamp.fromMillis(estimate);
    const newHistory = history.map((h) =>
      h?.status === 'Recibido en Bodega' && Math.abs(toMs(h.at) - reg) < 2000 ? { ...h, at, cargaInicialAt: h.at } : h
    );
    const upd = { statusHistory: newHistory, llegadaEstimadaCargaInicial: true };
    if (Math.abs(toMs(data.recibidoAt) - reg) < 2000) upd.recibidoAt = at;
    fixes.push({ ref, upd });
  }
}

fs.mkdirSync('scripts/out', { recursive: true });
const cols = ['tf', 'destino', 'estado', 'codigo', 'ubicacion', 'afectada', 'llegadaActual', 'fechaDoc', 'nuevaLlegada', 'fuente'];
fs.writeFileSync(
  'scripts/out/bulk-arrival.csv',
  '\ufeff' + [cols.join(';'), ...rows.map((r) => cols.map((c) => String(r[c] ?? '').replace(/;/g, ',')).join(';'))].join('\n')
);

const affected = rows.filter((r) => r.afectada === 'SI');
const byState = {};
affected.forEach((r) => (byState[r.estado] = (byState[r.estado] || 0) + 1));
const bySource = {};
affected.forEach((r) => (bySource[r.fuente] = (bySource[r.fuente] || 0) + 1));
console.log(`Líneas leídas: ${lines.length} · afectadas (llegada = hora de la carga): ${affected.length}`);
console.log(`TF únicas afectadas: ${new Set(affected.map((r) => `${r.tf}|${r.destino}`)).size}`);
console.log('Afectadas por estado actual:', byState);
console.log('Fuente de la nueva fecha:', bySource);
console.log('Detalle: scripts/out/bulk-arrival.csv');

if (APPLY) {
  let n = 0;
  for (const { ref, upd } of fixes) {
    await updateDoc(ref, upd);
    n++;
  }
  console.log(`Corregidas: ${n}`);
} else {
  console.log(`(Diagnóstico) Se corregirían ${fixes.length} líneas. Ejecute con --apply para aplicar.`);
}
process.exit(0);
