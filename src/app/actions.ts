
"use server";

// AI features are disabled for Spark plan compatibility.
// To re-enable, you must upgrade to the Blaze plan, restore the Genkit packages
// in package.json, and uncomment the related code in this file and in src/ai/genkit.ts.

import type { ProductivitySettings, ProcessedReportData, PackerProductivity, PackerReferenceProductivityDetail, IncidentLogEntry, DeadTimeEntry, WholesaleOrder, WholesaleOrderDetail, ProductDatabaseItem, PackingScanResult, OrderStatus, PackingSession, PreprintedLabel, LabelValidationResult, GeneralLabel, GeneralLabelOwnerType, ItemNovelty, ReceptionProduct, ReceptionOperation, ScannedItem, OperationPause, ReceptionExpectedItem, Location, PackingUnit, AppUser, ActivityLog, UserGoal, ReportSummary, ReportConfiguration, RemisionEntry, AlternateBarcodeUploadRow, FirebaseError, CsvRow, PackedItem, DispatchSessionInfo } from "@/types";
import { firestore } from "@/services/firebase";
import { collection, addDoc, getDocs, Timestamp, doc, setDoc, getDoc, writeBatch, documentId, where, query, QueryDocumentSnapshot, DocumentData, updateDoc, collectionGroup, runTransaction, orderBy, limit, deleteDoc, getCountFromServer, startAt, startAfter, increment, DocumentReference, arrayUnion, arrayRemove } from 'firebase/firestore';
import { parseISO } from 'date-fns';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { normalizeHeader, parseFlexibleDate, excelSerialDateToJSDate, findCaseInsensitiveKey } from '@/lib/parsingUtils';
import { processReport } from '@/services/reportProcessor';


// Helper function to convert Dates back to Timestamps FOR WRITING to Firestore
const convertDatesToTimestamps = (data: any): any => {
    if (data instanceof Date) {
        return Timestamp.fromDate(data);
    }
    if (Array.isArray(data)) {
        return data.map(convertDatesToTimestamps);
    }
    if (data !== null && typeof data === 'object' && !data.hasOwnProperty('seconds') && !data.hasOwnProperty('_seconds')) {
        const newData: { [key: string]: any } = {};
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
        const newData: { [key: string]: any } = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                newData[key] = convertTimestampsToDates(data[key]);
            }
        }
        return newData;
    }
    return data;
};


// Activity Log
async function createActivityLog(logEntry: Omit<ActivityLog, 'id' | 'created_at'>): Promise<void> {
    try {
        await addDoc(collection(firestore, 'activity_logs'), {
            ...logEntry,
            created_at: Timestamp.now(),
        });
    } catch (error) {
        console.error("LogService: Unexpected error creating log entry:", error);
    }
}



export async function handleExecutiveSummary(reportData: ProcessedReportData) {
  try {
    // const result = await getExecutiveSummary(reportData);
    // return { data: result };
    return { error: "AI features are disabled on the current plan." };
  } catch (error) {
    return { error: "Failed to get executive summary. Please try again." };
  }
}

export async function handleRootCauseAnalysis(context: PackerProductivity | PackerReferenceProductivityDetail, type: 'operator' | 'reference') {
    try {
        // const result = await getRootCauseAnalysis({ context, type });
        // return { data: result };
        return { error: "AI features are disabled on the current plan." };
    } catch (error: any) {
        console.error("Error in handleRootCauseAnalysis action:", error);
        return { error: "Failed to get root cause analysis. Please try again." };
    }
}

export async function handleGetJustificationSuggestions(incidents: DeadTimeEntry[]) {
    try {
        // const result = await getJustificationSuggestions({ incidents });
        // return { data: result };
         return { error: "AI features are disabled on the current plan." };
    } catch (error: any) {
        console.error("Error in handleGetJustificationSuggestions action:", error);
        return { error: "Failed to get justification suggestions. Please try again." };
    }
}

export async function handleGenerateSmartAlerts(reportData: ProcessedReportData) {
    try {
        // const result = await generateSmartAlerts(reportData);
        // return { data: result };
        return { error: "AI features are disabled on the current plan." };
    } catch (error: any) {
        console.error("Error in handleGenerateSmartAlerts action:", error);
        return { error: "Failed to generate smart alerts. Please try again." };
    }
}

