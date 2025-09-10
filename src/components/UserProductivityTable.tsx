/** @jsxImportSource react */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import type { UserProductivity } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

interface UserProductivityTableProps {
  data: UserProductivity[];
  goal: number | null;
  onViewPauses: (user: UserProductivity) => void;
}

export const UserProductivityTable: React.FC<UserProductivityTableProps> = ({ data, goal, onViewPauses }) => {
    
    const getComplianceBadgeClass = (compliance: number): string => {
        if (compliance >= 100) return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30';
        if (compliance >= 85) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30';
        return 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30';
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Productividad por Usuario</CardTitle>
                <CardDescription>Resumen del rendimiento individual de cada operario en esta operación. Meta: {goal?.toFixed(0) || 'N/A'} u/h.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Usuario</TableHead>
                            <TableHead className="text-right">Unidades Leídas</TableHead>
                            <TableHead className="text-right">Tiempo Efectivo (min)</TableHead>
                            <TableHead className="text-center">Nº Pausas</TableHead>
                            <TableHead className="text-right">Productividad (u/h)</TableHead>
                            <TableHead className="text-right">Cumplimiento</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.length === 0 ? (
                           <TableRow>
                               <TableCell colSpan={6} className="text-center text-muted-foreground">No hay datos de productividad para mostrar.</TableCell>
                           </TableRow>
                        ) : data.map(user => (
                            <TableRow key={user.userId}>
                                <TableCell className="font-medium">{user.userName}</TableCell>
                                <TableCell className="text-right">{user.totalScanned}</TableCell>
                                <TableCell className="text-right">{user.effectiveTimeMinutes.toFixed(2)}</TableCell>
                                <TableCell className="text-center">
                                    <Button variant="link" onClick={() => onViewPauses(user)} className="p-0 h-auto">
                                        {user.pausesCount}
                                    </Button>
                                </TableCell>
                                <TableCell className="text-right font-semibold">{user.productivityPerHour.toFixed(1)}</TableCell>
                                <TableCell className="text-right">
                                    <Badge className={cn("text-base", getComplianceBadgeClass(user.compliance))}>
                                        {user.compliance.toFixed(1)}%
                                    </Badge>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};
