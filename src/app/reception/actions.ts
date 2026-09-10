

"use server";

import { firestore } from "@/services/firebase";
import { collection, addDoc, getDocs, Timestamp, doc, setDoc, getDoc, writeBatch, documentId, where, query, QueryDocumentSnapshot, DocumentData, updateDoc, collectionGroup, runTransaction, orderBy, limit, deleteDoc, getCountFromServer, startAt, startAfter, increment, DocumentReference, arrayUnion, arrayRemove } from 'firebase/firestore';
import { buildReceptionIdleEntryId } from '@/lib/receptionIdleTime';
import { parseISO } from 'date-fns';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { normalizeHeader, parseFlexibleDate, excelSerialDateToJSDate, findCaseInsensitiveKey } from '@/lib/parsingUtils';
import { normalizeReceptionReference, normalizeReceptionSize, receptionRefSizeKey } from '@/lib/receptionReference';
import type { ReceptionOperation, ScannedItem, ItemNovelty, PackingUnit, Location, CsvRow, ReceptionExpectedItem, ReceptionProduct, AlternateBarcodeUploadRow, AppUser, OperationPause, ProductivitySettings, UserGoal, PackedItem, ProductDatabaseItem, DiscardedRecord, LabelingOperation, LabelingActivityLog, LabelingActivityType, LabelingOperationStatus, PackingScanResult, ExternalVendor, LabelingDashboardData, LabelingSummaryKPIs, LabelingEmployeePerformance, ReceptionIdleTimeDetail, ReceptionIdleJustifications } from '@/types';


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

