import React, { useState, useMemo, ChangeEvent, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  FileDown, 
  Search, 
  MapPin, 
  Package, 
  ArrowUpDown,
  Trash2,
  CheckCircle2,
  FileSpreadsheet,
  ScanLine,
  LayoutDashboard,
  History,
  ArrowLeft,
  UploadCloud,
  ChevronsUpDown,
  Save
} from 'lucide-react';
import type { MerchandiseItem, TFTItem, VerificationItem, SavedVerification } from '@/types';
import { parseMerchandiseExcel, exportToExcel, normalizeDestination } from './utils/excel';
import { generatePDF } from './utils/pdf';
import { format } from 'date-fns';
import { cn } from './utils/cn';
import VerificationModule from './components/VerificationModule';
import { useAuth } from '@/hooks/use-auth-context';
import VerificationHistory from './components/VerificationHistory';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadAllTransfers, saveVerificationSession } from '@/app/actions';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface DispatchManagerProps {
  onReturnToSuite: () => void;
}

const SaveVerificationDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (name: string) => Promise<void>;
    isLoading: boolean;
}> = ({ isOpen, onOpenChange, onSave, isLoading }) => {
    const [name, setName] = useState('');
    
    const handleSaveClick = async () => {
        if (name.trim()) {
            await onSave(name.trim());
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Guardar Sesión de Verificación</DialogTitle>
                    <DialogDescription>
                        Asigne un nombre descriptivo a esta verificación para guardarla en el historial.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="session-name">Nombre de la Sesión</Label>
                    <Input
                        id="session-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Verificación Despacho 28/07"
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSaveClick} disabled={isLoading || !name.trim()}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// Helper function to extract numeric part from TF string
const extractNumberFromTf = (tf: string | undefined): number => {
    if (!tf) return 0;
    // This regex finds the first sequence of digits in the string.
    const match = tf.match(/\d+/);
    // If digits are found, parse them as an integer; otherwise, return 0.
    return match ? parseInt(match[0], 10) : 0;
};


export default function DispatchManager({ onReturnToSuite }: DispatchManagerProps) {
  const { role, user } = useAuth();
  const isAdmin = role === 'admin';
  const isSupervisor = role === 'supervisor';

  const { toast } = useToast();
  const [activeModule, setActiveModule] = useState<'cruce' | 'verificacion' | 'historial'>(isAdmin ? 'cruce' : 'verificacion');
  
  // State for 'cruce' module
  const [allMatchedData, setAllMatchedData] = useState<MerchandiseItem[]>([]);
  const [allUnmatchedData, setAllUnmatchedData] = useState<MerchandiseItem[]>([]);
  const [selectedDestinos, setSelectedDestinos] = useState<string[]>([]);
  const [destLimits, setDestLimits] = useState<Record<string, number | ''>>({});
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [merchandiseFile, setMerchandiseFile] = useState<File | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);


  const handleMerchandiseUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMerchandiseFile(file);
    
    setIsUploading(true);
    setAllMatchedData([]);
    setAllUnmatchedData([]);

    try {
        const parsedMerchandise = await parseMerchandiseExcel(file);
        const transfersResult = await loadAllTransfers();

        if (transfersResult.error || !transfersResult.data) {
            throw new Error(transfersResult.error || "No se pudieron cargar las transferencias desde la base de datos.");
        }
        
        const allTransfersFromDB = transfersResult.data;

        // Create virtual items from transfers 'Recibido en Bodega'
        const receivedInWarehouseTransfers = allTransfersFromDB.filter(t => t.status === 'Recibido en Bodega');
        const virtualMerchandiseItems: MerchandiseItem[] = receivedInWarehouseTransfers.map((t, index) => {
            const originalDest = t.bodegaDestino;
            const normalizedDest = normalizeDestination(originalDest);
            // The `codigo` MUST be created with the original destination code for matching
            const codigo = `${originalDest.trim()}-${t.numeroTF}`.toUpperCase();

            return {
                codigo: codigo.replace(/'/g, '-'),
                fechaCreacion: t.fecha,
                orden: '',
                tipoOrd: '',
                tipo: '',
                gr: '',
                contenido: t.numeroTF,
                tf: t.numeroTF,
                origen: t.bodegaOrigen,
                destino: normalizedDest, // Use normalized for display
                cant: t.cantidad || 1,
                pKg: 0,
                vM3: 0,
                estado: 'VIRTUAL',
                detalle: 'Añadido desde transferencias recibidas',
                etiqueta: '',
                relacion: '',
                verLog: '',
                ordDesp: '',
                fechaEmpaque: '',
                empacador: 'SISTEMA',
            };
        });
        
        const merchandiseMap = new Map<string, MerchandiseItem>();
        parsedMerchandise.forEach(item => {
            const key = item.codigo.toUpperCase();
            if (key) merchandiseMap.set(key, item);
        });
        virtualMerchandiseItems.forEach(item => {
            const key = item.codigo.toUpperCase();
            if (key && !merchandiseMap.has(key)) {
                merchandiseMap.set(key, item);
            }
        });
        const consolidatedMerchandiseData = Array.from(merchandiseMap.values());
        
        const tftMap = new Map<string, TFTItem>();
        allTransfersFromDB.forEach(t => {
            tftMap.set(t.numeroTF.toUpperCase(), { tft: t.numeroTF, fecha: t.fecha, cantidad: t.cantidad || 1 });
        });

        const joined = consolidatedMerchandiseData.map(item => {
            const tfForMatch = String(item.tf || item.contenido || '').trim().toUpperCase();
            const match = tftMap.get(tfForMatch);
            
            return {
                ...item,
                tftMatch: match?.tft,
                tftFecha: match?.fecha,
                tftCantidad: match?.cantidad
            };
        });

        setAllMatchedData(joined.filter(item => !!item.tftMatch));
        setAllUnmatchedData(joined.filter(item => !item.tftMatch));

        toast({ title: 'Éxito', description: `Cruce completado. Se procesaron ${consolidatedMerchandiseData.length} ítems de mercancía.` });

    } catch (error) {
      console.error('Error processing merchandise excel:', error);
      toast({ variant: 'destructive', title: 'Error al procesar archivo', description: (error as Error).message });
    } finally {
      setIsUploading(false);
    }
  };

  const { filteredMatchedData, filteredUnmatchedData, excludedMatchedData, dispatchStats } = useMemo(() => {
    const baseFilter = (item: MerchandiseItem) => {
      const normalizedSearch = searchTerm.toLowerCase();
      const matchesDestino = selectedDestinos.length === 0 || selectedDestinos.includes(item.destino);
      const matchesSearch = !searchTerm ||
        item.codigo.toLowerCase().includes(normalizedSearch) ||
        (item.tftMatch && item.tftMatch.toLowerCase().includes(normalizedSearch));
      return matchesDestino && matchesSearch;
    };

    const initialMatched = allMatchedData.filter(baseFilter);
    const initialUnmatched = allUnmatchedData.filter(baseFilter);
    
    const sortByDateAndTf = (a: MerchandiseItem, b: MerchandiseItem) => {
      const dateA = a.tftFecha?.getTime() || 0;
      const dateB = b.tftFecha?.getTime() || 0;
      if (dateA !== dateB) {
          return dateA - dateB;
      }
      const numA = extractNumberFromTf(a.tftMatch);
      const numB = extractNumberFromTf(b.tftMatch);
      return numA - numB;
    };

    // Calculate Original Stats per destination
    const groupedByTF: Record<string, MerchandiseItem[]> = {};
    initialMatched.forEach(item => {
      const tfKey = item.tftMatch || 'VIRTUAL';
      if (!groupedByTF[tfKey]) groupedByTF[tfKey] = [];
      groupedByTF[tfKey].push(item);
    });

    const stats: Record<string, { originalUnits: number, originalTFs: number, filteredUnits: number, filteredTFs: number }> = {};
    
    // Group groups by destination to apply limits
    const destGroups: Record<string, { tfKey: string, items: MerchandiseItem[] }[]> = {};
    Object.entries(groupedByTF).forEach(([tfKey, items]) => {
      const dest = items[0].destino;
      if (!destGroups[dest]) destGroups[dest] = [];
      destGroups[dest].push({ tfKey, items });

      if (!stats[dest]) stats[dest] = { originalUnits: 0, originalTFs: 0, filteredUnits: 0, filteredTFs: 0 };
      stats[dest].originalUnits += items.reduce((sum, i) => sum + i.cant, 0);
      stats[dest].originalTFs += 1;
    });

    let finalList: MerchandiseItem[] = [];
    let excludedList: MerchandiseItem[] = [];

    // Process each destination separately to apply its limit
    Object.keys(destGroups).forEach(dest => {
      const groups = destGroups[dest].sort((a, b) => sortByDateAndTf(a.items[0], b.items[0]));
      const limit = destLimits[dest];
      let largeCount = 0;

      groups.forEach(group => {
        const isBdbol = group.items.some(i => i.origen.toUpperCase() === 'BDBOL');
        const isLarge = (group.items[0].tftCantidad || 0) >= 5;

        // BDBOL and Small TFs are always included
        if (isBdbol || !isLarge || limit === '' || limit === undefined || limit < 0) {
          finalList.push(...group.items);
          stats[dest].filteredUnits += group.items.reduce((sum, i) => sum + i.cant, 0);
          stats[dest].filteredTFs += 1;
        } else {
          // Limit only applies to large non-BDBOL transfers
          if (largeCount < limit) {
            finalList.push(...group.items);
            largeCount++;
            stats[dest].filteredUnits += group.items.reduce((sum, i) => sum + i.cant, 0);
            stats[dest].filteredTFs += 1;
          } else {
            excludedList.push(...group.items);
          }
        }
      });
    });

    return {
      filteredMatchedData: finalList.sort(sortByDateAndTf),
      filteredUnmatchedData: initialUnmatched,
      excludedMatchedData: excludedList,
      dispatchStats: stats
    };
  }, [allMatchedData, allUnmatchedData, selectedDestinos, searchTerm, destLimits]);


  const uniqueDestinos = useMemo(() => {
    return Array.from(new Set([...allMatchedData, ...allUnmatchedData].map(item => item.destino))).sort();
  }, [allMatchedData, allUnmatchedData]);

  const handleExportPDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      if (filteredMatchedData.length === 0) return;
      
      const uniqueAllData = Array.from(
        new Map<string, MerchandiseItem>(filteredMatchedData.map(item => [item.codigo, item])).values()
      );
      
      generatePDF(uniqueAllData);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      if (filteredMatchedData.length === 0) return;

      const uniqueAllData = Array.from(
        new Map<string, MerchandiseItem>(filteredMatchedData.map(item => [item.codigo, item])).values()
      );

      exportToExcel(uniqueAllData, `Reporte_Cruce_${format(new Date(), 'yyyyMMdd_HHmm')}`);
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleSaveVerification = async (name: string) => {
    if (!user) {
        toast({ variant: 'destructive', title: 'Error de autenticación' });
        return;
    }
    if (filteredMatchedData.length === 0) {
        toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay datos cruzados para guardar.' });
        return;
    }
    setIsSaving(true);
    
    const verificationItems: VerificationItem[] = filteredMatchedData.map(item => ({
        codigo: item.codigo,
        tftCruce: item.tftMatch || '',
        fechaTft: item.tftFecha ? format(item.tftFecha, 'dd/MM/yyyy') : '-',
        cantTft: String(item.tftCantidad || ''),
        destino: item.destino,
        empacador: item.empacador,
        contenidoOriginal: item.contenido,
        tfOriginal: item.tf,
        scanned: false,
    }));
    
    const unmatchedVerificationItems: VerificationItem[] = filteredUnmatchedData.map(item => ({
        codigo: item.codigo,
        tftCruce: 'NO ENCONTRADO',
        fechaTft: '-',
        cantTft: '-',
        destino: item.destino,
        empacador: item.empacador,
        contenidoOriginal: item.contenido,
        tfOriginal: item.tf,
        scanned: false,
    }));


    const sessionData: Omit<SavedVerification, 'id'> = {
        name,
        createdAt: new Date(),
        savedById: user.uid,
        savedBy: user.displayName || user.email || 'N/A',
        results: verificationItems,
        unmatchedResults: unmatchedVerificationItems,
        excludedResults: excludedMatchedData.map(item => ({
            codigo: item.codigo,
            tftCruce: item.tftMatch || '',
            fechaTft: item.tftFecha ? format(item.tftFecha, 'dd/MM/yyyy') : '-',
            cantTft: String(item.tftCantidad || ''),
            destino: item.destino,
            empacador: item.empacador,
            contenidoOriginal: item.contenido,
            tfOriginal: item.tf,
            scanned: false,
        })),
        originalStats: {
            totalUnits: Object.values(dispatchStats).reduce((sum, s) => sum + s.originalUnits, 0),
            totalTFs: Object.values(dispatchStats).reduce((sum, s) => sum + s.originalTFs, 0),
        },
        filteredStats: {
            totalUnits: Object.values(dispatchStats).reduce((sum, s) => sum + s.filteredUnits, 0),
            totalTFs: Object.values(dispatchStats).reduce((sum, s) => sum + s.filteredTFs, 0),
        },
        stats: {
            total: verificationItems.length,
            scanned: 0,
            pending: verificationItems.length
        },
        status: 'pending'
    };

    const result = await saveVerificationSession(sessionData);

    if (result.success) {
        toast({ title: 'Éxito', description: `Sesión de verificación "${name}" creada y guardada.` });
        setIsSaveDialogOpen(false);
        setActiveModule('verificacion'); // Switch to verification tab
    } else {
        toast({ variant: 'destructive', title: 'Error al guardar', description: result.error });
    }
    setIsSaving(false);
  };


  const toggleDestino = (dest: string) => {
    setSelectedDestinos(prev => 
      prev.includes(dest) ? prev.filter(d => d !== dest) : [...prev, dest]
    );
  };

  const setLimitForDest = (dest: string, limit: number | '') => {
    setDestLimits(prev => ({ ...prev, [dest]: limit }));
  };

  const clearData = () => {
    if (confirm('¿Estás seguro de que deseas borrar todos los datos?')) {
      setMerchandiseFile(null);
      setAllMatchedData([]);
      setAllUnmatchedData([]);
      setSelectedDestinos([]);
      setDestLimits({});
    }
  };
  
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
       <SaveVerificationDialog 
          isOpen={isSaveDialogOpen}
          onOpenChange={setIsSaveDialogOpen}
          onSave={handleSaveVerification}
          isLoading={isSaving}
        />
      <header className="border-b border-gray-700 p-6 bg-primary text-primary-foreground sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight font-bold tracking-tight text-white">
              Gestor de Despachos
            </h1>
            <p className="text-xs  opacity-50 mt-1 ">
              Logística Avanzada • {format(new Date(), 'dd.MM.yyyy')}
            </p>
          </div>
          
          <div className="flex items-center gap-6">
            {(isAdmin || isSupervisor) && (
              <div className="flex bg-white/5 p-1 rounded-none border border-white/10">
                {isAdmin && <button
                  onClick={() => setActiveModule('cruce')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2  text-[10px]  transition-all",
                    activeModule === 'cruce' 
                      ? "bg-white text-foreground shadow-md" 
                      : "hover:bg-white/10 opacity-60"
                  )}
                >
                  <LayoutDashboard size={14} />
                  Módulo Cruce
                </button>}
                <button
                  onClick={() => setActiveModule('verificacion')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2  text-[10px]  transition-all",
                    activeModule === 'verificacion' 
                      ? "bg-white text-foreground shadow-md" 
                      : "hover:bg-white/10 opacity-60"
                  )}
                >
                  <ScanLine size={14} />
                  Verificación (Pistoleo)
                </button>
                <button
                    onClick={() => setActiveModule('historial')}
                    className={cn(
                    "flex items-center gap-2 px-4 py-2  text-[10px]  transition-all",
                    activeModule === 'historial'
                        ? "bg-white text-foreground shadow-md" 
                        : "hover:bg-white/10 opacity-60"
                    )}
                >
                    <History size={14} />
                    Historial
                </button>
              </div>
            )}
            
            <div className="flex items-center gap-3">
              {activeModule === 'cruce' && (allMatchedData.length > 0 || allUnmatchedData.length > 0) && isAdmin && (
                <button
                  onClick={clearData}
                  className="p-2 border border-white/30 hover:bg-red-500 hover:text-white transition-colors rounded-none"
                  title="Borrar datos"
                >
                  <Trash2 size={20} />
                </button>
              )}
              
              {activeModule === 'cruce' && isAdmin && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-white/30 cursor-pointer hover:bg-white/10 transition-all  text-xs",
                    merchandiseFile && "bg-green-300/20 border-green-300 text-green-200"
                  )}>
                    {merchandiseFile ? <CheckCircle2 size={16} /> : <Upload size={16} />}
                    {merchandiseFile ? 'MERCANCÍA CARGADA' : 'CARGAR MERCANCÍA'}
                    <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleMerchandiseUpload} disabled={isUploading} />
                  </label>

                  {(filteredMatchedData.length > 0 || filteredUnmatchedData.length > 0) && (
                    <div className="flex gap-2">
                        <Button onClick={() => setIsSaveDialogOpen(true)} variant="secondary" size="sm" className="h-full">
                            <Save className="mr-2 h-4 w-4" /> Guardar para Verificar
                        </Button>
                      <button
                        onClick={handleExportPDF}
                        disabled={isExporting}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 bg-white text-foreground hover:bg-opacity-90 transition-all  text-xs",
                          isExporting && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <FileDown size={16} />
                        {isExporting ? 'EXPORTANDO...' : 'PDF'}
                      </button>
                      <button
                        onClick={handleExportExcel}
                        disabled={isExporting}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 border border-white/30 hover:bg-white/10 transition-all  text-xs",
                          isExporting && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <FileSpreadsheet size={16} />
                        {isExporting ? 'EXPORTANDO...' : 'EXCEL'}
                      </button>
                    </div>
                  )}
                </div>
              )}
                <Button onClick={onReturnToSuite} variant="ghost" className="justify-start text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    <ArrowLeft className="mr-2 h-4 w-4"/> Volver a la Suite
                </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {(isAdmin || isSupervisor) ? (
          <>
            {activeModule === 'cruce' && isAdmin && (
              !merchandiseFile ? (
                <div 
                  className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-border"
                >
                  <FileSpreadsheet size={64} strokeWidth={1} />
                  <p className="mt-4 font-bold tracking-tight text-xl">Inicia cargando el archivo de Mercancía</p>
                  <p className="text-sm  mt-2">El sistema se encargará de obtener las transferencias automáticamente.</p>
                </div>
              ) : (
                <div className="space-y-12">
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-1 space-y-4">
                      <div className="bg-white p-4 border border-border">
                        <h3 className="text-xs  font-bold  mb-4 flex items-center gap-2">
                          <MapPin size={14} /> Seleccionar Destinos
                        </h3>
                        <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                          {uniqueDestinos.map(dest => (
                            <div key={dest} className="flex flex-col gap-1 p-2 border border-transparent hover:border-border transition-all">
                              <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 accent-primary"
                                  checked={selectedDestinos.includes(dest)}
                                  onChange={() => toggleDestino(dest)}
                                />
                                <span className={cn(
                                  "text-xs  truncate",
                                  selectedDestinos.includes(dest) ? "font-bold" : "opacity-60"
                                )}>{dest}</span>
                              </label>
                              {selectedDestinos.includes(dest) && (
                                <div className="space-y-2 mt-2 ml-6">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px]  opacity-40 uppercase">Límite (TFs &gt;= 5 und):</span>
                                    <input
                                      type="number"
                                      min="1"
                                      placeholder="Todos"
                                      className="w-full border-b border-border py-0.5 text-[10px]  focus:outline-none bg-transparent"
                                      value={destLimits[dest] || ''}
                                      onChange={(e) => setLimitForDest(dest, e.target.value === '' ? '' : parseInt(e.target.value))}
                                    />
                                  </div>
                                  <div className="bg-muted/30 p-2  text-[9px]  space-y-1">
                                    <div className="flex justify-between">
                                      <span className="opacity-60">TFs Seleccionadas:</span>
                                      <span className="font-bold">{dispatchStats[dest]?.filteredTFs || 0} / {dispatchStats[dest]?.originalTFs || 0}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="opacity-60">Unidades Totales:</span>
                                      <span className="font-bold">{dispatchStats[dest]?.filteredUnits || 0} / {dispatchStats[dest]?.originalUnits || 0}</span>
                                    </div>
                                    <p className="text-[8px] italic opacity-40 leading-tight pt-1">
                                      * BDBOL y TFs pequeñas se incluyen siempre.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-3 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 border border-border">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={18} />
                          <input
                            type="text"
                            placeholder="Buscar por código o TFT..."
                            className="w-full pl-10 pr-4 py-2 border-b border-border focus:outline-none focus:border-opacity-100 bg-transparent  text-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                          />
                        </div>

                        <div className="flex items-center gap-2 px-4 py-2 bg-muted  text-xs ">
                          <ArrowUpDown size={14} />
                          <span>Orden: Fecha TFT (Vieja a Nueva)</span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-green-50 border border-green-600 p-4">
                            <h4 className=" text-xs uppercase opacity-60">Coincidencias</h4>
                            <p className="text-3xl font-bold">{filteredMatchedData.length}</p>
                        </div>
                        <div className="bg-red-50 border border-red-600 p-4">
                            <h4 className=" text-xs uppercase opacity-60">Sin Cruce</h4>
                            <p className="text-3xl font-bold">{filteredUnmatchedData.length}</p>
                        </div>
                      </div>

                      <div>
                          <h3 className="font-bold tracking-tight text-lg mb-2">Resultados del Cruce ({filteredMatchedData.length} coincidencias)</h3>
                          <div className="border border-border max-h-[60vh] overflow-y-auto custom-scrollbar">
                              {Object.keys(filteredMatchedData.reduce((acc, item) => ({...acc, [item.destino]: true }), {})).sort().map(destino => {
                                  const itemsInDest = filteredMatchedData.filter(item => item.destino === destino);
                                  return (
                                  <Collapsible key={destino} className="border-b border-border" defaultOpen>
                                      <CollapsibleTrigger className="w-full bg-muted p-3 text-left  text-sm flex justify-between items-center hover:bg-accent transition-all">
                                      <span>{destino} ({itemsInDest.length} ítems)</span>
                                      <ChevronsUpDown size={16} className="opacity-50" />
                                      </CollapsibleTrigger>
                                      <CollapsibleContent className="bg-white">
                                      <Table>
                                          <TableHeader>
                                          <TableRow>
                                              <TableHead className="w-[20%]">Código</TableHead>
                                              <TableHead>TFT (Cruce)</TableHead>
                                              <TableHead>Fecha TFT</TableHead>
                                              <TableHead>Cant TFT</TableHead>
                                              <TableHead>Empacador</TableHead>
                                          </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                          {itemsInDest.map(item => (
                                              <TableRow key={item.codigo}>
                                              <TableCell className=" text-xs font-bold">{item.codigo}</TableCell>
                                              <TableCell>{item.tftMatch}</TableCell>
                                              <TableCell>{item.tftFecha ? format(item.tftFecha, 'dd/MM/yyyy') : '-'}</TableCell>
                                              <TableCell>{item.tftCantidad}</TableCell>
                                              <TableCell>{item.empacador}</TableCell>
                                              </TableRow>
                                          ))}
                                          </TableBody>
                                      </Table>
                                      </CollapsibleContent>
                                  </Collapsible>
                                  )
                              })}
                          </div>
                      </div>

                      <div>
                          <h3 className="font-bold tracking-tight text-lg mb-2 text-red-700">Mercancía Sin Cruce ({filteredUnmatchedData.length})</h3>
                          <div className="border border-border max-h-[40vh] overflow-y-auto custom-scrollbar">
                          <Table>
                              <TableHeader>
                              <TableRow>
                                  <TableHead>Código</TableHead>
                                  <TableHead>Destino</TableHead>
                                  <TableHead>Fecha Creación</TableHead>
                                  <TableHead>Empacador</TableHead>
                              </TableRow>
                              </TableHeader>
                              <TableBody>
                              {filteredUnmatchedData.map(item => (
                                  <TableRow key={item.codigo}>
                                  <TableCell className=" text-xs font-bold">{item.codigo}</TableCell>
                                  <TableCell>{item.destino}</TableCell>
                                  <TableCell>{format(item.fechaCreacion, 'dd/MM/yyyy')}</TableCell>
                                  <TableCell>{item.empacador}</TableCell>
                                  </TableRow>
                              ))}
                              </TableBody>
                          </Table>
                          </div>
                      </div>

                    </div>
                  </div>
                </div>
              )
            )}
            {activeModule === 'verificacion' && <VerificationModule />}
            {activeModule === 'historial' && <VerificationHistory />}
          </>
        ) : (
          <VerificationModule />
        )}
      </main>

      <footer className="max-w-7xl mx-auto p-6 mt-12 border-t border-border opacity-50 flex justify-between items-center  text-[10px] ">
        <span>Sistema de Cruce Logístico v2.1</span>
        <span>&copy; {new Date().getFullYear()} • Eficiencia Operativa</span>
      </footer>
    </div>
  );
}
