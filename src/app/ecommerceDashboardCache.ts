'use server';

import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { firestore } from '@/services/firebase';

const REF = () => doc(firestore, 'systemCache', 'ecommerceDashboardLast');

/** 1 lectura. Marca de cuándo un admin generó el análisis (office solo consulta). */
export async function getEcommerceDashboardStamp(): Promise<{
  at?: string;
  byName?: string;
  error?: string;
}> {
  try {
    const snap = await getDoc(REF());
    if (!snap.exists()) return {};
    const d = snap.data();
    const at = d.at instanceof Timestamp ? d.at.toDate().toISOString() : String(d.at || '');
    return { at: at || undefined, byName: String(d.byName || '').trim() || undefined };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : 'No se pudo leer la marca del tablero.' };
  }
}

export async function saveEcommerceDashboardStamp(byName: string): Promise<void> {
  await setDoc(
    REF(),
    { at: Timestamp.now(), byName: String(byName || '').trim() || 'admin' },
    { merge: true }
  ).catch((e) => console.error('ecommerceDashboardLast:', e));
}
