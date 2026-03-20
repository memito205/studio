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
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Edit, Filter, Search, ArrowLeft, BarChartHorizontal, AlarmClockOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditNoveltyDialog } from '@/components/EditNoveltyDialog';
import type { ItemNovelty, ReceptionOperation, AppUser } from '@/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface NoveltyReportEntry extends ItemNovelty {
  operation_rk_identifier: string;
  userName: string;
}

type NoveltyStatusFilter = 'all' | 'pending' | 'resolved' | 'ignored';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const getNoveltyStatusVariant = (status: ItemNovelty['status']): BadgeVariant => {
  switch (status) {
    case 'pending':
      return 'secondary';
    case 'resolved':
      return 'default';
    case 'ignored':
      return 'destructive';
    default:
      return 'default';
  }
};

const getNoveltyStatusClassName = (status: ItemNovelty['status']): string => {
  switch (status) {
    case 'pending':
      return 'bg-orange-500 text-white';
    case 'resolved':
      return 'bg-green-500 text-white';
    case 'ignored':
      return 'bg-red-500 text-white';
    default:
      return '';
  }
};

interface NoveltyManagementProps {
    onReturn: () => void;
    onNavigateToReports: () => void;
    onNavigateToTimeReports: () => void;
}

export const NoveltyManagement: React.FC<NoveltyManagementProps> = ({ onReturn, onNavigateToReports, onNavigateToTimeReports }) => {
  const [novelties, setNovelties] = useState<NoveltyReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<NoveltyStatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedNovelty, setSelectedNovelty] = useState<ItemNovelty | null>(null);

  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [allUsersMap, setAllUsersMap] = useState<Map<string, string>>(new Map());

  const fetchNovelties = useCallback(async () => {
    setLoading(true);
    try {
      const [noveltiesResult, operationsResult, usersResult] = await Promise.all([
        getAllNovelties(),
        loadReceptionOperations(),
        getAllUserProfiles(),
      ]);

      if (!noveltiesResult.success || !operationsResult.success) {
        throw new Error(noveltiesResult.error || operationsResult.error || 'Error fetching data');
      }
      
      const fetchedUsers = usersResult || [];
      setAllUsers(fetchedUsers);
      
      const usersMap = new Map<string, string>(
        fetchedUsers.map(u => [u.uid, u.displayName || u.email || u.uid])
      );
      setAllUsersMap(usersMap);

      const operationsMap = new Map<string, ReceptionOperation>();
      operationsResult.data?.operations.forEach(op => operationsMap.set(op.id, op));


      const processedNovelties: NoveltyReportEntry[] = (noveltiesResult.data || []).map(novelty => ({
        ...novelty,
        operation_rk_identifier: operationsMap.get(novelty.reception_id)?.rk_identifier || 'N/A',
        userName: usersMap.get(novelty.user_id) || novelty.user_id,
      }));
      setNovelties(processedNovelties);

    } catch (error: any) {
      showError('Error al cargar las novedades.', error.message);
      setNovelties([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNovelties();
  }, [fetchNovelties]);

  const handleEditNovelty = (novelty: ItemNovelty) => {
    setSelectedNovelty(novelty);
    setIsEditDialogOpen(true);
  };

  const handleNoveltyUpdated = () => {
    fetchNovelties(); // Refresh the list after update
  };

  const filteredNovelties = novelties.filter(novelty => {
    const matchesSearch = searchTerm === '' ||
      novelty.barcode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      novelty.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      novelty.novelty_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      novelty.operation_rk_identifier.toLowerCase().includes(searchTerm.toLowerCase()) ||
      novelty.userName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || novelty.status === statusFilter;
    const matchesType = typeFilter === 'all' || novelty.novelty_type === typeFilter;
    const matchesUser = userFilter === 'all' || novelty.user_id === userFilter;

    return matchesSearch && matchesStatus && matchesType && matchesUser;
  });

  const uniqueNoveltyTypes = [...new Set(novelties.map(n => n.novelty_type))];
  const uniqueUsers = [...new Set(novelties.map(n => n.user_id))];

  return (
    <div className="space-y-8">
      <Card className="w-full">
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle className="text-2xl">Gestión de Novedades</CardTitle>
            <CardDescription>Visualiza y gestiona todas las novedades registradas en las operaciones.</CardDescription>
          </div>
           <div className="flex items-center gap-4">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                       <Button onClick={onNavigateToReports} variant="outline">
                            <BarChartHorizontal className="mr-2 h-4 w-4" /> Ver Reportes de Novedades
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Ver analíticas y reportes visuales de las novedades.</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                       <Button onClick={onNavigateToTimeReports} variant="outline">
                            <AlarmClockOff className="mr-2 h-4 w-4" /> Ver Reportes de Tiempos
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Ver analíticas de pausas y tiempos muertos.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button onClick={onReturn} variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                </Button>
           </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 justify-between items-center mb-4">
            <Input
              placeholder="Buscar por código, descripción, RK, usuario..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm flex-grow"
            />
            <div className="flex flex-wrap gap-2">
              <Select onValueChange={(value: NoveltyStatusFilter) => setStatusFilter(value)} value={statusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filtrar por Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los Estados</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="resolved">Resuelta</SelectItem>
                  <SelectItem value="ignored">Ignorada</SelectItem>
                </SelectContent>
              </Select>
              <Select onValueChange={setTypeFilter} value={typeFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filtrar por Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los Tipos</SelectItem>
                  {uniqueNoveltyTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select onValueChange={setUserFilter} value={userFilter}>
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
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredNovelties.length === 0 ? (
            <p className="text-center text-muted-foreground">No hay novedades que coincidan con los filtros.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
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
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredNovelties.map((novelty) => {
                    const statusVariant = getNoveltyStatusVariant(novelty.status);
                    const statusClassName = getNoveltyStatusClassName(novelty.status);
                    return (
                      <TableRow key={novelty.id}>
                        <TableCell className="font-medium">{novelty.operation_rk_identifier}</TableCell>
                        <TableCell>{novelty.barcode || 'N/A'}</TableCell>
                        <TableCell>{novelty.novelty_type}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{novelty.description || 'N/A'}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant} className={statusClassName}>{novelty.status}</Badge>
                        </TableCell>
                        <TableCell>{format(new Date(novelty.created_at!), 'PPP p', { locale: es })}</TableCell>
                        <TableCell>{novelty.userName}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleEditNovelty(novelty)} title="Editar Novedad">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedNovelty && (
        <EditNoveltyDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          novelty={selectedNovelty}
          onNoveltyUpdated={handleNoveltyUpdated}
        />
      )}
    </div>
  );
};
