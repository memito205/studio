
"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, CheckCircle, Percent } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { loadReceptionOperations, getAllScannedItems } from '@/app/actions';
import type { ReceptionOperation, ScannedItem } from '@/types';
import { Button } from './ui/button';
import { ArrowLeft } from 'lucide-react';

interface DashboardMetrics {
  totalOperations: number;
  pendingOperations: number;
  inProgressOperations: number;
  completedOperations: number;
  cancelledOperations: number;
  totalScannedItems: number;
  averageCompliance: number;
}

const initialMetrics: DashboardMetrics = {
  totalOperations: 0,
  pendingOperations: 0,
  inProgressOperations: 0,
  completedOperations: 0,
  cancelledOperations: 0,
  totalScannedItems: 0,
  averageCompliance: 0,
};

interface ReceptionDashboardProps {
    onReturn: () => void;
}

export const ReceptionDashboard: React.FC<ReceptionDashboardProps> = ({ onReturn }) => {
  const [metrics, setMetrics] = useState<DashboardMetrics>(initialMetrics);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchDashboardMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [opsResult, scannedItemsResult] = await Promise.all([
          loadReceptionOperations({ limit: 10000 }), // Fetch all operations for dashboard
          getAllScannedItems()
      ]);

      if (!opsResult.success || !opsResult.data) {
        throw new Error(opsResult.error || 'Failed to load operations');
      }
      if (!scannedItemsResult.success || !scannedItemsResult.data) {
          throw new Error(scannedItemsResult.error || 'Failed to load scanned items');
      }
      
      const allOperations = opsResult.data.operations;
      const allScannedItems = scannedItemsResult.data;

      const totalOperations = allOperations.length;
      const pendingOperations = allOperations.filter(op => op.status === 'pending').length;
      const inProgressOperations = allOperations.filter(op => op.status === 'in_progress').length;
      const completedOperations = allOperations.filter(op => op.status === 'completed').length;
      const cancelledOperations = allOperations.filter(op => op.status === 'cancelled').length;

      const totalScannedItems = allScannedItems.reduce((sum, item) => sum + item.quantity, 0);

      const operationsWithExpectedQty = allOperations.filter(op => op.expected_quantity > 0 && op.status === 'completed');
      let totalCompliance = 0;
      if (operationsWithExpectedQty.length > 0) {
        operationsWithExpectedQty.forEach(op => {
            const itemsForOp = allScannedItems.filter(item => item.reception_id === op.id);
            const scannedForOp = itemsForOp.reduce((sum, item) => sum + item.quantity, 0);
            totalCompliance += (scannedForOp / op.expected_quantity) * 100;
        });
      }
      const averageCompliance = operationsWithExpectedQty.length > 0 ? totalCompliance / operationsWithExpectedQty.length : 0;
      
      setMetrics({
        totalOperations,
        pendingOperations,
        inProgressOperations,
        completedOperations,
        cancelledOperations,
        totalScannedItems,
        averageCompliance,
      });

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      setMetrics(initialMetrics);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDashboardMetrics();
    const interval = setInterval(() => fetchDashboardMetrics(), 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchDashboardMetrics]);

  const operationStatusData = [
    { name: 'Pendientes', value: metrics.pendingOperations },
    { name: 'En Curso', value: metrics.inProgressOperations },
    { name: 'Completadas', value: metrics.completedOperations },
    { name: 'Canceladas', value: metrics.cancelledOperations },
  ];

  const COLORS = ['#FFBB28', '#00C49F', '#0088FE', '#FF8042'];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
        <Button onClick={onReturn} variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Volver a Operaciones</Button>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Operaciones</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalOperations}</div>
            <p className="text-xs text-muted-foreground">{metrics.inProgressOperations} en curso</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items Leídos</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalScannedItems.toLocaleString()}</div>
             <p className="text-xs text-muted-foreground">En operaciones no canceladas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cumplimiento Promedio</CardTitle>
            <Percent className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.averageCompliance.toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">En operaciones completadas</p>
          </CardContent>
        </Card>
      </div>

       <Card>
        <CardHeader>
            <CardTitle>Operaciones por Estado</CardTitle>
        </CardHeader>
        <CardContent className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                data={operationStatusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                {operationStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
            </ResponsiveContainer>
        </CardContent>
        </Card>
    </div>
  );
};
