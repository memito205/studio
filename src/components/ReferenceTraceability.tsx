/** @jsxImportSource react */
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, ArrowLeft } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getTraceabilityForReference } from '@/app/reception/actions'; // Import the new action
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

interface ReferenceTraceabilityProps {
  onReturn: () => void;
}

interface TraceabilityResult {
    operationId: string;
    rkIdentifier: string;
    expectedQuantity: number;
    scannedQuantity: number;
    hasNovelty: boolean;
}

export const ReferenceTraceability: React.FC<ReferenceTraceabilityProps> = ({ onReturn }) => {
  const [reference, setReference] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TraceabilityResult[]>([]);
  const { toast } = useToast();

  const handleSearch = async () => {
    if (!reference.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Por favor, ingrese una referencia para buscar.' });
      return;
    }
    setIsLoading(true);
    setResults([]);
    const result = await getTraceabilityForReference(reference.trim());
    if (result.success && result.data) {
      setResults(result.data);
      if (result.data.length === 0) {
        toast({ title: 'Sin resultados', description: 'No se encontraron operaciones de recepción para esta referencia.' });
      }
    } else {
      toast({ variant: 'destructive', title: 'Error de Búsqueda', description: result.error });
    }
    setIsLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <div>
                <CardTitle>Trazabilidad por Referencia</CardTitle>
                <CardDescription>Busque una referencia para ver su historial en todas las operaciones de recepción.</CardDescription>
            </div>
            <Button onClick={onReturn} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Operaciones
            </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex w-full max-w-sm items-center space-x-2">
          <Input
            type="text"
            placeholder="Ingrese la referencia..."
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            disabled={isLoading}
          />
          <Button onClick={handleSearch} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Buscar
          </Button>
        </div>

        <div className="border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Operación (RK)</TableHead>
                        <TableHead className="text-right">Cant. Esperada</TableHead>
                        <TableHead className="text-right">Cant. Leída</TableHead>
                        <TableHead className="text-center">Estado</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center">
                                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                            </TableCell>
                        </TableRow>
                    ) : results.length > 0 ? (
                        results.map(res => {
                            const difference = res.scannedQuantity - res.expectedQuantity;
                            let statusBadge;

                            if (res.hasNovelty) {
                                statusBadge = <Badge variant="destructive">Con Novedad</Badge>;
                            } else if (difference > 0) {
                                statusBadge = <Badge variant="warning">Sobrante</Badge>;
                            } else if (difference < 0) {
                                statusBadge = <Badge variant="destructive">Faltante</Badge>;
                            } else {
                                statusBadge = <Badge variant="success">Completo</Badge>;
                            }

                            return (
                                <TableRow key={res.operationId}>
                                    <TableCell className="font-medium">{res.rkIdentifier}</TableCell>
                                    <TableCell className="text-right">{res.expectedQuantity.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-semibold">{res.scannedQuantity.toLocaleString()}</TableCell>
                                    <TableCell className="text-center">
                                        {statusBadge}
                                    </TableCell>
                                </TableRow>
                            )
                        })
                    ) : (
                         <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                Ingrese una referencia para comenzar la búsqueda.
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
