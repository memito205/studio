

"use server";

import { firestore } from "@/services/firebase";
import { collection, addDoc, getDocs, Timestamp, doc, setDoc, getDoc, writeBatch, documentId, where, query, QueryDocumentSnapshot, DocumentData, updateDoc, collectionGroup, runTransaction, orderBy, limit, deleteDoc, getCountFromServer, startAt, startAfter, increment, DocumentReference, arrayUnion, arrayRemove } from 'firebase/firestore';
import { parseISO } from 'date-fns';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { normalizeHeader, parseFlexibleDate, excelSerialDateToJSDate, findCaseInsensitiveKey } from '@/lib/parsingUtils';
import type { ReceptionOperation, ScannedItem, ItemNovelty, PackingUnit, Location, CsvRow, ReceptionExpectedItem, ReceptionProduct, AlternateBarcodeUploadRow, AppUser, OperationPause, ProductivitySettings, UserGoal, PackedItem, ProductDatabaseItem, DiscardedRecord, LabelingOperation, LabelingActivityLog, LabelingActivityType, LabelingOperationStatus, PackingScanResult } from '@/types';


// Helper function to convert Dates back to Timestamps FOR WRITING to Firestore
const convertDatesToTimestamps = (data: any): any => {
    if (data instanceof Date) {
        return Timestamp.fromDate(data);
    }
    if (Array.isArray(data)) {
        return data.map(convertDatesToTimestamps);
    }
    if (data !== null && typeof data === 'object' && !data.hasOwnProperty('seconds') && !data.hasOwnProperty('_seconds')) {
        const newData: { [key:string]: any } = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                newData[key] = convertDatesToTimestamps(data[key]);
            }
        }
        return newData;
    }
    return data;
};


// Helper function to convert Timestamps from Firestore into JS Date objects
const convertTimestampsToDates = (data: any): any => {
    if (data === null || data === undefined) {
        return null;
    }
    if (data instanceof Timestamp) {
        return data.toDate(); // Convert to JS Date object
    }
    if (Array.isArray(data)) {
        return data.map(convertTimestampsToDates);
    }
    if (typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
        const newData: { [key:string]: any } = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                newData[key] = convertTimestampsToDates(data[key]);
            }
        }
        return newData;
    }
    return data;
};

// --- Product Database Actions ---
export async function getAllProducts(): Promise<{ success: boolean; data?: ReceptionProduct[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "productDatabase"));
        const products = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                created_at: (data.created_at as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
                updated_at: (data.updated_at as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
            } as ReceptionProduct;
        });
        return { success: true, data: products };
    } catch (error: any) {
        console.error("Error loading all products:", error);
        return { success: false, error: `Failed to load all products: ${error.message}` };
    }
}

export async function getProductsByBarcodes(barcodes: string[]): Promise<{ data?: ProductDatabaseItem[]; error?: string }> {
  if (!barcodes || barcodes.length === 0) {
    return { data: [] };
  }
  const products: ProductDatabaseItem[] = [];
  const productCollection = collection(firestore, "productDatabase");
  
  // Firestore 'in' query supports up to 30 elements
  for (let i = 0; i < barcodes.length; i += 30) {
      const batchBarcodes = barcodes.slice(i, i + 30);
      try {
          const q = query(productCollection, where(documentId(), "in", batchBarcodes));
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach(docSnap => {
              products.push({
                  id: docSnap.id,
                  codigoBarras: docSnap.id,
                  ...(convertTimestampsToDates(docSnap.data()) as any)
              });
          });
      } catch (error: any) {
          console.error("Error fetching product batch:", error);
          return { error: `Error al consultar la base de datos de productos: ${error.message}` };
      }
  }
  return { data: products };
}

export async function deleteProduct(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await deleteDoc(doc(firestore, 'productDatabase', productId));
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to delete product: ${error.message}` };
    }
}

export async function createProduct(productData: Omit<ReceptionProduct, 'id' | 'created_at' | 'updated_at' | 'user_id'>): Promise<{ success: boolean; error?: string }> {
    try {
        const productRef = doc(firestore, 'productDatabase', productData.barcode);
        const docSnap = await getDoc(productRef);
        if (docSnap.exists()) {
            return { success: false, error: 'Ya existe un producto con este código de barras.' };
        }
        await setDoc(productRef, {
            ...productData,
            created_at: Timestamp.now(),
            updated_at: Timestamp.now(),
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to create product: ${error.message}` };
    }
}

export async function bulkCreateProducts(products: ProductDatabaseItem[]): Promise<{ success: boolean; summary?: { successCount: number; failedCount: number }; errors?: string[]; error?: string }> {
    if (!products || products.length === 0) {
        return { success: false, error: 'No se proporcionaron productos para la carga masiva.' };
    }
    
    const dbCollection = collection(firestore, 'productDatabase');
    const CHUNK_SIZE = 450;
    let successCount = 0;
    
    try {
      for(let i = 0; i < products.length; i += CHUNK_SIZE) {
        const chunk = products.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(firestore);
        
        chunk.forEach(product => {
            if (product.codigoBarras) {
                const docRef = doc(dbCollection, product.codigoBarras);
                batch.set(docRef, { ...product, updated_at: Timestamp.now() }, { merge: true });
                successCount++;
            }
        });
        await batch.commit();
      }
      return { success: true, summary: { successCount, failedCount: 0 } };
    } catch (error: any) {
        console.error('Error en la carga masiva de productos:', error);
        return { success: false, error: error.message };
    }
}

