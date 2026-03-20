

"use client";

import React, { useState, useRef, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, GitCompareArrows, Database, Loader2, UploadCloud } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useAuth } from '@/hooks/use-auth-context';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveMunicipios } from '@/app/actions';

interface PropuestaTransportadoraProps {
  onReturn: () => void;
}

const CARRIERS = ["99 Minutos", "Logicuartas", "Envia", "Servientrega", "Deprisa", "Mandar y Servir", "Clicoh"];


const AdminView: React.FC = () => {
    const [isUploadingMunicipios, setIsUploadingMunicipios] = useState(false);
    const municipiosFileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const handleMunicipiosUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsUploadingMunicipios(true);
        try {
            const fileContent = await file.arrayBuffer();
            const result = await saveMunicipios(fileContent);

            if (result.success) {
                toast({
                    title: "Éxito",
                    description: `Se han procesado ${result.summary?.processed} municipios.`
                });
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al cargar municipios', description: error.message });
        } finally {
            setIsUploadingMunicipios(false);
            if (municipiosFileInputRef.current) {
                municipiosFileInputRef.current.value = '';
            }
        }
    };
    
    return (
        <Tabs defaultValue="analisis">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="analisis"><GitCompareArrows className="mr-2 h-4 w-4" />Análisis de Propuestas</TabsTrigger>
                <TabsTrigger value="datos"><Database className="mr-2 h-4 w-4" />Gestión de Datos Base</TabsTrigger>
            </TabsList>

            {/* Tab for Data Management */}
            <TabsContent value="datos" className="mt-6 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Base de Datos de Municipios</CardTitle>
                        <CardDescription>Cargue y mantenga actualizada la lista de municipios y sus códigos asociados.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                            <UploadCloud className="w-10 h-10 text-muted-foreground" />
                            <Button asChild className="mt-3" size="sm" disabled={isUploadingMunicipios}>
                                <label htmlFor="municipios-upload">
                                    {isUploadingMunicipios ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                    {isUploadingMunicipios ? 'Procesando...' : 'Seleccionar archivo de municipios'}
                                </label>
                            </Button>
                            <input ref={municipiosFileInputRef} id="municipios-upload" type="file" className="hidden" onChange={handleMunicipiosUpload} accept=".xlsx, .xls"/>
                            <p className="text-xs text-muted-foreground mt-2">Suba un archivo Excel con las columnas 'Codigo', 'Municipio' y 'Departamento'.</p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Base de Datos de Tarifas Actuales</CardTitle>
                        <CardDescription>Cargue las tablas de tarifas vigentes para cada transportadora.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label htmlFor="carrier-select">Seleccione Transportadora</Label>
                            <Select>
                                <SelectTrigger id="carrier-select">
                                    <SelectValue placeholder="Elija una transportadora..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {CARRIERS.map(carrier => (
                                        <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                            <UploadCloud className="w-10 h-10 text-muted-foreground" />
                            <Button asChild className="mt-3" size="sm">
                                <label htmlFor="tarifas-upload">Seleccionar archivo de tarifas</label>
                            </Button>
                            <input id="tarifas-upload" type="file" className="hidden" />
                            <p className="text-xs text-muted-foreground mt-2">Columnas: 'CodigoMunicipio', 'Tarifa', 'CostoManejo', 'TipoTrayecto'.</p>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            {/* Tab for Proposal Analysis */}
            <TabsContent value="analisis" className="mt-6 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Paso 1: Crear Nueva Propuesta</CardTitle>
                        <CardDescription>Ingrese los detalles de la nueva propuesta que desea analizar.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="proposal-carrier">Nombre Transportadora</Label>
                            <Input id="proposal-carrier" placeholder="Ej: Transportadora XYZ" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="proposal-date">Fecha de la Propuesta</Label>
                            <Input id="proposal-date" type="date" />
                        </div>
                        <div className="space-y-2 self-end">
                            <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg h-full">
                                <UploadCloud className="w-8 h-8 text-muted-foreground" />
                                <Button asChild className="mt-2" size="sm" variant="outline">
                                    <label htmlFor="proposal-file-upload">Cargar Excel de la Propuesta</label>
                                </Button>
                                <input id="proposal-file-upload" type="file" className="hidden" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="flex justify-center">
                    <Button size="lg"><GitCompareArrows className="mr-2 h-5 w-5" /> Generar Comparativo</Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Paso 2: Resultados del Análisis</CardTitle>
                        <CardDescription>Tabla comparativa y recomendaciones basadas en la propuesta cargada.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-center h-64 border-2 border-dashed rounded-lg bg-muted/30">
                            <p className="text-muted-foreground">El análisis comparativo aparecerá aquí.</p>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    );
};

const OfficeView: React.FC = () => {
    // Datos de ejemplo hasta que se conecte a Firebase
    const mockProposals = [
        { id: 1, name: 'Propuesta Q3 2024', carrier: 'Transportadora XYZ', date: '2024-07-15' },
        { id: 2, name: 'Negociación Anual', carrier: 'Servientrega', date: '2024-06-30' },
    ];
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Propuestas de Transportadoras</CardTitle>
                <CardDescription>Consulte los análisis de las propuestas de tarifas guardadas.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nombre de la Propuesta</TableHead>
                            <TableHead>Transportadora</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {mockProposals.map(proposal => (
                            <TableRow key={proposal.id}>
                                <TableCell>{proposal.name}</TableCell>
                                <TableCell>{proposal.carrier}</TableCell>
                                <TableCell>{proposal.date}</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="outline" size="sm">
                                        <Eye className="mr-2 h-4 w-4" />
                                        Ver Resultados
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};


export const PropuestaTransportadora: React.FC<PropuestaTransportadoraProps> = ({ onReturn }) => {
    const { role } = useAuth();
    const isAdmin = role === 'admin';

    return (
        <div className="space-y-8">
            <Card>
                <CardHeader className="flex flex-row justify-between items-center">
                    <div>
                        <CardTitle>Propuesta de Transportadora</CardTitle>
                        <CardDescription>
                            {isAdmin 
                                ? "Analice y compare propuestas de tarifas de transportadoras con sus negociaciones actuales."
                                : "Consulte los análisis de las propuestas de tarifas disponibles."
                            }
                        </CardDescription>
                    </div>
                    <Button onClick={onReturn} variant="outline">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver a Funcionalidades
                    </Button>
                </CardHeader>
            </Card>
            
            {isAdmin ? <AdminView /> : <OfficeView />}

        </div>
    );
};
