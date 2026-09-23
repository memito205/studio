"use client";

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Package, Box, ChevronDown, ChevronRight, LayoutTemplate, Search, Edit2, Check, X, Filter, Download, RefreshCw } from 'lucide-react';
import type { WholesaleOrder, PreprintedLabel, PackedItem, PackingSession } from '@/types';
import { getLabelsForOrder, getPackedItemsForOrder, updatePackedItem, getPackingSession, assignLabelToWholesalePackingUnit, addSingleLabel } from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { findUnlabeledWholesaleUnits } from '@/lib/wholesalePacking';
import {
  buildBoxAuditLines,
  boxAuditLinesToExcelRows,
  computeWholesalePackingTotals,
  resolvePackedItemRefTalla,
} from '@/lib/wholesalePacking';

interface OrderAuditDialogProps {
  order: WholesaleOrder | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reuse packed items already loaded in WholesaleDashboard when available. */
  initialPackedItems?: PackedItem[];
}

export function OrderAuditDialog({ order, isOpen, onOpenChange, initialPackedItems }: OrderAuditDialogProps) {
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
  const { role, user, userName } = useAuth();
  const { toast } = useToast();
  const [assignUnitId, setAssignUnitId] = useState<number | null>(null);
  const [assignLabelInput, setAssignLabelInput] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

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

  const loadAuditData = async (opts?: { forceRefreshPacked?: boolean }) => {
    if (!order) return;
    setIsLoading(true);
    try {
      const hint = (initialPackedItems || []).filter((p) => p.orderId === order.id);
      const reusePacked = !opts?.forceRefreshPacked && hint.length > 0;

      const fetches: Array<Promise<unknown>> = [
        getLabelsForOrder(order.id),
        getPackingSession(order.id),
      ];
      if (!reusePacked) {
        fetches.push(getPackedItemsForOrder(order.id));
      }

      const results = await Promise.all(fetches);
      const labelsRes = results[0] as Awaited<ReturnType<typeof getLabelsForOrder>>;
      const sessionRes = results[1] as Awaited<ReturnType<typeof getPackingSession>>;
      const itemsRes = reusePacked
        ? { data: hint }
        : (results[2] as Awaited<ReturnType<typeof getPackedItemsForOrder>>);

      if (labelsRes.data) setLabels(labelsRes.data);
      if (itemsRes.data) setPackedItems(itemsRes.data);
      if (sessionRes.data) setPackingSession(sessionRes.data);
    } catch (error) {
      console.error("Error loading audit data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerateSnapshot = async () => {
    if (!order) return;
    setIsLoading(true);
    try {
      const { getOrBuildBoxAuditReport } = await import('@/app/wholesaleReportActions');
      const [labelsRes, itemsRes, sessionRes, snapRes] = await Promise.all([
        getLabelsForOrder(order.id),
        getPackedItemsForOrder(order.id),
        getPackingSession(order.id),
        getOrBuildBoxAuditReport({
          orderId: order.id,
          orderStatus: order.status,
          forceRegenerate: true,
          actor: { uid: user?.uid || null, name: userName || role || null },
        }),
      ]);
      if (labelsRes.data) setLabels(labelsRes.data);
      if (itemsRes.data) setPackedItems(itemsRes.data);
      if (sessionRes.data) setPackingSession(sessionRes.data);
      if (snapRes.error) {
        toast({ variant: 'destructive', title: 'Error', description: snapRes.error });
      } else {
        toast({
          title: 'Snapshot regenerado',
          description: 'Auditoría de cajas actualizada desde datos en vivo.',
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error?.message || 'No se pudo regenerar el snapshot.',
      });
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
    if (!order) return;
    const totals = computeWholesalePackingTotals(order, packedItems);
    const lines = buildBoxAuditLines({
      orderId: order.id,
      packedItems,
      session: packingSession,
      labels,
    });
    const detailRows = boxAuditLinesToExcelRows(lines);
    const summaryRows = [
      { Concepto: 'TOTAL DEL PEDIDO', Cantidad: totals.orderTotal },
      { Concepto: 'TOTAL EMPACADO', Cantidad: totals.packedTotal },
      { Concepto: 'DIFERENCIA', Cantidad: totals.difference },
      {
        Concepto: 'ESTADO',
        Cantidad: totals.isComplete
          ? 'Completo'
          : order.packingForceClosed
            ? 'Forzado incompleto'
            : 'Incompleto',
      },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Por caja');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Totales');
    XLSX.writeFile(wb, `Auditoria_Cajas_${order.id}.xlsx`);
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

    const balanceMap = new Map<string, {
      referencia: string;
      item: string;
      talla: string;
      ordered: number;
      packed: number;
    }>();

    order.details?.forEach(d => {
      const ref = String(d.referencia || '').trim();
      const talla = String(d.talla || '').trim();
      const key = `${ref}||${talla}`;
      const prev = balanceMap.get(key);
      if (prev) {
        prev.ordered += Number(d.cantidad || 0);
        if (!prev.item && d.item) prev.item = d.item;
      } else {
        balanceMap.set(key, {
          referencia: ref,
          item: d.item || '',
          talla,
          ordered: Number(d.cantidad || 0),
          packed: 0,
        });
      }
    });

    packedItems.forEach(pi => {
      const { referencia: ref, talla } = resolvePackedItemRefTalla(pi);
      const key = `${ref}||${talla}`;
      const qty = Number(pi.quantity || 0);
      if (balanceMap.has(key)) {
        balanceMap.get(key)!.packed += qty;
      } else {
        balanceMap.set(key, {
          referencia: ref || 'Desconocido',
          item: pi.item?.item || '',
          talla: talla || '',
          ordered: 0,
          packed: qty,
        });
      }
    });

    return Array.from(balanceMap.values()).sort((a, b) => {
      const refComp = String(a.referencia || '').localeCompare(String(b.referencia || ''));
      if (refComp !== 0) return refComp;
      return String(a.talla || '').localeCompare(String(b.talla || ''));
    });
  }, [order, packedItems]);

  const packingTotals = useMemo(
    () => computeWholesalePackingTotals(order, packedItems),
    [order, packedItems]
  );

  const unlabeledUnits = useMemo(
    () => findUnlabeledWholesaleUnits(packingSession, packedItems),
    [packingSession, packedItems]
  );

  const canAssignLabels = role === 'admin' || role === 'supervisor';
  const canRegenerate = canAssignLabels;

  const handleAssignLabelFromAudit = async () => {
    if (!order || assignUnitId == null || !assignLabelInput.trim()) return;
    setIsAssigning(true);
    try {
      let labelId = assignLabelInput.trim().toUpperCase();
      if (labelId === 'NUEVA' || labelId === 'NEW') {
        const gen = await addSingleLabel(order.id);
        if (!gen.data) throw new Error(gen.error || 'No se pudo generar etiqueta');
        labelId = gen.data.id;
      }
      const actor = userName || user?.displayName || user?.email || 'Admin';
      const result = await assignLabelToWholesalePackingUnit(order.id, assignUnitId, labelId, actor);
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Etiqueta asociada', description: `Caja #${assignUnitId} → ${result.labelId}` });
      setAssignUnitId(null);
      setAssignLabelInput('');
      await loadAuditData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsAssigning(false);
    }
  };


  /** Cajas desde sesión + ítems (no depende solo de etiquetas impresas). */
  const unitSummaries = useMemo(() => {
    const byUnit = new Map<string, { unitId: string; label: string; items: typeof packedItems; qty: number }>();
    const sessionUnits = packingSession?.units || [];
    sessionUnits.forEach(u => {
      if (!u.firestoreId) return;
      byUnit.set(u.firestoreId, {
        unitId: String(u.id),
        label: u.labelBarcode || '-',
        items: [],
        qty: 0,
      });
    });
    packedItems.forEach(pi => {
      const uid = String(pi.packingUnitId || '').trim() || '__none__';
      if (!byUnit.has(uid)) {
        byUnit.set(uid, {
          unitId: uid === '__none__' ? 'Sin caja' : 'Huérfana',
          label: '-',
          items: [],
          qty: 0,
        });
      }
      const row = byUnit.get(uid)!;
      row.items.push(pi);
      row.qty += Number(pi.quantity || 0);
    });
    return Array.from(byUnit.entries())
      .map(([firestoreId, v]) => ({ firestoreId, ...v }))
      .sort((a, b) => String(a.unitId).localeCompare(String(b.unitId), undefined, { numeric: true }));
  }, [packingSession, packedItems]);

  const totalOrdered = packingTotals.orderTotal;
  const totalPacked = packingTotals.packedTotal;

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

        
          {unlabeledUnits.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Cajas con mercancía sin etiqueta VXM ({unlabeledUnits.length})</p>
              <p className="text-xs mt-1 mb-2">El pedido no debería quedar Empacado mientras existan. Admin/supervisor puede asociar etiqueta aquí.</p>
              <ul className="space-y-2">
                {unlabeledUnits.map((u) => (
                  <li key={u.firestoreId} className="flex flex-wrap items-center gap-2 justify-between bg-white/70 rounded px-2 py-1.5 border border-amber-200">
                    <span>Caja #{u.id} · {u.itemQty} und · estado {u.status}</span>
                    {canAssignLabels && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => { setAssignUnitId(u.id); setAssignLabelInput(''); }}>
                        Asociar etiqueta
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Dialog open={assignUnitId != null} onOpenChange={(open) => { if (!open) { setAssignUnitId(null); setAssignLabelInput(''); } }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Asociar etiqueta a Caja #{assignUnitId}</DialogTitle>
                <DialogDescription>
                  Escanee una VXM disponible del pedido, o genere una nueva y luego imprímala desde Etiquetas en el dashboard.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Input
                  value={assignLabelInput}
                  onChange={(e) => setAssignLabelInput(e.target.value)}
                  placeholder="VXM-..."
                  disabled={isAssigning}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAssignLabelFromAudit(); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isAssigning || !order}
                  onClick={async () => {
                    if (!order) return;
                    setIsAssigning(true);
                    try {
                      const gen = await addSingleLabel(order.id);
                      if (!gen.data) throw new Error(gen.error || 'Error');
                      setAssignLabelInput(gen.data.id);
                      toast({ title: 'Etiqueta generada', description: gen.data.id });
                    } catch (e: any) {
                      toast({ variant: 'destructive', title: 'Error', description: e.message });
                    } finally {
                      setIsAssigning(false);
                    }
                  }}
                >
                  Generar etiqueta VXM nueva
                </Button>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setAssignUnitId(null)} disabled={isAssigning}>Cancelar</Button>
                <Button onClick={handleAssignLabelFromAudit} disabled={isAssigning || !assignLabelInput.trim()}>
                  {isAssigning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Asociar y cerrar caja
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
                <div className="text-right flex gap-6 items-center">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">TOTAL DEL PEDIDO</p>
                    <p className="font-mono text-xl font-bold">{totalOrdered}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">TOTAL EMPACADO</p>
                    <p className="font-mono text-xl font-bold text-primary">{totalPacked}</p>
                  </div>
                  <Button onClick={handleDownloadBoxesExcel} variant="outline" size="sm" className="gap-1">
                    <Download className="h-4 w-4" />
                    Descargar
                  </Button>
                  {canRegenerate && (order?.status === 'Empacado' || order?.status === 'Despachado') && (
                    <Button
                      onClick={() => void handleRegenerateSnapshot()}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={isLoading}
                      title="Regenerar snapshot de auditoría de cajas"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Regenerar
                    </Button>
                  )}
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
              
              <div className="p-4 border-b bg-muted/30 flex flex-wrap items-center gap-3 justify-between">
                <div className="relative max-w-sm flex-1 min-w-[220px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar por código de etiqueta o Nro de caja..." 
                    className="pl-9 bg-background"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-xs text-muted-foreground">
                    <div>TOTAL DEL PEDIDO: <span className="font-mono font-semibold text-foreground">{totalOrdered}</span></div>
                    <div>TOTAL EMPACADO: <span className="font-mono font-semibold text-primary">{totalPacked}</span></div>
                  </div>
                  <Button onClick={handleDownloadBoxesExcel} variant="outline" size="sm" className="gap-1">
                    <Download className="h-4 w-4" />
                    Descargar cajas
                  </Button>
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
                      <TableHead className="text-right">Cantidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLabels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {searchTerm ? 'No se encontraron etiquetas con esa búsqueda.' : (unitSummaries.length > 0 ? 'Sin etiquetas impresas; ver cajas físicas abajo.' : 'Aún no hay cajas ni etiquetas para este pedido.')}
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

              {unitSummaries.length > 0 && (
                <div className="border-t">
                  <div className="p-3 bg-muted/40 flex items-center justify-between">
                    <p className="text-sm font-semibold">Cajas físicas (unidades de empaque)</p>
                    <span className="text-xs text-muted-foreground">{unitSummaries.length} caja(s) · {totalPacked} und</span>
                  </div>
                  <ScrollArea className="max-h-[40vh]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Caja</TableHead>
                          <TableHead>Etiqueta</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead className="text-right">Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unitSummaries
                          .filter(u => !searchTerm || String(u.unitId).includes(searchTerm) || String(u.label).toLowerCase().includes(searchTerm.toLowerCase()))
                          .map(unit => {
                          const isExpanded = expandedRowKeys.has(unit.firestoreId);
                          return (
                            <React.Fragment key={unit.firestoreId}>
                              <TableRow className="cursor-pointer hover:bg-muted/30" onClick={() => toggleRow(unit.firestoreId)}>
                                <TableCell>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </Button>
                                </TableCell>
                                <TableCell className="font-medium">Caja {unit.unitId}</TableCell>
                                <TableCell className="font-mono text-xs">{unit.label}</TableCell>
                                <TableCell className="text-right font-semibold">{unit.qty}</TableCell>
                                <TableCell className="text-right">
                                  {(!unit.label || unit.label === '-') && unit.qty > 0 && canAssignLabels && unit.unitId !== 'Sin caja' && unit.unitId !== 'Huérfana' && (
                                    <Button size="sm" variant="outline" className="h-7" onClick={(e) => {
                                      e.stopPropagation();
                                      const num = Number(unit.unitId);
                                      if (!Number.isNaN(num)) { setAssignUnitId(num); setAssignLabelInput(''); }
                                    }}>
                                      Asociar
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                              {isExpanded && (
                                <TableRow className="bg-muted/10">
                                  <TableCell colSpan={5} className="p-0">
                                    <div className="px-10 py-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                      {unit.items.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">Caja vacía.</p>
                                      ) : (
                                        unit.items.map((pi, i) => {
                                          const { referencia: ref, talla: tal } = resolvePackedItemRefTalla(pi);
                                          return (
                                            <div key={pi.id || i} className="flex justify-between items-center p-2 rounded-md border bg-background text-sm">
                                              <div>
                                                <p className="font-medium text-primary">{ref || 'Desconocido'}</p>
                                                <p className="text-[10px] text-muted-foreground">Talla: {tal || '-'}</p>
                                              </div>
                                              <div className="bg-muted px-2 py-1 rounded font-mono text-xs font-bold">
                                                {pi.quantity} unds
                                              </div>
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}

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
                                    {targetLabelsForAudit.filter(l => !scannedBoxIds.has(l.id)).map(label => {
                                        const unitFirestoreId = labelToUnitIdMap.get(label.id) || labelToUnitIdMap.get(label.unitId?.toString() || "");
                                        const totalUnitsInBox = packedItems.filter(p => 
                                            p.packingUnitId === unitFirestoreId || 
                                            p.packingUnitId === label.unitId?.toString() || 
                                            p.packingUnitId === label.id
                                        ).reduce((sum, p) => sum + p.quantity, 0);
                                        
                                        return (
                                            <TableRow key={`faltante-${label.id}`}>
                                                <TableCell className="font-medium p-2 text-xs">{label.id}</TableCell>
                                                <TableCell className="text-center p-2 text-xs">Caja {label.unitId}</TableCell>
                                                <TableCell className="text-right p-2 text-xs font-bold text-orange-700">{totalUnitsInBox} unds</TableCell>
                                            </TableRow>
                                        );
                                    })}
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
                                        {targetLabelsForAudit.filter(l => scannedBoxIds.has(l.id)).map(label => {
                                            const unitFirestoreId = labelToUnitIdMap.get(label.id) || labelToUnitIdMap.get(label.unitId?.toString() || "");
                                            const totalUnitsInBox = packedItems.filter(p => 
                                                p.packingUnitId === unitFirestoreId || 
                                                p.packingUnitId === label.unitId?.toString() || 
                                                p.packingUnitId === label.id
                                            ).reduce((sum, p) => sum + p.quantity, 0);

                                            return (
                                                <TableRow key={`verificada-${label.id}`} className="bg-green-50/30">
                                                    <TableCell className="font-medium text-green-800 p-2 text-xs flex items-center gap-2">
                                                        <Check className="h-4 w-4 text-green-600 shrink-0" />
                                                        <span className="truncate">{label.id}</span>
                                                    </TableCell>
                                                    <TableCell className="text-center p-2 text-xs text-green-700">Caja {label.unitId}</TableCell>
                                                    <TableCell className="text-right p-2 text-xs font-bold text-green-700">{totalUnitsInBox} unds</TableCell>
                                                </TableRow>
                                            );
                                        })}
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