export async function updateProduct(productId: string, updates: Partial<Omit<ReceptionProduct, 'id' | 'barcode' | 'created_at' | 'updated_at' | 'user_id'>>): Promise<{ success: boolean; error?: string }> {
    if (!productId) return { success: false, error: 'El ID del producto es inválido.' };
    try {
        const productRef = doc(firestore, 'productDatabase', productId);
        await updateDoc(productRef, { ...updates, updated_at: Timestamp.now() });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to update product: ${error.message}` };
    }
}

export async function lookupBarcode(barcode: string, operationId?: string): Promise<PackingScanResult> {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return { status: 'error', message: 'El código de barras no puede estar vacío.', scannedBarcode: trimmedBarcode };

    try {
        // First, try to find in the main product database
        const docRef = doc(firestore, "productDatabase", trimmedBarcode);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const item: ProductDatabaseItem = {
              ...(convertTimestampsToDates(docSnap.data()) as Omit<ProductDatabaseItem, 'id'>),
              id: docSnap.id,
              codigoBarras: docSnap.id,
            };
            return { status: 'success', message: `Producto encontrado: ${item.referencia}`, scannedBarcode: trimmedBarcode, item };
        }
        
        // If not found and an operationId is provided, fallback to expectedItems
        if (operationId) {
            const opRef = doc(firestore, 'receptionOperations', operationId);
            const opSnap = await getDoc(opRef);
            if (opSnap.exists()) {
                const operationData = opSnap.data() as ReceptionOperation;
                const expectedItem = (operationData.expectedItems || []).find(item => item.barcode === trimmedBarcode);

                if (expectedItem) {
                    // We found it in the expected list. Treat it as a success but maybe flag it.
                    const item: ProductDatabaseItem = {
                        id: trimmedBarcode,
                        codigoBarras: trimmedBarcode,
                        referencia: expectedItem.reference,
                        talla: expectedItem.size,
                        item: expectedItem.item,
                        marca: undefined, // Or try to deduce
                    };
                    return { status: 'success', message: `Producto encontrado en la orden: ${item.referencia}`, scannedBarcode: trimmedBarcode, item };
                }
            }
        }
        
        // If not found in either place
        return { status: 'error', message: 'Código de barras no encontrado en el catálogo ni en la orden.', scannedBarcode: trimmedBarcode };

    } catch (error: any) {
        return { status: 'error', message: `Error de servidor: ${error.message}`, scannedBarcode: trimmedBarcode };
    }
}


export async function getProductByRefAndSize(reference: string, size: string): Promise<PackingScanResult> {
    try {
        const sizeAsNumber = parseFloat(size);
        const queries = [];

        // Query for string match (always useful for non-numeric sizes)
        const q_string = query(
            collection(firestore, "productDatabase"), 
            where("referencia", "==", reference), 
            where("talla", "==", size), 
            limit(1)
        );
        queries.push(getDocs(q_string));
        
        // If size is a valid number, also query for a number match
        if (!isNaN(sizeAsNumber)) {
            const q_number = query(
                collection(firestore, "productDatabase"), 
                where("referencia", "==", reference), 
                where("talla", "==", sizeAsNumber), 
                limit(1)
            );
            queries.push(getDocs(q_number));
        }

        const snapshots = await Promise.all(queries);

        for (const snapshot of snapshots) {
            if (!snapshot.empty) {
                const docSnap = snapshot.docs[0];
                const item: ProductDatabaseItem = {
                    ...(convertTimestampsToDates(docSnap.data()) as Omit<ProductDatabaseItem, 'id'>),
                    id: docSnap.id,
                    codigoBarras: docSnap.id,
                };
                return { status: 'success', message: `Producto encontrado: ${item.referencia}`, scannedBarcode: item.codigoBarras, item };
            }
        }

        // If no results from any query
        return { status: 'error', message: `No se encontró producto para la referencia ${reference} y talla ${size}.`, scannedBarcode: '' };
        
    } catch (error: any) {
        if ((error as any).code === 'failed-precondition') {
            return { status: 'error', message: `Error de Firebase: ${(error as any).message}. Este error indica que la consulta requiere un índice que no existe. Por favor, revise la consola de Firebase para crear el índice sugerido.`, scannedBarcode: '' };
        }
        return { status: 'error', message: `Error de servidor: ${(error as any).message}`, scannedBarcode: '' };
    }
}

export async function bulkCreateAlternateBarcodes(rows: AlternateBarcodeUploadRow[]): Promise<{ success: boolean; summary?: { successCount: number; failedCount: number }; errors?: string[]; error?: string }> {
    let successCount = 0, failedCount = 0;
    const errors: string[] = [];
    for (const row of rows) {
        try {
            const mainProductResult = await getProductByRefAndSize(row.referencia, row.talla);
            if (mainProductResult.status !== 'success' || !mainProductResult.item) {
                errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: Producto principal no encontrado.`);
                failedCount++;
                continue;
            }
            const alternateBarcode = row.codigo_alterno.trim();
            const alternateExistsResult = await lookupBarcode(alternateBarcode.trim());
            if (alternateExistsResult.status === 'success') {
                errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: El código alterno ${alternateBarcode} ya existe.`);
                failedCount++;
                continue;
            }
            const { item: mainProduct } = mainProductResult;
            const newProductData: Omit<ReceptionProduct, 'id' | 'created_at' | 'updated_at' | 'user_id'> = {
                name: mainProduct.name || mainProduct.item || '',
                barcode: alternateBarcode,
                description: mainProduct.description || null,
                reference: mainProduct.reference || mainProduct.referencia || '',
                size: mainProduct.size || mainProduct.talla || '',
                merchandise_type: mainProduct.merchandise_type || mainProduct.marca || null,
                location: mainProduct.location || null,
            };
            const createResult = await createProduct(newProductData);
            if (createResult.success) successCount++;
            else {
                errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: Error al crear: ${createResult.error}`);
                failedCount++;
            }
        } catch (e: any) {
            errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: Error inesperado - ${e.message}`);
            failedCount++;
        }
    }
    return { success: true, summary: { successCount, failedCount }, errors };
}

// --- Reception Operation Actions ---

export async function createReceptionOperation(operationData: Omit<ReceptionOperation, 'id' | 'created_at' | 'updated_at' | 'user_id' | 'status' | 'expectedItems' | 'totalScannedQuantity'>, userId: string): Promise<{ success: boolean; error?: string, id?: string }> {
    try {
        const newOperation = {
            ...operationData,
            status: 'pending' as 'pending',
            user_id: userId,
            expectedItems: [],
            totalScannedQuantity: 0,
            created_at: Timestamp.now(),
            updated_at: Timestamp.now(),
        };
        const docRef = await addDoc(collection(firestore, 'receptionOperations'), newOperation);
        return { success: true, id: docRef.id };
    } catch (error: any) {
        return { success: false, error: `Failed to create reception operation: ${error.message}` };
    }
}

export async function getReceptionOperationById(operationId: string): Promise<{ success: boolean; data?: ReceptionOperation; error?: string; }> {
    try {
        if (!operationId) return { success: false, error: "ID de operación no proporcionado." };
        const opRef = doc(firestore, 'receptionOperations', operationId);
        const docSnap = await getDoc(opRef);
        if (docSnap.exists()) {
            return { success: true, data: { id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as ReceptionOperation };
        } else {
            return { success: false, error: "No se encontró la operación con el ID proporcionado." };
        }
    } catch (error: any) {
        return { success: false, error: `Error al buscar la operación: ${error.message}` };
    }
}

export async function getExpectedItemsByReception(operationId: string): Promise<{ success: boolean; data?: ReceptionExpectedItem[]; error?: string; }> {
    try {
        if (!operationId) return { success: false, error: "ID de operación no proporcionado." };
        const opRef = doc(firestore, 'receptionOperations', operationId);
        const docSnap = await getDoc(opRef);
        if (docSnap.exists()) {
            return { success: true, data: (docSnap.data().expectedItems || []) as ReceptionExpectedItem[] };
        } else {
            return { success: false, error: "No se encontró la operación con el ID proporcionado." };
        }
    } catch (error: any) {
        return { success: false, error: `Error al buscar los ítems esperados: ${error.message}` };
    }
}

export async function updateReceptionOperation(operationId: string, updates: Partial<Omit<ReceptionOperation, 'id' | 'created_at' | 'updated_at' | 'user_id' | 'rk_identifier'>>): Promise<{ success: boolean; error?: string }> {
  try {
    const operationRef = doc(firestore, 'receptionOperations', operationId);
    const dataToUpdate = convertDatesToTimestamps(updates);
    await updateDoc(operationRef, { ...dataToUpdate, updated_at: Timestamp.now() });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Failed to update reception operation: ${error.message}` };
  }
}

