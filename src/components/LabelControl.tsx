

"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, Store, Loader2, Printer, FileDown, Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import type { GeneralLabel, GeneralLabelOwnerType } from '@/types';
import { generateAndSaveGeneralLabels, getLabelsForOwner, markGeneralLabelsAsUsed, searchGeneralLabels } from '@/app/actions';
import { LabelReport } from './LabelReport';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { exportToXlsx } from '@/services/export';


const LabelCard: React.FC<{ label: GeneralLabel, isSelected: boolean, isExported: boolean, onSelect: (id: string, checked: boolean) => void }> = ({ label, isSelected, isExported, onSelect }) => {
    const displayValue = label.id.split('-').pop() || label.id;
    const formattedId = label.ownerType === 'packer' ? label.id.replace(/-/g, '/') : label.id;
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
                <p className="font-bold">RANKING SPORT S.A.S</p>
                <p>Propietario: <span className="font-semibold">{label.ownerId}</span></p>
            </div>
            <div className="flex-grow flex flex-col items-center justify-center pt-1">
                <div className="text-center font-mono text-5xl leading-none whitespace-nowrap p-2 border-2 border-dashed tracking-widest" style={{ fontFamily: "'Libre Barcode 128', cursive" }}>{displayValue}</div>
                <div className="font-sans text-xs tracking-widest mt-1">{formattedId}</div>
            </div>
            <div className="mt-1 border-t pt-1">
                <p className="text-xs font-semibold">Destino:</p>
                <div className="h-4 border-b border-black"></div>
            </div>
        </div>
    )
};


const GenerateDialog: React.FC<{
    isOpen: boolean; onOpenChange: (open: boolean) => void;
    ownerId: string; ownerType: GeneralLabelOwnerType; onConfirm: (quantity: number) => void;
    isLoading: boolean;
}> = ({ isOpen, onOpenChange, ownerId, onConfirm, isLoading }) => {
    const [quantity, setQuantity] = useState(1);
    const handleConfirm = () => { if (quantity > 0) onConfirm(quantity); };
    
    const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuantity(value === '' ? 1 : Math.max(1, parseInt(value, 10)));
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent><DialogHeader>
                <DialogTitle>Generar Etiquetas para {ownerId}</DialogTitle>
                <DialogDescription>¿Cuántas etiquetas desea generar?</DialogDescription>
            </DialogHeader>
            <div className="py-4"><Input type="number" value={quantity} onChange={handleQuantityChange} min="1" /></div>
            <DialogFooter>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button onClick={handleConfirm} disabled={isLoading}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button>
            </DialogFooter></DialogContent>
        </Dialog>
    );
};

const PACKERS = [
    "ABEL FELIPE TRUJILLO DAVID",
    "ADRIAN MONTOYA ECHAVARRIA",
    "AMX",
    "ARLEY GABRIEL GIRALDO VELEZ",
    "AVELINO MOSQUERA PALACIOS",
    "CARLOS ALBERTO HERRERA ECHEVERRI",
    "CARLOS MARIO CHALARCA ACOSTA",
    "DARIO ALEJANDRO VANEGAS HINCAPIE",
    "DAYRON ALBERTO OROZCO MIRA",
    "DIEGO ALEXIS MANYOMA SANCHEZ",
    "EDWAR SAMUEL RANGEL RANGEL",
    "EMPAQUES Y SOLUCIONES",
    "JHON ALONSO BASTIDAS MARIN",
    "JHON FREDY LONDONO CARVAJAL",
    "JHON JAMER CORDOBA CORDOBA",
    "JHON MARIO HERNANDEZ VELEZ",
    "JORGE DE JESUS AVALOS ALVAREZ",
    "JOSE MARCIAL DIAZ CASTRO",
    "OBED SAUCEDO CONTRERAS",
    "OSME VALENCIA FLOREZ",
    "REYNEL GARZON",
    "SEBASTIAN HERACLIO GIRALDO PALACIO",
    "SEBASTIAN ZAPATA",
    "VICTOR HUGO RESTREPO ARIAS",
    "VICTOR MENA COSSIO",
].sort();

