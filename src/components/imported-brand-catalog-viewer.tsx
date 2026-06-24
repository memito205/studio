"use client";

import React, { useMemo, useState } from 'react';
import type { ImportedBrandCatalogItem } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, FileDown } from 'lucide-react';

interface ImportedBrandCatalogViewerProps {
  items: ImportedBrandCatalogItem[];
}

export const ImportedBrandCatalogViewer: React.FC<ImportedBrandCatalogViewerProps> = ({ items }) => {
  const [filter, setFilter] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  const filteredItems = useMemo(() => {
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter(
      (item) =>
        item.codigoBarras.toLowerCase().includes(q) ||
        item.referencia.toLowerCase().includes(q) ||
        item.descripcion.toLowerCase().includes(q) ||
        (item.talla || '').toLowerCase().includes(q)
    );
  }, [items, filter]);

  const totalUnidades = useMemo(
    () => items.reduce((sum, item) => sum + item.unidadesEnReporte, 0),
    [items]
  );

  const handleExportCsv = () => {
    const headers = ['codigo_barras', 'referencia', 'talla', 'descripcion', 'grupo', 'unidades_en_reporte'];
    const rows = items.map((item) =>
      [
        item.codigoBarras,
        item.referencia,
        item.talla ?? '',
        item.descripcion.replace(/"/g, '""'),
        item.grupo,
        String(item.unidadesEnReporte),
      ]
        .map((cell) => `"${cell}"`)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `catalogo_marca_importada_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (items.length === 0) {
    return null;
  }

  const hasTallaColumn = items.some((item) => item.talla !== undefined && item.talla !== '');

  return (
    <Card className="border-amber-500/50 bg-amber-950/5">
      <CardHeader className="flex flex-row justify-between items-start gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            Catálogo con marca IMPORTADA
          </CardTitle>
          <CardDescription>
            {items.length} código(s) del archivo tienen marca <strong>IMPORTADA</strong> en la base de datos maestra
            ({totalUnidades.toLocaleString()} unidades). Corríjalos en Recepción → Gestión de productos antes de calcular metas por marca.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <FileDown className="h-4 w-4 mr-1" />
            Exportar CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? 'Ocultar' : 'Mostrar'}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por código, referencia, descripción o talla..."
            className="w-full sm:w-1/2 mb-4"
          />
          <div className="max-h-[400px] overflow-y-auto border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Cód. Barras</TableHead>
                  {hasTallaColumn && <TableHead>Talla</TableHead>}
                  <TableHead>Referencia</TableHead>
                  <TableHead>Descripción (catálogo)</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const key = item.talla !== undefined ? `${item.codigoBarras}|${item.talla}` : item.codigoBarras;
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-sm">{item.codigoBarras}</TableCell>
                      {hasTallaColumn && <TableCell className="font-mono">{item.talla ?? '—'}</TableCell>}
                      <TableCell>{item.referencia}</TableCell>
                      <TableCell className="max-w-xs truncate" title={item.descripcion}>
                        {item.descripcion}
                      </TableCell>
                      <TableCell>{item.grupo || '—'}</TableCell>
                      <TableCell className="text-right font-mono">{item.unidadesEnReporte}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