export async function loadReceptionOperations(options?: {
    limit?: number,
    startAfterDoc?: QueryDocumentSnapshot<DocumentData>,
    statusFilter?: Array<'pending' | 'in_progress' | 'completed' | 'cancelled'>
}): Promise<{ success: boolean; data?: { operations: ReceptionOperation[], lastVisible?: QueryDocumentSnapshot<DocumentData> }; error?: string }> {
    try {
        const opsRef = collection(firestore, 'receptionOperations');
        let q = query(opsRef, orderBy('created_at', 'desc'));
        
        const querySnapshot = await getDocs(q);
        
        let allOperations: ReceptionOperation[] = [];
        querySnapshot.forEach(doc => {
            allOperations.push({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as ReceptionOperation);
        });

        if (options?.statusFilter && options.statusFilter.length > 0) {
            allOperations = allOperations.filter(op => options.statusFilter!.includes(op.status));
        }

        let paginatedOperations = allOperations;
        if (options?.limit) {
            paginatedOperations = allOperations.slice(0, options.limit);
        }

        return { success: true, data: { operations: paginatedOperations } };

    } catch (error: any) {
        console.error("Error loading reception operations:", error);
        return { success: false, error: `Failed to load reception operations: ${error.message}` };
    }
}
    
export async function getLocations(): Promise<{ success: boolean; data?: Location[]; error?: string; }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "locations"));
        const locations = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as Location));
        return { success: true, data: locations };
    } catch (error: any) {
        return { success: false, error: `Failed to load locations: ${error.message}` };
    }
}

export async function getAllUserProfiles(): Promise<AppUser[]> {
    try {
        const usersCollection = await getDocs(collection(firestore, "users"));
        if (usersCollection.empty) {
            return [];
        }
        return usersCollection.docs.map(doc => ({
            uid: doc.id,
            ...doc.data()
        })) as AppUser[];
    } catch (error) {
        console.error("Error getting user profiles:", error);
        return [];
    }
}

export async function getScannedItemsByReception(receptionId: string): Promise<{ success: boolean; data?: ScannedItem[]; error?: string; }> {
    try {
        if (!receptionId) return { success: false, error: "ID de recepción no proporcionado." };
        const q = query(collection(firestore, "scannedItems"), where("reception_id", "==", receptionId));
        const querySnapshot = await getDocs(q);
        const items = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as ScannedItem));
        return { success: true, data: items };
    } catch (error: any) {
        return { success: false, error: `Error al buscar ítems escaneados: ${error.message}` };
    }
}

export async function getAllScannedItems(): Promise<{ success: boolean; data?: ScannedItem[]; error?: string; }> {
    try {
        const q = query(collection(firestore, "scannedItems"));
        const querySnapshot = await getDocs(q);
        const items = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as ScannedItem));
        return { success: true, data: items };
    } catch (error: any) {
        return { success: false, error: `Error al buscar ítems escaneados: ${error.message}` };
    }
}

export async function exportBasicOperationReport(operationId: string): Promise<{
  success: boolean;
  sheets?: { sheetName: string; data: any[] }[];
  error?: string;
}> {
  try {
    if (!operationId) {
      return { success: false, error: "ID de operación no proporcionado." };
    }

    const [scannedItemsResult, operationResult, packingUnitsResult] = await Promise.all([
      getScannedItemsByReception(operationId),
      getReceptionOperationById(operationId),
      getPackingUnitsForOperation(operationId),
    ]);

    if (!scannedItemsResult.success) return { success: false, error: scannedItemsResult.error };
    if (!operationResult.success || !operationResult.data) return { success: false, error: operationResult.error || "Operación no encontrada." };
    if (!packingUnitsResult.success || !packingUnitsResult.data) return { success: false, error: packingUnitsResult.error || "Unidades de empaque no encontradas." };

    const scannedItems = scannedItemsResult.data || [];
    const expectedItems = operationResult.data.expectedItems || [];
    const packingUnits = packingUnitsResult.data || [];
    const packingUnitIdMap = new Map(packingUnits.map(u => [u.firestoreId, u]));
    
    const locationMapForThisOperation = new Map<string, string>();
    expectedItems.forEach(item => {
        if (item.reference && item.location) {
            locationMapForThisOperation.set(item.reference.trim(), item.location);
        }
    });

    const allBarcodes = [...new Set([
        ...scannedItems.map(item => item.barcode),
        ...expectedItems.map(item => item.barcode)
    ])];

    const productsResult = await getProductsByBarcodes(allBarcodes);
    if (productsResult.error) return { success: false, error: productsResult.error };
    const productMap = new Map(productsResult.data?.map(p => [p.codigoBarras, p]));

    const allItems = new Map<string, {
      expected: number;
      scanned: number;
      ref: string;
      talla: string;
      name: string;
      barcodes: Set<string>;
    }>();

    expectedItems.forEach(item => {
      const product = productMap.get(item.barcode);
      const key = `${item.reference}-${item.size}`;
      const existing = allItems.get(key) || { expected: 0, scanned: 0, ref: item.reference, talla: item.size, name: product?.item || item.item, barcodes: new Set() };
      existing.expected += item.expected_quantity;
      existing.barcodes.add(item.barcode);
      allItems.set(key, existing);
    });

    scannedItems.forEach(item => {
      const product = productMap.get(item.barcode);
      const key = `${item.reference}-${item.talla}`;
      const existing = allItems.get(key) || { expected: 0, scanned: 0, ref: item.reference, talla: item.talla, name: product?.item || item.item, barcodes: new Set() };
      existing.scanned += item.quantity;
      if (!existing.ref) existing.ref = item.reference;
      if (!existing.talla) existing.talla = item.talla;
      if (!existing.name) existing.name = product?.item || item.item;
      existing.barcodes.add(item.barcode);
      allItems.set(key, existing);
    });

    const detailedData = Array.from(allItems.values()).map(item => ({
      'Referencia': item.ref,
      'Talla': item.talla,
      'Nombre Producto': item.name,
      'Cant. Esperada': item.expected,
      'Cant. Leída': item.scanned,
      'Diferencia': item.scanned - item.expected,
      'Estado': (item.scanned - item.expected) === 0 ? 'OK' : (item.scanned > item.expected ? 'Sobrante' : 'Faltante')
    }));

    const consolidatedMap = new Map<string, { expected: number; scanned: number; name: string }>();
    allItems.forEach(item => {
      const key = item.ref;
      const existing = consolidatedMap.get(key) || { expected: 0, scanned: 0, name: item.name };
      existing.expected += item.expected;
      existing.scanned += item.scanned;
      if (!existing.name && item.name) existing.name = item.name;
      consolidatedMap.set(key, existing);
    });

    const consolidatedData = Array.from(consolidatedMap.entries()).map(([ref, data]) => ({
      'Referencia': ref,
      'Nombre Producto': data.name,
      'Ubicación': locationMapForThisOperation.get(ref.trim()) || 'N/A',
      'Total Esperado': data.expected,
      'Total Leído': data.scanned,
      'Diferencia Total': data.scanned - data.expected,
    }));

    // --- New Logic for Sheet 3: Traceability by Box ---
    // 1. Pre-calculate total items per box
    const packingUnitTotals = new Map<number, number>();
    scannedItems.forEach(item => {
        const box = packingUnitIdMap.get(item.packing_unit_id);
        if (box) {
            packingUnitTotals.set(box.id, (packingUnitTotals.get(box.id) || 0) + item.quantity);
        }
    });

    // 2. Build the detailed traceability map
    const traceabilityMap = new Map<string, { 
      'Numero de Caja': number;
      'Destino': string;
      'Referencia': string;
      'Talla': string;
      'Ubicacion': string;
      'Cantidad por Talla': number;
      'Total Unidades en Caja': number;
    }>();

    scannedItems.forEach(item => {
        const box = packingUnitIdMap.get(item.packing_unit_id);
        if (!box) return;

        const key = `${box.id}-${item.reference}-${item.talla}`;
        let entry = traceabilityMap.get(key);
        
        if (!entry) {
            entry = {
                'Numero de Caja': box.id,
                'Destino': box.destination || 'N/A',
                'Referencia': item.reference,
                'Talla': item.talla,
                'Ubicacion': locationMapForThisOperation.get(item.reference.trim()) || 'N/A',
                'Cantidad por Talla': 0,
                'Total Unidades en Caja': packingUnitTotals.get(box.id) || 0,
            };
            traceabilityMap.set(key, entry);
        }
        entry['Cantidad por Talla'] += item.quantity;
    });

    const traceabilityData = Array.from(traceabilityMap.values()).sort((a,b) => {
        if(a['Numero de Caja'] !== b['Numero de Caja']) {
            return a['Numero de Caja'] - b['Numero de Caja'];
        }
        if (a.Referencia !== b.Referencia) {
            return a.Referencia.localeCompare(b.Referencia);
        }
        return a.Talla.localeCompare(b.Talla);
    });

    return {
      success: true,
      sheets: [
        { sheetName: 'Resumen por Referencia', data: consolidatedData },
        { sheetName: 'Detalle por Talla', data: detailedData },
        { sheetName: 'Trazabilidad por Caja', data: traceabilityData },
      ],
    };

  } catch (error: any) {
    console.error("Unexpected error in exportBasicOperationReport:", error);
    return { success: false, error: `Error inesperado: ${error.message}` };
  }
}

