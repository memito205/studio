
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { DeadTimeSummaryEntry } from '@/types';

interface DeadTimeSummaryReportProps {
  totalData: DeadTimeSummaryEntry[];
  deadTimeData: DeadTimeSummaryEntry[];
  microData: DeadTimeSummaryEntry[];
}

const chartColors = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

const HourlyDistributionBar: React.FC<{ distribution: { [hour: number]: number } }> = ({ distribution }) => {
    const hours = Array.from({ length: 14 }, (_, i) => i + 6); // 6am to 6pm (18:00)
    const totalMinutes = Object.values(distribution).reduce((sum, val) => sum + val, 0);

    if (totalMinutes === 0) {
        return <div className="h-5 bg-muted rounded-md"></div>;
    }

    return (
        <TooltipProvider>
            <div className="flex w-full h-5 bg-muted rounded-md overflow-hidden" title="Distribución de tiempo muerto por hora">
                {hours.map((hour, index) => {
                    const minutesInHour = distribution[hour] || 0;
                    if (minutesInHour === 0) return null;

                    const percentage = (minutesInHour / totalMinutes) * 100;
                    const color = chartColors[index % chartColors.length];

                    return (
                        <Tooltip key={hour} delayDuration={100}>
                            <TooltipTrigger asChild>
                                <div
                                    className={`${color} transition-all duration-300 hover:opacity-80`}
                                    style={{ width: `${percentage}%` }}
                                />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{`${hour}:00 - ${hour + 1}:00: ${Math.round(minutesInHour)} min`}</p>
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </TooltipProvider>
    );
};

const SummaryTable: React.FC<{ data: DeadTimeSummaryEntry[] }> = ({ data }) => {
    if (!data || data.length === 0) {
        return <p className="text-muted-foreground text-center py-8">No hay datos de este tipo para mostrar.</p>;
    }
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Operario</TableHead>
                    <TableHead className="text-center"># Incidentes</TableHead>
                    <TableHead className="text-right">Total (min)</TableHead>
                    <TableHead className="text-right">% Jornada</TableHead>
                    <TableHead className="text-right">% Participación</TableHead>
                    <TableHead className="w-[30%]">Distribución por Hora</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((entry) => (
                    <TableRow key={entry.packerName}>
                        <TableCell className="font-medium">{entry.packerName}</TableCell>
                        <TableCell className="text-center font-semibold">{entry.incidentCount}</TableCell>
                        <TableCell className="text-right font-bold">{Math.round(entry.totalMinutes)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{entry.percentageOfWorkday.toFixed(1)}%</TableCell>
                        <TableCell className="text-right text-muted-foreground">{entry.percentageOfTotalDeadTime.toFixed(1)}%</TableCell>
                        <TableCell>
                            <HourlyDistributionBar distribution={entry.hourlyDistribution} />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

export const DeadTimeSummaryReport: React.FC<DeadTimeSummaryReportProps> = ({ totalData, deadTimeData, microData }) => {
    if ((!totalData || totalData.length === 0) && (!deadTimeData || deadTimeData.length === 0) && (!microData || microData.length === 0)) {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Resumen de Inactividad</CardTitle>
                <CardDescription>
                    Análisis agregado de todas las pausas no productivas. Use las pestañas para ver los detalles.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="total" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="total">Total Inactividad</TabsTrigger>
                        <TabsTrigger value="deadtime">Tiempos Muertos (&gt;5 min)</TabsTrigger>
                        <TabsTrigger value="micropauses">Micro-Pausas (1-5 min)</TabsTrigger>
                    </TabsList>
                    <TabsContent value="total" className="mt-4">
                        <SummaryTable data={totalData} />
                    </TabsContent>
                    <TabsContent value="deadtime" className="mt-4">
                        <SummaryTable data={deadTimeData} />
                    </TabsContent>
                    <TabsContent value="micropauses" className="mt-4">
                        <SummaryTable data={microData} />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
};
