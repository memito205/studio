"use client";

import type { PackerHourlyPerformance } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface HourlyPerformanceHeatmapProps {
  data: PackerHourlyPerformance[];
}

const getComplianceColor = (compliance: number | undefined | null): string => {
  if (compliance === undefined || compliance === null) return 'bg-muted/30';
  if (compliance >= 100) return 'bg-green-500/80 text-white';
  if (compliance >= 95) return 'bg-green-400/70 text-green-950';
  if (compliance >= 90) return 'bg-yellow-400/70 text-yellow-950';
  if (compliance >= 85) return 'bg-amber-500/70 text-amber-950';
  return 'bg-red-500/70 text-white'; // Any compliance < 85% (including 0) will be red
};

const HeatmapLegend = () => (
    <div className="flex justify-end items-center gap-2 mt-4 text-xs text-muted-foreground">
        <span>Bajo</span>
        <div className="flex rounded-md overflow-hidden border">
            <div className="w-5 h-4" style={{ backgroundColor: 'hsl(var(--destructive))', opacity: 0.7 }}></div>
            <div className="w-5 h-4" style={{ backgroundColor: 'hsl(var(--chart-5))', opacity: 0.7 }}></div>
            <div className="w-5 h-4" style={{ backgroundColor: 'hsl(var(--chart-4))', opacity: 0.7 }}></div>
            <div className="w-5 h-4" style={{ backgroundColor: 'hsl(var(--chart-2))', opacity: 0.7 }}></div>
            <div className="w-5 h-4" style={{ backgroundColor: 'hsl(var(--chart-2))', opacity: 0.9 }}></div>
        </div>
        <span>Alto</span>
    </div>
);

export const HourlyPerformanceHeatmap: React.FC<HourlyPerformanceHeatmapProps> = ({ data }) => {
  if (!data || data.length === 0) return null;

  const allHours = new Set<number>();
  data.forEach(p => Object.keys(p.hourlyDetails).forEach(h => allHours.add(Number(h))));
  const hours = Array.from(allHours).sort((a, b) => a - b);

  if (hours.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mapa de Calor de Rendimiento por Hora</CardTitle>
        <CardDescription>Detecte patrones de rendimiento a lo largo del día. El color indica el cumplimiento.</CardDescription>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
            <Table className="border-collapse border-spacing-0">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left sticky left-0 bg-card z-10 w-[150px]">Operario</TableHead>
                  {hours.map(hour => (
                    <TableHead key={hour} className="text-center p-2">{`${hour}:00`}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(({ packerName, hourlyDetails }) => (
                  <TableRow key={packerName}>
                    <TableCell className="font-medium text-left sticky left-0 bg-card z-10 whitespace-nowrap">
                      {packerName}
                    </TableCell>
                    {hours.map(hour => {
                      const detail = hourlyDetails[hour];
                      return (
                        <TableCell key={hour} className="p-0.5">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className={`w-full h-14 rounded-md flex flex-col justify-center items-center text-center transition-colors cursor-default ${getComplianceColor(detail?.compliance)}`}>
                                      {detail && (
                                        <>
                                            <span className="font-bold text-sm">{detail.units}</span>
                                            <span className="text-xs opacity-90">{detail.compliance.toFixed(0)}%</span>
                                        </>
                                      )}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <div className="text-center">
                                        <p className="font-bold">{`Hora: ${hour}:00`}</p>
                                        {detail ? (
                                            <>
                                                <p>Unidades: {detail.units}</p>
                                                <p>Productividad: {detail.productivity.toFixed(1)} u/hr</p>
                                                <p>Cumplimiento: {detail.compliance.toFixed(1)}%</p>
                                            </>
                                        ) : (
                                            <p>Sin actividad registrada</p>
                                        )}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </TooltipProvider>
        <HeatmapLegend />
      </CardContent>
    </Card>
  );
};