const STORES = [
    "TIENDA APARTADO",
    "TIENDA BELLO",
    "TIENDA CALI",
    "TIENDA ENVIGADO",
    "TIENDA FLORESTA",
    "TIENDA ITAGUI",
    "TIENDA MOLINOS",
    "TIENDA MONTERIA",
    "TIENDA RIONEGRO",
    "TIENDA SABANETA",
    "TIENDA PREMIUM",
    "TIENDA UNICENTRO",
    "TIENDA VIVA CAUCASIA",
    "TIENDA VIVA ENVIGADO",
].sort();


interface LabelControlProps {
    onReturnToSuite: () => void;
}

const PrintDialog: React.FC<{
    isOpen: boolean; onOpenChange: (open: boolean) => void;
    ownerId: string;
}> = ({ isOpen, onOpenChange, ownerId }) => {
    const [labels, setLabels] = useState<GeneralLabel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
    const [exportedLabels, setExportedLabels] = useState<Set<string>>(new Set());
    const BATCH_SIZE = 50;
    const { toast } = useToast();

    const fetchLabels = useCallback(async () => {
        if (!ownerId) return;
        setIsLoading(true);
        setSelectedLabels(new Set());
        const { data, error } = await getLabelsForOwner(ownerId);
        if (error) { toast({ variant: 'destructive', title: 'Error', description: error }); }
        else { 
            const fetchedLabels = data || [];
            setLabels(fetchedLabels);
            // Initialize exported labels based on their status from Firestore
            const alreadyUsed = new Set(fetchedLabels.filter(l => l.status === 'used').map(l => l.id));
            setExportedLabels(alreadyUsed);
        }
        setIsLoading(false);
    }, [ownerId, toast]);

    useEffect(() => { 
        if (isOpen) { 
            fetchLabels(); 
        } else { 
            // Reset state when dialog closes to ensure fresh data on reopen
            setLabels([]);
            setSelectedLabels(new Set());
            setExportedLabels(new Set());
        } 
    }, [isOpen, ownerId, fetchLabels]);
    
    const unprintedLabels = labels.filter(l => !exportedLabels.has(l.id));
    const printedLabels = labels.filter(l => exportedLabels.has(l.id));

    const handleExportExcel = async () => {
      if (selectedLabels.size === 0) {
        toast({ variant: 'destructive', title: 'Error', description: 'No hay etiquetas seleccionadas.' });
        return;
      }
      setIsExporting(true);
      try {
        const labelIdsToExport = Array.from(selectedLabels);
        const labelsToExportData = labels
            .filter(l => labelIdsToExport.includes(l.id))
            .map(l => ({ 
                'ID Etiqueta': l.id.replace(/-/g, '/'),
                'Propietario': l.ownerId 
            }));
        
        exportToXlsx(labelsToExportData, `etiquetas_generales_${ownerId}`);
        
        // Mark as used in backend
        const result = await markGeneralLabelsAsUsed(labelIdsToExport);
        if (result.success) {
            toast({ title: 'Éxito', description: `Excel con ${labelsToExportData.length} etiquetas generado y estado actualizado en la base de datos.` });
            setExportedLabels(prev => new Set([...prev, ...selectedLabels]));
            setSelectedLabels(new Set());
        } else {
            throw new Error(result.error);
        }
        
      } catch (error: any) {
        console.error("Error generating Excel or marking labels: ", error);
        toast({ variant: 'destructive', title: 'Error', description: `No se pudo completar la operación: ${error.message}` });
      } finally {
        setIsExporting(false);
      }
    };
    
    const handleSelectLabel = (id: string, checked: boolean) => {
        setSelectedLabels(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(id); else newSet.delete(id);
            return newSet;
        });
    };

    const handleSelectAllUnprinted = (checked: boolean) => {
        const unprintedIds = unprintedLabels.map(l => l.id);
        if (checked) {
            setSelectedLabels(new Set(unprintedIds));
        } else {
            const currentSelection = new Set(selectedLabels);
            unprintedIds.forEach(id => currentSelection.delete(id));
            setSelectedLabels(currentSelection);
        }
    };


    const handleSelectBatch = () => {
        const nextBatch = unprintedLabels.slice(0, BATCH_SIZE);
        setSelectedLabels(new Set(nextBatch.map(l => l.id)));
    };
    
    const isAllUnprintedSelected = unprintedLabels.length > 0 && unprintedLabels.every(l => selectedLabels.has(l.id));

    const renderLabelGrid = (labelList: GeneralLabel[], isPrintedTab: boolean) => (
        <ScrollArea className="h-96 border rounded-lg bg-gray-100 p-4">
            <div id="general-print-area" className="grid grid-cols-2 gap-4">
                {labelList.map(label => (
                    <div id={`label-card-${label.id}`} key={label.id}>
                        <LabelCard
                            label={label}
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
        <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl">
            <DialogHeader><DialogTitle>Imprimir/Ver Reporte de Etiquetas para: {ownerId}</DialogTitle></DialogHeader>
            <Tabs defaultValue="unprinted" className="w-full mt-4">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="unprinted">Por Imprimir ({unprintedLabels.length})</TabsTrigger>
                    <TabsTrigger value="printed">Impresas ({printedLabels.length})</TabsTrigger>
                    <TabsTrigger value="report">Reporte de Uso</TabsTrigger>
                </TabsList>
                <TabsContent value="unprinted">
                    <div className="my-4">{isLoading ? <div className="flex justify-center items-center h-64"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div> : <>
                        <div className="flex flex-wrap items-center gap-4 p-2 border-b mb-4">
                            <div className="flex items-center space-x-2"><Checkbox id="select-all-general" checked={isAllUnprintedSelected} onCheckedChange={handleSelectAllUnprinted} /><Label htmlFor="select-all-general" className="font-semibold">Seleccionar Todo ({unprintedLabels.length})</Label></div>
                            <Button variant="outline" size="sm" onClick={handleSelectBatch}>1er Lote ({Math.min(unprintedLabels.length, BATCH_SIZE)})</Button>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedLabels(new Set())}>Deseleccionar</Button>
                            <div className="flex-grow"></div>
                            <Button type="button" onClick={handleExportExcel} disabled={isLoading || isExporting || selectedLabels.size === 0}>
                                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileDown className="mr-2 h-4 w-4" />}
                                Exportar {selectedLabels.size} a Excel
                            </Button>
                        </div>
                        {renderLabelGrid(unprintedLabels, false)}
                    </>}</div>
                </TabsContent>
                <TabsContent value="printed">
                     <div className="my-4">{isLoading ? <div className="flex justify-center items-center h-64"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div> : renderLabelGrid(printedLabels, true) }</div>
                </TabsContent>
                <TabsContent value="report"><LabelReport labels={labels} /></TabsContent>
            </Tabs>
            <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
        </DialogContent></Dialog>
    );
};

