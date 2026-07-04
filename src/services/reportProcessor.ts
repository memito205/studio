import { RemisionEntry, PackerProductivity, ProcessedReportData, HourlyProductivity, BrandProductivity, ProductCategory, ProductTypeProductivity, ProductivityGoals, BrandProductTypeGoals, BrandPackerBreakdown, DeadTimeEntry, PackerBrandProductivityDetail, DetectedBreakDetail, DeadTimeSummaryEntry, PackerHourlyPerformance, ManualProductClassifications, ManualJustifications, JustificationType, UniqueReference, ImportedBrandCatalogItem, ReferenceCorrections, ManualOperatorMappings, IncidentLogEntry, ProductDatabaseItem, DiscardedRecord, ProductTypePackerBreakdown, HourlyOperatorDetail, OperationPulse, PackerReferenceProductivityDetail, ReferenceGoals } from '@/types';
import { parseFlexibleDate, excelSerialDateToJSDate, normalizeBarcode } from '@/lib/parsingUtils';

// Mapeo de columnas para reconocer diferentes variaciones de los encabezados del archivo.
const COLUMN_MAP: { [key: string]: keyof Omit<RemisionEntry, 'fechaDeLectura' | 'productType'> } = {
  'orden': 'orden',
  'unidad de empaque': 'unidadDeEmpaque',
  'unidad empaque': 'unidadDeEmpaque',
  'empacador': 'empacador',
  'empacado': 'empacador',
  'referencia': 'referencia',
  'descripción': 'descripcion',
  'descripcion': 'descripcion',
  'codigo barras': 'codigoBarras',
  'talla': 'talla',
  'cantidad': 'cantidad',
  'marca': 'marca',
  'item': 'descripcion', // Mapear la columna 'Item' del excel a 'descripcion'
  'grupo': 'grupo',
};

// MAPA DE OPERARIOS CORREGIDO
const OPERATOR_MAP: { [key: string]: string } = {
    '8201381': 'EDWAR RANGEL',
    '71527331': 'VICTOR HUGO RESTREPO ARIAS',
    '1077459024': 'JHON JAMER CORDOBA CORDOBA',
    '1128447226': 'ABEL FELIPE TRUJILLO DAVID',
    '71362552': 'JORGE DE JESUS AVALOS ALVAREZ',
    '71362558': 'ARLEY GABRIEL GIRALDO VELEZ',
    '71394273': 'ARLEY GABRIEL GIRALDO VELEZ',
    '1020475704': 'YULIETH ANDREA HIGUITA',
    '1035443336': 'ADRIAN MONTOYA ECHAVARRIA',
    '98620499': 'ADRIAN MONTOYA ECHAVARRIA',
    '13174424': 'CARLOS MARIO CHALARCA ACOSTA',
    'AVELINO MOSQUERA PALACIOS': 'AVELINO MOSQUERA PALACIOS',
    '1002425744': 'OBED SAUCEDO CONTRERAS',
    '10002425744': 'OBED SAUCEDO CONTRERAS',
    '71494450': 'HECTOR MAURICIO DIOSA CASTAÑO',
    '43206404': 'LINA MARIA TOBON SANCHEZ',
};

// NUEVO MAPA DE CÓDIGOS DE MARCA
const BRAND_CODE_MAP: { [code: string]: string } = {
    'AD': 'ADIDAS',
    'CV': 'CONVERSE',
    'SK': 'SKECHERS',
    'PU': 'PUMA',
    'PM': 'PUMA',
    'RB': 'REEBOK',
    'NB': 'NEW BALANCE',
    'DC': 'DC',
    'TM': 'TIMBERLAND',
    'VA': 'VANS',
    'NK': 'NIKE',
    'FL': 'FILA',
    'TR': 'TREME',
};

// Función para parsear HH:MM a un objeto Date en el contexto de una fecha dada.
export const parseTime = (timeStr: string, date: Date): Date => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const newDate = new Date(date);
  // Use setHours to respect local timezone, matching browser behavior.
  newDate.setHours(hours, minutes, 0, 0);
  return newDate;
};


// 1. LIMPIEZA Y PRE-PROCESAMIENTO DE DATOS
// ===============================================

function standardizeData(
    rawData: any[],
    manualOperatorMappings: ManualOperatorMappings
): (Omit<RemisionEntry, 'productType' | 'fechaDeLectura' | 'marca'> & { [key: string]: any })[] {
    const combinedOperatorMap = { ...OPERATOR_MAP, ...manualOperatorMappings };

    return rawData.map(row => {
        const newRow: { [key: string]: any } = {};
        for (const key in row) {
            // Do not process date column here, pass it through as is
            if(key.toLowerCase().trim() === 'fecha lectura' || key.toLowerCase().trim() === 'fechalectura' || key === 'fechaDeLectura') {
                newRow['fechaDeLectura'] = row[key];
                continue;
            }

            const lowerKey = key.toLowerCase().trim();
            const mappedKey = COLUMN_MAP[lowerKey];
            if (mappedKey) {
                newRow[mappedKey] = row[key];
            } else {
                newRow[key] = row[key];
            }
        }

        const empacador = String(newRow.empacador || '').trim();
        // Check if it's an ID (key) or already a Name (value)
        const isAlreadyName = Object.values(combinedOperatorMap).includes(empacador);
        newRow.empacador = isAlreadyName ? empacador : (combinedOperatorMap[empacador] || empacador).trim();
        newRow.cantidad = typeof newRow.cantidad === 'number' ? newRow.cantidad : 1;
        newRow.codigoBarras = normalizeBarcode(newRow.codigoBarras);
        newRow.descripcion = String(newRow.descripcion || '').trim();
        newRow.referencia = String(newRow.referencia || '').trim();
        
        // La marca se asignará en el siguiente paso después de las correcciones.
        newRow.marca = String(newRow.marca || '').trim();
        
        newRow.grupo = String(newRow.grupo || '').trim();

        newRow.talla = (newRow.talla !== undefined && newRow.talla !== null ? String(newRow.talla) : '').trim();
        newRow.orden = String(newRow.orden || '').trim();
        newRow.unidadDeEmpaque = String(newRow.unidadDeEmpaque || '').trim();

        return newRow;
    }).filter(Boolean) as any[];
}


/**
 * Función auxiliar que centraliza la lógica de inferir marca y tipo de producto desde una descripción.
 */
function inferClassificationFromDescription(description: string, originalBrand: string, originalGroup: string): { brand: string, productType: ProductCategory } {
    const descUpper = description.toUpperCase().trim();
    let brand: string = 'SIN MARCA';
    let productType: ProductCategory = 'NO CLASIFICADO';

    // Inferencia de Marca desde el código de 2 letras
    if (descUpper.length >= 2) {
        const brandCode = descUpper.substring(0, 2);
        if (BRAND_CODE_MAP[brandCode]) {
            brand = BRAND_CODE_MAP[brandCode];
        }
    }
    // Si no se encuentra un código, se usa la marca original si existe
    if (brand === 'SIN MARCA' && originalBrand) {
        brand = originalBrand.toUpperCase().trim();
    }
    
    // Inferencia de Tipo de Producto por palabras clave
    if (descUpper.includes('CALZADO') || descUpper.includes('TENIS') || descUpper.includes('ZAPATO') || descUpper.includes('BOTA') || descUpper.includes('GUAYOS') || descUpper.includes('SANDALIA') || descUpper.includes('SANDALIAS')) {
        productType = 'CALZADO';
    } else if (descUpper.includes('ROPA') || descUpper.includes('CAMISETA') || descUpper.includes('PANTALON') || descUpper.includes('CHAQUETA') || descUpper.includes('SUDADERA') || descUpper.includes('BUZO') || descUpper.includes('CAMIBUZO') || descUpper.includes('PANTALONETA') || descUpper.includes('LICRA')) {
        productType = 'ROPA';
    } else if (descUpper.includes('ACCESORIOS') || descUpper.includes('GORRA') || descUpper.includes('MEDIAS') || descUpper.includes('BOLSO') || descUpper.includes('MALETIN') || descUpper.includes('BALON') || descUpper.includes('GUANTES')) {
        productType = 'ACCESORIOS';
    }

    // Si no se encuentra por palabra clave, usar el grupo original si es válido
    if (productType === 'NO CLASIFICADO' && originalGroup && ['CALZADO', 'ROPA', 'ACCESORIOS'].includes(originalGroup.toUpperCase())) {
        productType = originalGroup.toUpperCase() as ProductCategory;
    }

    return { brand, productType };
}

export function buildProductLookupMap(products: ProductDatabaseItem[]): Map<string, ProductDatabaseItem> {
    const map = new Map<string, ProductDatabaseItem>();
    products.forEach((product) => {
        const key = normalizeBarcode(product.codigoBarras || product.id);
        if (key) map.set(key, product);
    });
    return map;
}

function lookupProductFromMap(
    productMap: Map<string, ProductDatabaseItem>,
    codigoBarras: string
): ProductDatabaseItem | undefined {
    const key = normalizeBarcode(codigoBarras);
    return key ? productMap.get(key) : undefined;
}

function catalogReference(dbProduct: ProductDatabaseItem): string {
    return String(dbProduct.referencia || dbProduct.reference || '').trim();
}

function catalogDescription(dbProduct: ProductDatabaseItem): string {
    return String(dbProduct.item || dbProduct.description || dbProduct.name || '').trim();
}

function isPlaceholderBrand(marca: string | undefined | null): boolean {
    const value = String(marca || '').trim().toUpperCase();
    return !value || value === 'IMPORTADA' || value === 'SIN MARCA' || value === 'NULL' || value === 'UNDEFINED';
}

/**
 * Marca comercial del catálogo.
 * No usa merchandise_type: en recepción ese campo suele ser la categoría (ej. IMPORTADA), no la marca.
 * IMPORTADA se trata como vacío para permitir inferencia desde la descripción.
 */
function catalogMarca(dbProduct: ProductDatabaseItem): string {
    const marca = String(dbProduct.marca || '').trim().toUpperCase();
    return isPlaceholderBrand(marca) ? '' : marca;
}

function catalogGrupo(dbProduct: ProductDatabaseItem): string {
    return String(dbProduct.grupo || dbProduct.location || '').trim().toUpperCase();
}

