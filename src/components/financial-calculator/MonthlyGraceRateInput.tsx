
"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PlusCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO, isValid, addMonths } from "date-fns";
import { showError } from "@/lib/toast";

interface MonthlyGraceRateInputProps {
  monthlyRates: Record<string, number>;
  onRatesChange: (newRates: Record<string, number>) => void;
  disabled?: boolean;
}

const MonthlyGraceRateInput: React.FC<MonthlyGraceRateInputProps> = ({
  monthlyRates,
  onRatesChange,
  disabled = false,
}) => {
  const [newMonth, setNewMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [newRate, setNewRate] = useState<string>('0.1062'); // Default to 10.62% annual, which is ~0.0084 monthly

  const handleAddRate = () => {
    if (!newMonth || !newRate) {
      showError("Por favor, ingresa un mes y una tasa válidos.");
      return;
    }

    const parsedDate = parseISO(`${newMonth}-01`); // Parse as first day of the month
    if (!isValid(parsedDate)) {
      showError("Formato de mes inválido. Usa YYYY-MM (ej. 2023-01).");
      return;
    }

    const rateValue = parseFloat(newRate);
    if (isNaN(rateValue) || rateValue < 0 || rateValue > 1) {
      showError("La tasa debe ser un número entre 0 y 1 (ej. 0.1062 para 10.62%).");
      return;
    }

    const updatedRates = { ...monthlyRates, [newMonth]: rateValue };
    onRatesChange(updatedRates);
    setNewMonth(format(addMonths(parsedDate, 1), 'yyyy-MM')); // Suggest next month
    setNewRate('0.1062'); // Reset rate to default for next entry
  };

  const handleRemoveRate = (monthToRemove: string) => {
    const updatedRates = { ...monthlyRates };
    delete updatedRates[monthToRemove];
    onRatesChange(updatedRates);
  };

  const sortedMonths = Object.keys(monthlyRates).sort();

  return (
    <Card className="shadow-sm bg-gray-50 dark:bg-gray-800">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-gray-800 dark:text-gray-200">
          Tasas de Período de Gracia Mensuales (Efectiva Anual)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label htmlFor="newMonth">Mes (YYYY-MM)</Label>
            <Input
              id="newMonth"
              type="month"
              value={newMonth}
              onChange={(e) => setNewMonth(e.target.value)}
              disabled={disabled}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="newRate">Tasa Anual (ej. 0.1062)</Label>
            <Input
              id="newRate"
              type="number"
              step="0.0001"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              min="0"
              max="1"
              disabled={disabled}
              className="mt-1"
            />
          </div>
          <Button onClick={handleAddRate} disabled={disabled} className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white">
            <PlusCircle className="mr-2 h-4 w-4" /> Añadir Tasa
          </Button>
        </div>

        {sortedMonths.length > 0 && (
          <div className="overflow-x-auto mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Tasa Anual</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMonths.map((month) => (
                  <TableRow key={month}>
                    <TableCell>{month}</TableCell>
                    <TableCell className="text-right">{(monthlyRates[month] * 100).toFixed(4)}%</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveRate(month)}
                        disabled={disabled}
                        className="text-red-500 hover:text-red-700"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MonthlyGraceRateInput;
