

"use client";

import React, { useState, useMemo, ChangeEvent, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UploadCloud, Truck, FileSignature, Search, Download, Trash2, Plus, File, Package, X, Check, Save, History, Eye, Printer, PackageCheck, Loader2, ScanLine, CircleDot, FileDown, MoreHorizontal, ChevronsUpDown, Database, RefreshCw, ListOrdered } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TransferEntry, TransferStatus, DeliveryManifest, UserRole, CollectionLog, AppUser, RouteEntry } from '@/types';
import { saveTransfers, loadAllTransfers, deleteTransfer, updateTransferStatus, createDeliveryManifest, getDeliveryManifests, getTransfersByIds, createManualTransfer, createCollectionLog, getCollectionLogs, migrateLegacyTransferStatus, batchUpdateTransferStatus, getTransfersByStatus, getTransfersByQuery, getTransfersByDateRange, syncAnalysisRecords, loadAnalysisRecords, healInconsistentTransfers, getNextStorageOrders, healTransferStorageOrders } from '@/app/actions';
import { getAllUserProfiles } from '@/app/reception/actions';
import { parseFlexibleDate } from '@/lib/parsingUtils';
import { Badge } from './ui/badge';
import { useAuth } from '@/hooks/use-auth-context';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { exportToXlsx } from '@/services/export';
import { Checkbox } from './ui/checkbox';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Label } from './ui/label';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import JsBarcode from 'jsbarcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { cn } from '@/lib/utils';
import { CollectionLogDetailsDialog } from './CollectionLogDetailsDialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TransferLogDialog } from './TransferLogDialog';

interface GroupedTransfer extends TransferEntry {
    allIds: string[];
}

const groupTransfersByTF = (transfers: TransferEntry[], placaMap?: Map<string, string>): GroupedTransfer[] => {
    const groups = new Map<string, GroupedTransfer>();
    
    // Status priority for determining group status
    const statusPriority: Record<TransferStatus, number> = {
        'En Tránsito': 1,
        'Recolectado en Ruta': 2,
        'Entregado en Ruta': 3,
        'Validado Supervisor': 4,
        'Recibido en Bodega': 5,
        'Enviado a Destino': 6
    };

    transfers.forEach(t => {
        const placa = placaMap ? (placaMap.get(t.id) || '') : '';
        // Removed status from key to truly unify the TF
        const key = `${t.numeroTF}-${t.bodegaOrigen}-${t.bodegaDestino}-${placa}`;
        const existing = groups.get(key);
        
        if (existing) {
            existing.allIds.push(t.id);
            existing.cantidad = Number(existing.cantidad || 0) + Number(t.cantidad || 0);
            
            // Update to most advanced status
            if (statusPriority[t.status] > statusPriority[existing.status]) {
                existing.status = t.status;
            }

            // Handle multiple brands/groups
            if (t.marca && t.marca !== existing.marca) {
                const existingBrands = existing.marca ? existing.marca.split(', ') : [];
                if (!existingBrands.includes(t.marca)) {
                    existing.marca = existing.marca && existing.marca !== 'N/A' ? `${existing.marca}, ${t.marca}` : t.marca;
                }
            }
            if (t.grupo && t.grupo !== existing.grupo) {
                const existingGroups = existing.grupo ? existing.grupo.split(', ') : [];
                if (!existingGroups.includes(t.grupo)) {
                    existing.grupo = existing.grupo && existing.grupo !== 'N/A' ? `${existing.grupo}, ${t.grupo}` : t.grupo;
                }
            }
        } else {
            groups.set(key, {
                ...t,
                allIds: [t.id],
                cantidad: Number(t.cantidad || 0)
            });
        }
    });
    
    return Array.from(groups.values());
};


const getStatusBadge = (status: TransferStatus) => {
    switch (status) {
        case 'Recibido en Bodega': return <Badge variant="success">Recibido en Bodega</Badge>;
        case 'Enviado a Destino': return <Badge variant="default">Enviado a Destino</Badge>;
        case 'Recolectado en Ruta': return <Badge variant="warning">Recolectado en Ruta</Badge>;
        case 'Entregado en Ruta': return <Badge className="bg-blue-500 text-white">Entregado en Ruta</Badge>;
        case 'Validado Supervisor': return <Badge className="bg-purple-500 text-white">Validado Supervisor</Badge>;
        case 'En Tránsito':
        default:
            return <Badge variant="secondary">En Tránsito</Badge>;
    }
};

const FAILURE_REASONS = ["No lo tienen listo", "Ya se envio", "TF que no se va enviar"];

const DESTINOS_PREDEFINIDOS = [
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10",
    "B11", "B12", "B13", "B14", "B15", "B16", "B17", "B18", "B19", "B20",
    "B21", "B22", "B23", "MOLINOS", "BODEGA PIONEROS", "OFICINA"
].sort();

const TransferLabel: React.FC<{ transfer: TransferEntry }> = ({ transfer }) => {
  const barcodeRef = React.useRef<HTMLCanvasElement>(null);
  const barcodeValue = `${transfer.bodegaDestino}-${transfer.numeroTF}`.toUpperCase();

  React.useEffect(() => {
    if (barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, barcodeValue, {
          format: "CODE128",
          displayValue: false, // The value is displayed separately
          margin: 0,
          height: 30,
          width: 1.5,
        });
      } catch (e) {
        console.error('Error generating barcode', e);
      }
    }
  }, [barcodeValue]);

  return (
    <div id={`transfer-label-to-print-${transfer.id}`} className="p-3 border border-gray-300 rounded-lg bg-white text-black flex flex-col" style={{ width: '10cm', height: '5cm' }}>
      
      {/* Header */}
      <div className="flex justify-between items-start text-xs font-sans border-b pb-1 mb-1">
        <p className="font-bold">TRANSFERENCIA INTERNA</p>
        <p>Fecha: <span className="font-semibold">{transfer.fecha.toLocaleDateString('es-CO')}</span></p>
      </div>

      {/* Main content area */}
      <div className="flex-grow flex flex-col items-center justify-center pt-1">
        {/* Destino / Unidades */}
        <div className="flex justify-around w-full items-center">
            <div>
                <p className="font-sans text-lg font-semibold">Destino:</p>
                <p className="font-sans text-2xl font-bold">{transfer.bodegaDestino}</p>
            </div>
            <div>
                <p className="font-sans text-lg font-semibold">Unidades:</p>
                <p className="font-sans text-2xl font-bold">{transfer.cantidad || 1}</p>
            </div>
        </div>
        
        {/* Large TF number */}
        <div className="text-center font-sans text-3xl font-bold tracking-wider my-2">
          {transfer.numeroTF}
        </div>
        
        {/* Barcode and its text */}
        <div className="flex flex-col items-center mt-1">
          <canvas ref={barcodeRef} />
           <div className="font-sans text-xs tracking-widest mt-1">{barcodeValue}</div>
        </div>
      </div>
      
      {/* Footer */}
       <div className="mt-auto border-t pt-1 flex justify-between items-end">
        <div>
          <p className="text-xs font-semibold">Recibido por:</p>
          <div className="h-4 w-48 border-b border-black"></div>
        </div>
        {transfer.storageOrder && (
          <div className="flex flex-col items-center border-2 border-black rounded px-2 py-1 bg-black text-white">
            <span className="text-[10px] font-bold leading-none">ORDEN</span>
            <span className="text-xl font-black leading-none">{transfer.storageOrder}</span>
          </div>
        )}
       </div>
    </div>
  );
};


