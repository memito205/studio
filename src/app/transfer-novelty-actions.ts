'use server';

import { collection, addDoc, getDocs, Timestamp, doc, updateDoc, where, query, orderBy } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { TransferNovelty } from '@/types';
import { createActivityLog } from './actions';

export async function isEntryOnTime(deliveryDate: any, reportDate: any) {
  const d1 = new Date(deliveryDate);
  const d2 = new Date(reportDate);
  let businessDays = 0;
  let current = new Date(d1);
  while (current < d2) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      businessDays++;
    }
    if (businessDays > 3) return false;
  }
  return businessDays <= 3;
}

export async function saveTransferNovelty(novelty: any) {
  try {
    const enTiempo = await isEntryOnTime(novelty.fechaEntregaTienda, novelty.fechaReporteTienda);
    const docData = {
      ...novelty,
      enTiempo,
      createdAt: Timestamp.now(),
      fechaEntregaTienda: novelty.fechaEntregaTienda instanceof Date ? Timestamp.fromDate(novelty.fechaEntregaTienda) : Timestamp.fromDate(new Date(novelty.fechaEntregaTienda)),
      fechaReporteTienda: novelty.fechaReporteTienda instanceof Date ? Timestamp.fromDate(novelty.fechaReporteTienda) : Timestamp.fromDate(new Date(novelty.fechaReporteTienda)),
    };
    const docRef = await addDoc(collection(firestore, "transferNovelties"), docData);
    await createActivityLog({
      user_id: novelty.packerId || 'system',
      action_type: `NOVEDAD_TF_${novelty.numeroTF}`,
      details: {
        info: `Novedad tipo ${novelty.tipo} para TF ${novelty.numeroTF} (${novelty.almacen})`,
        packerName: novelty.packerName
      }
    });
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error("Error saving transfer novelty:", error);
    return { success: false, error: error.message };
  }
}

export async function getTransferNovelties() {
  try {
    const q = query(collection(firestore, "transferNovelties"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as TransferNovelty[];
    return { data };
  } catch (error: any) {
    console.error("Error fetching transfer novelties:", error);
    return { error: error.message };
  }
}

export async function updateTransferNoveltyStatus(id: string, updates: any) {
  try {
    const docRef = doc(firestore, "transferNovelties", id);
    await updateDoc(docRef, { ...updates, updatedAt: Timestamp.now() });
    return { success: true };
  } catch (error: any) {
    console.error("Error updating transfer novelty:", error);
    return { success: false, error: error.message };
  }
}

export async function getTransferNoveltiesByDateRange(startDate: Date, endDate: Date) {
  try {
    const q = query(
      collection(firestore, "transferNovelties"),
      where("createdAt", ">=", Timestamp.fromDate(startDate)),
      where("createdAt", "<=", Timestamp.fromDate(endDate)),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as TransferNovelty[];
    return { data };
  } catch (error: any) {
    console.error("Error fetching transfer novelties by range:", error);
    return { error: error.message };
  }
}
