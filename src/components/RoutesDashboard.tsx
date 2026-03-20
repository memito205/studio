
"use client";

import React, { useState, useEffect, useMemo, ChangeEvent, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UploadCloud, Truck, Search, Loader2, Download, Filter, Settings } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import type { RouteEntry } from '@/types';
import { parseFlexibleDate } from '@/lib/parsingUtils';
import { saveRoutes, loadAllRoutes } from '@/app/actions';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface RoutesDashboardProps {
  onRoutesUpdated: () => void;
}

const DownloadTemplateButton: React.FC = () => {
    const handleDownload = () => {
        const headers = ["Fecha", "Vehiculo", "Responsable", "Almacen destino", "Numero TF", "Tipo de servicio"];
        const exampleData = [
            {
                "Fecha": "2024-07-29",
                "Vehiculo": "FLL491",
                "Responsable": "CARLOS MARIO",
                "Almacen destino": "TIENDA BELLO",
                "Numero TF": "TF-101",
                "Tipo de servicio": "ENTREGA"
            }
        ];
        
        const worksheet = XLSX.utils.json_to_sheet(exampleData, { header: headers });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Rutas');
        
        // Auto-adjust column width
        const colWidths = headers.map(header => ({
            wch: Math.max(header.length, String(exampleData[0][header as keyof typeof exampleData[0]] || '').length) + 5
        }));
        worksheet["!cols"] = colWidths;
        
        XLSX.writeFile(workbook, `Plantilla_Carga_Rutas.xlsx`);
    };

    return (
        <Button onClick={handleDownload} variant="secondary" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Descargar Plantilla
        </Button>
    );
};


export const RoutesDashboard: React.FC<RoutesDashboardProps> = ({ onRoutesUpdated }) => {
    const { toast } = useToast();
    const [allRoutes, setAllRoutes] = useState<RouteEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [filters, setFilters] = useState({
        fecha: '',
        vehiculo: '',
        responsable: '',
        almacenDestino: '',
        status: '',
    });

    useEffect(() => {
        const fetchRoutes = async () => {
            setIsLoading(true);
            const { data, error } = await loadAllRoutes();
            if (error) {
                toast({ variant: 'destructive', title: 'Error al cargar rutas', description: error });
            } else {
                setAllRoutes(data || []);
            }
            setIsLoading(false);
        };
        fetchRoutes();
    }, [toast]);
    
    const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json: any[] = XLSX.utils.sheet_to_json(worksheet);

            const newRoutes: Omit<RouteEntry, 'id'>[] = json.map((row, index) => {
                const fecha = parseFlexibleDate(row['Fecha']);
                if (!fecha) {
                    console.warn(`Fila ${index+2} omitida por fecha inválida.`);
                    return null;
                }
                return {
                    fecha,
                    vehiculo: String(row['Vehiculo'] || '').trim().toUpperCase(),
                    responsable: String(row['Responsable'] || '').trim().toUpperCase(),
                    almacenDestino: String(row['Almacen destino'] || 'N/A'),
                    numeroTF: String(row['Numero TF'] || 'N/A'),
                    tipoServicio: String(row['Tipo de servicio'] || 'N/A'),
                    status: 'Programado' // Default status
                };
            }).filter((r): r is Omit<RouteEntry, 'id'> => r !== null && !!r.vehiculo);
            
            if(newRoutes.length === 0) {
              throw new Error("No se encontraron rutas válidas en el archivo.");
            }
            
            const result = await saveRoutes(newRoutes);

            if(result.success) {
                toast({ title: "Archivo cargado", description: `Se han procesado y guardado ${newRoutes.length} entradas de ruta.` });
                onRoutesUpdated(); // Callback to refresh parent if needed
                // Also refresh this component's state
                const { data: updatedData } = await loadAllRoutes();
                setAllRoutes(updatedData || []);
            } else {
                 throw new Error(result.error);
            }

        } catch(error: any) {
            toast({ variant: 'destructive', title: "Error al cargar archivo", description: error.message });
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };
    
    const filteredRoutes = useMemo(() => {
        return allRoutes.filter(route => {
            return (
                (!filters.fecha || route.fecha.toISOString().startsWith(filters.fecha)) &&
                (!filters.vehiculo || route.vehiculo.toLowerCase().includes(filters.vehiculo.toLowerCase())) &&
                (!filters.responsable || route.responsable.toLowerCase().includes(filters.responsable.toLowerCase())) &&
                (!filters.almacenDestino || route.almacenDestino.toLowerCase().includes(filters.almacenDestino.toLowerCase())) &&
                (!filters.status || route.status.toLowerCase() === filters.status.toLowerCase())
            );
        });
    }, [allRoutes, filters]);

    const handleFilterChange = (field: keyof typeof filters, value: string) => {
        setFilters(prev => ({...prev, [field]: value}));
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Panel de Administración de Rutas</CardTitle>
                    <CardDescription>Cargue y gestione todas las rutas de los vehículos.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-center gap-4">
                        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept=".xlsx, .xls" />
                        <Button variant="outline" className="flex-1" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                            {isUploading ? 'Procesando archivo...' : 'Seleccionar archivo de rutas'}
                        </Button>
                        <DownloadTemplateButton />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Columnas esperadas: Fecha, Vehiculo, Responsable, Almacen destino, Numero TF, Tipo de servicio.</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Vista de Todas las Rutas</CardTitle>
                    <CardDescription>Filtre y visualice todas las paradas programadas.</CardDescription>
                </CardHeader>
                <CardContent>
                     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
                        <Input placeholder="Filtrar por Fecha (YYYY-MM-DD)" type="date" value={filters.fecha} onChange={e => handleFilterChange('fecha', e.target.value)} />
                        <Input placeholder="Filtrar por Vehículo" value={filters.vehiculo} onChange={e => handleFilterChange('vehiculo', e.target.value)} />
                        <Input placeholder="Filtrar por Responsable" value={filters.responsable} onChange={e => handleFilterChange('responsable', e.target.value)} />
                        <Input placeholder="Filtrar por Destino" value={filters.almacenDestino} onChange={e => handleFilterChange('almacenDestino', e.target.value)} />
                        <Input placeholder="Filtrar por Estado" value={filters.status} onChange={e => handleFilterChange('status', e.target.value)} />
                     </div>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div>
                    ) : (
                        <div className="border rounded-md max-h-[60vh] overflow-y-auto">
                            <Table>
                                <TableHeader className="sticky top-0 bg-secondary">
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Vehículo</TableHead>
                                        <TableHead>Responsable</TableHead>
                                        <TableHead>Destino</TableHead>
                                        <TableHead>Nº TF</TableHead>
                                        <TableHead>Servicio</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredRoutes.map(route => (
                                        <TableRow key={route.id}>
                                            <TableCell>{route.fecha.toLocaleDateString('es-CO')}</TableCell>
                                            <TableCell>{route.vehiculo}</TableCell>
                                            <TableCell>{route.responsable}</TableCell>
                                            <TableCell>{route.almacenDestino}</TableCell>
                                            <TableCell>{route.numeroTF}</TableCell>
                                            <TableCell>{route.tipoServicio}</TableCell>
                                            <TableCell>{route.status}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