const TransferLabelDialog: React.FC<{
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  transfer: TransferEntry | null;
  onConfirm: (transfer: TransferEntry) => Promise<void>;
  isSaving: boolean;
}> = ({ isOpen, onOpenChange, transfer, onConfirm, isSaving }) => {
  const { toast } = useToast();
  
  const handleConfirmAndPrint = async () => {
    if (!transfer) return;
    await onConfirm(transfer);
  };
  
  if (!transfer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rótulo para Transferencia</DialogTitle>
          <DialogDescription>
            Rótulo para el TF: {transfer.numeroTF} con destino a {transfer.bodegaDestino}. Al imprimir se marcará como recibido.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 flex justify-center">
          <TransferLabel transfer={transfer} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button onClick={handleConfirmAndPrint} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Printer className="mr-2 h-4 w-4"/>}
            Imprimir y Marcar como Recibido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


const StatusChangeDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    transfer: TransferEntry | null;
    onConfirm: (newStatus: TransferStatus, justification: string) => void;
    isSaving: boolean;
}> = ({ isOpen, onOpenChange, transfer, onConfirm, isSaving }) => {
    const [newStatus, setNewStatus] = useState<TransferStatus | ''>('');
    const [justification, setJustification] = useState('');

    useEffect(() => {
        if (isOpen && transfer) {
            setNewStatus(transfer.status);
            setJustification('');
        }
    }, [isOpen, transfer]);

    const handleConfirm = () => {
        if (newStatus && justification) {
            onConfirm(newStatus, justification);
        }
    };

    if (!transfer) return null;

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Cambiar Estado de Transferencia</AlertDialogTitle>
                    <AlertDialogDescription>
                        TF: <span className="font-mono font-bold">{transfer.numeroTF}</span> | Destino: {transfer.bodegaDestino}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="new-status">Nuevo Estado</Label>
                        <Select value={newStatus} onValueChange={(val) => setNewStatus(val as TransferStatus)}>
                            <SelectTrigger id="new-status"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="En Tránsito">En Tránsito</SelectItem>
                                <SelectItem value="Recolectado en Ruta">Recolectado en Ruta</SelectItem>
                                <SelectItem value="Entregado en Ruta">Entregado en Ruta</SelectItem>
                                <SelectItem value="Validado Supervisor">Validado Supervisor</SelectItem>
                                <SelectItem value="Recibido en Bodega">Recibido en Bodega</SelectItem>
                                <SelectItem value="Enviado a Destino">Enviado a Destino</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="justification">Justificación del Cambio (Obligatoria)</Label>
                        <Input id="justification" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Motivo del cambio manual..." />
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm} disabled={isSaving || !newStatus || !justification}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Confirmar Cambio
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const FailureDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (reason: string) => void;
}> = ({ isOpen, onOpenChange, onConfirm }) => {
    const [reason, setReason] = useState("");
    const [otherReason, setOtherReason] = useState("");

    const handleConfirm = () => {
        const finalReason = reason === 'Otro' ? otherReason : reason;
        if (finalReason) {
            onConfirm(finalReason);
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Registrar Fallo</AlertDialogTitle>
                    <AlertDialogDescription>Seleccione o ingrese el motivo del fallo.</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-4">
                    <Select value={reason} onValueChange={(value) => setReason(value)}>
                        <SelectTrigger><SelectValue placeholder="Seleccione un motivo..." /></SelectTrigger>
                        <SelectContent>
                            {FAILURE_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            <SelectItem value="Otro">Otro</SelectItem>
                        </SelectContent>
                    </Select>
                    {reason === 'Otro' && (
                        <Input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Especifique el motivo..." />
                    )}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm} disabled={!reason || (reason === 'Otro' && !otherReason)}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const AddManualEntryDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (numeroTF: string, almacenDestino: string) => void;
    route: RouteEntry[];
}> = ({ isOpen, onOpenChange, onConfirm, route }) => {
    const [numeroTF, setNumeroTF] = useState("");
    const [almacenDestino, setAlmacenDestino] = useState("");
    
    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Agregar Entrada Manual</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="tf-manual">Número TF</Label>
                        <Input id="tf-manual" value={numeroTF} onChange={(e) => setNumeroTF(e.target.value)} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="destino-manual">Almacén Destino</Label>
                         <Select value={almacenDestino} onValueChange={setAlmacenDestino}>
                            <SelectTrigger><SelectValue placeholder="Seleccionar destino..." /></SelectTrigger>
                            <SelectContent>
                                {DESTINOS_PREDEFINIDOS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                <SelectItem value="OTRO">OTRO (Especificar)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onConfirm(numeroTF, almacenDestino)} disabled={!numeroTF || !almacenDestino}>Agregar</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

const FinalizeDestinationDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (personName: string) => void;
}> = ({ isOpen, onOpenChange, onConfirm }) => {
    const [personName, setPersonName] = useState("");

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Finalizar Destino</AlertDialogTitle>
                    <AlertDialogDescription>Ingrese el nombre de la persona que recibió o entregó la mercancía.</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4">
                    <Input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Nombre completo..." />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onConfirm(personName)} disabled={!personName}>Confirmar Finalización</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

const ManifestDetailsDialog: React.FC<{
  manifest: DeliveryManifest | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ manifest, isOpen, onOpenChange }) => {
  const [transfers, setTransfers] = useState<TransferEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (manifest && isOpen) {
      const fetchDetails = async () => {
        setIsLoading(true);
        const result = await getTransfersByIds(manifest.transferIds);
        if (result.success && result.data) {
          setTransfers(result.data);
        } else {
          console.error("Failed to fetch transfer details:", result.error);
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los detalles del manifiesto.' });
        }
        setIsLoading(false);
      }
      fetchDetails();
    }
  }, [manifest, isOpen, toast]);
  
  const groupedByDestination = useMemo(() => {
    if (!transfers) return {};
    const grouped = transfers.reduce((acc, transfer) => {
        const dest = transfer.bodegaDestino.trim().toUpperCase();
        if (!acc[dest]) {
            acc[dest] = [];
        }
        acc[dest].push(transfer);
        return acc;
    }, {} as Record<string, TransferEntry[]>);

    // Apply TF grouping to each destination group
    const finalGrouped: Record<string, GroupedTransfer[]> = {};
    Object.entries(grouped).forEach(([dest, list]) => {
        finalGrouped[dest] = groupTransfersByTF(list);
    });
    return finalGrouped;
  }, [transfers]);

  const handlePrint = async () => {
      if (!manifest) {
        toast({ variant: 'destructive', title: 'Error', description: 'No hay datos de manifiesto.' });
        return;
      }
      
      setIsPrinting(true);
  
      try {
          const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
          const PADDING = 40;
          let y = PADDING;
          const pageHeight = doc.internal.pageSize.getHeight();
  
          // Overall Header
          doc.setFontSize(16);
          doc.text("RELACIÓN DE ENTREGA", doc.internal.pageSize.getWidth() / 2, y, { align: 'center' });
          y += 20;
          doc.setFontSize(12);
          doc.text(`MANIFIESTO #${manifest.manifestId}`, doc.internal.pageSize.getWidth() / 2, y, { align: 'center' });
          y += 25;
          
          doc.setFontSize(10);
          const headerInfo = [
              [`Fecha: ${manifest.createdAt ? format(new Date(manifest.createdAt), "PPP", { locale: es }) : 'N/A'}`, `Recurso/Placa: ${manifest.resource}`],
              [`Conductor: ${manifest.driver || 'N/A'}`, `Auxiliares: ${manifest.assistants || 'N/A'}`],
          ];
          autoTable(doc, {
              body: headerInfo,
              startY: y,
              theme: 'plain',
              styles: { fontSize: 10, cellPadding: 2 },
          });
          y = (doc as any).lastAutoTable.finalY + 20;
  
          // Iterate over destinations
          for (const [destination, transferList] of Object.entries(groupedByDestination)) {
              const tableBody = transferList.map(t => [
                  '', // Checkbox placeholder
                  t.numeroTF,
                  t.bodegaOrigen,
              ]);
  
              const blockHeaderHeight = 30;
              const tableHeaderHeight = 25;
              const oneRowHeight = 20;
              const signatureHeight = 60; // Increased space for signatures
              const requiredHeight = blockHeaderHeight + tableHeaderHeight + (oneRowHeight * tableBody.length) + signatureHeight;

              if (y + requiredHeight > pageHeight - PADDING) {
                  doc.addPage();
                  y = PADDING;
              }
  
              doc.setFontSize(12);
              doc.setFont('helvetica', 'bold');
              doc.text(`Destino: ${destination} (${transferList.length} TFs)`, PADDING, y);
              y += 20;
  
              autoTable(doc, {
                  startY: y,
                  head: [['Recibido', '# TF', 'Origen']],
                  body: tableBody,
                  theme: 'grid',
                  headStyles: { fillColor: [22, 22, 22], textColor: 255, fontSize: 9 },
                  styles: { fontSize: 9, cellPadding: 4 },
                  columnStyles: {
                      0: { cellWidth: 60, halign: 'center' }
                  },
                  didDrawCell: (data: any) => {
                      if (data.column.index === 0 && data.section === 'body') {
                          const checkboxSize = 10;
                          const cell = data.cell;
                          doc.setDrawColor(0);
                          doc.rect(cell.x + (cell.width / 2) - (checkboxSize / 2), cell.y + (cell.height / 2) - (checkboxSize / 2), checkboxSize, checkboxSize);
                      }
                  }
              });
  
              y = (doc as any).lastAutoTable.finalY + 30; // Increased space after table

              const signatureY = y; 
  
              if (signatureY + 40 > pageHeight - PADDING) {
                  doc.addPage();
                  y = PADDING;
              }

              doc.line(PADDING, y + 20, PADDING + 150, y + 20);
              doc.text("Firma y C.C. Quien Entrega", PADDING, y + 30);
              doc.text(`(${manifest.driver || '____________________'})`, PADDING, y + 40);
  
              const rightSignatureX = doc.internal.pageSize.getWidth() - PADDING - 150;
              doc.line(rightSignatureX, y + 20, rightSignatureX + 150, y + 20);
              doc.text("Firma y C.C. Quien Recibe en Destino", rightSignatureX, y + 30);
              
              y += 60; // Increased space for next section
          }
  
          doc.autoPrint();
          window.open(doc.output('bloburl'), '_blank');
          
      } catch (err) {
          console.error("Error al generar PDF:", err);
          toast({
              variant: "destructive",
              title: "Error al Generar PDF",
              description: "Ocurrió un problema al crear el documento.",
          });
      } finally {
          setIsPrinting(false);
      }
    };


  const handleExport = () => {
    if (!transfers || transfers.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Sin Datos',
        description: 'No hay transferencias en este manifiesto para exportar.',
      });
      return;
    }
    const groupedTransfers = groupTransfersByTF(transfers);
    const dataToExport = groupedTransfers.map(t => ({
      'Numero TF': t.numeroTF,
      'Origen': t.bodegaOrigen,
      'Destino': t.bodegaDestino,
      'Marcas': t.marca,
      'Grupos': t.grupo,
      'Cantidad Total': t.cantidad
    }));
    exportToXlsx(dataToExport, `Manifiesto_${manifest?.manifestId || 'desconocido'}`);
  };

  if (!manifest) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader className="print-hide">
          <DialogTitle>Relación de Entrega #{manifest.manifestId}</DialogTitle>
          <DialogDescription>
             Creada el {manifest.createdAt ? format(new Date(manifest.createdAt), "PPP p", { locale: es }) : 'N/A'}. Recurso: {manifest.resource}.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-grow">
          <div id="manifest-to-print" className="p-4 bg-white text-black">
            {isLoading ? (
                <div className="flex justify-center items-center h-full">
                    <Loader2 className="animate-spin text-2xl"/>
                </div>
            ) : (
                <>
                    {/* Content for PDF is now generated directly, this is a visual preview */}
                    <div className="text-center mb-8">
                      <h1 className="text-2xl font-bold text-black">VISTA PREVIA - RELACIÓN DE ENTREGA #{manifest.manifestId}</h1>
                    </div>
                    {Object.entries(groupedByDestination).map(([destination, transferList]) => (
                        <div key={destination} className="mb-8">
                          <h3 className="text-xl font-bold mb-2 p-2 bg-gray-100 rounded-md">Destino: {destination} ({transferList.length} TFs)</h3>
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead># TF</TableHead>
                                  <TableHead>Origen</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transferList.map(t => (
                                  <TableRow key={t.id}>
                                    <TableCell>{t.numeroTF}</TableCell>
                                    <TableCell>{t.bodegaOrigen}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                    ))}
                </>
              )}
            </div>
        </ScrollArea>

        <DialogFooter className="mt-4 flex-shrink-0 print-hide">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={handleExport} disabled={isLoading}>
            <FileDown className="mr-2 h-4 w-4" /> Exportar Excel
          </Button>
          <Button onClick={handlePrint} disabled={isPrinting || isLoading}>
              {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Printer className="mr-2 h-4 w-4"/>}
              Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
const WarehouseReceptionView: React.FC<{
  collectionLogs: CollectionLog[];
  onRefresh: () => void;
}> = ({ collectionLogs, onRefresh }) => {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [searchPlate, setSearchPlate] = useState('');
    const [foundTransfers, setFoundTransfers] = useState<TransferEntry[]>([]);
    const [selectedTransfers, setSelectedTransfers] = useState(new Set<string>());
    const [transfersToPrint, setTransfersToPrint] = useState<TransferEntry[]>([]);
    const [isPrinting, setIsPrinting] = useState(false);
    
    // This state is for the individual label dialog
    const [isLabelDialogOpen, setIsLabelDialogOpen] = useState(false);
    const [transferForLabel, setTransferForLabel] = useState<TransferEntry | null>(null);


    const handleSearchByPlate = async () => {
        setIsLoading(true);
        const plate = searchPlate.trim().toUpperCase();
        if (!plate) {
            toast({ variant: 'destructive', title: 'Error', description: 'Por favor ingrese una placa.' });
            setIsLoading(false);
            return;
        }

        const relevantLogs = collectionLogs.filter(log => log.placa === plate);
        const transferIdsFromLogs = new Set(relevantLogs.flatMap(log => log.transferIds));

        if (transferIdsFromLogs.size === 0) {
            toast({ title: 'Sin Resultados', description: `No se encontraron registros de recolección para la placa ${plate}.` });
            setFoundTransfers([]);
            setIsLoading(false);
            return;
        }

        // Fetch the actual transfers from Firebase to ensure we have the latest status
        const transfersResult = await getTransfersByStatus('Validado Supervisor');
        if (transfersResult.data) {
            const transfersForPlate = transfersResult.data.filter(t => transferIdsFromLogs.has(t.id));
            setFoundTransfers(transfersForPlate);
            if (transfersForPlate.length === 0) {
                toast({ title: 'Sin Resultados', description: `No se encontraron TFs validadas por supervisor para la placa ${plate}.` });
            }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las transferencias validadas.' });
        }

        setSelectedTransfers(new Set()); // Reset selection
        setIsLoading(false);
    };
    
    const handleSelectTransfer = (id: string, checked: boolean) => {
        setSelectedTransfers(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(id); else newSet.delete(id);
            return newSet;
        });
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedTransfers(new Set(foundTransfers.map(t => t.id)));
        } else {
            setSelectedTransfers(new Set());
        }
    };
    
    const handleConfirmAndPrint = useCallback(async (transfer: GroupedTransfer | TransferEntry) => {
        if (!transfer) return;
        
        try {
            const ids = 'allIds' in transfer ? (transfer as any).allIds : [transfer.id];
            const result = await updateTransferStatus(ids, 'Recibido en Bodega');
            if (result.success) {
                toast({ title: 'Estado Actualizado', description: `La transferencia ha sido marcada como 'Recibido en Bodega'.` });
                onRefresh();
            } else {
                throw new Error(result.error);
            }
        } catch(error: any) {
             toast({ variant: 'destructive', title: 'Error', description: error.message });
        }
    }, [onRefresh, toast]);


    const handleBulkReceive = async (andPrint: boolean) => {
        if (selectedTransfers.size === 0) {
            toast({ variant: 'destructive', title: 'Sin selección', description: 'Debe seleccionar al menos una transferencia.' });
            return;
        }
        setIsLoading(true);
        const transferIdsToUpdate = Array.from(selectedTransfers);
        const result = await batchUpdateTransferStatus(transferIdsToUpdate, 'Recibido en Bodega');
        if (result.success) {
            toast({ title: 'Éxito', description: `${transferIdsToUpdate.length} transferencias marcadas como 'Recibido en Bodega'.` });
            
            if (andPrint) {
                const transfersToUpdate = foundTransfers.filter(t => transferIdsToUpdate.includes(t.id));
                setTransfersToPrint(transfersToUpdate);
            }
            
            onRefresh();
            setSelectedTransfers(new Set());
            setFoundTransfers(prev => prev.filter(t => !transferIdsToUpdate.includes(t.id))); // Optimistically update UI
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsLoading(false);
    };

    useEffect(() => {
        const generateBulkPdf = async () => {
            if (transfersToPrint.length === 0 || isPrinting) return;
        
            setIsPrinting(true);
            toast({ title: 'Generando PDF...', description: `Preparando ${transfersToPrint.length} rótulos para imprimir.` });
        
            try {
                const doc = new jsPDF({
                    orientation: 'landscape',
                    unit: 'cm',
                    format: [10, 5] // Matching the label size
                });
        
                for (let i = 0; i < transfersToPrint.length; i++) {
                    const transfer = transfersToPrint[i];
                    const input = document.getElementById(`transfer-label-to-print-${transfer.id}`);
                    if (!input) {
                        console.error(`Element for transfer ${transfer.id} not found!`);
                        continue;
                    }
            
                    if (i > 0) {
                        doc.addPage();
                    }
            
                    const canvas = await html2canvas(input, {
                        scale: 3, // Higher scale for better quality
                        useCORS: true,
                        backgroundColor: '#ffffff',
                    });
            
                    const imgData = canvas.toDataURL('image/png');
                    doc.addImage(imgData, 'PNG', 0, 0, 10, 5);
                }
        
                doc.autoPrint();
                window.open(doc.output('bloburl'), '_blank');
            } catch (error) {
                console.error("Error generating PDF:", error);
                toast({
                    variant: 'destructive',
                    title: 'Error de Impresión',
                    description: 'No se pudo generar el PDF de los rótulos.',
                });
            } finally {
                setIsPrinting(false);
                setTransfersToPrint([]);
            }
        };
    
        generateBulkPdf();
      }, [transfersToPrint, isPrinting, toast]);
      
    const handlePrintLabelClick = (transfer: TransferEntry) => {
        setTransferForLabel(transfer);
        setIsLabelDialogOpen(true);
    };


    return (
        <>
             <TransferLabelDialog
                isOpen={isLabelDialogOpen}
                onOpenChange={setIsLabelDialogOpen}
                transfer={transferForLabel}
                onConfirm={handleConfirmAndPrint}
                isSaving={isPrinting}
            />
            <Card>
                <CardHeader>
                    <CardTitle>Recepción de Transferencias en Bodega</CardTitle>
                    <CardDescription>Busque por placa para ver las TFs validadas y listas para recibir en bodega.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex w-full items-center justify-between space-x-2 flex-wrap gap-4">
                        <div className="flex items-center space-x-2">
                            <Input
                                placeholder="Buscar por placa..."
                                value={searchPlate}
                                onChange={e => setSearchPlate(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearchByPlate()}
                                disabled={isLoading}
                                className="max-w-xs"
                            />
                            <Button onClick={handleSearchByPlate} disabled={isLoading || !searchPlate.trim()}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>}
                                Buscar
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={() => handleBulkReceive(false)} disabled={isLoading || selectedTransfers.size === 0}>
                                <Check className="mr-2 h-4 w-4" />
                                Recibir Seleccionados ({selectedTransfers.size})
                            </Button>
                            <Button onClick={() => handleBulkReceive(true)} disabled={isLoading || selectedTransfers.size === 0}>
                                <Printer className="mr-2 h-4 w-4"/>
                                Imprimir y Recibir ({selectedTransfers.size})
                            </Button>
                        </div>
                    </div>
                    
                    <div className="border rounded-md max-h-[60vh] overflow-auto">
                        <Table className="min-w-[1000px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">
                                        <Checkbox
                                            checked={foundTransfers.length > 0 && selectedTransfers.size === foundTransfers.length}
                                            onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                            disabled={foundTransfers.length === 0}
                                        />
                                    </TableHead>
                                    <TableHead className="w-[80px]">Ord.</TableHead>
                                    <TableHead># TF</TableHead>
                                    <TableHead>Origen</TableHead>
                                    <TableHead>Destino</TableHead>
                                    <TableHead>Estado Actual</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin"/></TableCell></TableRow>
                                ) : foundTransfers.length > 0 ? groupTransfersByTF(foundTransfers).map(t => (
                                    <TableRow key={t.id} data-state={selectedTransfers.has(t.id) ? "selected" : ""}>
                                        <TableCell>
                                            <Checkbox 
                                                checked={t.allIds.every(id => selectedTransfers.has(id))} 
                                                onCheckedChange={(checked) => {
                                                    t.allIds.forEach(id => handleSelectTransfer(id, !!checked));
                                                }} 
                                            />
                                        </TableCell>
                                        <TableCell className="font-bold text-blue-600 font-mono text-sm">{t.storageOrder || '---'}</TableCell>
                                        <TableCell className="font-medium">{t.numeroTF}</TableCell>
                                        <TableCell>{t.bodegaOrigen}</TableCell>
                                        <TableCell>{t.bodegaDestino}</TableCell>
                                        <TableCell>{getStatusBadge(t.status)}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Ingrese una placa y presione buscar para ver los resultados.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
            <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
                {transfersToPrint.map(transfer => (
                    <TransferLabel key={transfer.id} transfer={transfer} />
                ))}
            </div>
        </>
    );
};
interface AdminViewProps {
    transfers: TransferEntry[];
    operationalTransfers: TransferEntry[];
    collectionLogs: CollectionLog[];
    isLoading: boolean;
    filters: { numeroTF: string, bodegaOrigen: string, bodegaDestino: string, placa: string, status: string, startDate?: string, endDate?: string };
    setFilters: React.Dispatch<React.SetStateAction<{ numeroTF: string, bodegaOrigen: string, bodegaDestino: string, placa: string, status: string, startDate?: string, endDate?: string }>>;
    onRefresh: () => void;
    onSearch: () => void;
    role: UserRole;
    users: AppUser[];
    isUploading: boolean;
    onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
    fileInputRef: React.RefObject<HTMLInputElement>;
    setIsManualEntryOpen: (open: boolean) => void;
}

const AdminView: React.FC<AdminViewProps> = ({ transfers, operationalTransfers, collectionLogs, isLoading, filters, setFilters, onRefresh, onSearch, role, users, isUploading, onFileChange, fileInputRef, setIsManualEntryOpen }) => {
    const { toast } = useToast();
    const isAdmin = role === 'admin' || role === 'supervisor';
    const [manifests, setManifests] = useState<DeliveryManifest[]>([]);
    const [isLoadingManifests, setIsLoadingManifests] = useState(false);
    const [selectedForManifest, setSelectedForManifest] = useState(new Set<string>());
    const [isCreateManifestOpen, setIsCreateManifestOpen] = useState(false);
    const [manifestDetails, setManifestDetails] = useState<{ resource: string, driver: string, assistants: string }>({ resource: '', driver: '', assistants: '' });
    const [isSavingManifest, setIsSavingManifest] = useState(false);
    const [selectedManifest, setSelectedManifest] = useState<DeliveryManifest | null>(null);
    const [isManifestDetailsOpen, setIsManifestDetailsOpen] = useState(false);
    const [selectedCollectionLog, setSelectedCollectionLog] = useState<CollectionLog | null>(null);
    const [isMigrating, setIsMigrating] = useState(false);
    const [isHealing, setIsHealing] = useState(false);
    
    // State for manifest creation tab
    const [manifestFilters, setManifestFilters] = useState({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '' });
    const [scanInput, setScanInput] = useState('');
    
    const [statusChangeState, setStatusChangeState] = useState<{ isOpen: boolean; transfer: TransferEntry | null }>({ isOpen: false, transfer: null });
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    const [isLabelDialogOpen, setIsLabelDialogOpen] = useState(false);
    const [transferForLabel, setTransferForLabel] = useState<TransferEntry | null>(null);
    const [isPrinting, setIsPrinting] = useState(false);

    const [isLogOpen, setIsLogOpen] = useState(false);
    const [selectedTransferForLog, setSelectedTransferForLog] = useState<TransferEntry | null>(null);

    const handleViewLog = (transfer: TransferEntry) => {
        setSelectedTransferForLog(transfer);
        setIsLogOpen(true);
    };

    const handleConfirmPrintAndReceive = useCallback(async (transfer: GroupedTransfer | TransferEntry) => {
        if (!transfer) return;
        setIsPrinting(true);
        try {
            const ids = 'allIds' in transfer ? transfer.allIds : [transfer.id];
            const result = await updateTransferStatus(ids, 'Recibido en Bodega');
            if (result.success) {
                toast({ title: 'Estado Actualizado', description: `La transferencia ha sido marcada como 'Recibido en Bodega'.` });
                onRefresh();
                
                const input = document.getElementById(`transfer-label-to-print-${transfer.id}`);
                if (!input) {
                    throw new Error('Elemento del rótulo no encontrado.');
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
                const canvas = await html2canvas(input, { scale: 3, useCORS: true, backgroundColor: '#ffffff' });
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF({ orientation: 'landscape', unit: 'cm', format: [10, 5] });
                pdf.addImage(imgData, 'PNG', 0, 0, 10, 5);
                pdf.autoPrint();
                window.open(pdf.output('bloburl'), '_blank');
            } else {
                throw new Error(result.error);
            }
        } catch(error: any) {
             toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsPrinting(false);
            setIsLabelDialogOpen(false); // Close the dialog after everything
        }
    }, [onRefresh, toast]);
    
    const handlePrintLabelClick = (transfer: TransferEntry) => {
        setTransferForLabel(transfer);
        setIsLabelDialogOpen(true);
    };

    const handleManualStatusUpdate = async (newStatus: TransferStatus, justification: string) => {
        if (!statusChangeState.transfer) return;
        setIsUpdatingStatus(true);
        try {
            const transfer = statusChangeState.transfer as GroupedTransfer | TransferEntry;
            const ids = 'allIds' in transfer ? transfer.allIds : [transfer.id];
            const result = await updateTransferStatus(ids, newStatus, justification);
            if (result.success) {
                toast({ title: 'Éxito', description: 'El estado de la transferencia ha sido actualizado.' });
                onRefresh();
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result.error });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error inesperado', description: e.message });
        } finally {
            setIsUpdatingStatus(false);
            setStatusChangeState({ isOpen: false, transfer: null });
        }
    };

    const transferIdToPlacaMap = useMemo(() => {
        const map = new Map<string, string>();
        if (!collectionLogs) return map;
        collectionLogs.forEach(log => {
            log.transferIds.forEach(id => {
                map.set(id, log.placa);
            });
        });
        return map;
    }, [collectionLogs]);


    const handleMigrationClick = async () => {
        setIsMigrating(true);
        const result = await migrateLegacyTransferStatus();
        if (result.success) {
            toast({ title: 'Migración Completa', description: `Se actualizaron ${result.updatedCount} registros con el estado antiguo.` });
            onRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error en Migración', description: result.error });
        }
        setIsMigrating(false);
    };
    
    const handleHealClick = async () => {
        setIsHealing(true);
        const result = await healInconsistentTransfers();
        if (result.success) {
            toast({ title: 'Reparación Finalizada', description: `Se sincronizaron ${result.updatedCount} líneas de transferencia.` });
            onRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error en Reparación', description: result.error });
        }
        setIsHealing(false);
    };

    const fetchManifestData = useCallback(async () => {
        setIsLoadingManifests(true);
        const result = await getDeliveryManifests();
        if(result.success && result.data) setManifests(result.data);
        setIsLoadingManifests(false);
    }, []);

    useEffect(() => {
        fetchManifestData();
    }, [fetchManifestData]);

    const filteredTransfers = useMemo(() => {
        return transfers.filter(t => 
            (filters.numeroTF ? t.numeroTF.toLowerCase().includes(filters.numeroTF.toLowerCase()) : true) &&
            (filters.bodegaOrigen ? t.bodegaOrigen.toLowerCase().includes(filters.bodegaOrigen.toLowerCase()) : true) &&
            (filters.bodegaDestino ? t.bodegaDestino.toLowerCase().includes(filters.bodegaDestino.toLowerCase()) : true) &&
            (filters.status === 'all' ? true : t.status === filters.status) &&
            (filters.startDate && t.fecha instanceof Date ? t.fecha >= new Date(filters.startDate + 'T00:00:00') : true) &&
            (filters.endDate && t.fecha instanceof Date ? t.fecha <= new Date(filters.endDate + 'T23:59:59') : true)
        );
    }, [transfers, filters]);
    
    const supervisorValidationTransfers = useMemo(() => {
        const filtered = operationalTransfers.filter(t => t.status === 'Recolectado en Ruta');
        return filtered.filter(t => 
            (filters.numeroTF ? t.numeroTF.toLowerCase().includes(filters.numeroTF.toLowerCase()) : true) &&
            (filters.bodegaOrigen ? t.bodegaOrigen.toLowerCase().includes(filters.bodegaOrigen.toLowerCase()) : true) &&
            (filters.bodegaDestino ? t.bodegaDestino.toLowerCase().includes(filters.bodegaDestino.toLowerCase()) : true) &&
            (filters.placa ? (transferIdToPlacaMap.get(t.id) || '').toLowerCase().includes(filters.placa.toLowerCase()) : true) &&
            (filters.startDate && t.fecha instanceof Date ? t.fecha >= new Date(filters.startDate + 'T00:00:00') : true) &&
            (filters.endDate && t.fecha instanceof Date ? t.fecha <= new Date(filters.endDate + 'T23:59:59') : true)
        );
    }, [operationalTransfers, filters, transferIdToPlacaMap]);


    const transfersForManifest = useMemo(() => {
        return operationalTransfers.filter(t => t.status === 'Recibido en Bodega' || t.status === 'Validado Supervisor');
    }, [operationalTransfers]);
    
    const filteredTransfersForManifest = useMemo(() => {
        return transfersForManifest.filter(t =>
            (manifestFilters.numeroTF ? t.numeroTF.toLowerCase().includes(manifestFilters.numeroTF.toLowerCase()) : true) &&
            (manifestFilters.bodegaOrigen ? t.bodegaOrigen.toLowerCase().includes(manifestFilters.bodegaOrigen.toLowerCase()) : true) &&
            (manifestFilters.bodegaDestino ? t.bodegaDestino.toLowerCase().includes(manifestFilters.bodegaDestino.toLowerCase()) : true)
        );
    }, [transfersForManifest, manifestFilters]);
    
    const handleUpdateStatus = async (transfer: GroupedTransfer | TransferEntry, newStatus: TransferStatus) => {
        const ids = 'allIds' in transfer ? transfer.allIds : [transfer.id];
        const result = await updateTransferStatus(ids, newStatus);
        if (result.success) {
            toast({ title: 'Estado Actualizado', description: `Se marcaron ${ids.length} línea(s) como '${newStatus}'.`});
            onRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error al Actualizar', description: result.error });
        }
    };

    const handleSelectForManifest = (id: string, checked: boolean) => {
        setSelectedForManifest(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(id);
            else newSet.delete(id);
            return newSet;
        });
    };
    
    const handleCreateManifest = async () => {
        if (!manifestDetails.resource || !manifestDetails.driver) {
            toast({ variant: 'destructive', title: 'Datos incompletos', description: 'Placa y conductor son obligatorios.'});
            return;
        }
        if (selectedForManifest.size === 0) {
            toast({ variant: 'destructive', title: 'Sin selección', description: 'Debe seleccionar al menos una transferencia.'});
            return;
        }
        setIsSavingManifest(true);
        const result = await createDeliveryManifest({
            ...manifestDetails,
            transferIds: Array.from(selectedForManifest),
            summary: {
                totalTransfers: manifestSummary.totalItems,
                destinations: Object.entries(manifestSummary.destinations).reduce((acc, [key, value]) => {
                    acc[key] = value.itemCount;
                    return acc;
                }, {} as Record<string, number>),
            }
        });
        if (result.success) {
            toast({ title: 'Manifiesto Creado', description: 'La relación de entrega ha sido guardada.' });
            onRefresh();
            setSelectedForManifest(new Set());
            setIsCreateManifestOpen(false);
            fetchManifestData(); // Refresh the manifest history tab
        } else {
            toast({ variant: 'destructive', title: 'Error al Crear', description: result.error });
        }
        setIsSavingManifest(false);
    };

    const handleDeleteTransfer = async (transferId: string) => {
        const result = await deleteTransfer(transferId);
        if (result.success) {
          toast({ title: 'Éxito', description: 'Transferencia eliminada.' });
          onRefresh();
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
    };
    
    const usersMap = useMemo(() => new Map(users.map(u => [u.uid, u.displayName || u.email])), [users]);
    
    const handleScanForManifest = (e: React.FormEvent) => {
      e.preventDefault();
      const normalizedCode = scanInput.trim().toUpperCase().replace(/['\/]/g, '-');
      if (!normalizedCode) return;
      
      const codeParts = normalizedCode.split('-');
      const tfToFind = (codeParts.length > 1 ? codeParts.slice(1).join('-') : normalizedCode).trim();
      const destinoScanned = (codeParts.length > 1 ? codeParts[0] : null);

      const matchingTransfers = transfersForManifest.filter(t => t.numeroTF.trim().toUpperCase() === tfToFind);

      if (matchingTransfers.length > 0) {
          const firstTransfer = matchingTransfers[0];
          if (destinoScanned && firstTransfer.bodegaDestino.toUpperCase() !== destinoScanned) {
              toast({
                  variant: 'destructive',
                  title: 'Destino Incorrecto',
                  description: `La TF '${tfToFind}' fue encontrada, pero su destino es '${firstTransfer.bodegaDestino}', no '${destinoScanned}'.`
              });
          } else {
              const allMatchingIds = matchingTransfers.map(t => t.id);
              const alreadySelected = allMatchingIds.every(id => selectedForManifest.has(id));
              
              if (alreadySelected) {
                  toast({ variant: 'default', title: 'Ya Seleccionado', description: `La TF '${tfToFind}' ya está en la lista.` });
              } else {
                  allMatchingIds.forEach(id => handleSelectForManifest(id, true));
                  toast({ title: 'TF Agregada', description: `Se añadió '${tfToFind}' (${matchingTransfers.length} líneas) al manifiesto.` });
              }
          }
      } else {
          toast({ variant: 'destructive', title: 'No Encontrada', description: `La TF '${tfToFind}' no está disponible o no coincide con los filtros.` });
      }
      setScanInput('');
    };

    const manifestSummary = useMemo(() => {
        if (selectedForManifest.size === 0) {
            return { totalTFs: 0, totalItems: 0, destinations: {} };
        }
        const selectedLines = operationalTransfers.filter(t => selectedForManifest.has(t.id));
        
        // Sum total quantities
        const totalItems = selectedLines.reduce((sum, t) => sum + (t.cantidad || 0), 0);

        // Group by TF + Route to count "Documents" and get destination summary
        const uniqueTFs = new Set(selectedLines.map(t => `${t.numeroTF}-${t.bodegaOrigen}-${t.bodegaDestino}`));
        const totalTFs = uniqueTFs.size;

        const destinations = selectedLines.reduce((acc, t) => {
            const dest = t.bodegaDestino || 'N/A';
            if (!acc[dest]) {
                acc[dest] = { tfCountSet: new Set<string>(), itemCount: 0 };
            }
            acc[dest].tfCountSet.add(`${t.numeroTF}-${t.bodegaOrigen}`);
            acc[dest].itemCount += (t.cantidad || 0);
            return acc;
        }, {} as Record<string, { tfCountSet: Set<string>, itemCount: number }>);
        
        // Transform destinations for display
        const displayDestinations: Record<string, { tfCount: number, itemCount: number }> = {};
        Object.entries(destinations).forEach(([key, val]) => {
            displayDestinations[key] = {
                tfCount: val.tfCountSet.size,
                itemCount: val.itemCount
            };
        });
        
        return {
            totalTFs,
            totalItems,
            destinations: displayDestinations
        };
    }, [selectedForManifest, operationalTransfers]);


    return (
    <>
      <TransferLogDialog
        isOpen={isLogOpen}
        onOpenChange={setIsLogOpen}
        transfer={selectedTransferForLog}
      />
      <TransferLabelDialog
        isOpen={isLabelDialogOpen}
        onOpenChange={setIsLabelDialogOpen}
        transfer={transferForLabel}
        onConfirm={handleConfirmPrintAndReceive}
        isSaving={isPrinting}
      />
      <StatusChangeDialog
        isOpen={statusChangeState.isOpen}
        onOpenChange={(open) => setStatusChangeState({ isOpen: open, transfer: null })}
        transfer={statusChangeState.transfer}
        onConfirm={handleManualStatusUpdate}
        isSaving={isUpdatingStatus}
      />
      <Dialog open={isCreateManifestOpen} onOpenChange={setIsCreateManifestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Relación de Entrega (Manifiesto)</DialogTitle>
            <DialogDescription>
                Se creará un manifiesto con {selectedForManifest.size} transferencia(s) seleccionada(s), sumando un total de {manifestSummary.totalItems} unidades.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="resource">Recurso / Placa</Label>
                <Input id="resource" value={manifestDetails.resource} onChange={(e) => setManifestDetails(prev => ({...prev, resource: e.target.value}))} />
              </div>
               <div className="space-y-2">
                <Label htmlFor="driver">Conductor</Label>
                <Input id="driver" value={manifestDetails.driver} onChange={(e) => setManifestDetails(prev => ({...prev, driver: e.target.value}))} />
              </div>
               <div className="space-y-2">
                <Label htmlFor="assistants">Auxiliares</Label>
                <Input id="assistants" value={manifestDetails.assistants} onChange={(e) => setManifestDetails(prev => ({...prev, assistants: e.target.value}))} />
              </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateManifestOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateManifest} disabled={isSavingManifest}>
              {isSavingManifest && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
              Confirmar y Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ManifestDetailsDialog manifest={selectedManifest} isOpen={isManifestDetailsOpen} onOpenChange={setIsManifestDetailsOpen} />
      <CollectionLogDetailsDialog log={selectedCollectionLog} isOpen={!!selectedCollectionLog} onOpenChange={() => setSelectedCollectionLog(null)} />
      
        <Tabs defaultValue="general">
            <TabsList className="flex flex-wrap h-auto justify-start">
                <TabsTrigger value="general">Consulta General</TabsTrigger>
                <TabsTrigger value="collection">Registrar Recolección</TabsTrigger>
                {isAdmin && <TabsTrigger value="validation">Validación Supervisor</TabsTrigger>}
                <TabsTrigger value="reception">Recepción en Bodega</TabsTrigger>
                {isAdmin && (
                    <>
                        <TabsTrigger value="manifest">Crear Relación de Entrega</TabsTrigger>
                        <TabsTrigger value="history_manifest">Historial de Manifiestos</TabsTrigger>
                    </>
                )}
                <TabsTrigger value="history_collection">Historial de Recolecciones</TabsTrigger>
            </TabsList>
            <TabsContent value="reception" className="mt-6">
                 <WarehouseReceptionView onRefresh={onRefresh} collectionLogs={collectionLogs} />
            </TabsContent>
             <TabsContent value="validation" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Validación de Recolecciones en Ruta</CardTitle>
                        <CardDescription>Confirme la llegada a bodega de las TFs o márquelas como entregadas directamente en ruta.</CardDescription>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 pt-4 items-end">
                            <Input placeholder="Filtrar por # TF..." value={filters.numeroTF} onChange={e => setFilters(prev => ({...prev, numeroTF: e.target.value}))} />
                            <Input placeholder="Filtrar por Origen..." value={filters.bodegaOrigen} onChange={e => setFilters(prev => ({...prev, bodegaOrigen: e.target.value}))} />
                            <Input placeholder="Filtrar por Destino..." value={filters.bodegaDestino} onChange={e => setFilters(prev => ({...prev, bodegaDestino: e.target.value}))} />
                            <Input placeholder="Filtrar por Placa..." value={filters.placa} onChange={e => setFilters(prev => ({...prev, placa: e.target.value}))} />
                            <div className="flex gap-2 col-span-1 md:col-span-2">
                                <Input type="date" value={filters.startDate} onChange={e => setFilters(prev => ({...prev, startDate: e.target.value}))} title="Fecha Inicio" />
                                <Input type="date" value={filters.endDate} onChange={e => setFilters(prev => ({...prev, endDate: e.target.value}))} title="Fecha Fin" />
                            </div>
                            <Button variant="outline" onClick={() => setFilters({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '', placa: '', status: 'all', startDate: '', endDate: '' })}>
                                Limpiar Filtros {supervisorValidationTransfers.length > 0 && <span className="ml-2 opacity-50">({supervisorValidationTransfers.length})</span>}
                            </Button>
                         </div>
                    </CardHeader>
                    <CardContent>
                       <div className="flex justify-between items-center mb-2 px-1">
                            <span className="text-sm font-medium text-muted-foreground">
                                {supervisorValidationTransfers.length > 0 ? `Pendientes: ${groupTransfersByTF(supervisorValidationTransfers).length} TFs (${supervisorValidationTransfers.length} líneas)` : 'Sin pendientes de validación'}
                            </span>
                       </div>
                       <div className="border rounded-md max-h-[60vh] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha Recolección</TableHead>
                                        <TableHead>Placa</TableHead>
                                        <TableHead># TF</TableHead>
                                        <TableHead>Destino</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {supervisorValidationTransfers.length > 0 ? groupTransfersByTF(supervisorValidationTransfers, transferIdToPlacaMap).map(t => (
                                        <TableRow key={t.id}>
                                            <TableCell>{t.recibidoAt ? format(t.recibidoAt, "dd/MM/yy HH:mm") : 'N/A'}</TableCell>
                                            <TableCell className="font-mono">{transferIdToPlacaMap.get(t.id) || 'N/A'}</TableCell>
                                            <TableCell className="font-medium">{t.numeroTF}</TableCell>
                                            <TableCell>{t.bodegaDestino}</TableCell>
                                            <TableCell className="text-center font-bold">{t.cantidad}</TableCell>
                                            <TableCell className="text-right space-x-2">
                                                <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(t, 'Entregado en Ruta')}>Entregado en Ruta</Button>
                                                <Button size="sm" onClick={() => handleUpdateStatus(t, 'Validado Supervisor')}>Validar en Bodega</Button>
                                            </TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No hay transferencias pendientes de validación.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                       </div>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="general" className="mt-6">
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Transferencias</CardTitle>
                            <CardDescription>Visualice y gestione todas las transferencias de mercancía.</CardDescription>
                        </div>
                        <div className="flex gap-2">
                             <input type="file" ref={fileInputRef} onChange={onFileChange} className="hidden" accept=".xlsx, .xls" />
                            {isAdmin && (
                                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                                    {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <UploadCloud className="mr-2 h-4 w-4"/>}
                                    Actualizar Base
                                </Button>
                            )}
                             <Button onClick={() => setIsManualEntryOpen(true)}><Plus className="mr-2 h-4 w-4"/> Agregar Manual</Button>
                            <DownloadTemplateButton/>
                        </div>
                    </div>
                     {isAdmin && (
                      <div className="mt-4 flex gap-2">
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="secondary" size="sm" disabled={isMigrating}>
                                    {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Database className="mr-2 h-4 w-4" />}
                                    Corregir Estados Antiguos ("Recibido")
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>¿Confirmar corrección de datos?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Esta acción buscará todas las transferencias con el estado antiguo "Recibido" y las actualizará al nuevo estado "Recibido en Bodega". Es una operación segura que solo debe ejecutarse una vez.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleMigrationClick}>Sí, corregir datos</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="secondary" size="sm" disabled={isHealing}>
                                    {isHealing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ListOrdered className="mr-2 h-4 w-4" />}
                                    Enumerar FIFO (Registros Actuales)
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>¿Asignar orden de almacenamiento?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Esta acción asignará un código de orden (ej. 1-v1) a todas las transferencias activas basado en su fecha. Úselo para inicializar el sistema por primera vez.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={async () => {
                                        setIsHealing(true);
                                        const res = await healTransferStorageOrders();
                                        setIsHealing(false);
                                        if (res.success) {
                                            toast({ title: 'Éxito', description: `Se asignó orden a ${res.count} registros.` });
                                            onRefresh();
                                        } else {
                                            toast({ variant: 'destructive', title: 'Error', description: res.error });
                                        }
                                    }}>Confirmar</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                      </div>
                     )}
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4 items-end">
                        <div className="space-y-1">
                            <Label className="text-xs">Número TF</Label>
                            <Input placeholder="TF-..." value={filters.numeroTF} onChange={e => setFilters(prev => ({...prev, numeroTF: e.target.value}))} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Origen</Label>
                            <Input placeholder="Bodega..." value={filters.bodegaOrigen} onChange={e => setFilters(prev => ({...prev, bodegaOrigen: e.target.value}))} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Destino</Label>
                            <Input placeholder="Tienda..." value={filters.bodegaDestino} onChange={e => setFilters(prev => ({...prev, bodegaDestino: e.target.value}))} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Estado</Label>
                            <Select value={filters.status} onValueChange={val => setFilters(prev => ({...prev, status: val}))}>
                                <SelectTrigger><SelectValue placeholder="Estado..." /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="En Tránsito">En Tránsito</SelectItem>
                                    <SelectItem value="Recolectado en Ruta">Recolectado en Ruta</SelectItem>
                                    <SelectItem value="Entregado en Ruta">Entregado en Ruta</SelectItem>
                                    <SelectItem value="Validado Supervisor">Validado Supervisor</SelectItem>
                                    <SelectItem value="Recibido en Bodega">Recibido en Bodega</SelectItem>
                                    <SelectItem value="Enviado a Destino">Enviado a Destino</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="md:col-span-2 flex gap-2">
                            <div className="space-y-1 flex-1">
                                <Label className="text-xs">Fecha Inicio</Label>
                                <Input type="date" value={filters.startDate} onChange={e => setFilters(prev => ({...prev, startDate: e.target.value}))} />
                            </div>
                            <div className="space-y-1 flex-1">
                                <Label className="text-xs">Fecha Fin</Label>
                                <Input type="date" value={filters.endDate} onChange={e => setFilters(prev => ({...prev, endDate: e.target.value}))} />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button onClick={onSearch} disabled={isLoading} className="flex-1">
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>}
                                Buscar {filteredTransfers.length > 0 && <span className="ml-2 bg-primary-foreground text-primary px-2 rounded-full text-xs">{filteredTransfers.length}</span>}
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => setFilters({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '', placa: '', status: 'all', startDate: '', endDate: '' })} title="Limpiar Filtros">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                    <div className="flex justify-between items-center mb-2 px-1">
                        <span className="text-sm font-medium text-muted-foreground">
                            {filteredTransfers.length > 0 ? `Mostrando ${groupTransfersByTF(filteredTransfers).length} TFs únicas (${filteredTransfers.length} líneas halladas)` : 'No hay resultados'}
                        </span>
                    </div>
                    <div className="border rounded-md max-h-[60vh] overflow-auto">
                        <Table className="min-w-[1500px]">
                            <TableHeader>
                                 <TableRow>
                                    <TableHead className="w-[80px]">Ord.</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Número TF</TableHead>
                                    <TableHead>Origen</TableHead>
                                    <TableHead>Destino</TableHead>
                                    <TableHead>Marca</TableHead>
                                    <TableHead>Grupo</TableHead>
                                    <TableHead>Cantidad</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>Placa Recolección</TableHead>
                                    <TableHead>Fecha Recibido</TableHead>
                                    <TableHead>Fecha Enviado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={11} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin"/></TableCell></TableRow>
                                ) : filteredTransfers.length > 0 ? (
                                    groupTransfersByTF(filteredTransfers, transferIdToPlacaMap).map((t) => {
                                        const placa = transferIdToPlacaMap.get(t.id) || 'N/A';
                                        return (
                                         <TableRow key={t.id}>
                                            <TableCell className="font-bold text-blue-600">{t.storageOrder || '---'}</TableCell>
                                            <TableCell>{t.fecha.toLocaleDateString('es-CO')}</TableCell>
                                            <TableCell className="font-medium">{t.numeroTF}</TableCell>
                                            <TableCell>{t.bodegaOrigen}</TableCell>
                                            <TableCell>{t.bodegaDestino}</TableCell>
                                            <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground" title={t.marca}>{t.marca || '-'}</TableCell>
                                            <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground" title={t.grupo}>{t.grupo || '-'}</TableCell>
                                            <TableCell className="text-center font-bold text-lg">{t.cantidad}</TableCell>
                                            <TableCell>{getStatusBadge(t.status)}</TableCell>
                                            <TableCell className="font-mono text-xs">{placa}</TableCell>
                                            <TableCell>{t.recibidoAt ? format(t.recibidoAt, "dd/MM/yy HH:mm") : 'N/A'}</TableCell>
                                            <TableCell>{t.enviadoAt ? format(t.enviadoAt, "dd/MM/yy HH:mm") : 'N/A'}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                         <DropdownMenuItem onSelect={() => handleViewLog(t)}>
                                                            <History className="mr-2 h-4 w-4" /> Ver Historial
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => handlePrintLabelClick(t)} disabled={t.status === 'Enviado a Destino' || t.status === 'Entregado en Ruta'}>
                                                            <Printer className="mr-2 h-4 w-4" />
                                                            Imprimir Rótulo
                                                        </DropdownMenuItem>
                                                        {role === 'admin' && (
                                                            <>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem onSelect={() => setStatusChangeState({ isOpen: true, transfer: t })}>
                                                                    Cambiar Estado Manualmente
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                                                    <AlertDialog>
                                                                        <AlertDialogTrigger asChild>
                                                                            <span className="text-destructive w-full text-left relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50">Eliminar Transferencia</span>
                                                                        </AlertDialogTrigger>
                                                                        <AlertDialogContent>
                                                                            <AlertDialogHeader>
                                                                                <AlertDialogTitle>¿Está seguro?</AlertDialogTitle>
                                                                                <AlertDialogDescription>
                                                                                    Esta acción eliminará todos los registros del TF: {t.numeroTF} ({t.allIds.length} líneas).
                                                                                </AlertDialogDescription>
                                                                            </AlertDialogHeader>
                                                                            <AlertDialogFooter>
                                                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                                <AlertDialogAction onClick={async () => {
                                                                                    for (const id of t.allIds) {
                                                                                        await handleDeleteTransfer(id);
                                                                                    }
                                                                                }}>Eliminar Todo</AlertDialogAction>
                                                                            </AlertDialogFooter>
                                                                        </AlertDialogContent>
                                                                    </AlertDialog>
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    )})
                                ) : (
                                    <TableRow><TableCell colSpan={11} className="h-24 text-center text-muted-foreground">No hay transferencias que coincidan con los filtros.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                  </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="collection" className="mt-6">
                <CollectionTabView onRefresh={onRefresh} onOpenManualEntry={() => setIsManualEntryOpen(true)} />
            </TabsContent>
            <TabsContent value="manifest" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Crear Relación de Entrega (Manifiesto)</CardTitle>
                        <CardDescription>Seleccione las transferencias recibidas en bodega para generar un nuevo manifiesto de despacho.</CardDescription>
                    </CardHeader>
                    <CardContent>
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                         <div className="md:col-span-2 space-y-4">
                           <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                             <Input placeholder="Filtrar por # TF..." value={manifestFilters.numeroTF} onChange={(e) => setManifestFilters(prev => ({...prev, numeroTF: e.target.value}))} />
                             <Input placeholder="Filtrar por Origen..." value={manifestFilters.bodegaOrigen} onChange={(e) => setManifestFilters(prev => ({...prev, bodegaOrigen: e.target.value}))} />
                             <Input placeholder="Filtrar por Destino..." value={manifestFilters.bodegaDestino} onChange={(e) => setManifestFilters(prev => ({...prev, bodegaDestino: e.target.value}))} />
                           </div>
                           <form onSubmit={handleScanForManifest}>
                             <div className="flex gap-2">
                               <Input
                                   placeholder="Escanear o digitar TF para agregar..."
                                   value={scanInput}
                                   onChange={e => setScanInput(e.target.value)}
                                   className="font-mono"
                               />
                               <Button type="submit" variant="secondary"><ScanLine className="mr-2 h-4 w-4"/> Agregar</Button>
                             </div>
                           </form>
                         </div>
                         <Card className="p-4 bg-muted/50">
                            <h4 className="font-semibold text-center mb-2">Resumen de Selección</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between font-bold">
                                    <span>TFs Seleccionadas:</span>
                                    <span>{manifestSummary.totalTFs}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Unidades Totales:</span>
                                    <span>{manifestSummary.totalItems}</span>
                                </div>
                                {Object.keys(manifestSummary.destinations).length > 0 && (
                                <div className="text-xs mt-2 pt-2 border-t border-muted-foreground/20">
                                    <p className="font-bold mb-1">Desglose por Destino:</p>
                                    {Object.entries(manifestSummary.destinations).map(([dest, counts]) => (
                                        <div key={dest} className="flex justify-between text-muted-foreground">
                                            <span>{dest}:</span>
                                            <span>{counts.tfCount} TF(s) / {counts.itemCount} und.</span>
                                        </div>
                                    ))}
                                </div>
                                )}
                            </div>
                        </Card>
                       </div>

                       <div className="flex justify-end mb-4">
                           <Button onClick={() => setIsCreateManifestOpen(true)} disabled={selectedForManifest.size === 0}>
                               <FileSignature className="mr-2 h-4 w-4" /> Crear Manifiesto con {manifestSummary.totalTFs} TF(s)
                           </Button>
                       </div>
                       <div className="border rounded-md max-h-[60vh] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>
                                            <Checkbox
                                                checked={filteredTransfersForManifest.length > 0 && groupTransfersByTF(filteredTransfersForManifest).every(t => t.allIds.every(id => selectedForManifest.has(id)))}
                                                onCheckedChange={(checked) => {
                                                    const allGrouped = groupTransfersByTF(filteredTransfersForManifest);
                                                    const allIds = allGrouped.flatMap(t => t.allIds);
                                                    if(checked) {
                                                        setSelectedForManifest(new Set([...selectedForManifest, ...allIds]));
                                                    } else {
                                                        const newSet = new Set(selectedForManifest);
                                                        allIds.forEach(id => newSet.delete(id));
                                                        setSelectedForManifest(newSet);
                                                    }
                                                }}
                                            />
                                        </TableHead>
                                        <TableHead># TF</TableHead>
                                        <TableHead>Origen</TableHead>
                                        <TableHead>Destino</TableHead>
                                        <TableHead>Fecha Recepción</TableHead>
                                        <TableHead>Estado Actual</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredTransfersForManifest.length > 0 ? groupTransfersByTF(filteredTransfersForManifest).map(t => (
                                        <TableRow key={t.id} data-state={t.allIds.every(id => selectedForManifest.has(id)) ? "selected" : ""}>
                                            <TableCell>
                                                <Checkbox 
                                                    checked={t.allIds.every(id => selectedForManifest.has(id))} 
                                                    onCheckedChange={(checked) => {
                                                        const newSet = new Set(selectedForManifest);
                                                        if (checked) {
                                                            t.allIds.forEach(id => newSet.add(id));
                                                        } else {
                                                            t.allIds.forEach(id => newSet.delete(id));
                                                        }
                                                        setSelectedForManifest(newSet);
                                                    }} 
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">{t.numeroTF}</TableCell>
                                            <TableCell>{t.bodegaOrigen}</TableCell>
                                            <TableCell>{t.bodegaDestino}</TableCell>
                                            <TableCell>{t.recibidoAt ? format(t.recibidoAt, "dd/MM/yyyy HH:mm") : 'N/A'}</TableCell>
                                            <TableCell>{getStatusBadge(t.status)}</TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No hay transferencias disponibles con los filtros actuales.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                       </div>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="history_manifest" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Manifiestos Creados</CardTitle>
                    </CardHeader>
                    <CardContent>
                       <div className="border rounded-md max-h-[60vh] overflow-auto">
                           <Table>
                               <TableHeader><TableRow><TableHead>ID Manifiesto</TableHead><TableHead>Fecha</TableHead><TableHead>Recurso</TableHead><TableHead>Total Unidades</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                               <TableBody>
                                   {isLoadingManifests ? (
                                     <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="animate-spin mx-auto"/></TableCell></TableRow>
                                   ) : manifests.length > 0 ? manifests.map(m => (
                                       <TableRow key={m.id}>
                                           <TableCell>#{m.manifestId}</TableCell>
                                           <TableCell>{m.createdAt ? format(new Date(m.createdAt), "PPP p", { locale: es }) : 'N/A'}</TableCell>
                                           <TableCell>{m.resource}</TableCell>
                                           <TableCell>{m.summary?.totalTransfers || 0}</TableCell>
                                           <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => { setSelectedManifest(m); setIsManifestDetailsOpen(true); }}>Ver e Imprimir</Button></TableCell>
                                       </TableRow>
                                   )) : (
                                      <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No hay manifiestos creados.</TableCell></TableRow>
                                   )}
                               </TableBody>
                           </Table>
                       </div>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="history_collection" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Historial de Recolecciones en Ruta</CardTitle>
                        <CardDescription>Registro de todas las recolecciones confirmadas por los operarios.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="border rounded-md max-h-[70vh] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha Recolección</TableHead>
                                        <TableHead>Placa Vehículo</TableHead>
                                        <TableHead>Recolectado Por</TableHead>
                                        <TableHead>Destinos</TableHead>
                                <TableHead className="text-right">Total TFs</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin"/></TableCell></TableRow>
                                    ) : collectionLogs.length > 0 ? collectionLogs.map(log => (
                                        <TableRow key={log.id}>
                                            <TableCell>{format(log.createdAt, "PPP p", { locale: es })}</TableCell>
                                            <TableCell>{log.placa}</TableCell>
                                            <TableCell>{usersMap.get(log.recolectadoPor) || log.recolectadoPor}</TableCell>
                                            <TableCell>{Object.keys(log.summary?.destinations || {}).join(', ')}</TableCell>
                                            <TableCell className="text-right">{log.summary?.totalTransfers || 0}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="outline" size="sm" onClick={() => setSelectedCollectionLog(log)}>Ver Detalles</Button>
                                            </TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No hay recolecciones registradas.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
        </>
    )
};
const OperatorView: React.FC<{
  allTransfers: TransferEntry[];
  collectionLogs: CollectionLog[];
  isLoading: boolean;
  onRefresh: () => void;
}> = ({ allTransfers, collectionLogs, isLoading, onRefresh }) => {
    const [filters, setFilters] = useState({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '', status: 'all' });
    const { toast } = useToast();
    
    // States for Label Printing and History
    const [isLabelDialogOpen, setIsLabelDialogOpen] = useState(false);
    const [transferForLabel, setTransferForLabel] = useState<TransferEntry | null>(null);
    const [isPrinting, setIsPrinting] = useState(false);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [selectedTransferForLog, setSelectedTransferForLog] = useState<TransferEntry | null>(null);

    const transferIdToPlacaMap = useMemo(() => {
        const map = new Map<string, string>();
        if (!collectionLogs) return map;
        collectionLogs.forEach(log => {
            log.transferIds.forEach(id => {
                map.set(id, log.placa);
            });
        });
        return map;
    }, [collectionLogs]);

    const handleViewLog = (transfer: TransferEntry) => {
        setSelectedTransferForLog(transfer);
        setIsLogOpen(true);
    };

    const handleConfirmPrintAndReceive = useCallback(async (transfer: GroupedTransfer | TransferEntry) => {
        if (!transfer) return;
        setIsPrinting(true);
        try {
            const ids = 'allIds' in transfer ? transfer.allIds : [transfer.id];
            const result = await updateTransferStatus(ids, 'Recibido en Bodega');
            if (result.success) {
                toast({ title: 'Estado Actualizado', description: `La transferencia ha sido marcada como 'Recibido en Bodega'.` });
                onRefresh();
                
                const input = document.getElementById(`transfer-label-to-print-${transfer.id}`);
                if (!input) {
                    throw new Error('Elemento del rótulo no encontrado.');
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
                const canvas = await html2canvas(input, { scale: 3, useCORS: true, backgroundColor: '#ffffff' });
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF({ orientation: 'landscape', unit: 'cm', format: [10, 5] });
                pdf.addImage(imgData, 'PNG', 0, 0, 10, 5);
                pdf.autoPrint();
                window.open(pdf.output('bloburl'), '_blank');
            } else {
                throw new Error(result.error);
            }
        } catch(error: any) {
             toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsPrinting(false);
            setIsLabelDialogOpen(false);
        }
    }, [onRefresh, toast]);

    const handlePrintLabelClick = (transfer: TransferEntry) => {
        setTransferForLabel(transfer);
        setIsLabelDialogOpen(true);
    };

    const filteredTransfers = useMemo(() => {
        return allTransfers.filter(t => 
            (filters.numeroTF ? t.numeroTF.toLowerCase().includes(filters.numeroTF.toLowerCase()) : true) &&
            (filters.bodegaOrigen ? t.bodegaOrigen.toLowerCase().includes(filters.bodegaOrigen.toLowerCase()) : true) &&
            (filters.bodegaDestino ? t.bodegaDestino.toLowerCase().includes(filters.bodegaDestino.toLowerCase()) : true) &&
            (filters.status === 'all' ? true : t.status === filters.status)
        );
    }, [allTransfers, filters]);
    
    return (
        <Card>
          <CardHeader><CardTitle>Consulta de TFs en Bodega</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <Input placeholder="Filtrar por # TF..." value={filters.numeroTF} onChange={e => setFilters(prev => ({...prev, numeroTF: e.target.value}))} />
                <Input placeholder="Filtrar por Origen..." value={filters.bodegaOrigen} onChange={e => setFilters(prev => ({...prev, bodegaOrigen: e.target.value}))} />
                <Input placeholder="Filtrar por Destino..." value={filters.bodegaDestino} onChange={e => setFilters(prev => ({...prev, bodegaDestino: e.target.value}))} />
                 <Select value={filters.status} onValueChange={val => setFilters(prev => ({...prev, status: val}))}>
                    <SelectTrigger><SelectValue placeholder="Filtrar por estado..." /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los Estados</SelectItem>
                        <SelectItem value="En Tránsito">En Tránsito</SelectItem>
                        <SelectItem value="Recolectado en Ruta">Recolectado en Ruta</SelectItem>
                        <SelectItem value="Entregado en Ruta">Entregado en Ruta</SelectItem>
                        <SelectItem value="Validado Supervisor">Validado Supervisor</SelectItem>
                        <SelectItem value="Recibido en Bodega">Recibido en Bodega</SelectItem>
                        <SelectItem value="Enviado a Destino">Enviado a Destino</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="border rounded-md max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Número TF</TableHead>
                        <TableHead>Origen</TableHead>
                        <TableHead>Destino</TableHead>
                        <TableHead>Cantidad</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Placa Recolección</TableHead>
                        <TableHead>Fecha Recibido</TableHead>
                        <TableHead>Fecha Enviado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={10} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin"/></TableCell></TableRow>
                            ) : filteredTransfers.length > 0 ? (
                                groupTransfersByTF(filteredTransfers, transferIdToPlacaMap).map(t => {
                                    const placa = transferIdToPlacaMap.get(t.id) || 'N/A';
                                    return (
                                    <TableRow key={t.id}>
                                        <TableCell>{t.fecha.toLocaleDateString('es-CO')}</TableCell>
                                        <TableCell className="font-medium">{t.numeroTF}</TableCell>
                                        <TableCell>{t.bodegaOrigen}</TableCell>
                                        <TableCell>{t.bodegaDestino}</TableCell>
                                        <TableCell className="text-center font-bold">{t.cantidad}</TableCell>
                                        <TableCell>{getStatusBadge(t.status)}</TableCell>
                                        <TableCell className="font-mono">{placa}</TableCell>
                                        <TableCell>{t.recibidoAt ? format(t.recibidoAt, "dd/MM/yy HH:mm") : 'N/A'}</TableCell>
                                        <TableCell>{t.enviadoAt ? format(t.enviadoAt, "dd/MM/yy HH:mm") : 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => handleViewLog(t)}>
                                                        <History className="mr-2 h-4 w-4" /> Ver Historial
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => handlePrintLabelClick(t)} disabled={t.status === 'Enviado a Destino' || t.status === 'Entregado en Ruta'}>
                                                        <Printer className="mr-2 h-4 w-4" /> Imprimir Rótulo
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )})
                            ) : (
                                <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground">No hay transferencias que coincidan con los filtros.</TableCell></TableRow>
                            )}
                        </TableBody>
              </Table>
            </div>
          </CardContent>
          <TransferLabelDialog
            isOpen={isLabelDialogOpen}
            onOpenChange={setIsLabelDialogOpen}
            transfer={transferForLabel}
            onConfirm={handleConfirmPrintAndReceive}
            isSaving={isPrinting}
          />
          <TransferLogDialog
            isOpen={isLogOpen}
            onOpenChange={setIsLogOpen}
            transfer={selectedTransferForLog}
          />
        </Card>
    );
};

const CollectionTabView: React.FC<{
  onRefresh: () => void;
  onOpenManualEntry?: () => void;
}> = ({ onRefresh, onOpenManualEntry }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [transfers, setTransfers] = useState<TransferEntry[]>([]);
    const [selectedPlate, setSelectedPlate] = useState('');
    const [selectedTransfers, setSelectedTransfers] = useState(new Set<string>());
    const [debouncedFilters, setDebouncedFilters] = useState({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '' });
    const [filters, setFilters] = useState({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '' });

    const fetchTransfers = useCallback(async () => {
        const { numeroTF, bodegaOrigen, bodegaDestino } = filters;
        setIsLoading(true);
        
        let result;
        if (numeroTF) {
            result = await getTransfersByQuery(numeroTF, 'number');
        } else if (bodegaOrigen) {
            result = await getTransfersByQuery(bodegaOrigen, 'origin');
        } else if (bodegaDestino) {
            result = await getTransfersByQuery(bodegaDestino, 'destination');
        } else {
            result = await getTransfersByStatus('En Tránsito');
        }

        if (result.data) {
            // Filter only 'En Tránsito' records from the query result
            const collected = result.data.filter(t => t.status === 'En Tránsito');
            const sorted = [...collected].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
            setTransfers(sorted);
            if (sorted.length === 0) {
                toast({ title: 'Sin resultados', description: 'No se encontraron transferencias En Tránsito con esos criterios.' });
            }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error || 'Failed to load transfers' });
        }
        setIsLoading(false);
    }, [filters, toast]);

    useEffect(() => {
        // No longer loading automatically on mount to save reads.
    }, []);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedFilters(filters);
        }, 300); 
        return () => clearTimeout(handler);
    }, [filters]);

    const availableTransfers = useMemo(() => {
        return transfers.filter(t => 
            t.status === 'En Tránsito' &&
            (debouncedFilters.numeroTF ? t.numeroTF.toLowerCase().includes(debouncedFilters.numeroTF.toLowerCase()) : true) &&
            (debouncedFilters.bodegaOrigen ? t.bodegaOrigen.toLowerCase().includes(debouncedFilters.bodegaOrigen.toLowerCase()) : true) &&
            (debouncedFilters.bodegaDestino ? t.bodegaDestino.toLowerCase().includes(debouncedFilters.bodegaDestino.toLowerCase()) : true)
        );
    }, [transfers, debouncedFilters]);

    const groupedForCollection = useMemo(() => groupTransfersByTF(availableTransfers), [availableTransfers]);
    
    const uniqueSelectedTfCount = useMemo(() => {
        const selectedLines = availableTransfers.filter(t => selectedTransfers.has(t.id));
        const uniqueTFs = new Set(selectedLines.map(t => `${t.numeroTF}-${t.bodegaOrigen}-${t.bodegaDestino}`));
        return uniqueTFs.size;
    }, [selectedTransfers, availableTransfers]);

    const handleConfirmCollection = async () => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo identificar al usuario.' });
            return;
        }
        if (selectedTransfers.size === 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debe seleccionar al menos una transferencia.' });
            return;
        }
        setIsLoading(true);
        const result = await createCollectionLog(selectedPlate, Array.from(selectedTransfers), user.uid);
        if (result.success) {
            toast({ title: 'Éxito', description: `${uniqueSelectedTfCount} transferencias marcadas como recolectadas.` });
            fetchTransfers(); // Refresh local list
            onRefresh(); // Refresh parent if needed
            setSelectedTransfers(new Set());
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsLoading(false);
    };

    const handleSelectTransfer = (id: string, checked: boolean) => {
        setSelectedTransfers(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(id); else newSet.delete(id);
            return newSet;
        });
    };
    
    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Registrar Recolección en Ruta</CardTitle>
                        <CardDescription>Seleccione las transferencias que está recolectando y confirme.</CardDescription>
                    </div>
                    {onOpenManualEntry && (
                         <Button onClick={onOpenManualEntry} variant="secondary">
                            <Plus className="mr-2 h-4 w-4"/> Agregar Manual
                         </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Input placeholder="Ingrese su placa..." value={selectedPlate} onChange={e => setSelectedPlate(e.target.value.toUpperCase())} className="max-w-xs" />
                    <Button onClick={handleConfirmCollection} disabled={isLoading || selectedTransfers.size === 0 || !selectedPlate.trim()}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Confirmar Recolección de ({uniqueSelectedTfCount}) TFs
                    </Button>
                </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 p-4 border rounded-lg bg-muted/50 items-end">
                    <Input placeholder="Filtrar por # TF..." value={filters.numeroTF} onChange={e => setFilters(prev => ({...prev, numeroTF: e.target.value}))} />
                    <Input placeholder="Filtrar por Origen..." value={filters.bodegaOrigen} onChange={e => setFilters(prev => ({...prev, bodegaOrigen: e.target.value}))} />
                    <Input placeholder="Filtrar por Destino..." value={filters.bodegaDestino} onChange={e => setFilters(prev => ({...prev, bodegaDestino: e.target.value}))} />
                    <Button onClick={fetchTransfers} disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4" />}
                        Buscar
                    </Button>
                    <Button variant="ghost" onClick={() => { setFilters({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '' }); setTransfers([]); }}>Limpiar</Button>
                </div>
                 <div className="border rounded-md max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">
                                  <Checkbox
                                    checked={availableTransfers.length > 0 && availableTransfers.every(t => selectedTransfers.has(t.id))}
                                    onCheckedChange={(checked) => setSelectedTransfers(checked ? new Set(availableTransfers.map(t => t.id)) : new Set())}
                                  />
                                </TableHead>
                                <TableHead># TF</TableHead>
                                <TableHead>Origen</TableHead>
                                <TableHead>Destino</TableHead>
                                <TableHead className="text-center">Cant. Líneas</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groupedForCollection.length > 0 ? groupedForCollection.map(t => (
                                <TableRow key={t.id} data-state={t.allIds.every(id => selectedTransfers.has(id)) ? "selected" : ""}>
                                    <TableCell>
                                        <Checkbox 
                                            checked={t.allIds.every(id => selectedTransfers.has(id))} 
                                            onCheckedChange={(checked) => {
                                                const newSet = new Set(selectedTransfers);
                                                if (checked) t.allIds.forEach(id => newSet.add(id));
                                                else t.allIds.forEach(id => newSet.delete(id));
                                                setSelectedTransfers(newSet);
                                            }} 
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium">{t.numeroTF}</TableCell>
                                    <TableCell>{t.bodegaOrigen}</TableCell>
                                    <TableCell>{t.bodegaDestino}</TableCell>
                                    <TableCell className="text-center">{t.allIds.length}</TableCell>
                                </TableRow>
                            )) : (
                                <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No hay transferencias en tránsito que coincidan con los filtros.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                 </div>
            </CardContent>
        </Card>
    );
};

const DownloadTemplateButton: React.FC = () => {
    const handleDownload = () => {
        const headers = ["Fecha", "Numero TF", "Bodega Origen", "Bodega Destino", "Cantidad", "Marca", "Grupo"];
        const exampleData = [
            {
                "Fecha": "2024-07-29",
                "Numero TF": "TF-101",
                "Bodega Origen": "BODEGA PPA",
                "Bodega Destino": "TIENDA BELLO",
                "Cantidad": 1,
                "Marca": "MARCA EJEMPLO",
                "Grupo": "CALZADO"
            }
        ];
        
        const worksheet = XLSX.utils.json_to_sheet(exampleData, { header: headers });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Transferencias');
        
        const colWidths = headers.map(header => ({
            wch: Math.max(header.length, ...exampleData.map(row => String(row[header as keyof typeof row] || '').length)) + 5
        }));
        worksheet["!cols"] = colWidths;
        
        XLSX.writeFile(workbook, `Plantilla_Carga_Transferencias.xlsx`);
    };

    return (
        <Button onClick={handleDownload} variant="secondary" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Descargar Plantilla
        </Button>
    );
};

const ManualEntryDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (data: { numeroTF: string; bodegaDestino: string; origen?: string; status?: TransferStatus }) => void;
    isSaving: boolean;
}> = ({ isOpen, onOpenChange, onConfirm, isSaving }) => {
    const [numeroTF, setNumeroTF] = useState('');
    const [bodegaDestino, setBodegaDestino] = useState('');
    const [origen, setOrigen] = useState('');
    const [status, setStatus] = useState<TransferStatus>('En Tránsito');

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader><DialogTitle>Agregar Transferencia Manual</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="tf-manual">Número TF</Label>
                        <Input id="tf-manual" value={numeroTF} onChange={e => setNumeroTF(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="destino-manual">Bodega Destino</Label>
                        <Input id="destino-manual" value={bodegaDestino} onChange={e => setBodegaDestino(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="origen-manual">Origen (Opcional, defecto: BODEGA PPA)</Label>
                        <Input id="origen-manual" value={origen} onChange={e => setOrigen(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="status-manual">Estado Inicial</Label>
                        <Select value={status} onValueChange={(val) => setStatus(val as TransferStatus)}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="En Tránsito">En Tránsito</SelectItem>
                                <SelectItem value="Recibido en Bodega">Recibido en Bodega</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={() => onConfirm({ numeroTF, bodegaDestino, origen, status })} disabled={isSaving || !numeroTF || !bodegaDestino}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Agregar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// Main Component
export const TransfersModule: React.FC<{ onReturnToSuite: () => void; }> = ({ onReturnToSuite }) => {
    const [allTransfers, setAllTransfers] = useState<TransferEntry[]>([]); // Pooled operational data
    const [searchResults, setSearchResults] = useState<TransferEntry[] | null>(null); // Results from search tab
    const [allUsers, setAllUsers] = useState<AppUser[]>([]);
    const [collectionLogs, setCollectionLogs] = useState<CollectionLog[]>([]);
    const [filters, setFilters] = useState({ numeroTF: '', bodegaOrigen: '', bodegaDestino: '', placa: '', status: 'all', startDate: '', endDate: '' });
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    const { role } = useAuth();
    const isAdminOrSupervisor = role === 'admin' || role === 'supervisor';
    const isAdmin = role === 'admin' || role === 'supervisor'; // Re-using logic but semantic
    const canSeeAdminView = isAdminOrSupervisor || role === 'operator';
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
    const [isSavingManualEntry, setIsSavingManualEntry] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        // Only load users and logs initially. Transfers load ONLY by search or specific status tabs.
        const [usersResult, collectionLogsResult, recollectionRes, validatedRes, receivedRes] = await Promise.all([
          getAllUserProfiles(),
          getCollectionLogs(),
          getTransfersByStatus('Recolectado en Ruta'),
          getTransfersByStatus('Validado Supervisor'),
          getTransfersByStatus('Recibido en Bodega')
        ]);
        
        if (usersResult) {
            setAllUsers(usersResult);
        } else {
            toast({ variant: 'destructive', title: 'Error al cargar usuarios' });
        }

        if (collectionLogsResult.success && collectionLogsResult.data) {
            setCollectionLogs(collectionLogsResult.data);
        } else {
            toast({ variant: 'destructive', title: 'Error al cargar historial de recolecciones', description: collectionLogsResult.error });
        }

        const combinedTransfers = [
            ...(recollectionRes.data || []),
            ...(validatedRes.data || []),
            ...(receivedRes.data || [])
        ];

        const sorted = combinedTransfers.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
        setAllTransfers(sorted);

        if (recollectionRes.error || validatedRes.error || receivedRes.error) {
            toast({ variant: 'destructive', title: 'Error al cargar transferencias', description: 'Algunas listas no pudieron cargarse correctamente.' });
        }

        setIsLoading(false);
    }, [toast]);

    const handleSearch = useCallback(async () => {
        const { numeroTF, bodegaOrigen, bodegaDestino, status, startDate, endDate } = filters;

        if (!numeroTF && !bodegaOrigen && !bodegaDestino && status === 'all' && !startDate && !endDate) {
            toast({ title: "Filtros vacíos", description: "Por favor ingrese al menos un criterio de búsqueda (TF, Origen, Destino, Estado o Fecha)." });
            return;
        }

        setIsLoading(true);
        let result;
        if (numeroTF) {
            result = await getTransfersByQuery(numeroTF, 'number');
        } else if (bodegaOrigen) {
            result = await getTransfersByQuery(bodegaOrigen, 'origin');
        } else if (bodegaDestino) {
            result = await getTransfersByQuery(bodegaDestino, 'destination');
        } else if (startDate || endDate) {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();
            result = await getTransfersByDateRange(start, end);
        } else {
            // Status only search
            result = await getTransfersByStatus(status as TransferStatus);
        }

        if (result.error) {
            toast({ variant: 'destructive', title: 'Error en búsqueda', description: result.error });
        } else {
            const sorted = (result.data || []).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
            setSearchResults(sorted);
            if (sorted.length === 0) {
                toast({ title: 'Sin resultados', description: 'No se encontraron transferencias con esos criterios.' });
            }
        }
        setIsLoading(false);
    }, [filters, toast]);
    
    const handleManualEntryConfirm = async (data: { numeroTF: string; bodegaDestino: string; origen?: string; status?: TransferStatus }) => {
      setIsSavingManualEntry(true);
      const result = await createManualTransfer(data);
      if(result.success) {
        toast({ title: 'Éxito', description: 'Transferencia manual creada.' });
        fetchData();
        setIsManualEntryOpen(false);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
      setIsSavingManualEntry(false);
    }

    const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
  
      setIsLoading(true);
      try {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const json: any[] = XLSX.utils.sheet_to_json(worksheet);
  
          // --- DUAL SYNC ---
          const analysisResult = await syncAnalysisRecords(json);

          const newRoutes: Omit<TransferEntry, 'id' | 'status'>[] = json.map((row, index) => {
              const fecha = parseFlexibleDate(row['Fecha']);
              if (!fecha) {
                  console.warn(`Fila '${index+2}' omitida por fecha inválida.`);
                  return null;
              }
              return {
                  fecha,
                  numeroTF: String(row['Numero TF'] || 'N/A'),
                  bodegaOrigen: String(row['Bodega Origen'] || 'N/A'),
                  bodegaDestino: String(row['Bodega Destino'] || 'N/A'),
                  cantidad: Number(row['Cantidad'] || 1),
                  marca: String(row['Marca'] || ''),
                  grupo: String(row['Grupo'] || ''),
              } as Omit<TransferEntry, 'id' | 'status'>;
          }).filter((r): r is Omit<TransferEntry, 'id' | 'status'> => r !== null);
          
          if(newRoutes.length === 0) {
            throw new Error("No se encontraron transferencias válidas para operación en el archivo.");
          }
          
          const result = await saveTransfers(newRoutes);
  
          if(result.summary) {
              toast({ 
                  title: "Sincronización Completa", 
                  description: `Análisis: ${analysisResult.count || 0} registros. Operación: ${result.summary.added} nuevas / ${result.summary.updated} actualizadas.` 
              });
              fetchData();
          } else if (result.error) {
               throw new Error(result.error);
          }
  
      } catch(error: any) {
          toast({ variant: 'destructive', title: "Error al cargar archivo", description: error.message });
      } finally {
          setIsLoading(false);
          if (e.target) e.target.value = '';
      }
    }, [fetchData, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    return (
    <div className="space-y-8">
      <ManualEntryDialog
        isOpen={isManualEntryOpen}
        onOpenChange={setIsManualEntryOpen}
        onConfirm={handleManualEntryConfirm}
        isSaving={isSavingManualEntry}
      />
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Módulo de Transferencias</CardTitle>
            <CardDescription>
              Gestione las transferencias de mercancía entre diferentes bodegas y tiendas.
            </CardDescription>
          </div>
          <Button onClick={onReturnToSuite} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </CardHeader>
      </Card>
      
      {canSeeAdminView ? (
          <AdminView 
            transfers={searchResults || []} 
            operationalTransfers={allTransfers}
            collectionLogs={collectionLogs}
            isLoading={isLoading}
            filters={filters}
            setFilters={setFilters}
            onRefresh={fetchData}
            onSearch={handleSearch}
            role={role}
            users={allUsers}
            isUploading={isLoading}
            onFileChange={handleFileChange}
            fileInputRef={fileInputRef}
            setIsManualEntryOpen={setIsManualEntryOpen}
          />
      ) : role === 'conductor' ? (
        <CollectionTabView
            onRefresh={fetchData}
        />
      ) : (
          <OperatorView
            allTransfers={allTransfers}
            collectionLogs={collectionLogs}
            isLoading={isLoading}
            onRefresh={fetchData}
          />
      )}
    </div>
  );
};
    
