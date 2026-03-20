/** @jsxImportSource react */
import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from '@/components/ui/skeleton';
import { getAllPauses, loadReceptionOperations, getAllUserProfiles } from '@/app/reception/actions';
import { showError } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar as CalendarIcon, ArrowLeft, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { AppUser, ReceptionOperation, OperationPause } from '@/types';
import { useAuth } from '@/hooks/use-auth-context';
import { ManualPauseDialog } from './ManualPauseDialog';

interface PauseReportEntry extends OperationPause {
  operation_rk_identifier: string;
  duration_minutes: number;
  userName: string;
}

interface TimeReportsProps {
    onReturn: () => void;
}

export const TimeReports: React.FC<TimeReportsProps> = ({ onReturn }) => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [pauseReports, setPauseReports] = useState<PauseReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { role } = useAuth();
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
        const users = await getAllUserProfiles();

        const userMap = new Map(users.map(u => [u.uid, u.displayName || u.email || 'Desconocido']));
        setAllUsers(users);
        
        let pausesResult = await getAllPauses();
        let allPauses = pausesResult.data || [];
        const operationsResult = await loadReceptionOperations({ statusFilter: ['pending', 'in_progress', 'completed', 'cancelled'] });
        const allOperations = operationsResult.data?.operations || [];
        
        const opsMap = new Map(allOperations.map(op => [op.id, op]));

        const filteredPauses = allPauses.filter(p => isSameDay(new Date(p.start_time), selectedDate));
        
        const processedPauseReports: PauseReportEntry[] = filteredPauses.map(pause => {
            const endTime = pause.end_time ? new Date(pause.end_time) : new Date();
            const duration_minutes = (endTime.getTime() - new Date(pause.start_time).getTime()) / 60000;
            return {
                ...pause,
                operation_rk_identifier: opsMap.get(pause.reception_id)?.rk_identifier || 'N/A',
                duration_minutes,
                userName: userMap.get(pause.user_id) || pause.user_id
            };
        });
        setPauseReports(processedPauseReports);
        
    } catch (error: any) {
        showError("Error cargando los reportes de pausas", error.message);
    } finally {
        setLoading(false);
    }
  }, [selectedDate]);


  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return (
    <div className="space-y-8">
      <Card className="w-full">
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle className="text-2xl">Reporte de Pausas Registradas</CardTitle>
            <CardDescription>Consulta las pausas manuales o automáticas (ej. por inactividad) registradas en las operaciones.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {role === 'admin' && (
                <ManualPauseDialog onPauseCreated={fetchReports}>
                    <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Registrar Pausa Manual</Button>
                </ManualPauseDialog>
            )}
            <Button onClick={onReturn} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Gestión
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant={"outline"} className={cn("w-[280px] justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP", { locale: es }) : <span>Selecciona una fecha</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} initialFocus locale={es} /></PopoverContent>
            </Popover>
          </div>

            <div className="mt-4">
                 {loading ? <Skeleton className="h-64 w-full" /> : (
                     pauseReports.length === 0 ? <p className="text-center text-muted-foreground py-8">No hay pausas registradas para esta fecha.</p> : (
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Operación (RK)</TableHead><TableHead>Razón</TableHead><TableHead>Inicio</TableHead><TableHead>Fin</TableHead><TableHead className="text-right">Duración (min)</TableHead></TableRow></TableHeader>
                                <TableBody>{pauseReports.map((p, i) => <TableRow key={i}><TableCell>{p.userName}</TableCell><TableCell>{p.operation_rk_identifier}</TableCell><TableCell>{p.pause_reason}</TableCell><TableCell>{new Date(p.start_time).toLocaleString()}</TableCell><TableCell>{p.end_time ? new Date(p.end_time).toLocaleString() : <Badge variant="destructive">Activa</Badge>}</TableCell><TableCell className="text-right font-semibold">{p.duration_minutes.toFixed(2)}</TableCell></TableRow>)}</TableBody>
                            </Table>
                        </div>
                     )
                 )}
            </div>
        </CardContent>
      </Card>
    </div>
  );
};
