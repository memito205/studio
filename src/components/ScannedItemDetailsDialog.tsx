/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScannedItem } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import EditScannedItemDialog from './EditScannedItemDialog';
import { Trash2, Edit, Package, Hash, Calendar, Box } from 'lucide-react';
import { format } from 'date-fns';


interface ScannedItemDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ScannedItem;
  onItemDeleted: (itemId: string) => void;
  onItemUpdated: () => void;
}

const ScannedItemDetailsDialog: React.FC<ScannedItemDetailsDialogProps> = ({
  open,
  onOpenChange,
  item,
  onItemDeleted,
  onItemUpdated,
}) => {
  const { toast } = useToast();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleDelete = async () => {
    if (item.id) {
      onItemDeleted(item.id);
      toast({ title: "Éxito", description: "Ítem eliminado." });
      onOpenChange(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'ID de ítem no proporcionado para eliminar.' });
    }
  };

  const DetailRow: React.FC<{ icon: React.ElementType, label: string, value: string }> = ({ icon: Icon, label, value }) => (
    <div className="flex items-center space-x-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="font-semibold">{label}:</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Detalles del Ítem Escaneado</DialogTitle>
          <DialogDescription>
            Información detallada del ítem con código de barras: {item.barcode || 'N/A'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
           <div className="space-y-3">
              <DetailRow icon={Package} label="Referencia" value={item.reference} />
              <DetailRow icon={Hash} label="Talla" value={item.talla} />
              <DetailRow icon={Box} label="Unidad de Empaque" value={item.packing_unit_id} />
              <DetailRow icon={Calendar} label="Fecha Escaneo" value={format(new Date(item.scanned_at), "PPP p")} />
           </div>
        </div>
        <DialogFooter className="flex justify-between w-full">
            <div className="flex gap-2">
                 <Button variant="outline" onClick={() => setIsEditOpen(true)}>
                    <Edit className="h-4 w-4 mr-2" /> Modificar Cantidad
                 </Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                        <Trash2 className="h-4 w-4 mr-2" /> Eliminar Lectura
                    </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
                        <AlertDialogDescription>
                        Esta acción eliminará permanentemente esta lectura del ítem. No se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <EditScannedItemDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        item={item}
        onSave={() => {
            onItemUpdated();
            onOpenChange(false); // Close the main dialog too
        }}
    />
    </>
  );
};

export default ScannedItemDetailsDialog;
