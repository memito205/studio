

"use client";

import React, { useState, useCallback, useRef, ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, UploadCloud, FileText, CheckCircle, AlertCircle, Download, Save } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { SampleReference, SampleDelivery, ComparisonResult, SavedSampleVerification } from '@/types';
import { getSampleReferenceById, getSampleDeliveriesByReferences, saveSampleVerification, loadSampleVerifications } from '@/app/actions';
import { exportToXlsx } from '@/services/export';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth-context';


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
                    <DialogTitle>Guardar Verificación</DialogTitle>
                    <DialogDescription>
                        Ingrese un nombre descriptivo para esta verificación para guardarla en el historial.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Input 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Verificación Adidas Semana 30"
                    />
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSaveClick} disabled={isLoading || !name.trim()}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

interface SampleVerificationProps {
  onVerificationSaved: () => void;
}

export const SampleVerification: React.FC<SampleVerificationProps> = ({ onVerificationSaved }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [comparisonResults, setComparisonResults] = useState<ComparisonResult[]>([]);
    const [referenceSearchQuery, setReferenceSearchQuery] = useState('');
    const merchandiseFileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
    const { user } = useAuth();


    const handleSearch = async (refsToVerify: string[]) => {
        if (refsToVerify.length === 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'No hay referencias para buscar.' });
            return;
        }
        setIsLoading(true);
        setComparisonResults([]);
        try {
            // Step 1: Fetch all data sources in parallel
            const [deliveriesResult, savedVerificationsResult, ...refExistenceResults] = await Promise.all([
                getSampleDeliveriesByReferences(refsToVerify),
                loadSampleVerifications({ maxSessions: 2500 }), // Sesiones recientes: TF virtuales en historial guardado
                ...refsToVerify.map(ref => getSampleReferenceById(ref)) // Check for photos
            ]);

            // Handle potential errors from API calls
            if (!deliveriesResult.success) {
                throw new Error(deliveriesResult.error || "No se pudo cargar el historial de entregas reales.");
            }
            if (!savedVerificationsResult.success) {
                throw new Error(savedVerificationsResult.error || "No se pudo cargar el historial de verificaciones guardadas.");
            }

            // Step 2: Build a complete delivery history map (real + virtual)
            const combinedDeliveriesMap = new Map<string, SampleDelivery[]>();

            // Add real deliveries from `sampleDeliveries` collection
            (deliveriesResult.data || []).forEach(delivery => {
                const deliveries = combinedDeliveriesMap.get(delivery.reference) || [];
                deliveries.push(delivery);
                combinedDeliveriesMap.set(delivery.reference, deliveries);
            });

            // Add virtual deliveries from saved verifications
            (savedVerificationsResult.data || []).forEach(verification => {
                verification.results.forEach(result => {
                    // Only consider references we are currently searching for
                    if (refsToVerify.includes(result.reference) && result.deliveryHistory) {
                        const existingDeliveries = combinedDeliveriesMap.get(result.reference) || [];
                        // Filter out duplicates in case a virtual and real delivery exist for the same event
                        const newDeliveries = result.deliveryHistory.filter(
                            newDelivery => !existingDeliveries.some(existing => existing.id === newDelivery.id)
                        );
                        if (newDeliveries.length > 0) {
                            combinedDeliveriesMap.set(result.reference, [...existingDeliveries, ...newDeliveries]);
                        }
                    }
                });
            });


            // Step 3: Check for photo existence from `sampleReferences` collection
            const existingRefsSet = new Set<string>();
            refExistenceResults.forEach(result => {
                if (result.success && result.data) {
                    existingRefsSet.add(result.data.id);
                }
            });

            // Step 4: Determine the final status for each reference based on all collected data
            const results: ComparisonResult[] = refsToVerify.map(ref => {
                const deliveryHistory = combinedDeliveriesMap.get(ref) || [];
                const hasPhoto = existingRefsSet.has(ref);
                let status: ComparisonResult['status'];
                
                if (hasPhoto) {
                    status = 'En Base de Datos';
                } else if (deliveryHistory.length > 0) {
                    status = 'Advertencia: Entregada pero sin Foto';
                } else {
                    status = 'Muestra Nueva Requerida';
                }

                return {
                    reference: ref,
                    status: status,
                    deliveryHistory: deliveryHistory.sort((a, b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()) // Sort history
                };
            });

            setComparisonResults(results);
            if (results.length > 0) {
                toast({ title: "Verificación completa", description: `Se analizaron ${results.length} referencias.` });
            } else {
                toast({ title: 'Sin resultados', description: 'No se encontraron datos para las referencias proporcionadas.' });
            }

        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Error al verificar', description: (error as Error).message });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSingleSearch = () => {
        if(!referenceSearchQuery.trim()){
            toast({ variant: 'destructive', title: 'Error', description: 'Ingrese una referencia.' });
            return;
        }
        handleSearch([referenceSearchQuery.trim().toUpperCase()]);
    }

    const handleMerchandiseFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setComparisonResults([]);

        try {
            const data = await file.arrayBuffer();
            const XLSX = await import('xlsx');
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (json.length === 0) throw new Error("El archivo está vacío.");

            const refsToVerify = json
                .map(row => row && row[0] ? String(row[0]).trim().toUpperCase() : null)
                .filter((ref): ref is string => ref !== null && ref !== '');
            
            if (refsToVerify.length === 0) throw new Error("No se encontraron referencias válidas en la primera columna del archivo Excel.");
            
            await handleSearch(refsToVerify);

        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al leer archivo', description: error.message });
        } finally {
            setIsLoading(false);
            if (merchandiseFileInputRef.current) {
                merchandiseFileInputRef.current.value = '';
            }
        }
    };
    
    const handleExportResults = () => {
        if (comparisonResults.length === 0) {
            toast({variant: 'destructive', title: 'Sin datos', description: 'No hay resultados para exportar.'});
            return;
        }
        const dataToExport = comparisonResults.map(res => {
            const history = res.deliveryHistory?.map(d => `TF: ${d.transferNumber} (${format(d.deliveryDate, "dd/MM/yyyy")})`).join('; ') || 'N/A';
            return {
                'Referencia': res.reference,
                'Estado': res.status,
                'Historial de Entrega': history,
            };
        });
        exportToXlsx(dataToExport, 'verificacion_muestras_y_entregas');
    };

    const handleSaveVerification = async (verificationName: string) => {
        if (!user) {
          toast({ variant: 'destructive', title: 'Error', description: 'Debe iniciar sesión para guardar.' });
          return;
        }
        if (!verificationName.trim()) {
            toast({ variant: 'destructive', title: 'Error', description: 'El nombre es obligatorio.' });
            return;
        }
        setIsSaving(true);
        
        const isAdidasVerification = verificationName.toUpperCase().startsWith('AD') || verificationName.toUpperCase().includes('ADIDAS');
        const verificationDate = new Date();

        const newSampleReferencesAtRun = comparisonResults
            .filter((res) => res.status === 'Muestra Nueva Requerida')
            .map((res) => res.reference.trim().toUpperCase());

        const finalResultsToSave = comparisonResults.map(res => {
            if (isAdidasVerification && res.status === 'Muestra Nueva Requerida') {
                const virtualDelivery: SampleDelivery = {
                    id: `manual-${res.reference}-${verificationDate.getTime()}`,
                    reference: res.reference,
                    transferNumber: verificationName,
                    deliveryDate: verificationDate,
                    sourceWarehouse: 'VERIFICACIÓN MANUAL',
                    destinationWarehouse: 'FOTOGRAFIA',
                };
                return {
                    ...res,
                    status: 'Advertencia: Entregada pero sin Foto' as const,
                    deliveryHistory: [virtualDelivery],
                };
            }

            if (isAdidasVerification && res.status === 'Advertencia: Entregada pero sin Foto') {
                const existingHistory = res.deliveryHistory || [];
                const manualVerificationExists = existingHistory.some(d => d.transferNumber === verificationName);
                if (!manualVerificationExists) {
                    const virtualDelivery: SampleDelivery = {
                        id: `manual-${res.reference}-${verificationDate.getTime()}`,
                        reference: res.reference,
                        transferNumber: verificationName,
                        deliveryDate: verificationDate,
                        sourceWarehouse: 'VERIFICACIÓN MANUAL',
                        destinationWarehouse: 'FOTOGRAFIA',
                    };
                    return {
                        ...res,
                        deliveryHistory: [...existingHistory, virtualDelivery],
                    };
                }
            }
            
            return res;
        });

        const sessionData: Omit<SavedSampleVerification, 'id'> = {
            name: verificationName,
            createdAt: verificationDate,
            savedById: user.uid,
            savedBy: user.displayName || user.email || 'N/A',
            results: finalResultsToSave,
            newSampleReferencesAtRun,
            stats: {
                total: finalResultsToSave.length,
                scanned: finalResultsToSave.filter(r => r.status === 'En Base de Datos').length,
                pending: finalResultsToSave.filter(r => r.status !== 'En Base de Datos').length,
            },
            status: 'completed',
        };

        const result = await saveSampleVerification(sessionData);

        if (result.success) {
            toast({ title: 'Éxito', description: 'Verificación guardada correctamente.' });
            onVerificationSaved();
            setIsSaveDialogOpen(false);
        } else {
            toast({ variant: 'destructive', title: 'Error al guardar', description: result.error });
        }
        setIsSaving(false);
    };
    
    const getStatusBadge = (status: ComparisonResult['status']) => {
        switch (status) {
            case 'En Base de Datos':
                return <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" />En Base de Datos</Badge>;
            case 'Advertencia: Entregada pero sin Foto':
                return <Badge variant="warning"><AlertCircle className="mr-1 h-3 w-3" />Entregada sin Foto</Badge>;
            case 'Muestra Nueva Requerida':
            default:
                return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Muestra Nueva Requerida</Badge>;
        }
    };


    return (
      <>
        <SaveVerificationDialog 
            isOpen={isSaveDialogOpen}
            onOpenChange={setIsSaveDialogOpen}
            onSave={handleSaveVerification}
            isLoading={isSaving}
        />
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Verificación de Muestras</CardTitle>
                    <CardDescription>Consulte el estado de una o varias referencias para saber si ya tienen foto o han sido entregadas.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex w-full max-w-sm items-center space-x-2">
                        <Input
                            type="text"
                            placeholder="Ingrese la referencia..."
                            value={referenceSearchQuery}
                            onChange={(e) => setReferenceSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSingleSearch()}
                            disabled={isLoading}
                        />
                        <Button onClick={handleSingleSearch} disabled={isLoading || !referenceSearchQuery.trim()}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Search className="mr-2 h-4 w-4" />
                            Buscar
                        </Button>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">O</span></div>
                    </div>
                    
                    <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                        <UploadCloud className="w-10 h-10 text-muted-foreground" />
                        <input ref={merchandiseFileInputRef} type="file" className="hidden" onChange={handleMerchandiseFileChange} accept=".xlsx, .xls" id="verify-list-upload" />
                        <label htmlFor="verify-list-upload" className="mt-3">
                           <Button asChild><span>{isLoading ? 'Procesando...' : 'Cargar Lista desde Excel'}</span></Button>
                        </label>
                        <p className="text-xs text-muted-foreground mt-2">La herramienta leerá la primera columna del archivo Excel.</p>
                    </div>
                </CardContent>
            </Card>

            {comparisonResults.length > 0 && (
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <CardTitle>Resultado de Verificación</CardTitle>
                             <div className="flex gap-2">
                                <Button onClick={() => setIsSaveDialogOpen(true)} variant="default" size="sm" disabled={isSaving}>
                                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Guardar Verificación
                                </Button>
                                <Button onClick={handleExportResults} variant="outline" size="sm">
                                    <Download className="mr-2 h-4 w-4" /> Exportar Resultados
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-[60vh] border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Referencia</TableHead>
                                        <TableHead className="text-center">Estado</TableHead>
                                        <TableHead>Historial de Entrega</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {comparisonResults.map(res => (
                                        <TableRow key={res.reference}>
                                            <TableCell className="font-mono">{res.reference}</TableCell>
                                            <TableCell className="text-center">
                                                {getStatusBadge(res.status)}
                                            </TableCell>
                                            <TableCell>
                                                {res.deliveryHistory && res.deliveryHistory.length > 0 ? (
                                                    <ul className="list-disc list-inside space-y-1">
                                                        {res.deliveryHistory.map(d => (
                                                            <li key={d.id} className="text-xs text-muted-foreground">
                                                                TF: <span className="font-semibold text-foreground">{d.transferNumber}</span> el {d.deliveryDate ? format(new Date(d.deliveryDate), "dd/MM/yyyy") : 'Fecha Inválida'}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">N/A</span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </CardContent>
                </Card>
            )}
        </div>
      </>
    );
}