/** Completa referencia, descripción, marca y grupo vacíos del Excel con datos del catálogo maestro. */
export function enrichEntryFromCatalog(
    entry: RemisionEntry,
    productMap: Map<string, ProductDatabaseItem>
): RemisionEntry {
    const dbProduct = lookupProductFromMap(productMap, entry.codigoBarras);
    if (!dbProduct) return entry;

    return {
        ...entry,
        referencia: entry.referencia?.trim() || catalogReference(dbProduct),
        descripcion: entry.descripcion?.trim() || catalogDescription(dbProduct),
        marca: entry.marca?.trim() || catalogMarca(dbProduct),
        grupo: entry.grupo?.trim() || catalogGrupo(dbProduct),
        talla: entry.talla?.trim() || String(dbProduct.talla || dbProduct.size || '').trim() || entry.talla,
    };
}

export function classifyProduct(
    entry: Omit<RemisionEntry, 'productType'>,
    manualClassifications: ManualProductClassifications,
    referenceCorrections: ReferenceCorrections,
    productMap: Map<string, ProductDatabaseItem>
): { productType: ProductCategory; brand: string; finalDescription: string; finalReference: string } {
    const { codigoBarras, talla, descripcion: originalDescription, grupo, marca: originalMarca, referencia: originalReference } = entry;
    
    const dbProduct = lookupProductFromMap(productMap, codigoBarras);
    const correctionKey = talla !== undefined && talla !== '' ? `${normalizeBarcode(codigoBarras)}|${talla}` : normalizeBarcode(codigoBarras);
    const correction = referenceCorrections[correctionKey];

    const referenceToUse =
        correction?.newReferencia?.trim() ||
        originalReference?.trim() ||
        (dbProduct ? catalogReference(dbProduct) : '');
    const descriptionToUse =
        correction?.newDescripcion?.trim() ||
        originalDescription?.trim() ||
        (dbProduct ? catalogDescription(dbProduct) : '');

    const dbGrupo = dbProduct ? catalogGrupo(dbProduct) : '';
    const dbMarca = dbProduct ? catalogMarca(dbProduct) : '';

    // Catálogo completo: marca + grupo válidos
    if (dbGrupo && dbMarca && ['CALZADO', 'ROPA', 'ACCESORIOS'].includes(dbGrupo)) {
        return {
            productType: dbGrupo as ProductCategory,
            brand: dbMarca,
            finalDescription: descriptionToUse,
            finalReference: referenceToUse,
        };
    }

    // Catálogo parcial o inferencia desde descripción enriquecida
    let { brand, productType } = inferClassificationFromDescription(
        descriptionToUse,
        dbMarca || originalMarca,
        dbGrupo || grupo || ''
    );

    if (dbGrupo && ['CALZADO', 'ROPA', 'ACCESORIOS'].includes(dbGrupo)) {
        productType = dbGrupo as ProductCategory;
    }
    if (dbMarca) {
        brand = dbMarca;
    }
    
    const termToAnalyze = descriptionToUse.toUpperCase().substring(3).trim().split(' ')[0];
    const manualClass = termToAnalyze ? manualClassifications[termToAnalyze] : undefined;
    
    if (manualClass) {
        if (manualClass.brand) brand = manualClass.brand;
        if (manualClass.productType) productType = manualClass.productType;
    }
    
    return { productType, brand, finalDescription: descriptionToUse, finalReference: referenceToUse };
}


export function getSanitizedData(
    rawData: any[],
    reportDateStr: string,
    manualOperatorMappings: ManualOperatorMappings
): { sanitizedData: RemisionEntry[], discardedRecords: DiscardedRecord[] } {
    
    const discardedRecords: DiscardedRecord[] = [];
    
    const fechaKey = rawData.length > 0 ? Object.keys(rawData[0]).find(k => k.toLowerCase().trim() === 'fecha lectura' || k.toLowerCase().trim() === 'fechalectura') : undefined;

    if (!fechaKey) {
      rawData.forEach(row => discardedRecords.push({ reason: 'No se encontró la columna "FECHA LECTURA"', rowData: row }));
      return { sanitizedData: [], discardedRecords };
    }
    
    const keptRecords: any[] = [];
    const reportDateToCompare = parseFlexibleDate(reportDateStr);

    if (!reportDateToCompare) {
        rawData.forEach(row => discardedRecords.push({ reason: 'Fecha del reporte inválida', rowData: row }));
        return { sanitizedData: [], discardedRecords };
    }

    rawData.forEach(row => {
        const rowDateValue = row[fechaKey];
        if (rowDateValue === undefined || rowDateValue === null) {
            discardedRecords.push({ reason: `Valor de fecha vacío o nulo`, rowData: row });
            return;
        }
        
        // This function now handles Date objects and strings robustly
        const rowDate = parseFlexibleDate(rowDateValue);

        if (!rowDate || isNaN(rowDate.getTime())) {
            discardedRecords.push({ reason: `Formato de fecha inválido: "${rowDateValue}"`, rowData: row });
            return;
        }
        
        // Allow any valid date to pass through. 
        // We will filter by the user-selected reportDate later in processReport.
        keptRecords.push({ ...row, fechaDeLectura: rowDate });
    });

    const standardizedKeptData = standardizeData(keptRecords, manualOperatorMappings);
    
    const mappedAndFilteredData: RemisionEntry[] = [];

    standardizedKeptData.forEach(row => {
        const fechaDeLectura = row.fechaDeLectura;
        
        const unidadEmpaque = String(row.unidadDeEmpaque || '').toUpperCase();
        if (unidadEmpaque.startsWith('EVI') || unidadEmpaque.startsWith('INT')) {
            discardedRecords.push({ reason: `Unidad de empaque filtrada: ${unidadEmpaque}`, rowData: row });
        } else {
            mappedAndFilteredData.push({
                ...row,
                fechaDeLectura,
            } as RemisionEntry);
        }
    });

    return { sanitizedData: mappedAndFilteredData, discardedRecords };
}


// 2. DETECCIÓN Y PROCESAMIENTO DE INACTIVIDAD
// ===============================================

function detectAllPauses(
    data: RemisionEntry[],
    reportStartTime: Date,
    reportEndTime: Date
): DeadTimeEntry[] {
    const deadTimes: DeadTimeEntry[] = [];
    const entriesByPacker = data.reduce((acc, entry) => {
        if (!acc[entry.empacador]) acc[entry.empacador] = [];
        acc[entry.empacador].push(entry);
        return acc;
    }, {} as { [key: string]: RemisionEntry[] });

    for (const packerName in entriesByPacker) {
        const sortedEntries = entriesByPacker[packerName].map(e => ({
            ...e
        }))
        .filter(e => e.fechaDeLectura && !isNaN(e.fechaDeLectura.getTime()))
        .sort((a, b) => a.fechaDeLectura!.getTime() - b.fechaDeLectura!.getTime());

        if (sortedEntries.length === 0) continue;
        
        // Pausas intermedias: Entre escaneos consecutivos
        for (let i = 0; i < sortedEntries.length - 1; i++) {
            const timeDiff = (sortedEntries[i + 1].fechaDeLectura!.getTime() - sortedEntries[i].fechaDeLectura!.getTime()) / 60000;
            if (timeDiff >= 1) {
                deadTimes.push({
                    id: `${packerName}-${sortedEntries[i].fechaDeLectura!.getTime()}`,
                    packerName,
                    startTime: sortedEntries[i].fechaDeLectura!,
                    endTime: sortedEntries[i + 1].fechaDeLectura!,
                    duration: Math.round(timeDiff),
                    status: 'No Justificado',
                });
            }
        }

        // Pausa Final: Desde el último escaneo hasta el fin del reporte
        const lastScanTime = sortedEntries[sortedEntries.length - 1].fechaDeLectura!;
        if (lastScanTime < reportEndTime) {
            const finalDiff = (reportEndTime.getTime() - lastScanTime.getTime()) / 60000;
            if (finalDiff >= 1) {
                deadTimes.push({
                    id: `${packerName}-final-${lastScanTime.getTime()}`,
                    packerName,
                    startTime: lastScanTime,
                    endTime: reportEndTime,
                    duration: Math.round(finalDiff),
                    status: 'No Justificado',
                });
            }
        }
    }
    return deadTimes;
}


function breakTypeSpanish(type: JustificationType): string {
    switch (type) {
        case 'BREAKFAST': return 'Desayuno';
        case 'LUNCH': return 'Almuerzo';
        case 'SNACK': return 'Refrigerio';
        default: return String(type);
    }
}

