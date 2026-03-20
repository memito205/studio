/** @jsxImportSource react */
import React, { useEffect } from 'react';
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
import { getProductivitySettings, updateProductivitySettings } from '@/app/actions';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductivitySettings as ProductivitySettingsType } from '@/types';

const formSchema = z.object({
  standard_per_hour_goal: z.preprocess(
    (val) => Number(val),
    z.number().min(0, { message: 'El valor debe ser un número positivo.' }).max(10000, { message: 'El valor no puede exceder 10000.' })
  ),
  low_productivity_threshold: z.preprocess(
    (val) => Number(val),
    z.number().min(0).max(100, { message: 'El umbral debe estar entre 0 y 100.' })
  ),
  medium_productivity_threshold: z.preprocess(
    (val) => Number(val),
    z.number().min(0).max(100, { message: 'El umbral debe estar entre 0 y 100.' })
  ),
  high_productivity_threshold: z.preprocess(
    (val) => Number(val),
    z.number().min(0).max(100, { message: 'El umbral debe estar entre 0 y 100.' })
  ),
});

export const ProductivitySettings: React.FC = () => {
  const [settings, setSettings] = React.useState<ProductivitySettingsType | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      standard_per_hour_goal: 0,
      high_productivity_threshold: 90,
      medium_productivity_threshold: 75,
      low_productivity_threshold: 50,
    },
  });

  const fetchSettings = React.useCallback(async () => {
    setIsLoading(true);
    const result = await getProductivitySettings();
    if (result.success) {
      if (result.data) {
        setSettings(result.data);
        form.reset(result.data);
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsLoading(false);
  }, [form, toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const result = await updateProductivitySettings(values);
    if(result.success) {
        toast({ title: 'Éxito', description: 'Configuración de productividad guardada.' });
        fetchSettings();
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
  };
  
  if (isLoading) {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
                <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
                 <Skeleton className="h-10 w-32" />
            </CardContent>
        </Card>
    )
  }

  return (
      <Card>
        <CardHeader>
          <CardTitle>Metas de Productividad (Recepción)</CardTitle>
          <CardDescription>
            Define tus metas y umbrales de productividad para el módulo de recepción.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="standard_per_hour_goal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meta de ítems por hora</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Ej: 60" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                    </FormControl>
                    <FormDescription>
                      Cantidad de ítems que esperas que un operario escanee por hora.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="high_productivity_threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Umbral de Alta Productividad (%)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Ej: 90" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                    </FormControl>
                    <FormDescription>
                      Porcentaje de la meta por hora para considerar alta productividad (ej. 90 para 90%).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="medium_productivity_threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Umbral de Productividad Media (%)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Ej: 75" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                    </FormControl>
                    <FormDescription>
                      Porcentaje de la meta por hora para considerar productividad media (ej. 75 para 75%).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="low_productivity_threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Umbral de Baja Productividad (%)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Ej: 50" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                    </FormControl>
                    <FormDescription>
                      Porcentaje de la meta por hora para considerar baja productividad (ej. 50 para 50%).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando...' : 'Guardar Configuración'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
  );
};

    