/** Productos del catálogo maestro cuya marca comercial es IMPORTADA o NACIONAL (requieren corrección). */
export async function getImportedBrandCatalogProducts(): Promise<{ success: boolean; data?: ProductDatabaseItem[]; error?: string }> {
    try {
        const PLACEHOLDER_BRANDS = new Set(['IMPORTADA', 'NACIONAL']);
        const querySnapshot = await getDocs(collection(firestore, "productDatabase"));
        const products = querySnapshot.docs
            .map((docSnap) => {
                const data = convertTimestampsToDates(docSnap.data()) as Record<string, unknown>;
                return {
                    id: docSnap.id,
                    codigoBarras: docSnap.id,
                    ...data,
                } as ProductDatabaseItem;
            })
            .filter((p) => {
                // Solo marca comercial. merchandise_type/tipo_mercancia puede ser IMPORTADA sin ser error.
                const marca = String(p.marca || '').trim().toUpperCase();
                return PLACEHOLDER_BRANDS.has(marca);
            })
            .sort((a, b) =>
                String(a.referencia || a.reference || '').localeCompare(String(b.referencia || b.reference || ''))
            );
        return { success: true, data: products };
    } catch (error: any) {
        console.error("Error loading imported-brand catalog products:", error);
        return { success: false, error: `No se pudo consultar el catálogo: ${error.message}` };
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
        const refTrimmed = reference.trim();
        const sizeTrimmed = String(size).trim();
        const sizeAsNumber = parseFloat(sizeTrimmed);

        const productCollection = collection(firestore, "productDatabase");
        
        // Execute two queries to handle both Spanish and English field names
        const q_es = query(productCollection, where("referencia", "==", refTrimmed));
        const q_en = query(productCollection, where("reference", "==", refTrimmed));
        
        const [snap_es, snap_en] = await Promise.all([getDocs(q_es), getDocs(q_en)]);
        
        // Combine all unique matching documents
        const allDocs = [...snap_es.docs, ...snap_en.docs];
        
        if (allDocs.length === 0) {
            return { status: 'error', message: `No se encontró producto para la referencia ${reference}.`, scannedBarcode: '' };
        }

        // Filter by size in the server side logic (resilient to field naming)
        const matchingDoc = allDocs.find(docSnap => {
            const data = docSnap.data();
            const dbSize = data.talla !== undefined ? data.talla : data.size;
            
            if (dbSize === undefined || dbSize === null) return false;
            
            if (String(dbSize).trim() === sizeTrimmed) return true;
            if (!isNaN(sizeAsNumber) && typeof dbSize === 'number' && dbSize === sizeAsNumber) return true;
            
            return false;
        });

        if (matchingDoc) {
            const data = convertTimestampsToDates(matchingDoc.data());
            const item: ProductDatabaseItem = {
                ...data,
                id: matchingDoc.id,
                codigoBarras: matchingDoc.id,
                // Ensure both fields are present in the returned item for UI consistency
                referencia: data.referencia || data.reference || '',
                talla: data.talla || data.size || '',
            };
            return { status: 'success', message: `Producto encontrado: ${item.referencia} - ${item.talla}`, scannedBarcode: item.codigoBarras, item };
        }

        return { status: 'error', message: `No se encontró la talla ${size} para la referencia ${reference}.`, scannedBarcode: '' };
        
    } catch (error: any) {
        console.error("Error in getProductByRefAndSize:", error);
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
    statusFilter?: Array<'pending' | 'in_progress' | 'completed' | 'cancelled' | 'paused'>
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

let _userProfilesCache: { at: number; data: AppUser[] } | null = null;
const USER_PROFILES_TTL_MS = 60_000;

export async function getAllUserProfiles(): Promise<AppUser[]> {
    try {
        if (_userProfilesCache && Date.now() - _userProfilesCache.at < USER_PROFILES_TTL_MS) {
            return _userProfilesCache.data;
        }
        const usersCollection = await getDocs(collection(firestore, "users"));
        if (usersCollection.empty) {
            _userProfilesCache = { at: Date.now(), data: [] };
            return [];
        }
        const data = usersCollection.docs.map(doc => ({
            uid: doc.id,
            ...doc.data()
        })) as AppUser[];
        _userProfilesCache = { at: Date.now(), data };
        return data;
    } catch (error) {
        console.error("Error getting user profiles:", error);
        return _userProfilesCache?.data || [];
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
            locationMapForThisOperation.set(normalizeReceptionReference(item.reference), item.location);
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
      const key = receptionRefSizeKey(item.reference, item.size);
      const existing = allItems.get(key) || {
        expected: 0,
        scanned: 0,
        ref: normalizeReceptionReference(item.reference),
        talla: normalizeReceptionSize(item.size),
        name: product?.item || item.item,
        barcodes: new Set<string>(),
      };
      existing.expected += item.expected_quantity;
      existing.barcodes.add(item.barcode);
      allItems.set(key, existing);
    });

    scannedItems.forEach(item => {
      const product = productMap.get(item.barcode);
      const key = receptionRefSizeKey(item.reference, item.talla);
      const existing = allItems.get(key) || {
        expected: 0,
        scanned: 0,
        ref: normalizeReceptionReference(item.reference),
        talla: normalizeReceptionSize(item.talla),
        name: product?.item || item.item,
        barcodes: new Set<string>(),
      };
      existing.scanned += item.quantity;
      if (!existing.ref) existing.ref = normalizeReceptionReference(item.reference);
      if (!existing.talla) existing.talla = normalizeReceptionSize(item.talla);
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
      'Ubicación': locationMapForThisOperation.get(ref) || 'N/A',
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

        const normRef = normalizeReceptionReference(item.reference);
        const normSize = normalizeReceptionSize(item.talla);
        const key = `${box.id}-${normRef}-${normSize}`;
        let entry = traceabilityMap.get(key);
        
        if (!entry) {
            entry = {
                'Numero de Caja': box.id,
                'Destino': box.destination || 'N/A',
                'Referencia': normRef,
                'Talla': normSize,
                'Ubicacion': locationMapForThisOperation.get(normRef) || 'N/A',
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

    // --- New Logic for Sheet 4: Item Master (Catalog) ---
    const catalogData: any[] = [];
    allItems.forEach((item, key) => {
        item.barcodes.forEach(barcode => {
            catalogData.push({
                'Referencia': item.ref,
                'Talla': item.talla,
                'Código de Barras': barcode,
                'Descripción': item.name || 'N/A'
            });
        });
    });

    // Sort catalog by Reference and Size
    catalogData.sort((a, b) => {
        if (a['Referencia'] !== b['Referencia']) return a['Referencia'].localeCompare(b['Referencia']);
        return String(a['Talla']).localeCompare(String(b['Talla']));
    });

    return {
      success: true,
      sheets: [
        { sheetName: 'Resumen por Referencia', data: consolidatedData },
        { sheetName: 'Detalle por Talla', data: detailedData },
        { sheetName: 'Trazabilidad por Caja', data: traceabilityData },
        { sheetName: 'Maestro de Artículos', data: catalogData },
      ],
    };

  } catch (error: any) {
    console.error("Unexpected error in exportBasicOperationReport:", error);
    return { success: false, error: `Error inesperado: ${error.message}` };
  }
}

/**
 * Specialized action to export ONLY the catalog (item master) of an operation.
 */
export async function exportOperationCatalog(operationId: string): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
}> {
    try {
        const result = await exportBasicOperationReport(operationId);
        if (result.success && result.sheets) {
            const catalogSheet = result.sheets.find(s => s.sheetName === 'Maestro de Artículos');
            return { success: true, data: catalogSheet?.data || [] };
        }
        return { success: false, error: result.error };
    } catch (e: any) {
        return { success: false, error: e.message };
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

        const packedItems: any[] = scannedItems.map(scannedItem => {
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

        return { success: true, data: { unit: unitData, items: packedItems as any[] } };

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

        const readCell = (row: CsvRow, ...candidates: string[]): string => {
            const key = findCaseInsensitiveKey(row, ...candidates);
            if (!key) return '';
            const value = row[key];
            if (value === null || value === undefined) return '';
            const text = String(value).trim();
            if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '';
            return text;
        };

        for (const row of jsonData) {
            const barcode = readCell(row, 'Código de barras', 'Codigo de barras', 'Barcode');
            if (!barcode) continue;

            const description = readCell(row, 'descripción del producto', 'descripcion del producto', 'Descripción', 'Descripcion');
            const reference = readCell(row, 'Referencia', 'Reference');
            const size = readCell(row, 'Talla', 'Size');
            // tipo_mercancia = categoría de mercancía (ej. IMPORTADA), NO es la marca comercial.
            const merchandiseType = readCell(row, 'tipo_mercancia', 'Tipo Mercancia', 'Tipo de Mercancia');
            // Marca comercial real (NIKE, ADIDAS, etc.). Solo se escribe si viene en el archivo
            // para no pisar marcas ya corregidas al re-subir plantillas antiguas sin esta columna.
            const marca = readCell(row, 'Marca', 'Brand').toUpperCase();

            const productData: Record<string, unknown> = {
                name: description,
                item: description,
                barcode,
                reference,
                referencia: reference,
                size,
                talla: size,
                updated_at: Timestamp.now(),
            };

            if (merchandiseType) {
                productData.merchandise_type = merchandiseType;
            }
            if (marca) {
                productData.marca = marca;
            }

            productsMap.set(barcode, productData);

            const rkIdentifier = findCaseInsensitiveKey(row, 'Nombre RK');
            if (!rkIdentifier || !row[rkIdentifier]) continue;

            const rkId = String(row[rkIdentifier]);
            if (!operationsMap.has(rkId)) {
                const arrivalDate = parseFlexibleDate(readCell(row, 'Fecha') || null) || new Date();
                operationsMap.set(rkId, {
                    operationData: {
                        rk_identifier: rkId,
                        supplier: readCell(row, 'Proveedor') || 'N/A',
                        expected_arrival_date: arrivalDate.toISOString().split('T')[0],
                    },
                    items: []
                });
            }
            
            const operationEntry = operationsMap.get(rkId)!;
            operationEntry.items.push({
                barcode,
                reference,
                size,
                item: description,
                expected_quantity: Number(readCell(row, 'Cantidad') || 0),
                location: readCell(row, 'ubicación', 'ubicacion') || 'N/A',
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

type BarcodeSizeCorrectionRow = { barcode: string; size: string };

export async function applyBarcodeSizeCorrectionsFromExcel(
    fileContent: string,
): Promise<{
    success: boolean;
    previewData?: BarcodeSizeCorrectionRow[];
    summary?: {
        totalCodes: number;
        masterUpdated: number;
        masterMissing: number;
        scannedItemsUpdated: number;
        operationsUpdated: number;
        expectedItemsUpdated: number;
    };
    error?: string;
}> {
    try {
        const workbook = XLSX.read(fileContent, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return { success: false, error: "No se encontró ninguna hoja en el archivo Excel." };

        const sheet = workbook.Sheets[sheetName];
        const jsonData: CsvRow[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
        if (!jsonData.length) return { success: false, error: "El archivo está vacío." };

        const correctionMap = new Map<string, string>();
        for (const row of jsonData) {
            const barcodeKey =
                findCaseInsensitiveKey(row, 'Código de barras') ||
                findCaseInsensitiveKey(row, 'Codigo de barras') ||
                findCaseInsensitiveKey(row, 'Barcode') ||
                findCaseInsensitiveKey(row, 'Código') ||
                findCaseInsensitiveKey(row, 'Codigo');
            const sizeKey =
                findCaseInsensitiveKey(row, 'Talla') ||
                findCaseInsensitiveKey(row, 'Size');

            const barcode = String(row[barcodeKey || ''] || '').trim();
            const size = String(row[sizeKey || ''] || '').trim();
            if (!barcode || !size) continue;

            correctionMap.set(barcode, size);
        }

        const corrections = Array.from(correctionMap.entries()).map(([barcode, size]) => ({ barcode, size }));
        if (!corrections.length) {
            return { success: false, error: "No se detectaron filas válidas. Columnas requeridas: Código de barras y Talla." };
        }

        let masterUpdated = 0;
        let masterMissing = 0;
        let scannedItemsUpdated = 0;
        let operationsUpdated = 0;
        let expectedItemsUpdated = 0;

        // 1) Master update (productDatabase) only for existing barcodes
        for (let i = 0; i < corrections.length; i += 30) {
            const chunk = corrections.slice(i, i + 30);
            const chunkBarcodes = chunk.map(c => c.barcode);
            const q = query(collection(firestore, 'productDatabase'), where(documentId(), 'in', chunkBarcodes));
            const snap = await getDocs(q);
            const found = new Map<string, QueryDocumentSnapshot<DocumentData>>();
            snap.docs.forEach(docSnap => found.set(docSnap.id, docSnap));

            const batch = writeBatch(firestore);
            for (const c of chunk) {
                const existing = found.get(c.barcode);
                if (!existing) {
                    masterMissing++;
                    continue;
                }
                batch.set(existing.ref, { talla: c.size, size: c.size, updated_at: Timestamp.now() }, { merge: true });
                masterUpdated++;
            }
            await batch.commit();
        }

        // 2) Historical scanned items update by barcode
        for (const c of corrections) {
            const itemsQ = query(collection(firestore, 'scannedItems'), where('barcode', '==', c.barcode));
            const itemsSnap = await getDocs(itemsQ);
            if (itemsSnap.empty) continue;

            const docs = itemsSnap.docs;
            for (let i = 0; i < docs.length; i += 450) {
                const batchDocs = docs.slice(i, i + 450);
                const batch = writeBatch(firestore);
                batchDocs.forEach(d => {
                    batch.update(d.ref, { talla: c.size, size: c.size, updated_at: Timestamp.now() });
                    scannedItemsUpdated++;
                });
                await batch.commit();
            }
        }

        // 3) Update expectedItems in receptionOperations if barcode matches
        const opsSnap = await getDocs(collection(firestore, 'receptionOperations'));
        const opsToUpdate: { ref: DocumentReference<DocumentData>; expectedItems: ReceptionExpectedItem[] }[] = [];

        opsSnap.docs.forEach(opDoc => {
            const data = opDoc.data();
            const expectedItems = Array.isArray(data.expectedItems) ? [...data.expectedItems] : [];
            if (!expectedItems.length) return;

            let changed = false;
            const updatedItems = expectedItems.map((item: any) => {
                const correctedSize = correctionMap.get(String(item.barcode || '').trim());
                if (!correctedSize) return item;
                if (String(item.size || '').trim() === correctedSize) return item;
                changed = true;
                expectedItemsUpdated++;
                return { ...item, size: correctedSize, talla: correctedSize };
            });

            if (changed) {
                opsToUpdate.push({
                    ref: opDoc.ref,
                    expectedItems: updatedItems as ReceptionExpectedItem[],
                });
            }
        });

        for (let i = 0; i < opsToUpdate.length; i += 450) {
            const batch = writeBatch(firestore);
            const chunk = opsToUpdate.slice(i, i + 450);
            chunk.forEach(op => {
                batch.update(op.ref, { expectedItems: op.expectedItems, updated_at: Timestamp.now() });
                operationsUpdated++;
            });
            await batch.commit();
        }

        return {
            success: true,
            previewData: corrections,
            summary: {
                totalCodes: corrections.length,
                masterUpdated,
                masterMissing,
                scannedItemsUpdated,
                operationsUpdated,
                expectedItemsUpdated,
            },
        };
    } catch (error: any) {
        console.error("Error applying barcode-size corrections:", error);
        return { success: false, error: error.message || 'Error inesperado al aplicar correcciones.' };
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

/**
 * Al cerrar una caja: escribe detalle aditivo en referenceStats/{ref}.packUnitsById.
 * No modifica totalScanned ni packingUnits[] (flujo actual intacto).
 * Falla silenciosa a nivel de caller: no debe bloquear el cierre de caja.
 */
export async function recordPackUnitDetailOnClose(
  packingUnitFirestoreId: string
): Promise<{ success: boolean; refsUpdated?: number; error?: string }> {
  try {
    if (!packingUnitFirestoreId) return { success: false, error: 'ID de unidad requerido.' };

    const unitRef = doc(firestore, 'packingUnits', packingUnitFirestoreId);
    const unitSnap = await getDoc(unitRef);
    if (!unitSnap.exists()) return { success: false, error: 'Unidad de empaque no encontrada.' };

    const unit = { firestoreId: unitSnap.id, ...convertTimestampsToDates(unitSnap.data()) } as PackingUnit;
    const receptionId = unit.reception_id;
    if (!receptionId) return { success: false, error: 'La unidad no tiene recepción asociada.' };

    const itemsSnap = await getDocs(
      query(collection(firestore, 'scannedItems'), where('packing_unit_id', '==', packingUnitFirestoreId))
    );
    if (itemsSnap.empty) {
      return { success: true, refsUpdated: 0 };
    }

    const locationIds = new Set<string>();
    const byRef = new Map<string, { qty: number; locationId?: string }>();
    itemsSnap.forEach((d) => {
      const item = d.data() as ScannedItem;
      const ref = normalizeReceptionReference(item.reference);
      const qty = Number(item.quantity) || 1;
      const prev = byRef.get(ref) || { qty: 0, locationId: undefined };
      prev.qty += qty;
      if (!prev.locationId && item.location_id) {
        prev.locationId = item.location_id;
        locationIds.add(item.location_id);
      }
      byRef.set(ref, prev);
    });

    const locationNameById = new Map<string, string>();
    if (locationIds.size > 0) {
      const locSnap = await getDocs(collection(firestore, 'locations'));
      locSnap.forEach((d) => {
        if (locationIds.has(d.id)) {
          const name = String((d.data() as Location).name || d.id);
          locationNameById.set(d.id, name);
        }
      });
    }

    const now = new Date().toISOString();
    const closedAt = unit.closed_at || now;
    const { stripUndefinedDeep } = await import('@/lib/labelingPackPlan');
    let batch = writeBatch(firestore);
    let ops = 0;
    let refsUpdated = 0;

    for (const [safeRefId, acc] of byRef.entries()) {
      const statsRef = doc(firestore, 'receptionOperations', receptionId, 'referenceStats', safeRefId);
      const detail = stripUndefinedDeep({
        packingUnitId: packingUnitFirestoreId,
        unitNumber: Number(unit.id) || 0,
        qty: acc.qty,
        locationId: acc.locationId || undefined,
        locationName: acc.locationId ? locationNameById.get(acc.locationId) : undefined,
        status: 'closed' as const,
        closedAt,
        updatedAt: now,
      });
      batch.set(
        statsRef,
        stripUndefinedDeep({
          reference: safeRefId,
          reception_id: receptionId,
          packUnitsById: { [packingUnitFirestoreId]: detail },
          packSummaryUpdatedAt: now,
        }),
        { merge: true }
      );
      refsUpdated += 1;
      ops += 1;
      if (ops >= 400) {
        await batch.commit();
        batch = writeBatch(firestore);
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();

    return { success: true, refsUpdated };
  } catch (e: any) {
    console.error('recordPackUnitDetailOnClose:', e);
    return { success: false, error: e?.message || 'No se pudo registrar el detalle de la caja.' };
  }
}

/**
 * Reconstruye packUnitsById para toda una recepción (1 pasada de escaneos + cajas).
 * Aditivo: no borra totalScanned ni packingUnits[].
 * Usado por el botón "Cargar unidades de empaque a esta recepción".
 */
export async function rebuildReceptionPackSummaries(receptionId: string): Promise<{
  success: boolean;
  references?: number;
  packUnits?: number;
  scannedItems?: number;
  error?: string;
}> {
  try {
    if (!receptionId) return { success: false, error: 'ID de recepción requerido.' };

    const { aggregatePackUnitsByReference, stripUndefinedDeep } = await import(
      '@/lib/labelingPackPlan'
    );

    const [itemsSnap, unitsSnap] = await Promise.all([
      getDocs(query(collection(firestore, 'scannedItems'), where('reception_id', '==', receptionId))),
      getDocs(query(collection(firestore, 'packingUnits'), where('reception_id', '==', receptionId))),
    ]);

    const scannedItems = itemsSnap.docs.map(
      (d) => ({ id: d.id, ...convertTimestampsToDates(d.data()) } as ScannedItem)
    );

    if (scannedItems.length === 0) {
      return {
        success: false,
        error:
          'Esta recepción no tiene escaneos en scannedItems. No hay unidades de empaque que reconstruir.',
        scannedItems: 0,
        references: 0,
        packUnits: 0,
      };
    }

    const unitMetaById = new Map<
      string,
      { unitNumber: number; status: 'open' | 'closed'; closedAt?: string }
    >();
    unitsSnap.forEach((d) => {
      const u = convertTimestampsToDates(d.data()) as PackingUnit;
      unitMetaById.set(d.id, {
        unitNumber: Number(u.id) || 0,
        status: u.status === 'closed' ? 'closed' : 'open',
        closedAt: u.closed_at || undefined,
      });
    });

    // Ubicaciones: solo las que aparecen en escaneos (no toda la colección locations).
    const locationNameById = new Map<string, string>();
    const neededLocIds = [
      ...new Set(
        scannedItems
          .map((i) => String(i.location_id || '').trim())
          .filter(Boolean)
      ),
    ].slice(0, 80);
    if (neededLocIds.length > 0) {
      try {
        await Promise.all(
          neededLocIds.map(async (locId) => {
            const locSnap = await getDoc(doc(firestore, 'locations', locId));
            if (locSnap.exists()) {
              locationNameById.set(
                locId,
                String((locSnap.data() as Location).name || locId)
              );
            }
          })
        );
      } catch (locErr) {
        console.warn('rebuildReceptionPackSummaries: locations omitidas', locErr);
      }
    }

    const byRef = aggregatePackUnitsByReference(scannedItems, unitMetaById, locationNameById);
    if (byRef.size === 0) {
      return {
        success: false,
        error:
          `Hay ${scannedItems.length} escaneos, pero ninguno tiene packing_unit_id. No se puede armar el resumen de cajas.`,
        scannedItems: scannedItems.length,
        references: 0,
        packUnits: 0,
      };
    }

    const now = new Date().toISOString();
    let batch = writeBatch(firestore);
    let ops = 0;
    let packUnits = 0;

    for (const [safeRefId, packUnitsById] of byRef.entries()) {
      packUnits += Object.keys(packUnitsById).length;
      const statsRef = doc(firestore, 'receptionOperations', receptionId, 'referenceStats', safeRefId);
      batch.set(
        statsRef,
        stripUndefinedDeep({
          reference: safeRefId,
          reception_id: receptionId,
          packUnitsById,
          packSummaryUpdatedAt: now,
        }),
        { merge: true }
      );
      ops += 1;
      if (ops >= 400) {
        await batch.commit();
        batch = writeBatch(firestore);
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();

    return {
      success: true,
      references: byRef.size,
      packUnits,
      scannedItems: scannedItems.length,
    };
  } catch (e: any) {
    console.error('rebuildReceptionPackSummaries:', e);
    const msg = e?.message || String(e);
    return {
      success: false,
      error: msg.includes('undefined')
        ? `Firestore rechazó un campo vacío (undefined). Reintento corregido en el próximo deploy. Detalle: ${msg}`
        : msg || 'No se pudieron cargar las unidades de empaque.',
    };
  }
}

/**
 * Lee el resumen de cajas por referencia (sin tocar escaneos).
 * Para crear tareas pack_units / UI prep (fases siguientes).
 */
export async function getReceptionPackSummaries(receptionId: string): Promise<{
  success: boolean;
  data?: Record<string, import('@/types').ReceptionPackUnitDetail[]>;
  error?: string;
}> {
  try {
    if (!receptionId) return { success: false, error: 'ID de recepción requerido.' };
    const { packUnitsByIdToList } = await import('@/lib/labelingPackPlan');
    const statsSnap = await getDocs(
      collection(firestore, 'receptionOperations', receptionId, 'referenceStats')
    );
    const data: Record<string, import('@/types').ReceptionPackUnitDetail[]> = {};
    statsSnap.forEach((d) => {
      const raw = d.data() as { packUnitsById?: Record<string, import('@/types').ReceptionPackUnitDetail> };
      const list = packUnitsByIdToList(raw.packUnitsById);
      if (list.length) data[d.id] = list;
    });
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudo leer el resumen de empaque.' };
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
            const unitData = unitDoc.data();
            receptionId = unitData.reception_id;

            const itemsSnapshot = await getDocs(itemsQuery);
            const refStatsMap = new Map<string, number>();

            itemsSnapshot.forEach(itemDoc => {
                const itemData = itemDoc.data();
                const qty = itemData.quantity || 1;
                totalQuantityDeleted += qty;
                
                const safeRefId = normalizeReceptionReference(itemData.reference);
                refStatsMap.set(safeRefId, (refStatsMap.get(safeRefId) || 0) + qty);
                
                transaction.delete(itemDoc.ref);
            });
            
            transaction.delete(unitRef);

            if (receptionId) {
                const receptionRef = doc(firestore, 'receptionOperations', receptionId);
                
                if (totalQuantityDeleted > 0) {
                    transaction.update(receptionRef, { totalScannedQuantity: increment(-totalQuantityDeleted) });
                    
                    // Update each reference's stats
                    for (const [safeRefId, qty] of refStatsMap.entries()) {
                        const statsRef = doc(firestore, 'receptionOperations', receptionId, 'referenceStats', safeRefId);
                        transaction.set(statsRef, {
                            totalScanned: increment(-qty),
                            packingUnits: arrayRemove(unitFirestoreId)
                        }, { merge: true });
                    }
                }
            }
        });
        return { success: true };
    } catch(e: any) {
        console.error("Error en la transacción de eliminación de caja:", e);
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
            
            // --- PATRON CONTADOR: Firebase Optimization ---
            const safeRefId = normalizeReceptionReference(itemData.reference);
            const statsRef = doc(firestore, 'receptionOperations', itemData.reception_id, 'referenceStats', safeRefId);
            transaction.set(
                statsRef,
                {
                    reference: safeRefId,
                    reception_id: itemData.reception_id,
                    last_scanned_at: newItem.scanned_at,
                    totalScanned: increment(1),
                    packingUnits: arrayUnion(itemData.packing_unit_id),
                },
                { merge: true }
            );
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
            
            // --- PATRON CONTADOR: Firebase Optimization ---
            const safeRefId = normalizeReceptionReference(oldData.reference);
            const statsRef = doc(firestore, 'receptionOperations', oldData.reception_id, 'referenceStats', safeRefId);
            transaction.set(
                statsRef,
                {
                    reception_id: oldData.reception_id,
                    last_scanned_at: new Date().toISOString(),
                    totalScanned: increment(quantityDifference),
                },
                { merge: true }
            );
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
            transaction.update(receptionRef, { totalScannedQuantity: increment(-(itemData.quantity || 1)) });
            
            // --- PATRON CONTADOR: Firebase Optimization ---
            const safeRefId = normalizeReceptionReference(itemData.reference);
            const statsRef = doc(firestore, 'receptionOperations', itemData.reception_id, 'referenceStats', safeRefId);
            
            // Check if there are other items of the same reference in the same box
            const otherItemsQuery = query(
                collection(firestore, 'scannedItems'),
                where('reception_id', '==', itemData.reception_id),
                where('packing_unit_id', '==', itemData.packing_unit_id),
                where('barcode', '==', itemData.barcode)
            );
            const otherItemsSnapshot = await getDocs(otherItemsQuery);
            
            const updates: any = {
                totalScanned: increment(-(itemData.quantity || 1))
            };

            // If it was the last item of this reference in this box, remove the box from the list
            if (otherItemsSnapshot.size <= 1) {
                updates.packingUnits = arrayRemove(itemData.packing_unit_id);
            }

            transaction.set(statsRef, updates, { merge: true });
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error al eliminar ítem escaneado:", error);
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
        
        const diffMap = new Map<string, number>();
        let currentReceptionId: string | null = null;
        for (const itemId of chunk) {
            const itemRef = doc(firestore, 'scannedItems', itemId);
            const itemDoc = await getDoc(itemRef);
            if (itemDoc.exists()) {
                const data = itemDoc.data();
                if (!receptionId) receptionId = data.reception_id;
                currentReceptionId = data.reception_id;
                totalQuantityRemoved += data.quantity;
                
                const safeRefId = normalizeReceptionReference(data.reference);
                diffMap.set(safeRefId, (diffMap.get(safeRefId) || 0) + data.quantity);

                batch.delete(itemRef);
            }
        }
        
        // --- PATRON CONTADOR: Firebase Optimization ---
        if (currentReceptionId) {
            diffMap.forEach((qty, safeRefId) => {
                const statsRef = doc(firestore, 'receptionOperations', currentReceptionId!, 'referenceStats', safeRefId);
                batch.set(statsRef, {
                    totalScanned: increment(-qty)
                }, { merge: true });
            });
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

export async function getReceptionIdleJustifications(operationId: string): Promise<{
  success: boolean;
  data?: ReceptionIdleJustifications;
  error?: string;
}> {
  try {
    if (!operationId) return { success: false, error: 'ID de operación no proporcionado.' };
    const docRef = doc(firestore, 'receptionIdleJustifications', operationId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { success: true, data: {} };
    const raw = snap.data()?.justifications;
    return { success: true, data: (raw && typeof raw === 'object' ? raw : {}) as ReceptionIdleJustifications };
  } catch (error: any) {
    return { success: false, error: `Error al cargar justificaciones: ${error.message}` };
  }
}

export async function saveReceptionIdleJustifications(
  operationId: string,
  justifications: ReceptionIdleJustifications
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!operationId) return { success: false, error: 'ID de operación no proporcionado.' };
    const docRef = doc(firestore, 'receptionIdleJustifications', operationId);
    await setDoc(docRef, {
      justifications,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Error al guardar justificaciones: ${error.message}` };
  }
}

export async function getIdleTimeReport(operationId: string): Promise<{
  success: boolean;
  data?: {
    reception_id: string;
    rk_identifier: string;
    total_idle_time_minutes: number;
    details: ReceptionIdleTimeDetail[];
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
    const idleDetails: ReceptionIdleTimeDetail[] = [];

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
                const fromMs = fromTime.getTime();
                idleDetails.push({
                    id: buildReceptionIdleEntryId(userId, fromMs),
                    from_ms: fromMs,
                    to_ms: toTime.getTime(),
                    idle_duration_minutes: idleMinutes,
                    userId,
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

export async function createLabelingTask(taskData: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<{ success: boolean; error?: string, id?: string; trackingMode?: LabelingOperation['trackingMode'] }> {
  try {
    const { stripUndefinedDeep } = await import('@/lib/labelingPackPlan');
    const enriched = await enrichLabelingTaskWithPackPlan(taskData);
    const newTask: Omit<LabelingOperation, 'id'> = {
      ...enriched,
      status: (enriched.assignedOperatorId || enriched.assignedExternalVendorId) ? 'Asignada' : 'Pendiente',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const docRef = await addDoc(
      collection(firestore, 'labelingOperations'),
      convertDatesToTimestamps(stripUndefinedDeep(newTask))
    );
    return { success: true, id: docRef.id, trackingMode: enriched.trackingMode };
  } catch (error: any) {
    console.error("Error creating labeling task:", error);
    return { success: false, error: `Failed to create labeling task: ${error.message}` };
  }
}

export async function bulkCreateLabelingTasks(
    tasks: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>[]
): Promise<{ success: boolean; error?: string; createdCount?: number; packUnitsCount?: number }> {
    const labelingOpsCollection = collection(firestore, 'labelingOperations');
    const CHUNK_SIZE = 450;

    try {
        if (tasks.length === 0) {
            return { success: false, error: 'No tasks provided to create.' };
        }

        const { stripUndefinedDeep } = await import('@/lib/labelingPackPlan');
        // Una sola lectura de stats por recepción (evita N lecturas en lote).
        const receptionId = tasks[0]?.receptionOperationId;
        const packByRef =
          receptionId && tasks.every((t) => t.receptionOperationId === receptionId)
            ? await loadReceptionPackPlansMap(receptionId)
            : null;

        let packUnitsCount = 0;
        const enrichedTasks: Omit<LabelingOperation, 'id'>[] = [];
        for (const taskData of tasks) {
          let enriched: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'> &
            Partial<Pick<LabelingOperation, 'trackingMode' | 'labelingPackPlan' | 'packPlanLoadedAt' | 'completedUnitsLive'>>;
          if (packByRef) {
            const refKey = normalizeReceptionReference(taskData.reference);
            const plan = packByRef.get(refKey) || [];
            if (plan.length > 0) {
              const planQty = plan.reduce((s, p) => s + (Number(p.qty) || 0), 0);
              packUnitsCount += 1;
              enriched = {
                ...taskData,
                totalUnits: planQty > 0 ? planQty : taskData.totalUnits,
                trackingMode: 'pack_units',
                labelingPackPlan: plan,
                packPlanLoadedAt: new Date().toISOString(),
                completedUnitsLive: 0,
              };
            } else {
              enriched = { ...taskData, trackingMode: 'legacy_finish' };
            }
          } else {
            enriched = await enrichLabelingTaskWithPackPlan(taskData);
            if (enriched.trackingMode === 'pack_units') packUnitsCount += 1;
          }
          enrichedTasks.push({
            ...enriched,
            status: (enriched.assignedOperatorId || enriched.assignedExternalVendorId) ? 'Asignada' : 'Pendiente',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        
        for (let i = 0; i < enrichedTasks.length; i+= CHUNK_SIZE) {
            const chunk = enrichedTasks.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);

            chunk.forEach(newTask => {
                const newDocRef = doc(labelingOpsCollection);
                batch.set(newDocRef, convertDatesToTimestamps(stripUndefinedDeep(newTask)));
            });
            
            await batch.commit();
        }

        return { success: true, createdCount: enrichedTasks.length, packUnitsCount };
    } catch (error: any) {
        console.error("Error bulk creating labeling tasks:", error);
        return { success: false, error: `Failed to create tasks in bulk: ${error.message}` };
    }
}

/** Lee packUnitsById de todas las refs de una recepción → plan por ref normalizada. */
async function loadReceptionPackPlansMap(
  receptionId: string
): Promise<Map<string, NonNullable<LabelingOperation['labelingPackPlan']>>> {
  const { packUnitsByIdToList, toLabelingPackPlan } = await import('@/lib/labelingPackPlan');
  const map = new Map<string, NonNullable<LabelingOperation['labelingPackPlan']>>();
  try {
    const statsSnap = await getDocs(
      collection(firestore, 'receptionOperations', receptionId, 'referenceStats')
    );
    statsSnap.forEach((d) => {
      const raw = d.data() as { packUnitsById?: Record<string, import('@/types').ReceptionPackUnitDetail> };
      const list = packUnitsByIdToList(raw.packUnitsById);
      const plan = toLabelingPackPlan(list);
      if (plan.length > 0) {
        map.set(normalizeReceptionReference(d.id), plan);
        // También por reference field si difiere del id del doc
        const refField = String((d.data() as { reference?: string }).reference || '');
        if (refField) map.set(normalizeReceptionReference(refField), plan);
      }
    });
  } catch (e) {
    console.warn('loadReceptionPackPlansMap:', e);
  }
  return map;
}

/**
 * Si hay plan de cajas en stats → pack_units; si no → legacy_finish.
 * No altera tareas ya persistidas; solo enriquece al crear.
 */
async function enrichLabelingTaskWithPackPlan(
  taskData: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>
): Promise<Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>> {
  // Si el caller ya fijó modo (p.ej. legado explícito), respetar.
  if (taskData.trackingMode === 'legacy_finish') {
    return { ...taskData, trackingMode: 'legacy_finish' };
  }
  if (taskData.trackingMode === 'pack_units' && taskData.labelingPackPlan?.length) {
    return {
      ...taskData,
      completedUnitsLive: taskData.completedUnitsLive ?? 0,
    };
  }

  try {
    if (!taskData.receptionOperationId || !taskData.reference) {
      return { ...taskData, trackingMode: 'legacy_finish' };
    }
    const safeRefId = normalizeReceptionReference(taskData.reference);
    const statsRef = doc(
      firestore,
      'receptionOperations',
      taskData.receptionOperationId,
      'referenceStats',
      safeRefId
    );
    const statsSnap = await getDoc(statsRef);
    if (!statsSnap.exists()) {
      return { ...taskData, trackingMode: 'legacy_finish' };
    }
    const { packUnitsByIdToList, toLabelingPackPlan } = await import('@/lib/labelingPackPlan');
    const raw = statsSnap.data() as { packUnitsById?: Record<string, import('@/types').ReceptionPackUnitDetail> };
    const plan = toLabelingPackPlan(packUnitsByIdToList(raw.packUnitsById));
    if (plan.length === 0) {
      return { ...taskData, trackingMode: 'legacy_finish' };
    }
    const planQty = plan.reduce((s, p) => s + (Number(p.qty) || 0), 0);
    return {
      ...taskData,
      // Totality from boxes (decisión: asignar totalidad / finalizar parcial por cajas).
      totalUnits: planQty > 0 ? planQty : taskData.totalUnits,
      trackingMode: 'pack_units',
      labelingPackPlan: plan,
      packPlanLoadedAt: new Date().toISOString(),
      completedUnitsLive: 0,
    };
  } catch (e) {
    console.warn('enrichLabelingTaskWithPackPlan fallback legacy:', e);
    return { ...taskData, trackingMode: 'legacy_finish' };
  }
}

/**
 * Fase 3: convierte una tarea Pendiente (sin iniciar) a pack_units.
 * Rechaza Asignada / En Progreso / Pausada / Completada.
 */
export async function convertPendingLabelingTaskToPackUnits(taskId: string): Promise<{
  success: boolean;
  error?: string;
  packUnits?: number;
}> {
  try {
    if (!taskId) return { success: false, error: 'ID de tarea requerido.' };
    const { stripUndefinedDeep, packUnitsByIdToList, toLabelingPackPlan } = await import(
      '@/lib/labelingPackPlan'
    );

    const opRef = doc(firestore, 'labelingOperations', taskId);
    const opSnap = await getDoc(opRef);
    if (!opSnap.exists()) return { success: false, error: 'Tarea no encontrada.' };

    const op = { id: opSnap.id, ...convertTimestampsToDates(opSnap.data()) } as LabelingOperation;
    if (op.status !== 'Pendiente') {
      return {
        success: false,
        error: `Solo se pueden convertir tareas Pendiente. Estado actual: ${op.status}.`,
      };
    }
    if (op.trackingMode === 'pack_units' && (op.labelingPackPlan?.length || 0) > 0) {
      return { success: true, packUnits: op.labelingPackPlan!.length };
    }

    if (!op.receptionOperationId || !op.reference) {
      return { success: false, error: 'La tarea no tiene recepción/referencia.' };
    }

    const safeRefId = normalizeReceptionReference(op.reference);
    const statsRef = doc(
      firestore,
      'receptionOperations',
      op.receptionOperationId,
      'referenceStats',
      safeRefId
    );
    const statsSnap = await getDoc(statsRef);
    if (!statsSnap.exists()) {
      return {
        success: false,
        error: 'No hay plan de cajas. Use “Cargar unidades de empaque a esta recepción” primero.',
      };
    }
    const raw = statsSnap.data() as { packUnitsById?: Record<string, import('@/types').ReceptionPackUnitDetail> };
    const plan = toLabelingPackPlan(packUnitsByIdToList(raw.packUnitsById));
    if (plan.length === 0) {
      return {
        success: false,
        error: 'No hay plan de cajas para esta referencia. Cargue unidades de empaque primero.',
      };
    }
    const planQty = plan.reduce((s, p) => s + (Number(p.qty) || 0), 0);
    await updateDoc(
      opRef,
      convertDatesToTimestamps(
        stripUndefinedDeep({
          trackingMode: 'pack_units',
          labelingPackPlan: plan,
          packPlanLoadedAt: new Date().toISOString(),
          completedUnitsLive: 0,
          totalUnits: planQty > 0 ? planQty : op.totalUnits,
          updatedAt: new Date().toISOString(),
        })
      )
    );
    return { success: true, packUnits: plan.length };
  } catch (e: any) {
    console.error('convertPendingLabelingTaskToPackUnits:', e);
    return { success: false, error: e?.message || 'No se pudo convertir la tarea.' };
  }
}

/**
 * Convierte todas las Pendiente de una recepción que aún no son pack_units.
 * No toca Asignada / En Progreso / Pausada / Completada.
 */
export async function convertPendingPackUnitsForReception(receptionId: string): Promise<{
  success: boolean;
  converted?: number;
  skipped?: number;
  error?: string;
}> {
  try {
    if (!receptionId) return { success: false, error: 'ID de recepción requerido.' };

    const snap = await getDocs(
      query(
        collection(firestore, 'labelingOperations'),
        where('receptionOperationId', '==', receptionId),
        where('status', '==', 'Pendiente'),
        limit(200)
      )
    );

    let converted = 0;
    let skipped = 0;
    for (const d of snap.docs) {
      const op = d.data() as LabelingOperation;
      if (op.trackingMode === 'pack_units' && (op.labelingPackPlan?.length || 0) > 0) {
        skipped += 1;
        continue;
      }
      const res = await convertPendingLabelingTaskToPackUnits(d.id);
      if (res.success) converted += 1;
      else skipped += 1;
    }
    return { success: true, converted, skipped };
  } catch (e: any) {
    // Fallback sin índice compuesto status+reception
    try {
      const snap = await getDocs(
        query(
          collection(firestore, 'labelingOperations'),
          where('receptionOperationId', '==', receptionId),
          limit(200)
        )
      );
      let converted = 0;
      let skipped = 0;
      for (const d of snap.docs) {
        const op = d.data() as LabelingOperation;
        if (op.status !== 'Pendiente') {
          skipped += 1;
          continue;
        }
        if (op.trackingMode === 'pack_units' && (op.labelingPackPlan?.length || 0) > 0) {
          skipped += 1;
          continue;
        }
        const res = await convertPendingLabelingTaskToPackUnits(d.id);
        if (res.success) converted += 1;
        else skipped += 1;
      }
      return { success: true, converted, skipped };
    } catch (e2: any) {
      return { success: false, error: e2?.message || e?.message || 'No se pudieron convertir pendientes.' };
    }
  }
}


export async function loadLabelingOperations(options?: {
  limitN?: number;
  receptionOperationId?: string;
}): Promise<{ success: boolean; data?: LabelingOperation[]; error?: string }> {
    const limitN = Math.min(Math.max(options?.limitN ?? 150, 1), 500);
    try {
        const col = collection(firestore, "labelingOperations");
        let querySnapshot;
        if (options?.receptionOperationId) {
          try {
            querySnapshot = await getDocs(
              query(
                col,
                where("receptionOperationId", "==", options.receptionOperationId),
                orderBy("createdAt", "desc"),
                limit(limitN)
              )
            );
          } catch {
            // Sin índice compuesto: filtrar y ordenar en memoria (solo esa recepción).
            querySnapshot = await getDocs(
              query(col, where("receptionOperationId", "==", options.receptionOperationId), limit(limitN))
            );
          }
        } else {
          querySnapshot = await getDocs(
            query(col, orderBy("createdAt", "desc"), limit(limitN))
          );
        }

        const operations = querySnapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              ...convertTimestampsToDates(data),
            } as LabelingOperation;
          })
          .sort(
            (a, b) =>
              new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
          );
        return { success: true, data: operations };
    } catch (error: any) {
        console.error("Error loading labeling operations:", error);
        return { success: false, error: `Failed to load labeling operations: ${error.message}` };
    }
}

/**
 * Borra únicamente las tareas con los IDs indicados y sus logs de actividad.
 */
export async function deleteSelectedLabelingOperations(ids: string[]): Promise<{
  success: boolean;
  deletedOperations?: number;
  deletedLogs?: number;
  error?: string;
}> {
  if (!ids || ids.length === 0) return { success: true, deletedOperations: 0, deletedLogs: 0 };
  try {
    let deletedOperations = 0;
    let deletedLogs = 0;
    for (const id of ids) {
      const opRef = doc(firestore, 'labelingOperations', id);
      const logCol = collection(firestore, 'labelingOperations', id, 'activityLog');
      let logSnap = await getDocs(query(logCol, limit(400)));
      while (!logSnap.empty) {
        const batch = writeBatch(firestore);
        logSnap.docs.forEach((d) => { batch.delete(d.ref); deletedLogs += 1; });
        await batch.commit();
        logSnap = await getDocs(query(logCol, limit(400)));
      }
      await deleteDoc(opRef);
      deletedOperations += 1;
    }
    return { success: true, deletedOperations, deletedLogs };
  } catch (error: any) {
    console.error('deleteSelectedLabelingOperations:', error);
    return { success: false, error: error?.message || 'No se pudieron borrar las tareas seleccionadas.' };
  }
}

/**
 * Borra TODAS las tareas de etiquetado y sus logs de actividad.
 * Limpia la base usada por el módulo y por el dashboard histórico de etiquetado.
 */
export async function purgeAllLabelingOperations(): Promise<{
  success: boolean;
  deletedOperations?: number;
  deletedLogs?: number;
  error?: string;
}> {
  try {
    const opsSnap = await getDocs(collection(firestore, 'labelingOperations'));
    let deletedOperations = 0;
    let deletedLogs = 0;

    for (const opDoc of opsSnap.docs) {
      // Borrar subcolección activityLog (en lotes de hasta ~400)
      const logCol = collection(firestore, 'labelingOperations', opDoc.id, 'activityLog');
      let logSnap = await getDocs(query(logCol, limit(400)));
      while (!logSnap.empty) {
        const batch = writeBatch(firestore);
        logSnap.docs.forEach((d) => {
          batch.delete(d.ref);
          deletedLogs += 1;
        });
        await batch.commit();
        logSnap = await getDocs(query(logCol, limit(400)));
      }

      await deleteDoc(opDoc.ref);
      deletedOperations += 1;
    }

    return { success: true, deletedOperations, deletedLogs };
  } catch (error: any) {
    console.error('purgeAllLabelingOperations:', error);
    return {
      success: false,
      error: error?.message || 'No se pudieron borrar las tareas de etiquetado.',
    };
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

/**
 * Corrige la cantidad asignada de una tarea de etiquetado y sincroniza productividad:
 * - actualiza totalUnits (y completedUnits si aplica)
 * - reescala tallas proporcionalmente
 * - escribe completedUnits en el log FINISH (dashboard histórico)
 */
export async function correctLabelingTaskQuantity(
  operationId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string; data?: LabelingOperation }> {
  try {
    const qty = Math.round(Number(newQuantity));
    if (!operationId) return { success: false, error: 'Tarea inválida.' };
    if (!Number.isFinite(qty) || qty < 1) {
      return { success: false, error: 'La cantidad debe ser un entero mayor o igual a 1.' };
    }

    const opRef = doc(firestore, 'labelingOperations', operationId);
    const snap = await getDoc(opRef);
    if (!snap.exists()) return { success: false, error: 'La tarea de etiquetado no existe.' };

    const op = { id: snap.id, ...snap.data() } as LabelingOperation;
    const oldTotal = Math.max(0, Number(op.totalUnits) || 0);
    const oldCompleted =
      op.completedUnits != null && Number.isFinite(Number(op.completedUnits))
        ? Number(op.completedUnits)
        : null;

    // Reescalar tallas para que sumen la nueva cantidad
    let newSizes = op.sizes ? { ...op.sizes } : undefined;
    if (newSizes && Object.keys(newSizes).length > 0 && oldTotal > 0) {
      const entries = Object.entries(newSizes);
      const scaled = entries.map(([size, n]) => ({
        size,
        raw: (Number(n) || 0) * (qty / oldTotal),
      }));
      const floored = scaled.map((s) => ({ size: s.size, value: Math.max(0, Math.floor(s.raw)) }));
      let sum = floored.reduce((a, s) => a + s.value, 0);
      let remainder = qty - sum;
      // Distribuir resto a las tallas con mayor fracción
      const order = scaled
        .map((s, i) => ({ i, frac: s.raw - Math.floor(s.raw) }))
        .sort((a, b) => b.frac - a.frac);
      let idx = 0;
      while (remainder > 0 && order.length > 0) {
        floored[order[idx % order.length].i].value += 1;
        remainder -= 1;
        idx += 1;
      }
      while (remainder < 0 && order.length > 0) {
        const target = floored[order[idx % order.length].i];
        if (target.value > 0) {
          target.value -= 1;
          remainder += 1;
        }
        idx += 1;
        if (idx > order.length * 3) break;
      }
      newSizes = Object.fromEntries(floored.map((s) => [s.size, s.value]));
    }

    const updates: Partial<LabelingOperation> = {
      totalUnits: qty,
      ...(newSizes ? { sizes: newSizes } : {}),
      updatedAt: new Date().toISOString(),
    };

    if (op.status === 'Completada') {
      // Si finalizó con la cantidad total (o sin completed), alinear completed a la nueva
      if (oldCompleted == null || oldCompleted === oldTotal || oldCompleted > qty) {
        updates.completedUnits = qty;
      }
    } else if (oldCompleted != null && oldCompleted > qty) {
      updates.completedUnits = qty;
    }

    await updateDoc(opRef, convertDatesToTimestamps(updates));

    // Sincronizar logs FINISH para dashboards históricos
    if (op.status === 'Completada' || updates.completedUnits != null) {
      const unitsForLog = Number(updates.completedUnits ?? oldCompleted ?? qty);
      const logSnap = await getDocs(
        query(
          collection(firestore, 'labelingOperations', operationId, 'activityLog'),
          where('type', '==', 'FINISH'),
          limit(20)
        )
      );
      for (const logDoc of logSnap.docs) {
        await updateDoc(logDoc.ref, { completedUnits: unitsForLog });
      }
    }

    return {
      success: true,
      data: { ...op, ...updates } as LabelingOperation,
    };
  } catch (error: any) {
    console.error('correctLabelingTaskQuantity:', error);
    return { success: false, error: error?.message || 'No se pudo corregir la cantidad.' };
  }
}

/**
 * Corrige la fecha/hora de un log de actividad (FINISH / UNIT_COMPLETE / etc.).
 * Útil cuando un evento cayó en el día equivocado y distorsiona Bodega Live.
 */
export async function correctLabelingActivityLogTimestamp(
  operationId: string,
  logId: string,
  newTimestampIso: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!operationId || !logId) {
      return { success: false, error: 'Tarea o log inválido.' };
    }
    const next = new Date(newTimestampIso);
    if (Number.isNaN(next.getTime())) {
      return { success: false, error: 'Fecha/hora inválida.' };
    }

    const logRef = doc(firestore, 'labelingOperations', operationId, 'activityLog', logId);
    const logSnap = await getDoc(logRef);
    if (!logSnap.exists()) {
      return { success: false, error: 'El registro de actividad no existe.' };
    }

    await updateDoc(logRef, {
      timestamp: next.toISOString(),
    });
    await updateDoc(doc(firestore, 'labelingOperations', operationId), {
      updatedAt: Timestamp.now(),
    });

    return { success: true };
  } catch (error: any) {
    console.error('correctLabelingActivityLogTimestamp:', error);
    return { success: false, error: error?.message || 'No se pudo corregir la fecha del log.' };
  }
}

/**
 * Corrige las unidades de un log FINISH o UNIT_COMPLETE (sin reescalar tallas).
 * Para FINISH en tarea Completada también alinea completedUnits de la operación.
 */
export async function correctLabelingActivityLogUnits(
  operationId: string,
  logId: string,
  newUnits: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const qty = Math.round(Number(newUnits));
    if (!operationId || !logId) {
      return { success: false, error: 'Tarea o log inválido.' };
    }
    if (!Number.isFinite(qty) || qty < 0) {
      return { success: false, error: 'Las unidades deben ser un entero ≥ 0.' };
    }

    const opRef = doc(firestore, 'labelingOperations', operationId);
    const logRef = doc(firestore, 'labelingOperations', operationId, 'activityLog', logId);
    const [opSnap, logSnap] = await Promise.all([getDoc(opRef), getDoc(logRef)]);
    if (!opSnap.exists()) return { success: false, error: 'La tarea no existe.' };
    if (!logSnap.exists()) return { success: false, error: 'El registro de actividad no existe.' };

    const logData = logSnap.data() as LabelingActivityLog;
    const type = logData.type;
    if (type !== 'FINISH' && type !== 'UNIT_COMPLETE') {
      return { success: false, error: 'Solo se pueden corregir und en FINISH o UNIT_COMPLETE.' };
    }

    const logUpdates: Record<string, unknown> =
      type === 'UNIT_COMPLETE'
        ? { qty, completedUnits: qty }
        : { completedUnits: qty };

    await updateDoc(logRef, logUpdates);

    const op = { id: opSnap.id, ...opSnap.data() } as LabelingOperation;
    if (type === 'FINISH' && op.status === 'Completada') {
      await updateDoc(opRef, {
        completedUnits: qty,
        updatedAt: new Date().toISOString(),
      });
    } else {
      await updateDoc(opRef, { updatedAt: Timestamp.now() });
    }

    return { success: true };
  } catch (error: any) {
    console.error('correctLabelingActivityLogUnits:', error);
    return { success: false, error: error?.message || 'No se pudo corregir las unidades del log.' };
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
    pauseReason?: string, 
    isExternal: boolean = false,
    providedPin?: string,
    externalOperatorName?: string,
    customTimestamp?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        if (isExternal && !providedPin) {
            return { success: false, error: "Validación de PIN requerida para esta acción." };
        }

        if (isExternal && providedPin) {
            const vendorRef = doc(firestore, 'externalVendors', operatorId);
            const vendorSnap = await getDoc(vendorRef);
            if (!vendorSnap.exists()) {
                return { success: false, error: "Proveedor no encontrado." };
            }
            
            const vendorData = vendorSnap.data();
            const operator = (vendorData.operators as any[] || []).find(o => o.name === externalOperatorName);
            
            if (!operator) {
                return { success: false, error: "Operario no autorizado por la empresa." };
            }
            
            if (operator.pin !== providedPin) {
                return { success: false, error: "PIN de operario incorrecto. Acción rechazada." };
            }
        }

        const logEntry: Omit<LabelingActivityLog, 'id'> = {
            labelingOperationId: operationId,
            operatorId: operatorId,
            type: type,
            timestamp: customTimestamp || new Date().toISOString(),
            ...(pauseReason && { pauseReason }),
            isExternal: !!isExternal,
            ...(externalOperatorName && { externalOperatorName }),
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

export async function getLabelingActivityLog(
  operationId: string,
  options?: { limitN?: number }
): Promise<{ success: boolean, data?: LabelingActivityLog[], error?: string }> {
    try {
        const logCollectionRef = collection(firestore, 'labelingOperations', operationId, 'activityLog');
        const limitN = options?.limitN;
        const q = limitN
          ? query(logCollectionRef, orderBy('timestamp', 'asc'), limit(limitN))
          : query(logCollectionRef, orderBy('timestamp', 'asc'));
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
  completedUnits: number,
  isExternal: boolean = false,
  providedPin?: string,
  externalOperatorName?: string
): Promise<{ success: boolean; error?: string; residualCreated?: boolean; residualBoxes?: number }> {
  try {
    let residualCreated = false;
    let residualBoxes = 0;

    await runTransaction(firestore, async (transaction) => {
      const { stripUndefinedDeep, summarizePackPlanProgress } = await import('@/lib/labelingPackPlan');
      const operationRef = doc(firestore, 'labelingOperations', operationId);
      const operationDoc = await transaction.get(operationRef);
      if (!operationDoc.exists()) {
        throw new Error("La tarea de etiquetado no fue encontrada.");
      }

      const operationData = {
        id: operationDoc.id,
        ...convertTimestampsToDates(operationDoc.data()),
      } as LabelingOperation;

      // PIN validation for external workers
      if (isExternal) {
          if (!providedPin || !externalOperatorName) {
              throw new Error("Validación de PIN requerida para finalizar.");
          }
          const vendorRef = doc(firestore, 'externalVendors', operationData.assignedExternalVendorId!);
          const vendorSnap = await transaction.get(vendorRef);
          if (!vendorSnap.exists()) throw new Error("Proveedor no encontrado.");
          
          const vendorData = vendorSnap.data();
          const operator = (vendorData.operators as any[] || []).find(o => o.name === externalOperatorName);
          if (!operator || operator.pin !== providedPin) {
              throw new Error("PIN de operario incorrecto.");
          }
      }

      const isPackMode =
        operationData.trackingMode === 'pack_units' &&
        (operationData.labelingPackPlan?.length || 0) > 0;

      let finalCompletedUnits = completedUnits;
      let residualPlan: import('@/types').LabelingPackUnit[] | undefined;

      if (isPackMode) {
        const progress = summarizePackPlanProgress(operationData.labelingPackPlan);
        if (progress.confirmedBoxes === 0) {
          throw new Error('Confirme al menos una caja antes de finalizar, o pause la tarea.');
        }
        finalCompletedUnits = progress.confirmedUnits;
        if (progress.pendingBoxes > 0) {
          residualPlan = progress.pending.map((u) =>
            stripUndefinedDeep({
              ...u,
              confirmed: false,
              confirmedAt: undefined,
            })
          );
          residualBoxes = residualPlan.length;
        }
      } else if (completedUnits > operationData.totalUnits) {
        throw new Error("La cantidad completada no puede ser mayor a la cantidad total de la tarea.");
      }

      // 1. Update the current task
      transaction.update(
        operationRef,
        convertDatesToTimestamps(
          stripUndefinedDeep({
            status: 'Completada',
            completedUnits: finalCompletedUnits,
            ...(isPackMode ? { completedUnitsLive: finalCompletedUnits } : {}),
            updatedAt: new Date().toISOString(),
          })
        )
      );
      
      // Log the FINISH event
      const logCollectionRef = collection(firestore, 'labelingOperations', operationId, 'activityLog');
      const newLogDocRef = doc(logCollectionRef);
      const logEntry: Omit<LabelingActivityLog, 'id'> = {
          labelingOperationId: operationId,
          operatorId: isExternal ? operationData.assignedExternalVendorId! : (operationData.assignedOperatorId || 'system'),
          type: 'FINISH',
          timestamp: new Date().toISOString(),
          completedUnits: finalCompletedUnits,
          isExternal: !!isExternal,
          ...(externalOperatorName && { externalOperatorName })
      };
      transaction.set(newLogDocRef, convertDatesToTimestamps(logEntry));


      // 2. Residual task
      if (isPackMode && residualPlan && residualPlan.length > 0) {
        const pendingUnits = residualPlan.reduce((s, u) => s + (Number(u.qty) || 0), 0);
        const newDocRef = doc(collection(firestore, 'labelingOperations'));
        const residualTask = stripUndefinedDeep({
          receptionOperationId: operationData.receptionOperationId,
          rk_identifier: operationData.rk_identifier,
          supplier: operationData.supplier,
          reference: operationData.reference,
          sizes: operationData.sizes,
          totalUnits: pendingUnits,
          status: 'Pendiente' as const,
          assignedOperatorId: '',
          assignedExternalVendorId: undefined,
          assignedExternalOperatorName: undefined,
          isExternal: false,
          standard_units_per_hour: operationData.standard_units_per_hour,
          parentTaskId: operationId,
          completedUnits: 0,
          trackingMode: 'pack_units' as const,
          labelingPackPlan: residualPlan,
          packPlanLoadedAt: new Date().toISOString(),
          completedUnitsLive: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        transaction.set(newDocRef, convertDatesToTimestamps(residualTask));
        residualCreated = true;
      } else if (!isPackMode) {
        const remainingUnits = operationData.totalUnits - finalCompletedUnits;
        if (remainingUnits > 0) {
          const newDocRef = doc(collection(firestore, 'labelingOperations'));
          const residualTask: Omit<LabelingOperation, 'id'> = {
            ...operationData,
            totalUnits: remainingUnits,
            completedUnits: 0,
            status: 'Pendiente',
            assignedOperatorId: '',
            parentTaskId: operationId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          transaction.set(newDocRef, convertDatesToTimestamps(residualTask));
          residualCreated = true;
        }
      }
    });

    return { success: true, residualCreated, residualBoxes };
  } catch (error: any) {
    console.error("Error finishing labeling task session:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Confirma una caja del plan (pack_units, En Progreso).
 * UX C: preferir unitNumber (+ locationHint si hay ambigüedad); packingUnitId sigue válido.
 */
export async function confirmLabelingPackUnit(
  operationId: string,
  packingUnitIdOrLookup:
    | string
    | {
        packingUnitId?: string;
        unitNumber?: number;
        locationHint?: string;
      },
  isExternal: boolean = false,
  providedPin?: string,
  externalOperatorName?: string
): Promise<{
  success: boolean;
  error?: string;
  completedUnitsLive?: number;
  confirmedBoxes?: number;
  totalBoxes?: number;
  needsLocation?: boolean;
  candidateLocations?: string[];
}> {
  try {
    if (!operationId) {
      return { success: false, error: 'Tarea requerida.' };
    }

    const lookup =
      typeof packingUnitIdOrLookup === 'string'
        ? { packingUnitId: packingUnitIdOrLookup }
        : packingUnitIdOrLookup || {};

    const { stripUndefinedDeep, resolvePackUnitFromPlan } = await import('@/lib/labelingPackPlan');

    let completedUnitsLive = 0;
    let confirmedBoxes = 0;
    let totalBoxes = 0;

    await runTransaction(firestore, async (transaction) => {
      const operationRef = doc(firestore, 'labelingOperations', operationId);
      const operationDoc = await transaction.get(operationRef);
      if (!operationDoc.exists()) {
        throw new Error('La tarea de etiquetado no fue encontrada.');
      }

      const operationData = {
        id: operationDoc.id,
        ...convertTimestampsToDates(operationDoc.data()),
      } as LabelingOperation;

      if (operationData.trackingMode !== 'pack_units') {
        throw new Error('Esta tarea no usa seguimiento por cajas (modo legado).');
      }
      if (operationData.status !== 'En Progreso') {
        throw new Error(
          operationData.status === 'Pausada'
            ? 'Reanude la tarea antes de confirmar cajas.'
            : `Solo se confirman cajas en En Progreso. Estado: ${operationData.status}.`
        );
      }

      if (isExternal) {
        if (!providedPin || !externalOperatorName) {
          throw new Error('Validación de PIN requerida para confirmar caja.');
        }
        const vendorRef = doc(firestore, 'externalVendors', operationData.assignedExternalVendorId!);
        const vendorSnap = await transaction.get(vendorRef);
        if (!vendorSnap.exists()) throw new Error('Proveedor no encontrado.');
        const vendorData = vendorSnap.data();
        const operator = (vendorData.operators as any[] || []).find(
          (o) => o.name === externalOperatorName
        );
        if (!operator || operator.pin !== providedPin) {
          throw new Error('PIN de operario incorrecto.');
        }
      }

      const plan = Array.isArray(operationData.labelingPackPlan)
        ? [...operationData.labelingPackPlan]
        : [];
      totalBoxes = plan.length;

      const resolved = resolvePackUnitFromPlan(plan, lookup);
      if (!resolved.ok) {
        const err = new Error(resolved.error) as Error & {
          needsLocation?: boolean;
          candidateLocations?: string[];
        };
        err.needsLocation = resolved.needsLocation;
        err.candidateLocations = (resolved.candidates || [])
          .map((c) => c.locationName || c.locationId || '')
          .filter(Boolean);
        throw err;
      }

      const { unit, index: idx } = resolved;
      const nowIso = new Date().toISOString();
      plan[idx] = stripUndefinedDeep({
        ...unit,
        confirmed: true,
        confirmedAt: nowIso,
      });

      completedUnitsLive = plan
        .filter((u) => u.confirmed)
        .reduce((s, u) => s + (Number(u.qty) || 0), 0);
      confirmedBoxes = plan.filter((u) => u.confirmed).length;

      const operatorId = isExternal
        ? operationData.assignedExternalVendorId!
        : operationData.assignedOperatorId || 'system';

      const logCollectionRef = collection(firestore, 'labelingOperations', operationId, 'activityLog');
      const newLogDocRef = doc(logCollectionRef);
      const logEntry: Omit<LabelingActivityLog, 'id'> = stripUndefinedDeep({
        labelingOperationId: operationId,
        operatorId,
        type: 'UNIT_COMPLETE' as const,
        timestamp: nowIso,
        completedUnits: Number(unit.qty) || 0,
        packingUnitId: unit.packingUnitId,
        unitNumber: unit.unitNumber,
        qty: Number(unit.qty) || 0,
        locationName: unit.locationName,
        isExternal: !!isExternal,
        ...(externalOperatorName ? { externalOperatorName } : {}),
      });
      transaction.set(newLogDocRef, convertDatesToTimestamps(logEntry));

      transaction.update(
        operationRef,
        convertDatesToTimestamps(
          stripUndefinedDeep({
            labelingPackPlan: plan,
            completedUnitsLive,
            updatedAt: nowIso,
          })
        )
      );
    });

    return { success: true, completedUnitsLive, confirmedBoxes, totalBoxes };
  } catch (error: any) {
    console.error('confirmLabelingPackUnit:', error);
    return {
      success: false,
      error: error?.message || 'No se pudo confirmar la caja.',
      needsLocation: Boolean(error?.needsLocation),
      candidateLocations: error?.candidateLocations,
    };
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

// --- External Vendor Actions ---

export async function getExternalVendors(): Promise<{ success: boolean; data?: ExternalVendor[]; error?: string }> {
    try {
        const q = query(collection(firestore, 'externalVendors'));
        const querySnapshot = await getDocs(q);
        const vendors = querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...convertTimestampsToDates(doc.data())
            } as ExternalVendor))
            .filter(v => v.active !== false) // Filter by active (default true)
            .sort((a, b) => a.name.localeCompare(b.name)); // Sort by name
        
        return { success: true, data: vendors };
    } catch (error: any) {
        console.error("Error loading external vendors:", error);
        return { success: false, error: `Failed to load external vendors: ${error.message}` };
    }
}

export async function validateExternalVendorPin(vendorId: string, pin: string, operatorName?: string): Promise<{ success: boolean; vendor?: ExternalVendor; error?: string }> {
    try {
        const vendorRef = doc(firestore, 'externalVendors', vendorId);
        const docSnap = await getDoc(vendorRef);
        
        if (!docSnap.exists()) {
            return { success: false, error: "Proveedor no encontrado." };
        }
        
        const data = docSnap.data();
        const vendorData = { id: docSnap.id, ...convertTimestampsToDates(data) } as ExternalVendor;
        
        if (operatorName) {
            const operator = vendorData.operators?.find(o => o.name === operatorName);
            if (operator && operator.pin === pin) {
                return { success: true, vendor: vendorData };
            }
            return { success: false, error: "PIN de operario incorrecto." };
        }

        // Company-level PIN fallback
        if (vendorData.pin === pin) {
            return { success: true, vendor: vendorData };
        }
        
        return { success: false, error: "PIN incorrecto." };
    } catch (error: any) {
        return { success: false, error: `Error al validar PIN: ${error.message}` };
    }
}

export async function saveExternalVendor(vendor: Partial<ExternalVendor>): Promise<{ success: boolean; data?: ExternalVendor; error?: string }> {
    try {
        const id = vendor.id || doc(collection(firestore, 'externalVendors')).id;
        const now = new Date().toISOString();
        
        const vendorData = {
            ...vendor,
            id,
            active: vendor.active ?? true,
            operators: vendor.operators || [],
            updatedAt: now,
            ...(vendor.id ? {} : { createdAt: now })
        };

        await setDoc(doc(firestore, 'externalVendors', id), vendorData, { merge: true });
        return { success: true, data: vendorData as ExternalVendor };
    } catch (error: any) {
        console.error("Error in saveExternalVendor:", error);
        return { success: false, error: error.message };
    }
}

export async function deleteExternalVendor(vendorId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await deleteDoc(doc(firestore, 'externalVendors', vendorId));
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getLabelingOperationsForExternal(vendorId: string, operatorName?: string): Promise<{ success: boolean; data?: LabelingOperation[]; error?: string }> {
    try {
        const q = query(
            collection(firestore, 'labelingOperations'), 
            where('assignedExternalVendorId', '==', vendorId)
            // Removed orderBy to avoid missing index error
        );
        const querySnapshot = await getDocs(q);
        let operations = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as LabelingOperation))
        .filter(op => op.status !== 'Completada')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Sort by createdAt desc
        
        if (operatorName) {
            operations = operations.filter(op => op.assignedExternalOperatorName === operatorName);
        }
        
    
        return { success: true, data: operations };
    } catch (error: any) {
        console.error("Error loading labeling operations for external vendor:", error);
        return { success: false, error: `Failed to load operations: ${error.message}` };
    }
}

export async function getLabelingHistoricalData(dateRange?: { from: Date; to?: Date | null }): Promise<{ success: boolean; data?: LabelingDashboardData; error?: string }> {
    try {
        const fromDate = dateRange?.from ? startOfDay(dateRange.from) : startOfDay(new Date());
        const toDate = dateRange?.to ? endOfDay(dateRange.to) : endOfDay(fromDate);
        const fromMs = fromDate.getTime();
        const toMs = toDate.getTime();
        const nowMs = Date.now();
        const rangeEndMs = Math.min(toMs, nowMs);

        const inRange = (value: Date | string | number | null | undefined) => {
            if (value == null) return false;
            const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
            return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
        };

        const clipMinutes = (startMs: number, endMs: number) => {
            const s = Math.max(startMs, fromMs);
            const e = Math.min(endMs, rangeEndMs);
            return e > s ? (e - s) / 60000 : 0;
        };

        // 1. Fetch labeling operations (bounded list)
        const opsResult = await loadLabelingOperations({ limitN: 300 });
        if (!opsResult.success || !opsResult.data) throw new Error(opsResult.error || "Failed to load operations");

        // Candidatas: creadas/actualizadas en rango, o aún abiertas (pueden tener progreso del día).
        const filteredOps = opsResult.data.filter((op) => {
            const created = new Date(op.createdAt);
            const updated = new Date(op.updatedAt);
            const touchedInRange =
                isWithinInterval(created, { start: fromDate, end: toDate }) ||
                isWithinInterval(updated, { start: fromDate, end: toDate });
            const stillOpen = op.status === 'En Progreso' || op.status === 'Pausada' || op.status === 'Asignada';
            return touchedInRange || stillOpen;
        });

        const logs: LabelingActivityLog[] = [];
        const employeeMap = new Map<string, LabelingEmployeePerformance>();
        const hourlyMap = new Map<string, number>();
        const pauseReasonMap = new Map<string, { count: number; totalMinutes: number }>();

        // 2. Fetch logs for each candidate operation
        for (const op of filteredOps) {
            const logResult = await getLabelingActivityLog(op.id, { limitN: 200 });
            if (logResult.success && logResult.data) {
                logs.push(...logResult.data);
            }
        }

        // 3. Process metrics — SOLO eventos / tramos dentro del rango de fechas
        let totalUnits = 0;
        let internalUnits = 0;
        let externalUnits = 0;
        let totalActiveMinutes = 0;

        const logsByOperator = new Map<string, LabelingActivityLog[]>();
        logs.forEach((log) => {
            const key = log.isExternal ? log.externalOperatorName || log.operatorId : log.operatorId;
            if (!logsByOperator.has(key)) logsByOperator.set(key, []);
            logsByOperator.get(key)!.push(log);
        });

        for (const [opId, opLogs] of logsByOperator.entries()) {
            const sortedLogs = opLogs.sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            let opActiveMinutes = 0;
            let opUnits = 0;
            let opPauses = 0;
            let lastStart: Date | null = null;
            let isExt = false;
            let extName = '';
            let lastActivityInRange = '';

            sortedLogs.forEach((log) => {
                const ts = new Date(log.timestamp);
                const tsMs = ts.getTime();
                if (log.isExternal) isExt = true;
                if (log.externalOperatorName) extName = log.externalOperatorName;
                if (inRange(ts)) lastActivityInRange = log.timestamp;

                if (log.type === 'START' || log.type === 'RESUME') {
                    lastStart = ts;
                } else if ((log.type === 'PAUSE' || log.type === 'FINISH') && lastStart) {
                    const diff = clipMinutes(lastStart.getTime(), tsMs);
                    opActiveMinutes += diff;
                    if (log.type === 'PAUSE' && diff > 0) {
                        opPauses++;
                        const reason = log.pauseReason || 'No especificado';
                        const current = pauseReasonMap.get(reason) || { count: 0, totalMinutes: 0 };
                        pauseReasonMap.set(reason, {
                            count: current.count + 1,
                            totalMinutes: current.totalMinutes + diff,
                        });
                    }
                    lastStart = null;
                }

                // Solo unidades de FINISH ocurridos DENTRO del rango (evita arrastrar días previos).
                if (log.type === 'FINISH' && inRange(ts)) {
                    let unitsFromLog = Number(log.completedUnits) || 0;
                    if (unitsFromLog <= 0) {
                        const opForUnits = filteredOps.find((o) => o.id === log.labelingOperationId);
                        // Solo fallback si la tarea quedó Completada; nunca usar totalUnits de Pausada/En Progreso.
                        if (opForUnits?.status === 'Completada') {
                            unitsFromLog = Number(opForUnits.completedUnits) || 0;
                        }
                    }
                    opUnits += unitsFromLog;
                    const hour = ts.getHours().toString().padStart(2, '0') + ':00';
                    hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + unitsFromLog);
                }
            });

            // Sesión aún abierta: solo el tramo que cae dentro del día.
            if (lastStart) {
                opActiveMinutes += clipMinutes(lastStart.getTime(), rangeEndMs);
            }

            // Sin actividad ni unidades en el rango → no aparece en el ranking del día.
            if (opUnits <= 0 && opActiveMinutes <= 0.5) {
                continue;
            }

            const performance: LabelingEmployeePerformance = {
                id: opId,
                name: extName || opId,
                type: isExt ? 'Externo' : 'Interno',
                totalUnits: opUnits,
                activeMinutes: Math.round(opActiveMinutes),
                pausesCount: opPauses,
                efficiency: opActiveMinutes > 0 ? opUnits / (opActiveMinutes / 60) : 0,
                lastActivity:
                    lastActivityInRange ||
                    sortedLogs[sortedLogs.length - 1]?.timestamp ||
                    new Date().toISOString(),
            };
            employeeMap.set(opId, performance);

            totalUnits += opUnits;
            if (isExt) externalUnits += opUnits;
            else internalUnits += opUnits;
            totalActiveMinutes += opActiveMinutes;
        }

        const dashboardData: LabelingDashboardData = {
            operations: filteredOps,
            logs: logs,
            summary: {
                totalUnits,
                internalUnits,
                externalUnits,
                totalActiveMinutes: Math.round(totalActiveMinutes),
                efficiency: totalActiveMinutes > 0 ? totalUnits / (totalActiveMinutes / 60) : 0,
                conversionRate: totalActiveMinutes > 0 ? totalUnits / (totalActiveMinutes / 60) : 0,
            },
            employeePerformance: Array.from(employeeMap.values()),
            hourlyData: Array.from(hourlyMap.entries())
                .map(([hour, units]) => ({ hour, units }))
                .sort((a, b) => a.hour.localeCompare(b.hour)),
            pauseReasons: Array.from(pauseReasonMap.entries()).map(([reason, stats]) => ({
                reason,
                ...stats,
            })),
        };

        return { success: true, data: dashboardData };
    } catch (error: any) {
        console.error("Error in getLabelingHistoricalData:", error);
        return { success: false, error: error.message };
    }
}

export async function repairReceptionStats(operationId: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!operationId) throw new Error("ID de operación requerido.");

        // Fetch all items from scratch
        const itemsQuery = query(collection(firestore, "scannedItems"), where("reception_id", "==", operationId));
        const itemsSnapshot = await getDocs(itemsQuery);
        const scannedItems = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as ScannedItem));

        const totalScannedQuantity = scannedItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
        
        // Group by reference
        const refMap = new Map<string, { totalScanned: number, packingUnits: Set<string> }>();
        
        scannedItems.forEach(item => {
            const safeRefId = normalizeReceptionReference(item.reference);
            if (!refMap.has(safeRefId)) {
                refMap.set(safeRefId, { totalScanned: 0, packingUnits: new Set() });
            }
            const stats = refMap.get(safeRefId)!;
            stats.totalScanned += (item.quantity || 1);
            if (item.packing_unit_id) stats.packingUnits.add(item.packing_unit_id);
        });

        // Use a batch to update everything
        const batch = writeBatch(firestore);
        
        // 1. Update main operation doc
        const receptionRef = doc(firestore, 'receptionOperations', operationId);
        batch.update(receptionRef, { totalScannedQuantity, updated_at: Timestamp.now() });

        // 2. Overwrite all found reference stats
        for (const [safeRefId, stats] of refMap.entries()) {
            const statsRef = doc(firestore, 'receptionOperations', operationId, 'referenceStats', safeRefId);
            batch.set(statsRef, {
                reference: safeRefId,
                totalScanned: stats.totalScanned,
                packingUnits: Array.from(stats.packingUnits)
            });
        }

        await batch.commit();
        return { success: true };
    } catch (e: any) {
        console.error("Error repairing reception stats:", e);
        return { success: false, error: e.message };
    }
}
    

    




