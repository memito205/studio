
"use server";

import { firestore } from "@/services/firebase";
import { runTransaction, collection, query, where, limit, getDocs, doc, setDoc } from 'firebase/firestore';
import type { ScannedItem } from "@/types";

export async function addScannedItem(item: Omit<ScannedItem, 'id' | 'created_at' | 'updated_at' | 'scanned_at' | 'quantity'>): Promise<{ success: boolean; error?: string }> {
  try {
    await runTransaction(firestore, async (transaction) => {
      const q = query(
        collection(firestore, 'scannedItems'),
        where('reception_id', '==', item.reception_id),
        where('packing_unit_id', '==', item.packing_unit_id),
        where('barcode', '==', item.barcode),
        where('user_id', '==', item.user_id),
        limit(1)
      );
      const querySnapshot = await transaction.get(q);
      
      if (!querySnapshot.empty) {
        // Item exists, update quantity
        const docSnap = querySnapshot.docs[0];
        const newQuantity = docSnap.data().quantity + 1;
        transaction.update(docSnap.ref, { quantity: newQuantity, updated_at: new Date() });
      } else {
        // Item does not exist, create new document
        const newDocRef = doc(collection(firestore, 'scannedItems'));
        transaction.set(newDocRef, {
          ...item,
          quantity: 1,
          scanned_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    });
    return { success: true };
  } catch (error: any) {
    console.error("Error adding scanned item:", error);
    return { success: false, error: `Failed to add scanned item: ${error.message}` };
  }
}

    