export const LabelControl: React.FC<LabelControlProps> = ({ onReturnToSuite }) => {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [dialogState, setDialogState] = useState<{ isOpen: boolean; ownerId: string; ownerType: GeneralLabelOwnerType | null }>({ isOpen: false, ownerId: '', ownerType: null });
    const [printDialogState, setPrintDialogState] = useState<{ isOpen: boolean; ownerId: string; }>({ isOpen: false, ownerId: '' });

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<GeneralLabel[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value;
        setSearchQuery(query);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (!query.trim()) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            const { data, error } = await searchGeneralLabels(query);
            if (error) {
                toast({ variant: 'destructive', title: 'Error de Búsqueda', description: error });
            } else {
                setSearchResults(data || []);
            }
            setIsSearching(false);
        }, 300); // 300ms debounce
    };

    const handleGenerateClick = (ownerId: string, ownerType: GeneralLabelOwnerType) => {
        setDialogState({ isOpen: true, ownerId, ownerType });
    };

    const handlePrintClick = (ownerId: string) => {
        // Reset state before opening to force re-render and data fetch in PrintDialog
        setPrintDialogState({ isOpen: false, ownerId: '' });
        setTimeout(() => {
            setPrintDialogState({ isOpen: true, ownerId });
        }, 0);
    };

    const handleConfirmGeneration = async (quantity: number) => {
        if (!dialogState.ownerId || !dialogState.ownerType) return;
        setIsLoading(true);
        const { data, error } = await generateAndSaveGeneralLabels({ ownerType: dialogState.ownerType, ownerId: dialogState.ownerId, quantity });
        if (error) {
            toast({ variant: 'destructive', title: 'Error al generar etiquetas', description: error });
        } else {
            toast({ title: 'Éxito', description: `Se generaron ${data?.generatedCount} etiquetas para ${dialogState.ownerId}.` });
            setDialogState({ ...dialogState, isOpen: false });
            handlePrintClick(dialogState.ownerId); // Open print dialog with the new data
        }
        setIsLoading(false);
    };

    const renderTable = (items: string[], type: GeneralLabelOwnerType, Icon: React.ElementType) => (
        <Table>
            <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
            <TableBody>
                {items.map(item => (
                    <TableRow key={item}><TableCell className="font-medium flex items-center gap-2"><Icon className="w-4 h-4 text-muted-foreground" />{item}</TableCell>
                    <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handlePrintClick(item)}>Ver / Exportar</Button>
                        <Button size="sm" onClick={() => handleGenerateClick(item, type)}>Generar Etiquetas</Button>
                    </TableCell></TableRow>
                ))}
            </TableBody>
        </Table>
    );

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <GenerateDialog
          isOpen={dialogState.isOpen}
          onOpenChange={(open) => setDialogState(prev => ({...prev, isOpen: open}))}
          ownerId={dialogState.ownerId}
          ownerType={dialogState.ownerType!}
          onConfirm={handleConfirmGeneration}
          isLoading={isLoading}
      />
      <PrintDialog
          isOpen={printDialogState.isOpen}
          onOpenChange={(open) => setPrintDialogState({ isOpen: open, ownerId: '' })}
          ownerId={printDialogState.ownerId}
      />

       <Card>
        <CardHeader className="flex flex-row justify-between items-center">
            <div>
                <CardTitle>Búsqueda Rápida de Etiquetas</CardTitle>
                <CardDescription>Encuentre a qué propietario pertenece una etiqueta específica.</CardDescription>
            </div>
            <Button onClick={onReturnToSuite} variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Volver a la Suite</Button>
        </CardHeader>
        <CardContent>
            <div className="flex items-center gap-2">
                <Search className="h-5 w-5 text-muted-foreground" />
                <Input
                    type="text"
                    placeholder="Escriba el ID de la etiqueta (ej. BOD-AFT-12345)..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                />
            </div>
            {isSearching && <div className="flex justify-center items-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {!isSearching && searchQuery && (
                <div className="mt-4 border rounded-lg">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID Etiqueta</TableHead>
                                <TableHead>Propietario</TableHead>
                                <TableHead>Estado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {searchResults.length > 0 ? (
                                searchResults.map(label => (
                                    <TableRow key={label.id}>
                                        <TableCell className="font-mono">{label.id}</TableCell>
                                        <TableCell>{label.ownerId}</TableCell>
                                        <TableCell>{label.status}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                                        No se encontraron etiquetas que coincidan con la búsqueda.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
        </CardContent>
       </Card>

      <Card>
        <CardHeader>
            <CardTitle>Generación y Gestión por Propietario</CardTitle>
            <CardDescription>Genere, imprima y gestione las etiquetas de despacho por cada empacador o tienda.</CardDescription>
        </CardHeader>
        <CardContent>
            <Tabs defaultValue="packers">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="packers"><User className="mr-2"/>Empacadores</TabsTrigger>
                    <TabsTrigger value="stores"><Store className="mr-2"/>Tiendas</TabsTrigger>
                </TabsList>
                <TabsContent value="packers" className="mt-4">{renderTable(PACKERS, 'packer', User)}</TabsContent>
                <TabsContent value="stores" className="mt-4">{renderTable(STORES, 'store', Store)}</TabsContent>
            </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};



    