export async function saveReportToHistory(reportData: ProcessedReportData) {
    try {
        const reportTimestamp = new Date();
        const reportDateObj = new Date(reportData.reportDate + 'T00:00:00'); // Use T00:00:00 to avoid timezone issues
        
        if (isNaN(reportDateObj.getTime())) {
            throw new Error(`Invalid reportDate: ${reportData.reportDate}`);
        }
        
        const snapshotId = `snapshot-${reportTimestamp.toISOString().replace(/:/g, '-')}`;
        
        const reportsCollectionRef = collection(firestore, "reports");
        const reportsSummaryCollectionRef = collection(firestore, "reports_summary");
        
        // 1. Create a lightweight configuration object.
        const reportConfigToSave: ReportConfiguration = {
            reportDate: reportData.reportDate,
            reportStartTime: reportData.reportStartTime || '06:00',
            reportEndTime: reportData.reportEndTime || '18:00',
            snapshotCreatedAt: reportTimestamp,
            isConsolidated: reportData.isConsolidated || false,
            sourceSnapshotIds: reportData.sourceSnapshotIds || [],
            brandProductTypeGoals: reportData.brandProductTypeGoals,
            manualJustifications: reportData.manualJustifications,
            incidentLog: reportData.incidentLog,
            configSelectedPacker: reportData.configSelectedPacker || ['all'],
            processedData: (reportData.processedData || []), // Use the new processedData field
        };

        const reportDocRef = doc(reportsCollectionRef, snapshotId);
        const dataToSave = convertDatesToTimestamps(reportConfigToSave);
        await setDoc(reportDocRef, dataToSave);


        // 2. Create the summary object for quick listing.
        const reportSummary: ReportSummary = {
            id: snapshotId,
            reportDate: reportDateObj,
            snapshotCreatedAt: reportTimestamp,
            overallCompliance: reportData.overallCompliance,
            operatorCount: reportData.packerProductivity.length,
            totalQuantity: reportData.packerProductivity.reduce((sum, p) => sum + p.totalQuantity, 0),
            brandCompliance: reportData.brandProductivity.map(b => ({ brandName: b.brandName, compliance: b.compliance })),
            operatorNames: reportData.packerProductivity.map(p => p.packerName),
            isConsolidated: reportData.isConsolidated || false,
            sourceSnapshotIds: reportData.sourceSnapshotIds || [],
        };
        
        const summaryDocRef = doc(reportsSummaryCollectionRef, snapshotId);
        await setDoc(summaryDocRef, convertDatesToTimestamps(reportSummary));

        return { data: { id: snapshotId } };
    } catch (error: any) {
        console.error("Error saving report to history:", error);
        return { error: `Failed to save report: ${error.message}` };
    }
}


export async function loadHistoricalReports(): Promise<{ data?: ReportSummary[], error?: string }> {
    try {
        const q = query(collection(firestore, "reports_summary"), orderBy("snapshotCreatedAt", "desc"));
        const querySnapshot = await getDocs(q);
        const reports = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as ReportSummary[];
        return { data: convertTimestampsToDates(reports) as ReportSummary[] };
    } catch (error: any) {
        console.error("Error loading historical reports:", error);
        return { error: `Failed to load historical reports: ${error.message}` };
    }
}

async function getAndCombineSnapshots(snapshotIds: string[]): Promise<{
    success: boolean;
    error?: string;
    combinedData?: { allProcessedData: RemisionEntry[], lastReportConfig: ReportConfiguration };
}> {
    if (!snapshotIds || snapshotIds.length === 0) {
        return { success: false, error: 'No snapshot IDs provided.' };
    }

    try {
        const reportsCollectionRef = collection(firestore, "reports");
        const snapshotDocsPromises = snapshotIds.map(id => getDoc(doc(reportsCollectionRef, id)));
        const snapshotDocsSnaps = await Promise.all(snapshotDocsPromises);

        const validSnapshots: ReportConfiguration[] = [];
        for (const docSnap of snapshotDocsSnaps) {
            if (docSnap.exists()) {
                const data = convertTimestampsToDates(docSnap.data()) as ReportConfiguration;
                validSnapshots.push(data);
            }
        }

        if (validSnapshots.length === 0) {
            return { success: false, error: 'None of the provided snapshot IDs were found.' };
        }

        const lastReportConfig = validSnapshots
            .filter(snapshot => snapshot.reportDate && snapshot.reportStartTime && snapshot.reportEndTime)
            .sort((a, b) => new Date(b.snapshotCreatedAt).getTime() - new Date(a.snapshotCreatedAt).getTime())
            [0]; 
        
        if (!lastReportConfig) {
             return { success: false, error: 'No snapshot with a complete configuration (date, start/end times) was found to use as a base.' };
        }
        
        // Combine the processedData from each snapshot instead of rawData
        const allProcessedData = validSnapshots.flatMap(snapshot => snapshot.processedData || []);
        
        return { success: true, combinedData: { allProcessedData, lastReportConfig } };

    } catch (error: any) {
        console.error("Error fetching and combining snapshots:", error);
        return { success: false, error: `Failed to fetch snapshots: ${error.message}` };
    }
}


