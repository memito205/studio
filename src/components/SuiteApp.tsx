
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import type { ProcessedReportData, ProductivityGoals, BrandProductTypeGoals, ManualProductClassifications, ManualJustifications, ReferenceCorrections, UniqueReference, ReportConfiguration, ManualOperatorMappings, IncidentLogEntry, ChatMessage, SmartAlert, ActionPlan, Annotations, TaggedReport, WholesaleOrder, WholesaleOrderDetail, ProductDatabaseItem, PackingScanResult, PackingUnit, PackingSession, AppStep, ReceptionOperation, JustificationType, DiscardedRecord, RemisionEntry, DeadTimeEntry, ReportSummary, CreditCalculationResult, DispatchSessionInfo } from '@/types';
import { processReport, getSanitizedData, extractUniqueReferences, extractPackersFromReport, preProcessDeadTimes } from '@/services/reportProcessor';
import { handleExecutiveSummary, handleRootCauseAnalysis, handleGenerateSmartAlerts, handleGetJustificationSuggestions, saveReportToHistory, loadHistoricalReports, updateOrderStatus, savePackingSession, loadWholesaleOrders, getPackingSession, loadAllPackingSessions, getProductsByBarcodes, consolidateDailyReports, previewConsolidatedReport, addPackedItem, getPackedItemsForOrder, deletePackedItem, updatePackedItem, createPackingUnit } from '@/app/actions';
import { Loader2, AlertTriangle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

// --- Dynamic Imports for Code Splitting ---

const LoadingSpinner = () => (
    <div className="flex justify-center items-center h-[50vh]">
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
    </div>
);

const FileUpload = dynamic(() => import('@/components/file-upload').then(mod => mod.FileUpload), { loading: () => <LoadingSpinner /> });
const ConfigurationScreen = dynamic(() => import('@/components/configuration-screen').then(mod => mod.ConfigurationScreen), { loading: () => <LoadingSpinner /> });
const Dashboard = dynamic(() => import('@/components/Dashboard').then(mod => mod.Dashboard), { loading: () => <LoadingSpinner /> });
const HistoricalDashboard = dynamic(() => import('@/components/HistoricalDashboard').then(mod => mod.HistoricalDashboard), { loading: () => <LoadingSpinner /> });
const AIInsightModal = dynamic(() => import('@/components/AIInsightModal').then(mod => mod.AIInsightModal), { loading: () => <LoadingSpinner /> });
const Chatbot = dynamic(() => import('@/components/Chatbot').then(mod => mod.Chatbot), { loading: () => <LoadingSpinner /> });
const PlantView = dynamic(() => import('@/components/PlantView').then(mod => mod.PlantView), { loading: () => <LoadingSpinner /> });
const SupervisorView = dynamic(() => import('@/components/SupervisorView').then(mod => mod.SupervisorView), { loading: () => <LoadingSpinner /> });
const WholesaleDashboard = dynamic(() => import('@/components/WholesaleDashboard').then(mod => mod.WholesaleDashboard), { loading: () => <LoadingSpinner /> });
const PackingScreen = dynamic(() => import('@/components/PackingScreen').then(mod => mod.PackingScreen), { loading: () => <LoadingSpinner /> });
const PackerSelectionModal = dynamic(() => import('@/components/PackerSelectionModal').then(mod => mod.PackerSelectionModal), { loading: () => <LoadingSpinner /> });
const SuiteDashboard = dynamic(() => import('@/components/SuiteDashboard').then(mod => mod.SuiteDashboard), { loading: () => <LoadingSpinner /> });
const PackedOrdersDashboard = dynamic(() => import('@/components/PackedOrdersDashboard').then(mod => mod.PackedOrdersDashboard), { loading: () => <LoadingSpinner /> });
const LogisticsSubMenu = dynamic(() => import('@/components/LogisticsSubMenu').then(mod => mod.LogisticsSubMenu), { loading: () => <LoadingSpinner /> });
const GeneralSettings = dynamic(() => import('@/components/GeneralSettings').then(mod => mod.GeneralSettings), { loading: () => <LoadingSpinner /> });
const LabelControl = dynamic(() => import('@/components/LabelControl').then(mod => mod.LabelControl), { loading: () => <LoadingSpinner /> });
const MerchandiseLabeling = dynamic(() => import('@/components/MerchandiseLabeling').then(mod => mod.MerchandiseLabeling), { loading: () => <LoadingSpinner /> });
const BagDistribution = dynamic(() => import('@/components/BagDistribution').then(mod => mod.BagDistribution), { loading: () => <LoadingSpinner /> });
const MerchandiseReception = dynamic(() => import('@/components/MerchandiseReception').then(mod => mod.MerchandiseReception), { loading: () => <LoadingSpinner /> });
const ReceptionDashboard = dynamic(() => import('./ReceptionDashboard').then(mod => mod.ReceptionDashboard), { loading: () => <LoadingSpinner /> });
const ReceptionReadingScreen = dynamic(() => import('@/components/ReceptionReadingScreen').then(mod => mod.ReceptionReadingScreen), { loading: () => <LoadingSpinner /> });
const NoveltyManagement = dynamic(() => import('@/components/NoveltyManagement').then(mod => mod.NoveltyManagement), { loading: () => <LoadingSpinner /> });
const NoveltyReports = dynamic(() => import('./NoveltyReports').then(mod => mod.NoveltyReports), { loading: () => <LoadingSpinner /> });
const ProductsManagement = dynamic(() => import('./ProductsManagement').then(mod => mod.ProductsManagement), { loading: () => <LoadingSpinner /> });
const TimeReports = dynamic(() => import('./TimeReports').then(mod => mod.TimeReports), { loading: () => <LoadingSpinner /> });
const OtherFeatures = dynamic(() => import('./OtherFeatures').then(mod => mod.OtherFeatures), { loading: () => <LoadingSpinner /> });
const TimeReportsMenu = dynamic(() => import('./TimeReportsMenu').then(mod => mod.TimeReportsMenu), { loading: () => <LoadingSpinner /> });
const IdleTimeReportGenerator = dynamic(() => import('./IdleTimeReportGenerator').then(mod => mod.IdleTimeReportGenerator), { loading: () => <LoadingSpinner /> });
const CreditSimulator = dynamic(() => import('./CreditSimulator').then(mod => mod.CreditSimulator), { loading: () => <LoadingSpinner /> });
const DispatchScreen = dynamic(() => import('./DispatchScreen').then(mod => mod.DispatchScreen), { loading: () => <LoadingSpinner /> });
const ReturnsModule = dynamic(() => import('./ReturnsModule').then(mod => mod.default), { loading: () => <LoadingSpinner /> });
const DispatchDashboard = dynamic(() => import('./DispatchDashboard').then(mod => mod.DispatchDashboard), { loading: () => <LoadingSpinner /> });
const DispatchReport = dynamic(() => import('./DispatchReport').then(mod => mod.DispatchReport), { loading: () => <LoadingSpinner /> });


type Theme = 'light' | 'dark';

const PACKERS = [
    "OBED SAUCEDO CONTRERAS",
    "OSME VALENCIA FLOREZ",
    "JHON JAMER CORDOBA CORDOBA",
    "ABEL FELIPE TRUJILLO DAVID",
    "SEBASTIAN HERACLIO GIRALDO PALACIO",
    "JOSE MARCIAL DIAZ CASTRO",
    "CARLOS MARIO CHALARCA ACOSTA",
    "AVELINO MOSQUERA PALACIOS",
    "CARLOS ALBERTO HERRERA ECHEVERRI",
    "VICTOR MENA COSSIO",
    "JORGE DE JESUS AVALOS ALVAREZ",
    "ARLEY GABRIEL GIRALDO VELEZ",
    "VICTOR HUGO RESTREPO ARIAS",
    "JHON FREDY LONDONO CARVAJAL",
    "JHON MARIO HERNANDEZ VELEZ",
    "EDWAR SAMUEL RANGEL RANGEL",
    "JHON ALONSO BASTIDAS MARIN",
    "ADRIAN MONTOYA ECHAVARRIA",
].sort();

interface CostWarningState {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
}

interface SuiteAppProps {
    theme?: Theme;
}

export const SuiteApp: React.FC<SuiteAppProps> = ({ theme = 'light' }) => {
  const [appStep, setAppStep] = useState<AppStep>('suite');
  const [rawData, setRawData] = useState<any[] | null>(null);
  const [processedDataForReport, setProcessedDataForReport] = useState<RemisionEntry[]>([]);
  const [reportData, setReportData] = useState<ProcessedReportData | null>(null);
  const [historicalData, setHistoricalData] = useState<ReportSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  
  // General Settings
  const [packingGoal, setPackingGoal] = useState<number>(70);


  // Wholesale & Packing State
  const [orders, setOrders] = useState<WholesaleOrder[]>([]);
  const [allPackingSessions, setAllPackingSessions] = useState<PackingSession[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [packingOrder, setPackingOrder] = useState<{ order: WholesaleOrder; details: WholesaleOrderDetail[] } | null>(null);
  const [dispatchShipmentId, setDispatchShipmentId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<PackingSession | null>(null);
  const { toast } = useToast();
  const { user, role, loading: isAuthLoading } = useAuth();
  
  const [costWarning, setCostWarning] = useState<CostWarningState>({ isOpen: false, title: '', description: '', onConfirm: () => {} });

  const [reportDate, setReportDate] = useState<string>('');
  const [reportStartTime, setReportStartTime] = useState<string>('06:00');
  const [reportEndTime, setReportEndTime] = useState<string>('18:00');
  
  const [configSelectedPacker, setConfigSelectedPacker] = useState<string[]>(['all']);

  // Configuration State
  const [productDB, setProductDB] = useState<ProductDatabaseItem[]>([]);
  const [productivityGoals, setProductivityGoals] = useState<ProductivityGoals>({ 'CALZADO': 65, 'ROPA': 100, 'ACCESORIOS': 90, 'NO CLASIFICADO': 60 });
  const [brandProductTypeGoals, setBrandProductTypeGoals] = useState<BrandProductTypeGoals>({});
  const [initialPackers, setInitialPackers] = useState<string[]>([]);
  const [manualClassifications, setManualClassifications] = useState<ManualProductClassifications>({});
  const [manualJustifications, setManualJustifications] = useState<ManualJustifications>({});
  const [uniqueReferences, setUniqueReferences] = useState<UniqueReference[]>([]);
  const [referenceCorrections, setReferenceCorrections] = useState<ReferenceCorrections>({});
  const [learnedCorrections, setLearnedCorrections] = useState<ReferenceCorrections>({});
  const [manualOperatorMappings, setManualOperatorMappings] = useState<ManualOperatorMappings>({});
  const [incidentLog, setIncidentLog] = useState<IncidentLogEntry[]>([]);
  const [annotations, setAnnotations] = useState<Annotations>({});
  const [sanitizedRecordCount, setSanitizedRecordCount] = useState<number>(0);
  const [discardedRecords, setDiscardedRecords] = useState<DiscardedRecord[]>([]);
  const [deadTimes, setDeadTimes] = useState<DeadTimeEntry[]>([]);


  // AI State
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [isInsightModalOpen, setIsInsightModalOpen] = useState(false);
  const [insightContent, setInsightContent] = useState('');
  const [actionPlan, setActionPlan] = useState<ActionPlan | null>(null);
  const [insightContext, setInsightContext] = useState<any>(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  // Reception State
  const [receptionOperationId, setReceptionOperationId] = useState<string | null>(null);
  
  const fetchOrders = useCallback(async () => {
    setIsLoadingOrders(true);
    const result = await loadWholesaleOrders();
    if (result.data) {
      setOrders(result.data.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()));
    } else {
      toast({
        variant: "destructive",
        title: "Error al cargar pedidos",
        description: result.error,
      });
    }
    setIsLoadingOrders(false);
  }, [toast]);

  useEffect(() => {
    if (appStep === 'wholesale' || appStep === 'suite') {
      fetchOrders();
    }
  }, [appStep, toast, fetchOrders]);
  
  useEffect(() => {
    try {
        const savedAnnotations = localStorage.getItem('annotations');
        if(savedAnnotations) setAnnotations(JSON.parse(savedAnnotations));
        const savedLearnedCorrections = localStorage.getItem('learnedCorrections');
        if(savedLearnedCorrections) setLearnedCorrections(JSON.parse(savedLearnedCorrections));
    } catch(e) {
        console.error("Error loading data from localStorage", e);
    }
  }, []);

  const handleFileProcess = useCallback(async (data: any[], name: string) => {
    setIsLoading(true);

    if (!data || data.length === 0) {
        toast({ variant: "destructive", title: "Archivo Vacío", description: "El archivo cargado no contiene datos." });
        setIsLoading(false);
        return;
    }
    
    const fechaKey = Object.keys(data[0]).find(k => k.toLowerCase().trim() === 'fecha lectura' || k.toLowerCase().trim() === 'fechalectura');

    if (!fechaKey) {
        toast({ variant: "destructive", title: "Error de Archivo", description: "La columna de fecha ('Fecha Lectura') no se encontró." });
        setIsLoading(false);
        return;
    }
    
    let fileReportDate: Date | null = null;
    for (const row of data) {
        if (row[fechaKey] instanceof Date) {
            fileReportDate = row[fechaKey];
            break;
        }
    }
    if (!fileReportDate) {
        toast({ variant: "destructive", title: "Sin Datos Válidos", description: "No se encontraron fechas válidas en la columna de fecha." });
        setIsLoading(false);
        return;
    }
    const reportDateStr = fileReportDate.toISOString().split('T')[0];
    setReportDate(reportDateStr);
    
    const barcodeKey = Object.keys(data[0]).find(k => k.toLowerCase().includes('codigo barras'));
    if (!barcodeKey) {
        toast({ variant: "destructive", title: "Error de Archivo", description: "La columna 'codigo barras' no se encontró." });
        setIsLoading(false);
        return;
    }
    
    try {
      const uniqueBarcodes = [...new Set(data.map(row => String(row[barcodeKey]).trim()).filter(Boolean))];
      const productsResult = await getProductsByBarcodes(uniqueBarcodes);
      
      if (productsResult.error) {
          throw new Error(productsResult.error);
      }
      
      const loadedProductDB = productsResult.data || [];
      const productMap = new Map(loadedProductDB.map(p => [p.codigoBarras, p]));
      setProductDB(loadedProductDB);
      
      const { sanitizedData, discardedRecords: newDiscardedRecords } = getSanitizedData(
        data,
        reportDateStr,
        manualOperatorMappings,
      );
      
      setSanitizedRecordCount(sanitizedData.length);
      setDiscardedRecords(newDiscardedRecords);
      
      setRawData(sanitizedData);
      setFileName(name);

      const referencesToCorrect = extractUniqueReferences(sanitizedData, productMap);
      setUniqueReferences(referencesToCorrect);

      const extractedPackers = extractPackersFromReport(sanitizedData, manualOperatorMappings);
      setInitialPackers(['all', ...extractedPackers]);
      
      setAppStep('configure');

    } catch(e: any) {
        console.error("Error durante el procesamiento:", e);
        setError("Error al procesar el archivo: " + e.message);
    }

    setIsLoading(false);
  }, [toast, manualOperatorMappings]);
  
    useEffect(() => {
        if (rawData && reportDate && reportStartTime && reportEndTime) {
            const initialDeadTimes = preProcessDeadTimes(rawData, reportDate, reportStartTime, reportEndTime, manualJustifications);
            setDeadTimes(initialDeadTimes);
        }
    }, [rawData, reportDate, reportStartTime, reportEndTime, manualJustifications]);


  const handleCalculate = useCallback(async () => {
    const calculationLogic = async () => {
        setIsLoading(true);
        setError(null);
        setReportData(null);
        
        try {
            const finalProcessedData = processReport(
                processedDataForReport,
                brandProductTypeGoals,
                reportDate,
                reportStartTime,
                reportEndTime,
                manualJustifications,
                configSelectedPacker,
                incidentLog
            );
            
            if (finalProcessedData.packerProductivity.length === 0) {
                setError("No se encontraron datos de productividad para los filtros seleccionados.");
                setAppStep('configure');
            } else {
                finalProcessedData.annotations = annotations;
                finalProcessedData.processedData = processedDataForReport; // Attach the processed data for saving
                await saveReportToHistory(finalProcessedData);
                setReportData(finalProcessedData);
                
                const newLearned = { ...learnedCorrections, ...referenceCorrections };
                setLearnedCorrections(newLearned);
                localStorage.setItem('learnedCorrections', JSON.stringify(newLearned));
                
                setAppStep('dashboard');
            }
        } catch (e: any) {
            console.error(e);
            setError("Ocurrió un error al procesar el archivo: " + e.message);
            setAppStep('configure');
        } finally {
            setIsLoading(false);
        }
    };

    setCostWarning({
        isOpen: true,
        title: "Confirmar Generación de Reporte",
        description: "Esta acción procesará los datos y guardará el reporte como un 'snapshot' en la base de datos (Firestore), lo que podría incurrir en costos. ¿Desea continuar?",
        onConfirm: calculationLogic,
    });
  }, [brandProductTypeGoals, reportDate, reportStartTime, reportEndTime, manualJustifications, configSelectedPacker, incidentLog, annotations, learnedCorrections, referenceCorrections, processedDataForReport]);

  const handleSessionChange = useCallback(async (newSession: PackingSession) => {
    setCurrentSession(newSession);
    const saveResult = await savePackingSession(newSession);
    if (saveResult.error) {
        toast({
            variant: "destructive",
            title: "Error de Sincronización",
            description: `No se pudo guardar el progreso: ${saveResult.error}`,
        });
    }

    if (packingOrder) {
        const totalItems = newSession.units.reduce((sum, unit) => sum + Object.values(unit.items || {}).reduce((s, i) => s + i.packedQuantity, 0), 0);
        let newStatus = packingOrder.order.status;

        if (totalItems > 0 && newStatus === 'Pte Empaque') {
            newStatus = 'En Empaque';
        } else if (totalItems === 0 && newStatus === 'En Empaque') {
            newStatus = 'Pte Empaque';
        } else if (packingOrder.order.cantidadTotal > 0 && totalItems >= packingOrder.order.cantidadTotal) {
             newStatus = 'Empacado';
        }

        if (newStatus !== packingOrder.order.status) {
            const updatedOrder = { ...packingOrder.order, status: newStatus };
            await updateOrderStatus(packingOrder.order.id, newStatus);
            setOrders(prevOrders => prevOrders.map(o => o.id === packingOrder.order.id ? updatedOrder : o));
            setPackingOrder(prev => prev ? { ...prev, order: updatedOrder } : null);
        }
    }
  }, [packingOrder, toast]);
  
  const handleRequestAIInsight = useCallback(async (context: any, type: string) => {
    setIsInsightModalOpen(true);
    setIsInsightLoading(true);
    setInsightContent('');
    setActionPlan(null);
    setInsightContext(context);
    try {
        const result = await handleRootCauseAnalysis(context, type as any);
        setInsightContent(result.data?.analysis || "No se pudo obtener un análisis.");
    } catch (err) { setInsightContent("Hubo un error al contactar al servicio de IA."); }
    finally { setIsInsightLoading(false); }
  }, []);

  const handleGenerateActionPlan = useCallback(async () => {
    if (!insightContext) return;
    setIsInsightLoading(true);
    setActionPlan(null);
    try {
        const plan = {title: 'Plan de Acción', steps: ['Paso 1', 'Paso 2']}; // Mock
        setActionPlan(plan);
    } catch (err) { console.error(err); setActionPlan({title: 'Error', steps: ['No se pudo generar el plan de acción.']}); }
    finally { setIsInsightLoading(false); }
  }, [insightContext]);

  const handleSendMessageToChatbot = async (message: string) => {
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', text: message }];
    setChatHistory(newHistory);
    // Mock response
    setChatHistory([...newHistory, { role: 'model', text: "Respuesta del Chatbot." }]);
  };

  const handleSuggestGoals = async () => {
    if (!rawData) return;
    const suggested = { 'CALZADO': 70 }; // Mock
    if (suggested) { setProductivityGoals(suggested); alert("Metas sugeridas por la IA han sido aplicadas."); }
    else { alert("No se pudo obtener una sugerencia de la IA."); }
  };
  
  const handleReset = () => { setReportData(null); setError(null); setHistoricalData([]); };
  
  const handleReturnToSuite = () => { handleReset(); setAppStep('suite'); };
  const handleNavigateToPackingModule = () => setAppStep('upload');
  const handleNavigateToWholesaleModule = () => {
      setError(null);
      fetchOrders();
      setAppStep('wholesale');
  }
  const handleNavigateToLogisticsModule = () => setAppStep('logistics_submenu');
  const handleNavigateToGeneralSettings = () => setAppStep('general_settings');
  const handleNavigateToLabelControlModule = () => setAppStep('label_control');
  const handleNavigateToMerchandiseLabelingModule = () => setAppStep('merchandise_labeling');
  const handleNavigateToBagDistributionModule = () => setAppStep('bag_distribution');
  const handleNavigateToMerchandiseReceptionModule = () => setAppStep('merchandise_reception');
  const handleNavigateToReceptionDashboard = () => setAppStep('reception_dashboard');
  const handleNavigateToNoveltyManagement = () => setAppStep('novelty_management');
  const handleNavigateToNoveltyReports = () => setAppStep('novelty_reports');
  const handleNavigateToProductsManagement = () => setAppStep('products_management');
  const handleNavigateToTimeReportsMenu = () => setAppStep('time_reports_menu'); // Updated to navigate to the new menu
  const handleNavigateToOtherFeaturesModule = () => setAppStep('other_features');


  const handleStartPacking = async (order: WholesaleOrder) => {
      if (!user) {
          toast({ variant: 'destructive', title: "Error", description: "Debe iniciar sesión para empezar a empacar."});
          return;
      }
      setCurrentSession(null); 
      setAppStep('packing'); // Show loading state immediately
      setPackingOrder({ order, details: order.details });

      const sessionResult = await getPackingSession(order.id);
      const initialSession: PackingSession = sessionResult.data || {
          orderId: order.id,
          packerId: user.uid,
          packerName: user.displayName || user.email || 'Desconocido',
          units: [],
          status: 'active',
          pauses: [],
      };
      
      setCurrentSession(initialSession);
  };
  
  const handleStartDispatching = (shipmentId: string) => {
    setDispatchShipmentId(shipmentId);
    setAppStep('dispatching');
  };

  const handleStartReading = (operationId: string) => {
      setReceptionOperationId(operationId);
      setAppStep('reception_reading');
  };

  const handleGoToConfiguration = () => { setAppStep('configure'); };
  const handleGoToHistorical = async () => {
    const proceed = async () => {
        setIsLoading(true);
        const result = await loadHistoricalReports();
        if (result.data) {
            setHistoricalData(result.data);
            setAppStep('historical');
        } else {
            setError(result.error || "No se pudieron cargar los datos históricos.");
        }
        setIsLoading(false);
    }
    setCostWarning({
        isOpen: true,
        title: "Cargar Historial",
        description: "Esta acción leerá todos los reportes guardados de la base de datos (Firestore), lo que podría incurrir en costos si se supera la cuota gratuita de Firebase (50,000 lecturas/día). ¿Desea continuar?",
        onConfirm: proceed,
    });
  };
  
  const handleNavigateToPackedOrdersDashboard = async () => {
    setIsLoading(true);
    const sessionsResult = await loadAllPackingSessions();
    if (sessionsResult.data) {
        setAllPackingSessions(sessionsResult.data);
        setAppStep('packed_orders_dashboard');
    } else {
        toast({ variant: 'destructive', title: "Error", description: sessionsResult.error });
    }
    setIsLoading(false);
  }
  
  const handleNavigateToDispatchDashboard = () => {
      setAppStep('dispatch_dashboard');
  }

  const handleGoToPlantView = () => setAppStep('plant_view');
  const handleGoToSupervisorView = () => setAppStep('supervisor_view');
  const handleReturnToDashboard = () => setAppStep('dashboard');

  const handleConfigSelectedPackerChange = (packer: string, isChecked: boolean) => {
    if (packer === 'all') {
      setConfigSelectedPacker(isChecked ? ['all'] : []);
    } else {
      const newSelection = isChecked
        ? [...configSelectedPacker.filter(p => p !== 'all'), packer]
        : configSelectedPacker.filter(p => p !== 'all' && p !== packer);

      if (newSelection.length === 0 || (initialPackers.length > 1 && newSelection.length === initialPackers.length - 1)) {
        setConfigSelectedPacker(['all']);
      } else {
        setConfigSelectedPacker(newSelection);
      }
    }
  };
  
  const handleManualOperatorMappingChange = (id: string, name: string) => { setManualOperatorMappings(prev => { const newMappings = { ...prev }; if (name) newMappings[id] = name; else delete newMappings[id]; return newMappings; }); };

  const handleAnnotationChange = (targetId: string, text: string) => { const newAnnotations = { ...annotations }; if (text.trim()) newAnnotations[targetId] = { text }; else delete newAnnotations[targetId]; setAnnotations(newAnnotations); localStorage.setItem('annotations', JSON.stringify(newAnnotations)); };

  const handleLoadConfiguration = (config: ReportConfiguration) => { 
    setProductivityGoals(config.productivityGoals || { 'CALZADO': 65, 'ROPA': 100, 'ACCESORIOS': 90, 'NO CLASIFICADO': 60 }); 
    setBrandProductTypeGoals(config.brandProductTypeGoals || {}); 
    setManualClassifications(config.manualClassifications || {}); 
    setManualJustifications(config.manualJustifications || {}); 
    setReferenceCorrections(config.referenceCorrections || {}); 
    setLearnedCorrections(prev => ({ ...prev, ...config.learnedCorrections })); 
    setManualOperatorMappings(config.manualOperatorMappings || {}); 
    setIncidentLog(config.incidentLog || []); 
    setAnnotations(prev => ({ ...prev, ...config.annotations })); 
    setReportDate(config.reportDate || ''); 
    setReportStartTime(config.reportStartTime || '06:00'); 
    setReportEndTime(config.reportEndTime || '18:00'); 
    setConfigSelectedPacker(config.configSelectedPacker || ['all']); 
    alert("Configuración cargada exitosamente."); 
  };
    
  const handleAcceptSuggestion = (incidentId: string, type: JustificationType) => {
    handleManualJustificationsChange({
        ...manualJustifications,
        [incidentId]: { type }
    });
  };

  const handleIncidentLogChange = (log: IncidentLogEntry[]) => {
    setIncidentLog(log);
  };
  
  const handleManualJustificationsChange = (newJustifications: ManualJustifications) => {
    setManualJustifications(newJustifications);
  }

    const renderContent = () => {
      switch(appStep) {
          case 'suite':
            return <SuiteDashboard onNavigateToPackingModule={handleNavigateToPackingModule} onNavigateToWholesaleModule={handleNavigateToWholesaleModule} onNavigateToLogisticsModule={handleNavigateToLogisticsModule} onNavigateToGeneralSettings={handleNavigateToGeneralSettings} onNavigateToLabelControlModule={handleNavigateToLabelControlModule} onNavigateToMerchandiseLabelingModule={handleNavigateToMerchandiseLabelingModule} onNavigateToBagDistributionModule={handleNavigateToBagDistributionModule} onNavigateToMerchandiseReceptionModule={handleNavigateToMerchandiseReceptionModule} onNavigateToOtherFeaturesModule={handleNavigateToOtherFeaturesModule} />;
          case 'upload': return <FileUpload onProcessFile={handleFileProcess} isLoading={isLoading} onGoToHistorical={handleGoToHistorical} onReturnToSuite={handleReturnToSuite} />;
          case 'configure': return rawData && <ConfigurationScreen onCalculate={handleCalculate} fileName={fileName} rawData={rawData} productDB={productDB} goals={productivityGoals} onGoalsChange={setProductivityGoals} onSuggestGoals={handleSuggestGoals} brandProductTypeGoals={brandProductTypeGoals} onBrandProductTypeGoalsChange={setBrandProductTypeGoals} initialPackers={initialPackers} manualClassifications={manualClassifications} onManualClassificationsChange={setManualClassifications} manualJustifications={manualJustifications} onManualJustificationsChange={handleManualJustificationsChange} uniqueReferences={uniqueReferences} referenceCorrections={referenceCorrections} learnedCorrections={learnedCorrections} manualOperatorMappings={manualOperatorMappings} onManualOperatorMappingChange={handleManualOperatorMappingChange} incidentLog={incidentLog} onIncidentLogChange={handleIncidentLogChange} reportDate={reportDate} onReportDateChange={setReportDate} reportStartTime={reportStartTime} onReportStartTimeChange={setReportStartTime} reportEndTime={reportEndTime} onReportEndTimeChange={setReportEndTime} configSelectedPacker={configSelectedPacker} onConfigSelectedPackerChange={handleConfigSelectedPackerChange} onReset={handleNavigateToPackingModule} onReturnToSuite={handleReturnToSuite} isLoading={isLoading} onLoadConfiguration={handleLoadConfiguration} annotations={annotations} onReferenceCorrectionsChange={setReferenceCorrections} onAcceptSuggestion={handleAcceptSuggestion} sanitizedRecordCount={sanitizedRecordCount} discardedRecords={discardedRecords} deadTimes={deadTimes} onProcessedDataChange={setProcessedDataForReport} />;
          case 'dashboard': return reportData && <Dashboard data={reportData} fileName={fileName} onReset={handleNavigateToPackingModule} onReturnToSuite={handleReturnToSuite} onGoToConfiguration={handleGoToConfiguration} onGoToPlantView={handleGoToPlantView} onGoToSupervisorView={handleGoToSupervisorView} onRequestAIInsight={handleRequestAIInsight} theme={theme} annotations={annotations} onAnnotationChange={handleAnnotationChange} />;
          case 'historical': return <HistoricalDashboard data={historicalData} onReturnToMain={() => setAppStep('upload')} onConsolidate={consolidateDailyReports} theme={theme} />;
          case 'plant_view': return reportData && <PlantView data={reportData} onReturnToDashboard={handleReturnToDashboard} theme={theme} />;
          case 'supervisor_view': return reportData && <SupervisorView data={reportData} onReturnToDashboard={handleReturnToDashboard} />;
          case 'wholesale': return <WholesaleDashboard 
                orders={orders}
                isLoadingOrders={isLoadingOrders}
                fetchOrders={fetchOrders}
                onStartPacking={handleStartPacking}
                onReturnToSuite={handleReturnToSuite}
                onNavigateToPackedOrdersDashboard={handleNavigateToPackedOrdersDashboard}
                onNavigateToDispatchDashboard={handleNavigateToDispatchDashboard}
            />;
          case 'dispatch_dashboard': return <DispatchDashboard onReturnToWholesale={handleNavigateToWholesaleModule} onStartDispatching={handleStartDispatching} />;
          case 'dispatching': return dispatchShipmentId ? <DispatchScreen shipmentId={dispatchShipmentId} onReturnToDispatchDashboard={() => setAppStep('dispatch_dashboard')} /> : null;
          case 'packed_orders_dashboard': return <PackedOrdersDashboard orders={orders} sessions={allPackingSessions} onReturn={handleNavigateToWholesaleModule} />;
          case 'logistics_submenu': return <LogisticsSubMenu onReturnToSuite={handleReturnToSuite} />;
          case 'general_settings': return <GeneralSettings onReturnToSuite={handleReturnToSuite} packingGoal={packingGoal} onPackingGoalChange={setPackingGoal} />;
          case 'label_control': return <LabelControl onReturnToSuite={handleReturnToSuite} />;
          case 'merchandise_labeling': return <MerchandiseLabeling onReturnToSuite={handleReturnToSuite} />;
          case 'bag_distribution': return <BagDistribution onReturnToSuite={handleReturnToSuite} />;
          case 'merchandise_reception': return <MerchandiseReception onReturnToSuite={handleReturnToSuite} onStartReading={handleStartReading} onNavigateToNoveltyManagement={handleNavigateToNoveltyManagement} onNavigateToProductsManagement={handleNavigateToProductsManagement} onNavigateToDashboard={handleNavigateToReceptionDashboard} onNavigateToTimeReports={handleNavigateToTimeReportsMenu} />;
          case 'reception_dashboard': return <ReceptionDashboard onReturn={() => setAppStep('merchandise_reception')} />;
          case 'novelty_management': return <NoveltyManagement onReturn={() => setAppStep('merchandise_reception')} onNavigateToReports={handleNavigateToNoveltyReports} onNavigateToTimeReports={handleNavigateToTimeReportsMenu} />;
          case 'novelty_reports': return <NoveltyReports onReturn={() => setAppStep('novelty_management')} />;
          case 'products_management': return <ProductsManagement onReturn={() => setAppStep('merchandise_reception')} />;
          case 'time_reports_menu': return <TimeReportsMenu onNavigateToGeneralPauses={() => setAppStep('time_reports')} onNavigateToIdleTime={() => setAppStep('idle_time_report')} onReturn={() => setAppStep('merchandise_reception')} />;
          case 'time_reports': return <TimeReports onReturn={() => setAppStep('time_reports_menu')} />;
          case 'idle_time_report': return <IdleTimeReportGenerator onReturn={() => setAppStep('time_reports_menu')} />;
          case 'other_features': return <OtherFeatures onReturnToSuite={handleReturnToSuite} />;
          case 'reception_reading': return receptionOperationId ? <ReceptionReadingScreen operationId={receptionOperationId} onReturnToOperations={() => setAppStep('merchandise_reception')} /> : null;
          case 'credit_simulator': return <CreditSimulator onReturn={() => setAppStep('other_features')} />;
          case 'returns_module': return <ReturnsModule onReturn={() => setAppStep('other_features')} />;
          case 'packing':
            if (packingOrder && currentSession) {
              return <PackingScreen 
                  packingOrder={packingOrder}
                  onReturnToOrders={handleNavigateToWholesaleModule} 
                  onReturnToSuite={handleReturnToSuite} 
                  initialSession={currentSession}
                  onSessionChange={handleSessionChange}
                  productivityGoal={packingGoal}
              />;
            }
            return (
              <div className="flex justify-center items-center h-[50vh]">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="ml-4 text-lg text-muted-foreground">Cargando sesión de empaque...</p>
              </div>
            );
          default: 
            return <SuiteDashboard onNavigateToPackingModule={handleNavigateToPackingModule} onNavigateToWholesaleModule={handleNavigateToWholesaleModule} onNavigateToLogisticsModule={handleNavigateToLogisticsModule} onNavigateToGeneralSettings={handleNavigateToGeneralSettings} onNavigateToLabelControlModule={handleNavigateToLabelControlModule} onNavigateToMerchandiseLabelingModule={handleNavigateToMerchandiseLabelingModule} onNavigateToBagDistributionModule={handleNavigateToBagDistributionModule} onNavigateToMerchandiseReceptionModule={handleNavigateToMerchandiseReceptionModule} onNavigateToOtherFeaturesModule={handleNavigateToOtherFeaturesModule} />;
      }
    }

    return (
        <>
            {renderContent()}
             <AlertDialog open={costWarning.isOpen} onOpenChange={(isOpen) => !isOpen && setCostWarning(prev => ({...prev, isOpen: false}))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="text-amber-500" />
                        {costWarning.title}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {costWarning.description}
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setCostWarning(prev => ({...prev, isOpen: false}))}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                        costWarning.onConfirm();
                        setCostWarning(prev => ({...prev, isOpen: false}));
                    }}>
                        Continuar
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <PackerSelectionModal 
                isOpen={false} // This needs to be connected to the new flow
                onClose={() => {}}
                packers={PACKERS}
                onConfirm={() => {}}
            />
            {(appStep === 'dashboard' || appStep === 'historical') && <Chatbot isOpen={isChatbotOpen} onToggle={() => setIsChatbotOpen(!isChatbotOpen)} history={chatHistory} onSendMessage={handleSendMessageToChatbot} />}
            <AIInsightModal isOpen={isInsightModalOpen} isLoading={isInsightLoading} content={insightContent} actionPlan={actionPlan} onGenerateActionPlan={handleGenerateActionPlan} onClose={() => setIsInsightModalOpen(false)} />
        </>
    )
}
