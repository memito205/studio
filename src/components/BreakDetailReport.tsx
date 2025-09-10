
"use client";

import type { DetectedBreakDetail } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Coffee, Utensils, Cookie } from 'lucide-react';

interface BreakDetailReportProps {
  data: DetectedBreakDetail[];
}

const breakTypeInfo = {
    BREAKFAST: { label: 'Desayuno', icon: <Coffee className="h-5 w-5 text-muted-foreground" /> },
    LUNCH: { label: 'Almuerzo', icon: <Utensils className="h-5 w-5 text-muted-foreground" /> },
    SNACK: { label: 'Refrigerio', icon: <Cookie className="h-5 w-5 text-muted-foreground" /> }
};

const getDetailText = (entry: DetectedBreakDetail) => {
    if (entry.status === 'Asignado' && entry.assignedDeadTime) {
        const { startTime, endTime } = entry.assignedDeadTime;
        const primaryText = `Asignado a inactividad: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

        const durationText = `Duración total de la pausa: ${entry.actualDuration} min.`;
        let excessText = '';
        if (entry.excessDuration && entry.excessDuration > 0) {
            excessText = ` (${entry.excessDuration} min. como tiempo excedente)`;
        }
        return (
            <div>
                <p>{primaryText}</p>
                <p className="text-xs text-muted-foreground mt-1">{`${durationText}${excessText}`}</p>
            </div>
        );
    }
    
    return <span className="text-muted-foreground">-</span>;
};


export const BreakDetailReport: React.FC<BreakDetailReportProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return null;
  }

  const sortedData = [...data].sort((a, b) => {
    if (a.packerName < b.packerName) return -1;
    if (a.packerName > b.packerName) return 1;
    const order = { 'BREAKFAST': 1, 'LUNCH': 2, 'SNACK': 3 };
    return order[a.breakType] - order[b.breakType];
  });


  return (
     <Card>
        <CardHeader>
            <CardTitle>Reporte Detallado de Descansos</CardTitle>
            <CardDescription>Auditoría de cómo se aplicaron los descansos para cada operario.</CardDescription>
        </CardHeader>
        <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operario</TableHead>
                  <TableHead>Tipo de Descanso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Detalle de Aplicación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((entry) => (
                  <TableRow key={`${entry.packerName}-${entry.breakType}`}>
                    <TableCell className="font-medium">{entry.packerName}</TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2">
                            {breakTypeInfo[entry.breakType].icon}
                            <span>{breakTypeInfo[entry.breakType].label}</span>
                        </div>
                    </TableCell>
                    <TableCell>
                        <Badge variant={entry.status === 'Asignado' ? 'default' : 'secondary'}>
                            {entry.status}
                        </Badge>
                    </TableCell>
                    <TableCell>
                      {getDetailText(entry)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </CardContent>
    </Card>
  );
};
