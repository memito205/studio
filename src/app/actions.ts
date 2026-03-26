

"use server";

// AI features are disabled for Spark plan compatibility.
// To re-enable, you must upgrade to the Blaze plan, restore the Genkit packages
// in package.json, and uncomment the related code in this file and in src/ai/genkit.ts.

import type { ProductivitySettings, ProcessedReportData, PackerProductivity, PackerReferenceProductivityDetail, IncidentLogEntry, DeadTimeEntry, WholesaleOrder, WholesaleOrderDetail, ProductDatabaseItem, PackingScanResult, OrderStatus, PackingSession, PreprintedLabel, LabelValidationResult, GeneralLabel, GeneralLabelOwnerType, ItemNovelty, ReceptionProduct, ReceptionOperation, ScannedItem, OperationPause, ReceptionExpectedItem, Location, PackingUnit, AppUser, ActivityLog, UserGoal, ReportSummary, ReportConfiguration, RemisionEntry, AlternateBarcodeUploadRow, CsvRow, PackedItem, DiscardedRecord, DispatchSessionInfo, VtexRate, RouteEntry, EcommerceOrder, SampleReference, SampleDelivery, ComparisonResult, SavedSampleVerification, TransferEntry, DeliveryManifest, DelayedOrderLog, Justification, SavedVerification, CollectionLog, TransferStatus, RouteStatus, OperationPulse, SmartAlert, PulseReason, ManualJustifications } from "@/types";
import { firestore } from "@/services/firebase";
import { collection, addDoc, getDocs, Timestamp, doc, setDoc, getDoc, writeBatch, documentId, where, query, QueryDocumentSnapshot, DocumentData, updateDoc, collectionGroup, runTransaction, orderBy, limit, deleteDoc, getCountFromServer, startAt, startAfter, increment, DocumentReference, arrayUnion, arrayRemove, deleteField } from 'firebase/firestore';
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


export async function handleExecutiveSummary(reportData: ProcessedReportData): Promise<{ data?: { summary: string[] }; error?: string }> {
  try {
    // const result = await getExecutiveSummary(reportData);
    // return { data: result };
    return { error: "AI features are disabled on the current plan." };
  } catch (error) {
    return { error: "Failed to get executive summary. Please try again." };
  }
}

export async function handleRootCauseAnalysis(context: PackerProductivity | PackerReferenceProductivityDetail, type: 'operator' | 'reference'): Promise<{ data?: { analysis: string }; error?: string }> {
    try {
        // const result = await getRootCauseAnalysis({ context, type });
        // return { data: result };
        return { error: "AI features are disabled on the current plan." };
    } catch (error: any) {
        console.error("Error in handleRootCauseAnalysis action:", error);
        return { error: "Failed to get root cause analysis. Please try again." };
    }
}

export async function handleGetJustificationSuggestions(incidents: DeadTimeEntry[]): Promise<{ data?: { suggestions: Record<string, string> }; error?: string }> {
    try {
        // const result = await getJustificationSuggestions({ incidents });
        // return { data: result };
         return { error: "AI features are disabled on the current plan." };
    } catch (error: any) {
        console.error("Error in handleGetJustificationSuggestions action:", error);
        return { error: "Failed to get justification suggestions. Please try again." };
    }
}

export async function handleGenerateSmartAlerts(reportData: ProcessedReportData): Promise<{ data?: { alerts: SmartAlert[] }; error?: string }> {
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
        const reportDateObj = new Date(reportData.reportDate + 'T00:00:00');
        
        if (isNaN(reportDateObj.getTime())) {
            throw new Error(`Invalid reportDate: ${reportData.reportDate}`);
        }
        
        const snapshotId = `snapshot-${reportTimestamp.toISOString().replace(/:/g, '-')}`;
        
        const reportsCollectionRef = collection(firestore, "reports");
        const reportsSummaryCollectionRef = collection(firestore, "reports_summary");
        
        // 1. Prepare Summary first (always small, high priority)
        const totalQuantity = reportData.packerProductivity.reduce((sum, p) => sum + p.totalQuantity, 0);
        const totalHours = reportData.packerProductivity.reduce((sum, p) => sum + p.hoursWorked, 0);
        const avgProductivity = totalHours > 0 ? totalQuantity / totalHours : 0;

        // Strip 'entries' from productivity data to avoid bloating the summary
        const cleanBrandProductivity = reportData.brandProductivity?.map(b => {
            const { entries, ...rest } = b;
            return rest;
        }) || [];
        
        const cleanProductTypeProductivity = reportData.productTypeProductivity?.map(p => {
            const { entries, ...rest } = p;
            return rest;
        }) || [];

        const reportSummary: ReportSummary = {
            id: snapshotId,
            reportDate: reportDateObj,
            snapshotCreatedAt: reportTimestamp,
            overallCompliance: reportData.overallCompliance,
            operatorCount: reportData.packerProductivity.length,
            totalQuantity: totalQuantity,
            totalHours: totalHours,
            avgProductivity: avgProductivity,
            brandCompliance: reportData.brandProductivity.map(b => ({ brandName: b.brandName, compliance: b.compliance })),
            operatorNames: reportData.packerProductivity.map(p => p.packerName),
            isConsolidated: reportData.isConsolidated || false,
            sourceSnapshotIds: reportData.sourceSnapshotIds || [],
            manualJustifications: reportData.manualJustifications || {},
            incidentLog: reportData.incidentLog || [],
            annotations: reportData.annotations || {},
            packerProductivity: reportData.packerProductivity,
            brandProductivity: cleanBrandProductivity as any,
            productTypeProductivity: cleanProductTypeProductivity as any,
            deadTimeSummary: reportData.deadTimeSummary,
            microPausesSummary: reportData.microPausesSummary,
            packerBrandProductivityDetail: reportData.packerBrandProductivityDetail,
            hourlyProductivity: reportData.hourlyProductivity,
            reasonsSummary: reportData.reasonsSummary,
        };

        // 2. Try to save the full snapshot with aggressive pruning on failure
        let snapshotSaved = false;
        let snapshotError = "";
        
        const trySave = async (data: any, label: string) => {
            try {
                // FORCE guaranteed local variables to avoid 'undefined' errors in Firestore
                data.id = snapshotId;
                data.snapshotCreatedAt = reportTimestamp;
                
                const reportDocRef = doc(reportsCollectionRef, snapshotId);
                await setDoc(reportDocRef, convertDatesToTimestamps(data));
                snapshotSaved = true;
                console.log(`Snapshot saved successfully (${label})`);
                return true;
            } catch (e: any) {
                console.error(`Snapshot save failed (${label}):`, e.message);
                snapshotError = e.message;
                return false;
            }
        };

        // Attempt 1: Full Report
        if (!await trySave({ ...reportData }, "Full")) {
            // Attempt 2: Without individual scans (processedData)
            const opt2 = { ...reportData };
            delete opt2.processedData;
            if (!await trySave(opt2, "Optimized - No Scans")) {
                // Attempt 3: Without reference-level breakdown (very heavy)
                const opt3 = { ...opt2 };
                delete (opt3 as any).packerReferenceProductivityDetail;
                if (!await trySave(opt3, "Optimized - No Reference Detail")) {
                    // Attempt 4: Minimum viable snapshot (KPIs only)
                    const opt4 = {
                        id: snapshotId,
                        reportDate: reportData.reportDate,
                        overallCompliance: reportData.overallCompliance,
                        packerProductivity: reportData.packerProductivity || [],
                        brandProductivity: cleanBrandProductivity || [],
                        productTypeProductivity: cleanProductTypeProductivity || [],
                        incidentLog: reportData.incidentLog || [],
                        manualJustifications: reportData.manualJustifications || {},
                        annotations: reportData.annotations || {},
                        snapshotCreatedAt: reportTimestamp,
                        deadTimeSummary: reportData.deadTimeSummary || [],
                        microPausesSummary: reportData.microPausesSummary || [],
                        reasonsSummary: reportData.reasonsSummary || [],
                    };
                    await trySave(opt4, "Minimum Viable Snapshot");
                }
            }
        }

        // 3. Save the summary (critical for the list)
        const summaryDocRef = doc(reportsSummaryCollectionRef, snapshotId);
        await setDoc(summaryDocRef, convertDatesToTimestamps(reportSummary));

        if (!snapshotSaved) {
            return { error: `No se pudo guardar el detalle del reporte ni en modo optimizado: ${snapshotError}. Los datos exceden los límites críticos de Firestore.` };
        }

        return { data: { id: snapshotId } };
    } catch (error: any) {
        console.error("Error saving report to history:", error);
        return { error: `Error crítico al guardar: ${error.message}` };
    }
}

// --- Operation Pulses & Status Actions ---

