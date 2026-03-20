/** @jsxImportSource react */
import React, { useEffect } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { updateScannedItem } from '@/app/reception/actions';
import type { ScannedItem } from '@/types';

interface EditScannedItemDialogProps {
  item: ScannedItem; 
  onSave: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formSchema = z.object({
  quantity: z.preprocess(
    (val) => Number(val),
    z.number().min(1, { message: 'La cantidad debe ser un número positivo.' })
  ),
});

const EditScannedItemDialog: React.FC<EditScannedItemDialogProps> = ({
  item,
  onSave,
  open,
  onOpenChange
}) => {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      quantity: item.quantity,
    },
  });

  useEffect(() => {
    form.reset({
      quantity: item.quantity,
    });
  }, [item, form, open]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (!item.id) {
        toast({ variant: 'destructive', title: 'Error', description: 'ID de ítem escaneado no encontrado para la edición.' });
        return;
      }
      const result = await updateScannedItem(item.id, { quantity: values.quantity });
      if(result.success) {
        toast({ title: 'Éxito', description: 'Ítem escaneado actualizado correctamente.' });
        onSave();
        onOpenChange(false);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error inesperado', description: error.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Ítem Escaneado</DialogTitle>
          <DialogDescription>
            Modifica la cantidad del ítem {item.barcode}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cantidad</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Cantidad"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      min="1"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default EditScannedItemDialog;
