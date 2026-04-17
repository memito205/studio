
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
  FileText
} from 'lucide-react';
import { 
  createBagOperation, 
  getBagOperations, 
  processBagScan, 
  deleteBagOperation,
  updateBagOperationStatus,
  addBagsToOperation
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
  const { user } = useAuth();
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

  const handleScan = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeOperation || !scanInput) return;
    
    const barcode = scanInput.trim().toUpperCase();
    setScanInput(''); // Clear immediately

    const result = await processBagScan(activeOperation.id, barcode, activeOperation.status as 'cargue' | 'descargue');
    
    if (result.success) {
      const isAlready = !!result.alreadyProcessed;
      setLastScanned({ 
          code: barcode, 
          success: true, 
          message: isAlready ? "CÓDIGO YA PROCESADO" : "Registrado con éxito",
          errorType: isAlready ? 'DUPLICATE' : undefined
      });
      
      if (!isAlready) {
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
        message: result.error || "Ocurrió un error",
        errorType: result.errorType
      });
    }
  };

  const handleFinishPhase = async () => {
      if (!activeOperation) return;
      const currentStatus = activeOperation.status;
      const nextStatus = currentStatus === 'cargue' ? 'descargue' : 'completed';
      
      const confirmMsg = currentStatus === 'cargue' 
        ? "¿Finalizar fase de CARGUE? Se habilitará automáticamente la fase de DESCARGUE."
        : "¿Finalizar esta operación por completo?";

      if (!confirm(confirmMsg)) return;
      
      setIsProcessing(true);
      const result = await updateBagOperationStatus(activeOperation.id, nextStatus);
      if (result.success) {
          const updated = { ...activeOperation, status: nextStatus };
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

  const handleDownloadExcel = () => {
      if (!activeSession) return;
      
      const validatedSet = new Set(activeSession.validatedBags || []);
      const rows = Array.from({ length: activeSession.totalBags }, (_, i) => i + 1).map(num => ({
          'Número de Bolsa': num,
          'Estado': validatedSet.has(num) ? 'VALIDADA' : 'PENDIENTE',
          'Lote': activeSession.name,
          'ID Sesión': activeSession.id
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Validación");
      XLSX.writeFile(wb, `Reporte_Bolsas_${activeSession.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast({ title: "Excel Generado" });
  };

  const handleDownloadPDF = () => {
      if (!activeSession) return;
      
      const doc = new jsPDF();
      const validatedSet = new Set(activeSession.validatedBags || []);
      const progress = Math.round((validatedSet.size / activeSession.totalBags) * 100);
      
      // Header
      doc.setFontSize(20);
      doc.setTextColor(40, 40, 40);
      doc.text("REPORTE DE VALIDACIÓN DE BOLSAS", 105, 20, { align: 'center' });
      
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text(`Lote: ${activeSession.name}`, 20, 35);
      doc.text(`ID Sesión: ${activeSession.id}`, 20, 42);
      doc.text(`Fecha: ${activeSession.createdAt.toLocaleDateString()}`, 20, 49);
      doc.text(`Estado: ${activeSession.status === 'active' ? 'EN PROCESO' : 'COMPLETADO'}`, 20, 56);

      // Summary Table
      autoTable(doc, {
          startY: 65,
          head: [['Concepto', 'Cantidad', 'Porcentaje']],
          body: [
              ['Total Bolsas', activeSession.totalBags.toString(), '100%'],
              ['Validadas', validatedSet.size.toString(), `${progress}%`],
              ['Pendientes', (activeSession.totalBags - validatedSet.size).toString(), `${100 - progress}%`]
          ],
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229] } // Primary color
      });

      // Detailed List
      const rows = Array.from({ length: activeSession.totalBags }, (_, i) => i + 1).map(num => [
          num.toString(),
          validatedSet.has(num) ? 'VALIDADA' : 'PENDIENTE'
      ]);

      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text("Detalle de Validación:", 20, finalY);

      autoTable(doc, {
          startY: finalY + 5,
          head: [['Número de Bolsa', 'Estado']],
          body: rows,
          theme: 'grid',
          headStyles: { fillColor: [100, 100, 100] },
          margin: { top: 10 }
      });

      doc.save(`Reporte_Bolsas_${activeSession.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
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
                <XCircle className="h-64 w-64 text-white mb-8 animate-bounce" />
                <h2 className="text-8xl font-black text-white text-center mb-4 uppercase tracking-tighter">
                    {lastScanned.message}
                </h2>
                <p className="text-4xl font-bold text-white/80 uppercase">Código: {lastScanned.code}</p>
                <Button 
                    variant="outline" 
                    className="mt-12 h-20 px-12 text-2xl font-black border-4 border-white text-white hover:bg-white hover:text-orange-600 rounded-full"
                    onClick={() => setLastScanned(null)}
                >
                    ENTENDIDO / CONTINUAR
                </Button>
            </div>
        )}

        <div className="flex justify-between items-center bg-card p-6 rounded-xl border shadow-sm">
            <div>
                <div className="flex items-center gap-3">
                    <h2 className="text-3xl font-black text-primary">{activeOperation.name}</h2>
                    <Badge variant="outline" className="text-xs font-black bg-primary/5">ID: {activeOperation.id}</Badge>
                </div>
                <div className="flex gap-2 items-center mt-2">
                    <Badge variant={activeOperation.status === 'completed' ? 'secondary' : 'default'} className={cn(
                        "px-3 py-1 text-xs font-black uppercase tracking-wider",
                        activeOperation.status === 'cargue' ? "bg-amber-500 hover:bg-amber-600" : 
                        activeOperation.status === 'descargue' ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-500"
                    )}>
                        {activeOperation.status === 'cargue' ? '🚢 EN CARGUE (ORIGEN)' : 
                         activeOperation.status === 'descargue' ? '🎯 EN DESCARGUE (DESTINO)' : '🏁 COMPLETADO'}
                    </Badge>
                </div>
            </div>
            <div className="flex gap-2">
                <Button variant="outline" onClick={handleDownloadExcel} title="Descargar códigos para etiquetas">
                    <Download className="mr-2 h-4 w-4" /> Etiquetas
                </Button>
                <Button variant="outline" onClick={handleDownloadPDF} title="Generar PDF">
                    <Printer className="mr-2 h-4 w-4" /> Reporte
                </Button>
                <Button variant="outline" onClick={() => setActiveOperation(null)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Salir
                </Button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* LEFT: Scanner & Summary */}
            <div className="lg:col-span-1 space-y-6">
                <Card className={cn(
                    "border-4 shadow-xl overflow-hidden transition-colors duration-300",
                    activeOperation.status === 'cargue' ? "border-amber-500/20" : "border-blue-600/20"
                )}>
                    <CardHeader className={cn(
                        "pb-4",
                        activeOperation.status === 'cargue' ? "bg-amber-500/5" : "bg-blue-600/5"
                    )}>
                        <CardTitle className="text-lg">Escáner de Fase: {activeOperation.status.toUpperCase()}</CardTitle>
                        <CardDescription>Escanee el código de barras de la bolsa</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                        <form onSubmit={handleScan} className="space-y-4">
                            <Input 
                                ref={scanInputRef}
                                type="text"
                                placeholder="..."
                                className="text-4xl h-24 text-center font-black focus-visible:ring-primary border-4 rounded-2xl tracking-widest"
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                autoFocus
                                disabled={activeOperation.status === 'completed'}
                            />
                            <Button 
                                className={cn(
                                    "w-full h-14 text-xl font-black uppercase tracking-wider",
                                    activeOperation.status === 'cargue' ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
                                )} 
                                type="submit"
                                disabled={activeOperation.status === 'completed'}
                            >
                                <CheckCircle2 className="mr-2 h-6 w-6" /> Procesar Bolsa
                            </Button>
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

                        {activeOperation.status !== 'completed' && progress === 100 && (
                            <Button 
                                className={cn(
                                    "w-full h-12 text-lg font-bold shadow-lg animate-pulse",
                                    activeOperation.status === 'cargue' ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-green-600 hover:bg-green-700"
                                )} 
                                onClick={handleFinishPhase}
                            >
                                <CheckCircle2 className="mr-2 h-5 w-5" /> 
                                {activeOperation.status === 'cargue' ? "Finalizar Cargue" : "Finalizar Todo"}
                            </Button>
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
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/10">
                        <div>
                            <CardTitle className="text-xl font-black">Grilla Operativa</CardTitle>
                            <CardDescription className="font-medium text-xs uppercase tracking-tight">Estado individual por bolsa</CardDescription>
                        </div>
                        <div className="flex gap-4 text-[10px] font-black uppercase tracking-widest">
                            <div className="flex items-center gap-2">
                                <div className={cn(
                                    "w-4 h-4 rounded shadow-md border",
                                    activeOperation.status === 'cargue' ? "bg-amber-500 border-amber-600" : "bg-blue-600 border-blue-700"
                                )}></div> Procesada
                            </div>
                            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-slate-200 rounded border"></div> Pendiente</div>
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
                                                "aspect-square rounded-xl flex flex-col items-center justify-center text-xs font-black transition-all duration-300 border-2 overflow-hidden shadow-sm",
                                                isProcessed 
                                                    ? (activeOperation.status === 'cargue' 
                                                        ? "bg-amber-500 border-amber-600 text-white scale-105" 
                                                        : "bg-blue-600 border-blue-700 text-white scale-105")
                                                    : "bg-slate-50 border-slate-200 text-slate-300"
                                            )}
                                            title={bag.id}
                                        >
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

  // View: Main List
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center bg-card p-8 rounded-2xl border border-border shadow-md">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-primary">Conteo de Bolsas</h1>
          <p className="text-muted-foreground font-medium">Sistema de validación por lotes para control logístico.</p>
        </div>
        <div className="flex gap-3">
            <Button variant="outline" onClick={onReturn} className="h-12 px-6 font-bold">
                <ArrowLeft className="mr-2 h-5 w-5" /> Volver
            </Button>
            <Button onClick={() => setIsCreating(!isCreating)} className="h-12 px-6 font-black bg-primary hover:bg-primary/90 shadow-lg">
                <Plus className="mr-2 h-5 w-5" /> Iniciar Sesión
            </Button>
        </div>
      </div>

      {isCreating && (
        <Card className="animate-in slide-in-from-top-4 duration-500 border-4 border-primary/10 shadow-2xl overflow-hidden">
            <div className="bg-primary/5 p-4 border-b">
                <CardTitle className="text-xl font-black">Configuración de Nuevo Lote</CardTitle>
                <CardDescription className="font-bold text-xs uppercase tracking-widest opacity-60">Complete los parámetros de validación</CardDescription>
            </div>
            <CardContent className="pt-8">
                <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end max-w-5xl mx-auto pb-4">
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest opacity-70">📍 Nombre del Lote</label>
                        <Input 
                            placeholder="Ej: Despacho 001 - Cali" 
                            className="h-14 text-lg font-bold border-2 focus-visible:ring-primary"
                            value={newName} 
                            onChange={(e) => setNewName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest opacity-70">🔢 Cantidad de Bolsas</label>
                        <Input 
                            type="number" 
                            min={1} 
                            max={5000}
                            className="h-14 text-lg font-bold border-2 focus-visible:ring-primary"
                            value={newTotal} 
                            onChange={(e) => setNewTotal(parseInt(e.target.value))}
                            required
                        />
                    </div>
                    <div className="flex gap-3 pb-1">
                        <Button type="submit" className="flex-1 h-14 text-lg font-black uppercase tracking-wider shadow-xl" disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : "Crear Sesión"}
                        </Button>
                        <Button type="button" variant="ghost" className="h-14 px-6 font-bold" onClick={() => setIsCreating(false)}>Cancelar</Button>
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
                                <TableRow key={op.id} className="group hover:bg-primary/5 transition-all duration-200">
                                    <TableCell className="py-6 pl-6">
                                        <div className="font-black text-xl text-primary">{op.name}</div>
                                        <div className="text-[10px] font-bold opacity-40 font-mono">{op.id}</div>
                                    </TableCell>
                                    <TableCell className="font-bold text-muted-foreground">
                                        {op.createdAt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </TableCell>
                                    <TableCell>
                                        <Badge 
                                            variant={op.status === 'completed' ? 'secondary' : 'default'}
                                            className={cn(
                                                "font-black uppercase tracking-tighter px-3 py-1",
                                                op.status === 'cargue' ? "bg-amber-500" : 
                                                op.status === 'descargue' ? "bg-blue-600" : "bg-slate-200 text-slate-600"
                                            )}
                                        >
                                            {op.status === 'cargue' ? '🚢 Cargue' : 
                                             op.status === 'descargue' ? '🎯 Descargue' : '🏁 Cerrado'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-2 min-w-[240px]">
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