export async function getPackingUnitsForOperation(operationId: string): Promise<{ success: boolean; data?: PackingUnit[]; error?: string; }> {
    try {
        if (!operationId) return { success: false, error: "ID de operación no proporcionado." };
        const q = query(collection(firestore, "packingUnits"), where("reception_id", "==", operationId));
        const querySnapshot = await getDocs(q);
        const units = querySnapshot.docs.map(doc => ({
            firestoreId: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as PackingUnit));
        return { success: true, data: units };
    } catch (error: any) {
        return { success: false, error: `Error al buscar unidades de empaque: ${error.message}` };
    }
}

export async function getPackingUnitDetails(operationId: string, sequentialUnitId: number): Promise<{ success: boolean; data?: { unit: PackingUnit, items: PackedItem[] }; error?: string; }> {
    try {
        if (!operationId || !sequentialUnitId) {
            return { success: false, error: "ID de operación o de unidad no proporcionados." };
        }

        // Step 1: Find the packing unit by its sequential ID for the given operation
        const unitsQuery = query(
            collection(firestore, "packingUnits"),
            where("reception_id", "==", operationId),
            where("id", "==", sequentialUnitId),
            limit(1)
        );
        const unitSnapshot = await getDocs(unitsQuery);

        if (unitSnapshot.empty) {
            return { success: false, error: `No se encontró la unidad de empaque #${sequentialUnitId} para esta operación.` };
        }
        
        const unitDoc = unitSnapshot.docs[0];
        const unitData = { firestoreId: unitDoc.id, ...convertTimestampsToDates(unitDoc.data()) } as PackingUnit;

        // Step 2: Fetch all items belonging to that packing unit using its Firestore ID
        const itemsQuery = query(collection(firestore, "scannedItems"), where("packing_unit_id", "==", unitDoc.id));
        const itemsSnapshot = await getDocs(itemsQuery);
        
        const scannedItems = itemsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as ScannedItem));

        // Step 3: Enrich with product details
        const barcodes = [...new Set(scannedItems.map(i => i.barcode))];
        const productsResult = await getProductsByBarcodes(barcodes);
        const productMap = new Map(productsResult.data?.map(p => [p.codigoBarras, p]));

        const packedItems: PackedItem[] = scannedItems.map(scannedItem => {
            const productDetails = productMap.get(scannedItem.barcode);
            return {
                scannedItemId: scannedItem.id, // ID of the ScannedItem document
                packedQuantity: scannedItem.quantity,
                item: productDetails || {
                    id: scannedItem.barcode,
                    codigoBarras: scannedItem.barcode,
                    referencia: scannedItem.reference,
                    talla: scannedItem.talla,
                    item: scannedItem.item,
                }
            };
        });

        return { success: true, data: { unit: unitData, items: packedItems } };

    } catch (error: any) {
        console.error("Error fetching packing unit details:", error);
        return { success: false, error: `Error al buscar los detalles de la unidad: ${error.message}` };
    }
}
  
export async function bulkUploadReceptionDataFromExcel(fileContent: string, userId: string, isPreview: boolean): Promise<{ success: boolean; previewData?: CsvRow[]; summary?: { operations: number; products: number }; error?: string; errors?: string[] }> {
    try {
        const workbook = XLSX.read(fileContent, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return { success: false, error: "No se encontró ninguna hoja en el archivo Excel." };
        
        const sheet = workbook.Sheets[sheetName];
        let jsonData: CsvRow[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

        if (isPreview) {
            const serializableData = jsonData.map(row => {
                const newRow: CsvRow = {};
                for (const key in row) {
                    if (row[key] instanceof Date) {
                        newRow[key] = (row[key] as Date).toISOString();
                    } else {
                        newRow[key] = row[key];
                    }
                }
                return newRow;
            });
            return { success: true, previewData: serializableData };
        }

        const productsCollection = collection(firestore, 'productDatabase');
        const opsCollection = collection(firestore, 'receptionOperations');
        let operationsCreated = 0;
        let productsUpserted = 0;
        
        const operationsMap = new Map<string, { operationData: Partial<ReceptionOperation>, items: ReceptionExpectedItem[] }>();
        const productsMap = new Map<string, any>();

        for (const row of jsonData) {
            const barcode = String(row[findCaseInsensitiveKey(row, 'Código de barras') || ''] || '').trim();
            if (!barcode) continue;
            
            const productData = {
                name: String(row[findCaseInsensitiveKey(row, 'descripción del producto') || ''] || ''),
                barcode: barcode,
                reference: String(row[findCaseInsensitiveKey(row, 'Referencia') || ''] || ''),
                size: String(row[findCaseInsensitiveKey(row, 'Talla') || ''] || ''),
                merchandise_type: String(row[findCaseInsensitiveKey(row, 'tipo_mercancia') || ''] || null),
                updated_at: Timestamp.now(),
            };

            productsMap.set(barcode, productData);

            const rkIdentifier = findCaseInsensitiveKey(row, 'Nombre RK');
            if (!rkIdentifier || !row[rkIdentifier]) continue;

            const rkId = String(row[rkIdentifier]);
            if (!operationsMap.has(rkId)) {
                const arrivalDate = parseFlexibleDate(row[findCaseInsensitiveKey(row, 'Fecha') || '']) || new Date();
                operationsMap.set(rkId, {
                    operationData: {
                        rk_identifier: rkId,
                        supplier: String(row[findCaseInsensitiveKey(row, 'Proveedor') || ''] || 'N/A'),
                        expected_arrival_date: arrivalDate.toISOString().split('T')[0],
                    },
                    items: []
                });
            }
            
            const operationEntry = operationsMap.get(rkId)!;
            operationEntry.items.push({
                barcode: barcode,
                reference: productData.reference,
                size: productData.size,
                item: productData.name,
                expected_quantity: Number(row[findCaseInsensitiveKey(row, 'Cantidad') || ''] || 0),
                location: String(row[findCaseInsensitiveKey(row, 'ubicación') || ''] || 'N/A'),
            });
        }
        
        const CHUNK_SIZE = 450;
        const allOperations = Array.from(operationsMap.entries());

        for (let i = 0; i < allOperations.length; i += CHUNK_SIZE) {
            const chunk = allOperations.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);

            for (const [rkId, opData] of chunk) {
                const totalExpectedQuantity = opData.items.reduce((sum, item) => sum + item.expected_quantity, 0);

                // Note: The getDocs call inside a loop is not ideal for performance on huge datasets,
                // but for a few hundred operations it's acceptable and simpler than pre-fetching all.
                const q = query(opsCollection, where("rk_identifier", "==", rkId), limit(1));
                const existingOpSnapshot = await getDocs(q);

                let docRef;
                let isNew = true;

                if (!existingOpSnapshot.empty) {
                    docRef = existingOpSnapshot.docs[0].ref;
                    isNew = false;
                } else {
                    docRef = doc(opsCollection);
                    operationsCreated++;
                }

                const dataToSet: Partial<ReceptionOperation> = {
                    ...opData.operationData,
                    expectedItems: opData.items,
                    expected_quantity: totalExpectedQuantity,
                    updated_at: new Date().toISOString(),
                    ...(isNew && {
                        user_id: userId,
                        status: 'pending',
                        totalScannedQuantity: 0,
                        created_at: new Date().toISOString(),
                    })
                };
                batch.set(docRef, convertDatesToTimestamps(dataToSet), { merge: true });
            }
            await batch.commit();
        }

        const allProducts = Array.from(productsMap.entries());
        for (let i = 0; i < allProducts.length; i += CHUNK_SIZE) {
            const chunk = allProducts.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);

            for (const [pBarcode, pData] of chunk) {
                const pDocRef = doc(productsCollection, pBarcode);
                batch.set(pDocRef, convertDatesToTimestamps(pData), { merge: true });
            }
            await batch.commit();
        }
        productsUpserted = allProducts.length;

        return { success: true, summary: { operations: operationsCreated, products: productsUpserted } };

    } catch (error: any) {
        console.error("Error in bulkUploadReceptionDataFromExcel:", error);
        return { success: false, error: `Error procesando el archivo: ${error.message}` };
    }
}

