"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, PackageSearch } from 'lucide-react';

interface Props {
    onNavigateRemision: () => void;
    onReturnToMain: () => void;
}

export const BodegaDashboardsMenu: React.FC<Props> = ({ onNavigateRemision, onReturnToMain }) => {
    return (
        <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-8 animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between bg-card p-6 rounded-xl shadow-sm border">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Tableros Bod Ppal</h2>
                    <p className="text-muted-foreground mt-1">Seleccione el tablero operativo de la bodega principal.</p>
                </div>
                 <Button onClick={onReturnToMain} variant="outline" className="h-10">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver a Tableros
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="hover:border-primary hover:shadow-md cursor-pointer transition-all duration-300 transform hover:-translate-y-1" onClick={onNavigateRemision}>
                    <CardHeader className="flex flex-col items-center gap-4 space-y-2 text-center pt-8 pb-8">
                        <div className="p-4 bg-primary/10 rounded-full">
                            <PackageSearch className="h-12 w-12 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Tablero Remisión</CardTitle>
                            <CardDescription className="mt-2 text-base">Analíticas históricas de empaque y rendimiento.</CardDescription>
                        </div>
                    </CardHeader>
                </Card>
            </div>
        </div>
    );
};
