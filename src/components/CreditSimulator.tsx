"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import CreditSimulatorForm from "@/components/financial-calculator/CreditSimulatorForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { ArrowLeft } from "lucide-react";


interface CreditSimulatorProps {
  onReturn?: () => void;
}


export const CreditSimulator: React.FC<CreditSimulatorProps> = ({ onReturn }) => {
  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl">
       <Card>
        <CardHeader className="flex flex-row justify-between items-center">
            <div>
                <CardTitle className="text-3xl font-bold text-green-700 dark:text-green-400">Simulador de Crédito</CardTitle>
                <CardDescription className="text-gray-700 dark:text-gray-300 mt-2">
                    Ingresa los parámetros para simular el costo financiero de futuras operaciones.
                </CardDescription>
            </div>
            {onReturn && (
                 <Button onClick={onReturn} variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                </Button>
            )}
        </CardHeader>
        <CardContent>
            <CreditSimulatorForm />
        </CardContent>
      </Card>
    </div>
  );
};
