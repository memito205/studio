"use client";

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Upload, Save, UserCheck, Search, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveOperatorMappings } from '@/app/actions';
import type { ManualOperatorMappings } from '@/types';

interface OperatorMappingsManagerProps {
    initialMappings: ManualOperatorMappings;
    onMappingsUpdated: (newMappings: ManualOperatorMappings) => void;
}

export const OperatorMappingsManager: React.FC<OperatorMappingsManagerProps> = ({ 
    initialMappings,
    onMappingsUpdated 
}) => {
    const { toast } = useToast();
    const [mappings, setMappings] = useState<ManualOperatorMappings>(initialMappings);
    const [isSaving, setIsSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [newId, setNewId] = useState('');
    const [newName, setNewName] = useState('');

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws) as any[];

                const newMappings: ManualOperatorMappings = { ...mappings };
                let count = 0;

                data.forEach(row => {
                    // Try to find columns for ID and Name (case insensitive)
                    const idKey = Object.keys(row).find(k => k.toLowerCase().includes('cedula') || k.toLowerCase().includes('cédula') || k.toLowerCase() === 'id');
                    const nameKey = Object.keys(row).find(k => k.toLowerCase().includes('nombre'));

                    if (idKey && nameKey && row[idKey] && row[nameKey]) {
                        const id = String(row[idKey]).trim();
                        const name = String(row[nameKey]).trim().toUpperCase();
                        newMappings[id] = name;
                        count++;
                    }
                });

                if (count > 0) {
                    setMappings(newMappings);
                    toast({
                        title: "Archivo procesado",
                        description: `Se detectaron ${count} empacadores en el archivo. No olvides Guardar Cambios.`,
                    });
                } else {
                    toast({
                        variant: 'destructive',
                        title: "Error de formato",
                        description: "No se encontraron las columnas 'Cédula' y 'Nombre' en el archivo.",
                    });
                }
            } catch (error) {
                toast({
                    variant: 'destructive',
                    title: "Error al leer archivo",
                    description: "Asegúrate de que es un archivo Excel válido.",
                });
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleSave = async () => {
        setIsSaving(true);
        const result = await saveOperatorMappings(mappings);
        if (result.success) {
            toast({
                title: "Cambios guardados",
                description: "El maestro de empacadores se ha actualizado correctamente.",
            });
            onMappingsUpdated(mappings);
        } else {
            toast({
                variant: 'destructive',
                title: "Error al guardar",
                description: result.error,
            });
        }
        setIsSaving(false);
    };

    const handleAddManual = () => {
        if (!newId || !newName) return;
        setMappings(prev => ({
            ...prev,
            [newId.trim()]: newName.trim().toUpperCase()
        }));
        setNewId('');
        setNewName('');
    };

    const handleRemoveMapping = (id: string) => {
        const newMappings = { ...mappings };
        delete newMappings[id];
        setMappings(newMappings);
    };

    const filteredMappings = Object.entries(mappings).filter(([id, name]) => 
        id.includes(searchTerm) || name.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => a[1].localeCompare(b[1]));

    return (
        <Card className="border-2 border-primary/20 shadow-lg">
            <CardHeader className="bg-primary/5">
                <CardTitle className="text-xl flex items-center gap-2">
                    <UserCheck className="w-6 h-6 text-primary" />
                    Maestro de Empacadores
                </CardTitle>
                <CardDescription>
                    Cargue un archivo Excel con las columnas **Cédula** y **Nombre** para mapear automáticamente los operarios.
                </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="flex flex-wrap gap-4 mb-6 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-xs font-bold uppercase mb-1 block">Carga Masiva (Excel)</label>
                        <Input 
                            type="file" 
                            accept=".xlsx, .xls" 
                            onChange={handleFileUpload}
                            className="cursor-pointer"
                        />
                    </div>
                    <div>
                        <Button 
                            onClick={handleSave} 
                            disabled={isSaving}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Guardar Cambios
                        </Button>
                    </div>
                </div>

                <div className="bg-muted/30 p-4 rounded-lg mb-6 border border-dashed">
                    <h4 className="text-sm font-bold mb-3 uppercase tracking-wider">Agregar Manualmente</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Input 
                            placeholder="Cédula / ID" 
                            value={newId} 
                            onChange={(e) => setNewId(e.target.value)} 
                        />
                        <Input 
                            placeholder="Nombre Completo" 
                            value={newName} 
                            onChange={(e) => setNewName(e.target.value)} 
                        />
                        <Button onClick={handleAddManual} variant="outline" disabled={!newId || !newName}>
                            Agregar
                        </Button>
                    </div>
                </div>

                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                        placeholder="Buscar por cédula o nombre..." 
                        className="pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="max-h-[400px] overflow-auto border rounded-md">
                    <Table>
                        <TableHeader className="bg-muted sticky top-0">
                            <TableRow>
                                <TableHead>Cédula / ID</TableHead>
                                <TableHead>Nombre en Reportes</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredMappings.length > 0 ? (
                                filteredMappings.map(([id, name]) => (
                                    <TableRow key={id}>
                                        <TableCell className="font-mono font-bold text-blue-600">{id}</TableCell>
                                        <TableCell className="font-medium">{name}</TableCell>
                                        <TableCell className="text-right">
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                onClick={() => handleRemoveMapping(id)}
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground italic">
                                        No se encontraron mapeos registrados.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};