export async function consolidateDailyReports(snapshotIds: string[]): Promise<{ success: boolean; error?: string; consolidatedReportId?: string }> {
  const combinedResult = await getAndCombineSnapshots(snapshotIds);
  if (!combinedResult.success || !combinedResult.combinedData) {
      return { success: false, error: combinedResult.error };
  }
  
  const { allProcessedData, lastReportConfig } = combinedResult.combinedData;

  try {
    const reportDateStr = new Date(lastReportConfig.reportDate).toISOString().split('T')[0];
    const consolidatedReportId = `${reportDateStr}-consolidated-${Date.now()}`;
    
    // Enrich with processed data and configuration before saving
    // The reportProcessor will re-calculate everything based on the combined processed data
    const consolidatedReportToSave: ProcessedReportData = {
        id: consolidatedReportId,
        reportDate: lastReportConfig.reportDate as any, // Will be converted
        processedData: allProcessedData,
        reportStartTime: lastReportConfig.reportStartTime,
        reportEndTime: lastReportConfig.reportEndTime,
        brandProductTypeGoals: lastReportConfig.brandProductTypeGoals,
        manualJustifications: lastReportConfig.manualJustifications,
        configSelectedPacker: lastReportConfig.configSelectedPacker,
        incidentLog: lastReportConfig.incidentLog,
        isConsolidated: true, // Mark this report as a consolidated one
        sourceSnapshotIds: snapshotIds,
        // The following fields will be recalculated by the summary generation
        packerProductivity: [],
        hourlyProductivity: [],
        brandProductivity: [],
        productTypeProductivity: [],
        overallCompliance: 0,
        deadTimeReport: [],
        microPausesReport: [],
        deadTimeSummary: [],
        microPausesSummary: [],
        totalInactivitySummary: [],
        packerBrandProductivityDetail: [],
        packerReferenceProductivityDetail: [],
        breakDetailReport: [],
        packerHourlyPerformance: [],
    };
    
    const result = await saveReportToHistory(consolidatedReportToSave);
    if(result.error){
        throw new Error(result.error);
    }

    return { success: true, consolidatedReportId: result.data?.id };

  } catch (error: any) {
    console.error("Error consolidating daily reports:", error);
    return { success: false, error: `Failed to consolidate reports: ${error.message}` };
  }
}

export async function previewConsolidatedReport(snapshotIds: string[]): Promise<{ data?: ProcessedReportData, error?: string }> {
    const combinedResult = await getAndCombineSnapshots(snapshotIds);
    if (!combinedResult.success || !combinedResult.combinedData) {
        return { error: combinedResult.error };
    }

    const { allProcessedData, lastReportConfig } = combinedResult.combinedData;

    try {
        if (!lastReportConfig.reportDate) {
            throw new Error("Invalid or missing report date in the configuration for preview.");
        }
        
        const reportDateStr = new Date(lastReportConfig.reportDate).toISOString().split('T')[0];

        const consolidatedProcessedData = processReport(
            allProcessedData,
            lastReportConfig.brandProductTypeGoals,
            reportDateStr,
            lastReportConfig.reportStartTime,
            lastReportConfig.reportEndTime,
            lastReportConfig.manualJustifications,
            lastReportConfig.configSelectedPacker,
            lastReportConfig.incidentLog || []
        );
        
        const previewReport: ProcessedReportData = {
            ...consolidatedProcessedData,
            id: `preview-${Date.now()}`,
            reportDate: reportDateStr,
            isConsolidated: true, 
            reportStartTime: lastReportConfig.reportStartTime,
            reportEndTime: lastReportConfig.reportEndTime,
            configSelectedPacker: lastReportConfig.configSelectedPacker,
            brandProductTypeGoals: lastReportConfig.brandProductTypeGoals,
            manualJustifications: lastReportConfig.manualJustifications,
            incidentLog: lastReportConfig.incidentLog,
        };

        return { data: previewReport };
    } catch (error: any) {
        console.error("Error generating preview for consolidated report:", error);
        return { error: `Failed to generate preview: ${error.message}` };
    }
}


export async function saveWholesaleOrders(orders: WholesaleOrder[]): Promise<{ data?: { processedCount: number }; error?: string }> {
  const batch = writeBatch(firestore);
  const ordersCollection = collection(firestore, "wholesaleOrders");
  
  try {
    if (orders.length > 0) {
      for (const order of orders) {
        const docRef = doc(ordersCollection, String(order.id));
        const orderForFirestore = {
          ...order,
          fecha: Timestamp.fromDate(new Date(order.fecha)),
        };
        // Use set with merge: true to create or update the document without reading first.
        batch.set(docRef, orderForFirestore, { merge: true });
      }
    }

    await batch.commit();
    return { data: { processedCount: orders.length } };

  } catch (error: any) {
    console.error("Error saving wholesale orders:", error);
    return { error: `Falló al guardar los pedidos en la base de datos: ${error.message}` };
  }
}

