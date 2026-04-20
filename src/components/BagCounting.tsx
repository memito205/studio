
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Search, 
  Loader2, 
  Package, 
  AlertTriangle,
  History,
  XCircle,
  Printer,
  Download,
  CheckCircle,
  FileText,
  Camera,
  X
} from 'lucide-react';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import { 
  createBagOperation, 
  getBagOperations, 
  processBagScan, 
  deleteBagOperation,
  updateBagOperationStatus,
  addBagsToOperation,
  resetBagState,
  resetAllBags
} from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import type { BagOperation, BagItem } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface BagCountingProps {
  onReturn: () => void;
}

export const BagCounting: React.FC<BagCountingProps> = ({ onReturn }) => {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [operations, setOperations] = useState<BagOperation[]>([]);
  const [activeOperation, setActiveOperation] = useState<BagOperation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isAddingBags, setIsAddingBags] = useState(false);
  const [extraBagsCount, setExtraBagsCount] = useState(1);
  
  // Creation Form States
  const [newName, setNewName] = useState('');
  const [newTotal, setNewTotal] = useState(1);
  
  // Scanner States
  const [scanInput, setScanInput] = useState('');
  const [lastScanned, setLastScanned] = useState<{ code: string; success: boolean; message?: string; errorType?: 'NOT_FOUND' | 'DUPLICATE' | 'INVALID_PHASE' } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    fetchOperations();
  }, []);

  const fetchOperations = async () => {
    setIsLoading(true);
    const result = await getBagOperations();
    if (result.success && result.data) {
      setOperations(result.data.map(o => ({
          ...o,
          createdAt: o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt)
      })));
    }
    setIsLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || newTotal < 1 || !user) return;
    
    setIsProcessing(true);
    const result = await createBagOperation(newName, newTotal, user.uid, user.displayName || 'Sistema');
    if (result.success && result.data) {
      const newO = { ...result.data, createdAt: new Date() };
      setOperations([newO, ...operations]);
      setActiveOperation(newO);
      setIsCreating(false);
      setNewName('');
      setNewTotal(1);
      toast({ title: "Operación Creada", description: `Lote "${newName}" iniciado en fase de Cargue.` });
    } else {
      toast({ variant: 'destructive', title: "Error", description: result.error });
    }
    setIsProcessing(false);
  };

  const handleAddBags = async () => {
    if (!activeOperation || extraBagsCount < 1) return;
    
    setIsProcessing(true);
    const result = await addBagsToOperation(activeOperation.id, extraBagsCount);
    if (result.success) {
      const opId = activeOperation.id;
      const currentBags = { ...activeOperation.bags };
      const currentTotal = activeOperation.totalBags;
      const newTotal = currentTotal + extraBagsCount;
      
      for (let i = currentTotal + 1; i <= newTotal; i++) {
        const bagId = `${opId}-B${i.toString().padStart(3, '0')}`;
        currentBags[bagId] = { id: bagId, loaded: false, discharged: false };
      }

      const updatedOp = { ...activeOperation, totalBags: newTotal, bags: currentBags };
      setActiveOperation(updatedOp);
      setOperations(operations.map(o => o.id === opId ? updatedOp : o));
      setIsAddingBags(false);
      setExtraBagsCount(1);
      toast({ title: "Bolsas Agregadas", description: `Se añadieron ${extraBagsCount} bolsas al lote.` });
    } else {
      toast({ variant: 'destructive', title: "Error", description: result.error });
    }
    setIsProcessing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Está seguro de eliminar esta operación?")) return;
    
    const result = await deleteBagOperation(id);
    if (result.success) {
      setOperations(operations.filter(o => o.id !== id));
      toast({ title: "Operación Eliminada" });
    } else {
      toast({ variant: 'destructive', title: "Error", description: result.error });
    }
  };

  const handleScan = async (e?: React.FormEvent, manualCode?: string) => {
    if (e) e.preventDefault();
    const targetCode = manualCode || scanInput;
    if (!activeOperation || !targetCode || isProcessing) return;
    
    // Normalización de caracteres por compatibilidad de escáneres
    let barcode = targetCode.trim().toUpperCase().replace(/['"\/\\|]/g, '-');
    setScanInput(''); // Limpiar inmediatamente para el siguiente escaneo

    setIsProcessing(true);
    const result = await processBagScan(activeOperation.id, barcode, activeOperation.status as 'cargue' | 'descargue');
    setIsProcessing(false);
    
    if (result.success) {
      if (result.alreadyProcessed) {
          // Tratar duplicado como evento de alta visibilidad (Alerta Naranja)
          setLastScanned({ 
            code: barcode, 
            success: false, // Success false dispara el overlay grande
            message: "CÓDIGO YA PROCESADO", 
            errorType: 'DUPLICATE' 
          });
      } else {
          setLastScanned({ 
            code: barcode, 
            success: true, 
            message: "Registrado con éxito" 
          });
          
          // Actualización optimista del estado local
          setActiveOperation(prev => {
              if (!prev) return null;
              const statusField = prev.status === 'cargue' ? 'loaded' : 'discharged';
              const timeField = prev.status === 'cargue' ? 'loadedAt' : 'dischargedAt';
              
              const updatedBags = { 
                ...prev.bags, 
                [barcode]: { 
                  ...prev.bags[barcode], 
                  [statusField]: true, 
                  [timeField]: new Date() 
                } 
              };
              return { ...prev, bags: updatedBags };
          });
      }
    } else {
      setLastScanned({ 
        code: barcode, 
        success: false, 
        message: result.error || "CÓDIGO INVÁLIDO",
        errorType: result.errorType
      });
    }

    // Asegurar que el cursor siempre regrese al input
    setTimeout(() => { scanInputRef.current?.focus(); }, 150);
  };

  const startCamera = () => {
    setIsCameraOpen(true);
    setTimeout(() => {
        if (!scannerRef.current) {
            const scanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: { width: 250, height: 250 } },
                false
            );
            
            scanner.render(
                (decodedText) => {
                    scanner.clear();
                    setIsCameraOpen(false);
                    // Pass directly to handleScan to avoid state delay
                    handleScan(undefined, decodedText);
                },
                (error) => { /* quiet fail for frame errors */ }
            );
            scannerRef.current = scanner;
        }
    }, 300);
  };

  const stopCamera = () => {
    if (scannerRef.current) {
        scannerRef.current.clear().catch(err => console.error(err));
        scannerRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const handleFinishPhase = async () => {
      if (!activeOperation) return;
      
      const bags = Object.values(activeOperation.bags);
      const phaseField = activeOperation.status === 'cargue' ? 'loaded' : 'discharged';
      const processedCount = bags.filter(b => b[phaseField]).length;
      const pendingCount = activeOperation.totalBags - processedCount;
      const currentStatus = activeOperation.status;
      const nextStatus = currentStatus === 'cargue' ? 'descargue' : 'completed';
      
      let confirmMsg = "";
      if (currentStatus === 'cargue') {
          confirmMsg = pendingCount > 0 
            ? `⚠️ ¡ATENCIÓN! Faltan ${pendingCount} bolsas por CARGAR. Si cierra ahora, estas bolsas no podrán completarse en la siguiente fase. ¿Continuar?`
            : "¿Desea finalizar la fase de CARGUE? Se habilitará el Descargue.";
      } else {
          confirmMsg = pendingCount > 0
            ? `⚠️ ¡AVISO! Hay ${pendingCount} bolsas sin DESCARGAR. ¿Desea cerrar la operación con faltantes?`
            : "¿Desea finalizar esta operación por completo?";
      }

      if (!confirm(confirmMsg)) return;
      
      setIsProcessing(true);
      const result = await updateBagOperationStatus(activeOperation.id, nextStatus);
      if (result.success) {
          const updated: BagOperation = { ...activeOperation, status: nextStatus as 'cargue' | 'descargue' | 'completed' };
          setActiveOperation(updated);
          setOperations(operations.map(o => o.id === activeOperation.id ? updated : o));
          
          if (nextStatus === 'completed') {
            toast({ title: "Operación Finalizada", description: "Generando reporte de cierre..." });
            setTimeout(() => { handleDownloadPDF(); }, 1000);
          } else {
            toast({ title: "Fase de Cargue Cerrada", description: "Inicie el proceso de Descargue." });
          }
      }
      setIsProcessing(false);
  }

  const handleResetBag = async (barcode: string) => {
      if (!activeOperation || !user) return;
      if (role !== 'admin') {
          toast({ variant: 'destructive', title: "Permiso denegado", description: "Solo administradores pueden resetear bolsas." });
          return;
      }

      if (!confirm(`¿Desea resetear el estado de la bolsa ${barcode}? Se borrará el registro de cargue y descargue.`)) return;

      setIsProcessing(true);
      const result = await resetBagState(activeOperation.id, barcode, 'both');
      if (result.success) {
          setActiveOperation(prev => {
              if (!prev) return null;
              const updatedBags = { ...prev.bags };
              updatedBags[barcode] = { ...updatedBags[barcode], loaded: false, discharged: false };
              delete updatedBags[barcode].loadedAt;
              delete updatedBags[barcode].dischargedAt;
              return { ...prev, bags: updatedBags };
          });
          toast({ title: "Bolsa Reseteada", description: `El código ${barcode} ahora está disponible para volver a procesar.` });
      } else {
          toast({ variant: 'destructive', title: "Error", description: result.error });
      }
      setIsProcessing(false);
  }

  const handleResetAll = async () => {
      if (!activeOperation || !user) return;
      if (role !== 'admin') {
          toast({ variant: 'destructive', title: "Permiso denegado", description: "Solo administradores pueden resetear el lote completo." });
          return;
      }

      const confirmMsg = `⚠️ ADVERTENCIA CRÍTICA: ¿Estás seguro de que deseas resetear TODAS las bolsas de este lote (${activeOperation.totalBags} unidades)?
      
Esto borrará todos los registros de cargue y descargue del lote actual. Esta acción no se puede deshacer.`;

      if (!confirm(confirmMsg)) return;

      setIsProcessing(true);
      const result = await resetAllBags(activeOperation.id);
      if (result.success) {
          setActiveOperation(prev => {
              if (!prev) return null;
              const updatedBags = { ...prev.bags };
              for (const id in updatedBags) {
                  updatedBags[id] = { ...updatedBags[id], loaded: false, discharged: false };
                  delete updatedBags[id].loadedAt;
                  delete updatedBags[id].dischargedAt;
              }
              return { ...prev, bags: updatedBags };
          });
          toast({ title: "Lote Reseteado", description: "Todas las bolsas han vuelto al estado pendiente." });
      } else {
          toast({ variant: 'destructive', title: "Error", description: result.error });
      }
      setIsProcessing(false);
  }

  const handleDownloadExcel = () => {
      if (!activeOperation) return;
      
      const rows = Object.values(activeOperation.bags).sort((a,b) => a.id.localeCompare(b.id)).map(bag => ({
          'Código de Bolsa': bag.id,
          'Referencia': bag.id.split('-').pop(),
          'Cargado': bag.loaded ? 'SÍ' : 'NO',
          'Fecha Cargue': bag.loadedAt ? (bag.loadedAt instanceof Date ? bag.loadedAt.toLocaleString() : 'N/A') : '-',
          'Descargado': bag.discharged ? 'SÍ' : 'NO',
          'Fecha Descargue': bag.dischargedAt ? (bag.dischargedAt instanceof Date ? bag.dischargedAt.toLocaleString() : 'N/A') : '-',
          'Lote': activeOperation.name,
          'ID Operación': activeOperation.id
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Etiquetas");
      XLSX.writeFile(wb, `Etiquetas_Bolsas_${activeOperation.id}_${activeOperation.name.replace(/\s+/g, '_')}.xlsx`);
      toast({ title: "Excel Generado", description: "Use este archivo para impresión de etiquetas." });
  };

  const handleDownloadPDF = () => {
      if (!activeOperation) return;
      
      const doc = new jsPDF();
      const bags = Object.values(activeOperation.bags).sort((a,b) => a.id.localeCompare(b.id));
      const loadedCount = bags.filter(b => b.loaded).length;
      const dischargedCount = bags.filter(b => b.discharged).length;
      const progress = Math.round((dischargedCount / activeOperation.totalBags) * 100);
      
      // Header
      doc.setFontSize(20);
      doc.setTextColor(40, 40, 40);
      doc.text("REPORTE OPERACIÓN DE BOLSAS", 105, 20, { align: 'center' });
      
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Lote: ${activeOperation.name}`, 20, 35);
      doc.text(`ID Operación: ${activeOperation.id}`, 20, 40);
      doc.text(`Creado por: ${activeOperation.createdByName}`, 20, 45);
      doc.text(`Fecha Generación: ${new Date().toLocaleString()}`, 20, 50);

      // Summary Table
      autoTable(doc, {
          startY: 60,
          head: [['Concepto', 'Cantidad', 'Avance %']],
          body: [
              ['Total Bolsas', activeOperation.totalBags.toString(), '100%'],
              ['Cargadas (Origen)', loadedCount.toString(), `${Math.round((loadedCount/activeOperation.totalBags)*100)}%`],
              ['Descargadas (Destino)', dischargedCount.toString(), `${progress}%`]
          ],
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229] }
      });

      // Detailed List
      const rows = bags.map(bag => [
          bag.id,
          bag.loaded ? 'CARGADO' : 'PENDIENTE',
          bag.loadedAt ? (bag.loadedAt instanceof Date ? bag.loadedAt.toLocaleString() : 'S/D') : '-',
          bag.discharged ? 'DESCARGADO' : 'PENDIENTE',
          bag.dischargedAt ? (bag.dischargedAt instanceof Date ? bag.dischargedAt.toLocaleString() : 'S/D') : '-'
      ]);

      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text("Detalle de Seguimiento:", 20, finalY);

      autoTable(doc, {
          startY: finalY + 5,
          head: [['Código de Bolsa', 'Cargue', 'Fecha Cargue', 'Descargue', 'Fecha Descargue']],
          body: rows,
          theme: 'grid',
          headStyles: { fillColor: [100, 100, 100] },
          margin: { top: 10 }
      });

      doc.save(`Reporte_Operacion_${activeOperation.id}.pdf`);
      toast({ title: "PDF Generado", description: "El reporte se ha descargado correctamente." });
  };

  const handlePrint = () => {
      handleDownloadPDF();
  };

  if (activeOperation) {
    const bags = Object.values(activeOperation.bags);
    const phaseField = activeOperation.status === 'cargue' ? 'loaded' : 'discharged';
    const processedCount = bags.filter(b => b[phaseField]).length;
    const progress = Math.round((processedCount / activeOperation.totalBags) * 100);
    
    return (
      <div className="relative space-y-6 min-h-screen pb-20">
        {/* LARGE ALERT OVERLAY */}
        {lastScanned && !lastScanned.success && (
            <div 
                className={cn(
                    "fixed inset-0 z-50 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 p-10",
                    lastScanned.errorType === 'DUPLICATE' ? "bg-orange-500/95" : "bg-red-600/95"
                )}
                onClick={() => setLastScanned(null)}
            >
                <XCircle className="h-32 w-32 sm:h-64 sm:w-64 text-white mb-6 sm:mb-8 animate-bounce" />
                <h2 className="text-4xl sm:text-8xl font-black text-white text-center mb-4 uppercase tracking-tighter leading-none px-4">
                    {lastScanned.message}
                </h2>
                <p className="text-xl sm:text-4xl font-bold text-white/80 uppercase break-all px-6 text-center">Código: {lastScanned.code}</p>
                <Button 
                    variant="outline" 
                    className="mt-8 sm:mt-12 h-16 sm:h-20 px-8 sm:px-12 text-lg sm:text-2xl font-black border-4 border-white text-white hover:bg-white hover:text-orange-600 rounded-full"
                    onClick={() => setLastScanned(null)}
                >
                    ENTENDIDO
                </Button>
            </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-4 sm:p-6 rounded-xl border shadow-sm gap-4">
            <div className="w-full sm:w-auto">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl sm:text-3xl font-black text-primary">{activeOperation.name}</h2>
                    <Badge variant="outline" className="text-[10px] font-black bg-primary/5">ID: {activeOperation.id}</Badge>
                </div>
                <div className="flex gap-2 items-center mt-2">
                    <Badge variant={activeOperation.status === 'completed' ? 'secondary' : 'default'} className={cn(
                        "px-2 py-0.5 text-[10px] sm:text-xs font-black uppercase tracking-wider",
                        activeOperation.status === 'cargue' ? "bg-amber-500 hover:bg-amber-600" : 
                        activeOperation.status === 'descargue' ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-500"
                    )}>
                        {activeOperation.status === 'cargue' ? '🚢 CARGUE' : 
                         activeOperation.status === 'descargue' ? '🎯 DESCARGUE' : '🏁 FIN'}
                    </Badge>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-[10px] h-9" onClick={handleDownloadExcel} title="Descargar códigos para etiquetas">
                    <Download className="mr-1 h-3 w-3" /> Etiquetas
                </Button>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-[10px] h-9" onClick={handleDownloadPDF} title="Generar PDF">
                    <Printer className="mr-1 h-3 w-3" /> Reporte
                </Button>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-[10px] h-9" onClick={() => setActiveOperation(null)}>
                    <ArrowLeft className="mr-1 h-3 w-3" /> Salir
                </Button>
            </div>
        </div>

        {/* CAMERA MODAL */}
        {isCameraOpen && (
            <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden relative">
                    <Button 
                        variant="destructive" 
                        size="icon" 
                        className="absolute top-2 right-2 z-10 rounded-full" 
                        onClick={stopCamera}
                    >
                        <X className="h-6 w-6" />
                    </Button>
                    <div id="reader" className="w-full"></div>
                    <div className="p-4 bg-slate-900 text-white text-center">
                        <p className="font-black uppercase tracking-tighter text-sm">Encuadre el código de barras</p>
                    </div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* LEFT: Scanner & Summary */}
            <div className="lg:col-span-1 space-y-6 order-1 lg:order-none">
                <Card className={cn(
                    "border-4 shadow-xl overflow-hidden transition-colors duration-300",
                    activeOperation.status === 'cargue' ? "border-amber-500/20" : "border-blue-600/20"
                )}>
                    <CardHeader className={cn(
                        "pb-4 px-4 sm:px-6",
                        activeOperation.status === 'cargue' ? "bg-amber-500/5" : "bg-blue-600/5"
                    )}>
                        <CardTitle className="text-base sm:text-lg">Escáner de Fase: {activeOperation.status.toUpperCase()}</CardTitle>
                        <CardDescription className="text-xs">Escanee el código de barras</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 sm:pt-6 space-y-4 px-4 sm:px-6">
                        <form onSubmit={handleScan} className="space-y-4 relative">
                            <Input 
                                ref={scanInputRef}
                                type="text"
                                placeholder="..."
                                className="text-3xl sm:text-4xl h-20 sm:h-24 text-center font-black focus-visible:ring-primary border-4 rounded-2xl tracking-widest"
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                autoFocus
                                disabled={activeOperation.status === 'completed' || isCameraOpen}
                            />
                            <div className="flex gap-2">
                                <Button 
                                    className={cn(
                                        "flex-[3] h-12 sm:h-14 text-sm sm:text-xl font-black uppercase tracking-wider",
                                        activeOperation.status === 'cargue' ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
                                    )} 
                                    type="submit"
                                    disabled={activeOperation.status === 'completed'}
                                >
                                    <CheckCircle2 className="mr-2 h-5 w-5 sm:h-6 sm:w-6" /> Procesar
                                </Button>
                                <Button 
                                    variant="outline"
                                    className="flex-1 h-12 sm:h-14 border-2"
                                    onClick={startCamera}
                                    type="button"
                                    title="Escanear con Cámara"
                                >
                                    <Camera className="h-6 w-6" />
                                </Button>
                            </div>
                        </form>

                        {lastScanned && lastScanned.success && (
                            <div className={cn(
                                "p-5 rounded-2xl flex items-center gap-4 animate-in zoom-in-95 duration-200 shadow-sm border-2 bg-green-50 border-green-200 text-green-700"
                            )}>
                                <CheckCircle2 className="h-10 w-10 shrink-0" />
                                <div>
                                    <p className="text-xl font-black truncate max-w-[180px]">{lastScanned.code}</p>
                                    <p className="text-xs font-bold uppercase tracking-tight">{lastScanned.message}</p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* ADD BAGS CARD (Only in Cargue) */}
                {activeOperation.status === 'cargue' && (
                    <Card className="border-2 border-dashed border-muted-foreground/20 bg-muted/5">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-black uppercase tracking-widest opacity-60">Expandir Lote</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!isAddingBags ? (
                                <Button variant="outline" className="w-full font-bold border-2" onClick={() => setIsAddingBags(true)}>
                                    <Plus className="mr-2 h-4 w-4" /> Agregar más bolsas
                                </Button>
                            ) : (
                                <div className="space-y-3 p-3 bg-white rounded-lg border shadow-inner">
                                    <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Cantidad Extra</label>
                                    <div className="flex gap-2">
                                        <Input 
                                            type="number" 
                                            min={1} 
                                            max={100} 
                                            value={extraBagsCount} 
                                            onChange={(e) => setExtraBagsCount(parseInt(e.target.value))}
                                            className="font-black text-lg"
                                        />
                                        <Button className="font-black" onClick={handleAddBags} disabled={isProcessing}>
                                            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Añadir"}
                                        </Button>
                                    </div>
                                    <Button variant="ghost" size="sm" className="w-full text-xs font-bold" onClick={() => setIsAddingBags(false)}>Cancelar</Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                <Card className="shadow-lg border-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-widest font-black opacity-40">Resumen de Fase</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-2">
                        <div className="flex justify-between items-end">
                            <p className="text-6xl font-black tabular-nums">{progress}%</p>
                            <p className="text-right text-muted-foreground mb-1 leading-none">
                                <span className={cn(
                                    "text-2xl font-black",
                                    activeOperation.status === 'cargue' ? "text-amber-500" : "text-blue-600"
                                )}>{processedCount}</span><br/>
                                <span className="text-xs font-bold font-mono">de {activeOperation.totalBags}</span>
                            </p>
                        </div>
                        <div className="w-full bg-muted rounded-full h-5 overflow-hidden shadow-inner border p-1">
                            <div 
                                className={cn(
                                    "h-full rounded-full transition-all duration-1000 ease-out flex items-center justify-end pr-2",
                                    progress === 100 ? "bg-green-500" : 
                                    activeOperation.status === 'cargue' ? "bg-amber-500" : "bg-blue-600"
                                )}
                                style={{ width: `${progress}%` }}
                            >
                                {progress > 15 && <div className="h-1 w-1 bg-white/40 rounded-full animate-pulse" />}
                            </div>
                        </div>

                        {activeOperation.status !== 'completed' && (
                            <div className="space-y-3">
                                {progress < 100 && (
                                    <p className="text-[10px] font-bold text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex items-center gap-2">
                                        <AlertTriangle className="h-3 w-3" /> Faltan {activeOperation.totalBags - processedCount} bolsas por procesar.
                                    </p>
                                )}
                                <Button 
                                    className={cn(
                                        "w-full h-12 text-lg font-bold shadow-lg transition-all",
                                        progress === 100 ? "animate-pulse" : "opacity-80 hover:opacity-100",
                                        activeOperation.status === 'cargue' ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-green-600 hover:bg-green-700"
                                    )} 
                                    onClick={handleFinishPhase}
                                >
                                    <CheckCircle2 className="mr-2 h-5 w-5" /> 
                                    {activeOperation.status === 'cargue' ? "Finalizar Cargue" : "Finalizar Todo"}
                                </Button>
                            </div>
                        )}

                        <div className="pt-6 border-t grid grid-cols-2 gap-4">
                            <div className="bg-muted/50 p-3 rounded-lg text-center">
                                <span className="text-[10px] uppercase font-black opacity-50 block mb-1">Pendientes</span>
                                <span className="font-black text-xl tabular-nums">{activeOperation.totalBags - processedCount}</span>
                            </div>
                            <div className={cn(
                                "p-3 rounded-lg text-center border",
                                activeOperation.status === 'cargue' ? "bg-amber-50 border-amber-100" : "bg-blue-50 border-blue-100"
                            )}>
                                <span className={cn(
                                    "text-[10px] uppercase font-black block mb-1",
                                    activeOperation.status === 'cargue' ? "text-amber-600" : "text-blue-600"
                                )}>Leídas</span>
                                <span className={cn(
                                    "font-black text-xl tabular-nums",
                                    activeOperation.status === 'cargue' ? "text-amber-600" : "text-blue-600"
                                )}>{processedCount}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* RIGHT: Visual Grid */}
            <div className="lg:col-span-3">
                <Card className="h-full shadow-lg border-2">
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/10 py-3 sm:py-6">
                        <div>
                            <CardTitle className="text-lg sm:text-xl font-black">Grilla Operativa</CardTitle>
                            <CardDescription className="font-medium text-[10px] sm:text-xs uppercase tracking-tight">Estado individual por bolsa</CardDescription>
                        </div>
                        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-4">
                            {role === 'admin' && activeOperation.status !== 'completed' && (
                                <Button 
                                    variant="destructive" 
                                    size="sm" 
                                    className="h-7 sm:h-8 px-2 sm:px-3 text-[10px] font-black uppercase tracking-tighter"
                                    onClick={handleResetAll}
                                >
                                    <Trash2 className="mr-1 h-3 w-3" /> Resetear Todo
                                </Button>
                            )}
                            <div className="flex gap-3 text-[9px] sm:text-[10px] font-black uppercase tracking-widest">
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                    <div className={cn(
                                        "w-3 h-3 sm:w-4 sm:h-4 rounded shadow-md border",
                                        activeOperation.status === 'cargue' ? "bg-amber-500 border-amber-600" : "bg-blue-600 border-blue-700"
                                    )}></div> <span className="hidden sm:inline">Procesada</span>
                                </div>
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                    <div className="w-3 h-3 sm:w-4 sm:h-4 bg-slate-200 rounded border"></div> <span className="hidden sm:inline">Pendiente</span>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6">
                        <ScrollArea className="h-[calc(85vh-260px)]">
                            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3 pr-6">
                                {Object.values(activeOperation.bags).sort((a,b) => a.id.localeCompare(b.id)).map((bag, i) => {
                                    const isProcessed = bag[phaseField];
                                    return (
                                        <div 
                                            key={bag.id}
                                            className={cn(
                                                "aspect-square rounded-xl flex flex-col items-center justify-center text-xs font-black transition-all duration-300 border-2 overflow-hidden shadow-sm relative group/item",
                                                isProcessed 
                                                    ? (activeOperation.status === 'cargue' 
                                                        ? "bg-amber-500 border-amber-600 text-white scale-105 shadow-amber-200" 
                                                        : "bg-blue-600 border-blue-700 text-white scale-105 shadow-blue-200")
                                                    : "bg-slate-50 border-slate-200 text-slate-300"
                                            )}
                                            title={bag.id}
                                        >
                                            {isProcessed && role === 'admin' && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); handleResetBag(bag.id); }}
                                                    className="absolute -top-1 -right-1 bg-red-600 text-white p-1 rounded-full shadow-lg opacity-0 group-hover/item:opacity-100 transition-opacity hover:bg-red-700 z-10"
                                                    title="Resetear bolsa"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            )}
                                            <span className="text-[8px] opacity-70 mb-1">B{String(i + 1).padStart(3, '0')}</span>
                                            <span className="text-sm font-black tracking-tighter">
                                                {isProcessed ? <CheckCircle className="h-4 w-4" /> : i + 1}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-8 animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-4 sm:p-8 rounded-2xl border border-border shadow-md gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-primary">Conteo de Bolsas</h1>
          <p className="text-xs sm:text-base text-muted-foreground font-medium">Sistema de validación por lotes.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={onReturn} className="flex-1 sm:flex-none h-10 sm:h-12 px-4 sm:px-6 font-bold text-xs sm:text-sm">
                <ArrowLeft className="mr-2 h-4 w-4 sm:h-5 sm:w-5" /> Volver
            </Button>
            <Button onClick={() => setIsCreating(!isCreating)} className="flex-[2] sm:flex-none h-10 sm:h-12 px-4 sm:px-6 font-black bg-primary hover:bg-primary/90 shadow-lg text-xs sm:text-sm text-white">
                <Plus className="mr-2 h-4 w-4 sm:h-5 sm:w-5 text-white" /> Iniciar Sesión
            </Button>
        </div>
      </div>

      {isCreating && (
        <Card className="animate-in slide-in-from-top-4 duration-500 border-4 border-primary/10 shadow-2xl overflow-hidden">
            <div className="bg-primary/5 p-4 border-b">
                <CardTitle className="text-lg sm:text-xl font-black">Nuevo Lote</CardTitle>
            </div>
            <CardContent className="pt-4 sm:pt-8 px-4 sm:px-6">
                <form onSubmit={handleCreate} className="flex flex-col sm:grid sm:grid-cols-3 gap-4 sm:gap-8 items-end max-w-5xl mx-auto pb-4">
                    <div className="w-full space-y-2 sm:space-y-3">
                        <label className="text-[10px] sm:text-xs font-black uppercase tracking-widest opacity-70">📍 Nombre del Lote</label>
                        <Input 
                            placeholder="Ej: Despacho 001" 
                            className="h-12 sm:h-14 text-base sm:text-lg font-bold border-2 focus-visible:ring-primary"
                            value={newName} 
                            onChange={(e) => setNewName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="w-full space-y-2 sm:space-y-3">
                        <label className="text-[10px] sm:text-xs font-black uppercase tracking-widest opacity-70">🔢 Cantidad</label>
                        <Input 
                            type="number" 
                            min={1} 
                            max={5000}
                            className="h-12 sm:h-14 text-base sm:text-lg font-bold border-2 focus-visible:ring-primary"
                            value={newTotal} 
                            onChange={(e) => setNewTotal(parseInt(e.target.value))}
                            required
                        />
                    </div>
                    <div className="flex gap-2 w-full pb-1">
                        <Button type="submit" className="flex-[2] h-12 sm:h-14 text-sm sm:text-lg font-black uppercase tracking-wider shadow-xl" disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : "Crear"}
                        </Button>
                        <Button type="button" variant="ghost" className="flex-1 h-12 sm:h-14 px-3 sm:px-6 font-bold text-xs" onClick={() => setIsCreating(false)}>X</Button>
                    </div>
                </form>
            </CardContent>
        </Card>
      )}

      <Card className="border-2 shadow-xl">
          <CardHeader className="bg-muted/30 border-b">
              <CardTitle className="flex items-center gap-2">
                  <History className="h-6 w-6 text-primary" />
                  Operaciones Registradas
              </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-6">
                    <div className="relative">
                        <Loader2 className="h-16 w-16 animate-spin text-primary opacity-20" />
                        <Package className="h-8 w-8 text-primary absolute inset-0 m-auto animate-bounce" />
                    </div>
                    <p className="text-lg font-bold text-muted-foreground">Sincronizando con base de datos...</p>
                </div>
            ) : operations.length === 0 ? (
                <div className="text-center py-32 space-y-6">
                    <div className="bg-muted w-24 h-24 rounded-full flex items-center justify-center mx-auto text-muted-foreground border-2 border-dashed border-muted-foreground/30">
                        <Package className="h-12 w-12" />
                    </div>
                    <div className="max-w-md mx-auto">
                        <h3 className="text-2xl font-black">No hay operaciones activas</h3>
                        <p className="text-muted-foreground font-medium mt-2">Parece que no hay procesos de conteo iniciados actualmente. ¡Comience uno nuevo!</p>
                    </div>
                    <Button onClick={() => setIsCreating(true)} variant="outline" className="h-12 px-8 font-black border-2">Crear mi primera operación</Button>
                </div>
            ) : (
                <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/10 hover:bg-muted/10">
                            <TableHead className="py-4 font-black text-xs uppercase tracking-widest pl-6">Identificador / Lote</TableHead>
                            <TableHead className="font-black text-xs uppercase tracking-widest">Fecha</TableHead>
                            <TableHead className="font-black text-xs uppercase tracking-widest">Fase / Estado</TableHead>
                            <TableHead className="font-black text-xs uppercase tracking-widest">Control Operativo</TableHead>
                            <TableHead className="text-right pr-6 font-black text-xs uppercase tracking-widest">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {operations.map(op => {
                            const bagsArr = Object.values(op.bags);
                            const loaded = bagsArr.filter(b => b.loaded).length;
                            const discharged = bagsArr.filter(b => b.discharged).length;
                            const total = op.totalBags;
                            const phase = op.status;
                            const percent = phase === 'cargue' ? Math.round((loaded/total)*100) : Math.round((discharged/total)*100);
                            
                            return (
                                <TableRow key={op.id} className="group hover:bg-primary/5 transition-all duration-200 cursor-pointer" onClick={() => setActiveOperation(op)}>
                                    <TableCell className="py-4 sm:py-6 pl-4 sm:pl-6 min-w-[150px]">
                                        <div className="font-black text-sm sm:text-xl text-primary truncate max-w-[120px] sm:max-w-none">{op.name}</div>
                                        <div className="text-[8px] sm:text-[10px] font-bold opacity-40 font-mono">{op.id}</div>
                                    </TableCell>
                                    <TableCell className="font-bold text-muted-foreground text-[10px] sm:text-sm hidden sm:table-cell">
                                        {op.createdAt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                    </TableCell>
                                    <TableCell>
                                        <Badge 
                                            variant={op.status === 'completed' ? 'secondary' : 'default'}
                                            className={cn(
                                                "font-black uppercase tracking-tighter px-2 py-0.5 text-[9px] sm:text-xs",
                                                op.status === 'cargue' ? "bg-amber-500" : 
                                                op.status === 'descargue' ? "bg-blue-600" : "bg-slate-200 text-slate-600"
                                            )}
                                        >
                                            {op.status === 'cargue' ? '🚢 Cargue' : 
                                             op.status === 'descargue' ? '🎯 Descargue' : '🏁 Cerrado'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <div className="flex flex-col gap-2 min-w-[200px]">
                                            <div className="flex justify-between items-baseline">
                                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">
                                                    Progreso {phase.toUpperCase()}
                                                </span>
                                                <span className={cn(
                                                    "text-sm font-black tabular-nums",
                                                    phase === 'cargue' ? "text-amber-600" : "text-blue-600"
                                                )}>{percent}%</span>
                                            </div>
                                            <div className="w-full bg-muted rounded-full h-3 overflow-hidden shadow-inner border border-muted-foreground/10">
                                                <div 
                                                    className={cn(
                                                        "h-full transition-all duration-1000",
                                                        percent === 100 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : 
                                                        phase === 'cargue' ? "bg-amber-500" : "bg-blue-600"
                                                    )} 
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                            <p className="text-[10px] font-bold text-muted-foreground tracking-tight">
                                                {phase === 'cargue' ? `${loaded} cargadas` : `${discharged} validadas`} de {total}
                                            </p>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right pr-6 space-x-2">
                                        <Button 
                                            variant={op.status !== 'completed' ? 'default' : 'outline'} 
                                            size="sm" 
                                            className={cn("font-bold px-4 h-10 shadow-sm", op.status === 'cargue' ? "bg-amber-500 hover:bg-amber-600" : "")}
                                            onClick={() => setActiveOperation(op)}
                                        >
                                            <Search className="mr-2 h-4 w-4" /> Gestionar
                                        </Button>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-10 w-10 text-destructive hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" 
                                            onClick={(e) => { e.stopPropagation(); handleDelete(op.id); }}
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
                </div>
            )}
          </CardContent>
      </Card>
      
      {/* Footer Info Hub */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-20 bg-primary/5 p-12 rounded-[2.5rem] border-2 border-primary/10">
          <div className="flex gap-6">
              <div className="bg-primary/20 p-4 rounded-2xl h-fit border border-primary/20 shadow-xl">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <div>
                  <h4 className="font-black text-2xl tracking-tight mb-2">Validación Instantánea</h4>
                  <p className="text-muted-foreground font-medium leading-relaxed">
                      Escanear una bolsa actualiza la base de datos centralizada en milisegundos. 
                      Ideal para despachos de alto volumen donde cada segundo cuenta.
                  </p>
              </div>
          </div>
          <div className="flex gap-6">
              <div className="bg-green-100 p-4 rounded-2xl h-fit border border-green-200 shadow-xl">
                  <Package className="h-10 w-10 text-green-600" />
              </div>
              <div>
                  <h4 className="font-black text-2xl tracking-tight mb-2">Seguimiento Visual</h4>
                  <p className="text-muted-foreground font-medium leading-relaxed">
                      La grilla de control permite a los coordinadores detectar huecos en la carga 
                      de un solo vistazo, asegurando la integridad del despacho.
                  </p>
              </div>
          </div>
      </div>
    </div>
  );
};
