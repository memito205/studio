/** @jsxImportSource react */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ScannedItem, PackingUnit, ProductDatabaseItem, PackedItem } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Edit, Trash2, RotateCcw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import EditScannedItemDialog from '@/components/EditScannedItemDialog';
import { bulkDeleteScannedItems, deletePackingUnitAndContents } from '@/app/reception/actions';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { useAuth } from '@/hooks/use-auth-context';


interface PackingUnitDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitData: {
      unit: PackingUnit;
      items: PackedItem[];
  } | null;
  onAction: () => void; // Generic callback to signal parent to refresh
}

const PackingUnitDetailsDialog: React.FC<PackingUnitDetailsDialogProps> = ({
  open,
  onOpenChange,
  unitData,
  onAction,
}) => {
  const { toast } = useToast();
  const { role } = useAuth();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PackedItem[]>([]);
  const [itemToEdit, setItemToEdit] = useState<PackedItem | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Data is now passed via props, no need to fetch.
  useEffect(() => {
    if (open && unitData) {
      setItems(unitData.items || []);
      setSelectedItemIds(new Set());
    }
  }, [open, unitData]);


  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(items.map(item => item.scannedItemId).filter(Boolean) as string[]);
      setSelectedItemIds(allIds);
    } else {
      setSelectedItemIds(new Set());
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    setSelectedItemIds(prev => {
      const newSelection = new Set(prev);
      if (checked) newSelection.add(itemId); else newSelection.delete(itemId);
      return newSelection;
    });
  };

  const handleEditClick = (item: PackedItem) => {
    setItemToEdit(item); 
    setIsEditOpen(true);
  };
  
  const handleDeleteUnit = async () => {
    if (!unitData?.unit.firestoreId) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se puede eliminar una unidad sin ID.' });
      return;
    }
    setLoading(true);
    const result = await deletePackingUnitAndContents(unitData.unit.firestoreId);
    if (result.success) {
      toast({ title: 'Éxito', description: `La unidad #${unitData.unit.id} y su contenido han sido eliminados.` });
      onAction(); // Refresh parent
      onOpenChange(false); // Close dialog
    } else {
      toast({ variant: 'destructive', title: 'Error al Eliminar', description: result.error });
    }
    setLoading(false);
  };


  const handleDeleteSelectedItem = async () => {
    if (selectedItemIds.size === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'No hay ítems seleccionados para eliminar.' });
      return;
    }
    const result = await bulkDeleteScannedItems(Array.from(selectedItemIds));
    if (result.success) {
      toast({ title: "Éxito", description: `${selectedItemIds.size} ítem(s) eliminado(s).` });
      onAction(); // Signal parent to refresh its state as well
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
  };
  
  const totalQuantityInUnit = items.reduce((sum, item) => sum + item.packedQuantity, 0);
  const isAllSelected = items.length > 0 && selectedItemIds.size === items.length;
  
  const handleDialogClose = () => {
    onAction(); // Ensure parent refreshes when this dialog is closed
    onOpenChange(false);
  }

  const isEditable = unitData?.unit.status === 'open' || role === 'admin';

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalles de Unidad de Empaque: #{unitData?.unit.id}</DialogTitle>
            <DialogDescription>
              Información detallada de la unidad y los ítems contenidos. Cantidad Total: {totalQuantityInUnit}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-center text-muted-foreground">No hay ítems escaneados en esta unidad.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">
                        <Checkbox
                          checked={isAllSelected}
                          onCheckedChange={(checked) => handleSelectAll(!!checked)}
                          aria-label="Seleccionar todos los ítems"
                          disabled={!isEditable}
                        />
                      </TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Talla</TableHead>
                      <TableHead>Cód. Leído</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead className="text-right">Acciones Ind.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((packedItem, index) => {
                      const isSelected = selectedItemIds.has(packedItem.scannedItemId || '');
                      return (
                      <TableRow key={`${packedItem.scannedItemId}-${index}`} data-state={isSelected ? "selected" : ""}>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => handleSelectItem(packedItem.scannedItemId || '', !!checked)}
                              aria-label={`Seleccionar ítem ${packedItem.item.codigoBarras}`}
                              disabled={!isEditable}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{packedItem.item.item || 'N/A'}</TableCell>
                          <TableCell>{packedItem.item.referencia || 'N/A'}</TableCell>
                          <TableCell>{packedItem.item.talla || 'N/A'}</TableCell>
                          <TableCell className="font-mono text-xs">{packedItem.item.codigoBarras}</TableCell>
                          <TableCell>{packedItem.packedQuantity}</TableCell>
                          <TableCell className="text-right flex items-center justify-end space-x-1">
                            <Button variant="ghost" size="icon" title="Editar cantidad" onClick={() => handleEditClick(packedItem)} disabled={!isEditable}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                    )})}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
            <div className="flex gap-2">
              <AlertDialog>
                 <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={selectedItemIds.size === 0 || !isEditable}>
                        <Trash2 className="h-4 w-4 mr-2"/>
                        Eliminar Ítems ({selectedItemIds.size})
                    </Button>
                 </AlertDialogTrigger>
                 <AlertDialogContent>
                    <AlertDialogHeader>
                       <AlertDialogTitle>¿Está absolutamente seguro?</AlertDialogTitle>
                       <AlertDialogDescription>
                          Esta acción eliminará permanentemente los {selectedItemIds.size} ítems seleccionados. No se puede deshacer.
                       </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                       <AlertDialogCancel>Cancelar</AlertDialogCancel>
                       <AlertDialogAction onClick={handleDeleteSelectedItem}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                 </AlertDialogContent>
              </AlertDialog>
               <AlertDialog>
                 <AlertDialogTrigger asChild>
                    <Button variant="destructive" outline disabled={!isEditable}>
                        <Trash2 className="h-4 w-4 mr-2"/>
                        Eliminar Caja Completa
                    </Button>
                 </AlertDialogTrigger>
                 <AlertDialogContent>
                    <AlertDialogHeader>
                       <AlertDialogTitle>¿Eliminar esta caja y todo su contenido?</AlertDialogTitle>
                       <AlertDialogDescription>
                          Esta acción es permanente y eliminará la caja #{unitData?.unit.id} y sus {totalQuantityInUnit} ítems. No se puede deshacer.
                       </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                       <AlertDialogCancel>Cancelar</AlertDialogCancel>
                       <AlertDialogAction onClick={handleDeleteUnit}>Sí, Eliminar Caja</AlertDialogAction>
                    </AlertDialogFooter>
                 </AlertDialogContent>
              </AlertDialog>
              {role === 'admin' && unitData?.unit.status === 'closed' && (
                <Button variant="outline" onClick={() => {}}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Reabrir Caja
                </Button>
              )}
            </div>
            <Button onClick={handleDialogClose}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {itemToEdit && (
        <EditScannedItemDialog
            open={isEditOpen}
            onOpenChange={setIsEditOpen}
            item={itemToEdit as ScannedItem} 
            onSave={() => {
              onAction(); 
              setIsEditOpen(false);
            }}
        />
       )}
    </>
  );
};

export default PackingUnitDetailsDialog;
