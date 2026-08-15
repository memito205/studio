/** @jsxImportSource react */
import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ProductDatabaseItem } from '@/types';

interface UnexpectedItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (product: ProductDatabaseItem) => void;
  item: ProductDatabaseItem;
}

export const UnexpectedItemDialog: React.FC<UnexpectedItemDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  item,
}) => {
  if (!isOpen) return null;

  const referencia = item.referencia || item.reference || 'N/A';
  const talla = item.talla || item.size || 'N/A';

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ítem Fuera de la Operación</AlertDialogTitle>
          <AlertDialogDescription>
            El producto{' '}
            <span className="font-bold">
              {referencia} ({talla})
            </span>{' '}
            con código <span className="font-mono">{item.codigoBarras}</span>{' '}
            no se esperaba en esta orden de recepción
            {item.location ? (
              <>
                {' '}(ubicación sugerida: <span className="font-semibold">{item.location}</span>)
              </>
            ) : null}
            . ¿Deseas agregarlo de todas formas? Esto registrará automáticamente una novedad.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(item)}>
            Sí, Agregar y Registrar Novedad
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
