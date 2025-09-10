
import React from 'react';
import { ChartIcon } from '../icons/ChartIcon';

export const Header: React.FC = () => {
  return (
    <header className="bg-slate-900 shadow-lg sticky top-0 z-40">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <ChartIcon className="h-10 w-10 text-sky-400" />
          <h1 className="text-2xl font-bold text-sky-400 tracking-tight">
            Pronóstico de Compras de Tela
          </h1>
        </div>
        {/* Can add navigation or other elements here if needed */}
      </div>
    </header>
  );
};
