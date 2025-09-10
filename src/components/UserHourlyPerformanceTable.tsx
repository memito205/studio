/** @jsxImportSource react */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ReceptionOperation } from '@/types'; // Assuming this type exists

interface UserHourlyPerformance {
  userId: string;
  userName: string;
  hourlyProductivity: { [hourKey: string]: { units: number; productivity: number; compliance: number, trend: number | null, productiveMinutes: number } };
}

interface UserHourlyPerformanceTableProps {
  data: UserHourlyPerformance[];
  hours: string[];
}

export const UserHourlyPerformanceTable: React.FC<UserHourlyPerformanceTableProps> = ({ data, hours }) => {
    const getComplianceColorClass = (compliance: number): string => {
        if (compliance >= 100) return 'bg-green-500/10 text-green-700 dark:text-green-300';
        if (compliance >= 85) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
        return 'bg-red-500/10 text-red-700 dark:text-red-300';
    };

    const formatHourKey = (hourKey: string) => {
        // hourKey is "YYYY-MM-DDTHH"
        const datePart = hourKey.split('T')[0];
        const hourPart = hourKey.split('T')[1];
        const date = new Date(datePart);
        // Display as DD/MM HH:00
        return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2, '0')} ${hourPart}:00`;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Rendimiento por Hora</CardTitle>
                <CardDescription>Productividad (unidades/hora) y cumplimiento de cada operario a lo largo de la jornada.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">Operario</TableHead>
                                {hours.map(hourKey => <TableHead key={hourKey} className="text-center">{formatHourKey(hourKey)}</TableHead>)}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map(user => (
                                <TableRow key={user.userId}>
                                    <TableCell className="font-medium">{user.userName}</TableCell>
                                    {hours.map(hourKey => {
                                        const perf = user.hourlyProductivity[hourKey];
                                        return (
                                            <TableCell key={hourKey} className="text-center p-2">
                                                {perf && perf.productiveMinutes > 0 ? (
                                                  <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className={cn("flex flex-col items-center p-2 rounded-md", getComplianceColorClass(perf.compliance))}>
                                                                <span className="font-bold">{perf.units} uds</span>
                                                                <span className="text-xs text-muted-foreground">{perf.productivity.toFixed(1)} u/h</span>
                                                                <span className="text-xs font-semibold">{perf.compliance.toFixed(1)}%</span>
                                                            </div>
                                                        </TooltipTrigger>
                                                         <TooltipContent>
                                                            <p>Productividad: {perf.productivity.toFixed(1)} u/h</p>
                                                            <p>Cumplimiento: {perf.compliance.toFixed(1)}%</p>
                                                            <p>Minutos Efectivos: {perf.productiveMinutes.toFixed(2)} min</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                  </TooltipProvider>
                                                ) : <span className="text-muted-foreground">-</span>}
                                            </TableCell>
                                        )
                                    })}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};
