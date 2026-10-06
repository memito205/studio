// Ranking de lecturas Firestore por consulta (datos del medidor src/lib/firestoreMeter.ts).
// Uso: node scripts/read-meter.mjs [YYYY-MM-DD]   (por defecto hoy, hora Bogotá). Lee 20 documentos.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyAG6vc1P9x0FoMXmXZ_005-_Br7pu7myD8',
  authDomain: 'suite-logistica.firebaseapp.com',
  projectId: 'suite-logistica',
});
const day = process.argv[2] || new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const snap = await getDocs(query(collection(getFirestore(app), 'readMeter'), where('day', '==', day)));

const totals = new Map();
let total = 0;
snap.forEach((d) => {
  const q = d.data().q || {};
  for (const [k, v] of Object.entries(q)) {
    const t = totals.get(k) || { calls: 0, docs: 0 };
    t.calls += Number(v.calls || 0);
    t.docs += Number(v.docs || 0);
    totals.set(k, t);
    total += Number(v.docs || 0);
  }
});

const rows = [...totals.entries()].sort((a, b) => b[1].docs - a[1].docs).slice(0, 50);
console.log(`Día ${day}: ${total.toLocaleString('es-CO')} lecturas medidas (${snap.size} shards)\n`);
for (const [k, v] of rows) {
  const pct = total ? ((v.docs / total) * 100).toFixed(1) : '0';
  console.log(`${String(v.docs).padStart(10)}  ${pct.padStart(5)}%  ${String(v.calls).padStart(6)} llamadas  ${k}`);
}
process.exit(0);
