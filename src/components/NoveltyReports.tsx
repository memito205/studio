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
import { getAllNovelties, loadReceptionOperations, getAllUserProfiles } from '@/app/reception/actions';
import { showError } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LineChart,
  Line,
} from 'recharts';
import { Calendar as CalendarIcon, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ItemNovelty, AppUser, ReceptionOperation } from '@/types';


interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  role?: string;
}

interface NoveltyReportEntry extends ItemNovelty {
  operation_rk_identifier: string;
  userName: string;
}

type NoveltyStatusVariant = { variant: 'default' | 'secondary' | 'destructive'; className: string };

interface DailyNoveltyData {
  date: string;
  count: number;
}

interface UserNoveltyData {
  userId: string;
  userName: string; // To display user email/name
  count: number;
}

interface NoveltyTypeDistributionData {
  type: string;
  count: number;
}

interface NoveltyReportsProps {
    onReturn: () => void;
}

export const NoveltyReports: React.FC<NoveltyReportsProps> = ({ onReturn }) => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [novelties, setNovelties] = useState<NoveltyReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  const [dailyNoveltyData, setDailyNoveltyData] = useState<DailyNoveltyData[]>([]);
  const [userNoveltyData, setUserNoveltyData] = useState<UserNoveltyData[]>([]);
  const [noveltyTypeDistribution, setNoveltyTypeDistribution] = useState<NoveltyTypeDistributionData[]>([]);
  
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [allUsersMap, setAllUsersMap] = useState<Map<string, string>>(new Map());
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>('all');

  useEffect(() => {
    const fetchUsers = async () => {
      const usersResult = await getAllUserProfiles();
      if(usersResult) {
        setAllUsers(usersResult);
        const userMap = new Map<string, string>();
        usersResult.forEach(u => userMap.set(u.uid, u.displayName || u.email || u.uid));
        setAllUsersMap(userMap);
      } else {
        showError('Error al cargar usuarios para el filtro.');
      }
    };
    fetchUsers();
  }, []);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      let noveltiesResult = await getAllNovelties();
      
      if(!noveltiesResult.success || !noveltiesResult.data) {
          throw new Error(noveltiesResult.error || "Failed to fetch novelties");
      }
      
      let fetchedNovelties = noveltiesResult.data;

      // Filter by date
      fetchedNovelties = fetchedNovelties.filter(n => 
        n.created_at && isSameDay(new Date(n.created_at), selectedDate)
      );

      // Filter by user
      if (selectedUserFilter !== 'all') {
        fetchedNovelties = fetchedNovelties.filter(n => n.user_id === selectedUserFilter);
      }

      const receptionIds = [...new Set(fetchedNovelties.map(n => n.reception_id))];
      const operationsMap = new Map<string, ReceptionOperation>();
      if (receptionIds.length > 0) {
          const operationsResult = await loadReceptionOperations();
          if (operationsResult.success && operationsResult.data) {
              operationsResult.data.operations.forEach(op => {
                  if (receptionIds.includes(op.id)) {
                      operationsMap.set(op.id, op);
                  }
              });
          }
      }

      const processedNovelties: NoveltyReportEntry[] = fetchedNovelties.map(novelty => ({
        ...novelty,
        operation_rk_identifier: operationsMap.get(novelty.reception_id)?.rk_identifier || 'N/A',
        userName: allUsersMap.get(novelty.user_id) || novelty.user_id,
      }));
      setNovelties(processedNovelties);
    } catch (error: any) {
      showError('Error al cargar los reportes de novedades.', error.message);
      setNovelties([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedUserFilter, allUsersMap]);

  const fetchDashboardAnalytics = useCallback(async () => {
    setLoadingDashboard(true);
    try {
      let noveltiesResult = await getAllNovelties();
      if(!noveltiesResult.success || !noveltiesResult.data) {
          throw new Error(noveltiesResult.error || "Failed to fetch novelties for dashboard");
      }
      let allNovelties = noveltiesResult.data;

      if (selectedUserFilter !== 'all') {
        allNovelties = allNovelties.filter(n => n.user_id === selectedUserFilter);
      }

      const dailyDataMap = new Map<string, { count: number }>();
      const userDataMap = new Map<string, { count: number }>();
      const typeDataMap = new Map<string, number>();

      allNovelties.forEach(novelty => {
        const dateKey = format(new Date(novelty.created_at!), 'yyyy-MM-dd');
        dailyDataMap.set(dateKey, { count: (dailyDataMap.get(dateKey)?.count || 0) + 1 });

        userDataMap.set(novelty.user_id, { count: (userDataMap.get(novelty.user_id)?.count || 0) + 1 });

        typeDataMap.set(novelty.novelty_type, (typeDataMap.get(novelty.novelty_type) || 0) + 1);
      });

      const sortedDailyData = Array.from(dailyDataMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setDailyNoveltyData(sortedDailyData);

      const sortedUserData = Array.from(userDataMap.entries())
        .map(([userId, data]) => ({ userId, userName: allUsersMap.get(userId) || userId, ...data }))
        .sort((a, b) => b.count - a.count);
      setUserNoveltyData(sortedUserData);

      const sortedTypeData = Array.from(typeDataMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
      setNoveltyTypeDistribution(sortedTypeData);

    } catch (error: any) {
      showError(`Error al cargar los datos del dashboard de novedades: ${error.message}`);
      setDailyNoveltyData([]);
      setUserNoveltyData([]);
      setNoveltyTypeDistribution([]);
    } finally {
      setLoadingDashboard(false);
    }
  }, [selectedUserFilter, allUsersMap]);

  useEffect(() => {
    fetchReports();
    fetchDashboardAnalytics();
  }, [fetchReports, fetchDashboardAnalytics]);

  const getStatusVariant = (status: ItemNovelty['status']): NoveltyStatusVariant => {
    switch (status) {
      case 'pending':
        return { variant: 'secondary', className: 'bg-orange-500 text-white' };
      case 'resolved':
        return { variant: 'default', className: 'bg-green-500 text-white' };
      case 'ignored':
        return { variant: 'destructive', className: 'bg-red-500 text-white' };
      default:
        return { variant: 'default', className: '' };
    }
  };

  const PIE_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  return (
    <div className="space-y-8">
      <Card className="w-full">
        <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-2xl">Reporte y Analítica de Novedades</CardTitle>
              <CardDescription>Consulta todas las novedades registradas y visualiza tendencias.</CardDescription>
            </div>
            <Button onClick={onReturn} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Gestión
            </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[280px] justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP", { locale: es }) : <span>Selecciona una fecha</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                  locale={es}
                />
              </PopoverContent>
            </Popover>
            <Select onValueChange={setSelectedUserFilter} value={selectedUserFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filtrar por Usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los Usuarios</SelectItem>
                {allUsers.map(user => (
                  <SelectItem key={user.uid} value={user.uid}>{user.displayName || user.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <h3 className="text-xl font-semibold mt-6 mb-4">Detalle de Novedades para el Día Seleccionado</h3>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : novelties.length === 0 ? (
            <p className="text-center text-muted-foreground">No hay novedades para mostrar en esta fecha o con este filtro.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto mb-8">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identificador RK</TableHead>
                    <TableHead>Código de Barras</TableHead>
                    <TableHead>Tipo de Novedad</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Usuario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {novelties.map((novelty) => {
                    const statusInfo = getStatusVariant(novelty.status);
                    return (
                      <TableRow key={novelty.id}>
                        <TableCell className="font-medium">{novelty.operation_rk_identifier}</TableCell>
                        <TableCell>{novelty.barcode || 'N/A'}</TableCell>
                        <TableCell>{novelty.novelty_type}</TableCell>
                        <TableCell>{novelty.description || 'N/A'}</TableCell>
                        <TableCell>
                          <Badge variant={statusInfo.variant} className={statusInfo.className}>{novelty.status}</Badge>
                        </TableCell>
                        <TableCell>{format(new Date(novelty.created_at!), 'PPP p', { locale: es })}</TableCell>
                        <TableCell>{novelty.userName}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <h2 className="text-2xl font-bold mt-8 mb-4 text-center">Análisis de Novedades (Histórico)</h2>
          {loadingDashboard ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle>Novedades por Tipo</CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                  {noveltyTypeDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={noveltyTypeDistribution}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="count"
                          nameKey="type"
                        >
                          {noveltyTypeDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground mt-10">No hay datos.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle>Novedades por Usuario</CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                  {userNoveltyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={userNoveltyData}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                      >
                        <XAxis dataKey="userName" angle={-45} textAnchor="end" height={60} interval={0} />
                        <YAxis />
                        <Tooltip formatter={(value: number) => `${value} novedades`} />
                        <Legend />
                        <Bar dataKey="count" name="Novedades" fill="#82ca9d" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground mt-10">No hay datos.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle>Tendencia Diaria</CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                  {dailyNoveltyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyNoveltyData}>
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip formatter={(value: number) => `${value} novedades`} />
                        <Legend />
                        <Line type="monotone" dataKey="count" name="Novedades" stroke="#8884d8" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground mt-10">No hay datos.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
