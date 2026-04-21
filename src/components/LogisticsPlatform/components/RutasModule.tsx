
import React, { useState, useEffect, useMemo } from 'react';
import FileUpload from './FileUpload';
import Loader from './Loader';
import { findHeader, generateVehiclePlanPdf, generateCajonReportPdf, docNumberMapping, exportToExcel, generateMainRouteTemplate, generateAdditionalRouteTemplate } from '../utils/helpers';
import { TruckIcon, FileClockIcon, GripVerticalIcon, DownloadIcon, ArrowRightIcon, SortAscIcon, ClipboardPasteIcon, PlusCircleIcon, PdfFileIcon, CheckCircleIcon, AlertTriangleIcon } from './icons';
import type { ExcelDataRow, VehiclePlan, RouteTask } from '../types';


declare const XLSX: any;

const addressMapping: { [key: string]: string } = {
    'B1': 'CC COMERCIAL DIAMANTE', 'B2': 'EDIFICIO NUEVO GUAYAQUIL', 'B3': 'CC COMERCIAL VIVA CAUCACIA',
    'B4': 'EDIFICIO NUEVO GUAYAQUIL', 'B5': 'CC COMERCIAL PIONEROS', 'B6': 'CC COMERCIAL SAN NICOLAS',
    'B7': 'CC COMERCIAL NUESTRO BOGOTA', 'B8': 'CC COMERCIAL MAYORCA', 'B9': 'CC COMERCIAL PUERTA DEL NORTE',
    'B10': 'CR 49 130 SUR 53', 'B11': 'CC COMERCIAL FLORIDA', 'B12': 'CC COMERCIAL UNICENTRO',
    'B13': 'CC COMERCIAL PREMIUM PLAZA', 'B14': 'CC COMERCIAL MAYORCA', 'B15': 'CC COMERCIAL FABRICATO',
    'B16': 'CC COMERCIAL NUESTRO URABA', 'B17': 'CR 51 48 31 FLAMINFO', 'B18': 'CC COMERCIAL LA CENTRAL',
    'B19': 'CR 52 29A 161 Local 102', 'B20': 'CC COMERCIAL DE MODA', 'B22': 'CC COMERCIAL FLORIDA',
    'B23': 'CALLE 44 # 10 - 91 C-CIAL ALAMEDA', 'MOLINOS': 'CC COMERCIAL MOLINOS', 'PIONEROS': 'CC COMERCIAL PIONEROS',
    'BODEGA PIONEROS': 'CC COMERCIAL PIONEROS BODEGA',
    'BODVI': 'BODEGAS SAN BARTOLOME', 'GARANTIAS': 'CC COMERCIAL PIONEROS', 'TRYNO': 'CC COMERCIAL PIONEROS',
    'OFICINA': 'EDIFICIO NUEVO GUAYAQUIL', 'TRASLADOS': 'PIONEROS', 'B21': 'CL 11 # 60-03 LC 05 OULET DE LAS AMERICAS . PUENTE ARRANDA',
    'BODPP': 'BODEGAS SAN BARTOLOME'
};

const cityCodeMapping: { [key: string]: string } = {
    'B1': '05001', 'B2': '05001', 'B3': '05154', 'B4': '05001', 'B5': '05001',
    'B6': '05615', 'B7': '11001', 'B8': '05631', 'B9': '05088', 'B10': '05129',
    'B11': '05001', 'B12': '05001', 'B13': '05001', 'B14': '05631', 'B15': '05088',
    'B16': '05045', 'B17': '05001', 'B18': '05001', 'B19': '05001', 'B20': '05001',
    'B22': '05001', 'B23': '23001', 'MOLINOS': '05001', 'PIONEROS': '05001', 'BODEGA PIONEROS': '05001',
    'BODVI': '05380', 'GARANTIAS': '05001', 'TRYNO': '05001', 'OFICINA': '05001',
    'TRASLADOS': '05001', 'B21': '11001', 'BODPP': '05380'
};

const GEOGRAPHIC_CLUSTERS: Record<string, string[]> = {
    'FLORIDA': ['B11', 'B22'],
    'EXTREMO_NORTE': ['B15', 'B9']
};

const standardNorteRoute = [
    'TRASLADOS', 'BODEGA PIONEROS', 'PIONEROS', 'GARANTIAS', 'TRYNO', 'B5', 'B2', 'B4', 
    'SISTEMAS', 'OFICINA', 'RECEPCION', 'B12', 'MOLINOS', 'B1', 'B11', 'B22', 'B15', 'B9', 'B18', 'B13', 
    'B19 OUTLET', 'B19', 'B20'
];

// FIX: Corrected syntax error in norteFixedStart array by properly quoting strings and removing 'SMT' typo.
const norteFixedStart = [
    'TRASLADOS', 'BODEGA PIONEROS', 'PIONEROS', 'GARANTIAS', 'TRYNO', 'B5', 'B2', 'B4', 'SISTEMAS', 'OFICINA', 'RECEPCION'
];

const checkIsNorte = (name: string): boolean => {
    const n = String(name || '').toUpperCase();
    return n.includes('NORTE') || n.includes('N0RTE') || n.includes('MENSAJERO');
};