export async function getCurrentPulse(userId: string): Promise<{ data?: OperationPulse | null; error?: string }> {
    try {
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('userId', '==', userId),
            where('endTime', '==', null),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) return { data: null };
        
        const docSnap = querySnapshot.docs[0];
        return { data: { id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as OperationPulse };
    } catch (error: any) {
        return { error: `Error fetching current pulse: ${error.message}` };
    }
}

export async function createPulse(pulseData: Omit<OperationPulse, 'id'>): Promise<{ data?: string; error?: string }> {
    try {
        // 1. End any existing active pulse for this user
        const current = await getCurrentPulse(pulseData.userId);
        if (current.data?.id) {
            await endPulse(current.data.id, new Date());
        }

        // 2. Create the new pulse
        const docRef = await addDoc(collection(firestore, 'operation_pulses'), convertDatesToTimestamps(pulseData));
        
        // 3. Update the user's current status for the floor monitor
        await setDoc(doc(firestore, 'users', pulseData.userId), {
            currentStatus: pulseData.status,
            currentReason: pulseData.reason || null,
            currentPulseId: docRef.id,
            lastStatusChange: Timestamp.now(),
            userName: pulseData.userName
        }, { merge: true });

        return { data: docRef.id };
    } catch (error: any) {
        return { error: `Error creating pulse: ${error.message}` };
    }
}

export async function endPulse(pulseId: string, endTime: Date): Promise<{ success: boolean; error?: string }> {
    try {
        const pulseRef = doc(firestore, 'operation_pulses', pulseId);
        const pulseSnap = await getDoc(pulseRef);
        
        if (pulseSnap.exists()) {
            const pulseData = pulseSnap.data();
            const userId = pulseData.userId;
            
            await updateDoc(pulseRef, { endTime: Timestamp.fromDate(endTime) });
            
            // Update user status back to 'Disponible' or 'Inactivo'
            await updateDoc(doc(firestore, 'users', userId), {
                currentStatus: 'Disponible',
                currentReason: null,
                currentPulseId: null,
                lastStatusChange: Timestamp.now()
            });
        }
        
        return { success: true };
    } catch (error: any) {
        console.error("Error ending pulse:", error);
        return { success: false, error: `Error ending pulse: ${error.message}` };
    }
}

export async function getGlobalPulse(): Promise<{ data?: OperationPulse | null; error?: string }> {
    try {
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('isGlobal', '==', true),
            where('endTime', '==', null),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) return { data: null };
        
        const docSnap = querySnapshot.docs[0];
        return { data: { id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as OperationPulse };
    } catch (error: any) {
        return { error: `Error fetching global pulse: ${error.message}` };
    }
}

