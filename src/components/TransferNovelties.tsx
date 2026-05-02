"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
    AlertCircle, 
    CheckCircle2, 
    Clock, 
    FilePlus, 
    LayoutDashboard, 
    Search,
    ChevronLeft,
    TrendingUp,
    Users,
    Store,
    PieChart as PieChartIcon
} from 'lucide-react';
import { 
    saveTransferNovelty, 
    getTransferNovelties, 
    updateTransferNoveltyStatus 
} from '@/app/transfer-novelty-actions';
import { loadOperatorMappings } from '@/app/actions';
import { TransferNovelty, TransferNoveltyStatus, TransferNoveltyType } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    Legend, 
    ResponsiveContainer, 
    LineChart, 
    Line,
    PieChart,
    Pie,
    Cell
} from 'recharts';

interface TransferNoveltiesProps {
    onBack: () => void;
}

export const TransferNovelties: React.FC<TransferNoveltiesProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState('register');
    const [novelties, setNovelties] = useState<TransferNovelty[]>([]);
    const [operators, setOperators] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Form state
    const [formData, setFormData] = useState({
        numeroTF: '',
        packerId: '',
        tipo: 'Faltante' as TransferNoveltyType,
        cantidad: 0,
        codigoUnidad: '',
        fechaEntregaTienda: '',
        fechaReporteTienda: format(new Date(), 'yyyy-MM-dd'),
        almacen: '',
        justificacion: ''
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [noveltiesRes, operatorsRes] = await Promise.all([
                getTransferNovelties(),
                loadOperatorMappings()
            ]);

            if (noveltiesRes.data) setNovelties(noveltiesRes.data);
            if (operatorsRes.data) setOperators(operatorsRes.data);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.numeroTF || !formData.packerId || !formData.almacen) {
            toast({ variant: 'destructive', title: 'Faltan campos', description: 'Por favor completa los campos obligatorios.' });
            return;
        }

        setIsLoading(true);
        try {
            const result = await saveTransferNovelty({
                ...formData,
                packerName: operators[formData.packerId] || 'Desconocido',
                estado: 'Reportado',
                fechaEntregaTienda: new Date(formData.fechaEntregaTienda),
                fechaReporteTienda: new Date(formData.fechaReporteTienda),
                enTiempo: true // Will be recalculated by server
            });

            if (result.success) {
                toast({ title: 'Novedad registrada', description: 'La novedad ha sido guardada exitosamente.' });
                setFormData({
                    numeroTF: '',
                    packerId: '',
                    tipo: 'Faltante',
                    cantidad: 0,
                    codigoUnidad: '',
                    fechaEntregaTienda: '',
                    fechaReporteTienda: format(new Date(), 'yyyy-MM-dd'),
                    almacen: '',
                    justificacion: ''
                });
                loadData();
                setActiveTab('manage');
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    // Dashboard Data Calculations
    const stats = useMemo(() => {
        const total = novelties.length;
        const enTiempoCount = novelties.filter(n => n.enTiempo).length;
        const onTimePercentage = total > 0 ? (enTiempoCount / total) * 100 : 0;

        // Tendencias por fecha (últimos 15 registros para demo)
        const trends = novelties.reduce((acc: any[], curr) => {
            const date = format(new Date(curr.createdAt), 'dd MMM');
            const existing = acc.find(a => a.name === date);
            if (existing) existing.value++;
            else acc.push({ name: date, value: 1 });
            return acc;
        }, []).slice(-10);

        // Top Empacadores
        const packerData = novelties.reduce((acc: Record<string, number>, curr) => {
            const name = curr.packerName || 'Otro';
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {});
        const packerChart = Object.entries(packerData)
            .map(([name, count]) => ({ name, count }))
            .sort((a,b) => b.count - a.count)
            .slice(0, 5);

        // Mix Novedades
        const mixData = [
            { name: 'Sobrantes', value: novelties.filter(n => n.tipo === 'Sobrante').length, color: '#10b981' },
            { name: 'Faltantes', value: novelties.filter(n => n.tipo === 'Faltante').length, color: '#ef4444' }
        ];

        return { total, onTimePercentage, trends, packerChart, mixData };
    }, [novelties]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Novedades de Transferencias</h1>
                    <p className="text-muted-foreground text-sm">Registro y control de sobrantes y faltantes de mercancía.</p>
                </div>
                <Button variant="outline" onClick={onBack}>
                    <ChevronLeft className="mr-2 h-4 w-4" /> Volver a Suite
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 md:w-[400px]">
                    <TabsTrigger value="register">Registro</TabsTrigger>
                    <TabsTrigger value="manage">Gestión</TabsTrigger>
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                </TabsList>

                <TabsContent value="register" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FilePlus className="h-5 w-5 text-primary" />
                                Nueva Novedad
                            </CardTitle>
                            <CardDescription>Completa los datos reportados por la tienda.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="numeroTF">Número de TF *</Label>
                                        <Input 
                                            id="numeroTF" 
                                            name="numeroTF" 
                                            value={formData.numeroTF}
                                            onChange={handleInputChange}
                                            placeholder="Ej: TF00123" 
                                            required
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="almacen">Almacén que Reporta *</Label>
                                        <Input 
                                            id="almacen" 
                                            name="almacen" 
                                            value={formData.almacen}
                                            onChange={handleInputChange}
                                            placeholder="Nombre de la tienda" 
                                            required
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="packerId">Empacador Responsable *</Label>
                                        <Select 
                                            onValueChange={(val) => setFormData(prev => ({...prev, packerId: val}))}
                                            value={formData.packerId}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Seleccionar empacador" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(operators).map(([id, name]) => (
                                                    <SelectItem key={id} value={id}>{name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="tipo">Tipo de Novedad</Label>
                                        <Select 
                                            onValueChange={(val) => setFormData(prev => ({...prev, tipo: val as TransferNoveltyType}))}
                                            value={formData.tipo}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Faltante">Faltante</SelectItem>
                                                <SelectItem value="Sobrante">Sobrante</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label htmlFor="cantidad">Cantidad</Label>
                                            <Input 
                                                id="cantidad" 
                                                name="cantidad" 
                                                type="number"
                                                value={formData.cantidad}
                                                onChange={handleInputChange}
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="codigoUnidad">Código Unidad Empaque</Label>
                                            <Input 
                                                id="codigoUnidad" 
                                                name="codigoUnidad" 
                                                value={formData.codigoUnidad}
                                                onChange={handleInputChange}
                                                placeholder="Bolsa/Caja ID" 
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label htmlFor="fechaEntregaTienda">Fecha Entrega Tienda</Label>
                                            <Input 
                                                id="fechaEntregaTienda" 
                                                name="fechaEntregaTienda" 
                                                type="date"
                                                value={formData.fechaEntregaTienda}
                                                onChange={handleInputChange}
                                                required
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="fechaReporteTienda">Fecha Reporte Novedad</Label>
                                            <Input 
                                                id="fechaReporteTienda" 
                                                name="fechaReporteTienda" 
                                                type="date"
                                                value={formData.fechaReporteTienda}
                                                onChange={handleInputChange}
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="justificacion">Comentarios Iniciales</Label>
                                        <Input 
                                            id="justificacion" 
                                            name="justificacion" 
                                            value={formData.justificacion}
                                            onChange={handleInputChange}
                                            placeholder="Detalle de la novedad..." 
                                        />
                                    </div>
                                    <Button type="submit" className="w-full mt-2" disabled={isLoading}>
                                        {isLoading ? "Guardando..." : "Registrar Novedad"}
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="manage" className="mt-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle>Historico de Novedades</CardTitle>
                                <CardDescription>Gestiona y justifica los sobrantes/faltantes reportados.</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={loadData}>Actualizar</Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha Reporte</TableHead>
                                        <TableHead>TF / Almacén</TableHead>
                                        <TableHead>Tipo / Cant</TableHead>
                                        <TableHead>Empacador</TableHead>
                                        <TableHead>SLA</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {novelties.map((n) => (
                                        <TableRow key={n.id}>
                                            <TableCell className="text-xs">
                                                {format(new Date(n.fechaReporteTienda), 'dd/MM/yyyy')}
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium">{n.numeroTF}</div>
                                                <div className="text-xs text-muted-foreground">{n.almacen}</div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={n.tipo === 'Faltante' ? 'destructive' : 'success'} className="mr-2">
                                                    {n.tipo}
                                                </Badge>
                                                <span className="font-bold">{n.cantidad}</span>
                                            </TableCell>
                                            <TableCell className="text-sm">{n.packerName}</TableCell>
                                            <TableCell>
                                                {n.enTiempo ? (
                                                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">En Tiempo</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">Vencido</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">{n.estado}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm">Ver Detalle</Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {novelties.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                                                No hay novedades registradas.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="dashboard" className="mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    Total Novedades <TrendingUp className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-2xl font-bold">{stats.total}</div>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    SLA Cumplimiento <Clock className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-2xl font-bold">{stats.onTimePercentage.toFixed(1)}%</div>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    Top Empacador <Users className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-xl font-bold truncate">
                                    {stats.packerChart[0]?.name || 'N/A'}
                                </div>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    Tipo Predominante <PieChartIcon className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-2xl font-bold">
                                    {stats.mixData[0].value > stats.mixData[1].value ? 'Sobrante' : 'Faltante'}
                                </div>
                            </CardHeader>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Métricas por Empacador (Top 5)</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.packerChart} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                        <XAxis type="number" />
                                        <YAxis dataKey="name" type="category" width={100} />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Mix de Novedades</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px] flex items-center justify-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={stats.mixData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {stats.mixData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-base">Tendencia Diaria de Reportes</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={stats.trends}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};
