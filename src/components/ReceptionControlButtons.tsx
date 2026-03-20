
"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ArrowLeft, Box, Pause, Play } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { Label } from './ui/label';
import { Input } from './ui/input';

interface ReceptionControlButtonsProps {
  onBack: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onClosePackingUnit: (destination?: string) => void;
  hasActivePackingUnit: boolean;
  isOperationPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  totalItemsInActiveUnit: number; // Nueva propiedad
}

export const ReceptionControlButtons: React.FC<ReceptionControlButtonsProps> = ({
  onBack,
  onCancel,
  onComplete,
  onClosePackingUnit,
  hasActivePackingUnit,
  isOperationPaused,
  onPause,
  onResume,
  totalItemsInActiveUnit, // Usar la nueva propiedad
}) => {
  const { role } = useAuth();
  const isPrivilegedUser = role === 'admin';
  const [destination, setDestination] = React.useState('');

  const handleConfirmClose = () => {
    onClosePackingUnit(destination);
    setDestination(''); // Reset after confirming
  };

  return (
    <div className="mt-6 flex flex-wrap justify-between gap-4">
      <Button onClick={onBack} className="w-full sm:w-auto flex-grow" variant="outline">
        <ArrowLeft className="h-4 w-4 mr-2" /> Volver a Operaciones
      </Button>

      {isOperationPaused ? (
        <Button onClick={onResume} className="w-full sm:w-auto flex-grow" variant="default">
          <Play className="h-4 w-4 mr-2" /> Reanudar Operación
        </Button>
      ) : (
        <Button onClick={onPause} className="w-full sm:w-auto flex-grow" variant="secondary">
          <Pause className="h-4 w-4 mr-2" /> Pausar Operación
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="secondary" className="w-full sm:w-auto flex-grow" disabled={!hasActivePackingUnit || isOperationPaused}>
            <Box className="h-4 w-4 mr-2" /> Cerrar Unidad de Empaque
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro de cerrar la unidad de empaque actual?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción cerrará la unidad de empaque activa. El siguiente escaneo creará una nueva unidad.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">Total de Ítems en esta Unidad:</p>
            <p className="text-7xl font-bold text-primary">{totalItemsInActiveUnit}</p>
          </div>
          <div className="py-4">
            <Label htmlFor="destination-input">Destino (Opcional)</Label>
            <Input
              id="destination-input"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Ej: DAFITI, BODEGA..."
              className="mt-2"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>No, mantener abierta</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>Sí, cerrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="w-full sm:w-auto flex-grow" disabled={isOperationPaused || !isPrivilegedUser}>Cancelar Operación</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción cancelará la operación de recepción. No podrás seguir escaneando ítems para esta operación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, mantener</AlertDialogCancel>
            <AlertDialogAction onClick={onCancel}>Sí, cancelar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button className="w-full sm:w-auto flex-grow" disabled={isOperationPaused || !isPrivilegedUser}>Finalizar Operación</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro de finalizar la operación?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción marcará la operación como completada. No podrás seguir escaneando ítems para esta operación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, seguir escaneando</AlertDialogCancel>
            <AlertDialogAction onClick={onComplete}>Sí, finalizar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
