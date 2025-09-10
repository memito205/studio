
"use client";

import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { HourlyProductivity, PackerHourlyPerformance } from '@/types';

interface HourlyBreakdownTableProps {
  hourlyData: HourlyProductivity[];
  packerPerformance: PackerHourlyPerformance[];
}

export const HourlyBreakdownTable: React.FC<HourlyBreakdownTableProps> = ({ hourlyData, packerPerformance }) => {
  if (!hourlyData || hourlyData.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Desglose de Productividad por Hora</CardTitle>
        <CardDescription>Análisis detallado de unidades y tiempo productivo por cada hora. Expanda para ver detalles por operario.</CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          {hourlyData.map(hourData => {
            const operatorsInHour = packerPerformance.filter(p => p.hourlyDetails[hourData.hour]).map(p => ({
                name: p.packerName,
                units: p.hourlyDetails[hourData.hour].units,
                minutes: p.hourlyDetails[hourData.hour].productiveMinutes,
                productivity: p.hourlyDetails[hourData.hour].productivity
            })).sort((a,b) => b.units - a.units);

            return (
              <AccordionItem value={`item-${hourData.hour}`} key={hourData.hour}>
                <AccordionTrigger>
                  <div className="flex justify-between w-full pr-4 text-left">
                    <span className="font-bold text-lg">Hora: {hourData.hour}:00</span>
                    <div>
                      <span className="font-semibold">{hourData.totalQuantity.toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground"> unidades</span>
                    </div>
                     <div>
                      <span className="font-semibold">{Math.round(hourData.productiveMinutes || 0)}</span>
                      <span className="text-sm text-muted-foreground"> min. productivos</span>
                    </div>
                    <div>
                        <span className="font-semibold">{hourData.operatorCount}</span>
                        <span className="text-sm text-muted-foreground"> operarios</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operario</TableHead>
                        <TableHead className="text-right">Unidades</TableHead>
                        <TableHead className="text-right">Minutos Productivos</TableHead>
                        <TableHead className="text-right">Productividad (u/hr)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {operatorsInHour.map(op => (
                        <TableRow key={op.name}>
                          <TableCell>{op.name}</TableCell>
                          <TableCell className="text-right">{op.units}</TableCell>
                          <TableCell className="text-right">{op.minutes?.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{op.productivity?.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
};

