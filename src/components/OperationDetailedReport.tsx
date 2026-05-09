/** @jsxImportSource react */
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Search, Eye, ChevronDown, ChevronRight, Boxes } from 'lucide-react';
import type { ReceptionOperation, DetailedReportItem, ScannedItem, ItemNovelty, PackingUnit, Location, ProductDatabaseItem, AppUser, OperationPause, ProductivitySettings, ReceptionExpectedItem, PackedItem } from '@/types';
import { Badge } from '@/components/ui/badge';
import { exportToXlsx } from '@/services/export';
import { cn } from '@/lib/utils';
import { normalizeReceptionReference, normalizeReceptionSize } from '@/lib/receptionReference';
import PackingUnitDetailsDialog from '@/components/PackingUnitDetailsDialog';
import { showError } from '@/lib/toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'; // Import Tabs
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface OperationDetailedReportProps {
  operation: ReceptionOperation;
  allScannedItems: ScannedItem[];
  allNovelties: ItemNovelty[];
  allPackingUnits: PackingUnit[];
  allUsers: AppUser[];
  productivitySettings: ProductivitySettings | null;
  onRefresh: () => void;
  productDB: ProductDatabaseItem[];
  allLocations: Location[];
}

interface ConsolidatedReportItem {
    reference: string;
    productName: string;
    expectedQuantity: number;
    scannedQuantity: number;
    difference: number;
    location: string;
    packingUnitBreakdown: {
        unitId: string;
        unitFirestoreId: string;
        quantity: number;
        userId: string;
        userName: string;
        barcode: string;
        talla: string;
    }[];
}


interface PackingUnitSummary {
    id: number;
    firestoreId: string;
    totalItems: number;
    destination?: string;
}


