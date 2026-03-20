
/** @jsxImportSource react */
"use client";

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import type { AppUser } from '@/types';
import { createLabelingTask } from '@/app/reception/actions';

interface CreateLabelingTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  referenceData: { reference: string; totalQuantity: number, sizes: { [key: string]: number } } | null;
  operators: AppUser[];
  isLoadingOperators: boolean;
  operationId: string;
  rkIdentifier: string;
  supplier: string;
  onTaskCreated: () => void;
}

const formSchema = z.object({
  operatorId: z.string().min(1, 'Debe seleccionar un operario.'),
  standard: z.preprocess(
    (val) => Number(String(val).trim() || 0),
    z.number().min(1, 'El estándar debe ser al menos 1.')
  ),
});

export const CreateLabelingTaskDialog: React.FC<CreateLabelingTaskDialogProps> = ({
  isOpen,
  onOpenChange,
  referenceData,
  operators,
  isLoadingOperators,
  operationId,
  rkIdentifier,
  supplier,
  onTaskCreated,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      operatorId: '',
      standard: 150, // Default standard
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({ operatorId: '', standard: 150 });
    }
  }, [isOpen, form]);

  if (!referenceData) return null;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    const result = await createLabelingTask({
      receptionOperationId: operationId,
      rk_identifier: rkIdentifier,
      supplier: supplier,
      reference: referenceData.reference,
      sizes: referenceData.sizes,
      totalUnits: referenceData.totalQuantity,
      assignedOperatorId: values.operatorId,
      standard_units_per_hour: values.standard,
    });

    if (result.success) {
      onTaskCreated();
      onOpenChange(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear Tarea de Etiquetado para: {referenceData.reference}</DialogTitle>
          <DialogDescription>
            Asigne esta tarea a un operario y defina el estándar de productividad.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
            <p><strong>Cantidad Total:</strong> {referenceData.totalQuantity} unidades</p>
            <p className="text-sm text-muted-foreground">
                Desglose: {Object.entries(referenceData.sizes).map(([s,q]) => `${s}: ${q}`).join(', ')}
            </p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="operatorId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Asignar a Operario</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingOperators}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingOperators ? 'Cargando...' : 'Seleccione un operario...'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {operators.map(op => (
                        <SelectItem key={op.uid} value={op.uid}>{op.displayName || op.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="standard"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estándar (unidades por hora)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar Tarea
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
