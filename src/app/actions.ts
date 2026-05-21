

"use server";

// AI features are disabled for Spark plan compatibility.
// To re-enable, you must upgrade to the Blaze plan, restore the Genkit packages
// in package.json, and uncomment the related code in this file and in src/ai/genkit.ts.

import { TransferNovelty, TransferNoveltyStatus, TransferNoveltyType, ExternalServiceRow, ServiceRate, ProductivitySettings, ProcessedReportData, PackerProductivity, PackerReferenceProductivityDetail, IncidentLogEntry, DeadTimeEntry, WholesaleOrder, WholesaleOrderDetail, ProductDatabaseItem, PackingScanResult, OrderStatus, PackingSession, PreprintedLabel, LabelValidationResult, GeneralLabel, GeneralLabelOwnerType, ItemNovelty, ReceptionProduct, ReceptionOperation, ScannedItem, OperationPause, ReceptionExpectedItem, Location, PackingUnit, AppUser, ActivityLog, UserGoal, ReportSummary, ReportConfiguration, RemisionEntry, AlternateBarcodeUploadRow, CsvRow, PackedItem, DiscardedRecord, DispatchSessionInfo, VtexRate, RouteEntry, EcommerceOrder, SampleReference, SampleDelivery, SamplePhotoReception, SamplePhotoReceptionStatus, SamplePhotoReceptionEvent, ComparisonResult, SavedSampleVerification, TransferEntry, TransferActor, TransferStatusHistoryEntry, DeliveryManifest, DelayedOrderLog, Justification, SavedVerification, CollectionLog, TransferStatus, RouteStatus, OperationPulse, SmartAlert, PulseReason, ManualJustifications, ManualOperatorMappings, BagOperation, BagItem } from "@/types";
import { firestore } from "@/services/firebase";
import { collection, addDoc, getDocs, Timestamp, doc, setDoc, getDoc, writeBatch, documentId, where, query, QueryDocumentSnapshot, DocumentData, updateDoc, collectionGroup, runTransaction, orderBy, limit, deleteDoc, getCountFromServer, startAt, startAfter, increment, DocumentReference, arrayUnion, arrayRemove, deleteField } from 'firebase/firestore';
import { parseISO } from 'date-fns';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { CURRENT_APP_VERSION } from './version';
import { normalizeHeader, parseFlexibleDate, excelSerialDateToJSDate, findCaseInsensitiveKey, extractLocalDateString } from '@/lib/parsingUtils';
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

// Helper to ensure label IDs (barcodes) are always formatted the same way for Firestore IDs
const normalizeLabelId = (id: string): string => {
    if (!id) return id;
    return id
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '') // Remove all whitespace
        .replace(/'/g, '-') // Replace single quotes with hyphens
        .replace(/_/g, '-'); // Standardize underscores to hyphens
};


