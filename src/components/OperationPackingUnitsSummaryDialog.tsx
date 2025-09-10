/** @jsxImportSource react */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { PackingUnit, ScannedItem, Location, PackedItem } from '@/types';
import { Eye } from 'lucide-react';
import PackingUnitDetailsDialog from '@/components/PackingUnitDetailsDialog';
import { getPackingUnitsForOperation, getScannedItemsByReception } from '@/app/actions';

interface OperationPackingUnitsSummaryDialogProps {
  receptionId: string;
  children: React.ReactNode;
}

interface PackingUnitSummary extends PackingUnit {
  totalItemsScanned: number;
}

export const OperationPackingUnitsSummaryDialog: React.FC<OperationPackingUnitsSummaryDialogProps> = ({
  receptionId,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [packingUnitSummaries, setPackingUnitSummaries] = useState<PackingUnitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [isPackingUnitDetailsDialogOpen, setIsPackingUnitDetailsDialogOpen] = useState(false);
  const [selectedUnitData, setSelectedUnitData] = useState<{ unit: PackingUnit; items: PackedItem[] } | null>(null);

  const fetchPackingUnitData = useCallback(async () => {
    setLoading(true);
    try {
      const unitsResult = await getPackingUnitsForOperation(receptionId);
      const scannedItemsResult = await getScannedItemsByReception(receptionId);
      
      const units = unitsResult.data || [];
      const scannedItems = scannedItemsResult.data || [];
      
      const itemCounts = new Map<string, number>();
      scannedItems.forEach(item => {
        const packingUnitFirestoreId = item.packing_unit_id;
        itemCounts.set(packingUnitFirestoreId, (itemCounts.get(packingUnitFirestoreId) || 0) + item.quantity);
      });

      const summaries: PackingUnitSummary[] = units.map(unit => ({
        ...unit,
        totalItemsScanned: itemCounts.get(unit.firestoreId) || 0,
      }));
      setPackingUnitSummaries(summaries.sort((a,b) => a.id - b.id));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Error al cargar el resumen de unidades de empaque.'});
      console.error('Error fetching packing unit summary:', error);
      setPackingUnitSummaries([]);
    } finally {
      setLoading(false);
    }
  }, [receptionId, toast]);

  useEffect(() => {
    if (open) {
      fetchPackingUnitData();
    }
  }, [open, fetchPackingUnitData]);

  const handleViewPackingUnitDetails = (unit: PackingUnit) => {
    // This is now synchronous as we pass all needed data
    setSelectedUnitData({
        unit,
        items: [] // The details dialog will now fetch its own item data
    });
    setIsPackingUnitDetailsDialogOpen(true);
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Unidades de Empaque de la Operación</DialogTitle>
            <DialogDescription>
              Resumen de las unidades de empaque para esta operación.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : packingUnitSummaries.length === 0 ? (
              <p className="text-center text-muted-foreground">No hay unidades de empaque para esta operación.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Número de Unidad</TableHead>
                      <TableHead>Cantidad de Ítems</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packingUnitSummaries.map((unit) => (
                      <TableRow key={unit.id}>
                        <TableCell className="font-medium">{unit.id}</TableCell>
                        <TableCell>{unit.totalItemsScanned}</TableCell>
                        <TableCell>{unit.status === 'open' ? 'Abierta' : 'Cerrada'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Ver Detalles de Unidad"
                            onClick={() => handleViewPackingUnitDetails(unit)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      {selectedUnitData && (
          <PackingUnitDetailsDialog
            open={isPackingUnitDetailsDialogOpen}
            onOpenChange={setIsPackingUnitDetailsDialogOpen}
            unitData={selectedUnitData}
            onAction={fetchPackingUnitData} // Re-fetch data on any action
          />
      )}
    </>
  );
};