export async function processAndSaveWholesaleFile(orders: WholesaleOrder[]): Promise<{ data?: { processedCount: number }; error?: string }> {
    try {
        if (orders.length === 0) {
            return { error: "No se encontraron pedidos válidos en los datos enviados." };
        }
        return await saveWholesaleOrders(orders);

    } catch (err: any) {
        console.error("Error processing orders file on server:", err);
        return { error: `Error al procesar el archivo: ${err.message}` };
    }
}


export async function loadWholesaleOrders(): Promise<{ data?: WholesaleOrder[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "wholesaleOrders"));
        const orders = querySnapshot.docs.map(doc => {
            const data = doc.data();
            // Important: ensure the document ID is always included
            return {
                id: doc.id.trim(),
                vendedor: data.vendedor,
                fecha: (data.fecha as Timestamp).toDate().toISOString(),
                bodega: data.bodega,
                cliente: data.cliente,
                sucursal: data.sucursal,
                ordenDeCompra: data.ordenDeCompra,
                cantidadTotal: data.cantidadTotal,
                valorNetoTotal: data.valorNetoTotal,
                status: data.status || 'Pte Empaque', // Default status if missing
                details: data.details,
            } as WholesaleOrder;
        });
        return { data: orders };
    } catch (error: any) {
        console.error("Error loading wholesale orders:", error);
        return { error: `Falló al cargar los pedidos de la base de datos: ${error.message}` };
    }
}

export async function saveProductDatabaseItems(items: ProductDatabaseItem[]): Promise<{ data?: { processedCount: number }; error?: string }> {
  const batch = writeBatch(firestore);
  const dbCollection = collection(firestore, "productDatabase");
  
  try {
    if (items.length > 0) {
      for (const item of items) {
        if (!item.codigoBarras) continue; // Skip items without a barcode
        const docRef = doc(dbCollection, item.codigoBarras);
        batch.set(docRef, item, { merge: true });
      }
    }
    
    await batch.commit();
    return { data: { processedCount: items.length } };

  } catch (error: any) {
    console.error("Error saving product database items:", error);
    return { error: `Falló al guardar los productos en la base de datos: ${error.message}` };
  }
}


export async function lookupBarcode(barcode: string): Promise<PackingScanResult> {
    if (!barcode) {
        return {
            status: 'error',
            message: 'El código de barras no puede estar vacío.',
            scannedBarcode: barcode,
        };
    }

    try {
        const docRef = doc(firestore, "productDatabase", barcode.trim());
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const itemData = docSnap.data();
            const convertedData = convertTimestampsToDates(itemData);

            const item: ProductDatabaseItem = {
              ...(convertedData as Omit<ProductDatabaseItem, 'codigoBarras' | 'id'>),
              id: docSnap.id,
              codigoBarras: docSnap.id.trim(),
              referencia: (itemData.referencia || '').trim(),
              talla: (itemData.talla || '').trim(),
              item: (itemData.item || '').trim(),
              location: (itemData.location || null),
            };
            return {
                status: 'success',
                message: `Producto encontrado: ${item.referencia}`,
                scannedBarcode: barcode,
                item: item,
            };
        } else {
            return {
                status: 'error',
                message: `Código de barras no encontrado en la base de datos.`,
                scannedBarcode: barcode,
            };
        }
    } catch (error: any) {
        console.error("Error looking up barcode:", error);
        return {
            status: 'error',
            message: `Error de servidor al buscar el código de barras: ${error.message}`,
            scannedBarcode: barcode,
        };
    }
}


