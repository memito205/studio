
"use client";

import React from 'react';
import type { ProcessedReportData } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, CheckCircle, Clock, Package, Trophy } from 'lucide-react';
import { StatCard } from './StatCard';
import { Progress } from './ui/progress';

interface PlantViewProps {
  data: ProcessedReportData;
  onReturnToDashboard: () => void;
  theme: 'light' | 'dark';
}

export const PlantView: React.FC<PlantViewProps> = ({ data, onReturnToDashboard, theme }) => {
  const { packerProductivity, overallCompliance } = data;

  const totalPairs = packerProductivity.reduce((sum, packer) => sum + packer.totalQuantity, 0);
  const totalHours = packerProductivity.reduce((sum, packer) => sum + packer.hoursWorked, 0);
  const avgProductivity = totalHours > 0 ? totalPairs / totalHours : 0;
  
  const getComplianceColor = (compliance: number): string => {
    if (compliance >= 100) return 'text-green-500';
    if (compliance >= 85) return 'text-amber-500';
    return 'text-red-500';
  };
  
  const getProgressColor = (compliance: number): string => {
    if (compliance >= 100) return 'bg-green-500';
    if (compliance >= 85) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-6 bg-slate-100 dark:bg-gray-900 p-4 sm:p-6 lg:p-8 rounded-lg">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col md:flex-row justify-between items-center text-center md:text-left">
          <div>
            <CardTitle className="text-3xl md:text-5xl font-extrabold text-foreground">
              Productividad del Día
            </CardTitle>
            <CardDescription className="text-lg md:text-xl text-muted-foreground mt-2">
              Resumen del rendimiento del equipo de empaque.
            </CardDescription>
          </div>
          <Button onClick={onReturnToDashboard} variant="outline" size="lg" className="mt-4 md:mt-0">
            <ArrowLeft className="mr-2 h-5 w-5" />
            Volver al Dashboard
          </Button>
        </CardHeader>
      </Card>

       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Unidades Totales" value={totalPairs.toLocaleString()} icon={<Package />} color="text-amber-500" />
          <StatCard title="Operarios Activos" value={String(packerProductivity.length)} icon={<Clock />} color="text-blue-500" />
          <StatCard title="Productividad Media" value={`${avgProductivity.toFixed(2)} u/hr`} icon={<CheckCircle />} color="text-green-500" />
          <StatCard title="Cumplimiento General" value={`${overallCompliance.toFixed(1)}%`} icon={<Trophy />} color={getComplianceColor(overallCompliance)} />
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Ranking de Productividad</CardTitle>
        </CardHeader>
        <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-12 text-lg">#</TableHead>
                        <TableHead className="text-lg">Operario</TableHead>
                        <TableHead className="text-center text-lg">Productividad (u/hr)</TableHead>
                        <TableHead className="w-1/4 text-lg">Cumplimiento</TableHead>
                        <TableHead className="text-right text-lg">Unidades Totales</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {packerProductivity.map((packer, index) => (
                        <TableRow key={packer.packerName} className="h-16">
                            <TableCell className="text-2xl font-bold text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="text-xl font-semibold">{packer.packerName}</TableCell>
                            <TableCell className="text-center text-2xl font-bold">{packer.productivity.toFixed(1)}</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Progress value={packer.compliance} className="h-4 w-full" indicatorClassName={getProgressColor(packer.compliance)} />
                                    <span className={`text-xl font-bold w-24 text-right ${getComplianceColor(packer.compliance)}`}>
                                        {packer.compliance.toFixed(1)}%
                                    </span>
                                </div>
                            </TableCell>
                            <TableCell className="text-right text-2xl font-bold">{packer.totalQuantity.toLocaleString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
};
