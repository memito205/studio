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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { updateProduct } from '@/app/reception/actions';
import type { ReceptionProduct } from '@/types';

interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ReceptionProduct;
  onSave: () => void;
  children?: React.ReactNode;
}

const formSchema = z.object({
  name: z.string().min(1, { message: 'El nombre del producto es requerido.' }),
  barcode: z.string().min(1, { message: 'El código de barras es requerido.' }),
  description: z.string().optional(),
  reference: z.string().optional(),
  size: z.string().optional(),
  merchandise_type: z.string().optional(),
});

export const EditProductDialog: React.FC<EditProductDialogProps> = ({
  open,
  onOpenChange,
  product,
  onSave,
  children,
}) => {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product.name || '',
      barcode: product.barcode || '',
      description: product.description || '',
      reference: product.reference || '',
      size: product.size || '',
      merchandise_type: product.merchandise_type || '',
    },
  });

  useEffect(() => {
    if (open && product) {
      form.reset({
        name: product.name || '',
        barcode: product.barcode || '',
        description: product.description || '',
        reference: product.reference || '',
        size: product.size || '',
        merchandise_type: product.merchandise_type || '',
      });
    }
  }, [open, product, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (!product.id) {
        toast({ variant: 'destructive', title: 'Error', description: 'ID de producto no encontrado para la edición.' });
        return;
      }
      const updatedProductData: Partial<Omit<ReceptionProduct, 'id' | 'barcode' | 'created_at' | 'updated_at' | 'user_id'>> = {
        name: values.name,
        description: values.description || null,
        reference: values.reference || null,
        size: values.size || null,
        merchandise_type: values.merchandise_type || null,
      };

      const result = await updateProduct(product.id, updatedProductData);
      
      if (result.success) {
        toast({ title: 'Éxito', description: 'Producto actualizado correctamente.' });
        onSave();
        onOpenChange(false);
      } else {
        toast({ variant: 'destructive', title: 'Error al actualizar', description: result.error });
      }
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error inesperado', description: error.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Producto</DialogTitle>
          <DialogDescription>
            Modifica los detalles del producto: {product.name || 'N/A'}.
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
                    <Input placeholder="Ej: 123456789012" {...field} disabled />
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
                {form.formState.isSubmitting ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