export async function getProductByRefAndSize(reference: string, size: string): Promise<PackingScanResult> {
    try {
        const q = query(
            collection(firestore, "productDatabase"),
            where("referencia", "==", reference),
            where("talla", "==", size),
            limit(1)
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            const itemData = docSnap.data();
            const convertedData = convertTimestampsToDates(itemData);
            const item: ProductDatabaseItem = {
                ...(convertedData as Omit<ProductDatabaseItem, 'codigoBarras' | 'id'>),
                id: docSnap.id,
                codigoBarras: docSnap.id.trim(),
                referencia: (itemData.referencia || '').trim(),
                talla: (itemData.talla || '').trim(),
                item: (itemData.item || '').trim(),
                location: (itemData.location || null),
            };
            return {
                status: 'success',
                message: `Producto encontrado: ${item.referencia}`,
                scannedBarcode: item.codigoBarras,
                item: item,
            };
        } else {
            return { status: 'error', message: `No se encontró producto para la referencia ${reference} y talla ${size}.`, scannedBarcode: '' };
        }
    } catch (error: any) {
        console.error("Error looking up by ref and size:", error);
        return { status: 'error', message: `Error de servidor al buscar el producto: ${error.message}`, scannedBarcode: '' };
    }
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<{ success: boolean; error?: string }> {
    try {
        const orderRef = doc(firestore, "wholesaleOrders", orderId);
        await updateDoc(orderRef, { status: status });
        return { success: true };
    } catch (error: any) {
        console.error("Error updating order status:", error);
        return { success: false, error: `Failed to update order status: ${error.message}` };
    }
}

export async function savePackingSession(session: PackingSession): Promise<{ success: boolean; error?: string }> {
  try {
    const sessionRef = doc(firestore, "packingSessions", session.orderId);
    
    // This deep copy is a simplified way to handle nested objects.
    // Be cautious if your objects have methods or complex prototypes.
    const sessionForFirestore = JSON.parse(JSON.stringify(session));

    // Convert only date strings back to Timestamps
    if (session.startTime) sessionForFirestore.startTime = Timestamp.fromDate(new Date(session.startTime));
    if (session.endTime) sessionForFirestore.endTime = Timestamp.fromDate(new Date(session.endTime));
    if (session.lastActivity) sessionForFirestore.lastActivity = Timestamp.fromDate(new Date(session.lastActivity));
    
    // Also convert dates within pauses
    sessionForFirestore.pauses = (sessionForFirestore.pauses || []).map((pause: any) => {
        const newPause = {...pause};
        if(newPause.startTime) newPause.startTime = Timestamp.fromDate(new Date(newPause.startTime));
        if(newPause.endTime) newPause.endTime = Timestamp.fromDate(new Date(newPause.endTime));
        return newPause;
    });


    await setDoc(sessionRef, sessionForFirestore, { merge: true });
    return { success: true };
  } catch (error: any) {
    console.error("Error saving packing session:", error);
    return { success: false, error: `Failed to save packing session: ${error.message}` };
  }
}

export async function getPackingSession(orderId: string): Promise<{ data?: PackingSession, error?: string }> {
    try {
        const sessionRef = doc(firestore, "packingSessions", orderId.trim());
        const docSnap = await getDoc(sessionRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const cleanData = convertTimestampsToDates(data);
            return { data: cleanData as PackingSession };
        } else {
            return { data: undefined }; // No session found is not an error
        }
    } catch (error: any) {
        console.error("Error getting packing session:", error);
        return { error: `Failed to get packing session: ${error.message}` };
    }
}

export async function loadAllPackingSessions(): Promise<{ data?: PackingSession[], error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "packingSessions"));
        const sessions = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return convertTimestampsToDates(data) as PackingSession;
        });
        return { data: sessions };
    } catch (error: any) {
        console.error("Error loading all packing sessions:", error);
        return { error: `Failed to load all packing sessions: ${error.message}` };
    }
}

// Helper to generate a random 5-character alphanumeric ID
const generateAlphanumericId = (length: number = 5): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};


// Actions for Pre-printed Labels
export async function generateAndSaveLabels(orderId: string, totalQuantity: number): Promise<{ data?: { generatedCount: number }; error?: string }> {
  const numericOrderId = orderId.replace(/\D/g, '');
  const boxCount = Math.ceil(totalQuantity / 12) + 1;
  const batch = writeBatch(firestore);
  const labelsCollection = collection(firestore, "preprintedLabels");

  for (let i = 0; i < boxCount; i++) {
    const randomBoxId = generateAlphanumericId();
    const labelId = `VXM-${numericOrderId}-${randomBoxId}`;
    const newLabel = {
      id: labelId,
      orderId: orderId,
      status: 'available',
      createdAt: Timestamp.now(),
    };
    const docRef = doc(labelsCollection, labelId);
    batch.set(docRef, newLabel);
  }

  try {
    await batch.commit();
    return { data: { generatedCount: boxCount } };
  } catch (error: any) {
    console.error("Error saving pre-printed labels:", error);
    return { error: `Failed to save labels: ${error.message}` };
  }
}

export async function getLabelsForOrder(orderId: string): Promise<{ data?: PreprintedLabel[]; error?: string }> {
    try {
        const q = query(collection(firestore, "preprintedLabels"), where("orderId", "==", orderId));
        const querySnapshot = await getDocs(q);
        const labels = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return convertTimestampsToDates(data) as PreprintedLabel;
        });
        return { data: labels };
    } catch (error: any) {
        console.error("Error loading labels for order:", error);
        return { error: `Failed to load labels: ${error.message}` };
    }
}

