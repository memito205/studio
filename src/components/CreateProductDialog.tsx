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
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { createProduct, registerNovelty } from '@/app/actions';
import type { ReceptionProduct } from '@/types';
import { useAuth } from '@/hooks/use-auth-context';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  initialBarcode?: string;
  receptionId: string;
}

const formSchema = z.object({
  name: z.string().min(1, { message: 'El nombre del producto es requerido.' }),
  barcode: z.string().min(1, { message: 'El código de barras es requerido.' }),
  description: z.string().optional(),
  reference: z.string().optional(),
  size: z.string().optional(),
  merchandise_type: z.string().optional(),
});

export const CreateProductDialog: React.FC<CreateProductDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  initialBarcode,
  receptionId,
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      barcode: initialBarcode || '',
      description: '',
      reference: '',
      size: '',
      merchandise_type: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        name: '',
        barcode: initialBarcode || '',
        description: '',
        reference: '',
        size: '',
        merchandise_type: '',
      });
    }
  }, [open, initialBarcode, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user?.uid) {
        toast({
            variant: 'destructive',
            title: 'Error de Autenticación',
            description: 'No se pudo verificar el usuario. Por favor, inicie sesión de nuevo.',
        });
        return;
    }

    try {
      const productToCreate: Omit<ReceptionProduct, 'id' | 'created_at' | 'updated_at' | 'user_id'> = {
        name: values.name,
        barcode: values.barcode,
        description: values.description || null,
        reference: values.reference || null,
        size: values.size || null,
        merchandise_type: values.merchandise_type || null,
      };

      const createResult = await createProduct(productToCreate);
      
      if (!createResult.success) {
        throw new Error(createResult.error);
      }
      
      toast({ title: 'Éxito', description: 'Producto creado correctamente.' });
      
      await registerNovelty({
        reception_id: receptionId,
        barcode: values.barcode,
        novelty_type: 'Producto no está en RK',
        description: `Producto con código de barras ${values.barcode} no encontrado y creado manualmente.`,
      }, user.uid);

      onSave();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al crear el producto',
        description: error.message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear Nuevo Producto</DialogTitle>
          <DialogDescription>
            El código de barras escaneado no se encontró. Introduce los detalles para un nuevo producto.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del Producto</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Camiseta Azul" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código de Barras</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: 123456789012" {...field} disabled={!!initialBarcode} />
                  </FormControl>
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
                    <Textarea placeholder="Descripción detallada del producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referencia (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: REF-001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
            )}
            />
            <FormField
              control={form.control}
              name="size"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Talla (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: M, L, XL" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="merchandise_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Mercancía (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Ropa, Electrónica" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creando...' : 'Crear Producto'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProductDialog;