const exportToCustomCSV = (plan: VehiclePlan) => {
    const isNorteVehicle = checkIsNorte(plan.name);

    const dataToExport = plan.tasks.map((task, index) => {
        const isRecoger = task.type === 'RECOGER';
        
        let valorParaMapeo: string;
        if (task.observaciones && task.observaciones.startsWith("PARA ENTREGA EN ")) {
            const match = task.observaciones.match(/PARA ENTREGA EN ([^-\s]+)/);
            valorParaMapeo = match ? match[1] : (task.valor || '');
        } else if (task.observaciones && task.observaciones.startsWith("Sugerencia")) {
            const match = task.observaciones.match(/antes de "([^"]+)"/);
             valorParaMapeo = match ? match[1] : (task.valor || '');
        } else if (task.observaciones && task.observaciones.startsWith("Entrega de ítem recogido en: ")) {
            valorParaMapeo = task.observaciones.replace("Entrega de ítem recogido en: ", "");
        } else {
            valorParaMapeo = task.valor || '';
        }
        
        const nombreClienteBase = valorParaMapeo;
        const shouldAppendRForCliente = isRecoger && !isNorteVehicle && nombreClienteBase.toUpperCase() !== 'TRASLADOS';
        const nombreCliente = shouldAppendRForCliente ? `${nombreClienteBase}-R` : nombreClienteBase;
        
        const baseValorParaDoc = (task.valor || '').toUpperCase().replace(/-R$|-P$/, '');
        const numeroDocumentoRaw = docNumberMapping[baseValorParaDoc] || '';
        const shouldAppendRForDoc = isRecoger && !isNorteVehicle;
        const numeroDocumento = numeroDocumentoRaw && shouldAppendRForDoc ? `${numeroDocumentoRaw}-R` : numeroDocumentoRaw;

        const valorUbicacion = task.valor || '';
        const upperValorUbicacion = valorUbicacion.toUpperCase();
        const baseValorUbicacion = upperValorUbicacion.replace(/-R$|-P$/, '');

        let direccionCliente = '';
        if (upperValorUbicacion.endsWith('-P')) {
            direccionCliente = 'PIONEROS';
        } else {
            direccionCliente = addressMapping[baseValorUbicacion] || '';
        }

        let ciudad = '';
        if (upperValorUbicacion.endsWith('-P')) {
            ciudad = '05001';
        } else {
            ciudad = cityCodeMapping[baseValorUbicacion] || '';
        }
        
        const fecha = new Date();
        const year = fecha.getFullYear();
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');
        const fechaFormatted = `${year}-${month}-${day}`;
        
        const startTotalMinutes = 8 * 60 + 1;
        const currentTotalMinutes = startTotalMinutes + index;
        const hour = Math.floor(currentTotalMinutes / 60);
        const minute = currentTotalMinutes % 60;
        const horaInicio = `${hour}:${String(minute).padStart(2, '0')}`;
        
        const dayPrefix = String(new Date().getDate()).padStart(2, '0');
        const numeroServicio = isRecoger ? `${dayPrefix}-${task.tf}` : `${dayPrefix}-${task.tf}-E`;
        
        const tipoServicio = isRecoger ? '002' : '001';
        const recurso = isNorteVehicle ? 'MENSAJEROS' : task.vehiculo;

        return {
            'Nombre Cliente': nombreCliente,
            'Email Cliente': 'logistica2@tie NIT',
            'Tipo de documento': 'NIT',
            'Numero de documento': numeroDocumento,
            'Numero Telefonico': '3137379808',
            'Direccion Cliente': direccionCliente,
            'Ciudad': ciudad,
            'Barrio': '',
            'Quien recibe': '',
            'Fecha': fechaFormatted,
            'Tiempo de descarga': '',
            'Hora de inicio': horaInicio,
            'Hora de finalización': '',
            'Numero del servicio': numeroServicio,
            'Codigo CEDI': '001',
            'Codigo tienda que vende': '',
            'Peso': 1,
            'Direccion Servicio': direccionCliente,
            'Tipo de servicio': tipoServicio,
            'Observaciones': task.observaciones,
            'Recurso': recurso,
            'Longitud': '',
            'Zona': '',
            'Ventanas Horarias': '',
            'Recaudo': '',
            'Valor Flete': '',
            'Flete': '',
            'Método de pago': '',
            'Valor del pedido': '',
        };
    });

    if (dataToExport.length === 0) {
        alert('No hay tareas para exportar.');
        return;
    }

    const seenServiceNumbers = new Set<string>();
    const uniqueData = dataToExport.filter(row => {
        const serviceNumber = row['Numero del servicio'];
        if (serviceNumber && seenServiceNumbers.has(serviceNumber)) return false;
        if (serviceNumber) seenServiceNumbers.add(serviceNumber);
        return true;
    });

    if (uniqueData.length === 0) return;

    const headers = Object.keys(uniqueData[0]);
    const csvContent = [
        headers.join(';'),
        ...uniqueData.map(row => headers.map(header => {
            let cell = (row as any)[header] ?? '';
            cell = String(cell);
            if (cell.includes(';') || cell.includes('"') || cell.includes('\n')) {
                cell = `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
        }).join(';'))
    ].join('\n');

    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `plan_ruta_custom_${plan.name}_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
};

const exportNorteMessengerRoute = (plan: VehiclePlan) => {
    if (typeof XLSX === 'undefined') {
        alert('La librería de exportación (XLSX) no está disponible.');
        return;
    }

    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    const dataToExport = plan.tasks.map(task => ({
        'FECHA': formattedDate,
        'NUMERO TF': task.tf,
        'Atributo': task.type,
        'Valor': task.valor,
        'ORDEN': task.order,
        'FIRMA': '',
    }));
    
    if (dataToExport.length === 0) {
        alert('No hay tareas para exportar.');
        return;
    }
    
    try {
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Ruta Mensajero');
        const safeFileName = `RUTA_DEL_MENSAJERO_${year}-${month}-${day}.xlsx`;
        XLSX.writeFile(workbook, safeFileName);
    } catch (error) {
        console.error("Error al exportar a Excel:", error);
        alert("Ocurrió un error al intentar generar el archivo de Excel.");
    }
};

const DropIndicator: React.FC = () => (
    <div className="relative h-1 my-1 w-full">
        <div className="absolute inset-0 bg-green-500 rounded-full opacity-75"></div>
    </div>
);

// NUEVO SUB-COMPONENTE PARA MANEJAR EL INPUT NUMÉRICO SIN BLOQUEARSE
const OrderInput: React.FC<{
    initialValue: number;
    onOrderChange: (newValue: string) => void;
    max: number;
}> = ({ initialValue, onOrderChange, max }) => {
    const [localValue, setLocalValue] = useState(initialValue.toString());

    // Sincronizar valor local si cambia externamente (ej: drag and drop u optimización)
    useEffect(() => {
        setLocalValue(initialValue.toString());
    }, [initialValue]);

    const handleBlur = () => {
        if (localValue !== initialValue.toString()) {
            onOrderChange(localValue);
        }
    };

    return (
        <input
            type="number"
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={(e) => { 
                if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                }
            }}
            onBlur={handleBlur}
            min="1"
            max={max}
            className="w-10 p-1 text-center bg-slate-100 text-slate-700 font-bold rounded-md border-none focus:ring-2 focus:ring-green-500 cursor-pointer"
        />
    );
};

const RouteOrderer: React.FC<{
    initialAssignments: Map<string, string[]>;
    onPlanGenerated: (plan: Map<string, string[]>) => void;
    allTasks: RouteTask[];
}> = ({ initialAssignments, onPlanGenerated, allTasks }) => {
    const fixedSet = useMemo(() => new Set(norteFixedStart), []);
    
    const [orderedAssignments, setOrderedAssignments] = useState<Map<string, string[]>>(initialAssignments);
    const [dropIndicator, setDropIndicator] = useState<{ container: string; index: number } | null>(null);
    const [modalState, setModalState] = useState<{ isOpen: boolean; vehicle: string | null }>({ isOpen: false, vehicle: null });
    const [textOrder, setTextOrder] = useState('');

    const handleOpenModal = (vehicle: string) => setModalState({ isOpen: true, vehicle });
    const handleCloseModal = () => { setModalState({ isOpen: false, vehicle: null }); setTextOrder(''); };

    const handleApplyStandardNorteOrder = (vehicle: string) => {
        setOrderedAssignments(prev => {
            const newAssignments = new Map<string, string[]>(prev);
            const currentLocations = new Set<string>(newAssignments.get(vehicle) || []);
            const finalOrder = standardNorteRoute.filter(loc => currentLocations.has(loc));
            const standardSet = new Set<string>(standardNorteRoute);
            const missing = [...currentLocations].filter(loc => !standardSet.has(loc));
            newAssignments.set(vehicle, [...finalOrder, ...missing]);
            return newAssignments;
        });
    };

    // MOTOR DE OPTIMIZACIÓN DE RUTA MAESTRA (NORTE) - REVERSIBLE Y FLEXIBLE
    const norteOptimization = useMemo(() => {
        const vehicleName = Array.from(orderedAssignments.keys()).find(checkIsNorte);
        if (!vehicleName) return null;

        const currentOrder = [...(orderedAssignments.get(vehicleName) || [])];
        const tasks = allTasks.filter(t => t.vehiculo === vehicleName);
        
        const dependencies = new Map<string, string>();
        tasks.forEach(t => {
            if (t.type === 'RECOGER') {
                const delivery = tasks.find(d => d.tf === t.tf && d.type === 'ENTREGAR');
                if (delivery) dependencies.set(String(t.tf), t.valor!);
            }
        });

        const fixedPresent = norteFixedStart.filter(s => currentOrder.includes(s));
        const flexiblePresent = currentOrder.filter(s => !fixedSet.has(s));

        const getClusterInfo = (stop: string) => {
            for (const clusterName in GEOGRAPHIC_CLUSTERS) {
                const cluster = GEOGRAPHIC_CLUSTERS[clusterName];
                if (cluster.includes(stop)) return { name: clusterName, items: cluster };
            }
            return null;
        };

        const tryOptimizeSubBlock = (startOrder: string[], blockIsFixed: boolean) => {
            let order = [...startOrder];
            let safety = 0;
            while (safety < 30) {
                safety++;
                let changed = false;
                for (let i = 0; i < order.length; i++) {
                    const stop = order[i];
                    const depsAtStop = tasks.filter(t => t.valor === stop && t.type === 'ENTREGAR');
                    for (const d of depsAtStop) {
                        const pickupStore = dependencies.get(String(d.tf));
                        if (pickupStore) {
                            const pIdx = order.indexOf(pickupStore);
                            const currentIdx = i;
                            
                            // Solo optimizamos dependencias internas al bloque
                            if (pIdx !== -1 && pIdx > currentIdx) {
                                const pCluster = getClusterInfo(pickupStore);
                                const sCluster = getClusterInfo(stop);

                                if (pCluster && sCluster && pCluster.name === sCluster.name) {
                                    const clusterItems = order.filter(item => pCluster.items.includes(item));
                                    const minIdx = Math.min(...pCluster.items.map(s => order.indexOf(s)).filter(x => x !== -1));
                                    order.splice(minIdx, clusterItems.length, ...clusterItems.reverse());
                                    changed = true;
                                } else {
                                    const itemsToMove = pCluster ? order.filter(it => pCluster.items.includes(it)) : [pickupStore];
                                    const insertBeforeIdx = sCluster ? Math.min(...sCluster.items.map(s => order.indexOf(s)).filter(x => x !== -1)) : currentIdx;
                                    
                                    const newOrder = order.filter(it => !itemsToMove.includes(it));
                                    newOrder.splice(insertBeforeIdx, 0, ...itemsToMove);
                                    order = newOrder;
                                    changed = true;
                                }
                                break;
                            }
                        }
                    }
                    if (changed) break;
                }
                if (!changed) break;
            }
            return order;
        };

        const countFailures = (order: string[]) => {
            let failures = 0;
            tasks.forEach(t => {
                if (t.type === 'ENTREGAR') {
                    const pickupStore = dependencies.get(String(t.tf));
                    if (pickupStore) {
                        const pIdx = order.indexOf(pickupStore);
                        const dIdx = order.indexOf(t.valor!);
                        if (pIdx === -1 || pIdx >= dIdx) failures++;
                    }
                }
            });
            return failures;
        };

        const optimizedFixed = tryOptimizeSubBlock([...fixedPresent], true);
        const baseFlexible = tryOptimizeSubBlock([...flexiblePresent], false);
        const reversedFlexible = tryOptimizeSubBlock([...flexiblePresent].reverse(), false);

        const proposedA = [...optimizedFixed, ...baseFlexible];
        const proposedB = [...optimizedFixed, ...reversedFlexible];

        const failA = countFailures(proposedA);
        const failB = countFailures(proposedB);

        const finalProposed = failA <= failB ? proposedA : proposedB;
        const currentFailures = countFailures(currentOrder);
        const proposedFailures = Math.min(failA, failB);
        const deliveriesOptimized = Math.max(0, currentFailures - proposedFailures);

        const orderChanged = JSON.stringify(currentOrder) !== JSON.stringify(finalProposed);

        return { 
            vehicleName, 
            finalProposed, 
            deliveriesOptimized,
            currentFailures,
            proposedFailures,
            orderChanged,
            totalTasks: tasks.filter(t => t.type === 'ENTREGAR').length
        };
    }, [orderedAssignments, allTasks, fixedSet]);

    const handleApplyOptimization = () => {
        if (!norteOptimization) return;
        setOrderedAssignments(prev => {
            const newMap = new Map<string, string[]>(prev);
            newMap.set(norteOptimization.vehicleName, norteOptimization.finalProposed);
            return newMap;
        });
    };

    const handleApplyTextOrder = () => {
        if (!modalState.vehicle) return;
        const vehicle = modalState.vehicle;
        const pastedOrder = textOrder.split(/[,;\n\r\t]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
        if (pastedOrder.length === 0) { handleCloseModal(); return; }
        setOrderedAssignments(prev => {
            const newAssignments = new Map<string, string[]>(prev);
            const currentLocations = (newAssignments.get(vehicle) || []) as string[];
            const pastedOrderSet = new Set<string>(pastedOrder);
            const locationsNotInPastedOrder = [...new Set<string>(currentLocations)].filter((loc: string) => !pastedOrderSet.has(loc.toUpperCase()));
            newAssignments.set(vehicle, [...pastedOrder, ...locationsNotInPastedOrder]);
            return newAssignments;
        });
        handleCloseModal();
    };
    
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, valor: string, sourceContainer: string) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ valor, sourceContainer }));
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, targetContainer: string) => {
        e.preventDefault();
        const targetItem = (e.target as HTMLElement).closest('[data-is-draggable-item="true"]');
        let insertIndex = (orderedAssignments.get(targetContainer) || []).length;
        if (targetItem) {
            const rect = targetItem.getBoundingClientRect();
            const index = parseInt(targetItem.getAttribute('data-index') || '0', 10);
            insertIndex = (e.clientY > rect.top + rect.height / 2) ? index + 1 : index;
        }
        if (dropIndicator?.container !== targetContainer || dropIndicator?.index !== insertIndex) {
            setDropIndicator({ container: targetContainer, index: insertIndex });
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetContainer: string) => {
        e.preventDefault(); setDropIndicator(null);
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        const { valor, sourceContainer } = data;
        if (sourceContainer !== targetContainer) return;
        const insertIndex = dropIndicator ? dropIndicator.index : (orderedAssignments.get(targetContainer) || []).length;
        setOrderedAssignments(prev => {
            const newAssignments = new Map(prev);
            const sourceList = ((newAssignments.get(sourceContainer) || []) as string[]).filter(v => v !== valor);
            sourceList.splice(insertIndex > sourceList.length ? sourceList.length : insertIndex, 0, valor);
            newAssignments.set(sourceContainer, sourceList);
            return newAssignments;
        });
    };

    const handleOrderChange = (vehiculo: string, valorToMove: string, newPositionStr: string) => {
        setOrderedAssignments(prev => {
            const newAssignments = new Map<string, string[]>(prev);
            const list = Array.from((newAssignments.get(vehiculo) || []) as string[]);
            const newPosition = parseInt(newPositionStr, 10);
            if (isNaN(newPosition) || newPosition < 1 || newPosition > list.length) return prev;
            const currentIndex = list.indexOf(valorToMove);
            if (currentIndex === -1 || (currentIndex === newPosition - 1)) return prev;
            const [item] = list.splice(currentIndex, 1);
            list.splice(newPosition - 1, 0, item);
            newAssignments.set(vehiculo, list);
            return newAssignments;
        });
    };

    return (
        <section className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4 border-b pb-3 justify-between">
                <div className="flex items-center">
                    <SortAscIcon className="h-7 w-7 text-green-600 mr-3" />
                    <h2 className="text-2xl font-bold text-gray-800">Paso 2: Ordenar Visitas por Vehículo</h2>
                </div>
            </div>

            {norteOptimization && (
                <div className={`mb-6 border-2 rounded-xl p-5 flex items-center justify-between shadow-sm transition-all duration-300 ${norteOptimization.deliveriesOptimized > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                    <div className="flex items-center">
                        <div className={`p-2 rounded-full mr-4 ${norteOptimization.deliveriesOptimized > 0 ? 'bg-amber-100' : 'bg-green-100'}`}>
                            {norteOptimization.deliveriesOptimized > 0 ? <AlertTriangleIcon className="h-6 w-6 text-amber-600" /> : <CheckCircleIcon className="h-6 w-6 text-green-600" />}
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900">
                                {norteOptimization.deliveriesOptimized > 0 ? '¡Optimización Recomendada!' : 'Orden Actual Optimizado'}
                            </h3>
                            <p className="text-sm text-gray-700">
                                {norteOptimization.deliveriesOptimized > 0 
                                    ? `Tu orden actual deja de entregar ${norteOptimization.deliveriesOptimized} unidades que podrían ser entregadas hoy.` 
                                    : `Felicidades, tu secuencia permite la entrega de ${norteOptimization.totalTasks - norteOptimization.currentFailures} unidades.`}
                                {norteOptimization.deliveriesOptimized > 0 && (
                                    <span className="block font-black text-amber-700 mt-1 uppercase text-[10px]">Aplica la propuesta para recuperar las entregas perdidas.</span>
                                )}
                            </p>
                        </div>
                    </div>
                    {norteOptimization.deliveriesOptimized > 0 && (
                        <button onClick={handleApplyOptimization} className="bg-amber-600 text-white font-bold py-2.5 px-6 rounded-lg hover:bg-amber-700 transition-all flex items-center shadow-lg active:scale-95">
                            <CheckCircleIcon className="h-5 w-5 mr-2" /> Aplicar Propuesta Optimizada
                        </button>
                    )}
                </div>
            )}
            
            <p className="text-sm text-gray-600 mb-6">Define el orden usando el botón de importar (📋), el orden estándar (🚚⭐) o editando los números manualmente.</p>
            
            <div className="overflow-x-auto pb-4">
                <div className="flex gap-6">
                    {Array.from(orderedAssignments.entries()).map(([vehiculo, valores]) => {
                         const isNorte = checkIsNorte(vehiculo);
                         return (
                            <div key={vehiculo} className={`bg-slate-50 p-4 rounded-lg border ${isNorte ? 'border-blue-400 ring-2 ring-blue-50' : 'border-gray-200'} w-[350px] flex-shrink-0 flex flex-col`}>
                                <div className="flex justify-between items-center gap-2 mb-3 pb-3 border-b border-slate-200">
                                    <div className="flex items-center gap-2">
                                        <TruckIcon className={`h-5 w-5 ${isNorte ? 'text-blue-600' : 'text-slate-700'}`} />
                                        <h4 className="font-semibold text-gray-800">{vehiculo} ({valores.length})</h4>
                                    </div>
                                    <div className="flex gap-1">
                                        {isNorte && (
                                            <button onClick={() => handleApplyStandardNorteOrder(vehiculo)} className="p-2 rounded-full text-blue-700 hover:bg-blue-100 transition-colors" title="Cargar Orden Estándar Norte">
                                                <span role="img" aria-label="norte" className="text-lg">🚚⭐</span>
                                            </button>
                                        )}
                                        <button onClick={() => handleOpenModal(vehiculo)} className="p-2 rounded-full text-blue-600 hover:bg-blue-100 transition-colors" title="Importar orden personalizado">
                                            <ClipboardPasteIcon className="h-5 w-5"/>
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2 flex-grow overflow-y-auto min-h-[200px]" style={{maxHeight: '50vh'}} onDragOver={(e) => handleDragOver(e, vehiculo)} onDragLeave={() => setDropIndicator(null)} onDrop={(e) => handleDrop(e, vehiculo)}>
                                    {valores.map((val, index) => {
                                        const isFixed = isNorte && fixedSet.has(val);
                                        let clusterColor = '';
                                        if (GEOGRAPHIC_CLUSTERS['FLORIDA'].includes(val)) clusterColor = 'border-l-teal-500';
                                        if (GEOGRAPHIC_CLUSTERS['EXTREMO_NORTE'].includes(val)) clusterColor = 'border-l-indigo-500';

                                        return (
                                            <React.Fragment key={`${vehiculo}-${val}-${index}`}>
                                                {dropIndicator?.container === vehiculo && dropIndicator.index === index && <DropIndicator />}
                                                <div draggable onDragStart={(e) => handleDragStart(e, val, vehiculo)} onDragEnd={() => setDropIndicator(null)} className={`p-2 bg-white border rounded-md shadow-sm flex items-center gap-3 ${isFixed ? 'border-l-4 border-l-blue-500 ring-1 ring-blue-50' : (clusterColor ? `border-l-4 ${clusterColor}` : 'border-gray-300')}`} data-is-draggable-item="true" data-index={index}>
                                                    <OrderInput 
                                                        initialValue={index + 1} 
                                                        max={valores.length} 
                                                        onOrderChange={(newVal) => handleOrderChange(vehiculo, val, newVal)} 
                                                    />
                                                    <GripVerticalIcon className="h-5 w-5 text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0" />
                                                    <span className={`font-medium text-[11px] truncate ${isFixed ? 'text-blue-800 font-bold' : 'text-gray-700'}`}>{val}</span>
                                                    {isFixed && <span className="text-[8px] font-black text-blue-600 ml-auto border border-blue-200 px-1 rounded bg-blue-50">TRAMO INICIAL</span>}
                                                    {!isFixed && clusterColor && <span className="text-[7px] font-black text-gray-400 ml-auto">PROXIMIDAD</span>}
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}
                                    {dropIndicator?.container === vehiculo && dropIndicator.index === valores.length && <DropIndicator />}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="mt-6 text-right">
                <button onClick={() => onPlanGenerated(orderedAssignments)} className="inline-flex items-center justify-center px-6 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500">
                    Generar Plan de Ruta <ArrowRightIcon className="h-5 w-5 ml-2" />
                </button>
            </div>
            {modalState.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50" onClick={handleCloseModal}>
                    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800 mb-4">Importar Orden para <span className="text-green-600">{modalState.vehicle}</span></h3>
                        <textarea className="w-full h-32 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500" value={textOrder} onChange={(e) => setTextOrder(e.target.value)} placeholder="B12, MOLINOS, B1..." autoFocus />
                        <div className="mt-6 flex justify-end gap-3">
                            <button onClick={handleCloseModal} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md">Cancelar</button>
                            <button onClick={handleApplyTextOrder} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700">Aplicar Orden</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};


const TaskCard: React.FC<{ task: RouteTask }> = ({ task }) => {
    const isPickup = task.type === 'RECOGER';
    return (
        <div id={task.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex items-start gap-3 mb-2">
            <GripVerticalIcon className="h-5 w-5 text-gray-400 mt-1 flex-shrink-0" />
            <div className="flex-grow">
                <p className={`font-bold text-gray-800 ${isPickup ? 'text-emerald-700' : 'text-sky-700'}`}>
                    {task.type}: <span className="font-mono">{task.tf}</span>
                </p>
                {task.valor && <p className="font-semibold text-sm text-gray-700 mt-1">{task.valor}</p>}
                {task.observaciones && (
                    <div className={`text-[10px] mt-1 p-1.5 rounded ${task.observaciones.includes("Sugerencia") || task.observaciones.includes("pendiente") ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'text-gray-500 italic'}`}>
                        {task.observaciones}
                    </div>
                )}
                {task.loadWarning && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-[11px] font-bold text-red-700 flex items-center gap-1.5 animate-pulse">
                        <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[9px]">ALERTA</span>
                        {task.loadWarning}
                    </div>
                )}
                {task.runningLoad !== undefined && (
                    <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-grow bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className={`h-full transition-all duration-500 ${task.runningLoad > 25 ? 'bg-red-500' : task.runningLoad > 20 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(100, (task.runningLoad / 25) * 100)}%` }}
                            />
                        </div>
                        <span className={`text-[10px] font-mono font-bold ${task.runningLoad > 25 ? 'text-red-600' : 'text-gray-500'}`}>
                            {task.runningLoad}/25
                        </span>
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 ml-2 w-16 flex justify-center items-center">
                 {task.order !== undefined && task.vehiculo.toUpperCase() !== 'TAREAS SIN ASIGNAR' && (
                    <span className="flex items-center justify-center w-8 h-8 bg-slate-200 text-slate-600 text-sm font-bold rounded-full">{task.order}</span>
                )}
            </div>
        </div>
    );
};

const VehicleColumn: React.FC<{
    plan: VehiclePlan;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, taskId: string, vehicleName: string) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>, targetVehicle: string) => void;
    onAddTask: (vehicleName: string) => void;
}> = ({ plan, onDragStart, onDragOver, onDrop, onAddTask }) => {
    const isAssignable = plan.name.toUpperCase() !== 'TAREAS SIN ASIGNAR';
    const isNorteVehicle = checkIsNorte(plan.name);
    return (
        <div className={`bg-slate-100 rounded-xl w-[380px] flex-shrink-0 flex flex-col shadow-md ${isNorteVehicle ? 'border-t-4 border-blue-500' : ''}`} onDragOver={onDragOver} onDrop={(e) => onDrop(e, plan.name)}>
            <div className="p-4 border-b border-slate-200 space-y-3">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {isAssignable ? <TruckIcon className={`h-6 w-6 ${isNorteVehicle ? 'text-blue-600' : 'text-slate-700'}`} /> : <FileClockIcon className="h-6 w-6 text-gray-500" />}
                        <h3 className="font-bold text-lg text-slate-800">{plan.name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {isAssignable && (
                             <button onClick={() => onAddTask(plan.name)} className="p-2 rounded-full text-green-600 hover:bg-green-100">
                                <PlusCircleIcon className="h-6 w-6" />
                            </button>
                        )}
                        <span className="text-sm font-semibold bg-slate-200 text-slate-600 rounded-full px-2.5 py-1">{plan.tasks.length}</span>
                    </div>
                </div>
                {isNorteVehicle && plan.tasks.length > 0 && (
                    <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>Estado de Carga</span>
                            <span>{plan.tasks[plan.tasks.length - 1].runningLoad || 0} / 25 TFs</span>
                        </div>
                        <div className="h-2 bg-white rounded-full border border-slate-200 overflow-hidden shadow-inner">
                            <div 
                                className={`h-full transition-all duration-500 ${(plan.tasks[plan.tasks.length - 1].runningLoad || 0) > 25 ? 'bg-red-500' : (plan.tasks[plan.tasks.length - 1].runningLoad || 0) > 20 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(100, ((plan.tasks[plan.tasks.length - 1].runningLoad || 0) / 25) * 100)}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
            <div className="p-3 space-y-1 overflow-y-auto flex-grow" style={{maxHeight: 'calc(100vh - 400px)'}}>
                {plan.tasks.map(task => (
                     <div key={task.id} draggable onDragStart={(e) => onDragStart(e, task.id, plan.name)} className="cursor-grab active:cursor-grabbing">
                        <TaskCard task={task} />
                    </div>
                ))}
            </div>
            {isAssignable && (
                <div className="p-3 border-t border-slate-200 mt-auto flex flex-col gap-2">
                     <button onClick={() => exportToCustomCSV(plan)} className="w-full inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50" disabled={plan.tasks.length === 0}>
                        <DownloadIcon className="h-4 w-4 mr-2" /> Exportar Plan (CSV)
                    </button>
                    {isNorteVehicle && (
                         <button onClick={() => exportNorteMessengerRoute(plan)} className="w-full inline-flex items-center justify-center px-3 py-1.5 border border-blue-500 shadow-sm text-sm font-medium rounded-md text-blue-600 bg-white hover:bg-blue-50 disabled:opacity-50" disabled={plan.tasks.length === 0}>
                            <DownloadIcon className="h-4 w-4 mr-2" /> Exportar Ruta Mensajero (Excel)
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const AddTaskModal: React.FC<{
    isOpen: boolean;
    vehicleName: string | null;
    onClose: () => void;
    onSubmit: (data: { tf: string; valor: string; type: 'ENTREGAR' | 'RECOGER'; seEnviaCon: string; observaciones: string }) => void;
}> = ({ isOpen, vehicleName, onClose, onSubmit }) => {
    const [tf, setTf] = useState('');
    const [valor, setValor] = useState('');
    const [type, setType] = useState<'ENTREGAR' | 'RECOGER'>('ENTREGAR');
    const [seEnviaCon, setSeEnviaCon] = useState('');
    const [observaciones, setObservaciones] = useState('');

    useEffect(() => { if (isOpen) { setTf(''); setValor(''); setType('ENTREGAR'); setSeEnviaCon(''); setObservaciones(''); } }, [isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!tf.trim() || !valor.trim()) { alert('TF y Ubicación son obligatorios.'); return; }
        onSubmit({ tf: tf.trim(), valor: valor.trim(), type, seEnviaCon: seEnviaCon.trim(), observaciones: observaciones.trim() });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <h3 className="text-xl font-bold text-gray-800 mb-4">Añadir Tarea Manual a <span className="text-green-600">{vehicleName}</span></h3>
                    <div className="space-y-4">
                        <input type="text" value={tf} onChange={e => setTf(e.target.value)} placeholder="Número TF *" className="w-full px-3 py-2 border rounded-md" />
                        <input type="text" value={valor} onChange={e => setValor(e.target.value)} placeholder="Ubicación *" className="w-full px-3 py-2 border rounded-md" />
                        <div className="flex gap-4">
                            <label className="inline-flex items-center"><input type="radio" value="ENTREGAR" checked={type === 'ENTREGAR'} onChange={() => setType('ENTREGAR')} /><span className="ml-2">Entregar</span></label>
                            <label className="inline-flex items-center"><input type="radio" value="RECOGER" checked={type === 'RECOGER'} onChange={() => setType('RECOGER')} /><span className="ml-2">Recoger</span></label>
                        </div>
                        <input type="text" value={seEnviaCon} onChange={e => setSeEnviaCon(e.target.value)} placeholder="Se envía con..." className="w-full px-3 py-2 border rounded-md" />
                        <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Observaciones" className="w-full px-3 py-2 border rounded-md" />
                    </div>
                    <div className="mt-8 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-md">Cancelar</button>
                        <button type="submit" className="px-4 py-2 bg-green-600 text-white font-semibold rounded-md">Añadir Tarea</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const RutasModule: React.FC = () => {
    const [view, setView] = useState<'initial' | 'ordering' | 'planning'>('initial');
    const [mainTasks, setMainTasks] = useState<RouteTask[]>([]);
    const [additionalTasks, setAdditionalTasks] = useState<RouteTask[]>([]);
    const [mainFileName, setMainFileName] = useState<string | null>(null);
    const [additionalFileNames, setAdditionalFileNames] = useState<string[]>([]);
    const [isMainLoading, setIsMainLoading] = useState(false);
    const [isAdditionalLoading, setIsAdditionalLoading] = useState(false);

    const [allTasks, setAllTasks] = useState<RouteTask[]>([]);
    const [initialAssignments, setInitialAssignments] = useState<Map<string, string[]>>(new Map());
    const [valorOrderMap, setValorOrderMap] = useState<Map<string, string[]>>(new Map());
    const [vehiclePlans, setVehiclePlans] = useState<VehiclePlan[]>([]);
    const [addTaskModal, setAddTaskModal] = useState<{ isOpen: boolean; vehicleName: string | null }>({ isOpen: false, vehicleName: null });

    const processFile = (file: File, isMainFile: boolean) => {
        return new Promise<RouteTask[]>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target!.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
                    const jsonData: ExcelDataRow[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                    if (jsonData.length === 0) throw new Error("Archivo vacío.");
                    const headers = Object.keys(jsonData[0] || {});
                    const vehCol = findHeader(headers, ['VEHICULO', 'VEHIVULO', 'VEHICULO ASIGNADO', 'PLACA', 'CONDUCTOR', 'MENSAJERO', 'RECURSO', 'MOVIL', 'MOTO', 'RUTA', 'NORTE', 'MENS NORTE', 'RUTA NORTE', 'VEHICULO NORTE', 'ZONA', 'TIPO RECURSO', 'RECURSO ASIGNADO', 'VEH', 'COND', 'PLACA VEHICULO', 'CONDUCTOR ASIGNADO', 'VEHICUL', 'VEHIVUL']);
                    const norteColFallback = findHeader(headers, ['NORTE', 'ES NORTE', 'NORTE?', 'ES_NORTE', 'ZONA NORTE', 'NORT', 'MENS NORTE', 'RUTA NORTE']);
                    const tfCol = findHeader(headers, ['NUMERO TF', 'TF', 'NRO TF', 'NRO DOCUMENTO.2', 'NRO DOCUMENTO.', 'DOCUMENTO', 'PEDIDO', 'REMISION', 'ORDEN', 'TF#', 'NUMERO', 'DOC', 'NRO DOC', 'GUIA', 'GUÍA']);
                    const valCol = findHeader(headers, ['Valor', 'VALOR', 'Ubicacion', 'UBICACIÓN', 'DESTINO', 'BODEGA', 'TIENDA', 'CLIENTE', 'NOMBRE CLIENTE', 'PUNTO', 'DESTINATARIO', 'LUGAR', 'DIRECCIÓN', 'DIRECCION', 'BOD', 'HACIA', 'PARA', 'CIUDAD', 'TELÉFONO', 'TELEFONO']);
                    let typeCol = findHeader(headers, ['Atributo', 'TIPO', 'TIPO SERVICIO', 'MOVIMIENTO', 'ACCION', 'TIPO DE SERVICIO', 'TIPO DOCUMENTO', 'OPERACION', 'TIPO_MOVIMIENTO', 'RECOGER', 'ENTREGAR']);
                    
                    // Fallback: Si no se encuentra por nombre, buscar por contenido en la primera fila
                    if (!typeCol && jsonData.length > 0) {
                        for (const header of headers) {
                            const firstVal = String(jsonData[0][header] || '').toUpperCase().trim();
                            if (firstVal === 'RECOGER' || firstVal === 'ENTREGAR' || firstVal === 'R' || firstVal === 'E') {
                                typeCol = header;
                                break;
                            }
                        }
                    }

                    const obsCol = findHeader(headers, ['OBSERVACIONES', 'Observación', 'NOTAS', 'DETALLE', 'OBS']);
                    const codeCol = findHeader(headers, ['CÓDIGO', 'CODIGO', 'ID', 'REF', 'SKU']);

                    if (!tfCol) throw new Error("No se encontró la columna de documento (TF, Guía, etc.). Revise el archivo.");
                    if (!valCol) throw new Error("No se encontró la columna de ubicación o destinatario. Revise el archivo.");
                    resolve(jsonData.map((row, i) => {
                        const obsValue = obsCol ? String(row[obsCol!] || '').trim() : '';
                        const codeValue = codeCol ? String(row[codeCol!] || '').trim() : '';
                        const combinedObs = [obsValue, codeValue].filter(Boolean).join(' - ');

                        let rawVeh = vehCol ? String(row[vehCol] || '').trim() : '';
                        const normalizedVehCol = (vehCol || '').toUpperCase();

                        if (!rawVeh && norteColFallback) {
                            const norteVal = String(row[norteColFallback] || '').toUpperCase().trim();
                            if (norteVal === 'X' || norteVal === 'SI' || norteVal === '1' || norteVal === 'NORTE' || norteVal === 'VERDADERO' || norteVal === 'TRUE' || norteVal === 'S' || norteVal === 'Y') {
                                rawVeh = 'NORTE';
                            }
                        }

                        let vehiculo = (normalizedVehCol === 'NORTE' && (rawVeh.toUpperCase() === 'X' || rawVeh.toUpperCase() === 'SI' || rawVeh === '1' || rawVeh.toUpperCase() === 'NORTE')) ? 'NORTE' : rawVeh;
                        
                        if (!vehiculo) vehiculo = 'TAREAS SIN ASIGNAR';

                        const valor = String(row[valCol!] || '').toUpperCase().trim();
                        const normalizedTypeCol = (typeCol || '').toUpperCase();
                        const rawType = String(row[typeCol!] || '').toUpperCase().trim();
                        let taskType: 'RECOGER' | 'ENTREGAR' = 'ENTREGAR';
                        
                        // Los traslados siempre son recoger
                        if (valor === 'TRASLADOS') {
                            taskType = 'RECOGER';
                        } else if (rawType.includes('RECOGER') || rawType.includes('RECOGIDA') || rawType.includes('RECOLECCION') || rawType.includes('RECOLECCIÓN') || rawType.includes('PICKUP') || rawType.includes('RECOLECC') || rawType === 'R') {
                            taskType = 'RECOGER';
                        } else if (rawType.includes('ENTREGAR') || rawType.includes('ENTREGA') || rawType.includes('DELIVERY') || rawType === 'E') {
                            taskType = 'ENTREGAR';
                        } else if (normalizedTypeCol.includes('RECOGER') || normalizedTypeCol.includes('RECOGIDA') || normalizedTypeCol.includes('PICKUP')) {
                            if (rawType === 'X' || rawType === 'SI' || rawType === '1' || rawType === 'TRUE' || rawType === 'S') taskType = 'RECOGER';
                        } else if (normalizedTypeCol.includes('ENTREGAR') || normalizedTypeCol.includes('ENTREGA')) {
                            if (rawType === 'X' || rawType === 'SI' || rawType === '1' || rawType === 'TRUE' || rawType === 'S') taskType = 'ENTREGAR';
                        } else if (!isMainFile) {
                            taskType = 'ENTREGAR';
                        } else if (isMainFile && !rawType) {
                            taskType = 'ENTREGAR';
                        }

                        return {
                            id: `${isMainFile ? 'm' : 'a'}-${i}-${row[tfCol!]}`,
                            vehiculo: vehiculo,
                            tf: String(row[tfCol!] || '').trim(),
                            valor: valor,
                            seEnviaCon: '',
                            observaciones: combinedObs,
                            type: taskType
                        };
                    }).filter(t => t.tf && t.valor));
                } catch (err) { reject(err); }
            };
            reader.readAsArrayBuffer(file);
        });
    };

    const handleContinueToOrdering = () => {
        // Combinamos las tareas principales y las adicionales
        const combined = [...mainTasks, ...additionalTasks.filter(t => !mainTasks.find(m => m.vehiculo === t.vehiculo && m.tf === t.tf && m.type === t.type))];
        setAllTasks(combined);
        const map = new Map<string, string[]>();
        combined.forEach(t => {
            if (!map.has(t.vehiculo)) map.set(t.vehiculo, []);
            if (!map.get(t.vehiculo)!.includes(t.valor!)) map.get(t.vehiculo)!.push(t.valor!);
        });
        setInitialAssignments(map); setView('ordering');
    };

    const generateFinalPlans = (tasks: RouteTask[], stopMap: Map<string, string[]>) => {
        const plans: VehiclePlan[] = [];
        const tasksByVeh = new Map<string, RouteTask[]>();
        tasks.forEach(t => {
            const v = t.vehiculo || 'TAREAS SIN ASIGNAR';
            if (!tasksByVeh.has(v)) tasksByVeh.set(v, []);
            tasksByVeh.get(v)!.push(t);
        });

        stopMap.forEach((stops, vName) => {
            // Los traslados siempre van de primero
            const trasladosIdx = stops.indexOf('TRASLADOS');
            if (trasladosIdx > 0) {
                stops.splice(trasladosIdx, 1);
                stops.unshift('TRASLADOS');
            }

            const isNorte = checkIsNorte(vName);
            const plan: VehiclePlan = { name: vName, tasks: [] };
            const vTasks = tasksByVeh.get(vName) || [];
            
            const tfPickups = new Map<string, string>();
            vTasks.forEach(t => { if (t.type === 'RECOGER') tfPickups.set(String(t.tf), t.valor!); });

            const invalidDeliveries: RouteTask[] = [];
            const validByLoc = new Map<string, RouteTask[]>();

            vTasks.forEach(task => {
                if (task.type === 'ENTREGAR' && tfPickups.has(String(task.tf))) {
                    const pickupLoc = tfPickups.get(String(task.tf))!;
                    const pIdx = stops.indexOf(pickupLoc);
                    const dIdx = stops.indexOf(task.valor!);
                    if (pIdx === -1 || pIdx > dIdx) {
                        invalidDeliveries.push({
                            ...task,
                            observaciones: `Entrega pendiente de ítem recogido en: ${pickupLoc} PARA ENTREGA EN ${task.valor}`,
                            valor: isNorte ? 'CAJON NORTE' : 'BODEGA'
                        });
                        return;
                    }
                }
                if (!validByLoc.has(task.valor!)) validByLoc.set(task.valor!, []);
                validByLoc.get(task.valor!)!.push(task);
            });

            stops.forEach(s => {
                const atStop = validByLoc.get(s);
                if (atStop) {
                    // Ordenar: TRASLADOS primero, luego ENTREGAR, luego RECOGER
                    plan.tasks.push(...atStop.sort((a, b) => {
                        if (a.valor === 'TRASLADOS' && b.valor !== 'TRASLADOS') return -1;
                        if (b.valor === 'TRASLADOS' && a.valor !== 'TRASLADOS') return 1;
                        if (a.type === 'ENTREGAR' && b.type === 'RECOGER') return -1;
                        if (a.type === 'RECOGER' && b.type === 'ENTREGAR') return 1;
                        return 0;
                    }));
                }
            });

            if (invalidDeliveries.length > 0) {
                plan.tasks.push(...invalidDeliveries.sort((a,b) => a.observaciones.localeCompare(b.observaciones)));
            }

            let runningLoad = 0;
            const CAPACITY_LIMIT = 25;

            plan.tasks.forEach((t, i) => {
                const prevLoad = runningLoad;
                if (t.type === 'RECOGER') {
                    if (runningLoad >= CAPACITY_LIMIT) {
                        t.loadWarning = `CAPACIDAD MÁXIMA ALCANZADA: No hay espacio para más TF(s).`;
                    } else if (runningLoad + 1 > CAPACITY_LIMIT) {
                        // This case is unlikely if we use >= CAPACITY_LIMIT but added for robustness
                        t.loadWarning = `CAPACIDAD LIMITADA: Solo queda cupo para ${CAPACITY_LIMIT - runningLoad} unidad(es).`;
                    }
                    runningLoad += 1;
                } else if (t.type === 'ENTREGAR') {
                    runningLoad = Math.max(0, runningLoad - 1);
                }
                
                t.runningLoad = runningLoad;
                t.order = i + 1;
            });

            if (plan.tasks.length > 0) plans.push(plan);
        });

        const assignedIds = new Set(plans.flatMap(p => p.tasks.map(t => t.id)));
        const unassigned = tasks.filter(t => !assignedIds.has(t.id));
        if (unassigned.length > 0) plans.push({ name: 'TAREAS SIN ASIGNAR', tasks: unassigned });
        return plans.sort((a,b) => a.name === 'TAREAS SIN ASIGNAR' ? 1 : a.name.localeCompare(b.name));
    };

    const handlePlanGenerated = (map: Map<string, string[]>) => { 
        setValorOrderMap(map); 
        setVehiclePlans(generateFinalPlans(allTasks, map)); 
        setView('planning'); 
    };

    return (
        <div className="space-y-8">
            {view === 'initial' && (
                 <section className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-4">Cargar Archivos de Ruta</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="flex flex-col space-y-2">
                            <FileUpload onFileProcess={f => { 
                                setIsMainLoading(true); 
                                setMainFileName(f.name); 
                                processFile(f, true)
                                    .then(tasks => { setMainTasks(tasks); setIsMainLoading(false); })
                                    .catch((err) => { 
                                        alert("Error en Reporte Principal: " + (err.message || err));
                                        setIsMainLoading(false); 
                                        setMainFileName(null);
                                    }); 
                            }} isLoading={isMainLoading} fileName={mainFileName} mainText="Reporte Principal" subText=".xlsx, .xls" loadedSubText="Cargado." />
                            <button onClick={generateMainRouteTemplate} className="text-xs text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1 py-1 transition-colors">
                                <DownloadIcon className="h-3 w-3" /> Descargar Plantilla Principal (.xlsx)
                            </button>
                        </div>
                        <div className="flex flex-col space-y-2">
                            <FileUpload onFilesProcess={fs => { 
                                setIsAdditionalLoading(true); 
                                setAdditionalFileNames(fs.map(f => f.name)); 
                                Promise.all(fs.map(f => processFile(f, false)))
                                    .then(res => { setAdditionalTasks(res.flat()); setIsAdditionalLoading(false); })
                                    .catch((err) => { 
                                        alert("Error en Entregas Adicionales: " + (err.message || err));
                                        setIsAdditionalLoading(false); 
                                        setAdditionalFileNames([]);
                                    }); 
                            }} isLoading={isAdditionalLoading} fileNames={additionalFileNames} multiple={true} mainText="Entregas Adicionales" subText="Múltiples archivos" loadedSubText="Cargados." />
                            <button onClick={generateAdditionalRouteTemplate} className="text-xs text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1 py-1 transition-colors">
                                <DownloadIcon className="h-3 w-3" /> Descargar Plantilla Adicionales (.xlsx)
                            </button>
                        </div>
                    </div>
                    {(mainTasks.length > 0 || additionalTasks.length > 0) && (
                        <div className="mt-8 text-center">
                            <button onClick={handleContinueToOrdering} className="px-8 py-3 bg-green-600 text-white rounded-md font-medium hover:bg-green-700">
                                Continuar <ArrowRightIcon className="h-5 w-5 ml-3 inline" />
                            </button>
                        </div>
                    )}
                </section>
            )}

            {view === 'ordering' && <RouteOrderer initialAssignments={initialAssignments} onPlanGenerated={handlePlanGenerated} allTasks={allTasks} />}
            
            {view === 'planning' && (
                <section className="bg-white rounded-lg shadow-lg p-6">
                    <div className="flex justify-between items-center mb-6 border-b pb-3 flex-wrap gap-2">
                        <h2 className="text-2xl font-bold text-gray-800">Plan de Ruta Maestro</h2>
                        <div className="flex gap-2">
                            <button onClick={() => generateCajonReportPdf(vehiclePlans)} className="flex items-center px-4 py-2 border-2 border-amber-500 text-amber-700 font-bold rounded-md hover:bg-amber-50 transition-all">
                                <AlertTriangleIcon className="h-5 w-5 mr-2" /> Reporte de Cajón
                            </button>
                            <button onClick={() => generateVehiclePlanPdf(vehiclePlans)} className="flex items-center px-4 py-2 border border-red-500 text-red-600 rounded-md font-bold">
                                <PdfFileIcon className="h-5 w-5 mr-2" /> PDF Maestro
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto flex gap-6 pb-4">
                        {vehiclePlans.map(p => <VehicleColumn key={p.name} plan={p} onDragStart={(e, id) => e.dataTransfer.setData('text', id)} onDragOver={e => e.preventDefault()} onDrop={(e, v) => setAllTasks(curr => curr.map(t => t.id === e.dataTransfer.getData('text') ? {...t, vehiculo: v} : t))} onAddTask={v => setAddTaskModal({isOpen: true, vehicleName: v})} />)}
                    </div>
                </section>
            )}
            <AddTaskModal isOpen={addTaskModal.isOpen} vehicleName={addTaskModal.vehicleName} onClose={() => setAddTaskModal({isOpen: false, vehicleName: null})} onSubmit={d => { setAllTasks(curr => [...curr, {...d, id: `man-${Date.now()}`, vehiculo: addTaskModal.vehicleName!}]); setAddTaskModal({isOpen: false, vehicleName: null}); }} />
        </div>
    );
};

export default RutasModule;
