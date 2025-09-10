
"use client";

import React from 'react';
import type { DeadTimeEntry } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface MicroPausesReportProps {
  detailData: DeadTimeEntry[];
}

export const MicroPausesReport: React.FC<MicroPausesReportProps> = ({ detailData }) => {
  const incidentsByPacker = React.useMemo(() => {
    const packerGroups = detailData.reduce((acc, entry) => {
      if (!acc[entry.packerName]) acc[entry.packerName] = { totalMinutes: 0, incidents: [] };
      acc[entry.packerName].incidents.push(entry);
      acc[entry.packerName].totalMinutes += entry.duration;
      return acc;
    }, {} as { [key: string]: { totalMinutes: number, incidents: DeadTimeEntry[] } });
    
    return Object.entries(packerGroups)
      .map(([packerName, data]) => ({ packerName, ...data }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [detailData]);

  if (incidentsByPacker.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detalle de Micro-Pausas (1-5 min)</CardTitle>
        <CardDescription>
          Análisis de pausas cortas que interrumpen el flujo de trabajo. Haga clic en un operario para expandir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {incidentsByPacker.map((packerGroup) => (
            <AccordionItem value={packerGroup.packerName} key={packerGroup.packerName}>
              <AccordionTrigger className="hover:bg-muted/50 px-4 rounded-md transition-colors">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 w-full text-left">
                  <span className="font-semibold col-span-1 sm:col-span-2">{packerGroup.packerName}</span>
                  <span className="text-center">{packerGroup.incidents.length} <span className="text-muted-foreground hidden sm:inline">pausas</span></span>
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
                        <TableHead className="text-right">Duración (min)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {packerGroup.incidents.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{entry.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                          <TableCell>{entry.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                          <TableCell className="text-right font-semibold">{entry.duration}</TableCell>
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
