/** @jsxImportSource react */
import React, { useEffect, useMemo, useState } from 'react';
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
import { loadReceptionOperations } from '@/app/reception/actions';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductivitySettings as ProductivitySettingsType, ReceptionOperation } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import {
  dimensionalMapsToRows,
  rowsToDimensionalGoalsConfig,
  type DimensionalGoalRow,
} from '@/lib/receptionGoals';

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

const GLOBAL_OP_VALUE = '__global__';

const DimensionalGoalsEditor: React.FC<{
  title: string;
  placeholder: string;
  rows: DimensionalGoalRow[];
  onChange: (rows: DimensionalGoalRow[]) => void;
  operations: ReceptionOperation[];
}> = ({ title, placeholder, rows, onChange, operations }) => {
  const opLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of operations) {
      if (!op.id) continue;
      map.set(op.id, `${op.rk_identifier}${op.supplier ? ` · ${op.supplier}` : ''}`);
    }
    return map;
  }, [operations]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { key: '', value: 0, operationId: '' }])}
        >
          <Plus className="mr-1 h-4 w-4" /> Agregar
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin metas específicas. Se usará la meta general / de operación / de usuario.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_7rem_auto] gap-2 items-center">
              <Input
                placeholder={placeholder}
                value={row.key}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...next[idx], key: e.target.value };
                  onChange(next);
                }}
              />
              <Select
                value={row.operationId?.trim() ? row.operationId : GLOBAL_OP_VALUE}
                onValueChange={(val) => {
                  const next = [...rows];
                  next[idx] = {
                    ...next[idx],
                    operationId: val === GLOBAL_OP_VALUE ? '' : val,
                  };
                  onChange(next);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Operación (RK)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_OP_VALUE}>Todas las operaciones (global)</SelectItem>
                  {operations.map((op) =>
                    op.id ? (
                      <SelectItem key={op.id} value={op.id}>
                        {opLabel.get(op.id) || op.rk_identifier}
                      </SelectItem>
                    ) : null
                  )}
                </SelectContent>
              </Select>
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
  const [isLoading, setIsLoading] = useState(true);
  const [brandRows, setBrandRows] = useState<DimensionalGoalRow[]>([]);
  const [groupRows, setGroupRows] = useState<DimensionalGoalRow[]>([]);
  const [referenceRows, setReferenceRows] = useState<DimensionalGoalRow[]>([]);
  const [operations, setOperations] = useState<ReceptionOperation[]>([]);
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
    const [settingsResult, opsResult] = await Promise.all([
      getProductivitySettings(),
      loadReceptionOperations({
        statusFilter: ['pending', 'in_progress', 'paused', 'completed'],
        limit: 200,
      }),
    ]);

    if (opsResult.success && opsResult.data?.operations) {
      setOperations(
        [...opsResult.data.operations].sort((a, b) =>
          String(a.rk_identifier || '').localeCompare(String(b.rk_identifier || ''))
        )
      );
    }

    if (settingsResult.success) {
      if (settingsResult.data) {
        form.reset({
          standard_per_hour_goal: settingsResult.data.standard_per_hour_goal ?? 0,
          high_productivity_threshold: settingsResult.data.high_productivity_threshold ?? 90,
          medium_productivity_threshold: settingsResult.data.medium_productivity_threshold ?? 75,
          low_productivity_threshold: settingsResult.data.low_productivity_threshold ?? 50,
        });
        const dim = settingsResult.data.receptionDimensionalGoals;
        setBrandRows(dimensionalMapsToRows(dim, 'byBrand'));
        setGroupRows(dimensionalMapsToRows(dim, 'byGroup'));
        setReferenceRows(dimensionalMapsToRows(dim, 'byReference'));
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: settingsResult.error });
    }
    setIsLoading(false);
  }, [form, toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const payload: Omit<ProductivitySettingsType, 'id'> = {
      ...values,
      receptionDimensionalGoals: rowsToDimensionalGoalsConfig({
        brandRows,
        groupRows,
        referenceRows,
      }),
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
          Meta general e individual siguen vigentes. En marca/grupo/referencia puede dejar la meta
          global o elegir la operación (RK) a la que aplica — porque puede variar entre recepciones.
          Prioridad:{' '}
          <strong>
            dimensión de la operación → dimensión global → meta de operación → usuario → meta general
          </strong>
          .
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
                    Fallback cuando no hay meta dimensional, de la operación ni del usuario.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md border p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-sm">Metas dimensionales (opcional)</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  En cada fila elija si aplica a <em>Todas las operaciones</em> o a un RK concreto.
                </p>
              </div>
              <Tabs defaultValue="group">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="group">Por grupo</TabsTrigger>
                  <TabsTrigger value="brand">Por marca</TabsTrigger>
                  <TabsTrigger value="reference">Por referencia</TabsTrigger>
                </TabsList>
                <TabsContent value="group" className="pt-3">
                  <DimensionalGoalsEditor
                    title="Meta u/h por grupo"
                    placeholder="Ej: CALZADO, TEXTIL…"
                    rows={groupRows}
                    onChange={setGroupRows}
                    operations={operations}
                  />
                </TabsContent>
                <TabsContent value="brand" className="pt-3">
                  <DimensionalGoalsEditor
                    title="Meta u/h por marca"
                    placeholder="Ej: FILA, NIKE…"
                    rows={brandRows}
                    onChange={setBrandRows}
                    operations={operations}
                  />
                </TabsContent>
                <TabsContent value="reference" className="pt-3">
                  <DimensionalGoalsEditor
                    title="Meta u/h por referencia"
                    placeholder="Código de referencia"
                    rows={referenceRows}
                    onChange={setReferenceRows}
                    operations={operations}
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
