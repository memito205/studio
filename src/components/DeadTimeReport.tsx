
"use client";

import React from 'react';
import type { DeadTimeEntry } from '@/types';
import { exportToXlsx } from '@/services/export';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Download, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';


interface DeadTimeReportProps {
  detailData: DeadTimeEntry[];
}

const getStatusVariant = (status: DeadTimeEntry['status']): 'success' | 'warning' | 'destructive' | 'default' => {
    switch (status) {
        case 'Justificado': return 'success';
        case 'Excedente de Descanso': return 'warning';
        case 'No Justificado': return 'destructive';
        default: return 'default';
    }
}

const getStatusIcon = (status: DeadTimeEntry['status']): React.ReactNode => {
    switch(status) {
        case 'Justificado': return <CheckCircle className="h-3.5 w-3.5 -translate-x-1" />;
        case 'Excedente de Descanso': return <AlertTriangle className="h-3.5 w-3.5 -translate-x-1" />;
        case 'No Justificado': return <Clock className="h-3.5 w-3.5 -translate-x-1" />;
        default: return null;
    }
}


export const DeadTimeReport: React.FC<DeadTimeReportProps> = ({ detailData }) => {
    const incidentsByPacker = React.useMemo(() => {
        const unjustifiedIncidents = detailData.filter(d => d.status !== 'Justificado');
        const packerGroups = unjustifiedIncidents.reduce((acc, entry) => {
            if (!acc[entry.packerName]) acc[entry.packerName] = { totalMinutes: 0, incidents: [] };
            acc[entry.packerName].incidents.push(entry);
            acc[entry.packerName].totalMinutes += entry.duration;
            return acc;
        }, {} as { [key: string]: { totalMinutes: number, incidents: DeadTimeEntry[] } });
        
        return Object.entries(packerGroups)
        .map(([packerName, data]) => ({ packerName, ...data }))
        .sort((a, b) => b.totalMinutes - a.totalMinutes);
    }, [detailData]);
  
    const handleExport = () => {
        const dataToExport = detailData.map(d => ({
            'Operario': d.packerName,
            'Inicio': d.startTime.toLocaleString(),
            'Fin': d.endTime.toLocaleString(),
            'Duracion (min)': d.duration,
            'Estado': d.status,
            'Justificacion': d.justification || '-',
        }));
        exportToXlsx(dataToExport, 'detalle_inactividad');
    }

    if (incidentsByPacker.length === 0) {
        return null;
    }

    return (
        <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                    <CardTitle>Detalle de Tiempos Muertos No Justificados (&gt; 5 min)</CardTitle>
                    <CardDescription>
                        Lista detallada de pausas largas sin justificación. Haga clic en un operario para expandir.
                    </CardDescription>
                </div>
                <Button onClick={handleExport} variant="outline" className="flex-shrink-0">
                    <Download />
                    Exportar
                </Button>
            </CardHeader>
            <CardContent>
                <Accordion type="multiple" className="w-full">
                     {incidentsByPacker.map((packerGroup) => (
                        <AccordionItem value={packerGroup.packerName} key={packerGroup.packerName}>
                            <AccordionTrigger className="hover:bg-muted/50 px-4 rounded-md transition-colors">
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 w-full text-left">
                                    <span className="font-semibold col-span-1 sm:col-span-2">{packerGroup.packerName}</span>
                                    <span className="text-center">{packerGroup.incidents.length} <span className="text-muted-foreground hidden sm:inline">incidentes</span></span>
                                    <span className="text-right font-bold">{Math.round(packerGroup.totalMinutes)} <span className="text-muted-foreground font-normal">min</span></span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="bg-muted/40 p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Inicio</TableHead>
                                                <TableHead>Fin</TableHead>
                                                <TableHead className="text-right">Duración</TableHead>
                                                <TableHead>Estado</TableHead>
                                                <TableHead>Razón</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {packerGroup.incidents.map((entry) => (
                                                <TableRow key={entry.id}>
                                                    <TableCell>{entry.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                                                    <TableCell>{entry.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                                                    <TableCell className="text-right font-semibold">{entry.duration}m</TableCell>
                                                    <TableCell>
                                                        <Badge variant={getStatusVariant(entry.status)} className="whitespace-nowrap">
                                                             {getStatusIcon(entry.status)}
                                                             {entry.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground italic">{entry.justification || '-'}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </CardContent>
        </Card>
    );
};
