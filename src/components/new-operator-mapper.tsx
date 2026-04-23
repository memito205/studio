
"use client";

import type { ManualOperatorMappings } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
    const handleInputChange = (id: string, name: string) => {
        onMappingChange({
            ...mappings,
            [id]: name.toUpperCase()
        });
    };

    if (!unmappedPackers || unmappedPackers.length === 0) {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Mapear Nuevos Operarios</CardTitle>
                <CardDescription>
                    Se encontraron los siguientes códigos de operario que no están en la lista predefinida. Por favor, asigne un nombre completo para que aparezcan correctamente en el reporte.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Código de Operario</TableHead>
                            <TableHead>Asignar Nombre Completo</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {unmappedPackers.map((id) => (
                            <TableRow key={id}>
                                <TableCell className="font-medium">{id}</TableCell>
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
