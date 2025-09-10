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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';

interface PauseReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

const PAUSE_REASONS = [
  'Desayuno',
  'Almuerzo',
  'Refrigerio',
  'Fin de jornada',
  'Descargues',
  'Cargue',
  'Reciclaje',
  'Otras actividades',
];

const formSchema = z.object({
  reason: z.string().min(1, { message: 'Por favor, selecciona una razón.' }),
  otherReasonText: z.string().optional(),
});

const PauseReasonDialog: React.FC<PauseReasonDialogProps> = ({ open, onOpenChange, onConfirm }) => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      reason: '',
      otherReasonText: '',
    },
  });

  const selectedReason = form.watch('reason');

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    let finalReason = values.reason;
    if (values.reason === 'Otras actividades' && values.otherReasonText) {
      finalReason = `Otras actividades: ${values.otherReasonText}`;
    }
    onConfirm(finalReason);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Pausar Operación</DialogTitle>
          <DialogDescription>
            Selecciona la razón por la que deseas pausar la operación.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razón de la Pausa</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una razón" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAUSE_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedReason === 'Otras actividades' && (
              <FormField
                control={form.control}
                name="otherReasonText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Especifique la actividad</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ej: Reunión de equipo, capacitación..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Confirmando...' : 'Confirmar Pausa'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default PauseReasonDialog;
