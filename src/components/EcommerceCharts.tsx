/** @jsxImportSource react */
"use client";

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Dot, LabelList } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { EcommerceOrder, FilterCategory } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { OtherDetailsDialog } from './OtherDetailsDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '@/lib/utils';

const processDistributionData = (data: { name: string; value: number }[], topN = 7) => {
    if (data.length <= topN + 1) {
        return data;
    }
    const topData = data.slice(0, topN);
    const otherData = data.slice(topN);
    const otherSum = otherData.reduce((sum, item) => sum + item.value, 0);
    
    if (otherSum > 0) {
        return [...topData, { name: 'Otros', value: otherSum }];
    }
    return topData;
};

interface DistributionTableProps {
  title: string;
  data: { name: string; value: number }[];
  totalOrders: number;
  onRowClick: (name: string) => void;
  isPrinting?: boolean;
}

const DistributionTable: React.FC<DistributionTableProps> = ({ title, data, totalOrders, onRowClick, isPrinting }) => (
    <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className={cn(!isPrinting && "h-[350px]")}>
            <ScrollArea className={cn(!isPrinting && "h-full")}>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Categoría</TableHead>
                            <TableHead className="text-right">Pedidos</TableHead>
                            <TableHead className="text-right">% Participación</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map(item => (
                            <TableRow key={item.name} onClick={() => onRowClick(item.name)} className="cursor-pointer hover:bg-muted/50">
                                <TableCell className="font-medium">{item.name}</TableCell>
                                <TableCell className="text-right">{item.value.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{totalOrders > 0 ? ((item.value / totalOrders) * 100).toFixed(1) : '0.0'}%</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </CardContent>
    </Card>
);

interface EcommerceChartsProps {
  orders: EcommerceOrder[];
  onDrilldown: (type: FilterCategory, value: string) => void;
  totalOrders: number;
  isPrinting?: boolean;
}

export const EcommerceCharts: React.FC<EcommerceChartsProps> = ({ orders, onDrilldown, totalOrders, isPrinting }) => {
  const [otherDetails, setOtherDetails] = useState<{ open: boolean, title: string, data: { name: string; value: number }[] }>({ open: false, title: '', data: [] });
  const topN = 7;

  const distributionByStoreRaw = useMemo(() => {
    const storeMap = new Map<string, number>();
    orders.forEach(order => {
      storeMap.set(order.tienda, (storeMap.get(order.tienda) || 0) + 1);
    });
    return Array.from(storeMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a,b) => b.value - a.value);
  }, [orders]);

  const distributionByStore = useMemo(() => {
    return isPrinting ? distributionByStoreRaw : processDistributionData(distributionByStoreRaw, topN);
  }, [distributionByStoreRaw, isPrinting]);

  const othersByStore = useMemo(() => {
    if (distributionByStoreRaw.length <= topN + 1) return [];
    return distributionByStoreRaw.slice(topN);
  }, [distributionByStoreRaw]);

  const distributionByCarrierRaw = useMemo(() => {
    const carrierMap = new Map<string, number>();
    orders.forEach(order => {
        if(order.transportadora && order.transportadora !== 'N/A') {
            carrierMap.set(order.transportadora, (carrierMap.get(order.transportadora) || 0) + 1);
        }
    });
    return Array.from(carrierMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a,b) => b.value - a.value);
  }, [orders]);

  const distributionByCarrier = useMemo(() => {
    return isPrinting ? distributionByCarrierRaw : processDistributionData(distributionByCarrierRaw, topN);
  }, [distributionByCarrierRaw, isPrinting]);
  
  const othersByCarrier = useMemo(() => {
    if (distributionByCarrierRaw.length <= topN + 1) return [];
    return distributionByCarrierRaw.slice(topN);
  }, [distributionByCarrierRaw]);

  const trendByDay = useMemo(() => {
      const dayMap = new Map<string, number>();
      orders.forEach(order => {
          if (order.fechaPedido) {
              const dayKey = format(new Date(order.fechaPedido), 'yyyy-MM-dd');
              dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);
          }
      });
      return Array.from(dayMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a,b) => new Date(a.name).getTime() - new Date(b.name).getTime());
  }, [orders]);
  
  const trendStats = useMemo(() => {
    if (trendByDay.length === 0) {
        return { average: 0, peak: 0, valley: 0 };
    }
    const values = trendByDay.map(d => d.value);
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const peak = Math.max(...values);
    const valley = Math.min(...values);
    return { average, peak, valley };
  }, [trendByDay]);

  const CustomizedDot = (props: any) => {
      const { cx, cy, payload, value } = props;

      if (value === trendStats.peak && trendByDay.length > 1) {
          return <Dot cx={cx} cy={cy} r={6} fill="hsl(var(--chart-2))" stroke="white" strokeWidth={2} />;
      }
      if (value === trendStats.valley && trendByDay.length > 1) {
          return <Dot cx={cx} cy={cy} r={6} fill="hsl(var(--destructive))" stroke="white" strokeWidth={2} />;
      }

      return <Dot cx={cx} cy={cy} r={3} fill="hsl(var(--chart-1))" />;
  };

  const handleTableRowClick = (name: string, allOthersData: { name: string; value: number }[], title: string, category: FilterCategory) => {
    if (name === 'Otros') {
        setOtherDetails({
            open: true,
            title: `Detalle de 'Otros' - ${title}`,
            data: allOthersData
        });
    } else {
        onDrilldown(category, name);
    }
  };


  return (
    <>
      <OtherDetailsDialog
        open={otherDetails.open}
        onOpenChange={(isOpen) => setOtherDetails(prev => ({ ...prev, open: isOpen }))}
        title={otherDetails.title}
        data={otherDetails.data}
      />
      <div className={cn("grid grid-cols-1 gap-8", !isPrinting && "lg:grid-cols-2")}>
        <DistributionTable
            title="Participación por Tienda"
            data={distributionByStore}
            totalOrders={totalOrders}
            onRowClick={(name) => handleTableRowClick(name, othersByStore, 'Tienda', 'tienda')}
            isPrinting={isPrinting}
        />
        <DistributionTable
            title="Participación por Transportadora"
            data={distributionByCarrier}
            totalOrders={totalOrders}
            onRowClick={(name) => handleTableRowClick(name, othersByCarrier, 'Transportadora', 'transportadora')}
            isPrinting={isPrinting}
        />
        
        <Card className={cn(!isPrinting && "lg:col-span-2")}>
              <CardHeader>
                  <CardTitle>Tendencia de Pedidos por Día</CardTitle>
              </CardHeader>
              <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendByDay} onClick={(e) => { if (e?.activeLabel) onDrilldown('date', e.activeLabel); }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" tickFormatter={(str) => format(new Date(str), 'dd/MMM', { locale: es })} />
                          <YAxis />
                          <Tooltip labelFormatter={(label) => format(new Date(label), 'PPP', { locale: es })} />
                          <Legend />
                          <ReferenceLine y={trendStats.average} label={{ value: `Promedio: ${trendStats.average.toFixed(0)}`, position: 'insideTopLeft' }} stroke="hsl(var(--chart-4))" strokeDasharray="3 3" />
                          <Line type="monotone" dataKey="value" name="Pedidos" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={<CustomizedDot />}>
                            <LabelList dataKey="value" position="top" style={{ fontSize: '10px', fill: 'hsl(var(--foreground))' }} />
                          </Line>
                      </LineChart>
                  </ResponsiveContainer>
              </CardContent>
        </Card>
      </div>
    </>
  );
};