export async function setGlobalPulse(active: boolean, reason?: PulseReason, adminId?: string, adminName?: string): Promise<{ success: boolean; error?: string }> {
    try {
        const current = await getGlobalPulse();
        
        if (active) {
            if (current.data) return { success: true }; // Already active
            
            await addDoc(collection(firestore, 'operation_pulses'), {
                userId: adminId || 'system',
                userName: adminName || 'Administrador',
                type: 'pause',
                status: 'Pausado',
                reason: reason || 'Pausa Global',
                startTime: Timestamp.now(),
                endTime: null,
                isGlobal: true
            });
        } else {
            if (!current.data?.id) return { success: true }; // Not active
            await endPulse(current.data.id, new Date());
        }
        
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Error setting global pulse: ${error.message}` };
    }
}

export async function getAllUserStatuses(): Promise<{ data?: any[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, 'users'));
        const users = querySnapshot.docs.map(doc => ({
            uid: doc.id,
            ...convertTimestampsToDates(doc.data())
        }));
        return { data: users };
    } catch (error: any) {
        return { error: `Error loading user statuses: ${error.message}` };
    }
}

export async function getPulsesByDate(dateStr: string): Promise<{ data?: OperationPulse[]; error?: string }> {
    try {
        const start = Timestamp.fromDate(new Date(dateStr + 'T00:00:00'));
        const end = Timestamp.fromDate(new Date(dateStr + 'T23:59:59'));
        
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('startTime', '>=', start),
            where('startTime', '<=', end)
        );
        
        const querySnapshot = await getDocs(q);
        const pulses = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        } as OperationPulse));
        
        return { data: pulses };
    } catch (error: any) {
        return { error: `Error fetching pulses by date: ${error.message}` };
    }
}

export async function getUserPulsesForDay(userId: string, dateStr: string): Promise<{ data?: OperationPulse[]; error?: string }> {
    try {
        const start = Timestamp.fromDate(new Date(dateStr + 'T00:00:00'));
        const end = Timestamp.fromDate(new Date(dateStr + 'T23:59:59'));
        
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('startTime', '>=', start),
            where('startTime', '<=', end)
        );
        
        const querySnapshot = await getDocs(q);
        const pulses = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as OperationPulse))
            .filter(p => p.isGlobal || p.userId === userId);
            
        return { data: pulses };
    } catch (error: any) {
        return { error: `Error loading user pulses: ${error.message}` };
    }
}

export async function loadHistoricalReports(options?: { startDate?: string, endDate?: string }): Promise<{ data?: ReportSummary[], error?: string }> {
    try {
        const reportsCollectionRef = collection(firestore, "reports_summary");
        
        // If no dates are provided, return empty to wait for user action.
        if (!options?.startDate || !options?.endDate) {
            return { data: [] };
        }

        // Use explicit time strings to ensure consistency with saveReportToHistory
        // This avoids any parseISO local/UTC ambiguity
        const start = startOfDay(new Date(options.startDate + 'T00:00:00'));
        const end = endOfDay(new Date(options.endDate + 'T00:00:00'));
        
        console.log(`[HistoricalQuery] Range: ${start.toISOString()} - ${end.toISOString()}`);

        const q = query(
            reportsCollectionRef, 
            where("reportDate", ">=", start),
            where("reportDate", "<=", end)
            // Removed orderBy here to avoid requiring a composite index in Firestore.
        );

        const querySnapshot = await getDocs(q);
        const reports = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as ReportSummary[];

        // Sort by reportDate descending, then by snapshotCreatedAt descending for items on the same day
        reports.sort((a, b) => {
            const dateA = a.reportDate instanceof Date ? a.reportDate.getTime() : new Date(a.reportDate as any).getTime();
            const dateB = b.reportDate instanceof Date ? b.reportDate.getTime() : new Date(b.reportDate as any).getTime();
            
            if (dateB !== dateA) return dateB - dateA;
            
            const timeA = a.snapshotCreatedAt instanceof Date ? a.snapshotCreatedAt.getTime() : new Date(a.snapshotCreatedAt as any).getTime();
            const timeB = b.snapshotCreatedAt instanceof Date ? b.snapshotCreatedAt.getTime() : new Date(b.snapshotCreatedAt as any).getTime();
            return timeB - timeA;
        });

        return { data: convertTimestampsToDates(reports) as ReportSummary[] };
    } catch (error: any) {
        console.error("Error loading historical reports:", error);
        if (error.code === 'failed-precondition') {
             return { error: `Error de consulta: Firestore requiere un índice compuesto para esta consulta. Por favor, crea uno en la consola de Firebase.` };
        }
        return { error: `Failed to load historical reports: ${error.message}` };
    }
}

export async function loadFullReportSnapshots(snapshotIds: string[]): Promise<{ data?: ProcessedReportData[], error?: string }> {
    if (!snapshotIds || snapshotIds.length === 0) return { data: [] };
    try {
        const reportsCollectionRef = collection(firestore, "reports");
        const chunkedIds = [];
        for (let i = 0; i < snapshotIds.length; i += 10) {
            chunkedIds.push(snapshotIds.slice(i, i + 10));
        }
        
        const allReports: ProcessedReportData[] = [];
        for (const chunk of chunkedIds) {
            const q = query(reportsCollectionRef, where(documentId(), "in", chunk));
            const querySnapshot = await getDocs(q);
            querySnapshot.docs.forEach(doc => {
                allReports.push({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as ProcessedReportData);
            });
        }
        return { data: allReports };
    } catch (error: any) {
        console.error("Error loading full report snapshots:", error);
        return { error: `Failed to load full reports: ${error.message}` };
    }
}

export async function deleteHistoricalReportsForDay(dateStr: string): Promise<{ success: boolean; error?: string }> {
    try {
        const dateObjNoon = new Date(dateStr + "T12:00:00");
        const rangeStart = new Date(dateStr + "T00:00:00");
        const rangeEnd = new Date(dateStr + "T23:59:59");
        
        // First try exact matches (String or specific Timestamp)
        let summarySnap = await getDocs(query(
            collection(firestore, "reports_summary"),
            where("reportDate", "in", [dateStr, dateObjNoon])
        ));

        // If nothing found, try a range query (covers any Timestamps within that day)
        if (summarySnap.empty) {
            summarySnap = await getDocs(query(
                collection(firestore, "reports_summary"),
                where("reportDate", ">=", rangeStart),
                where("reportDate", "<=", rangeEnd)
            ));
        }
        
        const summaryDocs = summarySnap.docs;
        if (summaryDocs.length === 0) {
            console.log(`[DeleteHistory] No reports found to delete for ${dateStr} (Checked string, noon-date, and range)`);
            return { success: true }; 
        }

        const summaryIds = summaryDocs.map(doc => doc.id);
        
        // Chunk deletions into batches of 200 (Firestore limit is 500 ops)
        // Each loop iteration does 2 ops (summary + full report) -> 400 ops per batch
        const CHUNK_SIZE = 200; 

        for (let i = 0; i < summaryDocs.length; i += CHUNK_SIZE) {
            const batch = writeBatch(firestore);
            const chunk = summaryDocs.slice(i, i + CHUNK_SIZE);
            
            chunk.forEach(sDoc => {
                batch.delete(sDoc.ref);
                // Also delete the full report snapshot if it exists
                batch.delete(doc(firestore, "reports", sDoc.id));
            });
            
            await batch.commit();
        }

        console.log(`[DeleteHistory] Successfully deleted ${summaryDocs.length} reports and snapshots for ${dateStr}`);
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting historical reports:", error);
        return { success: false, error: error.message };
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
        
        // Combine the processedData and manualJustifications from each snapshot
        const allProcessedData = validSnapshots.flatMap(snapshot => snapshot.processedData || []);
        
        // Combine justifications: later snapshots overwrite earlier ones for the same ID
        const combinedJustifications: ManualJustifications = {};
        validSnapshots
            .sort((a, b) => new Date(a.snapshotCreatedAt).getTime() - new Date(b.snapshotCreatedAt).getTime())
            .forEach(snapshot => {
                if (snapshot.manualJustifications) {
                    Object.assign(combinedJustifications, snapshot.manualJustifications);
                }
            });
        
        return { success: true, combinedData: { 
            allProcessedData, 
            lastReportConfig: { ...lastReportConfig, manualJustifications: combinedJustifications } 
        } };

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
    
    // Call the processor to get a fully calculated report object
    const consolidatedProcessedData = processReport(
        allProcessedData,
        lastReportConfig.brandProductTypeGoals || {},
        reportDateStr,
        lastReportConfig.reportStartTime,
        lastReportConfig.reportEndTime,
        lastReportConfig.manualJustifications || {},
        ['all'],
        lastReportConfig.incidentLog || []
    );
    
    // Set consolidated flag
    consolidatedProcessedData.isConsolidated = true;
    consolidatedProcessedData.sourceSnapshotIds = snapshotIds;
    
    const result = await saveReportToHistory(consolidatedProcessedData);
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
        
        // Extract local date string YYYY-MM-DD safely
        const reportDateObj = new Date(lastReportConfig.reportDate);
        if (isNaN(reportDateObj.getTime())) {
            throw new Error("Invalid report date format in the configuration for preview.");
        }
        const year = reportDateObj.getFullYear();
        const month = String(reportDateObj.getMonth() + 1).padStart(2, '0');
        const day = String(reportDateObj.getDate()).padStart(2, '0');
        const reportDateStr = `${year}-${month}-${day}`;
        
        const consolidatedProcessedData = processReport(
            allProcessedData,
            lastReportConfig.brandProductTypeGoals || {},
            reportDateStr,
            lastReportConfig.reportStartTime || '06:00',
            lastReportConfig.reportEndTime || '18:00',
            lastReportConfig.manualJustifications || {},
            lastReportConfig.configSelectedPacker || [],
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
            incidentLog: lastReportConfig.incidentLog || [],
        };

        return { data: previewReport };
    } catch (error: any) {
        console.error("Error generating preview for consolidated report:", error);
        return { error: `Failed to generate preview: ${error.message}` };
    }
}


export async function saveWholesaleOrders(orders: WholesaleOrder[]): Promise<{ data?: { processedCount: number }; error?: string }> {
  const ordersCollection = collection(firestore, "wholesaleOrders");
  const CHUNK_SIZE = 450; // Firestore batch limit is 500, use a safe margin

  try {
    for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
        const chunk = orders.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(firestore);
        
        for (const order of chunk) {
            const docRef = doc(ordersCollection, String(order.id));
            const orderForFirestore = {
                ...order,
                fecha: Timestamp.fromDate(new Date(order.fecha)),
            };
            batch.set(docRef, orderForFirestore, { merge: true });
        }
        await batch.commit();
    }
    return { data: { processedCount: orders.length } };

  } catch (error: any) {
    console.error("Error saving wholesale orders in chunks:", error);
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
  const dbCollection = collection(firestore, "productDatabase");
  const CHUNK_SIZE = 450;
  
  try {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(firestore);

        for (const item of chunk) {
            if (!item.codigoBarras) continue;
            const docRef = doc(dbCollection, item.codigoBarras);
            batch.set(docRef, item, { merge: true });
        }
        await batch.commit();
    }
    return { data: { processedCount: items.length } };
    
  } catch (error: any) {
    console.error("Error saving product database items in chunks:", error);
    return { error: `Falló al guardar los productos en la base de datos: ${error.message}` };
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
  const labelsCollection = collection(firestore, "preprintedLabels");
  const CHUNK_SIZE = 450;

  try {
    for (let i = 0; i < boxCount; i += CHUNK_SIZE) {
        const batch = writeBatch(firestore);
        const chunkEnd = Math.min(i + CHUNK_SIZE, boxCount);
        for (let j = i; j < chunkEnd; j++) {
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
        await batch.commit();
    }
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
  
  const labelsCollection = collection(firestore, "generalLabels");
  const getInitials = (name: string): string => {
      return name.split(' ').map(word => word.charAt(0)).join('').toUpperCase();
  };

  let startingCount = 0;
  // For packers, we find the current count to make the new labels sequential.
  if (ownerType === 'packer') {
      try {
          const q = query(labelsCollection, where("ownerId", "==", ownerId));
          const snapshot = await getCountFromServer(q);
          startingCount = snapshot.data().count;
      } catch (error: any) {
          console.error("Error getting count for existing labels:", error);
          return { error: `Failed to count existing labels: ${error.message}` };
      }
  }

  const CHUNK_SIZE = 450;
  try {
    for(let i = 0; i < quantity; i += CHUNK_SIZE) {
        const batch = writeBatch(firestore);
        const chunkEnd = Math.min(i + CHUNK_SIZE, quantity);
        for (let j = i; j < chunkEnd; j++) {
            let labelId: string;

            if (ownerType === 'store') {
                const randomId = generateAlphanumericId();
                labelId = `TIENDAS-${ownerId}-${randomId}`;
            } else { // packer
                const ownerPrefix = getInitials(ownerId);
                const sequentialId = startingCount + j + 1;
                labelId = `BOD-${ownerPrefix}-${sequentialId}`;
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
        await batch.commit();
    }
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

export async function markGeneralLabelsAsUsed(labelIds: string[]): Promise<{ success: boolean, error?: string }> {
    if (!labelIds || labelIds.length === 0) {
        return { success: false, error: "No se proporcionaron IDs de etiquetas." };
    }
    const labelsCollection = collection(firestore, "generalLabels");
    const CHUNK_SIZE = 450;
    
    try {
        for (let i = 0; i < labelIds.length; i += CHUNK_SIZE) {
            const chunk = labelIds.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            
            chunk.forEach(id => {
                const docRef = doc(labelsCollection, id);
                batch.update(docRef, { 
                    status: 'used',
                    usedAt: Timestamp.now(),
                });
            });
            await batch.commit();
        }
        return { success: true };
    } catch (error: any) {
        console.error("Error marking general labels as used:", error);
        return { success: false, error: `Failed to update label statuses: ${error.message}` };
    }
}

export async function searchGeneralLabels(searchQuery: string): Promise<{ data?: GeneralLabel[]; error?: string }> {
    if (!searchQuery) {
        return { data: [] };
    }
    try {
        // Firestore does not support partial string search (like 'contains' or 'LIKE').
        // A common workaround for "starts with" is using a range query.
        const q = query(
            collection(firestore, "generalLabels"),
            where('id', '>=', searchQuery.toUpperCase()),
            where('id', '<=', searchQuery.toUpperCase() + '\uf8ff'),
            limit(20) // Limit results to avoid fetching too many documents
        );
        const querySnapshot = await getDocs(q);
        const labels = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return convertTimestampsToDates(data) as GeneralLabel;
        });
        return { data: labels };
    } catch (error: any) {
        console.error("Error searching general labels:", error);
        return { error: `Failed to search labels: ${error.message}` };
    }
}
    
// --- Actions for Packed Items (New Architecture) ---
export async function addPackedItem(itemData: Omit<PackedItem, 'id' | 'scannedAt' | 'quantity'>): Promise<{ success: boolean, error?: string, itemId?: string }> {
    try {
        const itemRef = doc(collection(firestore, "packedItems"));
        const newItem = {
            ...itemData,
            quantity: 1, // Always add one at a time initially
            scannedAt: new Date()
        };
        await setDoc(itemRef, convertDatesToTimestamps(newItem));
        return { success: true, itemId: itemRef.id };
    } catch (error: any) {
        console.error("Error adding packed item:", error);
        return { success: false, error: error.message };
    }
}

export async function getPackedItemsForOrder(orderId: string): Promise<{ data?: PackedItem[], error?: string }> {
    try {
        const q = query(collection(firestore, "packedItems"), where("orderId", "==", orderId));
        const querySnapshot = await getDocs(q);
        const items = querySnapshot.docs.map(doc => convertTimestampsToDates({ id: doc.id, ...doc.data() }) as PackedItem);
        return { data: items };
    } catch (error: any) {
        console.error("Error getting packed items:", error);
        return { error: error.message };
    }
}

export async function updatePackedItem(itemId: string, updates: Partial<PackedItem>): Promise<{ success: boolean, error?: string }> {
    try {
        await updateDoc(doc(firestore, "packedItems", itemId), updates);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deletePackedItem(itemId: string): Promise<{ success: boolean, error?: string }> {
    try {
        await deleteDoc(doc(firestore, "packedItems", itemId));
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// --- Dispatch Actions ---

export async function getShipments(): Promise<{ success: boolean; data?: DispatchSessionInfo[]; error?: string; }> {
    try {
        const q = query(collection(firestore, "dispatchSessions"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const shipments = querySnapshot.docs.map(doc => convertTimestampsToDates({ id: doc.id, ...doc.data() }) as DispatchSessionInfo);
        return { success: true, data: shipments };
    } catch (error: any) {
        return { success: false, error: `Failed to load shipments: ${error.message}` };
    }
}

export async function createShipment(data: { truckPlate: string; driverName: string; sealNumber?: string }): Promise<{ success: boolean; error?: string; shipmentId?: string }> {
    try {
        const newShipment = {
            ...data,
            createdAt: Timestamp.now(),
            status: 'open',
            scannedLabels: {},
            orderIds: []
        };
        const docRef = await addDoc(collection(firestore, "dispatchSessions"), newShipment);
        return { success: true, shipmentId: docRef.id };
    } catch (error: any) {
        return { success: false, error: `Failed to create shipment: ${error.message}` };
    }
}

export async function addScannedLabelToShipment(shipmentId: string, labelId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const shipmentRef = doc(firestore, "dispatchSessions", shipmentId);
        const labelRef = doc(firestore, "preprintedLabels", labelId);

        await runTransaction(firestore, async (transaction) => {
            const shipmentDoc = await transaction.get(shipmentRef);
            const labelDoc = await transaction.get(labelRef);

            if (!shipmentDoc.exists()) throw new Error("Shipment not found.");
            if (shipmentDoc.data().status !== 'open') throw new Error("Shipment is already closed.");
            if (!labelDoc.exists()) throw new Error(`Label ${labelId} not found.`);
            if (labelDoc.data().status !== 'available') throw new Error(`Label ${labelId} has already been used or is void.`);

            const labelData = labelDoc.data();
            const orderId = labelData.orderId;

            // Update shipment
            transaction.update(shipmentRef, {
                [`scannedLabels.${labelId}`]: Timestamp.now(),
                orderIds: arrayUnion(orderId)
            });
            // Update label
            transaction.update(labelRef, { status: 'used' });
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}


export async function removeScannedLabelFromShipment(shipmentId: string, labelId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const shipmentRef = doc(firestore, "dispatchSessions", shipmentId);
        const labelRef = doc(firestore, "preprintedLabels", labelId);

        await runTransaction(firestore, async (transaction) => {
            const shipmentDoc = await transaction.get(shipmentRef);
            if (!shipmentDoc.exists()) throw new Error("Shipment not found.");
            if (shipmentDoc.data().status !== 'open') throw new Error("Cannot modify a closed shipment.");

            // Update shipment to remove the label
            transaction.update(shipmentRef, {
                [`scannedLabels.${labelId}`]: deleteField()
            });

            // Update label status back to available
            transaction.update(labelRef, { status: 'available' });
            
            // Note: We are not removing the orderId from the arrayUnion as it's complex to determine
            // if other labels from the same order still exist in the shipment. This is a simplification.
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function closeShipment(shipmentId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await updateDoc(doc(firestore, "dispatchSessions", shipmentId), {
            status: 'closed',
            dispatchDate: Timestamp.now()
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to close shipment: ${error.message}` };
    }
}

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

