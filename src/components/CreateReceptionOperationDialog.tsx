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
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { createReceptionOperation } from '@/app/actions';
import { Textarea } from '@/components/ui/textarea';
import type { ReceptionOperation } from '@/types';
import { useAuth } from '@/hooks/use-auth-context';

interface CreateReceptionOperationDialogProps {
  onSave: () => void;
  children: React.ReactNode;
}

const formSchema = z.object({
  rk_identifier: z.string().min(1, { message: 'El identificador RK es requerido.' }),
  supplier: z.string().min(1, { message: 'El proveedor es requerido.' }),
  expected_arrival_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha inválido (YYYY-MM-DD).' }),
  expected_quantity: z.preprocess(
    (val) => Number(val),
    z.number().min(1, { message: 'La cantidad esperada debe ser al menos 1.' })
  ),
  nombre_rk: z.string().optional(),
  codigo_de_barras: z.string().optional(),
  descripcion_del_producto: z.string().optional(),
  referencia: z.string().optional(),
  talla: z.string().optional(),
  tipo_mercancia: z.string().optional(),
  standard_units_per_hour: z.preprocess(
    (val) => (val === '' ? null : Number(val)), // Allow empty string for optional number
    z.number().nullable().refine(val => val === null || (val >= 0 && val <= 10000), {
      message: 'El valor debe ser un número positivo entre 0 y 10000, o estar vacío.',
    })
  ).optional(),
});

export const CreateReceptionOperationDialog: React.FC<CreateReceptionOperationDialogProps> = ({
  onSave,
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rk_identifier: '',
      supplier: '',
      expected_arrival_date: new Date().toISOString().slice(0, 10), // Default to today's date
      expected_quantity: 1,
      nombre_rk: '',
      codigo_de_barras: '',
      descripcion_del_producto: '',
      referencia: '',
      talla: '',
      tipo_mercancia: '',
      standard_units_per_hour: null, // Default to null
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
        toast({ variant: 'destructive', title: 'Error', description: 'Debe iniciar sesión para crear una operación.' });
        return;
    }
    try {
      const newOperationData: Omit<ReceptionOperation, 'id' | 'created_at' | 'updated_at' | 'user_id' | 'status'> = {
        rk_identifier: values.rk_identifier,
        supplier: values.supplier,
        expected_arrival_date: values.expected_arrival_date,
        expected_quantity: values.expected_quantity,
        nombre_rk: values.nombre_rk || null,
        codigo_de_barras: values.codigo_de_barras || null,
        descripcion_del_producto: values.descripcion_del_producto || null,
        referencia: values.referencia || null,
        talla: values.talla || null,
        tipo_mercancia: values.tipo_mercancia || null,
        standard_units_per_hour: values.standard_units_per_hour,
      };

      const result = await createReceptionOperation(newOperationData, user.uid);
      
      if (result.success) {
        toast({ title: 'Éxito', description: 'Operación de recepción creada correctamente.' });
        onSave();
        setOpen(false);
        form.reset();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error: any) {
       toast({ variant: 'destructive', title: 'Error inesperado', description: error.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear Nueva Operación de Recepción</DialogTitle>
          <DialogDescription>
            Introduce los detalles para una nueva operación de recepción.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="rk_identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Identificador RK</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: RK-2023-001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="supplier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del proveedor" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expected_arrival_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Llegada Esperada</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expected_quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cantidad Esperada</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Ej: 100" {...field} onChange={(e) => field.onChange(e.target.value)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nombre_rk"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre RK (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del RK" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="codigo_de_barras"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código de Barras Esperado (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Código de barras del producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descripcion_del_producto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción del Producto (Opcional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Descripción detallada del producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="referencia"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referencia (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Referencia del producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
            )}
            />
            <FormField
              control={form.control}
              name="talla"
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
              name="tipo_mercancia"
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
            <FormField
              control={form.control}
              name="standard_units_per_hour"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estándar por Hora (Opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Ej: 100"
                      {...field}
                      value={field.value === null ? '' : String(field.value)}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creando...' : 'Crear Operación'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateReceptionOperationDialog;
