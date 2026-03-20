/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getAllUserProfiles, loadReceptionOperations } from '@/app/reception/actions';
import { createManualPause } from '@/app/actions';
import type { AppUser, ReceptionOperation } from '@/types';

interface ManualPauseDialogProps {
  children: React.ReactNode;
  onPauseCreated: () => void;
}

const formSchema = z.object({
  receptionId: z.string().min(1, 'Debe seleccionar una operación.'),
  userId: z.string().min(1, 'Debe seleccionar un usuario.'),
  startTime: z.string().min(1, 'Debe seleccionar una fecha y hora de inicio.'),
  endTime: z.string().min(1, 'Debe seleccionar una fecha y hora de fin.'),
  reason: z.string().min(1, 'Debe seleccionar una razón.'),
}).refine(data => new Date(data.startTime) < new Date(data.endTime), {
  message: 'La hora de fin debe ser posterior a la hora de inicio.',
  path: ['endTime'],
});

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


export const ManualPauseDialog: React.FC<ManualPauseDialogProps> = ({ children, onPauseCreated }) => {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [operations, setOperations] = useState<ReceptionOperation[]>([]);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      receptionId: '',
      userId: '',
      startTime: '',
      endTime: '',
      reason: '',
    },
  });
  
  useEffect(() => {
    if (open) {
      const fetchData = async () => {
        const [usersResult, opsResult] = await Promise.all([
          getAllUserProfiles(),
          loadReceptionOperations({ statusFilter: ['pending', 'in_progress', 'completed'] })
        ]);
        setUsers(usersResult);
        if (opsResult.success && opsResult.data) {
          setOperations(opsResult.data.operations);
        }
      };
      fetchData();
    }
  }, [open]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const result = await createManualPause(values);
    if (result.success) {
      toast({ title: 'Éxito', description: 'Pausa manual registrada correctamente.' });
      onPauseCreated();
      setOpen(false);
      form.reset();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Pausa Manual</DialogTitle>
          <DialogDescription>
            Añada una pausa para un operario de forma retroactiva.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
             <FormField
              control={form.control}
              name="receptionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operación (RK)</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar operación..." /></SelectTrigger></FormControl>
                    <SelectContent>{operations.map(op => <SelectItem key={op.id} value={op.id}>{op.rk_identifier}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="userId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Usuario</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                     <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar usuario..." /></SelectTrigger></FormControl>
                    <SelectContent>{users.map(user => <SelectItem key={user.uid} value={user.uid}>{user.displayName}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="startTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inicio de la Pausa</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fin de la Pausa</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razón</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar razón..." /></SelectTrigger></FormControl>
                    <SelectContent>{PAUSE_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando...' : 'Guardar Pausa'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
