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
import { Loader2, User } from 'lucide-react';
import type { AppUser, ExternalVendor } from '@/types';
import { createLabelingTask } from '@/app/reception/actions';

interface CreateLabelingTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  referenceData: { reference: string; totalQuantity: number, sizes: { [key: string]: number } } | null;
  operators: AppUser[];
  externalVendors: ExternalVendor[];
  isLoadingOperators: boolean;
  operationId: string;
  rkIdentifier: string;
  supplier: string;
  onTaskCreated: () => void;
}

const formSchema = z.object({
  operatorId: z.string().min(1, 'Debe seleccionar un operario.'),
  externalOperatorName: z.string().optional(),
  standard: z.preprocess(
    (val) => Number(String(val).trim() || 0),
    z.number().min(1, 'El estándar debe ser al menos 1.')
  ),
}).refine((data) => {
    if (data.operatorId.startsWith('ext_') && !data.externalOperatorName) {
        return false;
    }
    return true;
}, {
    message: "Debe seleccionar el nombre del operario externo.",
    path: ["externalOperatorName"],
});

export const CreateLabelingTaskDialog: React.FC<CreateLabelingTaskDialogProps> = ({
  isOpen,
  onOpenChange,
  referenceData,
  operators,
  externalVendors,
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
      externalOperatorName: '',
      standard: 150, // Default standard
    },
  });

  const selectedOperatorId = form.watch('operatorId');
  const isExternal = selectedOperatorId.startsWith('ext_');
  const selectedVendor = isExternal ? externalVendors.find(v => `ext_${v.id}` === selectedOperatorId) : null;

  useEffect(() => {
    if (isOpen) {
      form.reset({ operatorId: '', externalOperatorName: '', standard: 150 });
    }
  }, [isOpen, form]);

  if (!referenceData) return null;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    const cleanVendorId = values.operatorId.replace('ext_', '');

    const result = await createLabelingTask({
      receptionOperationId: operationId,
      rk_identifier: rkIdentifier,
      supplier: supplier,
      reference: referenceData.reference,
      sizes: referenceData.sizes,
      totalUnits: referenceData.totalQuantity,
      assignedOperatorId: isExternal ? '' : values.operatorId,
      assignedExternalVendorId: isExternal ? cleanVendorId : undefined,
      assignedExternalOperatorName: isExternal ? values.externalOperatorName : undefined,
      isExternal: isExternal,
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Crear Tarea: {referenceData.reference}</DialogTitle>
          <DialogDescription>
            Defina el responsable y el estándar de productividad.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-2 bg-muted/30 p-3 rounded-md border text-sm mb-4">
            <div className="flex justify-between">
                <span><strong>Cantidad:</strong> {referenceData.totalQuantity} unidades</span>
                <span className="text-muted-foreground font-mono text-[10px]">{rkIdentifier}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
                Desglose: {Object.entries(referenceData.sizes).map(([s,q]) => `${s}:${q}`).join(' | ')}
            </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
                <FormField
                  control={form.control}
                  name="operatorId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Responsable (Interno o Empresa)</FormLabel>
                      <Select onValueChange={(val) => {
                          field.onChange(val);
                          form.setValue('externalOperatorName', ''); // Reset operator if vendor changes
                      }} value={field.value} disabled={isLoadingOperators}>
                        <FormControl>
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder={isLoadingOperators ? 'Cargando...' : 'Seleccione responsable...'} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {operators.map(op => (
                            <SelectItem key={op.uid} value={op.uid}>[Interno] {op.displayName || op.email}</SelectItem>
                          ))}
                          {externalVendors.map(vendor => (
                            <SelectItem key={vendor.id} value={`ext_${vendor.id}`}>[Empresa Ext] {vendor.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-[10px]" />
                    </FormItem>
                  )}
                />

                {isExternal && selectedVendor && (
                    <FormField
                      control={form.control}
                      name="externalOperatorName"
                      render={({ field }) => (
                        <FormItem className="animate-in fade-in slide-in-from-top-1">
                          <FormLabel className="flex items-center gap-1 text-xs text-amber-600 font-bold">
                             <User className="h-3 w-3" /> Operario de la Empresa
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9 text-sm border-amber-200 bg-amber-50/30">
                                <SelectValue placeholder="Seleccione el trabajador..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {selectedVendor.operators?.map((op, i) => (
                                <SelectItem key={i} value={op.name}>{op.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )}
                    />
                )}
            </div>

            <FormField
              control={form.control}
              name="standard"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Estándar (unidades/hora)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} className="h-9" />
                  </FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )}
            />

            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-9">Cancelar</Button>
              <Button type="submit" disabled={isSubmitting} className="h-9">
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
