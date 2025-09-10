
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, PlusCircle, FileDown, Printer } from 'lucide-react';
import type { WholesaleOrder, PreprintedLabel } from '@/types';
import { generateAndSaveLabels, getLabelsForOrder, addSingleLabel } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LabelReport } from './LabelReport';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Tag } from 'lucide-react';
import { exportToXlsx } from '@/services/export';


const LabelCard: React.FC<{ label: PreprintedLabel, order: WholesaleOrder, isSelected: boolean, isExported: boolean, onSelect: (id: string, checked: boolean) => void }> = ({ label, order, isSelected, isExported, onSelect }) => {
    const displayValue = label.id.split('-').pop() || label.id;
    return (
        <div className="relative p-3 border border-gray-300 rounded-lg bg-white text-black break-inside-avoid flex flex-col" style={{ width: '10cm', height: '5cm' }}>
            <Checkbox
                id={`select-${label.id}`}
                checked={isSelected}
                onCheckedChange={(checked) => onSelect(label.id, !!checked)}
                className="absolute top-2 left-2 bg-white"
            />
            {isExported && (
                <div className="absolute top-2 right-2 text-gray-400 opacity-50" title="Esta etiqueta ya fue exportada.">
                    <Printer className="w-5 h-5" />
                </div>
            )}
            <div className="flex justify-between items-start text-xs font-sans border-b pb-1 mb-1">
                <div className="space-y-1">
                    <p className="font-bold">RANKING SPORT S.A.S</p>
                    <p>Pedido: <span className="font-semibold">{order.ordenDeCompra || order.id}</span></p>
                </div>
                <div className="text-right space-y-1">
                    <div className="font-bold text-sm">BDIST</div>
                    <p>Destino: <span className="font-semibold">{order.cliente}</span></p>
                </div>
            </div>
            <div className="flex-grow flex flex-col items-center justify-center pt-1">
                <div className="text-center font-mono text-5xl leading-none whitespace-nowrap p-2 border-2 border-dashed" style={{ fontFamily: "'Libre Barcode 128', cursive" }}>{displayValue}</div>
                <div className="font-sans text-xs tracking-widest mt-1">{label.id}</div>
            </div>
        </div>
    );
};

