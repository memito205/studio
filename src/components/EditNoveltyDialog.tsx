
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { updateNovelty } from '@/app/actions';
import type { ItemNovelty, NoveltyStatus } from '@/types';


interface EditNoveltyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novelty: ItemNovelty | null;
  onNoveltyUpdated: () => void;
  children?: React.ReactNode;
}

const NOVELTY_STATUSES: NoveltyStatus[] = ['pending', 'resolved', 'ignored'];

const formSchema = z.object({
  status: z.enum(NOVELTY_STATUSES, { message: 'Por favor, selecciona un estado válido.' }),
  description: z.string().optional(),
});

export const EditNoveltyDialog: React.FC<EditNoveltyDialogProps> = ({ open, onOpenChange, novelty, onNoveltyUpdated, children }) => {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      status: 'pending',
      description: '',
    },
  });

  React.useEffect(() => {
    if (open && novelty) {
      form.reset({
        status: novelty.status,
        description: novelty.description || '',
      });
    }
  }, [open, novelty, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (!novelty?.id) {
        toast({ variant: 'destructive', title: 'Error', description: 'ID de novedad no encontrado para la edición.' });
        return;
      }
      const result = await updateNovelty(novelty.id, {
        status: values.status,
        description: values.description || undefined,
      });

      if (result.success) {
        toast({ title: 'Éxito', description: 'Novedad actualizada correctamente.' });
        onNoveltyUpdated();
        onOpenChange(false);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error inesperado', description: error.message });
    }
  };

  if (!novelty) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Novedad</DialogTitle>
          <DialogDescription>
            Modifica el estado y la descripción de la novedad para el código <span className="font-bold">{novelty.barcode}</span>.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un estado" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NOVELTY_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status === 'pending' ? 'Pendiente' : status === 'resolved' ? 'Resuelta' : 'Ignorada'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción (Opcional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Detalles adicionales sobre la novedad" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
