"use client";

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Package, Box, ChevronDown, ChevronRight, LayoutTemplate, Search, Edit2, Check, X, Filter, Download } from 'lucide-react';
import type { WholesaleOrder, PreprintedLabel, PackedItem, PackingSession } from '@/types';
import { getLabelsForOrder, getPackedItemsForOrder, updatePackedItem, getPackingSession } from '@/app/actions';

interface OrderAuditDialogProps {
  order: WholesaleOrder | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrderAuditDialog({ order, isOpen, onOpenChange }: OrderAuditDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [labels, setLabels] = useState<PreprintedLabel[]>([]);
  const [packedItems, setPackedItems] = useState<PackedItem[]>([]);
  const [packingSession, setPackingSession] = useState<PackingSession | null>(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  
  // States for scanner tool
  const [scannerInput, setScannerInput] = useState('');
  const [scannedBoxIds, setScannedBoxIds] = useState<Set<string>>(new Set());
  const [extraScannedBoxes, setExtraScannedBoxes] = useState<string[]>([]);
  const [auditReferenceFilter, setAuditReferenceFilter] = useState<string>('all');
  
  // States for inline editing
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState<number>(0);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (isOpen && order) {
      loadAuditData();
    } else {
      setLabels([]);
      setPackedItems([]);
      setExpandedRowKeys(new Set());
      setScannedBoxIds(new Set());
      setExtraScannedBoxes([]);
      setAuditReferenceFilter('all');
    }
  }, [isOpen, order]);

  const loadAuditData = async () => {
    if (!order) return;
    setIsLoading(true);
    try {
      const [labelsRes, itemsRes, sessionRes] = await Promise.all([
        getLabelsForOrder(order.id),
        getPackedItemsForOrder(order.id),
        getPackingSession(order.id)
      ]);
      if (labelsRes.data) setLabels(labelsRes.data);
      if (itemsRes.data) setPackedItems(itemsRes.data);
      if (sessionRes.data) setPackingSession(sessionRes.data);
    } catch (error) {
      console.error("Error loading audit data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRowKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Extract unique references correctly from packed items for the filter
  const uniqueReferences = useMemo(() => {
    const refs = new Set<string>();
    packedItems.forEach(pi => {
        let ref = '';
        if (pi.item && pi.item.referencia) ref = pi.item.referencia;
        else if (pi.itemKey) ref = pi.itemKey.split('-')[0] || '';
        if (ref) refs.add(ref.trim());
    });
    return Array.from(refs).sort();
  }, [packedItems]);

  // Helper to map label to packing unit firestore ID
  const labelToUnitIdMap = useMemo(() => {
    const map = new Map<string, string>();
    if (packingSession && packingSession.units) {
      packingSession.units.forEach(u => {
        if (u.labelBarcode) map.set(u.labelBarcode, u.firestoreId);
        // Also map sequential unitId for cases where label isn't printed yet but exists
        map.set(u.id.toString(), u.firestoreId);
      });
    }
    return map;
  }, [packingSession]);

  const targetLabelsForAudit = useMemo(() => {
    if (auditReferenceFilter === 'all') return labels;
    
    return labels.filter(label => {
        const unitFirestoreId = labelToUnitIdMap.get(label.id) || labelToUnitIdMap.get(label.unitId?.toString() || "");
        const itemsInBox = packedItems.filter(p => 
            p.packingUnitId === unitFirestoreId || 
            p.packingUnitId === label.unitId?.toString() || 
            p.packingUnitId === label.id
        );
        return itemsInBox.some(pi => {
            let ref = '';
            if (pi.item && pi.item.referencia) ref = pi.item.referencia;
            else if (pi.itemKey) ref = pi.itemKey.split('-')[0] || '';
            return ref.trim() === auditReferenceFilter;
        });
    });
  }, [labels, packedItems, auditReferenceFilter, labelToUnitIdMap]);

  const handleDownloadBoxesExcel = () => {
    if (!order || labels.length === 0) return;
    
    const sortedLabels = [...labels].sort((a, b) => {
        const numA = Number(a.unitId);
        const numB = Number(b.unitId);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.unitId).localeCompare(String(b.unitId));
    });
    
    const data = sortedLabels.map(label => {
        const unitFirestoreId = labelToUnitIdMap.get(label.id) || labelToUnitIdMap.get(label.unitId?.toString() || "");
        const itemsInBox = packedItems.filter(p => 
            p.packingUnitId === unitFirestoreId || 
            p.packingUnitId === label.unitId?.toString() || 
            p.packingUnitId === label.id
        );
        const uniqueRefs = new Set<string>();
        itemsInBox.forEach(pi => {
            if (pi.item && pi.item.referencia) uniqueRefs.add(pi.item.referencia.trim());
            else if (pi.itemKey) uniqueRefs.add(pi.itemKey.split('-')[0].trim());
            else if (pi.barcode) uniqueRefs.add(pi.barcode.trim());
        });
        const refsString = Array.from(uniqueRefs).join(', ');

        return {
            'Pedido': order.id,
            'Caja': label.unitId || '-',
            'Etiqueta': label.id,
            'Referencia(s)': refsString || 'Desconocida',
            'Estado Etiqueta': translateStatus(label.status).label
        };
    });
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EtiquetasDeCajas");
    XLSX.writeFile(wb, `Listado_Cajas_${order.id}.xlsx`);
  };

  const handleScannerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const term = scannerInput.trim();
        if (!term) return;
        
        const foundGlobally = labels.find(l => l.id.toLowerCase() === term.toLowerCase() || (l.unitId && l.unitId.toString() === term));
        if (foundGlobally) {
            const isTarget = targetLabelsForAudit.some(l => l.id === foundGlobally.id);
            if (isTarget) {
                setScannedBoxIds(prev => {
                    const next = new Set(prev);
                    next.add(foundGlobally.id);
                    return next;
                });
            } else {
                const msg = `${term} (No tiene ref. seleccionada)`;
                if (!extraScannedBoxes.includes(msg)) setExtraScannedBoxes(prev => [...prev, msg]);
            }
        } else {
            const msg = `${term} (No pertenece al pedido)`;
            if (!extraScannedBoxes.includes(msg)) {
                setExtraScannedBoxes(prev => [...prev, msg]);
            }
        }
        setScannerInput('');
    }
  };