export async function addSingleLabel(orderId: string): Promise<{ data?: PreprintedLabel; error?: string }> {
    try {
        const numericOrderId = orderId.replace(/\D/g, '');
        const randomBoxId = generateAlphanumericId();
        const labelId = `VXM-${numericOrderId}-${randomBoxId}`;

        const newLabel: PreprintedLabel = {
            id: labelId,
            orderId: orderId,
            status: 'available',
            createdAt: new Date(),
        };

        const docRef = doc(collection(firestore, "preprintedLabels"), labelId);
        await setDoc(docRef, {
             ...newLabel,
             createdAt: Timestamp.fromDate(newLabel.createdAt as Date),
        });

        return { data: convertTimestampsToDates(newLabel) as PreprintedLabel };

    } catch (error: any) {
        console.error("Error adding single label:", error);
        return { error: `Failed to add single label: ${error.message}` };
    }
}


export async function validateLabel(labelId: string, orderId: string): Promise<LabelValidationResult> {
  try {
    // Normalize the input label ID for robustness.
    const normalizedLabelId = labelId
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '') // Remove all whitespace
      .replace(/'/g, '-') // Replace single quotes with hyphens
      .replace(/_/g, '-'); // Standardize underscores to hyphens

    const labelRef = doc(firestore, "preprintedLabels", normalizedLabelId);
    const docSnap = await getDoc(labelRef);

    if (!docSnap.exists()) {
      return { isValid: false, message: `La etiqueta ${labelId} (${normalizedLabelId}) no existe en la base de datos.` };
    }

    const labelData = convertTimestampsToDates(docSnap.data()) as PreprintedLabel;

    // Also normalize the stored orderId for comparison
    if (labelData.orderId.trim().toUpperCase() !== orderId.trim().toUpperCase()) {
      return { isValid: false, message: `La etiqueta ${labelId} no pertenece al pedido ${orderId}.` };
    }

    if (labelData.status !== 'available') {
      return { isValid: false, message: `La etiqueta ${labelId} ya fue utilizada.` };
    }

    return { isValid: true, label: labelData };
  } catch (error: any) {
    console.error("Error validating label:", error);
    return { isValid: false, message: `Error de servidor al validar la etiqueta: ${error.message}` };
  }
}

export async function markLabelAsUsed(labelId: string, unitId: number, packerName: string): Promise<{ success: boolean; error?: string }> {
    try {
        const labelRef = doc(firestore, "preprintedLabels", labelId);
        await updateDoc(labelRef, {
            status: 'used',
            usedAt: Timestamp.now(),
            unitId: unitId,
            usedBy: packerName,
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error marking label as used:", error);
        return { success: false, error: `Failed to update label status: ${error.message}` };
    }
}



// Actions for General Label Control
export async function generateAndSaveGeneralLabels(
    { ownerType, ownerId, quantity }: { ownerType: GeneralLabelOwnerType; ownerId: string; quantity: number }
): Promise<{ data?: { generatedCount: number }; error?: string }> {
  const batch = writeBatch(firestore);
  const labelsCollection = collection(firestore, "generalLabels");

  const getInitials = (name: string): string => {
      return name.split(' ').map(word => word.charAt(0)).join('').toUpperCase();
  };

  for (let i = 0; i < quantity; i++) {
    const randomId = generateAlphanumericId();
    let labelId: string;

    if (ownerType === 'store') {
        labelId = `TIENDAS-${ownerId}-${randomId}`;
    } else { // packer
        const ownerPrefix = getInitials(ownerId);
        labelId = `BOD-${ownerPrefix}-${randomId}`;
    }

    const newLabel: Omit<GeneralLabel, 'createdAt'> & { createdAt: Timestamp } = {
      id: labelId,
      ownerType,
      ownerId,
      status: 'available',
      createdAt: Timestamp.now(),
    };
    const docRef = doc(labelsCollection, labelId);
    batch.set(docRef, newLabel);
  }

  try {
    await batch.commit();
    return { data: { generatedCount: quantity } };
  } catch (error: any) {
    console.error("Error saving general labels:", error);
    return { error: `Failed to save general labels: ${error.message}` };
  }
}

export async function getLabelsForOwner(ownerId: string): Promise<{ data?: GeneralLabel[]; error?: string }> {
    try {
        const q = query(collection(firestore, "generalLabels"), where("ownerId", "==", ownerId));
        const querySnapshot = await getDocs(q);
        const labels = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return convertTimestampsToDates(data) as GeneralLabel;
        });
        return { data: labels.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) };
    } catch (error: any) {
        console.error("Error loading labels for owner:", error);
        return { error: `Failed to load labels: ${error.message}` };
    }
}

