
"use client";

import type { BrandProductTypeGoals, ProductivityGoals, ProductCategory } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface BrandProductTypeGoalConfigurationProps {
  brands: string[];
  goals: BrandProductTypeGoals;
  onBrandProductTypeGoalsChange: (newGoals: BrandProductTypeGoals) => void;
  baseGoals: ProductivityGoals;
}

export const BrandProductTypeGoalConfiguration: React.FC<BrandProductTypeGoalConfigurationProps> = ({ brands, goals, onBrandProductTypeGoalsChange, baseGoals }) => {
  const productTypes: ProductCategory[] = ['CALZADO', 'ROPA', 'ACCESORIOS'];

  const handleGoalChange = (brandName: string, productType: ProductCategory, value: string) => {
    const newGoals = JSON.parse(JSON.stringify(goals)); // Deep copy
    const numericValue = Number(value);

    // Ensure the brand object exists
    if (!newGoals[brandName]) {
      newGoals[brandName] = {};
    }

    if (value.trim() === '' || isNaN(numericValue) || numericValue < 0) {
      // If the input is empty or invalid, delete the specific goal for that product type
      delete newGoals[brandName][productType];
    } else {
      // Otherwise, set the goal
      newGoals[brandName][productType] = numericValue;
    }
    
    // Clean up empty brand objects if they have no goals left.
    if (Object.keys(newGoals[brandName]).length === 0) {
        delete newGoals[brandName];
    }

    onBrandProductTypeGoalsChange(newGoals);
  };

  if (brands.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurar Metas Detalladas (Opcional)</CardTitle>
        <CardDescription>
          Establezca una meta específica (unid/hr) para una combinación de marca y producto. Si se deja en blanco, se usará la meta general del producto.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Marca</TableHead>
                    {productTypes.map(pt => <TableHead key={pt} className="text-center">{pt}</TableHead>)}
                </TableRow>
            </TableHeader>
            <TableBody>
                {brands.map((brand) => (
                    <TableRow key={brand}>
                        <TableCell className="font-medium">{brand}</TableCell>
                        {productTypes.map(pt => (
                            <TableCell key={pt} className="text-center">
                                <Input
                                  type="number"
                                  id={`goal-${brand}-${pt}`}
                                  value={goals[brand]?.[pt] || ''}
                                  onChange={(e) => handleGoalChange(brand, pt, e.target.value)}
                                  className="w-24 text-center mx-auto"
                                  min="0"
                                  placeholder={`${baseGoals[pt]}`}
                                />
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
