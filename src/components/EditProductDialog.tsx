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
import type { ReceptionProduct, ProductDatabaseItem } from '@/types';

interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ReceptionProduct | ProductDatabaseItem;
  onSave: () => void;
  children?: React.ReactNode;
}

function barcodeFromProduct(p: ReceptionProduct | ProductDatabaseItem): string {
  const db = p as ProductDatabaseItem;
  const rx = p as ReceptionProduct;
  return String(db.codigoBarras || rx.barcode || '').trim();
}

function docIdFromProduct(p: ReceptionProduct | ProductDatabaseItem): string {
  const db = p as ProductDatabaseItem;
  const rx = p as ReceptionProduct;
  return String(p.id || db.codigoBarras || rx.barcode || '').trim();
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
  const brandOrType =
    product.merchandise_type?.trim() ||
    product.marca?.trim() ||
    '';

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product.name || product.item || '',
      barcode: barcodeFromProduct(product),
      description: product.description || product.item || '',
      reference: product.reference || product.referencia || '',
      size: product.size || product.talla || '',
      merchandise_type: brandOrType,
    },
  });

  useEffect(() => {
    if (open && product) {
      const mt =
        product.merchandise_type?.trim() ||
        product.marca?.trim() ||
        '';
      form.reset({
        name: product.name || product.item || '',
        barcode: barcodeFromProduct(product),
        description: product.description || product.item || '',
        reference: product.reference || product.referencia || '',
        size: product.size || product.talla || '',
        merchandise_type: mt,
      });
    }
  }, [open, product, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const docIdCheck = docIdFromProduct(product);
      if (!docIdCheck) {
        toast({ variant: 'destructive', title: 'Error', description: 'ID de producto no encontrado para la edición.' });
        return;
      }
      const brandVal = values.merchandise_type?.trim() || null;

      const updatedProductData: Partial<Omit<ReceptionProduct, 'id' | 'barcode' | 'created_at' | 'updated_at' | 'user_id'>> = {
        name: values.name,
        description: values.description || null,
        reference: values.reference || null,
        size: values.size || null,
        merchandise_type: brandVal,
        // Catálogo maestro (empaque): classifyProduct lee `marca`; antes solo se guardaba merchandise_type.
        marca: brandVal,
      };

      const result = await updateProduct(docIdCheck, updatedProductData);
      
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
                  <FormLabel>Marca</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: NIKE, ADIDAS, IMPORTADA…" {...field} />
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
