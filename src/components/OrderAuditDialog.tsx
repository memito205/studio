"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Loader2, Package, Box, ChevronDown, ChevronRight, LayoutTemplate, Search, Edit2, Check, X } from 'lucide-react';
import type { WholesaleOrder, PreprintedLabel, PackedItem } from '@/types';
import { getLabelsForOrder, getPackedItemsForOrder, updatePackedItem } from '@/app/actions';

interface OrderAuditDialogProps {
  order: WholesaleOrder | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrderAuditDialog({ order, isOpen, onOpenChange }: OrderAuditDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [labels, setLabels] = useState<PreprintedLabel[]>([]);
  const [packedItems, setPackedItems] = useState<PackedItem[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  
  // States for scanner tool
  const [scannerInput, setScannerInput] = useState('');
  const [scannedLabel, setScannedLabel] = useState<PreprintedLabel | null>(null);
  
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
    }
  }, [isOpen, order]);

  const loadAuditData = async () => {
    if (!order) return;
    setIsLoading(true);
    try {
      const [labelsRes, itemsRes] = await Promise.all([
        getLabelsForOrder(order.id),
        getPackedItemsForOrder(order.id)
      ]);
      if (labelsRes.data) setLabels(labelsRes.data);
      if (itemsRes.data) setPackedItems(itemsRes.data);
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

  const handleScannerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const term = scannerInput.trim();
        if (!term) return;
        
        const found = labels.find(l => l.id.toLowerCase() === term.toLowerCase() || (l.unitId && l.unitId.toString() === term));
        if (found) {
            setScannedLabel(found);
            setScannerInput('');
        } else {
            alert(`No se encontró la caja/etiqueta con el código: ${term}`);
            setScannerInput('');
        }
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
                        const itemsInBox = packedItems.filter(p => p.packingUnitId === label.unitId?.toString() || p.packingUnitId === label.id);
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
                <div className="w-full max-w-xl mt-8 mb-6 text-center space-y-2 px-6">
                    <h3 className="text-xl font-semibold">Validación de Cajas (Auditoría Física)</h3>
                    <p className="text-sm text-muted-foreground">Utilice un lector de código de barras para escanear una caja o etiqueta de este pedido y verificar su contenido específico para encontrar sobrantes o faltantes.</p>
                </div>
                <div className="w-full max-w-sm px-6 mb-8">
                    <Input 
                        placeholder="Escanee la etiqueta de la caja aquí..." 
                        className="text-center text-lg h-12 shadow-sm border-primary/30 focus-visible:ring-primary"
                        value={scannerInput}
                        onChange={(e) => setScannerInput(e.target.value)}
                        onKeyDown={handleScannerKeyDown}
                        autoFocus
                    />
                </div>
                
                {scannedLabel && (
                    <div className="w-full max-w-2xl flex-1 px-6 pb-6 overflow-hidden flex flex-col">
                        {(() => {
                           const itemsInBox = packedItems.filter(p => p.packingUnitId === scannedLabel.unitId?.toString() || p.packingUnitId === scannedLabel.id);
                           const totalUnits = itemsInBox.reduce((sum, p) => sum + p.quantity, 0);
                           const status = translateStatus(scannedLabel.status);
                           return (
                               <div className="flex-1 flex flex-col overflow-hidden border rounded-md bg-card shadow-sm">
                                   <div className="p-4 border-b flex justify-between items-center bg-muted/20">
                                       <div>
                                           <h4 className="font-bold text-lg">{scannedLabel.id}</h4>
                                           <p className="text-sm text-muted-foreground flex items-center gap-1"><Box className="h-3.5 w-3.5"/>Caja {scannedLabel.unitId || '-'}</p>
                                       </div>
                                       <div className="text-right">
                                           <Badge variant={status.variant} className="mb-1">{status.label}</Badge>
                                           <p className="font-mono font-semibold text-lg">{totalUnits} empacadas</p>
                                       </div>
                                   </div>
                                   <ScrollArea className="flex-1">
                                       {itemsInBox.length === 0 ? (
                                           <div className="p-12 text-center text-muted-foreground">La caja se encuentra vacía o no tiene registros asociados.</div>
                                       ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
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
                                                        <div key={i} className="flex justify-between items-center p-3 rounded-md border bg-background shadow-xs">
                                                            <div>
                                                                <p className="font-bold text-primary text-base">{ref}</p>
                                                                <p className="text-xs text-muted-foreground uppercase">{itm} / T <span className="font-bold">{tal}</span></p>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                {editingItemId === pi.id ? (
                                                                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md">
                                                                        <Input 
                                                                        type="number" 
                                                                        className="h-8 w-16 px-2 text-center font-bold text-sm" 
                                                                        value={editQuantity} 
                                                                        onChange={(e) => setEditQuantity(Number(e.target.value))} 
                                                                        min={0}
                                                                        autoFocus
                                                                        disabled={isSavingEdit}
                                                                        />
                                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-100" onClick={() => handleEditQuantity(pi.id, scannedLabel.id)} disabled={isSavingEdit}>
                                                                        {isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin"/> : <Check className="h-5 w-5" />}
                                                                        </Button>
                                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-100" onClick={() => setEditingItemId(null)} disabled={isSavingEdit}>
                                                                        <X className="h-5 w-5" />
                                                                        </Button>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                    <div className="bg-primary/10 text-primary px-3 py-1 rounded-md font-mono text-base font-bold text-center">
                                                                        {pi.quantity}
                                                                    </div>
                                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingItemId(pi.id); setEditQuantity(pi.quantity); }}>
                                                                        <Edit2 className="h-4 w-4" />
                                                                    </Button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                       )}
                                   </ScrollArea>
                               </div>
                           );
                        })()}
                    </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