// Activity Log (debe ser export async function, no export const: si no, el stub en cliente falla)
export async function createActivityLog(
    logEntry: Omit<ActivityLog, 'id' | 'created_at'>
): Promise<void> {
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
        const reportDateObj = new Date(reportData.reportDate + 'T12:00:00');
        
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

export async function loadJustificationsByDate(dateStr: string): Promise<{ data?: ManualJustifications; error?: string }> {
    try {
        // 1) Documento dedicado: fuente de verdad. Si existe, NO mezclar con snapshots (estos conservan
        //    manualJustifications históricas y harían "resucitar" claves ya borradas en reports_justifications).
        try {
            const dedicatedSnap = await getDoc(doc(firestore, 'reports_justifications', dateStr));
            if (dedicatedSnap.exists()) {
                const d = dedicatedSnap.data() as { justifications?: ManualJustifications };
                if (d.justifications !== undefined && typeof d.justifications === 'object') {
                    const j = { ...d.justifications };
                    console.log(`[Firestore] Dedicated justifications for ${dateStr}:`, Object.keys(j).length, 'items');
                    return { data: j };
                }
            }
        } catch (e) {
            console.warn('Could not load dedicated justifications:', e);
        }

        // 2) Retrocompat: solo snapshots del día (sin doc dedicado aún)
        const start = new Date(dateStr + 'T00:00:00');
        start.setHours(start.getHours() - 12);
        const end = new Date(dateStr + 'T23:59:59');
        end.setHours(end.getHours() + 12);

        const snapshotsRef = collection(firestore, 'reports_summary');

        let querySnapshot = await getDocs(
            query(
                snapshotsRef,
                where('reportDate', '>=', Timestamp.fromDate(start)),
                where('reportDate', '<=', Timestamp.fromDate(end))
            )
        );

        if (querySnapshot.empty) {
            querySnapshot = await getDocs(query(snapshotsRef, where('reportDate', '==', dateStr)));
        }

        if (querySnapshot.empty) {
            return { data: {} };
        }

        const docs = querySnapshot.docs.map((docSnap) => ({
            ...docSnap.data(),
            id: docSnap.id,
            snapshotCreatedAt: docSnap.data().snapshotCreatedAt?.toDate?.() || new Date(docSnap.data().snapshotCreatedAt),
        })) as any[];

        docs.sort((a, b) => a.snapshotCreatedAt.getTime() - b.snapshotCreatedAt.getTime());

        const mergedJustifications: ManualJustifications = {};
        docs.forEach((docRow) => {
            if (docRow.manualJustifications) {
                Object.assign(mergedJustifications, docRow.manualJustifications);
            }
        });

        return { data: mergedJustifications };
    } catch (error: any) {
        console.error('Error loading justifications by date:', error);
        return { data: {}, error: error.message };
    }
}

export async function saveJustificationsForDay(dateStr: string, justifications: ManualJustifications): Promise<{ success: boolean; error?: string }> {
    try {
        if (!dateStr) throw new Error("dateStr is required");
        
        console.log(`[Firestore] Saving ${Object.keys(justifications).length} justifications for ${dateStr}`);
        
        const docRef = doc(firestore, "reports_justifications", dateStr);
        await setDoc(docRef, {
            justifications,
            updatedAt: Timestamp.now(),
            reportDate: dateStr
        });
        
        return { success: true };
    } catch (error: any) {
        console.error("Error saving justifications for day:", error);
        return { success: false, error: error.message };
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

/** Pulsos globales del día (consulta acotada; antes se leían todos los pulsos de todos los usuarios del día). */
export async function getGlobalPulsesForDay(dateStr: string): Promise<{ data?: OperationPulse[]; error?: string }> {
    try {
        const start = Timestamp.fromDate(new Date(dateStr + 'T00:00:00'));
        const end = Timestamp.fromDate(new Date(dateStr + 'T23:59:59'));
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('isGlobal', '==', true),
            where('startTime', '>=', start),
            where('startTime', '<=', end)
        );
        const querySnapshot = await getDocs(q);
        const pulses = querySnapshot.docs.map(
            (d) => ({ id: d.id, ...convertTimestampsToDates(d.data()) } as OperationPulse)
        );
        return { data: pulses };
    } catch (error: any) {
        return { error: `Error loading global pulses: ${error.message}` };
    }
}

/** Solo pulsos de un usuario en el rango del día (sin globales). */
export async function getUserPulsesForUserDay(
    userId: string,
    dateStr: string,
    moduleContext?: 'reception' | 'wholesale' | 'general'
): Promise<{ data?: OperationPulse[]; error?: string }> {
    try {
        const start = Timestamp.fromDate(new Date(dateStr + 'T00:00:00'));
        const end = Timestamp.fromDate(new Date(dateStr + 'T23:59:59'));
        const q = query(
            collection(firestore, 'operation_pulses'),
            where('userId', '==', userId),
            where('startTime', '>=', start),
            where('startTime', '<=', end)
        );
        const querySnapshot = await getDocs(q);
        const pulses = querySnapshot.docs
            .map((docSnap) => ({ id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as OperationPulse))
            .filter((p) => {
                if (!moduleContext) return true;
                return p.moduleContext === moduleContext;
            });
        return { data: pulses };
    } catch (error: any) {
        return { error: `Error loading user pulses: ${error.message}` };
    }
}

export async function getUserPulsesForDay(
    userId: string,
    dateStr: string,
    moduleContext?: 'reception' | 'wholesale' | 'general',
    options?: { globalPulses?: OperationPulse[] }
): Promise<{ data?: OperationPulse[]; error?: string }> {
    try {
        const globalRes: { data?: OperationPulse[]; error?: string } =
            options?.globalPulses != null
                ? { data: options.globalPulses }
                : await getGlobalPulsesForDay(dateStr);
        const userRes = await getUserPulsesForUserDay(userId, dateStr, moduleContext);

        if (globalRes.error) return { error: globalRes.error };
        if (userRes.error) return { error: userRes.error };

        const globals = (globalRes.data || []).filter((p) => p.isGlobal);
        const users = userRes.data || [];

        const seen = new Set<string>();
        const merged: OperationPulse[] = [];
        for (const p of [...globals, ...users]) {
            const key = p.id ?? `noid-${p.userId}-${String(p.startTime)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(p);
        }

        const pulses = merged.filter((p) => {
            if (!(p.isGlobal || p.userId === userId)) return false;
            if (!moduleContext) return true;
            if (p.isGlobal) return true;
            return p.moduleContext === moduleContext;
        });

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

export async function deleteHistoricalReportsForDay(dateStr: string, explicitIds?: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        let summaryIds: string[] = [];
        if (explicitIds && explicitIds.length > 0) {
            summaryIds = explicitIds;
        } else {
            let summarySnap = await getDocs(query(
                collection(firestore, "reports_summary"),
                where("reportDate", "==", dateStr)
            ));
            if (summarySnap.empty) {
                const allRecent = await getDocs(query(collection(firestore, "reports_summary"), limit(300)));
                summaryIds = allRecent.docs
                    .filter(doc => extractLocalDateString(doc.data().reportDate) === dateStr || doc.id.startsWith(dateStr))
                    .map(m => m.id);
            } else {
                summaryIds = summarySnap.docs.map(doc => doc.id);
            }
        }

        if (summaryIds.length === 0) {
            console.log(`[DeleteHistory] No reports found to delete for ${dateStr}`);
            return { success: true };
        }

        const CHUNK_SIZE = 200;
        for (let i = 0; i < summaryIds.length; i += CHUNK_SIZE) {
            const batch = writeBatch(firestore);
            const chunk = summaryIds.slice(i, i + CHUNK_SIZE);
            
            chunk.forEach(id => {
                batch.delete(doc(firestore, "reports_summary", id));
                batch.delete(doc(firestore, "reports", id));
            });
            
            await batch.commit();
        }
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


export async function loadWholesaleOrderById(orderId: string): Promise<{ data?: WholesaleOrder; error?: string }> {
    try {
        const docSnap = await getDoc(doc(firestore, "wholesaleOrders", orderId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            const order = {
                id: docSnap.id.trim(),
                vendedor: data.vendedor,
                fecha: (data.fecha as Timestamp).toDate().toISOString(),
                bodega: data.bodega,
                cliente: data.cliente,
                sucursal: data.sucursal,
                ordenDeCompra: data.ordenDeCompra,
                cantidadTotal: data.cantidadTotal,
                valorNetoTotal: data.valorNetoTotal,
                status: data.status || 'Pte Empaque',
                details: data.details,
            } as WholesaleOrder;
            return { data: order };
        }
        return { error: "Order not found" };
    } catch (error: any) {
        console.error("Error loading wholesale order:", error);
        return { error: error.message };
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
            const sequentialId = (j + 1).toString();
            const labelId = `VXM-${numericOrderId}-${sequentialId}`;
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
        
        // 1. Get existing labels to find the next number
        const existingLabelsRes = await getLabelsForOrder(orderId);
        let nextNumber = 1;
        
        if (existingLabelsRes.data && existingLabelsRes.data.length > 0) {
            const numericSuffixes = existingLabelsRes.data
                .map(l => {
                    const parts = l.id.split('-');
                    const suffix = parts[parts.length - 1];
                    return parseInt(suffix, 10);
                })
                .filter(n => !isNaN(n));
            
            if (numericSuffixes.length > 0) {
                nextNumber = Math.max(...numericSuffixes) + 1;
            } else {
                // If existing labels have alphanumeric suffixes, just count them
                nextNumber = existingLabelsRes.data.length + 1;
            }
        }

        const labelId = `VXM-${numericOrderId}-${nextNumber}`;

        const newLabel: PreprintedLabel = {
            id: labelId,
            orderId: orderId,
            status: 'available',
            createdAt: new Date(),
        };

        const docRef = doc(collection(firestore, "preprintedLabels"), normalizeLabelId(labelId));
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
    const normalizedLabelId = normalizeLabelId(labelId);
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
        const normalizedLabelId = normalizeLabelId(labelId);
        const labelRef = doc(firestore, "preprintedLabels", normalizedLabelId);
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

        // Update order status if it's currently 'Pte Empaque'
        try {
            const orderRef = doc(firestore, "wholesaleOrders", itemData.orderId);
            const orderSnap = await getDoc(orderRef);
            if (orderSnap.exists()) {
                const orderData = orderSnap.data();
                if (orderData.status === 'Pte Empaque') {
                    await updateDoc(orderRef, { status: 'En Empaque' });
                }
            }
        } catch (statusError) {
            console.error("Error updating order status during addPackedItem:", statusError);
            // Non-blocking error
        }

        return { success: true, itemId: itemRef.id };
    } catch (error: any) {
        console.error("Error in addPackedItem:", error);
        return { success: false, error: `Failed to add packed item: ${error.message}` };
    }
}

export async function associateOrphanToUnit(orderId: string, oldOrphanId: string, newUnitFirestoreId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const packedItemsRef = collection(firestore, 'packedItems');
        let itemsToUpdate: QueryDocumentSnapshot<DocumentData, DocumentData>[] = [];

        if (oldOrphanId === 'unassociated') {
            // Find items with NO packingUnitId (null, empty string, or field missing)
            // Since Firestore query for 'missing field' is hard, we fetch all for order and filter
            const q = query(packedItemsRef, where('orderId', '==', orderId.trim()));
            const querySnapshot = await getDocs(q);
            itemsToUpdate = querySnapshot.docs.filter(doc => {
                const data = doc.data();
                return !data.packingUnitId || data.packingUnitId === '';
            });
        } else {
            const q = query(packedItemsRef, where('orderId', '==', orderId.trim()), where('packingUnitId', '==', oldOrphanId));
            const querySnapshot = await getDocs(q);
            itemsToUpdate = querySnapshot.docs as any;
        }

        if (itemsToUpdate.length === 0) return { success: true };

        const CHUNK_SIZE = 450;
        for (let i = 0; i < itemsToUpdate.length; i += CHUNK_SIZE) {
            const batch = writeBatch(firestore);
            const chunk = itemsToUpdate.slice(i, i + CHUNK_SIZE);
            chunk.forEach(d => {
                batch.update(d.ref, { packingUnitId: newUnitFirestoreId });
            });
            await batch.commit();
        }

        return { success: true };
    } catch (error: any) {
        console.error("Error in associateOrphanToUnit:", error);
        return { success: false, error: `Failed to reassociate items: ${error.message}` };
    }
}

export async function secureCloseUnitAction(orderId: string, unitId: number, labelId: string, packerName: string): Promise<{ success: boolean; error?: string }> {
    try {
        await runTransaction(firestore, async (transaction) => {
            const normalizedLabelId = normalizeLabelId(labelId);
            const labelRef = doc(firestore, "preprintedLabels", normalizedLabelId);
            const sessionRef = doc(firestore, 'packingSessions', orderId);

            const [labelSnap, sessionSnap] = await Promise.all([
                transaction.get(labelRef),
                transaction.get(sessionRef)
            ]);

            if (!labelSnap.exists()) throw new Error(`La etiqueta ${labelId} (${normalizedLabelId}) no existe en la base de datos.`);
            if (!sessionSnap.exists()) throw new Error("La sesión de empaque ya no existe.");

            const labelData = labelSnap.data() as PreprintedLabel;
            const sessionData = sessionSnap.data() as PackingSession;
            
            // Validation: Label must be available OR already assigned to THIS unit (retry scenario)
            if (labelData.status !== 'available') {
                const isRetryForSameUnit = labelData.unitId === unitId && labelData.orderId === orderId;
                if (!isRetryForSameUnit) {
                    throw new Error(`La etiqueta ${labelId} ya está en uso por otra unidad.`);
                }
            }
            
            if (labelData.orderId !== orderId) throw new Error(`La etiqueta ${labelId} no pertenece al pedido ${orderId}.`);

            const units = [...(sessionData.units || [])];
            const unitIndex = units.findIndex(u => u.id === unitId);
            if (unitIndex === -1) throw new Error("La caja ya no existe en la sesión (posible registro huérfano).");

            // 1. Update Label Status
            transaction.update(labelRef, {
                status: 'used',
                usedAt: Timestamp.now(),
                unitId: unitId,
                usedBy: packerName,
            });

            // 2. Update Unit in Session Array
            units[unitIndex] = {
                ...units[unitIndex],
                status: 'closed',
                labelBarcode: labelId,
                closed_at: new Date().toISOString(),
                closedByName: packerName
            };
            transaction.update(sessionRef, { units });

            // 3. Log Activity
            const logRef = doc(collection(firestore, 'activity_logs'));
            transaction.set(logRef, {
                type: 'unit_closed_secure',
                orderId,
                unitId,
                labelBarcode: labelId,
                packerName,
                created_at: Timestamp.now()
            });
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error in secureCloseUnitAction:", error);
        return { success: false, error: error.message };
    }
}

export async function revertLabelStatus(labelId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const normalizedLabelId = normalizeLabelId(labelId);
        const labelRef = doc(firestore, "preprintedLabels", normalizedLabelId);
        await updateDoc(labelRef, {
            status: 'available',
            usedAt: deleteField(),
            unitId: deleteField(),
            usedBy: deleteField(),
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error reverting label status:", error);
        return { success: false, error: error.message };
    }
}

export async function getPackedItemsForDate(dateStr: string): Promise<{ data?: PackedItem[], error?: string }> {
    try {
        const start = Timestamp.fromDate(new Date(dateStr + 'T00:00:00'));
        const end = Timestamp.fromDate(new Date(dateStr + 'T23:59:59'));
        
        const q = query(
            collection(firestore, 'packedItems'),
            where('scannedAt', '>=', start),
            where('scannedAt', '<=', end)
        );
        
        const querySnapshot = await getDocs(q);
        const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as PackedItem));
        return { data: items };
    } catch (error: any) {
        console.error("Error loading packed items for date:", error);
        return { error: `Error loading items: ${error.message}` };
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

const PACKED_ITEMS_ORDER_IN_CHUNK = 30;

/** Una lectura por documento empaquetado (igual que N llamadas a getPackedItemsForOrder), pero muchas menos consultas/rondas. */
export async function getPackedItemsForOrders(orderIds: string[]): Promise<{ data?: PackedItem[]; error?: string }> {
    try {
        const unique = [...new Set(orderIds.map((id) => String(id || '').trim()).filter(Boolean))];
        if (unique.length === 0) {
            return { data: [] };
        }
        const all: PackedItem[] = [];
        for (let i = 0; i < unique.length; i += PACKED_ITEMS_ORDER_IN_CHUNK) {
            const chunk = unique.slice(i, i + PACKED_ITEMS_ORDER_IN_CHUNK);
            const q = query(collection(firestore, 'packedItems'), where('orderId', 'in', chunk));
            const querySnapshot = await getDocs(q);
            querySnapshot.docs.forEach((docSnap) => {
                all.push(convertTimestampsToDates({ id: docSnap.id, ...docSnap.data() }) as PackedItem);
            });
        }
        return { data: all };
    } catch (error: any) {
        console.error('Error getting packed items for orders:', error);
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

export async function bulkDeletePackedItems(itemIds: string[]): Promise<{ success: boolean, error?: string }> {
    if (!itemIds || itemIds.length === 0) return { success: true };
    try {
        const batch = writeBatch(firestore);
        itemIds.forEach(id => {
            batch.delete(doc(firestore, "packedItems", id));
        });
        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error in bulk delete:", error);
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

export async function createShipment(data: { truckPlate: string; driverName: string; sealNumber?: string, allowedOrderIds?: string[] }): Promise<{ success: boolean; error?: string; shipmentId?: string }> {
    try {
        const newShipment = {
            ...data,
            createdAt: Timestamp.now(),
            status: 'open',
            scannedLabels: {},
            orderIds: [],
            allowedOrderIds: data.allowedOrderIds || []
        };
        const docRef = await addDoc(collection(firestore, "dispatchSessions"), newShipment);
        return { success: true, shipmentId: docRef.id };
    } catch (error: any) {
        return { success: false, error: `Failed to create shipment: ${error.message}` };
    }
}

export async function addScannedLabelToShipment(shipmentId: string, labelId: string): Promise<{ success: boolean; error?: string; auditWarning?: boolean; orderId?: string }> {
    try {
        const shipmentRef = doc(firestore, "dispatchSessions", shipmentId);
        const normalizedLabelId = normalizeLabelId(labelId);
        const labelRef = doc(firestore, "preprintedLabels", normalizedLabelId);

        const result = await runTransaction(firestore, async (transaction) => {
            const shipmentDoc = await transaction.get(shipmentRef);
            const labelDoc = await transaction.get(labelRef);

            if (!shipmentDoc.exists()) throw new Error("Shipment not found.");
            if (shipmentDoc.data().status !== 'open') throw new Error("Shipment is already closed.");
            if (!labelDoc.exists()) throw new Error(`Label ${normalizedLabelId} not found.`);
            
            const labelData = labelDoc.data();
            const orderId = labelData.orderId;

            if (labelData.status === 'dispatched') {
                return { isDuplicate: true, orderId };
            }
            if (labelData.status === 'void') throw new Error(`La etiqueta ${normalizedLabelId} está anulada.`);

            const wasAvailable = labelData.status === 'available';

            const allowedOrders = shipmentDoc.data().allowedOrderIds || [];
            if (allowedOrders.length > 0 && !allowedOrders.includes(orderId)) {
                throw new Error(`Este pedido (${orderId}) no está en la lista de permitidos para este despacho.`);
            }

            // Update shipment
            transaction.update(shipmentRef, {
                [`scannedLabels.${normalizedLabelId}`]: Timestamp.now(),
                orderIds: arrayUnion(orderId)
            });
            // Update label
            transaction.update(labelRef, { status: 'dispatched' });

            // Fetch all labels for the order to determine if it's fully dispatched
            const labelsQuery = query(collection(firestore, "preprintedLabels"), where("orderId", "==", orderId));
            const labelsSnapshot = await getDocs(labelsQuery);
            const allLabels = labelsSnapshot.docs.map(doc => doc.data());
            
            // Re-calculate based on current action (the label we just updated is now 'dispatched')
            const totalLabels = allLabels.filter(l => l.status !== 'void').length;
            const dispatchedLabels = allLabels.filter(l => l.status === 'dispatched' || l.id === labelId).length;
            const availableLabels = totalLabels - dispatchedLabels;

            const orderRef = doc(firestore, "wholesaleOrders", orderId);
            if (availableLabels > 0) {
                transaction.update(orderRef, { status: 'En Cargue' });
            } else {
                transaction.update(orderRef, { status: 'Despachado' });
            }
            
            return { wasAvailable, orderId }; // Pass this data to the caller inside the transaction
        });
        
        if (result.isDuplicate) {
            return { success: false, error: `La etiqueta ${normalizedLabelId} ya fue despachada.`, orderId: result.orderId };
        }
        
        // Add auditWarning to the return if it was available
        return { success: true, auditWarning: result.wasAvailable, orderId: result.orderId };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}


export async function removeScannedLabelFromShipment(shipmentId: string, labelId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const normalizedLabelId = normalizeLabelId(labelId);
        const shipmentRef = doc(firestore, "dispatchSessions", shipmentId);
        const labelRef = doc(firestore, "preprintedLabels", normalizedLabelId);

        await runTransaction(firestore, async (transaction) => {
            // 1. READS
            const shipmentDoc = await transaction.get(shipmentRef);
            const labelDoc = await transaction.get(labelRef);
            const labelData = labelDoc.data();
            
            let orderRef = null;
            let orderDoc = null;
            
            if (labelData && labelData.orderId) {
                orderRef = doc(firestore, "wholesaleOrders", labelData.orderId);
                orderDoc = await transaction.get(orderRef);
            }

            // 2. VALIDATIONS
            if (!shipmentDoc.exists()) throw new Error("Shipment not found.");
            if (shipmentDoc.data().status !== 'open') throw new Error("Cannot modify a closed shipment.");

            // 3. EXTERNAL QUERIES (outside transaction state but okay here)
            let packedCount = 0;
            let totalCount = 0;
            let allLabels: PreprintedLabel[] = [];

            if (labelData && labelData.orderId) {
                const orderId = labelData.orderId;
                const labelsQuery = query(collection(firestore, "preprintedLabels"), where("orderId", "==", orderId));
                const labelsSnapshot = await getDocs(labelsQuery);
                allLabels = labelsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PreprintedLabel));

                if (orderDoc && orderDoc.exists()) {
                    const orderData = orderDoc.data();
                    const packedItemsQuery = query(collection(firestore, "packedItems"), where("orderId", "==", orderId));
                    const packedItemsSnap = await getDocs(packedItemsQuery);
                    packedCount = packedItemsSnap.docs.reduce((sum, d) => sum + (d.data().quantity || 1), 0);
                    totalCount = orderData.cantidadTotal || 0;
                }
            }

            // 4. WRITES
            transaction.update(shipmentRef, {
                [`scannedLabels.${labelId}`]: deleteField()
            });

            transaction.update(labelRef, { status: 'used' });

            if (labelData && orderRef && orderDoc && orderDoc.exists()) {
                const usedLabelsCount = allLabels.filter(l => (l.status === 'dispatched' && l.id !== labelId)).length;
                if (usedLabelsCount > 0) {
                    transaction.update(orderRef, { status: 'En Cargue' });
                } else {
                    const newStatus = packedCount >= totalCount ? 'Empacado' : 'En Empaque';
                    transaction.update(orderRef, { status: newStatus });
                }
            }
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

export async function deleteShipment(shipmentId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const shipmentRef = doc(firestore, "dispatchSessions", shipmentId);
        
        await runTransaction(firestore, async (transaction) => {
            const shipmentDoc = await transaction.get(shipmentRef);
            if (!shipmentDoc.exists()) throw new Error("Shipment not found.");
            
            const scannedLabels = shipmentDoc.data().scannedLabels || {};
            const labelIds = Object.keys(scannedLabels);
            
            // Revert all labels to 'used' (assuming they were packed)
            for (const labelId of labelIds) {
                const labelRef = doc(firestore, "preprintedLabels", labelId);
                transaction.update(labelRef, { status: 'used' });
            }
            
            // Delete the shipment document
            transaction.delete(shipmentRef);
        });
        
        return { success: true };
    } catch (error: any) {
        return { success: false, error: `Failed to delete shipment: ${error.message}` };
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

export async function createPackingUnit(orderId: string, userId: string, userName?: string): Promise<{ success: boolean; error?: string; newUnit?: PackingUnit }> {
  let newUnitData: PackingUnit | null = null;
  try {
      await runTransaction(firestore, async (transaction) => {
          const sessionRef = doc(firestore, 'packingSessions', orderId);
          const sessionDoc = await transaction.get(sessionRef);

          let existingUnits: PackingUnit[] = [];
          if (sessionDoc.exists()) {
              const sessionData = sessionDoc.data() as PackingSession;
              existingUnits = sessionData.units || [];
          } else {
              // Create the session document if it doesn't exist
              const newSession: PackingSession = {
                  orderId: orderId,
                  packerId: userId,
                  packerName: userName || 'Sistema',
                  units: [],
                  status: 'active',
                  pauses: [],
                  startTime: new Date()
              };
              transaction.set(sessionRef, newSession);
          }
          
          const newUnitId = existingUnits.length > 0 ? Math.max(...existingUnits.map(u => u.id)) + 1 : 1;
          const generatedId = `unit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          
          const newUnit: PackingUnit = {
              id: newUnitId,
              firestoreId: generatedId,
              status: 'open',
              createdAt: new Date().toISOString(),
              createdBy: userId,
              createdByName: userName || null,
              items: {},
          };

          const updatedUnits = [...existingUnits, newUnit];
          transaction.update(sessionRef, { units: updatedUnits });

          newUnitData = newUnit;
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

export async function repairSessionUnitsAction(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await runTransaction(firestore, async (transaction) => {
            const sessionRef = doc(firestore, 'packingSessions', orderId);
            const sessionSnap = await transaction.get(sessionRef);
            if (!sessionSnap.exists()) return;

            const sessionData = sessionSnap.data() as PackingSession;
            let modified = false;
            const updatedUnits = (sessionData.units || []).map(u => {
                if (!u.firestoreId) {
                    modified = true;
                    return { 
                        ...u, 
                        firestoreId: u.firestoreId || `unit-repaired-${u.id}-${Date.now()}-${Math.random().toString(36).substring(2, 5)}` 
                    };
                }
                return u;
            });

            if (modified) {
                transaction.update(sessionRef, { units: updatedUnits });
            }
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error repairing session units:", error);
        return { success: false, error: error.message };
    }
}

export async function deletePackingUnit(orderId: string, firestoreId: string, labelBarcode?: string): Promise<{ success: boolean; error?: string }> {
    try {
        const batch = writeBatch(firestore);
        
        // 1. Update Session
        const sessionRef = doc(firestore, 'packingSessions', orderId);
        const sessionSnap = await getDoc(sessionRef);
        if (sessionSnap.exists()) {
            const sessionData = sessionSnap.data() as PackingSession;
            const updatedUnits = (sessionData.units || []).filter(u => u.firestoreId !== firestoreId);
            batch.update(sessionRef, { units: updatedUnits });
        }

        // 2. Delete Items
        const q = query(collection(firestore, 'packedItems'), where('packingUnitId', '==', firestoreId));
        const itemsSnap = await getDocs(q);
        itemsSnap.docs.forEach(d => batch.delete(d.ref));

        // 3. Revert Label
        if (labelBarcode) {
            const normalizedLabelBarcode = normalizeLabelId(labelBarcode);
            const labelRef = doc(firestore, 'preprintedLabels', normalizedLabelBarcode);
            batch.update(labelRef, { 
                status: 'available', 
                usedAt: deleteField(), 
                unitId: deleteField(), 
                usedBy: deleteField() 
            });
        }

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error in deletePackingUnit:", error);
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
            const data = docSnap.data();
            const item: ProductDatabaseItem = {
              ...(convertTimestampsToDates(data) as Omit<ProductDatabaseItem, 'id'>),
              id: docSnap.id,
              codigoBarras: docSnap.id,
              // Normalize fields
              referencia: data.referencia || data.reference || '',
              talla: data.talla || data.size || '',
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
                        referencia: expectedItem.reference || (expectedItem as any).referencia || '',
                        talla: expectedItem.size || (expectedItem as any).talla || '',
                        item: expectedItem.item,
                        marca: undefined,
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

export async function loadEcommerceOrders(fullHistory = false): Promise<{ success: boolean; data?: EcommerceOrder[]; error?: string }> {
    try {
        let q = query(collection(firestore, "ecommerceOrders"));
        
        if (!fullHistory) {
            // Optimization: Only load the last 60 days of orders. 
            // This covers active operational needs and recent trends while avoiding thousands of dead historical reads.
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
            q = query(q, where("fechaPedido", ">=", Timestamp.fromDate(sixtyDaysAgo)));
        }

        const querySnapshot = await getDocs(q);
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

export type SamplePhotoDeliveryImportRow = {
    reference: string;
    transferNumber: string;
    deliveryDate: string;
    sourceWarehouse: string;
    destinationWarehouse: string;
};

export type ImportSamplePhotoDeliveriesPayload = {
    deliveries: SamplePhotoDeliveryImportRow[];
    uploadedById?: string;
    uploadedByName?: string;
    invalidRows?: number;
};

export type ImportSamplePhotoDeliveriesResult = {
    success: boolean;
    error?: string;
    added: number;
    updated: number;
    unchanged: number;
    duplicatesInFile: number;
    invalidRows: number;
    totalValidRows: number;
};

function buildSamplePhotoDeliveryDocId(transferNumber: string, reference: string): string {
    const tf = String(transferNumber).trim().toUpperCase();
    const ref = String(reference).trim().toUpperCase();
    return `${tf}__${ref}`.replace(/[/\\]/g, '_').slice(0, 1200);
}

function samplePhotoDeliveryRowEqualsStored(
    stored: Record<string, unknown>,
    row: SamplePhotoDeliveryImportRow
): boolean {
    const storedDate =
        stored.deliveryDate instanceof Date
            ? stored.deliveryDate.toISOString()
            : String(stored.deliveryDate ?? '');
    return (
        String(stored.reference ?? '').trim().toUpperCase() === row.reference.trim().toUpperCase() &&
        String(stored.transferNumber ?? '').trim().toUpperCase() === row.transferNumber.trim().toUpperCase() &&
        storedDate.slice(0, 10) === row.deliveryDate.slice(0, 10) &&
        String(stored.sourceWarehouse ?? '').trim() === row.sourceWarehouse.trim() &&
        String(stored.destinationWarehouse ?? '').trim() === row.destinationWarehouse.trim()
    );
}

export async function importSamplePhotoDeliveries(
    payload: ImportSamplePhotoDeliveriesPayload
): Promise<ImportSamplePhotoDeliveriesResult> {
    const empty: ImportSamplePhotoDeliveriesResult = {
        success: false,
        added: 0,
        updated: 0,
        unchanged: 0,
        duplicatesInFile: 0,
        invalidRows: 0,
        totalValidRows: 0,
    };

    if (!payload?.deliveries?.length) {
        return { ...empty, error: 'No se proporcionaron entregas para guardar.' };
    }
    if (!firestore) {
        return { ...empty, error: 'Firebase no esta disponible.' };
    }

    const seen = new Set<string>();
    const unique: SamplePhotoDeliveryImportRow[] = [];
    let duplicatesInFile = 0;
    for (const row of payload.deliveries) {
        const id = buildSamplePhotoDeliveryDocId(row.transferNumber, row.reference);
        if (seen.has(id)) {
            duplicatesInFile += 1;
            continue;
        }
        seen.add(id);
        unique.push(row);
    }

    const existing = new Map<string, Record<string, unknown>>();
    const ids = unique.map((r) => buildSamplePhotoDeliveryDocId(r.transferNumber, r.reference));
    const FIRESTORE_IN_CHUNK = 30;
    for (let offset = 0; offset < ids.length; offset += FIRESTORE_IN_CHUNK) {
        const chunk = ids.slice(offset, offset + FIRESTORE_IN_CHUNK);
        const snap = await getDocs(
            query(collection(firestore, 'sampleDeliveries'), where(documentId(), 'in', chunk))
        );
        snap.forEach((d) => {
            existing.set(d.id, convertTimestampsToDates(d.data()) as Record<string, unknown>);
        });
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    const now = new Date();
    const uploader = {
        lastUploadedById: payload.uploadedById ?? null,
        lastUploadedByName: payload.uploadedByName ?? null,
    };

    const toWrite: { id: string; row: SamplePhotoDeliveryImportRow; kind: 'add' | 'update' }[] = [];
    for (const row of unique) {
        const id = buildSamplePhotoDeliveryDocId(row.transferNumber, row.reference);
        const prev = existing.get(id);
        if (!prev) {
            toWrite.push({ id, row, kind: 'add' });
        } else if (samplePhotoDeliveryRowEqualsStored(prev, row)) {
            unchanged += 1;
        } else {
            toWrite.push({ id, row, kind: 'update' });
        }
    }

    const WRITE_CHUNK = 450;
    try {
        for (let offset = 0; offset < toWrite.length; offset += WRITE_CHUNK) {
            const chunk = toWrite.slice(offset, offset + WRITE_CHUNK);
            const batch = writeBatch(firestore);
            for (const item of chunk) {
                const deliveryData = {
                    reference: item.row.reference.trim(),
                    transferNumber: item.row.transferNumber.trim(),
                    deliveryDate: new Date(item.row.deliveryDate),
                    sourceWarehouse: item.row.sourceWarehouse,
                    destinationWarehouse: item.row.destinationWarehouse,
                };
                const deliveryRef = doc(firestore, 'sampleDeliveries', item.id);
                const receptionRef = doc(firestore, 'samplePhotoReceptions', item.id);
                batch.set(deliveryRef, convertDatesToTimestamps(deliveryData));
                const receptionBase = {
                    deliveryKey: item.id,
                    reference: deliveryData.reference,
                    transferNumber: deliveryData.transferNumber,
                    status: 'pending',
                    updatedAt: now,
                    lastUploadedAt: now,
                    ...uploader,
                };
                if (item.kind === 'add') {
                    batch.set(receptionRef, convertDatesToTimestamps({ ...receptionBase, createdAt: now }));
                    added += 1;
                } else {
                    batch.set(receptionRef, convertDatesToTimestamps(receptionBase), { merge: true });
                    updated += 1;
                }
            }
            await batch.commit();
        }
        return {
            success: true,
            added,
            updated,
            unchanged,
            duplicatesInFile,
            invalidRows: payload.invalidRows ?? 0,
            totalValidRows: unique.length,
        };
    } catch (error: any) {
        return {
            ...empty,
            error: `No se pudieron guardar las entregas: ${error.message}`,
            duplicatesInFile,
            totalValidRows: unique.length,
        };
    }
}

export type LoadSamplePhotoReceptionsOptions = {
    status?: SamplePhotoReceptionStatus | 'all';
    search?: string;
    maxItems?: number;
};

const SAMPLE_PHOTO_RECEPTION_STATUSES: SamplePhotoReceptionStatus[] = ['pending', 'in_progress', 'received'];

function isValidSamplePhotoReceptionTransition(
    fromStatus: SamplePhotoReceptionStatus,
    toStatus: SamplePhotoReceptionStatus
): boolean {
    if (fromStatus === toStatus) return true;
    if (fromStatus === 'pending' && toStatus === 'in_progress') return true;
    if (fromStatus === 'pending' && toStatus === 'received') return true;
    if (fromStatus === 'in_progress' && toStatus === 'received') return true;
    return false;
}

export async function loadSamplePhotoReceptions(
    options?: LoadSamplePhotoReceptionsOptions
): Promise<{ success: boolean; data?: SamplePhotoReception[]; error?: string }> {
    try {
        const requestedStatus = options?.status ?? 'all';
        const defaultLimit = requestedStatus === 'received' ? 250 : 600;
        const maxItems = Math.min(Math.max(options?.maxItems ?? defaultLimit, 1), 3000);
        if (
            requestedStatus !== 'all' &&
            !SAMPLE_PHOTO_RECEPTION_STATUSES.includes(requestedStatus as SamplePhotoReceptionStatus)
        ) {
            return { success: false, error: 'Filtro de estado invalido para recepciones.' };
        }
        const search = options?.search?.trim().toUpperCase() ?? '';
        const refs: SamplePhotoReception[] = [];

        // Fast path for exact search by stable id (TF__REF)
        if (search.includes('__')) {
            const byId = await getSamplePhotoReceptionById(search);
            if (!byId.success || !byId.data) return { success: true, data: [] };
            if (requestedStatus !== 'all' && byId.data.status !== requestedStatus) return { success: true, data: [] };
            return { success: true, data: [byId.data] };
        }

        // Fast path for exact reference / TF search to avoid loading large datasets.
        if (search.length > 0) {
            const refQuery = await getDocs(
                query(collection(firestore, 'samplePhotoReceptions'), where('reference', '==', search), limit(maxItems))
            );
            const tfQuery = await getDocs(
                query(collection(firestore, 'samplePhotoReceptions'), where('transferNumber', '==', search), limit(maxItems))
            );
            const map = new Map<string, SamplePhotoReception>();
            refQuery.forEach((d) => {
                map.set(d.id, convertTimestampsToDates({ id: d.id, ...d.data() }) as SamplePhotoReception);
            });
            tfQuery.forEach((d) => {
                map.set(d.id, convertTimestampsToDates({ id: d.id, ...d.data() }) as SamplePhotoReception);
            });
            let result = Array.from(map.values());
            if (requestedStatus !== 'all') {
                result = result.filter((item) => item.status === requestedStatus);
            }
            result.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
            return { success: true, data: result.slice(0, maxItems) };
        }

        const coll = collection(firestore, 'samplePhotoReceptions');
        const baseQuery =
            requestedStatus === 'all'
                ? query(coll, orderBy('updatedAt', 'desc'), limit(maxItems))
                : query(coll, where('status', '==', requestedStatus), orderBy('updatedAt', 'desc'), limit(maxItems));

        const snap = await getDocs(baseQuery);
        snap.forEach((d) => {
            refs.push(convertTimestampsToDates({ id: d.id, ...d.data() }) as SamplePhotoReception);
        });

        return { success: true, data: refs };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getSamplePhotoReceptionById(
    id: string
): Promise<{ success: boolean; data?: SamplePhotoReception; error?: string }> {
    if (!id?.trim()) {
        return { success: false, error: 'Debe indicar un identificador de recepcion.' };
    }
    try {
        const ref = doc(firestore, 'samplePhotoReceptions', id.trim());
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            return { success: false, error: 'No se encontro la recepcion solicitada.' };
        }
        return {
            success: true,
            data: convertTimestampsToDates({ id: snap.id, ...snap.data() }) as SamplePhotoReception,
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export type UpdateSamplePhotoReceptionStatusPayload = {
    id: string;
    nextStatus: SamplePhotoReceptionStatus;
    note?: string;
    updatedById?: string;
    updatedByName?: string;
    activeTransferNumber?: string;
};

export type UpdateSamplePhotoReceptionStatusResult = {
    success: boolean;
    error?: string;
    unchanged?: boolean;
    data?: SamplePhotoReception;
};

function normalizeScanToken(input: string): string {
    return String(input ?? '')
        .trim()
        .toUpperCase()
        .replace(/[/\\]/g, '_');
}

function sortByUpdatedAtDesc(items: SamplePhotoReception[]): SamplePhotoReception[] {
    return [...items].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
}

function normalizeTransferNumber(input: string | null | undefined): string {
    return String(input ?? '').trim().toUpperCase();
}

export async function updateSamplePhotoReceptionStatus(
    payload: UpdateSamplePhotoReceptionStatusPayload
): Promise<UpdateSamplePhotoReceptionStatusResult> {
    if (!payload?.id?.trim()) {
        return { success: false, error: 'Debe indicar el id de la recepcion.' };
    }
    if (!payload?.nextStatus) {
        return { success: false, error: 'Debe indicar un estado destino valido.' };
    }
    if (!SAMPLE_PHOTO_RECEPTION_STATUSES.includes(payload.nextStatus)) {
        return { success: false, error: 'Estado destino invalido.' };
    }

    try {
        const receptionRef = doc(firestore, 'samplePhotoReceptions', payload.id.trim());
        return await runTransaction(firestore, async (tx) => {
            const snap = await tx.get(receptionRef);
            if (!snap.exists()) {
                return { success: false, error: 'No se encontro la recepcion solicitada.' };
            }

            const current = convertTimestampsToDates({ id: snap.id, ...snap.data() }) as SamplePhotoReception;
            const activeTf = normalizeTransferNumber(payload.activeTransferNumber);
            if (activeTf && normalizeTransferNumber(current.transferNumber) !== activeTf) {
                return {
                    success: false,
                    error: `Recepcion fuera de TF activa (${activeTf}).`,
                };
            }
            if (current.status === payload.nextStatus) {
                return { success: true, unchanged: true, data: current };
            }
            if (!isValidSamplePhotoReceptionTransition(current.status, payload.nextStatus)) {
                return {
                    success: false,
                    error: `Transicion invalida: ${current.status} -> ${payload.nextStatus}.`,
                };
            }

            const event: SamplePhotoReceptionEvent = {
                at: new Date(),
                fromStatus: current.status ?? null,
                toStatus: payload.nextStatus,
                note: payload.note?.trim().slice(0, 500) || null,
                actorId: payload.updatedById ?? null,
                actorName: payload.updatedByName ?? null,
            };

            const statusHistory = Array.isArray(current.statusHistory)
                ? [...current.statusHistory, event]
                : [event];
            const patch = convertDatesToTimestamps({
                status: payload.nextStatus,
                updatedAt: new Date(),
                updatedById: payload.updatedById ?? null,
                updatedByName: payload.updatedByName ?? null,
                statusHistory,
            }) as Record<string, unknown>;

            tx.set(receptionRef, patch, { merge: true });
            const updated: SamplePhotoReception = {
                ...current,
                ...convertTimestampsToDates(patch),
                id: current.id,
            } as SamplePhotoReception;
            return { success: true, unchanged: false, data: updated };
        });
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export type ScanSamplePhotoReceptionPayload = {
    scanValue: string;
    note?: string;
    updatedById?: string;
    updatedByName?: string;
    activeTransferNumber?: string;
};

export type ScanSamplePhotoReceptionResult = {
    success: boolean;
    error?: string;
    unchanged?: boolean;
    data?: SamplePhotoReception;
    source?: 'id' | 'reference' | 'transfer' | 'barcode';
};

export async function scanSamplePhotoReception(
    payload: ScanSamplePhotoReceptionPayload
): Promise<ScanSamplePhotoReceptionResult> {
    const scanValue = normalizeScanToken(payload?.scanValue ?? '');
    const activeTf = normalizeTransferNumber(payload?.activeTransferNumber);
    if (!scanValue) {
        return { success: false, error: 'Debe ingresar un valor de escaneo valido.' };
    }

    const byId = await getSamplePhotoReceptionById(scanValue);
    if (byId.success && byId.data) {
        const update = await updateSamplePhotoReceptionStatus({
            id: byId.data.id,
            nextStatus: 'received',
            note: payload.note || `Escaneo: ${scanValue}`,
            updatedById: payload.updatedById,
            updatedByName: payload.updatedByName,
            activeTransferNumber: activeTf || undefined,
        });
        return { ...update, source: 'id' };
    }

    try {
        const [byReferenceSnap, byTransferSnap] = await Promise.all([
            getDocs(
                query(collection(firestore, 'samplePhotoReceptions'), where('reference', '==', scanValue), limit(25))
            ),
            getDocs(
                query(collection(firestore, 'samplePhotoReceptions'), where('transferNumber', '==', scanValue), limit(25))
            ),
        ]);

        const candidatesMap = new Map<string, SamplePhotoReception>();
        byReferenceSnap.forEach((d) => {
            candidatesMap.set(d.id, convertTimestampsToDates({ id: d.id, ...d.data() }) as SamplePhotoReception);
        });
        byTransferSnap.forEach((d) => {
            candidatesMap.set(d.id, convertTimestampsToDates({ id: d.id, ...d.data() }) as SamplePhotoReception);
        });

        const candidates = sortByUpdatedAtDesc(
            Array.from(candidatesMap.values()).filter((item) => {
                const statusAllowed = item.status === 'pending' || item.status === 'in_progress';
                if (!statusAllowed) return false;
                if (!activeTf) return true;
                return normalizeTransferNumber(item.transferNumber) === activeTf;
            })
        );
        if (candidates.length > 0) {
            const matchedSource =
                candidates.some((item) => normalizeScanToken(item.reference) === scanValue) ? 'reference' : 'transfer';
            const update = await updateSamplePhotoReceptionStatus({
                id: candidates[0].id,
                nextStatus: 'received',
                note: payload.note || `Escaneo: ${scanValue}`,
                updatedById: payload.updatedById,
                updatedByName: payload.updatedByName,
                activeTransferNumber: activeTf || undefined,
            });
            return { ...update, source: matchedSource };
        }

        const barcodeLookup = await lookupBarcode(scanValue);
        if (barcodeLookup.status === 'success' && barcodeLookup.item?.referencia) {
            const resolvedReference = normalizeScanToken(barcodeLookup.item.referencia);
            const byBarcodeReference = await getDocs(
                query(collection(firestore, 'samplePhotoReceptions'), where('reference', '==', resolvedReference), limit(25))
            );
            const barcodeCandidates = sortByUpdatedAtDesc(
                byBarcodeReference.docs
                    .map((d) => convertTimestampsToDates({ id: d.id, ...d.data() }) as SamplePhotoReception)
                    .filter((item) => {
                        const statusAllowed = item.status === 'pending' || item.status === 'in_progress';
                        if (!statusAllowed) return false;
                        if (!activeTf) return true;
                        return normalizeTransferNumber(item.transferNumber) === activeTf;
                    })
            );
            if (barcodeCandidates.length === 0) {
                if (activeTf) {
                    return { success: false, error: `Barcode resuelto, pero fuera de TF activa (${activeTf}).` };
                }
                return { success: false, error: 'Barcode resuelto, pero no tiene recepcion pendiente asociada.' };
            }
            const update = await updateSamplePhotoReceptionStatus({
                id: barcodeCandidates[0].id,
                nextStatus: 'received',
                note: payload.note || `Escaneo barcode: ${scanValue}`,
                updatedById: payload.updatedById,
                updatedByName: payload.updatedByName,
                activeTransferNumber: activeTf || undefined,
            });
            return { ...update, source: 'barcode' };
        }

        return { success: false, error: 'No se encontro una recepcion pendiente para ese escaneo.' };
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

export async function saveSampleReferences(
  references: Pick<SampleReference, 'id' | 'sourceFile'>[]
): Promise<{ success: boolean; error?: string; processedCount: number }> {
  if (!references?.length) {
    return { success: false, error: 'No se proporcionaron referencias para guardar.', processedCount: 0 };
  }
  const collectionRef = collection(firestore, 'sampleReferences');
  const now = Timestamp.now();
  const CHUNK_SIZE = 450;
  try {
    for (let i = 0; i < references.length; i += CHUNK_SIZE) {
      const chunk = references.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      chunk.forEach((ref) => {
        if (ref.id && !ref.id.includes('/') && ref.id !== '.' && ref.id !== '..') {
          batch.set(doc(collectionRef, ref.id), { lastUploaded: now, sourceFile: ref.sourceFile }, { merge: true });
        }
      });
      await batch.commit();
    }
    return { success: true, processedCount: references.length };
  } catch (error: any) {
    return { success: false, error: `No se pudieron guardar las referencias: ${error.message}`, processedCount: 0 };
  }
}

export async function loadSampleReferences(): Promise<
  { success: true; data?: SampleReference[]; error?: string } | { success: false; error: string }
> {
  try {
    const q = query(collection(firestore, 'sampleReferences'), orderBy('lastUploaded', 'desc'));
    const snap = await getDocs(q);
    const data = snap.docs.map((d) => ({ id: d.id, ...convertTimestampsToDates(d.data()) }) as SampleReference);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getSampleReferenceById(
  referenceId: string
): Promise<{ success: boolean; data?: SampleReference | null; error?: string }> {
  try {
    const snap = await getDoc(doc(firestore, 'sampleReferences', referenceId.trim()));
    if (!snap.exists()) return { success: true, data: null };
    return { success: true, data: { id: snap.id, ...convertTimestampsToDates(snap.data()) } as SampleReference };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getSampleReferencesExistence(
  referenceIds: string[]
): Promise<{ success: boolean; data?: Record<string, boolean>; error?: string }> {
  try {
    const uniq = [...new Set(referenceIds.map((r) => String(r || '').trim().toUpperCase()).filter(Boolean))];
    const result: Record<string, boolean> = {};
    uniq.forEach((id) => { result[id] = false; });
    for (let i = 0; i < uniq.length; i += 30) {
      const chunk = uniq.slice(i, i + 30);
      if (!chunk.length) continue;
      const snap = await getDocs(query(collection(firestore, 'sampleReferences'), where(documentId(), 'in', chunk)));
      snap.docs.forEach((d) => { result[d.id.trim().toUpperCase()] = true; });
    }
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function saveSampleDeliveries(
  deliveries: Omit<SampleDelivery, 'id'>[]
): Promise<{ success: boolean; error?: string; processedCount: number }> {
  if (!deliveries?.length) {
    return { success: false, error: 'No se proporcionaron entregas para guardar.', processedCount: 0 };
  }
  const collectionRef = collection(firestore, 'sampleDeliveries');
  const CHUNK_SIZE = 450;
  try {
    for (let i = 0; i < deliveries.length; i += CHUNK_SIZE) {
      const chunk = deliveries.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      chunk.forEach((delivery) => batch.set(doc(collectionRef), convertDatesToTimestamps(delivery)));
      await batch.commit();
    }
    return { success: true, processedCount: deliveries.length };
  } catch (error: any) {
    return { success: false, error: error.message, processedCount: 0 };
  }
}

export async function getSampleDeliveriesByReferences(
  references: string[]
): Promise<{ success: boolean; data?: SampleDelivery[]; error?: string }> {
  try {
    if (!references?.length) return { success: true, data: [] };
    const all: SampleDelivery[] = [];
    for (let i = 0; i < references.length; i += 30) {
      const chunk = references.slice(i, i + 30).filter((r) => r?.trim());
      if (!chunk.length) continue;
      const snap = await getDocs(query(collection(firestore, 'sampleDeliveries'), where('reference', 'in', chunk)));
      snap.forEach((d) => all.push({ id: d.id, ...convertTimestampsToDates(d.data()) } as SampleDelivery));
    }
    return { success: true, data: all };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function saveSampleVerification(
  sessionData: Omit<SavedSampleVerification, 'id'>
): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const ref = await addDoc(collection(firestore, 'sampleVerifications'), convertDatesToTimestamps(sessionData));
    return { success: true, id: ref.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

const SAMPLE_VERIFICATION_PAGE_SIZE = 450;

export type LoadSampleVerificationsOptions = {
  maxSessions?: number;
};

export async function loadSampleVerifications(
  options?: LoadSampleVerificationsOptions
): Promise<{ success: boolean; data?: SavedSampleVerification[]; error?: string }> {
  try {
    const cap = Math.min(Math.max(options?.maxSessions ?? 2000, 1), 8000);
    const snap = await getDocs(query(collection(firestore, 'sampleVerifications'), orderBy('createdAt', 'desc'), limit(cap)));
    const data = snap.docs.map((d) => convertTimestampsToDates({ id: d.id, ...d.data() }) as SavedSampleVerification);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function loadSampleVerificationsSince(
  since: Date,
  options?: { maxTotalSessions?: number }
): Promise<{ success: boolean; data?: SavedSampleVerification[]; error?: string }> {
  try {
    const ts = Timestamp.fromDate(since);
    const sessions: SavedSampleVerification[] = [];
    let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
    while (true) {
      if (options?.maxTotalSessions != null && sessions.length >= options.maxTotalSessions) break;
      const pageSize = Math.min(SAMPLE_VERIFICATION_PAGE_SIZE, options?.maxTotalSessions != null ? Math.max(0, options.maxTotalSessions - sessions.length) : SAMPLE_VERIFICATION_PAGE_SIZE);
      if (pageSize <= 0) break;
      const coll = collection(firestore, 'sampleVerifications');
      const q = lastDoc
        ? query(coll, where('createdAt', '>=', ts), orderBy('createdAt', 'desc'), limit(pageSize), startAfter(lastDoc))
        : query(coll, where('createdAt', '>=', ts), orderBy('createdAt', 'desc'), limit(pageSize));
      const snap = await getDocs(q);
      if (snap.empty) break;
      snap.docs.forEach((d) => {
        sessions.push(convertTimestampsToDates({ id: d.id, ...d.data() }) as SavedSampleVerification);
      });
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize) break;
    }
    return { success: true, data: sessions };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// --- FIFO Ordering for Transfers ---
/**
 * Generates next storage orders specifically for each destination.
 */
export async function getNextStorageOrders(destCounts: Record<string, number>): Promise<Record<string, string[]>> {
    const counterRef = doc(firestore, 'counters', 'transfers_fifo_by_dest');
    
    try {
        return await runTransaction(firestore, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            const allCounters = counterDoc.exists() ? counterDoc.data() : {};
            const results: Record<string, string[]> = {};

            for (const [dest, count] of Object.entries(destCounts)) {
                if (count <= 0) continue;
                
                const normalizedDest = dest.trim().toUpperCase();
                let currentPrimary = allCounters[normalizedDest]?.lastPrimary || 0;
                let currentLap = allCounters[normalizedDest]?.lastLap || 1;
                
                const destOrders: string[] = [];
                for (let i = 0; i < count; i++) {
                    currentPrimary++;
                    if (currentPrimary > 999) {
                        currentPrimary = 1;
                        currentLap++;
                    }
                    destOrders.push(`${currentPrimary}-v${currentLap}`);
                }
                
                results[dest] = destOrders;
                allCounters[normalizedDest] = { lastPrimary: currentPrimary, lastLap: currentLap };
            }

            transaction.set(counterRef, allCounters);
            return results;
        });
    } catch (error) {
        console.error("Error generating next storage orders:", error);
        // Fallback: return empty arrays
        const fallback: Record<string, string[]> = {};
        Object.keys(destCounts).forEach(d => fallback[d] = Array(destCounts[d]).fill("N/A"));
        return fallback;
    }
}

/**
 * Migration helper to assign storage orders to existing active transfers that DON'T have one.
 * Ensures that subsequent clicks don't overwrite existing codes.
 */
export async function healTransferStorageOrders(): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const transfersCollection = collection(firestore, 'transfers');
        // Only target active ones without a storage order
        const q = query(
            transfersCollection, 
            where("status", "in", ["En Tránsito", "Recolectado en Ruta", "Recibido en Bodega", "Validado Supervisor"])
        );
        
        const snapshot = await getDocs(q);
        const docsToUpdate = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(d => !d.storageOrder); // ONLY those without order
        
        if (docsToUpdate.length === 0) {
            return { success: true, count: 0 };
        }

        // Group by destination to request batches
        const byDest: Record<string, any[]> = {};
        docsToUpdate.forEach(d => {
            const dest = (d.bodegaDestino || 'UNKNOWN').trim().toUpperCase();
            if (!byDest[dest]) byDest[dest] = [];
            byDest[dest].push(d);
        });

        // Get next orders for each dest
        const countsByDest: Record<string, number> = {};
        Object.keys(byDest).forEach(dest => countsByDest[dest] = byDest[dest].length);
        
        const newOrdersMap = await getNextStorageOrders(countsByDest);

        const batch = writeBatch(firestore);
        let totalCount = 0;

        for (const [dest, docs] of Object.entries(byDest)) {
            // Sort by date ASC to keep consistent numbering logic
            docs.sort((a, b) => {
                const dateA = a.fecha?.toDate ? a.fecha.toDate() : (a.fecha instanceof Date ? a.fecha : new Date(a.fecha));
                const dateB = b.fecha?.toDate ? b.fecha.toDate() : (b.fecha instanceof Date ? b.fecha : new Date(b.fecha));
                return dateA.getTime() - dateB.getTime();
            });

            const destOrders = newOrdersMap[dest] || [];
            for (let i = 0; i < docs.length; i++) {
                batch.update(doc(firestore, 'transfers', docs[i].id), { storageOrder: destOrders[i] || 'N/A' });
                totalCount++;
            }
        }
        
        await batch.commit();
        return { success: true, count: totalCount };
    } catch (error: any) {
        console.error("Error healing storage orders:", error);
        return { success: false, error: error.message };
    }
}

const ACTIVE_TRANSFER_STATUSES: TransferStatus[] = [
    'En Tránsito',
    'Recolectado en Ruta',
    'Recibido en Bodega',
    'Validado Supervisor',
];

/**
 * One-time administrative reindex:
 * Rebuilds FIFO order from scratch by destination, considering ONLY:
 * - En Tránsito
 * - Recolectado en Ruta
 * - Recibido en Bodega
 * - Validado Supervisor
 *
 * Excludes states like Enviado a Destino / Entregado en Ruta.
 */
export async function reindexTransferStorageOrdersByDestination(): Promise<{ success: boolean; count?: number; destinations?: number; error?: string }> {
    try {
        const transfersCollection = collection(firestore, 'transfers');
        const q = query(
            transfersCollection,
            where('status', 'in', ACTIVE_TRANSFER_STATUSES)
        );

        const snapshot = await getDocs(q);
        const docs = snapshot.docs.map(d => ({ id: d.id, ...convertTimestampsToDates(d.data()) } as TransferEntry));
        if (docs.length === 0) {
            return { success: true, count: 0, destinations: 0 };
        }

        const byDestination = new Map<string, TransferEntry[]>();
        docs.forEach(entry => {
            const dest = (entry.bodegaDestino || 'UNKNOWN').trim().toUpperCase();
            if (!byDestination.has(dest)) byDestination.set(dest, []);
            byDestination.get(dest)!.push(entry);
        });

        const updates: Array<{ id: string; storageOrder: string }> = [];
        const touchedCounters: Record<string, { lastPrimary: number; lastLap: number }> = {};

        byDestination.forEach((entries, destination) => {
            const grouped = new Map<string, { docs: TransferEntry[]; representative: TransferEntry }>();
            entries.forEach(entry => {
                const key = `${entry.numeroTF}__${entry.bodegaOrigen}__${entry.bodegaDestino}`;
                const existing = grouped.get(key);
                if (!existing) {
                    grouped.set(key, { docs: [entry], representative: entry });
                    return;
                }
                existing.docs.push(entry);
                const existingDate = existing.representative.fecha instanceof Date ? existing.representative.fecha : new Date(existing.representative.fecha as any);
                const currentDate = entry.fecha instanceof Date ? entry.fecha : new Date(entry.fecha as any);
                if (currentDate.getTime() < existingDate.getTime()) existing.representative = entry;
            });

            const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
                const dateA = a.representative.fecha instanceof Date ? a.representative.fecha : new Date(a.representative.fecha as any);
                const dateB = b.representative.fecha instanceof Date ? b.representative.fecha : new Date(b.representative.fecha as any);
                if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
                const tfA = tfNumericValue(a.representative.numeroTF);
                const tfB = tfNumericValue(b.representative.numeroTF);
                if (tfA !== tfB) return tfA - tfB;
                return String(a.representative.id).localeCompare(String(b.representative.id));
            });

            let sequence = 1;
            sortedGroups.forEach(group => {
                const orderCode = toStorageOrderCode(sequence);
                group.docs.forEach(docEntry => {
                    updates.push({ id: docEntry.id, storageOrder: orderCode });
                });
                sequence++;
            });

            const lastValue = Math.max(0, sequence - 1);
            const lap = lastValue === 0 ? 1 : Math.floor((lastValue - 1) / 999) + 1;
            const primary = lastValue === 0 ? 0 : ((lastValue - 1) % 999) + 1;
            touchedCounters[destination] = { lastPrimary: primary, lastLap: lap };
        });

        const CHUNK = 450;
        for (let i = 0; i < updates.length; i += CHUNK) {
            const batch = writeBatch(firestore);
            const chunk = updates.slice(i, i + CHUNK);
            chunk.forEach(update => {
                batch.update(doc(firestore, 'transfers', update.id), { storageOrder: update.storageOrder });
            });
            await batch.commit();
        }

        const counterRef = doc(firestore, 'counters', 'transfers_fifo_by_dest');
        const counterDoc = await getDoc(counterRef);
        const existingCounters = counterDoc.exists() ? counterDoc.data() : {};
        const mergedCounters = { ...existingCounters };
        Object.entries(touchedCounters).forEach(([dest, value]) => {
            mergedCounters[dest] = value;
        });
        await setDoc(counterRef, mergedCounters);

        return { success: true, count: updates.length, destinations: Object.keys(touchedCounters).length };
    } catch (error: any) {
        console.error('Error reindexing transfer storage orders by destination:', error);
        return { success: false, error: error.message || 'Error reindexando FIFO por destino.' };
    }
}

const parseStorageOrderValue = (storageOrder?: string): number | null => {
    if (!storageOrder) return null;
    const match = storageOrder.trim().match(/^(\d+)-v(\d+)$/i);
    if (!match) return null;
    const primary = Number(match[1]);
    const lap = Number(match[2]);
    if (!Number.isFinite(primary) || !Number.isFinite(lap) || primary <= 0 || lap <= 0) return null;
    return (lap - 1) * 999 + primary;
};

const toStorageOrderCode = (value: number): string => {
    const lap = Math.floor((value - 1) / 999) + 1;
    const primary = ((value - 1) % 999) + 1;
    return `${primary}-v${lap}`;
};

const tfNumericValue = (numeroTF?: string): number => {
    const match = String(numeroTF || '').match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
};

/**
 * Repairs FIFO order for a single transfer group (same TF + origen + destino).
 * It tries to place the transfer in the smallest free consecutive slot that keeps
 * chronological order by fecha (and TF numeric value as tie-breaker).
 */
export async function repairSingleTransferStorageOrder(transferId: string): Promise<{ success: boolean; order?: string; updatedCount?: number; error?: string }> {
    try {
        const targetRef = doc(firestore, 'transfers', transferId);
        const targetSnap = await getDoc(targetRef);
        if (!targetSnap.exists()) {
            return { success: false, error: 'No se encontró la transferencia seleccionada.' };
        }

        const target = convertTimestampsToDates({ id: targetSnap.id, ...targetSnap.data() }) as TransferEntry;
        const targetDate = target.fecha instanceof Date ? target.fecha : new Date(target.fecha as any);
        if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
            return { success: false, error: 'La transferencia no tiene una fecha válida para recalcular el orden.' };
        }

        const destination = (target.bodegaDestino || '').trim();
        if (!destination) {
            return { success: false, error: 'La transferencia no tiene bodega destino definida.' };
        }

        const destinationQuery = query(
            collection(firestore, 'transfers'),
            where('bodegaDestino', '==', destination),
            where('status', 'in', ACTIVE_TRANSFER_STATUSES)
        );
        const destinationSnapshot = await getDocs(destinationQuery);
        const allDestinationDocs = destinationSnapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as TransferEntry);

        const groupKey = `${target.numeroTF}__${target.bodegaOrigen}__${target.bodegaDestino}`;
        const grouped = new Map<string, { docs: TransferEntry[]; representative: TransferEntry; orderValue: number | null; isLockedReceived: boolean }>();

        allDestinationDocs.forEach(entry => {
            const key = `${entry.numeroTF}__${entry.bodegaOrigen}__${entry.bodegaDestino}`;
            const existing = grouped.get(key);
            if (!existing) {
                grouped.set(key, {
                    docs: [entry],
                    representative: entry,
                    orderValue: parseStorageOrderValue(entry.storageOrder),
                    isLockedReceived: entry.status === 'Recibido en Bodega',
                });
                return;
            }
            existing.docs.push(entry);
            const existingDate = existing.representative.fecha instanceof Date ? existing.representative.fecha : new Date(existing.representative.fecha as any);
            const currentDate = entry.fecha instanceof Date ? entry.fecha : new Date(entry.fecha as any);
            if (currentDate.getTime() < existingDate.getTime()) {
                existing.representative = entry;
            }
            const parsed = parseStorageOrderValue(entry.storageOrder);
            if (existing.orderValue === null && parsed !== null) existing.orderValue = parsed;
            if (entry.status === 'Recibido en Bodega') existing.isLockedReceived = true;
        });

        const targetGroup = grouped.get(groupKey);
        if (!targetGroup) {
            return { success: false, error: 'No se pudo identificar el grupo de la transferencia para reparar.' };
        }

        const targetPriorityDate = targetGroup.representative.fecha instanceof Date ? targetGroup.representative.fecha : new Date(targetGroup.representative.fecha as any);
        const targetTfNumber = tfNumericValue(targetGroup.representative.numeroTF);

        const usedValues = new Set<number>();
        let lowerBound = 0;
        let upperBound = Number.POSITIVE_INFINITY;

        const afterTargetGroups: Array<{ key: string; docs: TransferEntry[]; orderValue: number }> = [];

        grouped.forEach((group, key) => {
            if (key === groupKey) return;
            const orderValue = group.orderValue;
            if (orderValue === null) return;

            usedValues.add(orderValue);

            const groupDate = group.representative.fecha instanceof Date ? group.representative.fecha : new Date(group.representative.fecha as any);
            const groupTfNumber = tfNumericValue(group.representative.numeroTF);
            const isBeforeTarget = groupDate.getTime() < targetPriorityDate.getTime()
                || (groupDate.getTime() === targetPriorityDate.getTime() && groupTfNumber < targetTfNumber);
            const isAfterTarget = groupDate.getTime() > targetPriorityDate.getTime()
                || (groupDate.getTime() === targetPriorityDate.getTime() && groupTfNumber > targetTfNumber);

            if (isBeforeTarget && orderValue > lowerBound) lowerBound = orderValue;
            if (isAfterTarget) {
                if (group.isLockedReceived) {
                    if (orderValue < upperBound) upperBound = orderValue;
                } else {
                    afterTargetGroups.push({ key, docs: group.docs, orderValue });
                }
            }
        });

        let candidate = lowerBound + 1;
        while (usedValues.has(candidate) && candidate < upperBound) {
            candidate++;
        }

        const batch = writeBatch(firestore);
        let updatedCount = 0;
        let finalTargetOrder = candidate;

        if (candidate < upperBound && Number.isFinite(candidate) && candidate > 0) {
            const newOrder = toStorageOrderCode(candidate);
            targetGroup.docs.forEach(entry => {
                batch.update(doc(firestore, 'transfers', entry.id), { storageOrder: newOrder });
                updatedCount++;
            });
            finalTargetOrder = candidate;
        } else {
            // Fallback strategy:
            // if there is no direct gap between bounds, create room by shifting only
            // "after target" groups from the insertion point onward.
            const insertionBase = Math.max(1, lowerBound + 1);
            const occupied = new Set<number>(usedValues);

            const groupsToShift = afterTargetGroups
                .filter(g => g.orderValue >= insertionBase && g.orderValue < upperBound)
                .sort((a, b) => a.orderValue - b.orderValue);

            groupsToShift.forEach(g => occupied.delete(g.orderValue));

            let insertion = insertionBase;
            while (occupied.has(insertion)) insertion++;

            if (insertion >= upperBound) {
                return {
                    success: false,
                    error: 'No se puede reasignar sin mover transferencias ya recibidas en bodega. Mantengo los consecutivos impresos sin cambios.',
                };
            }

            finalTargetOrder = insertion;
            occupied.add(finalTargetOrder);

            const targetOrderCode = toStorageOrderCode(finalTargetOrder);
            targetGroup.docs.forEach(entry => {
                batch.update(doc(firestore, 'transfers', entry.id), { storageOrder: targetOrderCode });
                updatedCount++;
            });

            let lastAssigned = finalTargetOrder;
            for (const g of groupsToShift) {
                let nextValue = Math.max(g.orderValue, lastAssigned + 1);
                while (occupied.has(nextValue)) nextValue++;
                occupied.add(nextValue);
                lastAssigned = nextValue;

                const shiftedCode = toStorageOrderCode(nextValue);
                g.docs.forEach(entry => {
                    batch.update(doc(firestore, 'transfers', entry.id), { storageOrder: shiftedCode });
                    updatedCount++;
                });
            }
        }

        await batch.commit();
        return { success: true, order: toStorageOrderCode(finalTargetOrder), updatedCount };
    } catch (error: any) {
        console.error('Error repairing single transfer storage order:', error);
        return { success: false, error: error.message || 'Error desconocido reparando el orden FIFO.' };
    }
}


// --- Transfers Module Actions ---
export async function saveTransfers(transfers: Omit<TransferEntry, 'id' | 'status'>[]): Promise<{ success: boolean; error?: string; summary?: { added: number, updated: number, removed: number } }> {
    const transfersCollection = collection(firestore, 'transfers');
    
    try {
        // 1. Get ALL current transfers to build an existence map
        const existingSnapshot = await getDocs(transfersCollection); 
        
        const existingTransfersByKey = new Map<string, { id: string, data: TransferEntry }>();
        existingSnapshot.forEach(doc => {
            const data = doc.data() as TransferEntry;
            // Composite Key: TF + Marca + Grupo (Normalized)
            const key = `${data.numeroTF}-${(data.marca || '').trim().toUpperCase()}-${(data.grupo || '').trim().toUpperCase()}`;
            existingTransfersByKey.set(key, { id: doc.id, data });
        });

        // Unique keys in the incoming file
        const incomingKeys = new Set(transfers.map(t => 
            `${t.numeroTF}-${(t.marca || '').trim().toUpperCase()}-${(t.grupo || '').trim().toUpperCase()}`
        ));

        const batch = writeBatch(firestore);
        let added = 0;
        let updated = 0;
        let removed = 0;

        // 2. Identify what to DELETE: In Firebase (as "En Tránsito") but NOT in Excel
        // Comparison is now done via the composite key.
        for (const [key, existing] of existingTransfersByKey.entries()) {
            if (!incomingKeys.has(key) && existing.data.status === 'En Tránsito') {
                batch.delete(doc(transfersCollection, existing.id));
                removed++;
            }
        }

        // 3. Process incoming transfers: ADD or UPDATE
        // Count new records per destination
        const newTransCounts: Record<string, number> = {};
        for (const incoming of transfers) {
            const compositeKey = `${incoming.numeroTF}-${(incoming.marca || '').trim().toUpperCase()}-${(incoming.grupo || '').trim().toUpperCase()}`;
            if (!existingTransfersByKey.has(compositeKey)) {
                const dest = (incoming.bodegaDestino || 'UNKNOWN').trim().toUpperCase();
                newTransCounts[dest] = (newTransCounts[dest] || 0) + 1;
            }
        }
        
        const newOrdersMap = Object.keys(newTransCounts).length > 0 ? await getNextStorageOrders(newTransCounts) : {};
        const destOrderIndices: Record<string, number> = {};

        for (const incoming of transfers) {
            const compositeKey = `${incoming.numeroTF}-${(incoming.marca || '').trim().toUpperCase()}-${(incoming.grupo || '').trim().toUpperCase()}`;
            const existing = existingTransfersByKey.get(compositeKey);
            const dest = (incoming.bodegaDestino || 'UNKNOWN').trim().toUpperCase();
            
            if (existing) {
                // UPDATE metadata but keep status
                const docRef = doc(transfersCollection, existing.id);
                const updates = {
                    ...convertDatesToTimestamps(incoming),
                    status: existing.data.status // Preserve operational status
                };
                batch.update(docRef, updates);
                updated++;
            } else {
                // ADD new record (New line for this TF or brand combination)
                const docRef = doc(transfersCollection); 
                const destOrders = newOrdersMap[dest] || [];
                const idx = destOrderIndices[dest] || 0;
                
                batch.set(docRef, { 
                    ...convertDatesToTimestamps(incoming), 
                    status: 'En Tránsito',
                    storageOrder: destOrders[idx] || 'N/A'
                });
                
                destOrderIndices[dest] = idx + 1;
                added++;
            }
        }
        
        await batch.commit();
        return { success: true, summary: { added, updated, removed } };

    } catch (error: any) {
        console.error("Error guardando transferencias (Composite Sync):", error);
        return { success: false, error: `No se pudieron guardar las transferencias: ${error.message}` };
    }
}

/**
 * Perform a differential sync of raw JSON records from the uploaded Excel
 * specifically for the Warehouse Analyzer collection.
 * It clears records that are not in the new file and updates/adds the rest.
 */
export async function syncAnalysisRecords(rawJson: any[]): Promise<{ success: boolean; error?: string; count?: number }> {
    const analysisCollection = collection(firestore, 'transfers_analysis');
    
    try {
        // 1. Get all current records to identify what to delete
        const snapshot = await getDocs(analysisCollection);
        const existingDocs = new Map<string, string>(); // Key -> docId
        snapshot.forEach(doc => {
            const data = doc.data();
            // Use same composite key logic
            const key = `${data.numeroTF}-${(data.marca || '').trim().toUpperCase()}-${(data.grupo || '').trim().toUpperCase()}`;
            existingDocs.set(key, doc.id);
        });

        const batch = writeBatch(firestore);
        
        // 2. Identify incoming records and their keys
        const incomingDocs = new Map<string, any>();
        rawJson.forEach(row => {
            const numeroTF = String(row['Numero TF'] || 'N/A');
            const marca = String(row['Marca'] || '').trim().toUpperCase();
            const grupo = String(row['Grupo'] || '').trim().toUpperCase();
            const key = `${numeroTF}-${marca}-${grupo}`;
            
            // Add or overwrite if duplicate keys in same file? Usually we keep all lines but composite key implies 1 per combination
            incomingDocs.set(key, row);
        });

        // 3. Delete records NOT in the incoming map
        existingDocs.forEach((docId, key) => {
            if (!incomingDocs.has(key)) {
                batch.delete(doc(analysisCollection, docId));
            }
        });

        // 4. Update or Add incoming records
        incomingDocs.forEach((row, key) => {
            const existingId = existingDocs.get(key);
            const docRef = existingId ? doc(analysisCollection, existingId) : doc(analysisCollection);
            
            // We save the raw row but normalized for query/sync
            const dataToSave = {
                ...row,
                // Normalized fields for consistent identification
                numeroTF: String(row['Numero TF'] || row['NUMERO TF'] || row['doc'] || 'N/A'),
                marca: String(row['Marca'] || row['MARCA'] || ''),
                grupo: String(row['Grupo'] || row['GRUPO'] || ''),
                bodegaOrigen: String(row['Bodega Origen'] || row['BOD. SALIDA'] || 'N/A'),
                bodegaDestino: String(row['Bodega Destino'] || row['BOD. ENTRADA'] || row['BOD DESTINO'] || 'N/A'),
                fecha: row['Fecha'] ? convertDatesToTimestamps({ f: parseFlexibleDate(row['Fecha']) }).f : 
                       (row['fechaFinalizado'] ? convertDatesToTimestamps({ f: parseFlexibleDate(row['fechaFinalizado']) }).f : null),
                cantidad: Number(row['Cantidad'] || row['CANTIDAD'] || 1),
                
                // Platform Specific persistence
                estadoPlataforma: row['estadoPlataforma'] || row['ESTADO PLATAFORMA'] || '',
                novedad: row['novedad'] || row['NOVEDAD'] || '',
                image: row['image'] || row['link de imagenes'] || '',
                fechaFinalizado: row['fechaFinalizado'] || row['fecha de servicio'] || '',
                hoyRuta: row['hoyRuta'] || row['HOY RUTA'] || '',
                
                lastSync: new Date()
            };
            
            if (existingId) {
                batch.update(docRef, dataToSave);
            } else {
                batch.set(docRef, dataToSave);
            }
        });

        await batch.commit();
        return { success: true, count: incomingDocs.size };

    } catch (error: any) {
        console.error("Error syncing analysis records:", error);
        return { success: false, error: error.message };
    }
}

export async function loadAnalysisRecords(): Promise<{ data?: any[]; error?: string }> {
    try {
        const analysisCollection = collection(firestore, 'transfers_analysis');
        const snapshot = await getDocs(analysisCollection);
        const data = snapshot.docs.map(doc => {
            const raw = doc.data();
            // Convert any timestamps back to dates for the UI analyzer
            return convertTimestampsToDates(raw);
        });
        return { data };
    } catch (error: any) {
        console.error("Error loading analysis records:", error);
        return { error: error.message };
    }
}

export async function getTransfersByStatus(status: TransferStatus): Promise<{ data?: TransferEntry[]; error?: string }> {
    try {
        const q = query(collection(firestore, "transfers"), where("status", "==", status), limit(1000));
        const querySnapshot = await getDocs(q);
        const transfers = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as TransferEntry[];
        return { data: transfers };
    } catch (error: any) {
        console.error(`Error loading transfers by status ${status}:`, error);
        return { error: `Failed to load transfers: ${error.message}` };
    }
}

export async function getTransfersByQuery(searchQuery: string, type: 'number' | 'origin' | 'destination'): Promise<{ data?: TransferEntry[]; error?: string }> {
    try {
        let field = 'numeroTF';
        if (type === 'origin') field = 'bodegaOrigen';
        if (type === 'destination') field = 'bodegaDestino';

        const q = query(
            collection(firestore, "transfers"), 
            where(field, "==", searchQuery.toUpperCase().trim()),
            limit(1000)
        );
        
        const querySnapshot = await getDocs(q);
        const transfers = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as TransferEntry[];
        return { data: transfers };
    } catch (error: any) {
        console.error("Error searching transfers:", error);
        return { error: `Search failed: ${error.message}` };
    }
}

export async function getTransfersByDateRange(startDate: Date, endDate: Date): Promise<{ data?: TransferEntry[]; error?: string }> {
    try {
        // Ensure we cover the full range of the end date
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const q = query(
            collection(firestore, "transfers"),
            where("fecha", ">=", Timestamp.fromDate(start)),
            where("fecha", "<=", Timestamp.fromDate(end)),
            orderBy("fecha", "desc"),
            limit(1000)
        );

        const querySnapshot = await getDocs(q);
        const transfers = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...convertTimestampsToDates(doc.data())
        })) as TransferEntry[];
        return { data: transfers };
    } catch (error: any) {
        console.error("Error searching transfers by date range:", error);
        return { error: `Date range search failed: ${error.message}` };
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

function applyTransferStatusActor(
    updates: Record<string, unknown>,
    status: TransferStatus,
    actor?: TransferActor,
    justification?: string,
    at: Timestamp = Timestamp.now()
) {
    if (!actor?.userId) return;
    const actorName = (actor.displayName || '').trim() || actor.userId;

    if (justification) {
        updates.manualStatusChangedBy = actor.userId;
        updates.manualStatusChangedByName = actorName;
    }

    updates.statusHistory = arrayUnion({
        status,
        at,
        userId: actor.userId,
        userName: actorName,
    });

    switch (status) {
        case 'Recolectado en Ruta':
            updates.recolectadoBy = actor.userId;
            updates.recolectadoByName = actorName;
            break;
        case 'Validado Supervisor':
            updates.validatedBy = actor.userId;
            updates.validatedByName = actorName;
            break;
        case 'Recibido en Bodega':
            updates.recibidoBodegaBy = actor.userId;
            updates.recibidoBodegaByName = actorName;
            break;
        case 'Enviado a Destino':
            updates.enviadoBy = actor.userId;
            updates.enviadoByName = actorName;
            break;
        case 'Entregado en Ruta':
            updates.deliveredBy = actor.userId;
            updates.deliveredByName = actorName;
            break;
    }
}

export async function updateTransferStatus(
    transferId: string | string[],
    status: TransferStatus,
    justification?: string,
    actor?: TransferActor
): Promise<{ success: boolean; error?: string }> {
    try {
        const ids = Array.isArray(transferId) ? transferId : [transferId];
        if (ids.length === 0) {
            return { success: false, error: 'ID(s) de transferencia no proporcionado(s).' };
        }

        const batch = writeBatch(firestore);
        
        const updates: Record<string, unknown> = { status };
        if (justification) {
            updates.manualStatusChangeJustification = justification;
        }

        const now = Timestamp.now();
        if (status === 'Recibido en Bodega') updates.recibidoAt = now;
        else if (status === 'Enviado a Destino') updates.enviadoAt = now;
        else if (status === 'Validado Supervisor') updates.validatedAt = now;
        else if (status === 'Entregado en Ruta') updates.deliveredAt = now;
        else if (status === 'Recolectado en Ruta') updates.recibidoAt = now;

        applyTransferStatusActor(updates, status, actor, justification, now);

        ids.forEach(id => {
            const transferRef = doc(firestore, "transfers", id);
            batch.update(transferRef, updates);
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error actualizando estados:", error);
        return { success: false, error: `No se pudo actualizar el estado de las transferencias: ${error.message}` };
    }
}

export async function batchUpdateTransferStatus(
    transferIds: string[],
    status: TransferStatus,
    actor?: TransferActor
): Promise<{ success: boolean; error?: string }> {
    if (!transferIds || transferIds.length === 0) {
        return { success: true }; // Nothing to do
    }
    const batch = writeBatch(firestore);
    try {
        transferIds.forEach(id => {
            const transferRef = doc(firestore, 'transfers', id);
            const updates: Record<string, unknown> = { status };
            const now = Timestamp.now();
            if (status === 'Recibido en Bodega') {
                updates.recibidoAt = now;
            }
            applyTransferStatusActor(updates, status, actor, undefined, now);
            batch.update(transferRef, updates);
        });
        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error('Error in batch update transfer status:', error);
        return { success: false, error: error.message };
    }
}

export async function healInconsistentTransfers(): Promise<{ success: boolean; updatedCount: number; error?: string }> {
    try {
        // Filter from March 1st, 2026
        const startDate = new Date(2026, 2, 1); // Month is 0-indexed, so 2 is March
        const q = query(
            collection(firestore, "transfers"), 
            where("fecha", ">=", Timestamp.fromDate(startDate))
        );
        
        const querySnapshot = await getDocs(q);
        const allTransfers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TransferEntry));

        const STATUS_ORDER: TransferStatus[] = [
            'En Tránsito',
            'Recolectado en Ruta',
            'Validado Supervisor',
            'Recibido en Bodega',
            'Enviado a Destino',
            'Entregado en Ruta'
        ];

        const getStatusWeight = (status: TransferStatus) => STATUS_ORDER.indexOf(status);

        // Group by numeroTF
        const tfGroups = new Map<string, TransferEntry[]>();
        allTransfers.forEach(t => {
            const group = tfGroups.get(t.numeroTF) || [];
            group.push(t);
            tfGroups.set(t.numeroTF, group);
        });

        const updatesToPerform: { id: string, status: TransferStatus, updates: any }[] = [];
        let inconsistentTfCount = 0;

        tfGroups.forEach((lines, numeroTF) => {
            const statuses = new Set(lines.map(l => l.status));
            if (statuses.size > 1) {
                inconsistentTfCount++;
                // Find the "highest" status in the group
                let highestStatus = lines[0].status;
                let maxWeight = getStatusWeight(highestStatus);
                
                lines.forEach(l => {
                    const weight = getStatusWeight(l.status);
                    if (weight > maxWeight) {
                        maxWeight = weight;
                        highestStatus = l.status;
                    }
                });

                // Find a line that has the highest status to copy its metadata (dates) if possible
                const templateLine = lines.find(l => l.status === highestStatus)!;
                const metadata: any = {};
                if (templateLine.recibidoAt) metadata.recibidoAt = templateLine.recibidoAt;
                if (templateLine.validatedAt) metadata.validatedAt = templateLine.validatedAt;
                if (templateLine.enviadoAt) metadata.enviadoAt = templateLine.enviadoAt;
                if (templateLine.deliveredAt) metadata.deliveredAt = templateLine.deliveredAt;
                if (templateLine.recolectadoBy) metadata.recolectadoBy = templateLine.recolectadoBy;
                if (templateLine.recolectadoByName) metadata.recolectadoByName = templateLine.recolectadoByName;
                if (templateLine.validatedBy) metadata.validatedBy = templateLine.validatedBy;
                if (templateLine.validatedByName) metadata.validatedByName = templateLine.validatedByName;
                if (templateLine.recibidoBodegaBy) metadata.recibidoBodegaBy = templateLine.recibidoBodegaBy;
                if (templateLine.recibidoBodegaByName) metadata.recibidoBodegaByName = templateLine.recibidoBodegaByName;
                if (templateLine.enviadoBy) metadata.enviadoBy = templateLine.enviadoBy;
                if (templateLine.enviadoByName) metadata.enviadoByName = templateLine.enviadoByName;
                if (templateLine.deliveredBy) metadata.deliveredBy = templateLine.deliveredBy;
                if (templateLine.deliveredByName) metadata.deliveredByName = templateLine.deliveredByName;
                if (templateLine.statusHistory) metadata.statusHistory = templateLine.statusHistory;

                // Mark lines that need update
                lines.forEach(l => {
                    if (l.status !== highestStatus) {
                        updatesToPerform.push({
                            id: l.id,
                            status: highestStatus,
                            updates: {
                                status: highestStatus,
                                ...metadata,
                                healTimestamp: Timestamp.now()
                            }
                        });
                    }
                });
            }
        });

        if (updatesToPerform.length === 0) {
            return { success: true, updatedCount: 0 };
        }

        // Apply updates in batches
        const CHUNK_SIZE = 450;
        for (let i = 0; i < updatesToPerform.length; i += CHUNK_SIZE) {
            const chunk = updatesToPerform.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(update => {
                const docRef = doc(firestore, "transfers", update.id);
                batch.update(docRef, update.updates);
            });
            await batch.commit();
        }

        return { success: true, updatedCount: updatesToPerform.length };
    } catch (error: any) {
        console.error("Error healing transfers:", error);
        return { success: false, error: `Error reparando transferencias: ${error.message}`, updatedCount: 0 };
    }
}
    
export async function createDeliveryManifest(
    manifestData: Omit<DeliveryManifest, 'id' | 'createdAt' | 'manifestId'>,
    actor?: TransferActor
): Promise<{ success: boolean; error?: string; id?: string }> {
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
            const enviadoUpdates: Record<string, unknown> = {
                status: 'Enviado a Destino',
                enviadoAt: now,
            };
            applyTransferStatusActor(enviadoUpdates, 'Enviado a Destino', actor);
            for (const transferId of manifestData.transferIds) {
                const transferRef = doc(firestore, 'transfers', transferId);
                transaction.update(transferRef, enviadoUpdates);
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
        const q = query(collection(firestore, "deliveryManifests"), orderBy("manifestId", "desc"), limit(100));
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

/** Carga la transferencia actualizada desde Firestore y fusiona historial de todas sus líneas. */
export async function getTransferTraceability(
    transferIds: string[]
): Promise<{ success: boolean; data?: TransferEntry | null; error?: string }> {
    try {
        const result = await getTransfersByIds(transferIds);
        if (!result.success || !result.data?.length) {
            return { success: false, error: result.error || 'No se encontró la transferencia.' };
        }

        const lines = result.data;
        const statusPriority: Record<TransferStatus, number> = {
            'En Tránsito': 1,
            'Recolectado en Ruta': 2,
            'Entregado en Ruta': 3,
            'Validado Supervisor': 4,
            'Recibido en Bodega': 5,
            'Enviado a Destino': 6,
        };

        const primary = [...lines].sort(
            (a, b) => (statusPriority[b.status] ?? 0) - (statusPriority[a.status] ?? 0)
        )[0];

        const mergedHistory: TransferStatusHistoryEntry[] = [];
        const seen = new Set<string>();
        for (const line of lines) {
            for (const entry of line.statusHistory || []) {
                const atMs = entry.at instanceof Date ? entry.at.getTime() : new Date(entry.at as unknown as string).getTime();
                const key = `${entry.status}-${atMs}-${entry.userId}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    mergedHistory.push({
                        ...entry,
                        at: entry.at instanceof Date ? entry.at : new Date(entry.at as unknown as string),
                    });
                }
            }
        }
        mergedHistory.sort((a, b) => a.at.getTime() - b.at.getTime());

        return {
            success: true,
            data: {
                ...primary,
                statusHistory: mergedHistory.length > 0 ? mergedHistory : primary.statusHistory,
            },
        };
    } catch (error: any) {
        console.error('Error loading transfer traceability:', error);
        return { success: false, error: error.message };
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
        const destKey = data.bodegaDestino.trim().toUpperCase();
        const orderRes = await getNextStorageOrders({ [destKey]: 1 });
        const order = orderRes[destKey] ? orderRes[destKey][0] : 'N/A';

        const newTransfer: Omit<TransferEntry, 'id'> = {
            fecha: new Date(),
            numeroTF: data.numeroTF.toUpperCase().trim(),
            bodegaOrigen: data.origen || 'BODEGA PPA', // Default to BODEGA PPA if not provided
            bodegaDestino: data.bodegaDestino,
            cantidad: 1, // Default value
            status: data.status || 'En Tránsito', // Default to En Tránsito if not provided
            storageOrder: order
        };

        await addDoc(transfersCollection, convertDatesToTimestamps(newTransfer));

        return { success: true };
    } catch (error: any) {
        console.error("Error creando transferencia manual:", error);
        return { success: false, error: `No se pudo crear la transferencia: ${error.message}` };
    }
}

export async function migrateAdidasVerifications(): Promise<{
  success: boolean;
  error?: string;
  updatedCount: number;
}> {
  try {
    const snap = await getDocs(collection(firestore, 'sampleVerifications'));
    const batch = writeBatch(firestore);
    let updatedCount = 0;
    snap.forEach((docSnap) => {
      const verification = { id: docSnap.id, ...convertTimestampsToDates(docSnap.data()) } as SavedSampleVerification;
      if (!verification.name || !Array.isArray(verification.results) || !verification.createdAt) return;
      const name = verification.name.toUpperCase();
      if (!name.startsWith('AD') && !name.includes('ADIDAS')) return;
      let wasModified = false;
      const verificationDate = new Date(verification.createdAt);
      const newResults = verification.results.map((res) => {
        let updatedRes = { ...res };
        if (res.status === 'Muestra Nueva Requerida') {
          wasModified = true;
          updatedRes = {
            ...res,
            status: 'Advertencia: Entregada pero sin Foto' as const,
            deliveryHistory: [{
              id: `manual-${res.reference}-${verificationDate.getTime()}`,
              reference: res.reference,
              transferNumber: verification.name,
              deliveryDate: verificationDate,
              sourceWarehouse: 'VERIFICACION MANUAL',
              destinationWarehouse: 'FOTOGRAFIA',
            }],
          };
        }
        return updatedRes;
      });
      if (wasModified) {
        batch.update(doc(firestore, 'sampleVerifications', verification.id), { results: convertDatesToTimestamps(newResults) });
        updatedCount++;
      }
    });
    if (updatedCount > 0) await batch.commit();
    return { success: true, updatedCount };
  } catch (error: any) {
    return { success: false, error: error.message, updatedCount: 0 };
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

export async function createCollectionLog(
    placa: string,
    transferIds: string[],
    userId: string,
    userDisplayName?: string
): Promise<{ success: boolean; error?: string; }> {
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

        const actorName = (userDisplayName || '').trim() || userId;
        const collectedAt = Timestamp.now();
        transferIds.forEach(id => {
            const transferRef = doc(transfersCollection, id);
            batch.update(transferRef, { 
                status: 'Recolectado en Ruta',
                recibidoAt: collectedAt,
                recolectadoBy: userId,
                recolectadoByName: actorName,
                statusHistory: arrayUnion({
                    status: 'Recolectado en Ruta',
                    at: collectedAt,
                    userId,
                    userName: actorName,
                }),
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
        const q = query(collection(firestore, "collectionLogs"), orderBy("createdAt", "desc"), limit(100));
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

// BAG COUNTING ACTIONS
export async function createBagOperation(name: string, totalBags: number, userId: string, userName: string): Promise<{ success: boolean; data?: BagOperation; error?: string }> {
    try {
        const counterRef = doc(firestore, "metadata", "bagOperations");
        
        const result = await runTransaction(firestore, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            let nextCount = 1;
            
            if (counterDoc.exists()) {
                nextCount = (counterDoc.data().count || 0) + 1;
            }
            
            transaction.set(counterRef, { count: nextCount }, { merge: true });

            const opId = `BAG-OP${nextCount}`;
            const bags: Record<string, BagItem> = {};
            
            for (let i = 1; i <= totalBags; i++) {
                const bagId = `${opId}-B${i.toString().padStart(3, '0')}`;
                bags[bagId] = { id: bagId, loaded: false, discharged: false };
            }

            const newOperation: BagOperation = {
                id: opId,
                name,
                totalBags,
                bags,
                createdAt: new Date(),
                status: 'cargue',
                createdBy: userId,
                createdByName: userName
            };

            const opRef = doc(firestore, "bagOperations", opId);
            transaction.set(opRef, convertDatesToTimestamps(newOperation));
            
            return newOperation;
        });

        return { success: true, data: result };
    } catch (error: any) {
        console.error("Error creating bag operation:", error);
        return { success: false, error: error.message };
    }
}

export async function addBagsToOperation(opId: string, extraQuantity: number): Promise<{ success: boolean; error?: string }> {
    try {
        const opRef = doc(firestore, "bagOperations", opId);
        await runTransaction(firestore, async (transaction) => {
            const opDoc = await transaction.get(opRef);
            if (!opDoc.exists()) throw new Error("La operación no existe");

            const data = opDoc.data() as BagOperation;
            const currentTotal = data.totalBags;
            const newTotal = currentTotal + extraQuantity;
            const newBags = { ...data.bags };

            for (let i = currentTotal + 1; i <= newTotal; i++) {
                const bagId = `${opId}-B${i.toString().padStart(3, '0')}`;
                newBags[bagId] = { id: bagId, loaded: false, discharged: false };
            }

            transaction.update(opRef, { 
                totalBags: newTotal,
                bags: newBags
            });
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error adding bags to operation:", error);
        return { success: false, error: error.message };
    }
}

export async function getBagOperations(): Promise<{ success: boolean; data?: BagOperation[]; error?: string }> {
    try {
        const q = query(collection(firestore, "bagOperations"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const ops = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as BagOperation);
        return { success: true, data: ops };
    } catch (error: any) {
        console.error("Error getting bag operations:", error);
        return { success: false, error: error.message };
    }
}

export async function processBagScan(opId: string, barcode: string, phase: 'cargue' | 'descargue'): Promise<{ success: boolean; error?: string; alreadyProcessed?: boolean; invalidCode?: boolean; errorType?: 'NOT_FOUND' | 'DUPLICATE' | 'INVALID_PHASE' }> {
    try {
        const opRef = doc(firestore, "bagOperations", opId);
        const result = await runTransaction(firestore, async (transaction) => {
            const opDoc = await transaction.get(opRef);
            if (!opDoc.exists()) throw new Error("La operación no existe");

            const data = opDoc.data() as BagOperation;
            const bags = data.bags || {};
            
            if (!bags[barcode]) {
                return { success: false, invalidCode: true, errorType: 'NOT_FOUND', error: `El código ${barcode} no pertenece a esta operación.` };
            }

            const bag = bags[barcode];
            const timestampField = phase === 'cargue' ? 'loadedAt' : 'dischargedAt';
            const statusField = phase === 'cargue' ? 'loaded' : 'discharged';

            if (bag[statusField]) {
                return { success: true, alreadyProcessed: true, errorType: 'DUPLICATE' };
            }

            if (phase === 'descargue' && !bag.loaded) {
                return { success: false, error: "Esta bolsa no fue registrada en el cargue.", errorType: 'INVALID_PHASE' };
            }

            const updatedBag = {
                ...bag,
                [statusField]: true,
                [timestampField]: Timestamp.now()
            };

            const updatedBags = { ...bags, [barcode]: updatedBag };
            transaction.update(opRef, { bags: updatedBags });
            
            return { success: true };
        });
        return result as any;
    } catch (error: any) {
        console.error("Error processing bag scan:", error);
        return { success: false, error: error.message };
    }
}

export async function updateBagOperationStatus(opId: string, status: 'cargue' | 'descargue' | 'completed'): Promise<{ success: boolean; error?: string }> {
    try {
        await updateDoc(doc(firestore, "bagOperations", opId), { status });
        return { success: true };
    } catch (error: any) {
        console.error("Error updating operation status:", error);
        return { success: false, error: error.message };
    }
}

export async function deleteBagOperation(opId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await deleteDoc(doc(firestore, "bagOperations", opId));
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting operation:", error);
        return { success: false, error: error.message };
    }
}

export async function resetBagState(opId: string, barcode: string, type: 'loaded' | 'discharged' | 'both'): Promise<{ success: boolean; error?: string }> {
    try {
        const opRef = doc(firestore, "bagOperations", opId);
        await runTransaction(firestore, async (transaction) => {
            const opDoc = await transaction.get(opRef);
            if (!opDoc.exists()) throw new Error("La operación no existe");

            const data = opDoc.data() as BagOperation;
            const bags = data.bags || {};
            
            if (!bags[barcode]) {
                throw new Error(`El código ${barcode} no existe en esta operación.`);
            }

            const bag = bags[barcode];
            const updatedBag = { ...bag };

            if (type === 'loaded' || type === 'both') {
                updatedBag.loaded = false;
                delete updatedBag.loadedAt;
            }
            if (type === 'discharged' || type === 'both') {
                updatedBag.discharged = false;
                delete updatedBag.dischargedAt;
            }

            const updatedBags = { ...bags, [barcode]: updatedBag };
            transaction.update(opRef, { bags: updatedBags });
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error resetting bag state:", error);
        return { success: false, error: error.message };
    }
}

export async function resetAllBags(opId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const opRef = doc(firestore, "bagOperations", opId);
        await runTransaction(firestore, async (transaction) => {
            const opDoc = await transaction.get(opRef);
            if (!opDoc.exists()) throw new Error("La operación no existe");

            const data = opDoc.data() as BagOperation;
            const bags = data.bags || {};
            
            const updatedBags: Record<string, BagItem> = {};
            for (const barcode in bags) {
                updatedBags[barcode] = {
                    ...bags[barcode],
                    loaded: false,
                    discharged: false
                };
                delete updatedBags[barcode].loadedAt;
                delete updatedBags[barcode].dischargedAt;
            }

            transaction.update(opRef, { bags: updatedBags });
        });
        return { success: true };
    } catch (error: any) {
        console.error("Error resetting all bags:", error);
        return { success: false, error: error.message };
    }
}

// ============================================================
// PROPUESTA TRANSPORTADORA — Actions
// ============================================================

export interface CarrierRateRow {
  codigoMunicipio: string;
  tipoTrayecto: string;
  flete: number;
  iva: number;
  margenLogisticaInversa: number;
  total: number;
}

export interface CarrierProposalRow {
  codigoMunicipio: string;
  municipio: string;
  departamento: string;
  tipoTrayecto: string;
  actual: { flete: number; iva: number; margenLogisticaInversa: number; total: number };
  propuesta: { flete: number; iva: number; margenLogisticaInversa: number; total: number };
  diferencia: number;
  diferenciaPct: number;
}

export interface CarrierProposal {
  id?: string;
  name: string;
  carrier: string;
  date: string;
  createdAt?: Date;
  createdBy?: string;
  summary: {
    totalMunicipios: number;
    ahorroTotal: number;
    incrementoTotal: number;
    municipiosConAhorro: number;
    municipiosConIncremento: number;
  };
  rows: CarrierProposalRow[];
}

export interface CarrierScoreConfig {
  criteriaWeights: {
    costo: number;
    calidad: number;
    novedades: number;
    cobertura: number;
    tiempoEntrega: number;
    soporte: number;
  };
  scores: {
    [carrier: string]: {
      costo: number;
      calidad: number;
      novedades: number;
      cobertura: number;
      tiempoEntrega: number;
      soporte: number;
    };
  };
}

/** Saves current carrier rates (with breakdown) to Firestore */
export async function saveCarrierCurrentRates(
    carrier: string,
    rates: CarrierRateRow[]
): Promise<{ success: boolean; error?: string; processedCount?: number }> {
    if (!carrier || !rates?.length) {
        return { success: false, error: 'Transportadora o tarifas no proporcionadas.' };
    }
    try {
        // Calculate total for each row before saving
        const ratesWithTotal = rates.map(r => ({
            ...r,
            total: (r.flete || 0) + (r.iva || 0) + (r.margenLogisticaInversa || 0),
        }));
        await setDoc(doc(firestore, 'carrierRates', carrier), {
            rates: ratesWithTotal,
            lastUpdated: Timestamp.now(),
        });
        return { success: true, processedCount: ratesWithTotal.length };
    } catch (error: any) {
        console.error('Error saving carrier rates:', error);
        return { success: false, error: error.message };
    }
}

/** Reads the current rates for a specific carrier */
export async function getCarrierCurrentRates(
    carrier: string
): Promise<{ success: boolean; data?: { rates: CarrierRateRow[]; lastUpdated?: Date }; error?: string }> {
    try {
        const snap = await getDoc(doc(firestore, 'carrierRates', carrier));
        if (!snap.exists()) return { success: true, data: { rates: [] } };
        const data = convertTimestampsToDates(snap.data());
        return { success: true, data: { rates: data.rates || [], lastUpdated: data.lastUpdated } };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Lists all carriers that have rates uploaded, with their last-updated date */
export async function getAllCarrierRatesMetadata(): Promise<{
    success: boolean;
    data?: { carrier: string; lastUpdated?: Date; count: number }[];
    error?: string;
}> {
    try {
        const querySnapshot = await getDocs(collection(firestore, 'carrierRates'));
        const metadata = querySnapshot.docs.map(d => {
            const data = convertTimestampsToDates(d.data());
            return {
                carrier: d.id,
                lastUpdated: data.lastUpdated,
                count: (data.rates || []).length,
            };
        });
        return { success: true, data: metadata };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Saves a full carrier rate proposal comparison to Firestore */
export async function saveCarrierProposal(
    proposal: Omit<CarrierProposal, 'id'>,
    userId: string
): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        const docRef = await addDoc(collection(firestore, 'carrierProposals'), {
            ...convertDatesToTimestamps(proposal),
            createdAt: Timestamp.now(),
            createdBy: userId,
        });
        return { success: true, id: docRef.id };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Returns a list of all saved proposals (without the full rows array for performance) */
export async function loadCarrierProposals(): Promise<{
    success: boolean;
    data?: (Omit<CarrierProposal, 'rows'> & { id: string })[];
    error?: string;
}> {
    try {
        const q = query(collection(firestore, 'carrierProposals'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        const proposals = snap.docs.map(d => {
            const data = convertTimestampsToDates(d.data());
            const { rows, ...rest } = data as CarrierProposal;
            return { id: d.id, ...rest };
        });
        return { success: true, data: proposals as any };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Returns the full detail of a single proposal including its rows */
export async function getCarrierProposalById(
    id: string
): Promise<{ success: boolean; data?: CarrierProposal; error?: string }> {
    try {
        const snap = await getDoc(doc(firestore, 'carrierProposals', id));
        if (!snap.exists()) return { success: false, error: 'Propuesta no encontrada.' };
        return { success: true, data: { id: snap.id, ...convertTimestampsToDates(snap.data()) } as CarrierProposal };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Saves the weighting criteria and per-carrier scores */
export async function saveCarrierScores(
    config: CarrierScoreConfig,
    userId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        await setDoc(doc(firestore, 'carrierScores', 'config'), {
            ...config,
            updatedAt: Timestamp.now(),
            updatedBy: userId,
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Reads the saved weighting configuration */
export async function getCarrierScores(): Promise<{
    success: boolean;
    data?: CarrierScoreConfig | null;
    error?: string;
}> {
    try {
        const snap = await getDoc(doc(firestore, 'carrierScores', 'config'));
        if (!snap.exists()) return { success: true, data: null };
        return { success: true, data: snap.data() as CarrierScoreConfig };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Returns all municipios as a lookup map keyed by codigo */
export async function getMunicipiosMap(): Promise<{
    success: boolean;
    data?: Record<string, { nombre: string; departamento: string }>;
    error?: string;
}> {
    try {
        const snap = await getDocs(collection(firestore, 'municipios'));
        const map: Record<string, { nombre: string; departamento: string }> = {};
        snap.docs.forEach(d => {
            const v = d.data();
            map[d.id] = { nombre: v.nombre || v.Municipio || d.id, departamento: v.departamento || v.Departamento || '' };
        });
        return { success: true, data: map };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Saves per-carrier insurance rate percentages (e.g. { Servientrega: 0.8, Coordinadora: 0.5 }) */
export async function saveCarrierInsuranceConfig(config: Record<string, number>): Promise<{ success: boolean; error?: string }> {
    try {
        await setDoc(doc(firestore, 'carrierConfig', 'insurance'), { rates: config, updatedAt: new Date() });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Reads per-carrier insurance rate percentages */
export async function getCarrierInsuranceConfig(): Promise<{ success: boolean; data?: Record<string, number>; error?: string }> {
    try {
        const snap = await getDoc(doc(firestore, 'carrierConfig', 'insurance'));
        if (!snap.exists()) return { success: true, data: {} };
        return { success: true, data: (snap.data().rates as Record<string, number>) || {} };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export interface CODTier {
  min: number;
  max: number;
  feeType: 'fixed' | 'percent';
  value: number;
}

export interface CODRule {
  type: 'simple' | 'tiered';
  percentage?: number;
  minFee?: number;
  tiers?: CODTier[];
}

/** Saves per-carrier COD fee rules */
export async function saveCarrierCODConfig(config: Record<string, CODRule>): Promise<{ success: boolean; error?: string }> {
    try {
        await setDoc(doc(firestore, 'carrierConfig', 'cod'), { rules: config, updatedAt: new Date() });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Reads per-carrier COD fee rules */
export async function getCarrierCODConfig(): Promise<{ success: boolean; data?: Record<string, CODRule>; error?: string }> {
    try {
        const snap = await getDoc(doc(firestore, 'carrierConfig', 'cod'));
        if (!snap.exists()) return { success: true, data: {} };
        return { success: true, data: (snap.data().rules as Record<string, CODRule>) || {} };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getAppVersion(): Promise<{ version: string | null; error?: string }> {
    try {
        const docRef = doc(firestore, 'app_metadata', 'current_version');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { version: docSnap.data().version };
        }
        return { version: null };
    } catch (error: any) {
        return { version: null, error: error.message };
    }
}

export async function updateAppVersion(newVersion: string): Promise<{ success: boolean; error?: string }> {
    try {
        await setDoc(doc(firestore, 'app_metadata', 'current_version'), {
            version: newVersion,
            updatedAt: Timestamp.now()
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// --- Operator Mappings (Packer Master) ---

export async function saveOperatorMappings(mappings: ManualOperatorMappings): Promise<{ success: boolean; error?: string }> {
    try {
        const batch = writeBatch(firestore);
        const colRef = collection(firestore, 'operator_mappings');

        for (const [id, name] of Object.entries(mappings)) {
            const docRef = doc(colRef, id); // Use ID (cedula) as document ID
            batch.set(docRef, { id, name, updatedAt: Timestamp.now() }, { merge: true });
        }

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error("Error saving operator mappings:", error);
        return { success: false, error: error.message };
    }
}

export async function loadOperatorMappings(): Promise<{ data?: ManualOperatorMappings; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, 'operator_mappings'));
        const mappings: ManualOperatorMappings = {};
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            mappings[data.id] = data.name;
        });
        return { data: mappings };
    } catch (error: any) {
        console.error("Error loading operator mappings:", error);
        return { error: error.message };
    }
}


// --- External Services Conciliation Actions ---

export async function saveExternalServiceRows(rows: ExternalServiceRow[]): Promise<{ success: boolean; data?: { uploaded: number, skipped: number }, error?: string }> {
    try {
        const colRef = collection(firestore, 'externalServices');
        let uploaded = 0;
        let skipped = 0;

        const CHUNK_SIZE = 450;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            
            for (const row of chunk) {
                // Use duplicateHash as document ID to naturally prevent duplicates
                const docRef = doc(colRef, row.duplicateHash);
                const snap = await getDoc(docRef);
                if (!snap.exists()) {
                    batch.set(docRef, convertDatesToTimestamps({ ...row, id: docRef.id, createdAt: new Date() }));
                    uploaded++;
                } else {
                    skipped++;
                }
            }
            await batch.commit();
        }
        return { success: true, data: { uploaded, skipped } };
    } catch (e: any) {
        console.error("Error saving external services:", e);
        return { success: false, error: e.message };
    }
}

export async function getExternalServiceRows(): Promise<{ success: boolean; data?: ExternalServiceRow[]; error?: string }> {
    try {
        const q = query(collection(firestore, 'externalServices'), orderBy('fechaServicio', 'desc'), limit(1000));
        const querySnapshot = await getDocs(q);
        const rows = querySnapshot.docs.map(doc => convertTimestampsToDates({ id: doc.id, ...doc.data() }) as ExternalServiceRow);
        
        console.log(`FETCHED ${rows.length} EXTERNAL SERVICES. Sample: manual items count: ${rows.filter(r => r.id.includes('manual')).length}`);
        
        return { success: true, data: rows };
    } catch (e: any) {
        console.error("Error loading external services:", e);
        return { success: false, error: e.message };
    }
}

export async function updateExternalServiceRow(id: string, updates: Partial<ExternalServiceRow>): Promise<{ success: boolean; error?: string }> {
    try {
        const docRef = doc(firestore, 'externalServices', id);
        await updateDoc(docRef, convertDatesToTimestamps(updates));
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function saveServiceRates(rates: ServiceRate[]): Promise<{ success: boolean; error?: string }> {
    try {
        const batch = writeBatch(firestore);
        const colRef = collection(firestore, 'externalServiceRates');
        
        for (const rate of rates) {
            // Identifier for rate: provider + service
            const rateId = `${rate.provider}_${rate.service}`.toUpperCase().replace(/\s+/g, '_');
            const docRef = doc(colRef, rateId);
            batch.set(docRef, rate, { merge: true });
        }
        await batch.commit();
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getServiceRates(): Promise<{ success: boolean; data?: ServiceRate[]; error?: string }> {
    try {
        const querySnapshot = await getDocs(collection(firestore, 'externalServiceRates'));
        const rates = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceRate));
        return { success: true, data: rates };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

