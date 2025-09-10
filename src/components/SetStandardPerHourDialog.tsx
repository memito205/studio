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
import { updateReceptionOperation } from '@/app/actions';

interface SetStandardPerHourDialogProps {
  operationId: string;
  currentValue: number | null | undefined;
  onSave: () => void;
  children: React.ReactNode;
}

const formSchema = z.object({
  standardPerHour: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : Number(val),
    z.number().nullable().refine(val => val === null || (val >= 0 && val <= 10000), {
      message: 'El valor debe ser un número positivo entre 0 y 10000, o estar vacío.',
    })
  ),
});


const SetStandardPerHourDialog: React.FC<SetStandardPerHourDialogProps> = ({
  operationId,
  currentValue,
  onSave,
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      standardPerHour: currentValue ?? null,
    },
  });

  React.useEffect(() => {
    form.reset({ standardPerHour: currentValue ?? null });
  }, [currentValue, form, open]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const result = await updateReceptionOperation(operationId, { standard_units_per_hour: values.standardPerHour });
      if (result.success) {
        toast({ title: 'Éxito', description: 'Estándar por hora actualizado correctamente.' });
        onSave();
        setOpen(false);
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Configurar Estándar por Hora</DialogTitle>
          <DialogDescription>
            Introduce las unidades estándar por hora para esta operación.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="standardPerHour"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unidades Estándar por Hora</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Dejar vacío para usar el global"
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
                {form.formState.isSubmitting ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SetStandardPerHourDialog;