// Actions for Merchandise Reception
export async function getAllProducts(): Promise<{ success: boolean; data?: ReceptionProduct[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "productDatabase"));
        const products = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id, // Ensure id is correctly assigned
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

  // Firestore 'in' queries are limited to 30 items per query.
  // We need to batch the requests.
  for (let i = 0; i < barcodes.length; i += 30) {
      const batchBarcodes = barcodes.slice(i, i + 30);
      try {
          const q = query(productCollection, where(documentId(), "in", batchBarcodes));
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach(doc => {
              products.push({
                  id: doc.id,
                  ...(convertTimestampsToDates(doc.data()) as Omit<ProductDatabaseItem, 'id'>)
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
        const productRef = doc(firestore, 'productDatabase', productId);
        await deleteDoc(productRef);
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting product:", error);
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
        console.error("Error creating product:", error);
        return { success: false, error: `Failed to create product: ${error.message}` };
    }
}

export async function updateProduct(productId: string, updates: Partial<Omit<ReceptionProduct, 'id' | 'barcode' | 'created_at' | 'updated_at' | 'user_id'>>): Promise<{ success: boolean; error?: string }> {
    if (!productId) {
        return { success: false, error: 'El ID del producto es inválido o no fue proporcionado.' };
    }
    try {
        const productRef = doc(firestore, 'productDatabase', productId);
        const updateData = { ...updates, updated_at: Timestamp.now() };
        await updateDoc(productRef, updateData);
        return { success: true };
    } catch (error: any) {
        console.error("Error updating product:", error);
        return { success: false, error: `Failed to update product: ${error.message}` };
    }
}

export async function bulkCreateAlternateBarcodes(
    rows: AlternateBarcodeUploadRow[]
): Promise<{ success: boolean; summary?: { successCount: number; failedCount: number }; errors?: string[]; error?: string }> {
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
        try {
            // Step 1: Find the main product by ref and size
            const mainProductResult = await getProductByRefAndSize(row.referencia, row.talla);
            if (mainProductResult.status !== 'success' || !mainProductResult.item) {
                errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: Producto principal no encontrado.`);
                failedCount++;
                continue;
            }

            // Step 2: Check if the alternate barcode already exists
            const alternateBarcode = row.codigo_alterno.trim();
            const alternateExistsResult = await lookupBarcode(alternateBarcode);
            if (alternateExistsResult.status === 'success') {
                errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: El código alterno ${alternateBarcode} ya existe.`);
                failedCount++;
                continue;
            }
            
            // Step 3: Create the new product (alternate barcode)
            const mainProduct = mainProductResult.item;
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

            if (createResult.success) {
                successCount++;
            } else {
                errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: Error al crear: ${createResult.error}`);
                failedCount++;
            }

        } catch (e: any) {
            errors.push(`Fila [Ref: ${row.referencia}, Talla: ${row.talla}]: Error inesperado - ${e.message}`);
            failedCount++;
        }
    }

    return {
        success: true,
        summary: { successCount, failedCount },
        errors,
    };
}

export async function registerNovelty(noveltyData: Omit<ItemNovelty, 'id' | 'created_at' | 'updated_at' | 'status'>, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await addDoc(collection(firestore, 'item_novelties'), {
            ...noveltyData,
            user_id: userId,
            status: 'pending',
            created_at: Timestamp.now(),
            updated_at: Timestamp.now(),
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error registering novelty:", error);
        return { success: false, error: `Failed to register novelty: ${error.message}` };
    }
}

export async function updateNovelty(noveltyId: string, updates: Partial<Pick<ItemNovelty, 'status' | 'description'>>): Promise<{ success: boolean; error?: string }> {
    try {
        const noveltyRef = doc(firestore, "item_novelties", noveltyId);
        await updateDoc(noveltyRef, { ...updates, updated_at: Timestamp.now() });
        return { success: true };
    } catch (error: any) {
        console.error("Error updating novelty:", error);
        return { success: false, error: `Failed to update novelty: ${error.message}` };
    }
}

export async function getAllNovelties(): Promise<{ success: boolean; data?: ItemNovelty[]; error?: string }> {
    try {
        const q = query(collection(firestore, "item_novelties"), orderBy("created_at", "desc"));
        const querySnapshot = await getDocs(q);
        const novelties = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
            } as ItemNovelty;
        });
        return { success: true, data: convertTimestampsToDates(novelties) as ItemNovelty[] };
    } catch (error: any) {
        console.error("Error loading all novelties:", error);
        return { success: false, error: `Failed to load all novelties: ${error.message}` };
    }
}

export async function createReceptionOperation(operationData: Omit<ReceptionOperation, 'id' | 'created_at' | 'updated_at' | 'user_id' | 'status' | 'expectedItems'>, userId: string): Promise<{ success: boolean; error?: string, id?: string }> {
  try {
    const newOperation = {
      ...operationData,
      status: 'pending',
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
      user_id: userId,
      expectedItems: [],
      totalScannedQuantity: 0, // Initialize summary field
    };
    const docRef = await addDoc(collection(firestore, 'receptionOperations'), newOperation);
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error("Error creating reception operation:", error);
    return { success: false, error: `Failed to create reception operation: ${error.message}` };
  }
}

export async function updateReceptionOperation(operationId: string, updates: Partial<Omit<ReceptionOperation, 'id' | 'created_at' | 'updated_at' | 'user_id' | 'rk_identifier'>>): Promise<{ success: boolean; error?: string }> {
  try {
    const operationRef = doc(firestore, 'receptionOperations', operationId);
    const updateData = {
      ...updates,
      updated_at: Timestamp.now(),
    };
    await updateDoc(operationRef, updateData);
    return { success: true };
  } catch (error: any) {
    console.error("Error updating reception operation:", error);
    return { success: false, error: `Failed to update reception operation: ${error.message}` };
  }
}


export async function getLocations(): Promise<{ success: boolean; data?: Location[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "locations"));
        const locations = querySnapshot.docs.map(doc => {
            return {
                id: doc.id,
                ...(convertTimestampsToDates(doc.data()) as Omit<Location, 'id'>)
            };
        });
        return { success: true, data: locations };
    } catch (error: any) {
        console.error("Error loading locations:", error);
        return { success: false, error: `Failed to load locations: ${error.message}` };
    }
}

export async function loadReceptionOperations(options: { statusFilter?: Array<'pending' | 'in_progress' | 'completed' | 'cancelled'>, limit?: number } = {}): Promise<{
    success: boolean;
    data?: { operations: ReceptionOperation[] };
    error?: string;
}> {
    try {
        const opsCollection = collection(firestore, 'receptionOperations');
        let q;

        // Base query with optional limit
        const queryConstraints = [limit(options.limit || 100)];
        
        // Add status filter if provided
        if (options.statusFilter && options.statusFilter.length > 0) {
            queryConstraints.unshift(where('status', 'in', options.statusFilter));
        }

        q = query(opsCollection, ...queryConstraints);

        const querySnapshot = await getDocs(q);
        let operations: ReceptionOperation[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                created_at: data.created_at?.toDate()?.toISOString() || new Date(0).toISOString(),
                updated_at: data.updated_at?.toDate()?.toISOString() || new Date(0).toISOString(),
            } as ReceptionOperation;
        });

        // Sort by creation date descending in JavaScript
        operations.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return { success: true, data: { operations } };
    } catch (error: any) {
        console.error("Error loading reception operations:", error);
        // Provide a more user-friendly error message that hints at the cause
        if ((error as FirebaseError).code === 'failed-precondition') {
             return { success: false, error: `La consulta requiere un índice compuesto que no existe. Por favor, cree el índice en la consola de Firebase como se sugiere en el mensaje de error original o simplifique la consulta.` };
        }
        return { success: false, error: `Failed to load reception operations: ${error.message}` };
    }
}


export async function getPackingUnitsForOperation(receptionId: string): Promise<{ success: boolean; data?: PackingUnit[]; error?: string }> {
  try {
    const q = query(
      collection(firestore, 'packingUnits'),
      where('reception_id', '==', receptionId)
    );
    const querySnapshot = await getDocs(q);
    const packingUnits = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        firestoreId: doc.id,
        ...convertTimestampsToDates(data)
      } as PackingUnit;
    });
    return { success: true, data: packingUnits };
  } catch (error: any) {
    console.error("Error getting packing units for operation:", error);
    return { success: false, error: `Failed to get packing units: ${error.message}` };
  }
}

export async function getScannedItemsByReception(receptionId: string): Promise<{ success: boolean, data?: ScannedItem[], error?: string }> {
    try {
        const q = query(collection(firestore, 'scannedItems'), where('reception_id', '==', receptionId));
        const querySnapshot = await getDocs(q);
        const items = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data()),
        } as ScannedItem));
        return { success: true, data: items };
    } catch (error: any) {
        console.error("Error getting scanned items for reception:", error);
        return { success: false, error: `Failed to get scanned items: ${error.message}` };
    }
}

    