export async function updateProductivitySettings(settings: Omit<ProductivitySettings, 'id'>): Promise<{ success: boolean, error?: string }> {
    try {
        await setDoc(doc(firestore, 'settings', 'productivity'), settings, { merge: true });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to update settings: ${error.message}` };
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

export async function upsertUserGoals(userId: string, goals: Omit<UserGoal, 'id' | 'user_id'>): Promise<{ success: boolean, error?: string }> {
    try {
        const goalRef = doc(firestore, 'userGoals', userId);
        await setDoc(goalRef, {
            user_id: userId,
            ...goals,
            updated_at: Timestamp.now(),
        }, { merge: true });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to update user goals: ${error.message}` };
    }
}

export async function createReceptionOperation(data: any, uid: string): Promise<{success: boolean, error?: string}> {
    return { success: false, error: "This function is obsolete and should not be called." };
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

export async function updateNovelty(noveltyId: string, updates: Partial<Omit<ItemNovelty, 'id'>>): Promise<{ success: boolean; error?: string }> {
  try {
    await updateDoc(doc(firestore, "itemNovelties", noveltyId), { ...updates, updated_at: Timestamp.now() });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Failed to update novelty: ${error.message}` };
  }
}

export async function createPackingUnit(orderId: string, userId: string): Promise<{ success: boolean; error?: string; newUnit?: PackingUnit }> {
  let newUnitData: PackingUnit | null = null;
  try {
      await runTransaction(firestore, async (transaction) => {
          const sessionRef = doc(firestore, 'packingSessions', orderId);
          const sessionDoc = await transaction.get(sessionRef);

          if (!sessionDoc.exists()) {
              throw new Error("La sesión de empaque para esta orden no existe.");
          }
          
          const sessionData = sessionDoc.data() as PackingSession;
          const existingUnits = sessionData.units || [];
          const newUnitId = existingUnits.length > 0 ? Math.max(...existingUnits.map(u => u.id)) + 1 : 1;
          
          const newUnit: Omit<PackingUnit, 'firestoreId'> = {
              id: newUnitId,
              status: 'open',
              createdAt: new Date().toISOString(),
              createdBy: userId,
              items: {},
          };

          // We don't have a firestoreId yet, so we'll add it after creation
          // But for the logic inside the transaction, this is what we append
          const updatedUnits = [...existingUnits, newUnit];
          
          transaction.update(sessionRef, { units: updatedUnits });

          // This part is tricky as we can't get the ID until after commit.
          // The calling function will need to re-fetch the session to get the full new unit.
          newUnitData = {
              ...newUnit,
              firestoreId: `temp-${Date.now()}` // Placeholder
          };
      });

      // Refetch to get the correct data with firestoreId if we were to implement it fully.
      // For now, the optimistic update in the caller is what matters.
      // The `newUnit` returned here will be merged into the local state.
      
      return { success: true, newUnit: newUnitData as unknown as PackingUnit };

  } catch (error: any) {
      console.error("Error creating packing unit:", error);
      return { success: false, error: error.message };
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
    
// --- VTEX Rates Actions ---
export async function saveVtexRates(carrier: string, rates: VtexRate[]): Promise<{ success: boolean; error?: string }> {
  if (!carrier || !rates) {
    return { success: false, error: 'Transportadora o tarifas no proporcionadas.' };
  }
  try {
    const docRef = doc(firestore, "vtex_shipping_rates", carrier);
    // We store the entire array of rates in a single field 'rates' within the document.
    await setDoc(docRef, { rates: convertDatesToTimestamps(rates), lastUpdated: Timestamp.now() }, { merge: true });
    return { success: true };
  } catch (error: any) {
    console.error(`Error guardando tarifas VTEX para ${carrier}:`, error);
    return { success: false, error: `Error de base de datos: ${error.message}` };
  }
}

export async function getVtexRates(carrier: string): Promise<{ success: boolean; data?: VtexRate[]; error?: string }> {
  if (!carrier) {
    return { success: false, error: 'Transportadora no proporcionada.' };
  }
  try {
    const docRef = doc(firestore, "vtex_shipping_rates", carrier);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      // The rates are stored in the 'rates' field of the document.
      return { success: true, data: convertTimestampsToDates(data.rates) as VtexRate[] };
    } else {
      // It's not an error if no rates are found, it just means they haven't been saved yet.
      return { success: true, data: [] };
    }
  } catch (error: any) {
    console.error(`Error cargando tarifas VTEX para ${carrier}:`, error);
    return { success: false, error: `Error de base de datos: ${error.message}` };
  }
}

// --- Routes Module Actions ---
export async function saveRoutes(routes: Omit<RouteEntry, 'id'>[]): Promise<{ success: boolean; error?: string }> {
    const routesCollection = collection(firestore, 'routes');
    const CHUNK_SIZE = 450;
    try {
        for (let i = 0; i < routes.length; i += CHUNK_SIZE) {
            const chunk = routes.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(route => {
                const docRef = doc(routesCollection); // Auto-generate ID
                batch.set(docRef, { ...convertDatesToTimestamps(route), status: 'Programado' });
            });
            await batch.commit();
        }
        return { success: true };
    } catch (error: any) {
        console.error("Error guardando rutas:", error);
        return { success: false, error: `No se pudieron guardar las rutas: ${error.message}` };
    }
}

export async function loadAllRoutes(): Promise<{ success: boolean; data?: RouteEntry[]; error?: string }> {
    try {
        const q = query(collection(firestore, "routes"), orderBy("fecha", "desc"));
        const querySnapshot = await getDocs(q);
        const routes = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as RouteEntry[];
        return { success: true, data: routes };
    } catch (error: any) {
        console.error("Error loading all routes:", error);
        return { success: false, error: `Failed to load all routes: ${error.message}` };
    }
}


export async function updateRouteStatus(routeId: string, status: RouteStatus, failureReason?: string): Promise<{ success: boolean; error?: string }> {
    try {
        const routeRef = doc(firestore, "routes", routeId);
        const updates: Partial<RouteEntry> = {
            status,
            updatedAt: new Date(),
        };
        if (status === 'Entrega Fallida' || status === 'Recolección Fallida') {
            updates.failureReason = failureReason;
        }
        await updateDoc(routeRef, convertDatesToTimestamps(updates));
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `No se pudo actualizar el estado de la ruta: ${error.message}` };
    }
}

export async function createManualRouteEntry(data: {
    vehiculo: string;
    numeroTF: string;
    tipoServicio: 'ENTREGA' | 'RECOLECCION';
    almacenDestino: string;
    allRoutes: RouteEntry[];
}): Promise<{ success: boolean; error?: string }> {
    try {
        const batch = writeBatch(firestore);
        const routesCollection = collection(firestore, 'routes');
        
        // Primary manual entry
        const primaryEntry: Omit<RouteEntry, 'id'> = {
            fecha: new Date(),
            vehiculo: data.vehiculo,
            responsable: 'OPERARIO (MANUAL)',
            almacenDestino: data.almacenDestino,
            numeroTF: data.numeroTF,
            tipoServicio: data.tipoServicio,
            status: data.tipoServicio === 'RECOLECCION' ? 'Recogido' : 'Programado',
            isManual: true,
            updatedAt: new Date(),
        };
        const mainDocRef = doc(routesCollection);
        batch.set(mainDocRef, convertDatesToTimestamps(primaryEntry));

        // Logic for corresponding delivery if primary was a recollection
        if (data.tipoServicio === 'RECOLECCION') {
            const originalDestinationExists = data.allRoutes.some(route => route.almacenDestino === data.almacenDestino);
            const deliveriesPendingForDest = data.allRoutes.some(route =>
                route.almacenDestino === data.almacenDestino &&
                route.tipoServicio === 'ENTREGA' &&
                route.status === 'Programado'
            );

            let deliveryDestination = 'BODEGA PPA';
            let originalDestinationForDelivery: string | undefined = data.almacenDestino;
            
            // If the store was on the original route AND it still has pending deliveries,
            // the new delivery goes to that store. Otherwise, it goes to BODEGA PPA.
            if (originalDestinationExists && deliveriesPendingForDest) {
                deliveryDestination = data.almacenDestino;
                originalDestinationForDelivery = undefined;
            }

            const deliveryEntry: Omit<RouteEntry, 'id'> = {
                ...primaryEntry,
                almacenDestino: deliveryDestination,
                tipoServicio: 'ENTREGA',
                status: 'Programado', // The delivery part is always programmed
                originalAlmacenDestino: originalDestinationForDelivery, // Keep track of the original destination if it differs
            };
            const deliveryDocRef = doc(routesCollection);
            batch.set(deliveryDocRef, convertDatesToTimestamps(deliveryEntry));
        }

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error creating manual entry:", error);
        return { success: false, error: `No se pudo crear la entrada manual: ${error.message}` };
    }
}

export async function saveEcommerceOrders(orders: EcommerceOrder[]): Promise<{ success: boolean; data?: { processedCount: number }; error?: string }> {
  if (!orders || orders.length === 0) {
    return { success: false, error: "No se proporcionaron pedidos para guardar." };
  }

  const collectionRef = collection(firestore, "ecommerceOrders");
  
  try {
    const CHUNK_SIZE = 450; // Firestore batch writes are limited to 500 operations
    for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
      const chunk = orders.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);

      for (const order of chunk) {
        const docRef = doc(collectionRef, order.id);
        const orderData = convertDatesToTimestamps(order);
        // Using set with merge: true is more efficient than reading first.
        // It creates the document if it doesn't exist, or updates it if it does.
        batch.set(docRef, orderData, { merge: true });
      }
      await batch.commit();
    }
    
    // Simplified success message as we are not distinguishing between new and updated.
    return { success: true, data: { processedCount: orders.length } };
  } catch (error: any) {
    console.error("Error guardando pedidos de Ecommerce:", error);
    return { success: false, error: `No se pudieron guardar los pedidos: ${error.message}` };
  }
}

export async function loadEcommerceOrders(): Promise<{ success: boolean; data?: EcommerceOrder[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "ecommerceOrders"));
        const orders = querySnapshot.docs.map(doc => {
            return convertTimestampsToDates({ id: doc.id, ...doc.data() }) as EcommerceOrder;
        });
        return { success: true, data: orders };
    } catch (error: any) {
        console.error("Error loading ecommerce orders:", error);
        return { success: false, error: `Failed to load ecommerce orders: ${error.message}` };
    }
}

export async function upsertDelayedOrderLog(orderId: string, detectionDate: Date, lastStatus: string): Promise<{ success: boolean; error?: string }> {
    try {
        const logRef = doc(firestore, 'delayedOrdersLog', orderId);
        await setDoc(logRef, {
            orderId: orderId,
            detectionDates: arrayUnion(Timestamp.fromDate(detectionDate)),
            isResolved: false,
            lastStatus: lastStatus
        }, { merge: true });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function addJustificationToLog(orderId: string, justification: Justification): Promise<{ success: boolean; data?: DelayedOrderLog; error?: string }> {
    try {
        const logRef = doc(firestore, 'delayedOrdersLog', orderId);
        await setDoc(logRef, {
            justifications: arrayUnion(convertDatesToTimestamps(justification)),
            orderId: orderId, // Ensure orderId is present if creating
        }, { merge: true });

        const updatedDocSnap = await getDoc(logRef);
        if (updatedDocSnap.exists()) {
            const updatedData = convertTimestampsToDates({ id: updatedDocSnap.id, ...updatedDocSnap.data() }) as DelayedOrderLog;
            return { success: true, data: updatedData };
        } else {
             // This case should be rare if setDoc just ran
            return { success: false, error: "No se pudo recuperar el registro actualizado." };
        }
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Marks a delayed order as resolved and critically, updates the main ecommerceOrder
 * with the dispatchDate. This makes the dispatch date a persistent fact.
 */
export async function resolveDelayedOrderLog(orderId: string, dispatchDate: Date): Promise<{ success: boolean; error?: string }> {
    try {
        const logRef = doc(firestore, 'delayedOrdersLog', orderId);
        await setDoc(logRef, {
            isResolved: true,
            resolvedAt: Timestamp.fromDate(dispatchDate),
            orderId: orderId,
        }, { merge: true });
        
        const orderRef = doc(firestore, 'ecommerceOrders', orderId);
        await updateDoc(orderRef, {
            dispatchDate: Timestamp.fromDate(dispatchDate)
        });

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getDelayedOrderLogs(): Promise<{ success: boolean; data?: DelayedOrderLog[]; error?: string; }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "delayedOrdersLog"));
        const logs = querySnapshot.docs.map(doc => convertTimestampsToDates({ id: doc.id, ...doc.data() }) as DelayedOrderLog);
        return { success: true, data: logs };
    } catch (error: any) {
        return { success: false, error: `Failed to load delayed order logs: ${error.message}` };
    }
}

export async function batchResolveDelayedOrderLogs(resolutions: { orderId: string, dispatchDate: Date }[]): Promise<{ success: boolean; error?: string }> {
    if (!resolutions || resolutions.length === 0) return { success: true };
    const batch = writeBatch(firestore);
    try {
        resolutions.forEach(({ orderId, dispatchDate }) => {
            const logRef = doc(firestore, 'delayedOrdersLog', orderId);
            batch.set(logRef, {
                isResolved: true,
                resolvedAt: Timestamp.fromDate(dispatchDate),
                orderId: orderId,
            }, { merge: true });

            const orderRef = doc(firestore, 'ecommerceOrders', orderId);
            batch.update(orderRef, {
                dispatchDate: Timestamp.fromDate(dispatchDate)
            });
        });
        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error('Batch resolve error:', error);
        return { success: false, error: error.message };
    }
}

export async function batchUpsertDelayedOrderLogs(logs: { orderId: string, detectionDate: Date, lastStatus: string }[]): Promise<{ success: boolean; error?: string }> {
    if (!logs || logs.length === 0) return { success: true };
    const batch = writeBatch(firestore);
    try {
        logs.forEach(({ orderId, detectionDate, lastStatus }) => {
            const logRef = doc(firestore, 'delayedOrdersLog', orderId);
            batch.set(logRef, {
                orderId: orderId,
                detectionDates: arrayUnion(Timestamp.fromDate(detectionDate)),
                isResolved: false,
                lastStatus: lastStatus
            }, { merge: true });
        });
        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error('Batch upsert error:', error);
        return { success: false, error: error.message };
    }
}


// --- Sample Control Actions ---
export async function saveSampleReferences(references: Pick<SampleReference, 'id' | 'sourceFile'>[]): Promise<{ success: boolean; error?: string; processedCount: number }> {
  if (!references || references.length === 0) {
    return { success: false, error: "No se proporcionaron referencias para guardar.", processedCount: 0 };
  }

  const collectionRef = collection(firestore, "sampleReferences");
  const now = Timestamp.now();
  const CHUNK_SIZE = 450;

  try {
    for (let i = 0; i < references.length; i += CHUNK_SIZE) {
      const chunk = references.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);

      chunk.forEach(ref => {
        if (ref.id && !ref.id.includes('/') && ref.id !== '.' && ref.id !== '..') {
            const docRef = doc(collectionRef, ref.id);
            const dataToSave = {
              lastUploaded: now,
              sourceFile: ref.sourceFile,
            };
            batch.set(docRef, dataToSave, { merge: true });
        } else {
            console.warn(`Referencia inválida omitida: "${ref.id}"`);
        }
      });

      await batch.commit();
    }
    
    return { success: true, processedCount: references.length };

  } catch (error: any) {
    console.error("Error guardando referencias de muestras en lotes:", error);
    return { success: false, error: `No se pudieron guardar las referencias: ${error.message}`, processedCount: 0 };
  }
}


export async function loadSampleReferences(): Promise<{ success: true, data?: SampleReference[]; error?: string } | { success: false, error: string }> {
    try {
        const q = query(collection(firestore, "sampleReferences"), orderBy("lastUploaded", "desc"));
        const querySnapshot = await getDocs(q);
        const references = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as SampleReference[];
        return { success: true, data: references };
    } catch (error: any) {
        console.error("Error loading sample references:", error);
        return { success: false, error: `Failed to load sample references: ${error.message}` };
    }
}

export async function getSampleReferenceById(referenceId: string): Promise<{ success: boolean; data?: SampleReference | null; error?: string }> {
    try {
        const docRef = doc(firestore, "sampleReferences", referenceId.trim());
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return { success: true, data: { id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as SampleReference };
        } else {
            return { success: true, data: null }; // Not an error, just not found
        }
    } catch (error: any) {
        console.error("Error fetching sample reference by ID:", error);
        return { success: false, error: `Failed to fetch sample reference: ${error.message}` };
    }
}

export async function saveSampleDeliveries(deliveries: Omit<SampleDelivery, 'id'>[]): Promise<{ success: boolean; error?: string; processedCount: number }> {
    if (!deliveries || deliveries.length === 0) {
        return { success: false, error: "No se proporcionaron entregas para guardar.", processedCount: 0 };
    }
    
    const collectionRef = collection(firestore, "sampleDeliveries");
    const CHUNK_SIZE = 450;

    try {
        for (let i = 0; i < deliveries.length; i += CHUNK_SIZE) {
            const chunk = deliveries.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            
            chunk.forEach(delivery => {
                const docRef = doc(collectionRef); // Auto-generate ID
                batch.set(docRef, convertDatesToTimestamps(delivery));
            });

            await batch.commit();
        }
        return { success: true, processedCount: deliveries.length };
    } catch (error: any) {
        console.error("Error guardando entregas de muestras:", error);
        return { success: false, error: `No se pudieron guardar las entregas: ${error.message}`, processedCount: 0 };
    }
}

export async function loadAllSampleDeliveries(): Promise<{ success: boolean; data?: SampleDelivery[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, "sampleDeliveries"));
        const deliveries = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as SampleDelivery[];
        return { success: true, data: deliveries };
    } catch (error: any) {
        return { success: false, error: `Failed to load all deliveries: ${error.message}` };
    }
}

export async function getSampleDeliveriesByReferences(references: string[]): Promise<{ success: boolean; data?: SampleDelivery[]; error?: string; }> {
    try {
        if (!references || references.length === 0) {
            return { success: true, data: [] };
        }
        
        const allDeliveries: SampleDelivery[] = [];
        const CHUNK_SIZE = 30; // Firestore 'in' query limit

        for (let i = 0; i < references.length; i += CHUNK_SIZE) {
            const chunk = references.slice(i, i + CHUNK_SIZE);
            const cleanedChunk = chunk.filter(ref => ref && ref.trim() !== '');
            if (cleanedChunk.length === 0) continue;
            
            const q = query(collection(firestore, 'sampleDeliveries'), where('reference', 'in', cleanedChunk));
            const querySnapshot = await getDocs(q);
            
            querySnapshot.forEach(doc => {
                allDeliveries.push({
                    id: doc.id,
                    ...convertTimestampsToDates(doc.data())
                } as SampleDelivery);
            });
        }
        
        return { success: true, data: allDeliveries };

    } catch (e: any) {
        if (e.code === 'failed-precondition') {
             return { success: false, error: 'Firestore requiere un índice para esta consulta. Por favor, revisa la consola de Firebase para crearlo.' };
        }
         if (e.code === 'invalid-argument') {
            return { success: false, error: 'Argumento de consulta inválido. Verifica que no haya valores vacíos o formatos incorrectos en tu archivo de Excel.' };
        }
        return { success: false, error: `Error de base de datos: ${e.message}` };
    }
}

// --- Dedicated Functions for Sample Control ---
export async function saveSampleVerification(sessionData: Omit<SavedSampleVerification, 'id'>): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const docRef = await addDoc(collection(firestore, "sampleVerifications"), convertDatesToTimestamps(sessionData));
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error("Error saving sample verification:", error);
    return { success: false, error: error.message };
  }
}

export async function loadSampleVerifications(): Promise<{ success: boolean; data?: SavedSampleVerification[]; error?: string }> {
    try {
        const q = query(collection(firestore, "sampleVerifications"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const sessions = querySnapshot.docs.map(doc => {
            return convertTimestampsToDates({ id: doc.id, ...doc.data() }) as SavedSampleVerification;
        });
        return { success: true, data: sessions };
    } catch (error: any) {
        console.error("Error loading sample verifications:", error);
        return { success: false, error: `Failed to load sample verifications: ${error.message}` };
    }
}


// --- Transfers Module Actions ---
export async function saveTransfers(transfers: Omit<TransferEntry, 'id' | 'status'>[]): Promise<{ success: boolean; error?: string; summary?: { added: number, removed: number } }> {
    const transfersCollection = collection(firestore, 'transfers');
    const protectedStatuses: TransferStatus[] = ['Recibido en Bodega', 'Enviado a Destino', 'Recolectado en Ruta', 'Entregado en Ruta', 'Validado Supervisor'];
    
    try {
        const batch = writeBatch(firestore);

        const existingSnapshot = await getDocs(query(transfersCollection));
        const preservedTFs = new Map<string, TransferEntry>();
        let removed = 0;

        existingSnapshot.forEach(doc => {
            const data = doc.data() as TransferEntry;
            if (data.status && protectedStatuses.includes(data.status)) {
                preservedTFs.set(data.numeroTF, data);
            } else {
                batch.delete(doc.ref);
                removed++;
            }
        });

        let added = 0;
        for (const newTransfer of transfers) {
            if (!preservedTFs.has(newTransfer.numeroTF)) {
                const docRef = doc(transfersCollection); // Auto-generate ID
                batch.set(docRef, { ...convertDatesToTimestamps(newTransfer), status: 'En Tránsito' });
                added++;
            }
        }
        
        await batch.commit();
        return { success: true, summary: { added, removed } };

    } catch (error: any) {
        console.error("Error guardando transferencias:", error);
        return { success: false, error: `No se pudieron guardar las transferencias: ${error.message}` };
    }
}


export async function loadAllTransfers(): Promise<{ data?: TransferEntry[]; error?: string }> {
    try {
        const q = query(collection(firestore, "transfers"), orderBy("fecha", "desc"));        
        const querySnapshot = await getDocs(q);
        const transfers = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as TransferEntry[];
        return { data: transfers };
    } catch (error: any) {
        console.error("Error loading all transfers:", error);
        return { error: `Failed to load all transfers: ${error.message}` };
    }
}

export async function deleteTransfer(transferId: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!transferId) {
            return { success: false, error: 'ID de transferencia no proporcionado.' };
        }
        await deleteDoc(doc(firestore, 'transfers', transferId));
        return { success: true };
    } catch (error: any) {
        console.error("Error eliminando transferencia:", error);
        return { success: false, error: `No se pudo eliminar la transferencia: ${error.message}` };
    }
}

export async function updateTransferStatus(transferId: string, status: TransferStatus, justification?: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!transferId) {
            return { success: false, error: 'ID de transferencia no proporcionado.' };
        }
        const transferRef = doc(firestore, "transfers", transferId);
        
        const updates: any = { status };

        if (justification) {
            updates.manualStatusChangeJustification = justification;
        }
    
        if (status === 'Recibido en Bodega') {
            updates.recibidoAt = Timestamp.now();
        } else if (status === 'Enviado a Destino') {
            updates.enviadoAt = Timestamp.now();
        } else if (status === 'Validado Supervisor') {
            updates.validatedAt = Timestamp.now(); // Add new timestamp
        } else if (status === 'Entregado en Ruta') {
            updates.deliveredAt = Timestamp.now(); // Add new timestamp
        } else if (status === 'Recolectado en Ruta') {
            updates.recibidoAt = Timestamp.now(); // Save the collection time
        }

        await updateDoc(transferRef, updates);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `No se pudo actualizar el estado de la transferencia: ${error.message}` };
    }
}

export async function batchUpdateTransferStatus(transferIds: string[], status: TransferStatus): Promise<{ success: boolean; error?: string }> {
    if (!transferIds || transferIds.length === 0) {
        return { success: true }; // Nothing to do
    }
    const batch = writeBatch(firestore);
    try {
        transferIds.forEach(id => {
            const transferRef = doc(firestore, 'transfers', id);
            const updates: any = { status };
            if (status === 'Recibido en Bodega') {
                updates.recibidoAt = Timestamp.now();
            }
            batch.update(transferRef, updates);
        });
        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error('Error in batch update transfer status:', error);
        return { success: false, error: error.message };
    }
}
    
export async function createDeliveryManifest(manifestData: Omit<DeliveryManifest, 'id' | 'createdAt' | 'manifestId'>): Promise<{ success: boolean; error?: string; id?: string }> {
    const counterRef = doc(firestore, 'counters', 'manifestCounter');
    const manifestsCollection = collection(firestore, 'deliveryManifests');
    
    try {
        const manifestDocRef = doc(manifestsCollection); // Generate a new ID for the manifest

        await runTransaction(firestore, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            const newCount = (counterDoc.data()?.count || 0) + 1;
            
            const manifestToSave: DeliveryManifest = {
                id: manifestDocRef.id,
                manifestId: newCount,
                createdAt: new Date(),
                ...manifestData
            };
            
            transaction.set(manifestDocRef, convertDatesToTimestamps(manifestToSave));
            transaction.set(counterRef, { count: newCount }, { merge: true }); // Use set with merge instead of update

            // Update status of all included transfers
            const now = new Date();
            for (const transferId of manifestData.transferIds) {
                const transferRef = doc(firestore, 'transfers', transferId);
                transaction.update(transferRef, {
                    status: 'Enviado a Destino',
                    enviadoAt: now
                });
            }
        });

        return { success: true, id: manifestDocRef.id };

    } catch (e: any) {
        console.error("Error creating delivery manifest:", e);
        return { success: false, error: e.message };
    }
}

export async function getDeliveryManifests(): Promise<{ success: boolean; data?: DeliveryManifest[]; error?: string }> {
    try {
        const q = query(collection(firestore, "deliveryManifests"), orderBy("manifestId", "desc"));
        const querySnapshot = await getDocs(q);
        const manifests = querySnapshot.docs.map(doc => convertTimestampsToDates({ id: doc.id, ...doc.data() }) as DeliveryManifest);
        return { success: true, data: manifests };
    } catch (error: any) {
        console.error("Error loading delivery manifests:", error);
        return { success: false, error: `Failed to load manifests: ${error.message}` };
    }
}

export async function getTransfersByIds(transferIds: string[]): Promise<{ success: boolean; data?: TransferEntry[]; error?: string }> {
    if (transferIds.length === 0) {
        return { success: true, data: [] };
    }
    try {
        const transfers: TransferEntry[] = [];
        const CHUNK_SIZE = 30; // Firestore 'in' query limit is 30

        for (let i = 0; i < transferIds.length; i += CHUNK_SIZE) {
            const chunk = transferIds.slice(i, i + CHUNK_SIZE);
            if (chunk.length > 0) {
                const q = query(collection(firestore, "transfers"), where(documentId(), "in", chunk));
                const querySnapshot = await getDocs(q);
                querySnapshot.forEach(doc => {
                    transfers.push(convertTimestampsToDates({ id: doc.id, ...doc.data() }) as TransferEntry);
                });
            }
        }
        
        return { success: true, data: transfers };
    } catch (error: any) {
        console.error("Error loading transfers by IDs:", error);
        return { success: false, error: `Failed to load transfers: ${error.message}` };
    }
}


export async function saveMunicipios(fileContent: ArrayBuffer): Promise<{ success: boolean, error?: string, summary?: { processed: number } }> {
    try {
        const workbook = XLSX.read(fileContent, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            return { success: false, error: "No se encontró ninguna hoja en el archivo Excel." };
        }
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) {
            return { success: false, error: "El archivo está vacío." };
        }
        
        const firstRow = jsonData[0];
        const codigoKey = findCaseInsensitiveKey(firstRow, 'codigo');
        const municipioKey = findCaseInsensitiveKey(firstRow, 'municipio');
        const departamentoKey = findCaseInsensitiveKey(firstRow, 'departamento');

        if (!codigoKey || !municipioKey || !departamentoKey) {
            return { success: false, error: `Faltan las columnas requeridas: 'codigo', 'municipio', 'departamento'.` };
        }

        const municipiosCollection = collection(firestore, 'municipios');
        
        const batches = [];
        for (let i = 0; i < jsonData.length; i += 499) {
            const batch = writeBatch(firestore);
            const chunk = jsonData.slice(i, i + 499);
            for (const row of chunk) {
                const codigo = String(row[codigoKey]).trim();
                const municipio = String(row[municipioKey]).trim();
                const departamento = String(row[departamentoKey]).trim();

                if (!codigo) continue; // Skip rows without a code

                const docRef = doc(municipiosCollection, codigo);
                batch.set(docRef, {
                    nombre: municipio,
                    departamento: departamento,
                }, { merge: true }); // This will create or update
            }
            batches.push(batch.commit());
        }
        
        await Promise.all(batches);

        return { success: true, summary: { processed: jsonData.length } };

    } catch (error: any) {
        console.error("Error guardando municipios:", error);
        return { success: false, error: `No se pudieron guardar los municipios: ${error.message}` };
    }
}
  
export async function createManualTransfer(data: { numeroTF: string; bodegaDestino: string; origen?: string; status?: TransferStatus }): Promise<{ success: boolean; error?: string }> {
    const transfersCollection = collection(firestore, 'transfers');
    try {
        const newTransfer: Omit<TransferEntry, 'id'> = {
            fecha: new Date(),
            numeroTF: data.numeroTF.toUpperCase().trim(),
            bodegaOrigen: data.origen || 'BODEGA PPA', // Default to BODEGA PPA if not provided
            bodegaDestino: data.bodegaDestino,
            cantidad: 1, // Default value
            status: data.status || 'En Tránsito', // Default to En Tránsito if not provided
        };

        await addDoc(transfersCollection, convertDatesToTimestamps(newTransfer));

        return { success: true };
    } catch (error: any) {
        console.error("Error creando transferencia manual:", error);
        return { success: false, error: `No se pudo crear la transferencia: ${error.message}` };
    }
}

export async function migrateAdidasVerifications(): Promise<{ success: boolean; error?: string; updatedCount: number; }> {
    try {
        const verificationsRef = collection(firestore, "sampleVerifications");
        const snapshot = await getDocs(verificationsRef);
        const batch = writeBatch(firestore);
        let updatedCount = 0;

        snapshot.forEach(docSnap => {
            const verificationData = docSnap.data();
            const verification = { id: docSnap.id, ...convertTimestampsToDates(verificationData) } as SavedSampleVerification;
            
            if (!verification.name || !Array.isArray(verification.results) || !verification.createdAt || isNaN(new Date(verification.createdAt).getTime())) {
                return; // Skip malformed documents
            }

            const verificationName = verification.name.toUpperCase();
            const isAdidasVerification = verificationName.startsWith('AD') || verificationName.includes('ADIDAS');

            if (isAdidasVerification) {
                let wasModified = false;
                const verificationDate = new Date(verification.createdAt);

                const newResults = verification.results.map(res => {
                    let updatedRes = { ...res };

                    if (res.status === 'Muestra Nueva Requerida') {
                        wasModified = true;
                        const virtualDelivery: SampleDelivery = {
                            id: `manual-${res.reference}-${verificationDate.getTime()}`,
                            reference: res.reference,
                            transferNumber: verification.name,
                            deliveryDate: verificationDate,
                            sourceWarehouse: 'VERIFICACIÓN MANUAL',
                            destinationWarehouse: 'FOTOGRAFIA',
                        };
                        updatedRes = {
                            ...res,
                            status: 'Advertencia: Entregada pero sin Foto' as const,
                            deliveryHistory: [virtualDelivery],
                        };
                    } 
                    else if (res.status === 'Advertencia: Entregada pero sin Foto') {
                        const existingHistory = res.deliveryHistory || [];
                        const manualVerificationExists = existingHistory.some(d => d.transferNumber === verification.name);
                        
                        if (!manualVerificationExists) {
                            wasModified = true;
                             const virtualDelivery: SampleDelivery = {
                                id: `manual-${res.reference}-${verificationDate.getTime()}`,
                                reference: res.reference,
                                transferNumber: verification.name,
                                deliveryDate: verificationDate,
                                sourceWarehouse: 'VERIFICACIÓN MANUAL',
                                destinationWarehouse: 'FOTOGRAFIA',
                            };
                             updatedRes = {
                                ...res,
                                deliveryHistory: [...existingHistory, virtualDelivery],
                            };
                        }
                    }
                    return updatedRes;
                });

                if (wasModified) {
                    const docRef = doc(firestore, "sampleVerifications", verification.id);
                    batch.update(docRef, { results: convertDatesToTimestamps(newResults) });
                    updatedCount++;
                }
            }
        });

        if (updatedCount > 0) {
            await batch.commit();
        }

        return { success: true, updatedCount };

    } catch (error: any) {
        console.error("Error migrating Adidas verifications:", error);
        return { success: false, error: `No se pudo completar la migración: ${error.message}`, updatedCount: 0 };
    }
}
  
export async function batchUpdateEcommerceOrderDispatchDates(updates: { orderId: string, dispatchDate: Date }[]): Promise<{ success: boolean; error?: string; updatedCount: number }> {
    if (!updates || updates.length === 0) {
        return { success: true, updatedCount: 0 };
    }
    const batch = writeBatch(firestore);
    let updatedCount = 0;
    try {
        updates.forEach(({ orderId, dispatchDate }) => {
            const orderRef = doc(firestore, 'ecommerceOrders', orderId);
            batch.update(orderRef, {
                dispatchDate: Timestamp.fromDate(dispatchDate)
            });
            updatedCount++;
        });
        await batch.commit();
        return { success: true, updatedCount };
    } catch (error: any) {
        console.error('Batch dispatch date update error:', error);
        return { success: false, error: error.message, updatedCount: 0 };
    }
}

export async function updateEcommerceOrderDispatchDate(orderId: string, dispatchDate: Date): Promise<{ success: boolean; error?: string }> {
    try {
        const orderRef = doc(firestore, 'ecommerceOrders', orderId);
        await updateDoc(orderRef, {
            dispatchDate: Timestamp.fromDate(dispatchDate)
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to update dispatch date: ${error.message}` };
    }
}

