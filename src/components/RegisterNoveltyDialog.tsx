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
import { registerNovelty } from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';

interface RegisterNoveltyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receptionId: string;
  scannedItemId?: string; // Optional, for novelties tied to a specific scan
  barcode?: string; // Optional, for novelties tied to a barcode (e.g., product not found)
  onNoveltyRegistered: () => void;
  children?: React.ReactNode;
}

const NOVELTY_TYPES = [
  'Trocado',
  'Manchado',
  'Sucio',
  'Despegado',
  'Mal terminado',
  'Cantidad incorrecta',
  'Producto no está en RK',
  'Ubicación incorrecta',
  'Otro',
];

const formSchema = z.object({
  novelty_type: z.string().min(1, { message: 'Por favor, selecciona un tipo de novedad.' }),
  description: z.string().optional(),
});

const RegisterNoveltyDialog: React.FC<RegisterNoveltyDialogProps> = ({
  open,
  onOpenChange,
  receptionId,
  scannedItemId,
  barcode,
  onNoveltyRegistered,
  children
}) => {
  const { toast } = useToast();
  const { user } = useAuth(); // Get the authenticated user
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      novelty_type: '',
      description: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        novelty_type: '',
        description: '',
      });
    }
  }, [open, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Debe estar autenticado para registrar una novedad.' });
      return;
    }
    try {
      const result = await registerNovelty({
        reception_id: receptionId,
        barcode: barcode || '',
        novelty_type: values.novelty_type,
        description: values.description || '',
        scanned_item_id: scannedItemId,
      }, user.uid); // Pass the user ID to the action
      if(result.success) {
        toast({ title: 'Éxito', description: 'Novedad registrada correctamente.' });
        onNoveltyRegistered();
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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Registrar Novedad</DialogTitle>
          <DialogDescription>
            Reporta una incidencia relacionada con este ítem o la operación.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="novelty_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Novedad</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NOVELTY_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
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
                {form.formState.isSubmitting ? 'Registrando...' : 'Registrar Novedad'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default RegisterNoveltyDialog;
