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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

interface SetLabelingStandardDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (standard: number) => void;
  isLoading: boolean;
  currentValue?: number | null;
}

const formSchema = z.object({
  standard: z.preprocess(
    (val) => Number(String(val).trim()),
    z.number().min(1, 'El estándar debe ser al menos 1.')
  ),
});

export const SetLabelingStandardDialog: React.FC<SetLabelingStandardDialogProps> = ({
  isOpen,
  onOpenChange,
  onConfirm,
  isLoading,
  currentValue,
}) => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      standard: currentValue || undefined,
    },
  });

  React.useEffect(() => {
    form.reset({ standard: currentValue || undefined });
  }, [currentValue, form, isOpen]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    onConfirm(values.standard);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Definir Estándar de Productividad</DialogTitle>
          <DialogDescription>
            Establezca la meta de unidades por hora para esta operación de etiquetado.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="standard"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unidades por Hora</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Ej: 150" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isLoading}>
                Guardar Estándar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
