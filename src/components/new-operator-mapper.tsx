
"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Save, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveOperatorMappings } from '@/app/actions';
import type { ManualOperatorMappings } from '@/types';

interface NewOperatorMapperProps {
    unmappedPackers: string[];
    mappings: ManualOperatorMappings;
    onMappingChange: (newMappings: ManualOperatorMappings) => void;
}

export const NewOperatorMapper: React.FC<NewOperatorMapperProps> = ({
    unmappedPackers,
    mappings,
    onMappingChange,
}) => {
    const { toast } = useToast();
    const [isSaving, setIsSaving] = React.useState(false);

    const handleInputChange = (id: string, name: string) => {
        onMappingChange({
            ...mappings,
            [id]: name.toUpperCase()
        });
    };

    const handleSaveToMaster = async () => {
        setIsSaving(true);
        try {
            const result = await saveOperatorMappings(mappings);
            if (result.success) {
                toast({
                    title: "Maestro Actualizado",
                    description: "Los nuevos mapeos se han guardado permanentemente en la base de datos.",
                });
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error al guardar",
                description: error.message,
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (!unmappedPackers || unmappedPackers.length === 0) {
        return null;
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="space-y-1">
                    <CardTitle>Mapear Nuevos Operarios</CardTitle>
                    <CardDescription>
                        Se encontraron los siguientes códigos de operario que no están en la lista predefinida (ID o Nombre). Por favor, asigne un nombre completo.
                    </CardDescription>
                </div>
                <Button 
                    onClick={handleSaveToMaster} 
                    disabled={isSaving}
                    variant="default"
                    className="bg-green-600 hover:bg-green-700 h-10"
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Guardar en el Maestro
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Código de Operario / Nombre Detectado</TableHead>
                            <TableHead>Asignar Nombre Completo (en el Maestro)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {unmappedPackers.map((id) => (
                            <TableRow key={id}>
                                <TableCell className="font-medium font-mono">{id}</TableCell>
                                <TableCell>
                                    <Input
                                        type="text"
                                        value={mappings[id] || ''}
                                        onChange={(e) => handleInputChange(id, e.target.value)}
                                        className="w-full sm:w-80"
                                        placeholder="Ej: John Doe"
                                        aria-label={`Asignar nombre para ${id}`}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};
