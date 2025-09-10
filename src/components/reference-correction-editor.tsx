

"use client";

import React, { useState, useMemo, useCallback } from 'react';
import type { UniqueReference, ReferenceCorrections } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ReferenceCorrectionEditorProps {
    uniqueReferences: UniqueReference[];
    corrections: ReferenceCorrections;
    onCorrectionsChange: (newCorrections: ReferenceCorrections) => void;
}

export const ReferenceCorrectionEditor: React.FC<ReferenceCorrectionEditorProps> = ({
    uniqueReferences,
    corrections,
    onCorrectionsChange
}) => {
    const [filter, setFilter] = useState('');
    const [isExpanded, setIsExpanded] = useState(true);

    const hasTallaColumn = useMemo(() => uniqueReferences.some(ref => ref.talla !== undefined), [uniqueReferences]);

    const handleCorrectionChange = useCallback((
        key: string,
        field: 'newReferencia' | 'newDescripcion',
        value: string
    ) => {
        const newCorrections = JSON.parse(JSON.stringify(corrections));
        
        if (!newCorrections[key]) {
            newCorrections[key] = {};
        }

        if (value.trim() === '') {
            delete newCorrections[key][field];
            if (Object.keys(newCorrections[key]).length === 0) {
                delete newCorrections[key];
            }
        } else {
            newCorrections[key][field] = value;
        }

        onCorrectionsChange(newCorrections);
    }, [corrections, onCorrectionsChange]);

    const filteredData = useMemo(() => {
        if (!filter) return uniqueReferences;
        const lowercasedFilter = filter.toLowerCase();
        return uniqueReferences.filter(item =>
            item.referenciaOriginal.toLowerCase().includes(lowercasedFilter) ||
            item.descripcionOriginal.toLowerCase().includes(lowercasedFilter) ||
            item.codigoBarras.toLowerCase().includes(lowercasedFilter) ||
            (item.talla || '').toLowerCase().includes(lowercasedFilter)
        );
    }, [uniqueReferences, filter]);

    if (!uniqueReferences || uniqueReferences.length === 0) {
        return null;
    }

    return (
        <Card className="flex flex-col h-full">
            <CardHeader className="flex flex-row justify-between items-center">
                <div>
                    <CardTitle>Referencias No Encontradas en BD</CardTitle>
                    <CardDescription>
                        Estos productos no se encontraron en la base de datos maestra. Corríjalos aquí o agréguelos al catálogo general.
                    </CardDescription>
                </div>
                <Button variant="ghost" onClick={() => setIsExpanded(!isExpanded)}>
                    {isExpanded ? 'Ocultar' : 'Mostrar'}
                </Button>
            </CardHeader>
            
            {isExpanded && (
                <CardContent className="p-6 pt-0 flex-grow flex flex-col">
                     <Input
                        type="text"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        placeholder="Filtrar por referencia, descripción, código o talla..."
                        className="w-full sm:w-1/2 mb-4"
                    />
                    <div className="flex-grow h-full max-h-[500px] overflow-y-auto border rounded-md">
                      <Table>
                          <TableHeader className="sticky top-0 bg-card z-10">
                              <TableRow>
                                  <TableHead>Cód. Barras</TableHead>
                                  {hasTallaColumn && <TableHead>Talla</TableHead>}
                                  <TableHead>Ref. Original</TableHead>
                                  <TableHead>Desc. Original</TableHead>
                                  <TableHead>Nueva Referencia</TableHead>
                                  <TableHead>Nueva Descripción</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {filteredData.length > 0 ? filteredData.map(item => {
                                  const key = item.talla !== undefined ? `${item.codigoBarras}|${item.talla}` : String(item.codigoBarras);
                                  const correction = corrections[key] || {};
                                  return (
                                      <TableRow key={key}>
                                          <TableCell className="font-mono">{item.codigoBarras}</TableCell>
                                          {hasTallaColumn && <TableCell className="font-mono">{item.talla ?? '-'}</TableCell>}
                                          <TableCell>{item.referenciaOriginal}</TableCell>
                                          <TableCell>{item.descripcionOriginal}</TableCell>
                                          <TableCell>
                                              <Input
                                                  type="text"
                                                  value={correction.newReferencia || ''}
                                                  onChange={(e) => handleCorrectionChange(key, 'newReferencia', e.target.value)}
                                                  placeholder={item.referenciaOriginal}
                                                  className="w-full"
                                              />
                                          </TableCell>
                                          <TableCell>
                                              <Input
                                                  type="text"
                                                  value={correction.newDescripcion || ''}
                                                  onChange={(e) => handleCorrectionChange(key, 'newDescripcion', e.target.value)}
                                                  placeholder={item.descripcionOriginal}
                                                  className="w-full"
                                              />
                                          </TableCell>
                                      </TableRow>
                                  );
                              }) : (
                                  <TableRow>
                                      <TableCell colSpan={hasTallaColumn ? 6 : 5} className="text-center py-4 text-muted-foreground">
                                          No hay resultados para el filtro actual.
                                      </TableCell>
                                  </TableRow>
                              )}
                          </TableBody>
                      </Table>
                    </div>
                </CardContent>
            )}
        </Card>
    );
};
