

"use client";

import React from 'react';
import type { ProductCategory, ManualProductClassifications } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface UnclassifiedProductEditorProps {
  unclassifiedTerms: { term: string, sourceDescription: string, codigoBarras: string }[];
  classifications: ManualProductClassifications;
  onClassificationsChange: (newClassifications: ManualProductClassifications) => void;
  availableBrands: string[];
}

const NO_CHANGE_VALUE = "__NO_CHANGE__";

export const UnclassifiedProductEditor: React.FC<UnclassifiedProductEditorProps> = ({
  unclassifiedTerms,
  classifications,
  onClassificationsChange,
  availableBrands,
}) => {
  const handleClassificationChange = (term: string, field: 'productType' | 'brand', value: string) => {
    const newClassifications = JSON.parse(JSON.stringify(classifications));
    if (!newClassifications[term]) {
        newClassifications[term] = {};
    }
    
    // If user selects the placeholder, we treat it as un-setting the value.
    const finalValue = value === NO_CHANGE_VALUE ? '' : value;

    if (finalValue) {
        if (field === 'productType') {
            newClassifications[term].productType = finalValue as ProductCategory;
        } else {
            newClassifications[term].brand = finalValue;
        }
    } else {
        delete newClassifications[term][field];
    }
    
    // Clean up empty objects
    if (Object.keys(newClassifications[term]).length === 0) {
        delete newClassifications[term];
    }

    onClassificationsChange(newClassifications);
  };

  if (unclassifiedTerms.length === 0) {
    return null;
  }

  const productTypes: ProductCategory[] = ['CALZADO', 'ROPA', 'ACCESORIOS'];
  const sortedBrands = React.useMemo(() => [...availableBrands].sort(), [availableBrands]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clasificar Productos Nuevos</CardTitle>
        <CardDescription>
          Se encontraron los siguientes términos en la columna 'Descripción' que no se pudieron clasificar automáticamente. Por favor, asígnelos a una categoría y/o marca.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Término No Clasificado</TableHead>
              <TableHead>Código de Barras</TableHead>
              <TableHead>Descripción de Origen</TableHead>
              <TableHead>Asignar Marca</TableHead>
              <TableHead>Asignar Categoría</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unclassifiedTerms.map(({ term, sourceDescription, codigoBarras }) => (
              <TableRow key={`${term}-${codigoBarras}`}>
                <TableCell className="font-medium">{term}</TableCell>
                <TableCell className="font-mono">{codigoBarras}</TableCell>
                <TableCell className="text-muted-foreground italic">{sourceDescription}</TableCell>
                <TableCell>
                   <Select
                    value={classifications[term]?.brand || ''}
                    onValueChange={(value) => handleClassificationChange(term, 'brand', value)}
                  >
                    <SelectTrigger className="w-full sm:w-48">
                      <SelectValue placeholder="-- Asignar Marca --" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CHANGE_VALUE}>-- Sin Cambio --</SelectItem>
                      {sortedBrands.map(b => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={classifications[term]?.productType || ''}
                    onValueChange={(value) => handleClassificationChange(term, 'productType', value)}
                  >
                    <SelectTrigger className="w-full sm:w-48">
                      <SelectValue placeholder="-- Asignar Categoría --" />
                    </SelectTrigger>
                    <SelectContent>
                       <SelectItem value={NO_CHANGE_VALUE}>-- Sin Cambio --</SelectItem>
                      {productTypes.map(pt => (
                        <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
