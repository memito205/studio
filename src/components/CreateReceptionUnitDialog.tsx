
"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import { PlusCircle, Loader2 } from 'lucide-react';

interface CreateReceptionUnitDialogProps {
  receptionId: string;
  onUnitCreated: () => void;
  children?: React.ReactNode;
}

export const CreateReceptionUnitDialog: React.FC<CreateReceptionUnitDialogProps> = ({
  receptionId,
  onUnitCreated,
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const handleCreateUnit = async () => {
    setIsCreating(true);
    try {
      if (!user) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo obtener el ID del usuario. Por favor, inicia sesión de nuevo.' });
        setIsCreating(false);
        return;
      }
      
      // Placeholder for a future server action
      // const result = await createReceptionUnit({ receptionId, userId: user.uid });
      // For now, we simulate a success
      const result = { success: true, message: 'Unidad de empaque creada (simulado).' }; 

      if (result.success) {
        toast({ title: 'Éxito', description: result.message });
        onUnitCreated();
        setOpen(false);
      } else {
        // toast({ variant: 'destructive', title: 'Error', description: result.error });
      }

    } catch (error) {
      toast({ variant: 'destructive', title: 'Error inesperado', description: 'Ocurrió un error al crear la unidad.' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" /> Crear Unidad de Empaque
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Crear Nueva Unidad de Empaque</DialogTitle>
          <DialogDescription>
            Se creará una nueva unidad de empaque para esta operación.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Al hacer clic en "Crear", se generará una nueva unidad de empaque con un nombre único.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={handleCreateUnit} disabled={isCreating}>
            {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isCreating ? 'Creando...' : 'Crear'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
