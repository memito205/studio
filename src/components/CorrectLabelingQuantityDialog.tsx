/** @jsxImportSource react */
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { LabelingOperation } from '@/types';

interface CorrectLabelingQuantityDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (quantity: number) => void;
  isLoading: boolean;
  operation: LabelingOperation | null;
}

const formSchema = z.object({
  quantity: z.preprocess(
    (val) => Number(String(val).trim()),
    z.number().min(1, 'La cantidad debe ser al menos 1.')
  ),
});

export const CorrectLabelingQuantityDialog: React.FC<CorrectLabelingQuantityDialogProps> = ({
  isOpen,
  onOpenChange,
  onConfirm,
  isLoading,
  operation,
}) => {
  const currentTotal = operation?.totalUnits ?? 0;
  const currentCompleted = operation?.completedUnits;
  const isCompleted = operation?.status === 'Completada';

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      quantity: currentTotal || undefined,
    },
  });

  React.useEffect(() => {
    form.reset({ quantity: currentTotal || undefined });
  }, [currentTotal, form, isOpen, operation?.id]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    onConfirm(values.quantity);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir cantidad asignada</DialogTitle>
          <DialogDescription>
            Ajuste la cantidad de la tarea de etiquetado. Esto recalcula la productividad (u/h y cumplimiento)
            con la nueva cantidad.
          </DialogDescription>
        </DialogHeader>
        {operation ? (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">RK / Ref: </span>
              <span className="font-medium">
                {operation.rk_identifier} · {operation.reference}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Estado: </span>
              {operation.status}
            </div>
            <div>
              <span className="text-muted-foreground">Cantidad actual: </span>
              <span className="font-semibold tabular-nums">{currentTotal.toLocaleString()}</span>
              {isCompleted ? (
                <span className="text-muted-foreground">
                  {' '}
                  (completadas: {(currentCompleted ?? currentTotal).toLocaleString()})
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nueva cantidad (unidades)</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} step={1} placeholder="Ej: 120" {...field} />
                  </FormControl>
                  <FormDescription>
                    {isCompleted
                      ? 'Al estar completada, también se actualiza la cantidad reportada en Fin para el dashboard histórico.'
                      : 'Las tallas se ajustan proporcionalmente para que sumen la nueva cantidad.'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading || !operation}>
                Guardar corrección
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