  const translateStatus = (status: string) => {
    switch (status) {
      case 'available': return { label: 'Impresa (Disponible)', variant: 'secondary' as const };
      case 'used': return { label: 'Empacada (Lista)', variant: 'default' as const };
      case 'dispatched': return { label: 'Despachada', variant: 'success' as const };
      case 'void': return { label: 'Anulada', variant: 'destructive' as const };
      default: return { label: status, variant: 'outline' as const };
    }
  };

  const handleEditQuantity = async (packedItemId: string, labelId: string) => {
    if (editQuantity < 0) return;
    setIsSavingEdit(true);
    try {
      const result = await updatePackedItem(packedItemId, { quantity: editQuantity });
      if (result.success) {
        setPackedItems(prev => prev.map(p => p.id === packedItemId ? { ...p, quantity: editQuantity } : p));
        setEditingItemId(null);
      } else {
        console.error("Error saving new quantity:", result.error);
        alert(`Error al guardar: ${result.error}`);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const filteredLabels = useMemo(() => {
    if (!searchTerm) return labels;
    const term = searchTerm.toLowerCase();
    return labels.filter(l => 
      l.id.toLowerCase().includes(term) || 
      (l.unitId && l.unitId.toString().includes(term))
    );
  }, [labels, searchTerm]);

  const packingBalance = useMemo(() => {
    if (!order) return [];
    
    // Create a map from the ordered details
    const balanceMap = new Map<string, {
      referencia: string;
      item: string;
      talla: string;
      ordered: number;
      packed: number;
    }>();

    // Initialize with ordered items
    order.details?.forEach(d => {
      const key = `${d.referencia}-${d.talla}-${d.item || ''}`;
      balanceMap.set(key, { ...d, item: d.item || '', ordered: d.cantidad, packed: 0 });
    });

    // Add packed quantities
    packedItems.forEach(pi => {
      let ref = '';
      let talla = '';
      let itm = ''; // representing the color/variant string
      
      if (pi.item) {
        ref = pi.item.referencia || '';
        talla = pi.item.talla || '';
        itm = pi.item.item || '';
      } else if (pi.itemKey) {
        // Fallback if item object isn't fully populated
        const parts = pi.itemKey.split('-');
        ref = parts[0] || 'Desconocido';
        talla = parts[1] || '';
      } else {
        ref = pi.barcode || 'Desconocido';
      }

      const key = `${ref}-${talla}-${itm}`;
      if (balanceMap.has(key)) {
        balanceMap.get(key)!.packed += pi.quantity;
      } else {
        balanceMap.set(key, {
          referencia: ref,
          item: itm,
          talla: talla,
          ordered: 0,
          packed: pi.quantity
        });
      }
    });

    // Sort alphabetically by reference, then size
    return Array.from(balanceMap.values()).sort((a, b) => {
      const refA = String(a.referencia || '');
      const refB = String(b.referencia || '');
      const refComp = refA.localeCompare(refB);
      if (refComp !== 0) return refComp;
      
      const tallaA = String(a.talla || '');
      const tallaB = String(b.talla || '');
      return tallaA.localeCompare(tallaB);
    });
  }, [order, packedItems]);

  const totalOrdered = packingBalance.reduce((sum, b) => sum + b.ordered, 0);
  const totalPacked = packingBalance.reduce((sum, b) => sum + b.packed, 0);

  if (!order) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <LayoutTemplate className="h-6 w-6 text-primary" />
                Auditoría de Pedido: {order.id}
              </DialogTitle>
              <DialogDescription className="mt-1">
                Cliente: <span className="font-semibold text-foreground">{order.cliente}</span>
                <span className="mx-2">•</span>
                Estado Actual: <Badge variant="outline" className="ml-1">{order.status}</Badge>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Cargando datos de auditoría...</p>
          </div>
        ) : (
          <Tabs defaultValue="balance" className="flex-1 flex flex-col min-h-0 mt-4">
            <TabsList className="grid w-full max-w-2xl grid-cols-3">
              <TabsTrigger value="balance">Balance Consolidado</TabsTrigger>
              <TabsTrigger value="etiquetas">Cajas y Etiquetas</TabsTrigger>
              <TabsTrigger value="escaner">Escáner de Validación</TabsTrigger>
            </TabsList>
            
            {/* PESTAÑA: BALANCE CONSOLIDADO */}
            <TabsContent value="balance" className="flex-1 mt-4 border rounded-md data-[state=inactive]:hidden">
             <div className="h-full flex flex-col overflow-hidden">
              <div className="bg-muted/50 p-4 border-b flex items-center justify-between">
                <div>
                  <p className="font-semibold">Progreso General</p>
                  <p className="text-sm text-muted-foreground">Unidades pedidas frente a las físicamente empacadas.</p>
                </div>
                <div className="text-right flex gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Pedido</p>
                    <p className="font-mono text-xl font-bold">{totalOrdered}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Empacado</p>
                    <p className="font-mono text-xl font-bold text-primary">{totalPacked}</p>
                  </div>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                    <TableRow>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Talla</TableHead>
                      <TableHead className="text-right">Pedido</TableHead>
                      <TableHead className="text-right">Empacado</TableHead>
                      <TableHead className="text-right">Diferencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packingBalance.map((row, idx) => {
                      const diff = row.packed - row.ordered;
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{row.referencia}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{row.item || '-'}</TableCell>
                          <TableCell className="text-center">{row.talla}</TableCell>
                          <TableCell className="text-right">{row.ordered}</TableCell>
                          <TableCell className="text-right font-semibold">{row.packed}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={diff === 0 ? 'success' : diff < 0 ? 'destructive' : 'warning'}>
                              {diff > 0 ? '+' : ''}{diff}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {packingBalance.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No hay detalles encontrados para este pedido.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
             </div>
            </TabsContent>

            {/* PESTAÑA: CAJAS Y ETIQUETAS */}
            <TabsContent value="etiquetas" className="flex-1 mt-4 border rounded-md data-[state=inactive]:hidden">
             <div className="h-full flex flex-col overflow-hidden">
              
              <div className="p-4 border-b bg-muted/30">
                <div className="relative max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar por código de etiqueta o Nro de caja..." 
                    className="pl-9 bg-background"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <ScrollArea className="flex-1 p-0">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Código Etiqueta</TableHead>
                      <TableHead>Unidad/Caja</TableHead>
                      <TableHead>Estado Real</TableHead>
                      <TableHead className="text-right">Unidades Adentro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLabels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {searchTerm ? 'No se encontraron etiquetas con esa búsqueda.' : 'Aún no se han generado etiquetas para este pedido.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLabels.map(label => {
                        const unitFirestoreId = labelToUnitIdMap.get(label.id) || labelToUnitIdMap.get(label.unitId?.toString() || "");
                        const itemsInBox = packedItems.filter(p => 
                            p.packingUnitId === unitFirestoreId || 
                            p.packingUnitId === label.unitId?.toString() || 
                            p.packingUnitId === label.id
                        );
                        const totalUnitsInBox = itemsInBox.reduce((sum, p) => sum + p.quantity, 0);
                        const isExpanded = expandedRowKeys.has(label.id);
                        const statusBadge = translateStatus(label.status);

                        return (
                          <React.Fragment key={label.id}>
                            <TableRow className="hover:bg-muted/30 cursor-pointer" onClick={() => toggleRow(label.id)}>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                              <TableCell className="font-mono font-medium">{label.id}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Box className="h-4 w-4 text-muted-foreground" />
                                  Caja {label.unitId || '-'}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                              </TableCell>
                              <TableCell className="text-right font-semibold">{totalUnitsInBox}</TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/10">
                                <TableCell colSpan={5} className="p-0">
                                  <div className="px-14 py-3 bg-card border-b shadow-inner">
                                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-widest">
                                      Contenido Físico
                                    </p>
                                    {itemsInBox.length === 0 ? (
                                      <p className="text-sm text-muted-foreground">La caja está vacía.</p>
                                    ) : (
                                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {itemsInBox.map((pi, i) => {
                                          let ref = 'Desconocido';
                                          let tal = '-';
                                          let itm = '-';
                                          if (pi.item) {
                                              ref = pi.item.referencia || 'Desconocido';
                                              tal = pi.item.talla || '-';
                                              itm = pi.item.item || '-';
                                          } else if (pi.itemKey) {
                                              const parts = pi.itemKey.split('-');
                                              ref = parts[0] || 'Desconocido';
                                              tal = parts[1] || '-';
                                          } else {
                                              ref = pi.barcode;
                                          }
                                          
                                          return (
                                            <div key={i} className="flex justify-between items-center p-2 rounded-md border bg-background text-sm">
                                              <div>
                                                <p className="font-medium text-primary">{ref}</p>
                                                <p className="text-[10px] text-muted-foreground">{itm} / Talla: {tal}</p>
                                              </div>
                                              <div className="flex items-center gap-3">
                                                {editingItemId === pi.id ? (
                                                  <div className="flex items-center gap-1">
                                                    <Input 
                                                      type="number" 
                                                      className="h-7 w-16 px-2 text-right text-xs" 
                                                      value={editQuantity} 
                                                      onChange={(e) => setEditQuantity(Number(e.target.value))} 
                                                      min={0}
                                                      autoFocus
                                                      disabled={isSavingEdit}
                                                    />
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-100" onClick={() => handleEditQuantity(pi.id, label.id)} disabled={isSavingEdit}>
                                                      {isSavingEdit ? <Loader2 className="h-3 w-3 animate-spin"/> : <Check className="h-4 w-4" />}
                                                    </Button>
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-100" onClick={() => setEditingItemId(null)} disabled={isSavingEdit}>
                                                      <X className="h-4 w-4" />
                                                    </Button>
                                                  </div>
                                                ) : (
                                                  <>
                                                    <div className="bg-muted px-2 py-1 rounded font-mono text-xs font-bold w-16 text-center">
                                                      {pi.quantity} unds
                                                    </div>
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 opacity-50 hover:opacity-100" onClick={() => { setEditingItemId(pi.id); setEditQuantity(pi.quantity); }}>
                                                      <Edit2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
             </div>
            </TabsContent>

            {/* PESTAÑA: ESCÁNER DE VALIDACIÓN */}
            <TabsContent value="escaner" className="flex-1 mt-4 border rounded-md data-[state=inactive]:hidden bg-muted/10">
              <div className="h-full flex flex-col items-center">
                <div className="w-full max-w-xl mt-8 mb-6 text-center space-y-4 px-6 flex flex-col items-center">
                    <div className="flex items-center justify-between w-full">
                        <h3 className="text-xl font-semibold">Validación de Cajas Físicas</h3>
                        <Button onClick={handleDownloadBoxesExcel} variant="outline" size="sm" className="h-8 gap-1 border-primary/20 text-primary hover:bg-primary/10">
                            <Download className="h-4 w-4" />
                            Descargar Excel
                        </Button>
                    </div>
                    <p className="text-sm text-muted-foreground w-full">Seleccione una referencia para auditar únicamente las cajas que la contienen, luego escanee físicamente esas cajas.</p>
                    
                    <div className="flex items-center gap-3 w-full max-w-sm">
                        <Filter className="h-5 w-5 text-muted-foreground" />
                        <Select value={auditReferenceFilter} onValueChange={(val) => {
                            setAuditReferenceFilter(val);
                            setScannedBoxIds(new Set());
                            setExtraScannedBoxes([]);
                        }}>
                            <SelectTrigger className="w-full font-medium">
                                <SelectValue placeholder="Filtrar por Referencia..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-64">
                                <SelectItem value="all" className="font-bold">Todas las Referencias</SelectItem>
                                {uniqueReferences.map(ref => (
                                    <SelectItem key={ref} value={ref}>Ref. {ref}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="w-full max-w-sm px-6 mb-8 mt-2">
                    <Input 
                        placeholder="Escanee la etiqueta de la caja aquí..." 
                        className="text-center text-lg h-12 shadow-sm border-primary/30 focus-visible:ring-primary"
                        value={scannerInput}
                        onChange={(e) => setScannerInput(e.target.value)}
                        onKeyDown={handleScannerKeyDown}
                        autoFocus
                    />
                </div>
                
                <div className="w-full max-w-4xl flex-1 px-6 pb-6 overflow-hidden flex gap-4">
                    {/* COLUMNA FALTANTES */}
                    <div className="flex-1 flex flex-col border rounded-md overflow-hidden bg-background">
                        <div className="bg-orange-100/50 p-3 border-b">
                            <h4 className="font-semibold text-orange-800 flex justify-between items-center">
                                Cajas Faltantes
                                <Badge variant="outline" className="bg-background">{targetLabelsForAudit.filter(l => !scannedBoxIds.has(l.id)).length}</Badge>
                            </h4>
                        </div>
                        <ScrollArea className="flex-1 p-0">
                            <Table>
                                <TableBody>
                                    {targetLabelsForAudit.filter(l => !scannedBoxIds.has(l.id)).map(label => (
                                        <TableRow key={`faltante-${label.id}`}>
                                            <TableCell className="font-medium">{label.id}</TableCell>
                                            <TableCell className="text-right">Caja {label.unitId}</TableCell>
                                        </TableRow>
                                    ))}
                                    {targetLabelsForAudit.filter(l => !scannedBoxIds.has(l.id)).length === 0 && (
                                        <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8">Todas las cajas físicas encontradas.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </div>

                    {/* COLUMNA LEIDAS Y SOBRANTES */}
                    <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                        {extraScannedBoxes.length > 0 && (
                            <div className="flex-[0.5] flex flex-col border border-red-200 rounded-md overflow-hidden bg-background">
                                <div className="bg-red-50 p-3 border-b border-red-100 flex justify-between items-center">
                                    <h4 className="font-semibold text-red-700">Sobrantes</h4>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-700 hover:text-red-900 hover:bg-red-100" onClick={() => setExtraScannedBoxes([])}>Limpiar</Button>
                                </div>
                                <ScrollArea className="flex-1 p-2 space-y-2">
                                    {extraScannedBoxes.map(term => (
                                        <div key={term} className="bg-red-50 text-red-700 font-mono p-2 text-sm rounded border border-red-100 flex justify-between items-start gap-2">
                                            <span className="break-all">{term}</span>
                                            <X className="h-4 w-4 shrink-0 cursor-pointer hover:scale-110 transition-transform" onClick={() => setExtraScannedBoxes(prev => prev.filter(t => t !== term))} />
                                        </div>
                                    ))}
                                </ScrollArea>
                            </div>
                        )}

                        <div className={`flex flex-col border rounded-md overflow-hidden bg-background ${extraScannedBoxes.length > 0 ? 'flex-[0.5]' : 'flex-1'}`}>
                            <div className="bg-green-50 p-3 border-b flex justify-between items-center">
                                <h4 className="font-semibold text-green-700 flex items-center gap-2">
                                    Verificadas
                                    <Badge variant="outline" className="bg-background text-green-700 border-green-200">{scannedBoxIds.size}</Badge>
                                </h4>
                                {scannedBoxIds.size > 0 && (
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-green-700 hover:bg-green-100" onClick={() => setScannedBoxIds(new Set())}>Reiniciar</Button>
                                )}
                            </div>
                            <ScrollArea className="flex-1 p-0">
                                <Table>
                                    <TableBody>
                                        {targetLabelsForAudit.filter(l => scannedBoxIds.has(l.id)).map(label => (
                                            <TableRow key={`verificada-${label.id}`} className="bg-green-50/30">
                                                <TableCell className="font-medium text-green-800 flex items-center gap-2">
                                                    <Check className="h-4 w-4 text-green-600" />
                                                    {label.id}
                                                </TableCell>
                                                <TableCell className="text-right text-green-700">Caja {label.unitId}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </div>
                    </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
