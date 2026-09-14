/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2 } from 'lucide-react';
import { sanitizeDimensionalGoalsMap } from '@/lib/receptionGoals';

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

type GoalRow = { key: string; value: number };

function mapToRows(map?: Record<string, number>): GoalRow[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, v]) => Number(v) > 0)
    .map(([key, value]) => ({ key, value: Number(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const DimensionalGoalsEditor: React.FC<{
  title: string;
  placeholder: string;
  rows: GoalRow[];
  onChange: (rows: GoalRow[]) => void;
}> = ({ title, placeholder, rows, onChange }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { key: '', value: 0 }])}
        >
          <Plus className="mr-1 h-4 w-4" /> Agregar
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin metas específicas. Se usará la meta general / de operación / de usuario.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <Input
                placeholder={placeholder}
                value={row.key}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...next[idx], key: e.target.value };
                  onChange(next);
                }}
                className="flex-1"
              />
              <Input
                type="number"
                min={0}
                placeholder="u/h"
                value={row.value || ''}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...next[idx], value: Number(e.target.value) || 0 };
                  onChange(next);
                }}
                className="w-28"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                title="Quitar"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ProductivitySettings: React.FC = () => {
  const [settings, setSettings] = useState<ProductivitySettingsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [brandRows, setBrandRows] = useState<GoalRow[]>([]);
  const [groupRows, setGroupRows] = useState<GoalRow[]>([]);
  const [referenceRows, setReferenceRows] = useState<GoalRow[]>([]);
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
        form.reset({
          standard_per_hour_goal: result.data.standard_per_hour_goal ?? 0,
          high_productivity_threshold: result.data.high_productivity_threshold ?? 90,
          medium_productivity_threshold: result.data.medium_productivity_threshold ?? 75,
          low_productivity_threshold: result.data.low_productivity_threshold ?? 50,
        });
        const dim = result.data.receptionDimensionalGoals;
        setBrandRows(mapToRows(dim?.byBrand));
        setGroupRows(mapToRows(dim?.byGroup));
        setReferenceRows(mapToRows(dim?.byReference));
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
    const payload: Omit<ProductivitySettingsType, 'id'> = {
      ...values,
      receptionDimensionalGoals: {
        byBrand: sanitizeDimensionalGoalsMap(brandRows),
        byGroup: sanitizeDimensionalGoalsMap(groupRows),
        byReference: sanitizeDimensionalGoalsMap(referenceRows),
      },
    };
    const result = await updateProductivitySettings(payload);
    if (result.success) {
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
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Metas de Productividad (Recepción)</CardTitle>
        <CardDescription>
          Meta general e individual (por usuario / por operación) ya existen. Aquí puede definir
          metas u/h por marca, grupo o referencia. Prioridad al medir:{' '}
          <strong>referencia → marca → grupo → operación → usuario → meta general</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="standard_per_hour_goal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meta general de ítems por hora</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Ej: 350" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                  </FormControl>
                  <FormDescription>
                    Fallback cuando no hay meta de referencia/marca/grupo, ni de la operación, ni del usuario.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md border p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-sm">Metas dimensionales (opcional)</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Defina solo las dimensiones que necesite. La meta de la operación (al crear/editar RK)
                  y la meta individual del usuario siguen vigentes.
                </p>
              </div>
              <Tabs defaultValue="brand">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="brand">Por marca</TabsTrigger>
                  <TabsTrigger value="group">Por grupo</TabsTrigger>
                  <TabsTrigger value="reference">Por referencia</TabsTrigger>
                </TabsList>
                <TabsContent value="brand" className="pt-3">
                  <DimensionalGoalsEditor
                    title="Meta u/h por marca"
                    placeholder="Ej: FILA, NIKE…"
                    rows={brandRows}
                    onChange={setBrandRows}
                  />
                </TabsContent>
                <TabsContent value="group" className="pt-3">
                  <DimensionalGoalsEditor
                    title="Meta u/h por grupo"
                    placeholder="Ej: CALZADO, TEXTIL…"
                    rows={groupRows}
                    onChange={setGroupRows}
                  />
                </TabsContent>
                <TabsContent value="reference" className="pt-3">
                  <DimensionalGoalsEditor
                    title="Meta u/h por referencia"
                    placeholder="Código de referencia"
                    rows={referenceRows}
                    onChange={setReferenceRows}
                  />
                </TabsContent>
              </Tabs>
            </div>

            <FormField
              control={form.control}
              name="high_productivity_threshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Umbral de Alta Productividad (%)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Ej: 90" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
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
                    <Input type="number" placeholder="Ej: 75" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
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
                    <Input type="number" placeholder="Ej: 50" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
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
