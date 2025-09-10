

/** @jsxImportSource react */
import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Eye, Boxes, AlertCircle, Edit } from 'lucide-react';
import type { PackingUnit, ProductDatabaseItem, ScannedItem } from '@/types'; // Adjusted types
import EditScannedItemDialog from '@/components/EditScannedItemDialog'; // Import the new dialog
import ScannedItemDetailsDialog from './ScannedItemDetailsDialog';
import RegisterNoveltyDialog from './RegisterNoveltyDialog';
import PackingUnitDetailsDialog from './PackingUnitDetailsDialog';


interface ReceptionScannedItemsListProps {
  receptionId: string;
  scannedItems: ScannedItem[];
  packingUnits: PackingUnit[];
  onItemDeleted: (itemId: string) => void;
  onItemUpdated: () => void;
  onNoveltyRegistered: () => void;
  totalScannedQuantity: number;
  packingUnitIdMap: Map<string, number>; // Propiedad añadida para el mapeo de IDs
  displayLimit?: number;
}

export const ReceptionScannedItemsList: React.FC<ReceptionScannedItemsListProps> = ({
  receptionId,
  scannedItems,
  packingUnits,
  onItemDeleted,
  onItemUpdated,
  onNoveltyRegistered,
  totalScannedQuantity,
  packingUnitIdMap, // Usar esta propiedad
  displayLimit = 5,
}) => {
  const { toast } = useToast();
  const [isItemDetailsDialogOpen, setIsItemDetailsDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScannedItem | null>(null);

  const [isPackingUnitDetailsDialogOpen, setIsPackingUnitDetailsDialogOpen] = useState(false);
  const [selectedPackingUnitData, setSelectedPackingUnitData] = useState<{ unit: PackingUnit; items: any[] } | null>(null);

  const [isRegisterNoveltyDialogOpen, setIsRegisterNoveltyDialogOpen] = useState(false);
  const [noveltyContext, setNoveltyContext] = useState<{ scannedItemId?: string; barcode?: string } | null>(null);
  
  const [isEditItemDialogOpen, setIsEditItemDialogOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<ScannedItem | null>(null);


  const handleViewItemDetails = (item: ScannedItem) => {
    setSelectedItem(item);
    setIsItemDetailsDialogOpen(true);
  };

  const handleViewPackingUnitDetails = (firestoreUnitId: string) => {
    const unit = packingUnits.find(u => u.firestoreId === firestoreUnitId);
    if (unit) {
        const itemsInUnit = scannedItems
            .filter(item => item.packing_unit_id === firestoreUnitId)
            .map(item => ({
                item: { // Create a ProductDatabaseItem-like structure
                    codigoBarras: item.barcode,
                    referencia: item.reference,
                    talla: item.talla,
                    item: item.item,
                },
                packedQuantity: item.quantity,
                scannedItemId: item.id
            }));
      setSelectedPackingUnitData({ unit, items: itemsInUnit });
      setIsPackingUnitDetailsDialogOpen(true);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: `Unidad de empaque con ID ${firestoreUnitId} no encontrada.` });
    }
  };


  const handleRegisterNovelty = (item: ScannedItem) => {
    setNoveltyContext({ scannedItemId: item.id, barcode: item.barcode });
    setIsRegisterNoveltyDialogOpen(true);
  };
  
  const handleEditItem = (item: ScannedItem) => {
    setItemToEdit(item);
    setIsEditItemDialogOpen(true);
  };

  const handleItemDeletedInDialog = () => {
      onItemDeleted(selectedItem?.id || ''); // Call parent handler
      setIsPackingUnitDetailsDialogOpen(false); // Close the dialog
  }
  
  const handleItemUpdatedInDialog = () => {
      onItemUpdated();
      setIsPackingUnitDetailsDialogOpen(false);
  }


  const itemsToDisplay = scannedItems.slice(0, displayLimit);
  const hasMoreItems = scannedItems.length > displayLimit;

  return (
    <div className="border-t pt-4 mt-4">
      {itemToEdit && (
        <EditScannedItemDialog
          item={itemToEdit}
          open={isEditItemDialogOpen}
          onOpenChange={setIsEditItemDialogOpen}
          onSave={onItemUpdated}
        />
      )}
      {selectedItem && (
        <ScannedItemDetailsDialog
            open={isItemDetailsDialogOpen}
            onOpenChange={setIsItemDetailsDialogOpen}
            item={selectedItem}
            onItemDeleted={onItemDeleted}
            onItemUpdated={onItemUpdated}
        />
      )}
      {isRegisterNoveltyDialogOpen && noveltyContext && (
        <RegisterNoveltyDialog
            open={isRegisterNoveltyDialogOpen}
            onOpenChange={setIsRegisterNoveltyDialogOpen}
            receptionId={receptionId}
            scannedItemId={noveltyContext?.scannedItemId}
            barcode={noveltyContext?.barcode}
            onNoveltyRegistered={onNoveltyRegistered}
        />
      )}
      {selectedPackingUnitData && (
        <PackingUnitDetailsDialog
          open={isPackingUnitDetailsDialogOpen}
          onOpenChange={setIsPackingUnitDetailsDialogOpen}
          unitData={selectedPackingUnitData}
          onAction={() => {
            onItemUpdated(); // A generic action to trigger refresh
            setIsPackingUnitDetailsDialogOpen(false);
          }}
        />
       )}


      <h3 className="text-xl font-semibold mb-2">Items Leídos ({totalScannedQuantity})</h3>
      {scannedItems.length === 0 ? (
        <p className="text-muted-foreground">No hay ítems leídos aún.</p>
      ) : (
        <div className="max-h-60 overflow-y-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código de Barras</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsToDisplay.map((item) => {
                const firestoreUnitId = item.packing_unit_id;
                const sequentialUnitId = packingUnitIdMap.get(firestoreUnitId) || 'N/A'; // Usar el mapa para la traducción
                return (
                  <TableRow key={item.id}>
                    <TableCell>{item.barcode}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {sequentialUnitId}
                        {firestoreUnitId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Ver Detalles de Unidad de Empaque"
                            onClick={() => handleViewPackingUnitDetails(firestoreUnitId)}
                          >
                            <Boxes className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end space-x-1">
                          {item.id && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Registrar Novedad"
                                onClick={() => handleRegisterNovelty(item)}
                              >
                                <AlertCircle className="h-4 w-4 text-orange-500" />
                              </Button>
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Editar Ítem"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Ver Detalles de Ítem"
                                onClick={() => handleViewItemDetails(item)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {hasMoreItems && (
        <div className="text-center mt-4 text-sm text-muted-foreground">
          Mostrando los últimos {displayLimit} ítems de {scannedItems.length} registros distintos.
        </div>
      )}
    </div>
  );
};

export default ReceptionScannedItemsList;