// All other functions like getAllNovelties, createPackingUnit, etc., remain the same.
// ... (resto del contenido del archivo sin cambios) ...
export async function getAllNovelties(): Promise<{ success: boolean; data?: ItemNovelty[]; error?: string }> {
  try {
    const querySnapshot = await getDocs(collection(firestore, "itemNovelties"));
    const novelties = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertTimestampsToDates(doc.data()),
    } as ItemNovelty));
    return { success: true, data: novelties };
  } catch (error: any) {
    return { success: false, error: `Failed to load novelties: ${error.message}` };
  }
}

export async function getNoveltiesByReception(receptionId: string): Promise<{ success: boolean; data?: ItemNovelty[]; error?: string }> {
  try {
    const q = query(collection(firestore, "itemNovelties"), where("reception_id", "==", receptionId));
    const querySnapshot = await getDocs(q);
    const novelties = querySnapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as ItemNovelty));
    return { success: true, data: novelties };
  } catch (error: any) {
    return { success: false, error: `Error al buscar novedades: ${error.message}` };
  }
}

export async function updateNovelty(noveltyId: string, updates: Partial<Omit<ItemNovelty, 'id'>>): Promise<{ success: boolean; error?: string }> {
  try {
    await updateDoc(doc(firestore, "itemNovelties", noveltyId), { ...updates, updated_at: Timestamp.now() });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Failed to update novelty: ${error.message}` };
  }
}

export async function createPackingUnit(receptionId: string, userId: string): Promise<{ success: boolean; error?: string; newUnit?: PackingUnit }> {
  let newUnitData: PackingUnit | null = null;
  try {
      await runTransaction(firestore, async (transaction) => {
          const receptionRef = doc(firestore, 'receptionOperations', receptionId);
          const unitsCollectionRef = collection(firestore, 'packingUnits');
          const unitsQuery = query(unitsCollectionRef, where('reception_id', '==', receptionId));

          // Run the query outside of the transaction to get the count and find the max ID
          const unitsSnapshot = await getDocs(unitsQuery);
          
          let newUnitId = 1;
          if (!unitsSnapshot.empty) {
              const maxId = unitsSnapshot.docs.reduce((max, doc) => Math.max(max, doc.data().id), 0);
              newUnitId = maxId + 1;
          }
          
          // Now, perform the write operation inside the transaction
          const newUnitRef = doc(unitsCollectionRef);
          const newUnit: Omit<PackingUnit, 'firestoreId'> = {
              id: newUnitId,
              reception_id: receptionId,
              status: 'open',
              createdAt: new Date().toISOString(),
              createdBy: userId,
              items: {},
          };

          transaction.set(newUnitRef, convertDatesToTimestamps(newUnit));

          // Prepare the data to be returned, including the new Firestore-generated ID
          newUnitData = {
              ...newUnit,
              firestoreId: newUnitRef.id,
          };
      });

      if (!newUnitData) {
        throw new Error("La transacción no devolvió la nueva unidad creada.");
      }
      
      return { success: true, newUnit: newUnitData };

  } catch (error: any) {
      console.error("Error creating packing unit:", error);
      return { success: false, error: error.message };
  }
}


export async function updatePackingUnit(unitFirestoreId: string, updates: Partial<PackingUnit>): Promise<{ success: boolean, error?: string }> {
    try {
        const unitRef = doc(firestore, 'packingUnits', unitFirestoreId);
        await updateDoc(unitRef, convertDatesToTimestamps(updates));
        return { success: true };
    } catch(e: any) {
        return { success: false, error: e.message };
    }
}

export async function deletePackingUnitAndContents(unitFirestoreId: string): Promise<{ success: boolean, error?: string }> {
    const unitRef = doc(firestore, 'packingUnits', unitFirestoreId);
    const itemsQuery = query(collection(firestore, "scannedItems"), where("packing_unit_id", "==", unitFirestoreId));
    let receptionId: string | null = null;
    let totalQuantityDeleted = 0;

    try {
        await runTransaction(firestore, async (transaction) => {
            const unitDoc = await transaction.get(unitRef);
            if (!unitDoc.exists()) {
                throw new Error("La unidad de empaque no existe o ya fue eliminada.");
            }
            receptionId = unitDoc.data().reception_id;

            const itemsSnapshot = await getDocs(itemsQuery);
            itemsSnapshot.forEach(itemDoc => {
                totalQuantityDeleted += (itemDoc.data().quantity || 1);
                transaction.delete(itemDoc.ref);
            });
            
            transaction.delete(unitRef);

            if (receptionId && totalQuantityDeleted > 0) {
                const receptionRef = doc(firestore, 'receptionOperations', receptionId);
                transaction.update(receptionRef, { totalScannedQuantity: increment(-totalQuantityDeleted) });
            }
        });
        return { success: true };
    } catch(e: any) {
        console.error("Error en la transacción de eliminación:", e);
        return { success: false, error: e.message };
    }
}


export async function startOperationPause(receptionId: string, userId: string, reason: string): Promise<{ success: boolean; error?: string; pauseId?: string }> {
    try {
        const activePauseQuery = query(
            collection(firestore, 'operationPauses'), 
            where('user_id', '==', userId), 
            where('reception_id', '==', receptionId), // Add this condition
            where('end_time', '==', null)
        );
        const activePauses = await getDocs(activePauseQuery);
        if (!activePauses.empty) {
            return { success: false, error: 'Ya hay una pausa activa para este usuario en esta operación.' };
        }
        
        const newPause = {
            reception_id: receptionId,
            user_id: userId,
            start_time: Timestamp.now(),
            end_time: null,
            pause_reason: reason,
            is_manual: false,
        };
        const docRef = await addDoc(collection(firestore, 'operationPauses'), newPause);
        return { success: true, pauseId: docRef.id };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function endOperationPause(pauseId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const pauseRef = doc(firestore, 'operationPauses', pauseId);
        const pauseDoc = await getDoc(pauseRef);

        if (!pauseDoc.exists() || pauseDoc.data().user_id !== userId) {
            return { success: false, error: 'No se encontró la pausa o no tienes permiso para reanudarla.' };
        }
        if (pauseDoc.data().end_time !== null) {
            return { success: false, error: 'Esta pausa ya ha sido finalizada.' };
        }
        await updateDoc(pauseRef, { end_time: Timestamp.now() });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getActivePauseForUser(userId: string, receptionId: string): Promise<OperationPause | null> {
    try {
        const q = query(
            collection(firestore, 'operationPauses'),
            where('user_id', '==', userId),
            where('reception_id', '==', receptionId),
            where('end_time', '==', null),
            limit(1)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        const docData = snapshot.docs[0].data();
        return { id: snapshot.docs[0].id, ...convertTimestampsToDates(docData) } as OperationPause;
    } catch (e) {
        console.error("Error getting active pause:", e);
        return null;
    }
}

export async function addScannedItem(itemData: Omit<ScannedItem, 'id' | 'quantity' | 'created_at' | 'updated_at' | 'scanned_at'>): Promise<{ success: boolean, error?: string, itemId?: string }> {
    try {
        const itemsRef = collection(firestore, 'scannedItems');
        const receptionRef = doc(firestore, 'receptionOperations', itemData.reception_id);

        await runTransaction(firestore, async (transaction) => {
            const receptionDoc = await transaction.get(receptionRef);
            if (!receptionDoc.exists()) {
                throw new Error("La operación de recepción no existe.");
            }

            const q = query(itemsRef, 
                where("reception_id", "==", itemData.reception_id),
                where("packing_unit_id", "==", itemData.packing_unit_id),
                where("barcode", "==", itemData.barcode),
                where("user_id", "==", itemData.user_id),
                limit(1)
            );

            // Can't run query inside transaction, so we assume we either create or update based on a prior check if needed
            // For simplicity and performance, we'll often create new docs, or have a more complex structure.
            // Here, we just add a new doc and update the reception's total.
            const newItemRef = doc(itemsRef);
            const newItem: Omit<ScannedItem, 'id'> = {
                ...itemData,
                quantity: 1, // Add one at a time
                scanned_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            transaction.set(newItemRef, convertDatesToTimestamps(newItem));
            transaction.update(receptionRef, { totalScannedQuantity: increment(1) });
        });

        return { success: true };
    } catch (error: any) {
        console.error("Error adding scanned item:", error);
        return { success: false, error: error.message };
    }
}

export async function updateScannedItem(itemId: string, updates: Partial<ScannedItem>): Promise<{ success: boolean, error?: string }> {
    const itemRef = doc(firestore, 'scannedItems', itemId);
    try {
      await runTransaction(firestore, async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        if (!itemDoc.exists()) {
          throw new Error("El ítem a actualizar no existe.");
        }
  
        const oldData = itemDoc.data() as ScannedItem;
        const oldQuantity = oldData.quantity || 0;
  
        // Check if quantity is being updated
        if (updates.quantity !== undefined && updates.quantity !== oldQuantity) {
            const quantityDifference = updates.quantity - oldQuantity;
            const receptionRef = doc(firestore, 'receptionOperations', oldData.reception_id);
            // This operation is atomic and safe
            transaction.update(receptionRef, { totalScannedQuantity: increment(quantityDifference) });
        }
  
        // Update the scanned item document
        transaction.update(itemRef, { ...updates, updated_at: Timestamp.now() });
      });
  
      return { success: true };
    } catch (error: any) {
      return { success: false, error: `Error al actualizar: ${error.message}` };
    }
}


export async function deleteScannedItem(itemId: string): Promise<{ success: boolean, error?: string }> {
    try {
        const itemRef = doc(firestore, 'scannedItems', itemId);
        await runTransaction(firestore, async (transaction) => {
            const itemDoc = await transaction.get(itemRef);
            if (!itemDoc.exists()) {
                throw new Error("El ítem a eliminar no existe.");
            }
            const itemData = itemDoc.data();
            const receptionRef = doc(firestore, 'receptionOperations', itemData.reception_id);
            
            transaction.delete(itemRef);
            transaction.update(receptionRef, { totalScannedQuantity: increment(-itemData.quantity) });
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Error al eliminar: ${error.message}` };
    }
}

