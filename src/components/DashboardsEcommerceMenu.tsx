"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Truck, PackageSearch } from 'lucide-react';

interface Props {
    onNavigateOperacion: () => void;
    onReturnToMainMenu: () => void;
}

export const DashboardsEcommerceMenu: React.FC<Props> = ({ onNavigateOperacion, onReturnToMainMenu }) => {
    return (
        <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-8 animate-in slide-in-from-right-8 duration-300">
            <div className="flex items-center justify-between bg-card p-6 rounded-xl shadow-sm border">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Tableros Ecommerce</h2>
                    <p className="text-muted-foreground mt-1">Seleccione el módulo de análisis para Ecommerce.</p>
                </div>
                <Button onClick={onReturnToMainMenu} variant="outline" className="h-10">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver a Áreas Generales
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="hover:border-primary hover:shadow-md cursor-pointer transition-all duration-300 transform hover:-translate-y-1" onClick={onNavigateOperacion}>
                    <CardHeader className="flex flex-col items-center gap-4 space-y-2 text-center pt-8 pb-8">
                        <div className="p-4 bg-primary/10 rounded-full">
                            <Truck className="h-12 w-12 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Tableros Operación</CardTitle>
                            <CardDescription className="mt-2 text-base">Tiempos de despacho, SLAs y desempeño histórico</CardDescription>
                        </div>
                    </CardHeader>
                </Card>
                
                <Card className="opacity-60 cursor-not-allowed bg-muted/30">
                    <CardHeader className="flex flex-col items-center gap-4 space-y-2 text-center pt-8 pb-8">
                        <div className="p-4 bg-muted rounded-full">
                            <PackageSearch className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <div>
                            <CardTitle className="text-xl text-muted-foreground">Retornos y PQRs</CardTitle>
                            <CardDescription className="mt-2 text-base">Próximamente</CardDescription>
                        </div>
                    </CardHeader>
                </Card>
            </div>
        </div>
    );
};