function toHHmm(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

/** Pulses elegibles para el módulo de empaque (suite): no mezclar con mayoristas/recepción. */
function filterPulsesForPackingRemision(operationPulses: OperationPulse[]): OperationPulse[] {
    return operationPulses.filter(p => {
        if (p.moduleContext === 'wholesale' || p.moduleContext === 'reception') return false;
        if (p.isGlobal) return true;
        if (p.metadata?.fromModule === 'Remisión') return true;
        // Retrocompat: sesiones de remisión antes de metadata explícita
        if (p.status === 'En Remisión' && p.type === 'status_change') return true;
        return false;
    });
}

function normalizeMatchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function extractTimestampFromJustificationKey(key: string): number | null {
  const match = key.match(/(\d{10,14})(?:-[\w-]+)?$/);
  if (!match) return null;
  const raw = match[1];
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  // Legacy keys may store seconds (10 digits) instead of milliseconds.
  return raw.length <= 10 ? parsed * 1000 : parsed;
}

function extractNamePartFromJustificationKey(key: string): string {
  return normalizeMatchText(key.replace(/-?\d{10,14}(?:-[\w-]+)?$/, ''));
}

function namesLikelyMatch(candidateFromKey: string, incidentName: string): boolean {
  const keyName = normalizeMatchText(candidateFromKey);
  const currentName = normalizeMatchText(incidentName);
  if (!keyName || !currentName) return false;
  if (keyName === currentName) return true;

  const mappedNameFromKey = normalizeMatchText(OPERATOR_MAP[keyName] || '');
  if (mappedNameFromKey && mappedNameFromKey === currentName) return true;

  const mappedCurrentName = normalizeMatchText(OPERATOR_MAP[currentName] || '');
  if (mappedCurrentName && mappedCurrentName === keyName) return true;

  const keyWords = keyName.split(/\s+/).filter((p) => p.length > 2);
  const currentWords = currentName.split(/\s+/).filter((p) => p.length > 2);
  if (keyWords.length === 0 || currentWords.length === 0) return false;
  const overlap = keyWords.filter((w) => currentWords.includes(w)).length;
  return overlap >= Math.min(2, Math.min(keyWords.length, currentWords.length));
}

function findMatchingJustificationKey(
  incident: DeadTimeEntry,
  justifications: ManualJustifications
): string | undefined {
  const timestamp = incident.startTime.getTime();
  const incidentName = incident.packerName;
  return Object.keys(justifications).find((key) => {
    const keyTs = extractTimestampFromJustificationKey(key);
    if (keyTs == null) return false;
    if (Math.abs(keyTs - timestamp) > 120000) return false;
    const keyNamePart = extractNamePartFromJustificationKey(key);
    return namesLikelyMatch(keyNamePart, incidentName);
  });
}

export function applyJustifications(
  incidents: DeadTimeEntry[],
  justifications: ManualJustifications,
  operationPulses: OperationPulse[] = []
): DeadTimeEntry[] {
    const finalIncidents: DeadTimeEntry[] = [];
    const processQueue = [...incidents];
    const processedIds = new Set<string>();

    const packingPulses = filterPulsesForPackingRemision(operationPulses);

    const breakDurations: { [key in JustificationType]?: number } = {
        BREAKFAST: 15,
        LUNCH: 30,
        SNACK: 15,
    };

    const packerBreakUsage = new Map<string, Set<JustificationType>>();

    // Initial pass to find all break justifications to avoid double-counting
    processQueue.forEach(incident => {
        const justification = justifications[incident.id];
        if (justification && ['BREAKFAST', 'LUNCH', 'SNACK'].includes(justification.type)) {
            if (!packerBreakUsage.has(incident.packerName)) {
                packerBreakUsage.set(incident.packerName, new Set());
            }
            // Temporarily add, will be confirmed during processing
            packerBreakUsage.get(incident.packerName)!.add(justification.type as JustificationType);
        }
    });
    
    // Clear and rebuild usage map during actual processing to prevent race conditions
    packerBreakUsage.clear();

    while (processQueue.length > 0) {
        const incident = processQueue.shift()!;

        if (processedIds.has(incident.id)) {
            continue;
        }
        processedIds.add(incident.id);
        
        let justification = justifications[incident.id];
        
        // --- Robust Matching Fallback ---
        if (!justification) {
            // 1. Try ISO-based ID (legacy fallback)
            const timestamp = incident.startTime.getTime();
            const isoId = incident.id.replace(/-?\d+$/, () => new Date(timestamp).toISOString());
            justification = justifications[isoId];

            // 2. If still not found, try Fuzzy Search by Timestamp (allow 2-min jitter)
            if (!justification) {
                const matchingKey = findMatchingJustificationKey(incident, justifications);
                
                if (matchingKey) {
                    justification = justifications[matchingKey];
                }
            }
        }

        if (justification?.type === 'PULSE_IGNORE') {
            finalIncidents.push({ ...incident, status: 'No Justificado', justification: undefined });
            continue;
        }
        
        // --- Pulse Sync Logic ---
        // Si no hay justificación manual, alinear con pulsos de Remisión / pausa global (no otros módulos).
        if (!justification) {
            const incidentStart = incident.startTime.getTime();
            const incidentEnd = incident.endTime.getTime();
            const pulseMatch = packingPulses
                .map(p => {
                    if (!p.isGlobal && !namesLikelyMatch(String(p.userName || ''), incident.packerName)) return null;
                    if (p.type === 'status_change' && p.status === 'En Remisión') return null;

                    const pulseStart = p.startTime.getTime();
                    const pulseEnd = p.endTime?.getTime() || Date.now();
                    const overlapStart = Math.max(pulseStart, incidentStart);
                    const overlapEnd = Math.min(pulseEnd, incidentEnd);
                    const overlapMs = overlapEnd - overlapStart;
                    if (overlapMs < 60000) return null;

                    return {
                        pulse: p,
                        overlapStart,
                        overlapEnd,
                        overlapMs,
                    };
                })
                .filter(Boolean)
                .sort((a, b) => {
                    // Prefer the pulse that best explains the incident (largest overlap).
                    if (b!.overlapMs !== a!.overlapMs) return b!.overlapMs - a!.overlapMs;
                    return a!.overlapStart - b!.overlapStart;
                })[0];

            if (pulseMatch) {
                const pulse = pulseMatch.pulse;
                let type: JustificationType = 'REASON';
                const rawReason = [pulse.justification, pulse.reason, pulse.details]
                    .find(v => v != null && String(v).trim() !== '');
                const baseReason = rawReason != null ? String(rawReason).trim() : '';
                const rl = baseReason.toLowerCase();

                if (rl.startsWith('desayuno')) type = 'BREAKFAST';
                else if (rl.startsWith('almuerzo')) type = 'LUNCH';
                else if (rl.startsWith('refrigerio')) type = 'SNACK';
                else if (rl.includes('fin de turno')) type = 'SHIFT_END';

                let displayReason = baseReason || 'Registro sincronizado';
                if (pulse.isGlobal) displayReason = `[Global] ${displayReason}`;
                else if (pulse.metadata?.fromModule === 'Remisión') displayReason = `[Remisión] ${displayReason}`;
                else displayReason = `[Pulso] ${displayReason}`;
                
                justification = {
                    type,
                    reasonText: displayReason,
                };

                // For non-break reasons, align justification strictly to the real pulse overlap.
                // This avoids auto-justifying the entire dead-time block when only a segment matches.
                if (type === 'REASON') {
                    justification.startTime = toHHmm(new Date(pulseMatch.overlapStart));
                    justification.endTime = toHHmm(new Date(pulseMatch.overlapEnd));
                }
            }
        }
        // --- End Pulse Sync Logic ---

        if (!justification) {
            incident.status = 'No Justificado';
            finalIncidents.push(incident);
            continue;
        }

        const handleSplit = (justifiedPart: DeadTimeEntry, remainingPart?: DeadTimeEntry) => {
            finalIncidents.push(justifiedPart);
            if (remainingPart && remainingPart.duration > 0) {
                processQueue.unshift(remainingPart); // Add remaining to front of queue to be processed next
            }
        };
        
        if (justification.type === 'REASON') {
            // Check for explicit time range
            if (justification.startTime && justification.endTime) {
                const [startH, startM] = justification.startTime.split(':').map(Number);
                const [endH, endM] = justification.endTime.split(':').map(Number);
                
                const jStart = new Date(incident.startTime);
                jStart.setHours(startH, startM, 0, 0);
                
                const jEnd = new Date(incident.startTime);
                jEnd.setHours(endH, endM, 0, 0);

                // Handle range that crosses midnight (unlikely for dead time but good for robustness)
                if (jEnd < jStart) jEnd.setDate(jEnd.getDate() + 1);

                // Intersection of incident [incident.startTime, incident.endTime] and [jStart, jEnd]
                const overlapStart = Math.max(incident.startTime.getTime(), jStart.getTime());
                const overlapEnd = Math.min(incident.endTime.getTime(), jEnd.getTime());
                const isPulseSyncedReason = /^\[(?:Pulso|Remisión|Global)\]/i.test(justification.reasonText || '');

                if (overlapEnd > overlapStart) {
                    // 1. Part before the justified range
                    if (overlapStart > incident.startTime.getTime()) {
                        const preSegment: DeadTimeEntry = {
                            ...incident,
                            id: `${incident.id}-pre`,
                            endTime: new Date(overlapStart),
                            duration: Math.round((overlapStart - incident.startTime.getTime()) / 60000),
                            status: 'No Justificado',
                            justification: undefined
                        };
                        if (isPulseSyncedReason) {
                            // Keep splitting synced pulse windows on both sides of the block.
                            processQueue.unshift(preSegment);
                        } else {
                            finalIncidents.push(preSegment);
                        }
                    }

                    // 2. The justified part
                    finalIncidents.push({
                        ...incident,
                        id: `${incident.id}-justified`,
                        startTime: new Date(overlapStart),
                        endTime: new Date(overlapEnd),
                        duration: Math.round((overlapEnd - overlapStart) / 60000),
                        status: 'Justificado',
                        justification: justification.reasonText || 'Razón especificada'
                    });

                    // 3. Part after the justified range
                    if (overlapEnd < incident.endTime.getTime()) {
                        processQueue.unshift({
                            ...incident,
                            id: `${incident.id}-post`,
                            startTime: new Date(overlapEnd),
                            duration: Math.round((incident.endTime.getTime() - overlapEnd) / 60000),
                            status: 'No Justificado',
                            justification: undefined
                        });
                    }
                } else {
                    // No overlap found, treat as unjustified
                    finalIncidents.push({ ...incident, status: 'No Justificado' });
                }
            } else {
                // Fallback to duration-based justification
                const justifiedDuration = justification.customDuration ?? incident.duration;
                const justifiedEndTime = new Date(incident.startTime.getTime() + justifiedDuration * 60000);
                
                const justifiedPart: DeadTimeEntry = {
                    ...incident,
                    id: `${incident.id}-justified`,
                    endTime: justifiedEndTime,
                    duration: Math.round(justifiedDuration),
                    status: 'Justificado',
                    justification: justification.reasonText || 'Razón especificada',
                };

                const remainingPart: DeadTimeEntry | undefined = justifiedDuration < incident.duration ? {
                    ...incident,
                    id: `${incident.id}-remains`,
                    startTime: justifiedEndTime,
                    duration: Math.round(incident.duration - justifiedDuration),
                    status: 'No Justificado',
                    justification: undefined,
                } : undefined;

                handleSplit(justifiedPart, remainingPart);
            }

        } else if (['BREAKFAST', 'LUNCH', 'SNACK'].includes(justification.type)) {
            if (!packerBreakUsage.has(incident.packerName)) {
                packerBreakUsage.set(incident.packerName, new Set());
            }

            const isPulseSyncedBreak = /^\[(?:Pulso|Remisión|Global)\]/i.test(justification.reasonText || '');
            const breakAlreadyUsed = packerBreakUsage.get(incident.packerName)!.has(justification.type);

            if (breakAlreadyUsed && isPulseSyncedBreak) {
                finalIncidents.push({
                    ...incident,
                    status: 'No Justificado',
                    justification: `Intento de usar ${breakTypeSpanish(justification.type)} de nuevo`,
                });
            } else {
                // Manual assignment has priority: when user classifies a break explicitly, keep it justified.
                packerBreakUsage.get(incident.packerName)!.add(justification.type);
                const breakDuration = breakDurations[justification.type]!;
                const justifiedDuration = Math.min(incident.duration, breakDuration);
                const justifiedEndTime = new Date(incident.startTime.getTime() + justifiedDuration * 60000);

                const breakLabel = breakTypeSpanish(justification.type);
                const justifiedPart: DeadTimeEntry = {
                    ...incident,
                    id: `${incident.id}-justified`,
                    endTime: justifiedEndTime,
                    duration: Math.round(justifiedDuration),
                    status: 'Justificado',
                    justification: justification.reasonText || `Descanso: ${breakLabel}`,
                };

                const remainingPart: DeadTimeEntry | undefined = justifiedDuration < incident.duration ? {
                    ...incident,
                    id: `${incident.id}-excess`, // Unique ID for excess
                    startTime: justifiedEndTime,
                    duration: Math.round(incident.duration - justifiedDuration),
                    status: 'Excedente de Descanso',
                    justification: `Excedente de ${breakLabel}`,
                } : undefined;
                
                handleSplit(justifiedPart, remainingPart);
            }
        } else if (justification.type === 'SHIFT_END') {
            finalIncidents.push({
                ...incident,
                status: 'Justificado',
                justification: justification.reasonText || 'Fin de Turno / Salida'
            });
        } else {
            // UNJUSTIFIED or other types
            incident.status = 'No Justificado';
            finalIncidents.push(incident);
        }
    }

    return finalIncidents;
}

/**
 * Claves de `manualJustifications` que el motor asociaría a este tramo (id del card, id base tras split,
 * variante ISO legacy o coincidencia fuzzy por tiempo + operario). Útil para borrar un desayuno guardado
 * bajo una clave distinta a `incident.id`.
 */
export function findManualJustificationKeysForDeadTime(
  incident: DeadTimeEntry,
  justifications: ManualJustifications
): string[] {
  const keys = new Set<string>();
  const addIfPresent = (k: string) => {
    if (Object.prototype.hasOwnProperty.call(justifications, k)) keys.add(k);
  };

  addIfPresent(incident.id);

  const timestamp = incident.startTime.getTime();
  const isoId = incident.id.replace(/-?\d+$/, () => new Date(timestamp).toISOString());
  addIfPresent(isoId);

  const baseId = incident.id.replace(/-(justified|excess|remains|pre|post)$/i, '');
  if (baseId !== incident.id) addIfPresent(baseId);

  const currentName = incident.packerName.toUpperCase();

  for (const key of Object.keys(justifications)) {
    if (keys.has(key)) continue;
    const keyTs = extractTimestampFromJustificationKey(key);
    if (keyTs == null || Math.abs(keyTs - timestamp) > 120000) continue;
    const namePartFromKey = extractNamePartFromJustificationKey(key);
    if (namesLikelyMatch(namePartFromKey, currentName)) keys.add(key);
  }

  return [...keys];
}

export function preProcessDeadTimes(
    data: RemisionEntry[],
    reportDate: string,
    reportStartTime: string,
    reportEndTime: string,
    manualJustifications: ManualJustifications,
    operationPulses: OperationPulse[] = []
): DeadTimeEntry[] {
    if (!reportDate || !reportStartTime || !reportEndTime || !data) return [];
    
    // Create the base date object from the string, ensuring it's treated as local.
    const reportDateObj = parseFlexibleDate(reportDate);
    if (!reportDateObj) return [];
    
    // These parseTime functions correctly combine the date part with the time part in the local timezone.
    const reportStartDate = parseTime(reportStartTime, reportDateObj);
    const reportEndDate = parseTime(reportEndTime, reportDateObj);
    
    // Ensure all entry dates are valid Date objects before processing.
    const validData = data.filter(entry => {
        const d = parseFlexibleDate(entry.fechaDeLectura);
        return d && !isNaN(d.getTime());
    }).map(entry => {
        const originalDate = parseFlexibleDate(entry.fechaDeLectura)!;
        // Normalize to report date to match processReport and ensure stable IDs
        const normalizedDate = new Date(originalDate);
        normalizedDate.setFullYear(reportDateObj.getFullYear(), reportDateObj.getMonth(), reportDateObj.getDate());
        return { ...entry, fechaDeLectura: normalizedDate };
    });
        
    const dataInTimeRange = validData.filter(entry => 
      entry.fechaDeLectura >= reportStartDate && entry.fechaDeLectura <= reportEndDate
    );
        
    const allPauses = detectAllPauses(dataInTimeRange, reportStartDate, reportEndDate);
    
    // Apply justifications and handle splits
    const processedPauses = applyJustifications(allPauses, manualJustifications, operationPulses);
    
    return processedPauses.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

// 3. CÁLCULOS PRINCIPALES DEL REPORTE
// ===============================================

function calculateProductivity(
    data: RemisionEntry[],
    fullDayData: RemisionEntry[], // Data for the entire day to find absolute first/last scan
    goals: ProductivityGoals,
    brandGoals: BrandProductTypeGoals,
    justifiedDeadTimes: DeadTimeEntry[],
    reportStartTime: Date,
    reportEndTime: Date,
    allDeadTimesAndPauses: DeadTimeEntry[],
    referenceGoals: ReferenceGoals = {}
): PackerProductivity[] {
    const packerData = data.reduce((acc, entry) => {
        if (!acc[entry.empacador]) {
            acc[entry.empacador] = { entries: [], totalQuantity: 0 };
        }
        if (entry.cantidad > 0) { // Only count entries that contribute to productivity
          acc[entry.empacador].entries.push(entry);
          acc[entry.empacador].totalQuantity += entry.cantidad;
        }
        return acc;
    }, {} as { [key: string]: { entries: RemisionEntry[], totalQuantity: number } });
    
    const fullDayEntriesByPacker = fullDayData.reduce((acc, entry) => {
        if (!acc[entry.empacador]) acc[entry.empacador] = [];
        acc[entry.empacador].push(entry);
        return acc;
    }, {} as { [key: string]: RemisionEntry[] });

    const productivityReport: PackerProductivity[] = [];

    for (const packerName in packerData) {
        const packerEntries = packerData[packerName].entries;

        if (packerEntries.length === 0) continue;

        const totalQuantity = packerData[packerName].totalQuantity;
        
        const sortedEntries = packerEntries.sort((a, b) => a.fechaDeLectura.getTime() - b.fechaDeLectura.getTime());
        
        const fullDayPackerEntries = (fullDayEntriesByPacker[packerName] || []).sort((a,b) => a.fechaDeLectura.getTime() - b.fechaDeLectura.getTime());
        const absoluteFirstScan = fullDayPackerEntries.length > 0 ? fullDayPackerEntries[0].fechaDeLectura : reportStartTime;
        
        const start = absoluteFirstScan.getTime() > reportStartTime.getTime() ? absoluteFirstScan : reportStartTime;
        const end = reportEndTime; // Always use the report's end time

        let totalWorkMinutes = (end.getTime() - start.getTime()) / 60000;
        
        const packerJustifiedDeadTimes = justifiedDeadTimes.filter(dt => dt.packerName === packerName && dt.status === 'Justificado');
        let totalDeductedMinutes = 0;
        const appliedBreaks: PackerProductivity['appliedBreaks'] = { BREAKFAST: false, LUNCH: false, SNACK: false };
        
        packerJustifiedDeadTimes.forEach(dt => {
            const overlapStart = Math.max(dt.startTime.getTime(), start.getTime());
            const overlapEnd = Math.min(dt.endTime.getTime(), end.getTime());

            if (overlapEnd > overlapStart) {
                totalDeductedMinutes += (overlapEnd - overlapStart) / 60000;
            }

            if(dt.justification?.includes('BREAKFAST')) appliedBreaks.BREAKFAST = true;
            if(dt.justification?.includes('LUNCH')) appliedBreaks.LUNCH = true;
            if(dt.justification?.includes('SNACK')) appliedBreaks.SNACK = true;
        });

        const hoursWorked = Math.max(0, (totalWorkMinutes - totalDeductedMinutes) / 60);
        const productivity = hoursWorked > 0 ? totalQuantity / hoursWorked : 0;
        
        const earnedHours = packerEntries.reduce((sum, entry) => {
            const goal = referenceGoals[entry.referencia] || brandGoals[entry.marca]?.[entry.productType] || goals[entry.productType] || 60;
            return sum + (entry.cantidad / goal);
        }, 0);

        const baseGoal = earnedHours > 0 ? totalQuantity / earnedHours : 60;
        const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;
        
        const packerMicroPauses = allDeadTimesAndPauses.filter(p => p.packerName === packerName && p.duration < 5 && p.duration >= 1);
        const totalMicroPausesMinutes = packerMicroPauses.reduce((sum, p) => sum + p.duration, 0);

        productivityReport.push({
            packerName,
            totalQuantity,
            hoursWorked,
            productivity,
            compliance,
            firstScan: absoluteFirstScan,
            lastScan: fullDayPackerEntries.length > 0 ? fullDayPackerEntries[fullDayPackerEntries.length - 1].fechaDeLectura : reportEndTime,
            workPeriodEnd: end,
            baseGoal,
            appliedBreaks,
            totalMicroPausesMinutes,
            totalDeductedMinutes: Math.round(totalDeductedMinutes),
        });
    }

    return productivityReport.sort((a, b) => b.totalQuantity - a.totalQuantity);
}


function calculatePackerBrandProductivityDetail(
    data: RemisionEntry[],
    packerProductivity: PackerProductivity[],
    goals: ProductivityGoals,
    brandGoals: BrandProductTypeGoals,
    justifiedDeadTimes: DeadTimeEntry[],
    referenceGoals: ReferenceGoals = {}
): PackerBrandProductivityDetail[] {
    const result: PackerBrandProductivityDetail[] = [];

    const entriesByPacker = data.reduce((acc, entry) => {
        if (!acc[entry.empacador]) {
            acc[entry.empacador] = [];
        }
        acc[entry.empacador].push(entry);
        return acc;
    }, {} as { [key: string]: RemisionEntry[] });

    for (const packerName in entriesByPacker) {
        const packerEntries = entriesByPacker[packerName].sort((a, b) => a.fechaDeLectura.getTime() - b.fechaDeLectura.getTime());
        const packerJustifiedPauses = justifiedDeadTimes.filter(dt => dt.packerName === packerName && dt.status === 'Justificado');
        const packerProdInfo = packerProductivity.find(p => p.packerName === packerName);

        if (packerEntries.length === 0 || !packerProdInfo) continue;

        let currentBlockStartTime = packerEntries[0]?.fechaDeLectura;
        let currentBlockBrand = packerEntries[0]?.marca;
        let currentBlockEntries: RemisionEntry[] = [];

        for (let i = 0; i < packerEntries.length; i++) {
            const entry = packerEntries[i];
            
            if (entry.marca !== currentBlockBrand) {
                if(currentBlockEntries.length > 0) {
                    const blockEndTime = entry.fechaDeLectura;
                    processBlock(currentBlockEntries, currentBlockStartTime, blockEndTime, packerJustifiedPauses, referenceGoals);
                }
                currentBlockStartTime = entry.fechaDeLectura;
                currentBlockBrand = entry.marca;
                currentBlockEntries = [entry];
            } else {
                currentBlockEntries.push(entry);
            }
        }
        
        if (currentBlockEntries.length > 0) {
            const reportEndTime = packerProdInfo.workPeriodEnd;
            processBlock(currentBlockEntries, currentBlockStartTime, reportEndTime, packerJustifiedPauses, referenceGoals);
        }
    }

    function processBlock(blockEntries: RemisionEntry[], startTime: Date, endTime: Date, pauses: DeadTimeEntry[], referenceGoals: ReferenceGoals = {}) {
        if (!blockEntries || blockEntries.length === 0 || !startTime) return;

        const brandName = blockEntries[0].marca;
        const productType = blockEntries[0].productType;
        const packerName = blockEntries[0].empacador;
        
        const totalQuantity = blockEntries.reduce((sum, e) => sum + e.cantidad, 0);
        let blockDurationMinutes = (endTime.getTime() - startTime.getTime()) / 60000;
        
        let pauseMinutesInBlock = 0;
        pauses.forEach(pause => {
            const overlapStart = Math.max(pause.startTime.getTime(), startTime.getTime());
            const overlapEnd = Math.min(pause.endTime.getTime(), endTime.getTime());
            if (overlapEnd > overlapStart) {
                pauseMinutesInBlock += (overlapEnd - overlapStart) / 60000;
            }
        });

        const netHoursWorked = Math.max(0, (blockDurationMinutes - pauseMinutesInBlock) / 60);

        if (netHoursWorked > 0.001) { // Use a small threshold to avoid division by zero for micro-tasks
            const productivity = totalQuantity / netHoursWorked;
            const earnedHours = blockEntries.reduce((sum, entry) => {
                 const goal = referenceGoals[entry.referencia] || brandGoals[entry.marca]?.[entry.productType] || goals[entry.productType] || 60;
                 return sum + (entry.cantidad / goal);
            }, 0);
            
            const baseGoal = earnedHours > 0 ? totalQuantity / earnedHours : 60;
            const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;

            result.push({
                packerName,
                brandName,
                productType,
                totalQuantity,
                hoursWorked: netHoursWorked,
                productivity,
                baseGoal: baseGoal,
                compliance,
            });
        }
    }

    return result;
}


function calculateBrandProductivity(
    dataForCalculation: RemisionEntry[],
    packerDetails: PackerBrandProductivityDetail[]
): BrandProductivity[] {
    const brandData = new Map<string, { totalQuantity: number; totalWorkHours: number; breakdown: BrandPackerBreakdown[], entries: RemisionEntry[] }>();

    dataForCalculation.forEach(entry => {
        let brandAgg = brandData.get(entry.marca);
        if (!brandAgg) {
            brandAgg = { totalQuantity: 0, totalWorkHours: 0, breakdown: [], entries: [] };
            brandData.set(entry.marca, brandAgg);
        }
        brandAgg.entries.push(entry);
    });

    packerDetails.forEach(detail => {
        let brandAgg = brandData.get(detail.brandName);
        if (!brandAgg) return;
        
        brandAgg.totalQuantity += detail.totalQuantity;
        brandAgg.totalWorkHours += detail.hoursWorked;

        let packerBreakdown = brandAgg.breakdown.find(b => b.packerName === detail.packerName);
        if (!packerBreakdown) {
            packerBreakdown = { 
                packerName: detail.packerName, 
                totalQuantity: 0, 
                compliance: 0, 
                baseGoal: 0,
                hoursWorked: 0,
            };
            brandAgg.breakdown.push(packerBreakdown);
        }
        packerBreakdown.totalQuantity += detail.totalQuantity;
        packerBreakdown.hoursWorked += detail.hoursWorked;
    });

    const totalOverallQuantity = Array.from(brandData.values()).reduce((sum, data) => sum + data.totalQuantity, 0);

    return Array.from(brandData.entries()).map(([brandName, data]) => {
        
        data.breakdown.forEach(packer => {
            const packerDetailsForBrand = packerDetails.filter(pd => pd.brandName === brandName && pd.packerName === packer.packerName);
            const packerTotalQty = packer.totalQuantity;
            const packerTotalHours = packer.hoursWorked;

            const packerProd = packerTotalHours > 0 ? packerTotalQty / packerTotalHours : 0;
            
            const weightedGoalSum = packerDetailsForBrand.reduce((sum, pd) => sum + pd.baseGoal * pd.hoursWorked, 0);
            const packerBaseGoal = packerTotalHours > 0 ? weightedGoalSum / packerTotalHours : 60;
            
            packer.baseGoal = Math.round(packerBaseGoal);
            packer.compliance = packerBaseGoal > 0 ? (packerProd / packerBaseGoal) * 100 : 0;
        });

        const productivity = data.totalWorkHours > 0 ? data.totalQuantity / data.totalWorkHours : 0;
        const totalWeightedGoalSum = data.breakdown.reduce((sum, p) => sum + (p.baseGoal * p.hoursWorked), 0);
        const baseGoal = data.totalWorkHours > 0 ? totalWeightedGoalSum / data.totalWorkHours : 60;
        const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;
        
        return {
            brandName,
            totalQuantity: data.totalQuantity,
            percentage: totalOverallQuantity > 0 ? (data.totalQuantity / totalOverallQuantity) * 100 : 0,
            productivity,
            compliance,
            baseGoal,
            workHours: data.totalWorkHours,
            breakdown: data.breakdown.sort((a,b) => b.totalQuantity - a.totalQuantity),
            entries: data.entries,
        };
    }).sort((a, b) => b.totalQuantity - a.totalQuantity);
}


function calculateProductTypeProductivity(
    data: RemisionEntry[],
    packerProductivity: PackerProductivity[],
    goals: ProductivityGoals,
    brandGoals: BrandProductTypeGoals,
    justifiedDeadTimes: DeadTimeEntry[],
    referenceGoals: ReferenceGoals = {}
): ProductTypeProductivity[] {
    const productTypeDetails: PackerBrandProductivityDetail[] = [];

    const entriesByPacker = data.reduce((acc, entry) => {
        if (!acc[entry.empacador]) acc[entry.empacador] = [];
        acc[entry.empacador].push(entry);
        return acc;
    }, {} as { [key: string]: RemisionEntry[] });

    for (const packerName in entriesByPacker) {
        const packerEntries = entriesByPacker[packerName].sort((a, b) => a.fechaDeLectura.getTime() - b.fechaDeLectura.getTime());
        const packerJustifiedPauses = justifiedDeadTimes.filter(dt => dt.packerName === packerName && dt.status === 'Justificado');
        const packerProdInfo = packerProductivity.find(p => p.packerName === packerName);

        if (packerEntries.length === 0 || !packerProdInfo) continue;

        let currentBlockStartTime = packerEntries[0]?.fechaDeLectura;
        let currentBlockProductType = packerEntries[0]?.productType;
        let currentBlockEntries: RemisionEntry[] = [];

        for (let i = 0; i < packerEntries.length; i++) {
            const entry = packerEntries[i];
            
            if (entry.productType !== currentBlockProductType) {
                if (currentBlockEntries.length > 0) {
                    const blockEndTime = entry.fechaDeLectura;
                    processBlock(currentBlockEntries, currentBlockStartTime, blockEndTime, packerJustifiedPauses, referenceGoals);
                }
                currentBlockStartTime = entry.fechaDeLectura;
                currentBlockProductType = entry.productType;
                currentBlockEntries = [entry];
            } else {
                currentBlockEntries.push(entry);
            }
        }
        
        if (currentBlockEntries.length > 0) {
            const reportEndTime = packerProdInfo.workPeriodEnd;
            processBlock(currentBlockEntries, currentBlockStartTime, reportEndTime, packerJustifiedPauses, referenceGoals);
        }
    }

    function processBlock(blockEntries: RemisionEntry[], startTime: Date, endTime: Date, pauses: DeadTimeEntry[], referenceGoals: ReferenceGoals = {}) {
        if (!blockEntries || blockEntries.length === 0 || !startTime) return;

        const productType = blockEntries[0].productType;
        const packerName = blockEntries[0].empacador;
        
        const totalQuantity = blockEntries.reduce((sum, e) => sum + e.cantidad, 0);
        let blockDurationMinutes = (endTime.getTime() - startTime.getTime()) / 60000;
        
        let pauseMinutesInBlock = 0;
        pauses.forEach(pause => {
            const overlapStart = Math.max(pause.startTime.getTime(), startTime.getTime());
            const overlapEnd = Math.min(pause.endTime.getTime(), endTime.getTime());
            if (overlapEnd > overlapStart) {
                pauseMinutesInBlock += (overlapEnd - overlapStart) / 60000;
            }
        });

        const netHoursWorked = Math.max(0, (blockDurationMinutes - pauseMinutesInBlock) / 60);

        if (netHoursWorked > 0.001) {
            const productivity = totalQuantity / netHoursWorked;
            
            const earnedHours = blockEntries.reduce((sum, e) => {
                 const goal = referenceGoals[e.referencia] || brandGoals[e.marca]?.[e.productType] || goals[e.productType] || 60;
                 return sum + (e.cantidad / goal);
            }, 0);
            
            const baseGoal = earnedHours > 0 ? totalQuantity / earnedHours : 60;
            const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;

            productTypeDetails.push({
                packerName,
                brandName: 'N/A', // Not relevant for this aggregation
                productType,
                totalQuantity,
                hoursWorked: netHoursWorked,
                productivity,
                baseGoal,
                compliance,
            });
        }
    }

    const aggregatedResult: ProductTypeProductivity[] = [];
    const productTypeData = new Map<ProductCategory, { 
        totalQuantity: number; 
        totalWorkHours: number;
        breakdown: ProductTypePackerBreakdown[]; 
        entries: RemisionEntry[]; 
    }>();

     data.forEach(entry => {
        if (!productTypeData.has(entry.productType)) {
            productTypeData.set(entry.productType, { 
                totalQuantity: 0, 
                totalWorkHours: 0, 
                breakdown: [], 
                entries: [] 
            });
        }
        productTypeData.get(entry.productType)!.entries.push(entry);
    });

    productTypeDetails.forEach(detail => {
        let categoryData = productTypeData.get(detail.productType);
        if (!categoryData) return;
        
        categoryData.totalQuantity += detail.totalQuantity;
        categoryData.totalWorkHours += detail.hoursWorked;

        let packerBreakdown = categoryData.breakdown.find(b => b.packerName === detail.packerName);
        if (!packerBreakdown) {
            packerBreakdown = {
                packerName: detail.packerName,
                totalQuantity: 0,
                compliance: 0,
                baseGoal: 0, 
                hoursWorked: 0,
            };
            categoryData.breakdown.push(packerBreakdown);
        }
        packerBreakdown.totalQuantity += detail.totalQuantity;
        packerBreakdown.hoursWorked += detail.hoursWorked;
    });

    const totalOverallQuantity = Array.from(productTypeData.values()).reduce((sum, data) => sum + data.totalQuantity, 0);

    return Array.from(productTypeData.entries()).map(([category, data]) => {
        
        data.breakdown.forEach(packer => {
            const packerDetailsForCategory = productTypeDetails.filter(pd => pd.productType === category && pd.packerName === packer.packerName);
            const packerProd = packer.hoursWorked > 0 ? packer.totalQuantity / packer.hoursWorked : 0;
            const weightedGoalSum = packerDetailsForCategory.reduce((sum, pd) => sum + pd.baseGoal * pd.hoursWorked, 0);
            const packerBaseGoal = packer.hoursWorked > 0 ? weightedGoalSum / packer.hoursWorked : 60;
            
            packer.baseGoal = Math.round(packerBaseGoal);
            packer.compliance = packerBaseGoal > 0 ? (packerProd / packerBaseGoal) * 100 : 0;
        });

        const productivity = data.totalWorkHours > 0 ? data.totalQuantity / data.totalWorkHours : 0;
        const totalWeightedGoalSum = data.breakdown.reduce((sum, p) => sum + (p.baseGoal * p.hoursWorked), 0);
        const baseGoal = data.totalWorkHours > 0 ? totalWeightedGoalSum / data.totalWorkHours : 60;
        const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;

        return {
            category,
            totalQuantity: data.totalQuantity,
            percentage: totalOverallQuantity > 0 ? (data.totalQuantity / totalOverallQuantity) * 100 : 0,
            productivity,
            compliance,
            workHours: data.totalWorkHours,
            breakdown: data.breakdown.sort((a, b) => b.totalQuantity - a.totalQuantity),
            entries: data.entries,
        };
    }).sort((a, b) => b.totalQuantity - a.totalQuantity);
}


function calculatePackerReferenceProductivityDetail(
    data: RemisionEntry[],
    packerProductivity: PackerProductivity[],
    goals: ProductivityGoals,
    brandGoals: BrandProductTypeGoals,
    referenceGoals: ReferenceGoals = {}
): PackerReferenceProductivityDetail[] {
    const result: PackerReferenceProductivityDetail[] = [];

    // 1. Group all entries by packer
    const entriesByPacker = data.reduce((acc, entry) => {
        if (!acc[entry.empacador]) acc[entry.empacador] = [];
        acc[entry.empacador].push(entry);
        return acc;
    }, {} as { [key: string]: RemisionEntry[] });

    // 2. Iterate through each packer
    for (const packerName in entriesByPacker) {
        const packerEntries = entriesByPacker[packerName];
        const packerProdInfo = packerProductivity.find(p => p.packerName === packerName);

        // Skip if no productivity info or no hours worked (prevents division by zero)
        if (!packerProdInfo || packerProdInfo.hoursWorked <= 0) {
            continue;
        }

        // 3. Calculate total "earned hours" for the packer across all their tasks
        const totalPackerEarnedHours = packerEntries.reduce((sum, entry) => {
            const goal = referenceGoals[entry.referencia] || brandGoals[entry.marca]?.[entry.productType] || goals[entry.productType] || 60;
            return sum + (entry.cantidad / goal);
        }, 0);

        if (totalPackerEarnedHours <= 0) {
            continue;
        }

        // 4. Group the packer's entries by reference
        const tasksByReference = new Map<string, { entries: RemisionEntry[], totalQuantity: number, brandName: string, productType: ProductCategory, descripcion: string }>();
        packerEntries.forEach(entry => {
            const key = entry.referencia;
            if (!tasksByReference.has(key)) {
                tasksByReference.set(key, { 
                    entries: [], 
                    totalQuantity: 0,
                    brandName: entry.marca,
                    productType: entry.productType,
                    descripcion: entry.descripcion
                });
            }
            const task = tasksByReference.get(key)!;
            task.entries.push(entry);
            task.totalQuantity += entry.cantidad;
        });

        // 5. Calculate metrics for each reference task
        tasksByReference.forEach((taskData, referencia) => {
            // Calculate "earned hours" for this specific reference task
            const taskEarnedHours = taskData.entries.reduce((sum, entry) => {
                const goal = referenceGoals[entry.referencia] || brandGoals[taskData.brandName]?.[taskData.productType] || goals[taskData.productType] || 60;
                return sum + (entry.cantidad / goal);
            }, 0);
            
            // Allocate a portion of the packer's total work time to this task
            const percentageOfTotalEffort = taskEarnedHours / totalPackerEarnedHours;
            const hoursWorkedOnTask = packerProdInfo.hoursWorked * percentageOfTotalEffort;
            
            if (hoursWorkedOnTask <= 0) return; // Skip if no time was allocated

            const productivity = taskData.totalQuantity / hoursWorkedOnTask;
            const baseGoal = taskEarnedHours > 0 ? taskData.totalQuantity / taskEarnedHours : (brandGoals[taskData.brandName]?.[taskData.productType] || goals[taskData.productType] || 60);
            const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;
            
            result.push({
              packerName,
              referencia,
              descripcion: taskData.descripcion,
              brandName: taskData.brandName,
              productType: taskData.productType,
              totalQuantity: taskData.totalQuantity,
              hoursWorked: hoursWorkedOnTask,
              productivity: productivity,
              baseGoal: baseGoal,
              compliance: compliance,
            });
        });
    }

    return result;
}


function calculateOverallCompliance(
    packerBrandProductivityDetail: PackerBrandProductivityDetail[]
): number {
    let totalExpectedUnits = 0;
    let totalActualUnits = 0;

    packerBrandProductivityDetail.forEach(detail => {
        totalActualUnits += detail.totalQuantity;
        // Calculate expected units for this specific task
        totalExpectedUnits += detail.hoursWorked * detail.baseGoal;
    });

    if (totalExpectedUnits === 0) return 0;

    return (totalActualUnits / totalExpectedUnits) * 100;
}


function calculatePackerHourlyPerformance(
    packerEntries: RemisionEntry[],
    packerProdInfo: PackerProductivity,
    goals: ProductivityGoals,
    brandGoals: BrandProductTypeGoals,
    justifiedDeadTimes: DeadTimeEntry[],
    reportEndTime: Date,
    referenceGoals: ReferenceGoals = {}
): { [hour: number]: Omit<HourlyOperatorDetail, 'productivity' | 'compliance' | 'trend'> } {
    const hourlyDetails: { [hour: number]: Omit<HourlyOperatorDetail, 'productivity' | 'compliance' | 'trend'> } = {};

    if (!packerEntries || packerEntries.length === 0) {
        return hourlyDetails;
    }
    
    const firstScanTime = packerProdInfo.firstScan;
    const finalTime = reportEndTime;
    
    const startHour = firstScanTime.getHours();
    const endHour = finalTime.getMinutes() > 0 || finalTime.getSeconds() > 0 
        ? finalTime.getHours() 
        : finalTime.getHours() - 1;

    for (let h = startHour; h <= endHour; h++) {
        hourlyDetails[h] = { units: 0, baseGoal: 60, productiveMinutes: 0 };
    }

    packerEntries.forEach(entry => {
        const hour = entry.fechaDeLectura.getHours();
        if (hourlyDetails[hour] !== undefined) {
            hourlyDetails[hour].units += entry.cantidad;
        }
    });

    Object.keys(hourlyDetails).map(Number).forEach(hour => {
        const hourStartDate = new Date(firstScanTime);
        hourStartDate.setHours(hour, 0, 0, 0);
        let startOfInterval = hourStartDate.getTime();
        
        if (hour === firstScanTime.getHours()) {
            startOfInterval = firstScanTime.getTime();
        }

        const hourEndDate = new Date(firstScanTime);
        hourEndDate.setHours(hour + 1, 0, 0, 0);
        let endOfInterval = hourEndDate.getTime();

        if (hour === finalTime.getHours()) {
            endOfInterval = finalTime.getTime();
        }
        
        let potentialMinutesInHour = 0;
        if (endOfInterval > startOfInterval) {
            potentialMinutesInHour = (endOfInterval - startOfInterval) / 60000;
        }
        
        let deductedMinutesInHour = 0;
        justifiedDeadTimes
            .filter(pause => pause.packerName === packerProdInfo.packerName && pause.status === 'Justificado')
            .forEach(pause => {
                const overlapStart = Math.max(startOfInterval, pause.startTime.getTime());
                const overlapEnd = Math.min(endOfInterval, pause.endTime.getTime());

                if (overlapEnd > overlapStart) {
                    deductedMinutesInHour += (overlapEnd - overlapStart) / 60000;
                }
            });
            
        hourlyDetails[hour].productiveMinutes = Math.max(0, potentialMinutesInHour - deductedMinutesInHour);
    });

    for (const hourStr in hourlyDetails) {
        const hour = Number(hourStr);
        const entriesInHour = packerEntries.filter(e => e.fechaDeLectura.getHours() === hour);
        
        if (entriesInHour.length > 0) {
            const unitsInHour = hourlyDetails[hour].units;
            const earnedHours = entriesInHour.reduce((sum, entry) => {
                const goal = referenceGoals[entry.referencia] || brandGoals[entry.marca]?.[entry.productType] || goals[entry.productType] || 60;
                return sum + (entry.cantidad / goal);
            }, 0);
            
            hourlyDetails[hour].baseGoal = earnedHours > 0 ? unitsInHour / earnedHours : (goals[entriesInHour[0]?.productType] || 60);
        } else {
             const allGoals = Object.values(hourlyDetails).map(d => d.baseGoal).filter(g => g > 0);
             hourlyDetails[hour].baseGoal = allGoals.length > 0 ? allGoals.reduce((s,v) => s+v, 0)/allGoals.length : 60;
        }
    }
    
    return hourlyDetails;
}




function calculateHourlyProductivity(
    packerProductivity: PackerProductivity[],
    reportStartTime: Date,
    reportEndTime: Date,
): HourlyProductivity[] {
    const hourlyDataAgg = new Map<number, { 
        totalQuantity: number; 
        totalCompliance: number; 
        totalProductivity: number; 
        operatorCount: number; 
        totalProductiveMinutes: number;
    }>();
    
    const startHour = reportStartTime.getHours();
    const endHour = reportEndTime.getHours();
    for (let h = startHour; h <= endHour; h++) {
        hourlyDataAgg.set(h, { totalQuantity: 0, totalCompliance: 0, totalProductivity: 0, operatorCount: 0, totalProductiveMinutes: 0 });
    }

    packerProductivity.forEach(packer => {
        const hourlyBreakdown = (packer as any).hourlyBreakdown as { [hour: number]: HourlyOperatorDetail } | undefined;
        if (!hourlyBreakdown) return;
        
        Object.entries(hourlyBreakdown).forEach(([hourStr, detail]) => {
            const hour = Number(hourStr);
            const agg = hourlyDataAgg.get(hour);
            if (agg) {
                agg.totalQuantity += detail.units;
                agg.totalProductiveMinutes += detail.productiveMinutes;
                
                // Only count operator if they had productive time
                if(detail.productiveMinutes > 0) {
                  agg.operatorCount++;
                  agg.totalProductivity += detail.productivity;
                  agg.totalCompliance += detail.compliance;
                }
            }
        });
    });

    return Array.from(hourlyDataAgg.entries()).map(([hour, agg]) => ({
        hour,
        totalQuantity: agg.totalQuantity,
        operatorCount: agg.operatorCount,
        productivityPerOperator: agg.operatorCount > 0 ? agg.totalProductivity / agg.operatorCount : 0,
        compliance: agg.operatorCount > 0 ? agg.totalCompliance / agg.operatorCount : 0,
        productiveMinutes: agg.totalProductiveMinutes
    })).sort((a, b) => a.hour - b.hour);
}


function createSummary(
    incidents: DeadTimeEntry[],
    packerProductivity: PackerProductivity[],
    summaryType: 'DEAD_TIME' | 'MICRO_PAUSE' | 'HEURISTIC'
): DeadTimeSummaryEntry[] {
    // Group by packerName AND reason/status
    const groups = new Map<string, { 
        packerName: string, 
        reason: string, 
        incidentCount: number, 
        totalMinutes: number, 
        hourly: { [h: number]: number } 
    }>();

    incidents.forEach(incident => {
        const reason = incident.justification?.trim() || incident.status?.trim() || (summaryType === 'MICRO_PAUSE' ? 'Micro-pausas' : 'Sin justificar');
        const key = `${incident.packerName}|${reason}`;
        
        if (!groups.has(key)) {
            groups.set(key, { 
                packerName: incident.packerName, 
                reason: reason, 
                incidentCount: 0, 
                totalMinutes: 0, 
                hourly: {} 
            });
        }
        
        const group = groups.get(key)!;
        group.incidentCount++;
        group.totalMinutes += incident.duration;

        let cursorTime = new Date(incident.startTime);
        let remainingMinutes = incident.duration;
        while(remainingMinutes > 0) {
            const hour = cursorTime.getHours();
            const minutesToNextHour = 60 - cursorTime.getMinutes();
            const minutesThisHour = Math.min(remainingMinutes, minutesToNextHour);

            if(!group.hourly[hour]) group.hourly[hour] = 0;
            group.hourly[hour] += minutesThisHour;

            remainingMinutes -= minutesThisHour;
            cursorTime.setHours(hour + 1, 0, 0, 0);
        }
    });

    const grandTotalMinutes = Array.from(groups.values()).reduce((sum, g) => sum + g.totalMinutes, 0);

    return Array.from(groups.values()).map(group => {
        const packerProd = packerProductivity.find(p => p.packerName === group.packerName);
        const jornadaMinutes = packerProd ? (packerProd.workPeriodEnd.getTime() - packerProd.firstScan.getTime()) / 60000 : 0;
        
        return {
            packerName: group.packerName,
            reason: group.reason,
            type: summaryType,
            incidentCount: group.incidentCount,
            totalMinutes: group.totalMinutes,
            percentageOfWorkday: jornadaMinutes > 0 ? (group.totalMinutes / jornadaMinutes) * 100 : 0,
            percentageOfTotalDeadTime: grandTotalMinutes > 0 ? (group.totalMinutes / grandTotalMinutes) * 100 : 0,
            hourlyDistribution: group.hourly
        };
    }).sort((a,b) => b.totalMinutes - a.totalMinutes);
}

function generateBreakDetailReport(
    incidents: DeadTimeEntry[],
    processedDeadTimes: DeadTimeEntry[],
    packerProductivity: PackerProductivity[]
): DetectedBreakDetail[] {
    const report: DetectedBreakDetail[] = [];
    const breakTypes: Array<'BREAKFAST' | 'LUNCH' | 'SNACK'> = ['BREAKFAST', 'LUNCH', 'SNACK'];

    packerProductivity.forEach(packer => {
        breakTypes.forEach(breakType => {
            const assignedJustification = processedDeadTimes.find(dt => 
                dt.packerName === packer.packerName &&
                dt.status === 'Justificado' &&
                dt.justification?.includes(breakType)
            );

            if (assignedJustification) {
                const originalId = assignedJustification.id.replace(/-justified.*/, '');
                const excess = processedDeadTimes.find(dt => dt.id === `${originalId}-excess`);
                const originalIncident = incidents.find(inc => inc.id === originalId) || assignedJustification;
                
                report.push({
                    packerName: packer.packerName,
                    breakType,
                    status: 'Asignado',
                    assignedDeadTime: originalIncident,
                    actualDuration: originalIncident.duration,
                    excessDuration: excess?.duration || 0,
                });

            } else {
                report.push({
                    packerName: packer.packerName,
                    breakType,
                    status: 'No Encontrado',
                });
            }
        });
    });

    return report;
}


// Función principal para procesar el reporte completo
// ===============================================

export function processReport(
    data: RemisionEntry[],
    brandGoals: BrandProductTypeGoals,
    reportDate: string,
    reportStartTimeStr: string,
    reportEndTimeStr: string,
    manualJustifications: ManualJustifications,
    selectedPackers: string[],
    incidentLog: IncidentLogEntry[],
    operationPulses: OperationPulse[] = [],
    referenceGoals: ReferenceGoals = {},
    goals: ProductivityGoals = { 'CALZADO': 65, 'ROPA': 100, 'ACCESORIOS': 90, 'NO CLASIFICADO': 60 }
): ProcessedReportData {
    // Create UTC-based dates for start and end to avoid timezone issues during filtering
    const reportDateObj = parseFlexibleDate(reportDate);
    if (!reportDateObj) {
        throw new Error("Invalid report date provided for processing.");
    }
    
    const reportStartTime = parseTime(reportStartTimeStr, reportDateObj);
    const reportEndTime = parseTime(reportEndTimeStr, reportDateObj);

    // Proyectamos todos los registros sobre la fecha seleccionada por el usuario...
    const normalizedData = data.map(entry => {
        const d = new Date(entry.fechaDeLectura);
        if (!isNaN(d.getTime())) {
            d.setFullYear(reportDateObj.getFullYear(), reportDateObj.getMonth(), reportDateObj.getDate());
        }
        return { ...entry, fechaDeLectura: d };
    });

    const fullDataInTimeRange = normalizedData.filter(entry => 
      !isNaN(entry.fechaDeLectura.getTime()) && 
      entry.fechaDeLectura >= reportStartTime && entry.fechaDeLectura <= reportEndTime
    );
    
    const allDeadTimesAndPauses = detectAllPauses(fullDataInTimeRange, reportStartTime, reportEndTime);
    const processedDeadTimes = applyJustifications(allDeadTimesAndPauses, manualJustifications, operationPulses);
    
    const deadTimeReport = processedDeadTimes.filter(p => p.duration >= 5);
    const microPausesReport = processedDeadTimes.filter(p => p.duration < 5 && p.duration >= 1);
    
    const dataForProductivity = selectedPackers.includes('all') 
        ? fullDataInTimeRange 
        : fullDataInTimeRange.filter(entry => selectedPackers.includes(entry.empacador));
    
    const packerProductivity = calculateProductivity(dataForProductivity, fullDataInTimeRange, goals, brandGoals, processedDeadTimes, reportStartTime, reportEndTime, allDeadTimesAndPauses, referenceGoals);
    
    const packerBrandProductivityDetail = calculatePackerBrandProductivityDetail(dataForProductivity, packerProductivity, goals, brandGoals, processedDeadTimes, referenceGoals);
    
    const hourlyBreakdowns = new Map<string, { [hour: number]: Omit<HourlyOperatorDetail, 'productivity' | 'compliance' | 'trend'> }>();
    packerProductivity.forEach(packer => {
        const packerEntries = data.filter(d => d.empacador === packer.packerName);
        const justifiedForPacker = processedDeadTimes.filter(p => p.packerName === packer.packerName);
        hourlyBreakdowns.set(packer.packerName, calculatePackerHourlyPerformance(packerEntries, packer, goals, brandGoals, justifiedForPacker, reportEndTime, referenceGoals));
    });

    packerProductivity.forEach(packer => {
        const breakdown = hourlyBreakdowns.get(packer.packerName);
        if (breakdown) {
            const performanceDetails: { [hour: number]: HourlyOperatorDetail } = {};
            for (const hourStr in breakdown) {
                const hour = Number(hourStr);
                const detail = breakdown[hour];
                const productivity = detail.productiveMinutes > 0 ? (detail.units / detail.productiveMinutes) * 60 : 0;
                const compliance = detail.baseGoal > 0 ? (productivity / detail.baseGoal) * 100 : 0;
                performanceDetails[hour] = { ...detail, productivity, compliance, trend: null };
            }
            
            const sortedHours = Object.keys(performanceDetails).map(Number).sort((a,b)=>a-b);
            for(let i = 1; i < sortedHours.length; i++){
                const currentHour = sortedHours[i];
                const prevHour = sortedHours[i-1];
                const currentProd = performanceDetails[currentHour].productivity;
                const prevProd = performanceDetails[prevHour].productivity;
                if(prevProd > 0) {
                    performanceDetails[currentHour].trend = (currentProd - prevProd) / prevProd;
                }
            }

            (packer as any).hourlyBreakdown = performanceDetails;
        }
    });

    const packerReferenceProductivityDetail = calculatePackerReferenceProductivityDetail(data, packerProductivity, goals, brandGoals, referenceGoals);
      
    const filteredPackerBrandDetails = selectedPackers.includes('all') 
        ? packerBrandProductivityDetail
        : packerBrandProductivityDetail.filter(d => selectedPackers.includes(d.packerName));
        
    const brandProductivity = calculateBrandProductivity(dataForProductivity, filteredPackerBrandDetails);
    const productTypeProductivity = calculateProductTypeProductivity(dataForProductivity, packerProductivity, goals, brandGoals, processedDeadTimes, referenceGoals);

    const packerHourlyPerformance = packerProductivity.map(p => ({ packerName: p.packerName, hourlyDetails: (p as any).hourlyBreakdown || {} }));
    const hourlyProductivity = calculateHourlyProductivity(packerProductivity, reportStartTime, reportEndTime);
    const overallCompliance = calculateOverallCompliance(packerBrandProductivityDetail);
    
    const deadTimeUnjustified = deadTimeReport.filter(p => p.status !== 'Justificado' && (selectedPackers.includes('all') || selectedPackers.includes(p.packerName)));
    const microPausesUnjustified = microPausesReport.filter(p => selectedPackers.includes('all') || selectedPackers.includes(p.packerName));
    const deadTimeSummary = createSummary(deadTimeUnjustified, packerProductivity, 'DEAD_TIME');
    const microPausesSummary = createSummary(microPausesUnjustified, packerProductivity, 'MICRO_PAUSE');
    const totalInactivitySummary = createSummary([...deadTimeUnjustified, ...microPausesUnjustified], packerProductivity, 'DEAD_TIME');
    
    const breakDetailReport = generateBreakDetailReport(allDeadTimesAndPauses, processedDeadTimes, packerProductivity);

    // Grouping all pauses by Reason for the global Radar Chart
    const reasonsMap = new Map<string, { minutes: number, type: string }>();
    processedDeadTimes.forEach(p => {
        const label = p.justification?.trim() || p.status?.trim() || 'Desconocido/Sin justificar';
        const type = p.duration >= 5 ? 'DEAD_TIME' : 'MICRO_PAUSE';
        const key = label;
        if (!reasonsMap.has(key)) reasonsMap.set(key, { minutes: 0, type });
        reasonsMap.get(key)!.minutes += p.duration;
    });
    const reasonsSummary = Array.from(reasonsMap.entries()).map(([reason, data]) => ({
        reason,
        durationMinutes: data.minutes,
        type: data.type
    }));

    return {
        packerProductivity,
        hourlyProductivity,
        brandProductivity,
        productTypeProductivity,
        overallCompliance,
        deadTimeReport,
        microPausesReport,
        deadTimeSummary,
        microPausesSummary,
        totalInactivitySummary,
        packerBrandProductivityDetail,
        packerReferenceProductivityDetail,
        breakDetailReport,
        packerHourlyPerformance,
        reportDate,
        incidentLog,
        manualJustifications,
        reasonsSummary,
        referenceGoals,
        productivityGoals: goals
    };
}


// Funciones para pre-escaneo en la pantalla de configuración
// ===============================================

export function extractPackersFromReport(
    data: RemisionEntry[],
    manualOperatorMappings: ManualOperatorMappings
): string[] {
    const combinedOperatorMap = { ...OPERATOR_MAP, ...manualOperatorMappings };
    const knownNames = new Set(Object.values(combinedOperatorMap));
    
    const packerNames = new Set(data.map(d => {
        const val = String(d.empacador || '').trim();
        if (knownNames.has(val)) return val;
        return (combinedOperatorMap[val] || val).trim();
    }));
    return Array.from(packerNames).sort();
}

export function extractUnmappedPackers(
    rawData: any[], 
    manualOperatorMappings: ManualOperatorMappings
): string[] {
    const unmappedIds = new Set<string>();
    
    const combinedOperatorMap = { ...OPERATOR_MAP, ...manualOperatorMappings };
    const knownNames = new Set(Object.values(combinedOperatorMap));

    rawData.forEach(row => {
        const empacadorKey = Object.keys(row).find(k => k.toLowerCase().trim() === 'empacador' || k.toLowerCase().trim() === 'empacado');
        if (empacadorKey) {
            const empacadorId = String(row[empacadorKey]).trim();
            // It's unmapped if it's NOT a key AND it's NOT already one of the known names
            if (empacadorId && !combinedOperatorMap[empacadorId] && !knownNames.has(empacadorId)) {
                const unidadDeEmpaque = String(row['unidad de empaque'] || row['unidad empaque'] || '').trim().toUpperCase();
                if (!unidadDeEmpaque.startsWith('EVI') && !unidadDeEmpaque.startsWith('INT') && !unidadDeEmpaque.startsWith('VXM')) {
                    unmappedIds.add(empacadorId);
                }
            }
        }
    });

    return Array.from(unmappedIds).sort();
}


export function extractBrandsFromReport(
    dataWithProductTypes: (RemisionEntry & { productType: ProductCategory, marca: string })[]
): string[] {
    const brandNames = new Set<string>();
    dataWithProductTypes.forEach(d => {
        if(d.marca && d.marca !== 'SIN MARCA') {
            brandNames.add(d.marca);
        }
    });
    return Array.from(brandNames).sort();
}

export function preScanForUnclassifiedProducts(
    dataWithProductTypes: (RemisionEntry & { productType: ProductCategory, marca: string })[],
): { term: string, sourceDescription: string, codigoBarras: string }[] {
    const unclassifiedTerms = new Map<string, { sourceDescription: string, codigoBarras: string }>();

    dataWithProductTypes.forEach(entry => {
        const needsClassification = entry.productType === 'NO CLASIFICADO' || entry.marca === 'SIN MARCA';

        if (needsClassification) {
            const description = entry.descripcion.toUpperCase().trim();
            const termToAnalyze = description.length >= 4 ? description.substring(3).trim().split(' ')[0] : '';
            const key = `${termToAnalyze}|${entry.codigoBarras}`;
            
            if (termToAnalyze && !unclassifiedTerms.has(key)) {
                unclassifiedTerms.set(key, { 
                    sourceDescription: entry.descripcion, 
                    codigoBarras: entry.codigoBarras 
                });
            }
        }
    });

    return Array.from(unclassifiedTerms.entries()).map(([key, data]) => {
      const [term] = key.split('|');
      return {
        term,
        sourceDescription: data.sourceDescription,
        codigoBarras: data.codigoBarras
      }
    }).sort((a,b) => a.term.localeCompare(b.term));
}

export function extractUniqueReferences(
    data: RemisionEntry[], 
    productMap: Map<string, ProductDatabaseItem>
): UniqueReference[] {
    const uniqueRefs = new Map<string, UniqueReference>();
    
    data.forEach(d => {
        const productFromDB = productMap.get(normalizeBarcode(d.codigoBarras));
        const catalogBrand = productFromDB ? catalogMarca(productFromDB) : '';
        const isNotFound = !productFromDB || !catalogBrand || !productFromDB.grupo;

        if (d.codigoBarras && isNotFound) {
            const key = d.talla !== undefined ? `${d.codigoBarras}|${d.talla}` : String(d.codigoBarras);
            if (!uniqueRefs.has(key)) {
                uniqueRefs.set(key, {
                    codigoBarras: d.codigoBarras,
                    talla: d.talla,
                    referencia: d.referencia,
                    descripcion: d.descripcion,
                    marca: d.marca,
                    productType: d.productType
                });
            }
        }
    });

    return Array.from(uniqueRefs.values()).sort((a,b) => a.referencia.localeCompare(b.referencia));
}

const isImportedBrandMarca = (marca: string | undefined | null): boolean =>
    (marca || '').trim().toUpperCase() === 'IMPORTADA';

/**
 * Referencias/códigos del reporte cuyo catálogo maestro tiene marca IMPORTADA (error de datos).
 */
export function extractImportedBrandCatalogItems(
    data: RemisionEntry[],
    productMap: Map<string, ProductDatabaseItem>
): ImportedBrandCatalogItem[] {
    const items = new Map<string, ImportedBrandCatalogItem>();

    data.forEach((entry) => {
        const dbProduct = productMap.get(normalizeBarcode(entry.codigoBarras));
        // Solo marca comercial IMPORTADA (error de datos). tipo_mercancia/merchandise_type puede ser IMPORTADA legítimamente.
        if (!dbProduct || !isImportedBrandMarca(dbProduct.marca)) {
            return;
        }

        const key = entry.talla !== undefined ? `${entry.codigoBarras}|${entry.talla}` : String(entry.codigoBarras);
        const cantidad = typeof entry.cantidad === 'number' && entry.cantidad > 0 ? entry.cantidad : 1;

        if (items.has(key)) {
            items.get(key)!.unidadesEnReporte += cantidad;
            return;
        }

        items.set(key, {
            codigoBarras: entry.codigoBarras,
            referencia: dbProduct.referencia || entry.referencia,
            descripcion: dbProduct.item || entry.descripcion,
            talla: entry.talla,
            grupo: dbProduct.grupo || entry.grupo || '',
            unidadesEnReporte: cantidad,
        });
    });

    return Array.from(items.values()).sort((a, b) => a.referencia.localeCompare(b.referencia));
}

export function extractAllReferencesFromReport(
    data: RemisionEntry[]
): UniqueReference[] {
    const uniqueRefs = new Map<string, UniqueReference>();
    
    data.forEach(d => {
        const referencia = (d.referencia || '').trim();
        const key = referencia || `__codigo__:${normalizeBarcode(d.codigoBarras)}`;
        if (!uniqueRefs.has(key)) {
            uniqueRefs.set(key, {
                codigoBarras: d.codigoBarras,
                talla: d.talla,
                referencia: referencia || normalizeBarcode(d.codigoBarras),
                descripcion: d.descripcion || '',
                marca: d.marca,
                productType: d.productType
            });
        }
    });
    
    return Array.from(uniqueRefs.values()).sort((a,b) => a.referencia.localeCompare(b.referencia));
}
    
    




    



























