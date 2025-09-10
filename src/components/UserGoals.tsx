/** @jsxImportSource react */
import React, { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { getUserGoals, upsertUserGoals, getAllUserProfiles } from '@/app/actions';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth-context';
import type { UserGoal, AppUser } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const formSchema = z.object({
  daily_scanned_items_goal: z.preprocess(
    (val) => Number(String(val).trim() === '' ? 0 : val),
    z.number().min(0, { message: 'El valor debe ser un número positivo.' }).max(10000, { message: 'El valor no puede exceder 10000.' })
  ),
  hourly_productivity_goal: z.preprocess(
    (val) => Number(String(val).trim() === '' ? 0 : val),
    z.number().min(0, { message: 'El valor debe ser un número positivo.' }).max(1000, { message: 'El valor no puede exceder 1000.' })
  ),
});

const UserGoalRow: React.FC<{ user: AppUser }> = ({ user }) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      daily_scanned_items_goal: 0,
      hourly_productivity_goal: 0,
    },
  });

  useEffect(() => {
    const fetchGoals = async () => {
      const result = await getUserGoals(user.uid);
      if (result.success && result.data) {
        form.reset({
            daily_scanned_items_goal: result.data.daily_scanned_items_goal || 0,
            hourly_productivity_goal: result.data.hourly_productivity_goal || 0
        });
      }
    };
    fetchGoals();
  }, [user.uid, form]);
  
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    const result = await upsertUserGoals(user.uid, values);
    if(result.success){
        toast({ title: 'Éxito', description: `Metas para ${user.displayName} guardadas.` });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
  };

  return (
    <TableRow>
       <TableCell className="font-medium">{user.displayName || user.email}</TableCell>
       <TableCell>
         <FormField
            control={form.control}
            name="daily_scanned_items_goal"
            render={({ field }) => (
                <Input type="number" {...field} className="w-24" onChange={e => field.onChange(Number(e.target.value))}/>
            )}
            />
       </TableCell>
       <TableCell>
            <FormField
            control={form.control}
            name="hourly_productivity_goal"
            render={({ field }) => (
                <Input type="number" {...field} className="w-24" onChange={e => field.onChange(Number(e.target.value))}/>
            )}
            />
       </TableCell>
       <TableCell>
         <Button onClick={form.handleSubmit(onSubmit)} size="sm" disabled={isSubmitting}>
           {isSubmitting ? 'Guardando...' : 'Guardar'}
         </Button>
       </TableCell>
    </TableRow>
  );
};


export const UserGoals: React.FC = () => {
  const { role } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (role === 'admin') {
      const fetchUsers = async () => {
        setIsLoading(true);
        const fetchedUsers = await getAllUserProfiles();
        setUsers(fetchedUsers.filter(u => u.role === 'operator' || u.role === 'supervisor'));
        setIsLoading(false);
      };
      fetchUsers();
    } else {
        setIsLoading(false);
    }
  }, [role]);

  if (role !== 'admin') {
    return null; // This component is now admin-only
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
             <Skeleton className="h-10 w-full" />
             <Skeleton className="h-10 w-full" />
             <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Metas de Productividad por Operario (Recepción)</CardTitle>
        <CardDescription>
          Como administrador, puedes definir metas de rendimiento individuales para cada operario en el módulo de recepción.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Meta Diaria (ítems)</TableHead>
                        <TableHead>Meta por Hora (ítems)</TableHead>
                        <TableHead>Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.map(user => <UserGoalRow key={user.uid} user={user} />)}
                </TableBody>
            </Table>
             {users.length === 0 && (
                <p className="text-center text-muted-foreground p-4">No se encontraron operarios o supervisores.</p>
            )}
        </div>
      </CardContent>
    </Card>
  );
};