export async function bulkDeleteScannedItems(itemIds: string[]): Promise<{ success: boolean; error?: string }> {
    const CHUNK_SIZE = 450;
    try {
      for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
        const chunk = itemIds.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(firestore);
        let totalQuantityRemoved = 0;
        let receptionId: string | null = null;
        
        for (const itemId of chunk) {
            const itemRef = doc(firestore, 'scannedItems', itemId);
            const itemDoc = await getDoc(itemRef);
            if (itemDoc.exists()) {
                if (!receptionId) receptionId = itemDoc.data().reception_id;
                totalQuantityRemoved += itemDoc.data().quantity;
                batch.delete(itemRef);
            }
        }
        await batch.commit();

        if (receptionId && totalQuantityRemoved > 0) {
            const receptionRef = doc(firestore, 'receptionOperations', receptionId);
            await updateDoc(receptionRef, { totalScannedQuantity: increment(-totalQuantityRemoved) });
        }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
}

export async function registerNovelty(noveltyData: Omit<ItemNovelty, 'id'|'created_at'|'status'|'user_id'>, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const newNovelty = {
            ...noveltyData,
            status: 'pending' as 'pending',
            created_at: Timestamp.now(),
            user_id: userId,
        };
        await addDoc(collection(firestore, 'itemNovelties'), newNovelty);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to register novelty: ${error.message}` };
    }
}

export async function getPausesForOperation(operationId: string): Promise<{ success: boolean; data?: OperationPause[]; error?: string; }> {
    try {
        const q = query(collection(firestore, "operationPauses"), where("reception_id", "==", operationId));
        const querySnapshot = await getDocs(q);
        const pauses = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as OperationPause));
        return { success: true, data: pauses };
    } catch (error: any) {
        return { success: false, error: `Error al buscar pausas: ${error.message}` };
    }
}

export async function getAllPauses(): Promise<{ success: boolean; data?: OperationPause[]; error?: string; }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "operationPauses"));
        const pauses = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as OperationPause));
        return { success: true, data: pauses };
    } catch (error: any) {
        return { success: false, error: `Failed to load pauses: ${error.message}` };
    }
}

export async function createManualPause(pauseData: { receptionId: string; userId: string; startTime: string; endTime: string; reason: string; }): Promise<{ success: boolean, error?: string }> {
    try {
        const newPause = {
            reception_id: pauseData.receptionId,
            user_id: pauseData.userId,
            start_time: Timestamp.fromDate(new Date(pauseData.startTime)),
            end_time: Timestamp.fromDate(new Date(pauseData.endTime)),
            pause_reason: pauseData.reason,
            is_manual: true,
            created_at: Timestamp.now(),
        };
        await addDoc(collection(firestore, 'operationPauses'), newPause);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}


export async function getIdleTimeReport(operationId: string): Promise<{
  success: boolean;
  data?: {
    reception_id: string;
    rk_identifier: string;
    total_idle_time_minutes: number;
    details: Array<{ from_scan_time: string; to_scan_time: string; idle_duration_minutes: number; userId?: string; userName?: string }>;
  };
  error?: string
}> {
  try {
    const opResult = await getReceptionOperationById(operationId);
    if (!opResult.success || !opResult.data) throw new Error(opResult.error || "Operación no encontrada.");
    const operation = opResult.data;

    const scansResult = await getScannedItemsByReception(operationId);
    if (!scansResult.success) throw new Error(scansResult.error);
    const allScans = scansResult.data || [];
    
    const pausesResult = await getPausesForOperation(operationId);
    if (!pausesResult.success) throw new Error(pausesResult.error);
    const allPauses = pausesResult.data || [];

    const users = await getAllUserProfiles();
    const userMap = new Map(users.map(u => [u.uid, u.displayName || u.email]));

    const scansByUser = allScans.reduce((acc, scan) => {
        if (!acc[scan.user_id]) acc[scan.user_id] = [];
        acc[scan.user_id].push(new Date(scan.scanned_at));
        return acc;
    }, {} as { [key: string]: Date[] });

    let totalIdleMinutes = 0;
    const idleDetails: Array<{ from_scan_time: string; to_scan_time: string; idle_duration_minutes: number; userId?: string; userName?: string }> = [];

    for (const userId in scansByUser) {
        const userScans = scansByUser[userId].sort((a, b) => a.getTime() - b.getTime());
        const userPauses = allPauses.filter(p => p.user_id === userId);

        for (let i = 0; i < userScans.length - 1; i++) {
            const fromTime = userScans[i];
            const toTime = userScans[i+1];
            let idleDurationMs = toTime.getTime() - fromTime.getTime();

            for (const pause of userPauses) {
                const pauseStart = new Date(pause.start_time).getTime();
                const pauseEnd = pause.end_time ? new Date(pause.end_time).getTime() : new Date().getTime();
                const overlapStart = Math.max(fromTime.getTime(), pauseStart);
                const overlapEnd = Math.min(toTime.getTime(), pauseEnd);
                if (overlapEnd > overlapStart) {
                    idleDurationMs -= (overlapEnd - overlapStart);
                }
            }
            
            const idleMinutes = idleDurationMs / 60000;
            if (idleMinutes >= 1) { // Only log idle times >= 1 minute
                totalIdleMinutes += idleMinutes;
                idleDetails.push({
                    from_scan_time: fromTime.toLocaleString(),
                    to_scan_time: toTime.toLocaleString(),
                    idle_duration_minutes: idleMinutes,
                    userId: userId,
                    userName: userMap.get(userId) || userId,
                });
            }
        }
    }
    
    return {
      success: true,
      data: {
        reception_id: operationId,
        rk_identifier: operation.rk_identifier,
        total_idle_time_minutes: totalIdleMinutes,
        details: idleDetails,
      },
    };

  } catch (error: any) {
    return { success: false, error: `Error al generar el reporte de tiempos muertos: ${error.message}` };
  }
}

// These functions were in app/actions.ts, moving them here to consolidate reception logic.
export async function getProductivitySettings(): Promise<{ success: boolean; data?: ProductivitySettings | null, error?: string }> {
    try {
        const settingsRef = doc(firestore, 'settings', 'productivity');
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            return { success: true, data: { id: docSnap.id, ...docSnap.data() } as ProductivitySettings };
        }
        return { success: true, data: null };
    } catch (error: any) {
        return { success: false, error: `Failed to load productivity settings: ${error.message}` };
    }
}


export async function getUserGoals(userId: string): Promise<{ success: boolean; data?: UserGoal | null; error?: string }> {
    try {
        const goalRef = doc(firestore, 'userGoals', userId);
        const docSnap = await getDoc(goalRef);
        if (docSnap.exists()) {
            return { success: true, data: { id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as UserGoal };
        }
        return { success: true, data: null };
    } catch (error: any) {
        return { success: false, error: `Failed to get user goals: ${error.message}` };
    }
}

export async function createLabelingTask(taskData: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<{ success: boolean; error?: string, id?: string }> {
  try {
    const newTask: Omit<LabelingOperation, 'id'> = {
      ...taskData,
      status: taskData.assignedOperatorId ? 'Asignada' : 'Pendiente',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const docRef = await addDoc(collection(firestore, 'labelingOperations'), convertDatesToTimestamps(newTask));
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error("Error creating labeling task:", error);
    return { success: false, error: `Failed to create labeling task: ${error.message}` };
  }
}

export async function bulkCreateLabelingTasks(
    tasks: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>[]
): Promise<{ success: boolean; error?: string; createdCount?: number }> {
    const labelingOpsCollection = collection(firestore, 'labelingOperations');
    const CHUNK_SIZE = 450;

    try {
        if (tasks.length === 0) {
            return { success: false, error: 'No tasks provided to create.' };
        }
        
        for (let i = 0; i < tasks.length; i+= CHUNK_SIZE) {
            const chunk = tasks.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);

            chunk.forEach(taskData => {
                const newDocRef = doc(labelingOpsCollection); // Automatically generate a new ID
                const newTask: Omit<LabelingOperation, 'id'> = {
                    ...taskData,
                    status: taskData.assignedOperatorId ? 'Asignada' : 'Pendiente',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                batch.set(newDocRef, convertDatesToTimestamps(newTask));
            });
            
            await batch.commit();
        }

        return { success: true, createdCount: tasks.length };
    } catch (error: any) {
        console.error("Error bulk creating labeling tasks:", error);
        return { success: false, error: `Failed to create tasks in bulk: ${error.message}` };
    }
}


export async function loadLabelingOperations(): Promise<{ success: boolean; data?: LabelingOperation[]; error?: string }> {
    try {
        const q = query(collection(firestore, "labelingOperations"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const operations = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...convertTimestampsToDates(data)
            } as LabelingOperation;
        });
        return { success: true, data: operations };
    } catch (error: any) {
        console.error("Error loading labeling operations:", error);
        return { success: false, error: `Failed to load labeling operations: ${error.message}` };
    }
}

export async function updateLabelingOperation(operationId: string, updates: Partial<Omit<LabelingOperation, 'id' | 'createdAt'>>): Promise<{ success: boolean; error?: string }> {
    try {
        const opRef = doc(firestore, 'labelingOperations', operationId);
        const dataToUpdate = {
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        await updateDoc(opRef, convertDatesToTimestamps(dataToUpdate));
        return { success: true };
    } catch (error: any) {
        console.error("Error updating labeling operation:", error);
        return { success: false, error: `Failed to update labeling operation: ${error.message}` };
    }
}

export async function getExpectedItemsForLabeling(receptionId: string): Promise<{ success: boolean; data?: ReceptionExpectedItem[]; error?: string; }> {
    try {
        const receptionSnap = await getDoc(doc(firestore, 'receptionOperations', receptionId));
        if (!receptionSnap.exists()) {
            return { success: false, error: "Recepción original no encontrada." };
        }
        const receptionData = receptionSnap.data() as ReceptionOperation;
        return { success: true, data: receptionData.expectedItems || [] };
    } catch (error: any) {
        console.error("Error getting expected items for labeling:", error);
        return { success: false, error: `Failed to get items: ${error.message}` };
    }
}

export async function logLabelingActivity(
  operationId: string,
  operatorId: string,
  type: LabelingActivityType,
  pauseReason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const logEntry: Omit<LabelingActivityLog, 'id'> = {
      labelingOperationId: operationId,
      operatorId: operatorId,
      type: type,
      timestamp: new Date().toISOString(),
      ...(pauseReason && { pauseReason }),
    };
    
    let newStatus: LabelingOperationStatus;
    switch(type) {
      case 'START':
        newStatus = 'En Progreso';
        break;
      case 'PAUSE':
        newStatus = 'Pausada';
        break;
      case 'RESUME':
        newStatus = 'En Progreso';
        break;
      case 'FINISH':
        newStatus = 'Completada';
        break;
      default:
        const opDoc = await getDoc(doc(firestore, 'labelingOperations', operationId));
        newStatus = opDoc.data()?.status || 'Pendiente';
    }

    const batch = writeBatch(firestore);

    const logCollectionRef = collection(firestore, 'labelingOperations', operationId, 'activityLog');
    const newLogDocRef = doc(logCollectionRef);
    batch.set(newLogDocRef, convertDatesToTimestamps(logEntry));

    const operationDocRef = doc(firestore, 'labelingOperations', operationId);
    batch.update(operationDocRef, { status: newStatus, updatedAt: Timestamp.now() });

    await batch.commit();
    return { success: true };

  } catch (error: any) {
    console.error("Error logging labeling activity:", error);
    return { success: false, error: `Failed to log activity: ${error.message}` };
  }
}

export async function getLabelingActivityLog(operationId: string): Promise<{ success: boolean, data?: LabelingActivityLog[], error?: string }> {
    try {
        const logCollectionRef = collection(firestore, 'labelingOperations', operationId, 'activityLog');
        const q = query(logCollectionRef, orderBy('timestamp', 'asc'));
        const querySnapshot = await getDocs(q);
        const logs = querySnapshot.docs.map(doc => {
            return {
                id: doc.id,
                ...convertTimestampsToDates(doc.data())
            } as LabelingActivityLog;
        });
        return { success: true, data: logs };
    } catch (error: any) {
        console.error("Error getting activity log:", error);
        return { success: false, error: `Failed to get activity log: ${error.message}` };
    }
}

export async function finishLabelingTaskSession(
  operationId: string,
  completedUnits: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await runTransaction(firestore, async (transaction) => {
      const operationRef = doc(firestore, 'labelingOperations', operationId);
      const operationDoc = await transaction.get(operationRef);
      if (!operationDoc.exists()) {
        throw new Error("La tarea de etiquetado no fue encontrada.");
      }

      const operationData = operationDoc.data() as LabelingOperation;
      if (completedUnits > operationData.totalUnits) {
        throw new Error("La cantidad completada no puede ser mayor a la cantidad total de la tarea.");
      }

      // 1. Update the current task
      transaction.update(operationRef, {
        status: 'Completada',
        completedUnits: completedUnits,
        updatedAt: Timestamp.now(),
      });
      
      // Log the FINISH event
      const logCollectionRef = collection(firestore, 'labelingOperations', operationId, 'activityLog');
      const newLogDocRef = doc(logCollectionRef);
      const logEntry: Omit<LabelingActivityLog, 'id'> = {
          labelingOperationId: operationId,
          operatorId: operationData.assignedOperatorId,
          type: 'FINISH',
          timestamp: new Date().toISOString(),
      };
      transaction.set(newLogDocRef, convertDatesToTimestamps(logEntry));


      // 2. Create a residual task if needed
      const remainingUnits = operationData.totalUnits - completedUnits;
      if (remainingUnits > 0) {
        const newDocRef = doc(collection(firestore, 'labelingOperations'));
        const residualTask: Omit<LabelingOperation, 'id'> = {
          ...operationData,
          totalUnits: remainingUnits,
          completedUnits: 0,
          status: 'Pendiente',
          assignedOperatorId: '', // Unassign it
          parentTaskId: operationId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        transaction.set(newDocRef, convertDatesToTimestamps(residualTask));
      }
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error finishing labeling task session:", error);
    return { success: false, error: error.message };
  }
}

export async function getTraceabilityForReference(reference: string): Promise<{ success: boolean; data?: any[]; error?: string; }> {
    try {
        const trimmedReference = reference.trim();
        if (!trimmedReference) {
            return { success: true, data: [] };
        }
        
        let operationsWithRef: ReceptionOperation[] = [];
        
        const allOpsResult = await loadReceptionOperations();
        if (allOpsResult.data) {
            operationsWithRef = allOpsResult.data.operations.filter(op => 
                op.expectedItems?.some(item => (item.reference || '').trim() === trimmedReference)
            );
        }
        
        const uniqueOpIds = [...new Set(operationsWithRef.map(op => op.id))];

        if (uniqueOpIds.length === 0) {
            return { success: true, data: [] };
        }

        // Fetch ALL scanned items for the relevant operations, then filter.
        // This is more robust than filtering by reference in the query.
        let allScannedForOps: ScannedItem[] = [];
        const CHUNK_SIZE = 30; // Firestore 'in' query limit
        for (let i = 0; i < uniqueOpIds.length; i += CHUNK_SIZE) {
            const chunk = uniqueOpIds.slice(i, i + CHUNK_SIZE);
            const scannedItemsQuery = query(collection(firestore, 'scannedItems'), where('reception_id', 'in', chunk));
            const scannedSnapshot = await getDocs(scannedItemsQuery);
            scannedSnapshot.forEach(doc => {
                allScannedForOps.push(doc.data() as ScannedItem);
            });
        }
        
        // Now filter these items by the specific reference
        const scannedItems = allScannedForOps.filter(item => (item.reference || '').trim() === trimmedReference);

        let novelties: ItemNovelty[] = [];
        const uniqueBarcodes = [...new Set(scannedItems.map(i => i.barcode))];
        if (uniqueBarcodes.length > 0) {
             const CHUNK_SIZE_BARCODES = 30;
             for (let i = 0; i < uniqueBarcodes.length; i += CHUNK_SIZE_BARCODES) {
                const chunk = uniqueBarcodes.slice(i, i + CHUNK_SIZE_BARCODES);
                const noveltiesQuery = query(collection(firestore, 'itemNovelties'), where('barcode', 'in', chunk));
                const noveltiesSnapshot = await getDocs(noveltiesQuery);
                noveltiesSnapshot.forEach(doc => {
                    novelties.push(doc.data() as ItemNovelty);
                });
             }
        }

        const traceabilityData = uniqueOpIds.map(opId => {
            const op = operationsWithRef.find(o => o.id === opId)!;
            const expectedQuantity = (op.expectedItems || [])
                .filter(item => (item.reference || '').trim() === trimmedReference)
                .reduce((sum, item) => sum + item.expected_quantity, 0);
            
            const scannedQuantity = scannedItems
                .filter(item => item.reception_id === opId)
                .reduce((sum, item) => sum + item.quantity, 0);
            
            const hasNovelty = novelties.some(n => n.reception_id === opId && scannedItems.some(si => si.barcode === n.barcode && si.reception_id === opId));
            
            return {
                operationId: op.id,
                rkIdentifier: op.rk_identifier,
                expectedQuantity,
                scannedQuantity,
                hasNovelty,
            };
        });
        
        return { success: true, data: traceabilityData };

    } catch (error: any) {
        console.error("Error in getTraceabilityForReference:", error);
        return { success: false, error: error.message };
    }
}
    

    