export const LabelPrintDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void; order: WholesaleOrder; }> = ({ isOpen, onOpenChange, order }) => {
    const { toast } = useToast();
    const [labels, setLabels] = useState<PreprintedLabel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    
    const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
    const [exportedLabels, setExportedLabels] = useState<Set<string>>(new Set());
    const BATCH_SIZE = 50;


    const fetchLabels = useCallback(async () => {
        if (!order) return;
        setIsLoading(true);
        setSelectedLabels(new Set());
        const result = await getLabelsForOrder(order.id);
        if (result.data) {
            if (result.data.length > 0) {
                setLabels(result.data.sort((a,b) => a.id.localeCompare(b.id)));
            } else {
                const genResult = await generateAndSaveLabels(order.id, order.cantidadTotal);
                if (genResult.data) {
                    toast({
                        title: 'Etiquetas Generadas',
                        description: `Se han generado y guardado ${genResult.data.generatedCount} etiquetas.`,
                    });
                    const finalResult = await getLabelsForOrder(order.id);
                    if(finalResult.data) setLabels(finalResult.data.sort((a,b) => a.id.localeCompare(b.id)));
                } else {
                    toast({ variant: 'destructive', title: 'Error al Generar', description: genResult.error });
                }
            }
        } else {
             toast({ variant: 'destructive', title: 'Error al Cargar', description: result.error });
        }
        setIsLoading(false);
    }, [order, toast]);

    useEffect(() => {
        if (isOpen && order) {
            fetchLabels();
        } else {
            setExportedLabels(new Set()); // Reset on close
        }
    }, [isOpen, order, fetchLabels]);
    
    const unprintedLabels = labels.filter(l => !exportedLabels.has(l.id));
    const printedLabels = labels.filter(l => exportedLabels.has(l.id));

    const handleExportExcel = () => {
      if (selectedLabels.size === 0) {
        toast({ variant: 'destructive', title: 'Error', description: 'No hay etiquetas seleccionadas para exportar.' });
        return;
      }

      setIsExporting(true);
      try {
        const labelsToExport = labels
            .filter(l => selectedLabels.has(l.id))
            .map(l => ({ 'ID Etiqueta': l.id }));
        
        exportToXlsx(labelsToExport, `etiquetas_pedido_${order.id}`);
        
        toast({ title: 'Éxito', description: `Excel con ${labelsToExport.length} etiquetas generado.` });
        setExportedLabels(prev => new Set([...prev, ...selectedLabels]));
        setSelectedLabels(new Set()); // Clear selection after export
      } catch (error) {
        console.error("Error generating Excel: ", error);
        toast({ variant: 'destructive', title: 'Error al Exportar', description: 'No se pudo generar el archivo Excel.' });
      } finally {
        setIsExporting(false);
      }
    };


    const handleSelectLabel = (id: string, checked: boolean) => {
        setSelectedLabels(prev => {
            const newSet = new Set(prev);
            if (checked) {
                newSet.add(id);
            } else {
                newSet.delete(id);
            }
            return newSet;
        });
    };
    
    const handleSelectAllUnprinted = (checked: boolean) => {
        if (checked) {
            setSelectedLabels(new Set(unprintedLabels.map(l => l.id)));
        } else {
            setSelectedLabels(new Set());
        }
    };
    
    const handleSelectBatch = () => {
        const nextBatch = unprintedLabels.slice(0, BATCH_SIZE);
        setSelectedLabels(new Set(nextBatch.map(l => l.id)));
    };
    
    const handleAddLabel = async () => {
        setIsLoading(true);
        const result = await addSingleLabel(order.id);
        if (result.data) {
            setLabels(prev => [...prev, result.data!].sort((a,b) => a.id.localeCompare(b.id)));
            toast({
                title: 'Etiqueta Adicional Creada',
                description: `Se ha generado la etiqueta ${result.data.id}.`,
            });
        } else {
             toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsLoading(false);
    }
    
    const isAllUnprintedSelected = unprintedLabels.length > 0 && selectedLabels.size === unprintedLabels.length;

    const renderLabelGrid = (labelList: PreprintedLabel[], isPrintedTab: boolean) => (
        <ScrollArea className="h-96 border rounded-lg bg-gray-100 p-4">
            <div id="print-area" className="grid grid-cols-2 gap-4">
                {labelList.map(label => (
                   <div id={`label-card-${label.id}`} key={label.id}>
                     <LabelCard
                          label={label}
                          order={order}
                          isSelected={selectedLabels.has(label.id)}
                          isExported={isPrintedTab}
                          onSelect={handleSelectLabel}
                      />
                    </div>
                ))}
            </div>
        </ScrollArea>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Imprimir Etiquetas para Pedido: {order.id}</DialogTitle>
                    <DialogDescription>
                        Se han generado {labels.length} etiquetas. Puede exportar un archivo de Excel o ver el reporte.
                    </DialogDescription>
                </DialogHeader>
                
                 <Tabs defaultValue="unprinted" className="w-full mt-4">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="unprinted">Por Imprimir ({unprintedLabels.length})</TabsTrigger>
                        <TabsTrigger value="printed">Impresas ({printedLabels.length})</TabsTrigger>
                        <TabsTrigger value="report">Reporte de Uso</TabsTrigger>
                    </TabsList>
                    <TabsContent value="unprinted">
                        <div className="my-4">
                            {isLoading ? (
                                <div className="flex justify-center items-center h-64">
                                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                                </div>
                            ) : (
                                <>
                                <div className="flex flex-wrap items-center gap-4 p-2 border-b mb-4">
                                     <div className="flex items-center space-x-2">
                                        <Checkbox id="select-all" checked={isAllUnprintedSelected} onCheckedChange={handleSelectAllUnprinted} />
                                        <Label htmlFor="select-all" className="font-semibold">Seleccionar Todo ({unprintedLabels.length})</Label>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={handleSelectBatch}>1er Lote ({Math.min(unprintedLabels.length, BATCH_SIZE)})</Button>
                                    <Button variant="ghost" size="sm" onClick={() => setSelectedLabels(new Set())}>Deseleccionar</Button>
                                    <div className="flex-grow"></div>
                                    <Button type="button" onClick={handleExportExcel} disabled={isLoading || isExporting || selectedLabels.size === 0}>
                                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileDown className="mr-2 h-4 w-4" />}
                                        Exportar {selectedLabels.size} a Excel
                                    </Button>
                                </div>
                                {renderLabelGrid(unprintedLabels, false)}
                                </>
                            )}
                        </div>
                    </TabsContent>
                    <TabsContent value="printed">
                         <div className="my-4">{isLoading ? <div className="flex justify-center items-center h-64"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div> : renderLabelGrid(printedLabels, true) }</div>
                    </TabsContent>
                    <TabsContent value="report">
                        <LabelReport labels={labels} />
                    </TabsContent>
                </Tabs>


                <DialogFooter className="justify-between">
                    <div>
                         <Button variant="outline" onClick={handleAddLabel} disabled={isLoading}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Añadir Etiqueta Manual
                        </Button>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        Cerrar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