export async function createCollectionLog(placa: string, transferIds: string[], userId: string): Promise<{ success: boolean; error?: string; }> {
    const collectionLogRef = collection(firestore, 'collectionLogs');
    const transfersCollection = collection(firestore, 'transfers');

    try {
        const batch = writeBatch(firestore);

        const newLogRef = doc(collectionLogRef);
        const transfersToLog = await getTransfersByIds(transferIds);

        if (!transfersToLog.data) {
            throw new Error("No se pudieron encontrar las transferencias seleccionadas.");
        }

        const destinations = transfersToLog.data.reduce((acc, t) => {
            acc[t.bodegaDestino] = (acc[t.bodegaDestino] || 0) + (t.cantidad || 1);
            return acc;
        }, {} as Record<string, number>);

        const newLogData = {
            createdAt: Timestamp.now(),
            placa,
            transferIds,
            recolectadoPor: userId,
            summary: {
                totalTransfers: transferIds.length,
                destinations
            }
        };
        batch.set(newLogRef, newLogData);

        transferIds.forEach(id => {
            const transferRef = doc(transfersCollection, id);
            batch.update(transferRef, { 
                status: 'Recolectado en Ruta',
                recibidoAt: Timestamp.now(), // Save the collection time
            });
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error creating collection log:", error);
        return { success: false, error: `No se pudo registrar la recolección: ${error.message}` };
    }
}

export async function getCollectionLogs(): Promise<{ success: boolean; data?: CollectionLog[]; error?: string }> {
    try {
        const q = query(collection(firestore, "collectionLogs"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const logs = querySnapshot.docs.map(doc => convertTimestampsToDates({ id: doc.id, ...doc.data() }) as CollectionLog);
        return { success: true, data: logs };
    } catch (error: any) {
        console.error("Error loading collection logs:", error);
        return { success: false, error: `Failed to load collection logs: ${error.message}` };
    }
}
    
export async function migrateLegacyTransferStatus(): Promise<{ success: boolean; error?: string; updatedCount: number }> {
    const transfersCollection = collection(firestore, 'transfers');
    const q = query(transfersCollection, where("status", "==", "Recibido"));
    
    try {
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            return { success: true, updatedCount: 0 };
        }

        const batch = writeBatch(firestore);
        querySnapshot.forEach(docSnap => {
            const docRef = doc(firestore, 'transfers', docSnap.id);
            batch.update(docRef, { status: 'Recibido en Bodega' });
        });

        await batch.commit();
        
        return { success: true, updatedCount: querySnapshot.size };

    } catch (error: any) {
        console.error("Error migrando estados de transferencia:", error);
        return { success: false, error: `No se pudo completar la migración: ${error.message}`, updatedCount: 0 };
    }
}


// For Dispatch Manager and other modules that need general verification sessions
export async function saveVerificationSession(sessionData: Omit<SavedVerification, 'id'>): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const docRef = await addDoc(collection(firestore, "verificationSessions"), convertDatesToTimestamps(sessionData));
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error("Error saving verification session:", error);
    return { success: false, error: error.message };
  }
}

export async function loadVerificationSessions(): Promise<{ success: boolean; data?: SavedVerification[]; error?: string }> {
    try {
        const q = query(collection(firestore, "verificationSessions"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const sessions = querySnapshot.docs.map(doc => {
            return convertTimestampsToDates({ id: doc.id, ...doc.data() }) as SavedVerification;
        });
        return { success: true, data: sessions };
    } catch (error: any) {
        console.error("Error loading verification sessions:", error);
        return { success: false, error: `Failed to load sessions: ${error.message}` };
    }
}

export async function updateVerificationSession(sessionId: string, sessionData: Partial<Omit<SavedVerification, 'id'>>): Promise<{ success: boolean, error?: string }> {
  try {
    const sessionRef = doc(firestore, "verificationSessions", sessionId);
    await updateDoc(sessionRef, convertDatesToTimestamps(sessionData));
    return { success: true };
  } catch (error: any) {
    console.error("Error updating verification session:", error);
    return { success: false, error: error.message };
  }
}



export async function saveHolidays(holidays: Date[]): Promise<{success: boolean; error?: string}> {
    try {
        const docRef = doc(firestore, 'settings', 'holidays');
        const timestamps = holidays.map(d => Timestamp.fromDate(d));
        await setDoc(docRef, { dates: timestamps });
        return { success: true };
    } catch (e: any) {
         return { success: false, error: e.message };
    }
}

export async function loadHolidays(): Promise<{success: boolean; data?: Date[]; error?: string}> {
    try {
        const docRef = doc(firestore, 'settings', 'holidays');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data();
            const dates = (data.dates || []).map((t: Timestamp) => t.toDate());
            return { success: true, data: dates };
        }
        return { success: true, data: [] };
    } catch (e: any) {
         return { success: false, error: e.message };
    }
}
