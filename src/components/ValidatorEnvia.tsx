
"use client";

import React from 'react';
import { Button } from './ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface ValidatorEnviaProps {
  onReturn: () => void;
}

const ValidatorEnvia: React.FC<ValidatorEnviaProps> = ({ onReturn }) => {
  return (
    <div className="min-h-screen bg-slate-900 text-gray-200 flex flex-col items-center p-4 sm:p-6 lg:p-8 rounded-lg">
      <div className="w-full max-w-7xl mx-auto">
        <header className="text-center mb-10 relative">
          <Button onClick={onReturn} variant="ghost" className="absolute top-0 left-0 text-slate-300 hover:bg-slate-700 hover:text-white">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-300">
            Validador de Facturación - Envia
          </h1>
          <p className="mt-2 text-lg text-slate-400">
            Módulo en construcción. Próximamente podrá validar sus guías de Envia aquí.
          </p>
        </header>

        <main>
          <Card>
            <CardHeader>
              <CardTitle>Funcionalidad Próximamente</CardTitle>
              <CardDescription>
                El validador para la transportadora Envia está siendo desarrollado y estará disponible en futuras actualizaciones.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p>Agradecemos su paciencia mientras trabajamos en esta funcionalidad.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default ValidatorEnvia;
