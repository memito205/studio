"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ShoppingCart, BarChart3 } from 'lucide-react';

interface Props {
    onNavigateEcommerce: () => void;
    onNavigateBodega: () => void;
    onReturnToSuite: () => void;
}

export const DashboardsMainMenu: React.FC<Props> = ({ onNavigateEcommerce, onNavigateBodega, onReturnToSuite }) => {
    return (
        <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-8 animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between bg-card p-6 rounded-xl shadow-sm border">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Tableros de Control</h2>
                    <p className="text-muted-foreground mt-1">Seleccione el área de análisis que desea visualizar.</p>
                </div>
                 <Button onClick={onReturnToSuite} variant="outline" className="h-10">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver al Inicio
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="hover:border-primary hover:shadow-md cursor-pointer transition-all duration-300 transform hover:-translate-y-1" onClick={onNavigateEcommerce}>
                    <CardHeader className="flex flex-col items-center gap-4 space-y-2 text-center pt-8 pb-8">
                        <div className="p-4 bg-primary/10 rounded-full">
                            <ShoppingCart className="h-12 w-12 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Tableros Ecommerce</CardTitle>
                            <CardDescription className="mt-2 text-base">Analíticas y reportes de la tienda online</CardDescription>
                        </div>
                    </CardHeader>
                </Card>
                
                <Card className="hover:border-primary hover:shadow-md cursor-pointer transition-all duration-300 transform hover:-translate-y-1" onClick={onNavigateBodega}>
                    <CardHeader className="flex flex-col items-center gap-4 space-y-2 text-center pt-8 pb-8">
                        <div className="p-4 bg-primary/10 rounded-full">
                            <BarChart3 className="h-12 w-12 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Tableros Bod Ppal</CardTitle>
                            <CardDescription className="mt-2 text-base">Analíticas del Centro de Distribución y Sedes</CardDescription>
                        </div>
                    </CardHeader>
                </Card>
                
                <Card className="opacity-60 cursor-not-allowed bg-muted/30">
                    <CardHeader className="flex flex-col items-center gap-4 space-y-2 text-center pt-8 pb-8">
                        <div className="p-4 bg-muted rounded-full">
                            <BarChart3 className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <div>
                            <CardTitle className="text-xl text-muted-foreground">Otras Áreas</CardTitle>
                            <CardDescription className="mt-2 text-base">Próximamente</CardDescription>
                        </div>
                    </CardHeader>
                </Card>
            </div>
        </div>
    );
};