export const OperationDetailedReport: React.FC<OperationDetailedReportProps> = ({
  operation,
  allScannedItems,
  allNovelties,
  allPackingUnits,
  allUsers,
  productivitySettings,
  onRefresh,
  productDB,
}) => {
  const [reportItems, setReportItems] = React.useState<DetailedReportItem[]>([]);
  const [consolidatedReportItems, setConsolidatedReportItems] = useState<ConsolidatedReportItem[]>([]);
  const [packingUnitSummaries, setPackingUnitSummaries] = useState<PackingUnitSummary[]>([]);

  const [filterText, setFilterText] = React.useState('');
  const [packingUnitFilter, setPackingUnitFilter] = React.useState({ start: '', end: '' });
  const [destinationFilter, setDestinationFilter] = useState('all');

  const [openRows, setOpenRows] = React.useState<Set<string>>(new Set());
  const [openConsolidatedRows, setOpenConsolidatedRows] = React.useState<Set<string>>(new Set());
  
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = React.useState(false);
  const [selectedUnitData, setSelectedUnitData] = React.useState<{ unit: PackingUnit; items: PackedItem[] } | null>(null);

  const userMap = React.useMemo(() => new Map(allUsers.map(u => [u.uid, u.displayName || u.email])), [allUsers]);
  const productDetailsMap = React.useMemo(() => new Map(productDB.map(p => [p.codigoBarras, p])), [productDB]);


  React.useEffect(() => {
    const packingUnitIdMap = new Map<string, number>(
        (allPackingUnits || []).map(unit => [unit.firestoreId, unit.id])
    );
    const expectedItemsMap = new Map<string, ReceptionExpectedItem>(
        (operation.expectedItems || []).map(item => [item.barcode, item])
    );
    const scannedDataMap = new Map<string, { total: number, breakdown: DetailedReportItem['packingUnitBreakdown'], productDetails: { item: string, reference: string, size: string } }>();
    allScannedItems.forEach(item => {
        let entry = scannedDataMap.get(item.barcode);
        if (!entry) {
            entry = { 
                total: 0, 
                breakdown: [],
                productDetails: {
                    item: item.item || 'N/A',
                    reference: item.reference ? normalizeReceptionReference(item.reference) : 'N/A',
                    size: item.talla ? normalizeReceptionSize(item.talla) : 'N/A'
                }
            };
            scannedDataMap.set(item.barcode, entry);
        }
        entry.total += item.quantity;
        entry.breakdown.push({
            unitId: String(packingUnitIdMap.get(item.packing_unit_id) || item.packing_unit_id),
            unitFirestoreId: item.packing_unit_id,
            quantity: item.quantity,
            userId: item.user_id,
            userName: userMap.get(item.user_id) || item.user_id
        });
    });
    
    const allBarcodes = new Set([
        ...Array.from(expectedItemsMap.keys()), 
        ...Array.from(scannedDataMap.keys())
    ]);

    const detailedItems: DetailedReportItem[] = Array.from(allBarcodes).map(barcode => {
        const expectedItem = expectedItemsMap.get(barcode);
        const scannedInfo = scannedDataMap.get(barcode);
        const scannedQty = scannedInfo?.total || 0;
        const expectedQty = expectedItem?.expected_quantity || 0;
        const difference = scannedQty - expectedQty;
        const noveltyText = [...new Set(allNovelties.filter(n => n.barcode === barcode).map(n => n.novelty_type))].join(', ') || 'N/A';
        
        const dbProductDetails = productDetailsMap.get(barcode);
        const fallbackDetails = scannedInfo?.productDetails || expectedItem;
        const rawRef =
          dbProductDetails?.referencia ||
          dbProductDetails?.reference ||
          (fallbackDetails as ReceptionExpectedItem)?.reference ||
          (scannedInfo?.productDetails.reference) ||
          '';
        const rawSize =
          dbProductDetails?.talla ||
          dbProductDetails?.size ||
          (fallbackDetails as ReceptionExpectedItem)?.size ||
          (scannedInfo?.productDetails.size) ||
          '';

        return {
            barcode: barcode,
            productName: dbProductDetails?.item || fallbackDetails?.item || 'Producto Inesperado',
            reference: rawRef ? normalizeReceptionReference(rawRef) : 'N/A',
            size: rawSize ? normalizeReceptionSize(rawSize) : 'N/A',
            expectedQuantity: expectedQty,
            scannedQuantity: scannedQty,
            difference: difference,
            noveltyType: noveltyText,
            packingUnitBreakdown: scannedInfo?.breakdown || [],
        };
    });
    setReportItems(detailedItems);

    const consolidatedMap = new Map<string, ConsolidatedReportItem>();
    
    const locationMapByReference = new Map<string, string>();
    if (operation.expectedItems) {
      operation.expectedItems.forEach(item => {
        if (item.reference && item.location) {
          locationMapByReference.set(normalizeReceptionReference(item.reference), item.location);
        }
      });
    }

    detailedItems.forEach(item => {
        // Sin referencia válida: no fusionar filas distintas por el mismo placeholder "N/A"
        const groupKey =
          item.reference !== 'N/A'
            ? item.reference
            : `_SIN_REF_${item.barcode}`;
        let entry = consolidatedMap.get(groupKey);

        if (!entry) {
            entry = {
                reference: item.reference,
                productName: item.productName,
                expectedQuantity: 0,
                scannedQuantity: 0,
                difference: 0,
                location:
                  item.reference !== 'N/A'
                    ? locationMapByReference.get(item.reference) || 'N/A'
                    : 'N/A',
                packingUnitBreakdown: []
            };
            consolidatedMap.set(groupKey, entry);
        }
        entry.expectedQuantity += item.expectedQuantity;
        entry.scannedQuantity += item.scannedQuantity;
        if (item.packingUnitBreakdown) {
            item.packingUnitBreakdown.forEach(bd => {
                entry!.packingUnitBreakdown.push({ ...bd, barcode: item.barcode, talla: item.size });
            });
        }
    });

    const consolidatedList = Array.from(consolidatedMap.values()).map(item => ({
        ...item,
        difference: item.scannedQuantity - item.expectedQuantity
    }));
    setConsolidatedReportItems(consolidatedList);

    const unitSummariesMap = new Map<number, PackingUnitSummary>();
    (allPackingUnits || []).forEach(unit => {
      unitSummariesMap.set(unit.id, {
        id: unit.id,
        firestoreId: unit.firestoreId,
        destination: unit.destination,
        totalItems: 0,
      });
    });
    allScannedItems.forEach(item => {
      const unitId = packingUnitIdMap.get(item.packing_unit_id);
      if (unitId && unitSummariesMap.has(unitId)) {
        unitSummariesMap.get(unitId)!.totalItems += item.quantity;
      }
    });
    setPackingUnitSummaries(Array.from(unitSummariesMap.values()));


}, [operation, allScannedItems, allNovelties, allPackingUnits, userMap, productDetailsMap]);


  const filteredReportItems = React.useMemo(() => {
    const searchText = filterText.toLowerCase();
    const startRange = packingUnitFilter.start ? parseInt(packingUnitFilter.start, 10) : -Infinity;
    const endRange = packingUnitFilter.end ? parseInt(packingUnitFilter.end, 10) : Infinity;
    const hasRangeFilter = packingUnitFilter.start || packingUnitFilter.end;

    return reportItems.filter(item => {
        const matchesText = !searchText || 
            item.reference.toLowerCase().includes(searchText) ||
            String(item.size).toLowerCase().includes(searchText) ||
            item.barcode.toLowerCase().includes(searchText) ||
            item.productName.toLowerCase().includes(searchText);

        const matchesUnit = !hasRangeFilter ||
            (item.packingUnitBreakdown && item.packingUnitBreakdown.some(unit => {
                const unitId = parseInt(unit.unitId, 10);
                if (isNaN(unitId)) return false;
                return unitId >= startRange && unitId <= endRange;
            }));

        return matchesText && matchesUnit;
    });
  }, [filterText, packingUnitFilter, reportItems]);
  
  const filteredConsolidatedItems = useMemo(() => {
    const searchText = filterText.toLowerCase();
    const startRange = packingUnitFilter.start ? parseInt(packingUnitFilter.start, 10) : -Infinity;
    const endRange = packingUnitFilter.end ? parseInt(packingUnitFilter.end, 10) : Infinity;
    const hasRangeFilter = packingUnitFilter.start || packingUnitFilter.end;

    return consolidatedReportItems.filter(item => {
        const matchesText = !searchText ||
            item.reference.toLowerCase().includes(searchText) ||
            item.productName.toLowerCase().includes(searchText) ||
            item.location.toLowerCase().includes(searchText);

        const matchesUnit = !hasRangeFilter ||
            (item.packingUnitBreakdown && item.packingUnitBreakdown.some(unit => {
                const unitId = parseInt(unit.unitId, 10);
                if (isNaN(unitId)) return false;
                return unitId >= startRange && unitId <= endRange;
            }));

        return matchesText && matchesUnit;
    });
  }, [filterText, packingUnitFilter, consolidatedReportItems]);
  
  const uniqueDestinations = useMemo(() => {
    const destinations = new Set((allPackingUnits || []).map(unit => unit.destination).filter(Boolean) as string[]);
    return ['all', ...Array.from(destinations).sort()];
  }, [allPackingUnits]);

  const filteredPackingUnitSummaries = useMemo(() => {
    const startRange = packingUnitFilter.start ? parseInt(packingUnitFilter.start, 10) : -Infinity;
    const endRange = packingUnitFilter.end ? parseInt(packingUnitFilter.end, 10) : Infinity;
    const hasRangeFilter = packingUnitFilter.start || packingUnitFilter.end;

    let filtered = [...packingUnitSummaries];
    
    if (destinationFilter !== 'all') {
        filtered = filtered.filter(unit => unit.destination === destinationFilter);
    }
    
    if (hasRangeFilter) {
      filtered = filtered.filter(unit => {
          const unitId = unit.id;
          return unitId >= startRange && unitId <= endRange;
      });
    }
    return filtered.sort((a, b) => a.id - b.id);
  }, [packingUnitFilter, packingUnitSummaries, destinationFilter]);

  const totalFilteredUnits = useMemo(() => {
    const uniqueUnitIds = new Set<string>();
    const startRange = packingUnitFilter.start ? parseInt(packingUnitFilter.start, 10) : -Infinity;
    const endRange = packingUnitFilter.end ? parseInt(packingUnitFilter.end, 10) : Infinity;
    const hasRangeFilter = packingUnitFilter.start || packingUnitFilter.end;

    filteredConsolidatedItems.forEach(item => {
        item.packingUnitBreakdown?.forEach(bd => {
            const unitId = parseInt(bd.unitId, 10);
            if (!isNaN(unitId)) {
                if (!hasRangeFilter || (unitId >= startRange && unitId <= endRange)) {
                    uniqueUnitIds.add(bd.unitId);
                }
            }
        });
    });
    return uniqueUnitIds.size;
  }, [filteredConsolidatedItems, packingUnitFilter]);


  const handleExportDetailed = () => {
    const dataToExport = filteredReportItems.map(item => ({
        'Referencia': item.reference,
        'Talla': item.size,
        'Cód. Barras': item.barcode,
        'Nombre Producto': item.productName,
        'Cant. Esperada': item.expectedQuantity,
        'Cant. Leída': item.scannedQuantity,
        'Diferencia': item.difference,
        'Estado': item.noveltyType,
    }));
    exportToXlsx(dataToExport, `Reporte_Detallado_${operation.rk_identifier}`);
  };

  const handleExportConsolidated = () => {
    const dataToExport = filteredConsolidatedItems.map(item => ({
        'Referencia': item.reference,
        'Nombre Producto': item.productName,
        'Ubicación': item.location,
        'Total Esperado': item.expectedQuantity,
        'Total Leído': item.scannedQuantity,
        'Diferencia Total': item.difference,
    }));
    exportToXlsx(dataToExport, `Reporte_Consolidado_${operation.rk_identifier}`);
  };

  const handleExportUnitSummary = () => {
    const dataToExport = filteredPackingUnitSummaries.map(unit => ({
        'Unidad de Empaque (Caja)': unit.id,
        'Destino': unit.destination || 'N/A',
        'Total Items': unit.totalItems,
    }));
    exportToXlsx(dataToExport, `Resumen_Cajas_${operation.rk_identifier}`);
  };

  const getStatusBadge = (difference: number, noveltyType: string) => {
    if (noveltyType !== 'N/A') {
        return <Badge variant="destructive">{noveltyType}</Badge>;
    }
    if (difference > 0) {
        return <Badge className="bg-blue-500 text-white hover:bg-blue-600">Sobrante</Badge>;
    }
    if (difference < 0) {
        return <Badge variant="destructive">Faltante</Badge>;
    }
    return <Badge variant="default">OK</Badge>;
  };
  
  const toggleRow = (barcode: string) => {
    setOpenRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(barcode)) {
        newSet.delete(barcode);
      } else {
        newSet.add(barcode);
      }
      return newSet;
    });
  };

  const toggleConsolidatedRow = (reference: string) => {
    setOpenConsolidatedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(reference)) {
        newSet.delete(reference);
      } else {
        newSet.add(reference);
      }
      return newSet;
    });
  };


  const handleViewPackingUnitDetails = (unitFirestoreId: string) => {
    const unit = (allPackingUnits || []).find(u => u.firestoreId === unitFirestoreId);
    if (unit) {
        const itemsForUnit = allScannedItems
            .filter(item => item.packing_unit_id === unit.firestoreId)
            .map(scannedItem => {
                const details = productDetailsMap.get(scannedItem.barcode);
                return {
                    item: {
                        ...(details || {}),
                        codigoBarras: scannedItem.barcode,
                        referencia: details?.reference || scannedItem.reference,
                        talla: details?.size || scannedItem.talla,
                        item: details?.name || scannedItem.item,
                    } as ProductDatabaseItem,
                    packedQuantity: scannedItem.quantity,
                    scannedItemId: scannedItem.id,
                };
            })
            .filter(item => item.item) as PackedItem[];

        setSelectedUnitData({ unit, items: itemsForUnit });
        setIsDetailsDialogOpen(true);
    } else {
        showError("No se pudo encontrar la unidad de empaque seleccionada.");
    }
  };


  return (
    <>
      <div className="flex flex-col h-full p-2 space-y-4">
        <Card>
            <CardHeader>
                <CardTitle>Reporte de Auditoría de Items</CardTitle>
                <CardDescription>
                    Resumen de ítems esperados vs. leídos. Expanda una fila para ver en qué unidades de empaque se encuentran.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="consolidated">
                  <TabsList>
                    <TabsTrigger value="detailed">Detalle por Talla</TabsTrigger>
                    <TabsTrigger value="consolidated">Consolidado por Referencia</TabsTrigger>
                    <TabsTrigger value="unit_summary">Resumen por Caja</TabsTrigger>
                  </TabsList>
                  <TabsContent value="detailed">
                    <div className="flex flex-col sm:flex-row gap-4 my-4">
                        <div className="flex-grow">
                            <Label htmlFor="text-filter-detailed">Filtro General</Label>
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                              <Input
                                  id="text-filter-detailed"
                                  placeholder="Filtrar por Referencia, Talla, Cód. Barras, etc."
                                  value={filterText}
                                  onChange={(e) => setFilterText(e.target.value)}
                                  className="pl-10"
                              />
                            </div>
                        </div>
                        <div className="flex-grow">
                            <Label htmlFor="unit-filter-start">Filtrar por Rango de Cajas</Label>
                             <div className="flex items-center gap-2">
                                <Input
                                    id="unit-filter-start"
                                    type="number"
                                    placeholder="Desde"
                                    value={packingUnitFilter.start}
                                    onChange={(e) => setPackingUnitFilter(prev => ({...prev, start: e.target.value}))}
                                    className="w-full"
                                />
                                <span className="text-muted-foreground">-</span>
                                <Input
                                    id="unit-filter-end"
                                    type="number"
                                    placeholder="Hasta"
                                    value={packingUnitFilter.end}
                                    onChange={(e) => setPackingUnitFilter(prev => ({...prev, end: e.target.value}))}
                                    className="w-full"
                                />
                            </div>
                        </div>
                         <div className="self-end flex items-center gap-4">
                            <Badge variant="secondary" className="text-sm py-2">Cajas Filtradas: {totalFilteredUnits}</Badge>
                            <Button onClick={handleExportDetailed} variant="outline" className="w-full sm:w-auto">
                                <Download className="mr-2 h-4 w-4" />
                                Exportar Detalle
                            </Button>
                        </div>
                    </div>
                    <div className="flex-grow overflow-y-auto border rounded-md max-h-[calc(100vh-450px)]">
                      <Table>
                          <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                              <TableHead className="w-12"></TableHead>
                              <TableHead>Referencia</TableHead>
                              <TableHead>Talla</TableHead>
                              <TableHead>Cód. Barras</TableHead>
                              <TableHead className="text-center">Esperado</TableHead>
                              <TableHead className="text-center">Leído</TableHead>
                              <TableHead className="text-center">Diferencia</TableHead>
                              <TableHead>Estado</TableHead>
                          </TableRow>
                          </TableHeader>
                          <TableBody>
                          {filteredReportItems.map((item) => (
                              <React.Fragment key={item.barcode}>
                                  <TableRow>
                                      <TableCell>
                                      {item.packingUnitBreakdown && item.packingUnitBreakdown.length > 0 && (
                                          <Button variant="ghost" size="icon" onClick={() => toggleRow(item.barcode)}>
                                          {openRows.has(item.barcode) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                          <span className="sr-only">Toggle details</span>
                                          </Button>
                                      )}
                                      </TableCell>
                                      <TableCell className="font-medium">{item.reference}</TableCell>
                                      <TableCell>{item.size}</TableCell>
                                      <TableCell>{item.barcode}</TableCell>
                                      <TableCell className="text-center">{item.expectedQuantity}</TableCell>
                                      <TableCell className="text-center font-semibold">{item.scannedQuantity}</TableCell>
                                      <TableCell className={`text-center font-bold ${item.difference !== 0 ? (item.difference > 0 ? 'text-blue-500' : 'text-orange-500') : ''}`}>
                                      {item.difference > 0 ? `+${item.difference}`: item.difference}
                                      </TableCell>
                                      <TableCell>
                                          {getStatusBadge(item.difference, item.noveltyType)}
                                      </TableCell>
                                  </TableRow>
                                  {openRows.has(item.barcode) && (
                                      <TableRow>
                                          <TableCell colSpan={8} className="p-0">
                                              <div className="p-4 bg-muted/50">
                                                  <h4 className="font-semibold mb-2">Trazabilidad en Unidades de Empaque</h4>
                                                  <Table>
                                                  <TableHeader>
                                                      <TableRow>
                                                      <TableHead>Unidad</TableHead>
                                                      <TableHead>Cantidad</TableHead>
                                                      <TableHead>Usuario</TableHead>
                                                      <TableHead className="text-right">Acciones</TableHead>
                                                      </TableRow>
                                                  </TableHeader>
                                                  <TableBody>
                                                      {item.packingUnitBreakdown
                                                      ?.filter(bd => {
                                                        const unitId = parseInt(bd.unitId, 10);
                                                        if (isNaN(unitId)) return false;
                                                        const startRange = packingUnitFilter.start ? parseInt(packingUnitFilter.start, 10) : -Infinity;
                                                        const endRange = packingUnitFilter.end ? parseInt(packingUnitFilter.end, 10) : Infinity;
                                                        const hasRangeFilter = packingUnitFilter.start || packingUnitFilter.end;
                                                        return !hasRangeFilter || (unitId >= startRange && unitId <= endRange);
                                                      })
                                                      .sort((a,b) => Number(a.unitId) - Number(b.unitId))
                                                      .map((bd, i) => (
                                                      <TableRow key={i}>
                                                          <TableCell>{bd.unitId}</TableCell>
                                                          <TableCell>{bd.quantity}</TableCell>
                                                          <TableCell>{bd.userName}</TableCell>
                                                          <TableCell className="text-right">
                                                              <Button variant="ghost" size="sm" onClick={() => handleViewPackingUnitDetails(bd.unitFirestoreId)}>
                                                                  <Eye className="mr-2 h-4 w-4" /> Ver/Editar
                                                              </Button>
                                                          </TableCell>
                                                      </TableRow>
                                                      ))}
                                                  </TableBody>
                                                  </Table>
                                              </div>
                                          </TableCell>
                                      </TableRow>
                                  )}
                              </React.Fragment>
                          ))}
                          {filteredReportItems.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No hay ítems que coincidan con los filtros.</TableCell>
                            </TableRow>
                          )}
                          </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                  <TabsContent value="consolidated">
                     <div className="flex flex-col sm:flex-row gap-4 my-4">
                        <div className="flex-grow">
                            <Label htmlFor="text-filter-consolidated">Filtro General</Label>
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                              <Input
                                  id="text-filter-consolidated"
                                  placeholder="Filtrar por Referencia, Producto o Ubicación..."
                                  value={filterText}
                                  onChange={(e) => setFilterText(e.target.value)}
                                  className="pl-10"
                              />
                            </div>
                        </div>
                         <div className="flex-grow">
                            <Label htmlFor="unit-filter-start-consolidated">Filtrar por Rango de Cajas</Label>
                             <div className="flex items-center gap-2">
                                <Input
                                    id="unit-filter-start-consolidated"
                                    type="number"
                                    placeholder="Desde"
                                    value={packingUnitFilter.start}
                                    onChange={(e) => setPackingUnitFilter(prev => ({...prev, start: e.target.value}))}
                                    className="w-full"
                                />
                                <span className="text-muted-foreground">-</span>
                                <Input
                                    id="unit-filter-end-consolidated"
                                    type="number"
                                    placeholder="Hasta"
                                    value={packingUnitFilter.end}
                                    onChange={(e) => setPackingUnitFilter(prev => ({...prev, end: e.target.value}))}
                                    className="w-full"
                                />
                            </div>
                        </div>
                        <div className="self-end flex items-center gap-4">
                            <Badge variant="secondary" className="text-sm py-2">Cajas Filtradas: {totalFilteredUnits}</Badge>
                            <Button onClick={handleExportConsolidated} variant="outline" className="w-full sm:w-auto">
                                <Download className="mr-2 h-4 w-4" />
                                Exportar Consolidado
                            </Button>
                        </div>
                    </div>
                    <div className="flex-grow overflow-y-auto border rounded-md max-h-[calc(100vh-450px)]">
                      <Table>
                          <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow>
                                <TableHead className="w-12"></TableHead>
                                <TableHead>Referencia</TableHead>
                                <TableHead>Producto</TableHead>
                                <TableHead>Ubicación</TableHead>
                                <TableHead className="text-center">Total Esperado</TableHead>
                                <TableHead className="text-center">Total Leído</TableHead>
                                <TableHead className="text-center">Diferencia Total</TableHead>
                                <TableHead>Estado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                              {filteredConsolidatedItems.map((item) => {
                                const startRange = packingUnitFilter.start ? parseInt(packingUnitFilter.start, 10) : -Infinity;
                                const endRange = packingUnitFilter.end ? parseInt(packingUnitFilter.end, 10) : Infinity;
                                const hasRangeFilter = packingUnitFilter.start || packingUnitFilter.end;

                                const groupedTraceability = Object.values((item.packingUnitBreakdown || [])
                                .filter(bd => {
                                  if (!hasRangeFilter) return true;
                                  const unitId = parseInt(bd.unitId, 10);
                                  if (isNaN(unitId)) return false;
                                  return unitId >= startRange && unitId <= endRange;
                                })
                                .reduce((acc, bd) => {
                                  const key = `${bd.unitId}|${bd.userId}`;
                                  if (!acc[key]) {
                                    acc[key] = {
                                      unitId: bd.unitId,
                                      unitFirestoreId: bd.unitFirestoreId,
                                      userName: bd.userName,
                                      quantity: 0,
                                    };
                                  }
                                  acc[key].quantity += bd.quantity;
                                  return acc;
                                }, {} as { [key: string]: { unitId: string; unitFirestoreId: string; userName: string; quantity: number } }));

                                return (
                                <React.Fragment key={item.reference}>
                                  <TableRow>
                                    <TableCell>
                                        {item.packingUnitBreakdown && item.packingUnitBreakdown.length > 0 && (
                                            <Button variant="ghost" size="icon" onClick={() => toggleConsolidatedRow(item.reference)}>
                                            {openConsolidatedRows.has(item.reference) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            <span className="sr-only">Toggle details</span>
                                            </Button>
                                        )}
                                    </TableCell>
                                    <TableCell className="font-medium">{item.reference}</TableCell>
                                    <TableCell>{item.productName}</TableCell>
                                    <TableCell>{item.location}</TableCell>
                                    <TableCell className="text-center">{item.expectedQuantity}</TableCell>
                                    <TableCell className="text-center font-semibold">{item.scannedQuantity}</TableCell>
                                    <TableCell className={`text-center font-bold ${item.difference !== 0 ? (item.difference > 0 ? 'text-blue-500' : 'text-orange-500') : ''}`}>
                                      {item.difference > 0 ? `+${item.difference}` : item.difference}
                                    </TableCell>
                                    <TableCell>
                                      {getStatusBadge(item.difference, 'N/A')}
                                    </TableCell>
                                  </TableRow>
                                  {openConsolidatedRows.has(item.reference) && (
                                     <TableRow>
                                          <TableCell colSpan={8} className="p-0">
                                              <div className="p-4 bg-muted/50">
                                                  <h4 className="font-semibold mb-2">Trazabilidad para Referencia: {item.reference}</h4>
                                                  <Table>
                                                  <TableHeader>
                                                      <TableRow>
                                                          <TableHead>Unidad</TableHead>
                                                          <TableHead>Cantidad</TableHead>
                                                          <TableHead>Usuario</TableHead>
                                                          <TableHead className="text-right">Acciones</TableHead>
                                                      </TableRow>
                                                  </TableHeader>
                                                  <TableBody>
                                                      {groupedTraceability.sort((a,b) => Number(a.unitId) - Number(b.unitId)).map((bd, i) => (
                                                      <TableRow key={i}>
                                                          <TableCell>{bd.unitId}</TableCell>
                                                          <TableCell>{bd.quantity}</TableCell>
                                                          <TableCell>{bd.userName}</TableCell>
                                                          <TableCell className="text-right">
                                                              <Button variant="ghost" size="sm" onClick={() => handleViewPackingUnitDetails(bd.unitFirestoreId)}>
                                                                  <Eye className="mr-2 h-4 w-4" /> Ver/Editar
                                                              </Button>
                                                          </TableCell>
                                                      </TableRow>
                                                      ))}
                                                  </TableBody>
                                                  </Table>
                                              </div>
                                          </TableCell>
                                      </TableRow>
                                  )}
                                </React.Fragment>
                               )})}
                              {filteredConsolidatedItems.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No hay ítems que coincidan con los filtros.</TableCell>
                                </TableRow>
                              )}
                          </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                   <TabsContent value="unit_summary">
                    <div className="flex flex-wrap items-end gap-4 my-4">
                        <div className="flex-grow">
                             <Label htmlFor="unit-filter-summary">Filtrar por Rango de Cajas</Label>
                             <div className="flex items-center gap-2 mt-1">
                                <Input
                                    id="unit-filter-start-summary"
                                    type="number"
                                    placeholder="Desde"
                                    value={packingUnitFilter.start}
                                    onChange={(e) => setPackingUnitFilter(prev => ({...prev, start: e.target.value}))}
                                    className="w-24"
                                />
                                <span className="text-muted-foreground">-</span>
                                <Input
                                    id="unit-filter-end-summary"
                                    type="number"
                                    placeholder="Hasta"
                                    value={packingUnitFilter.end}
                                    onChange={(e) => setPackingUnitFilter(prev => ({...prev, end: e.target.value}))}
                                    className="w-24"
                                />
                            </div>
                        </div>
                        <div className="flex-grow">
                          <Label htmlFor="destination-filter">Filtrar por Destino</Label>
                          <Select value={destinationFilter} onValueChange={setDestinationFilter}>
                            <SelectTrigger id="destination-filter" className="w-full sm:w-[200px] mt-1">
                              <SelectValue placeholder="Seleccionar destino..." />
                            </SelectTrigger>
                            <SelectContent>
                              {uniqueDestinations.map(dest => (
                                <SelectItem key={dest} value={dest}>
                                  {dest === 'all' ? 'Todos los Destinos' : (dest || 'Sin Destino')}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-4">
                             <Badge variant="secondary" className="text-sm py-2">Cajas Filtradas: {filteredPackingUnitSummaries.length}</Badge>
                            <Button onClick={handleExportUnitSummary} variant="outline">
                                <Download className="mr-2 h-4 w-4" />
                                Exportar Resumen
                            </Button>
                        </div>
                    </div>
                     <div className="flex-grow overflow-y-auto border rounded-md max-h-[calc(100vh-450px)]">
                       <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead>Unidad de Empaque (Caja)</TableHead>
                                    <TableHead>Destino</TableHead>
                                    <TableHead className="text-right">Total Items</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPackingUnitSummaries.map(unit => (
                                    <TableRow key={unit.id}>
                                        <TableCell className="font-medium">{unit.id}</TableCell>
                                        <TableCell>{unit.destination || 'N/A'}</TableCell>
                                        <TableCell className="text-right font-semibold">{unit.totalItems}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => handleViewPackingUnitDetails(unit.firestoreId)}>
                                                <Eye className="mr-2 h-4 w-4" /> Ver/Editar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                       </Table>
                    </div>
                  </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
      </div>
       {selectedUnitData && (
        <PackingUnitDetailsDialog
            open={isDetailsDialogOpen}
            onOpenChange={setIsDetailsDialogOpen}
            unitData={selectedUnitData}
            onAction={onRefresh} // Using a generic onAction to trigger parent refresh
        />
      )}
    </>
  );
};
