

import React from 'react';
import { FileIcon, UserCheckIcon, LayoutDashboardIcon, TruckIcon, ClipboardPasteIcon, ClipboardSearchIcon, ArrowLeft } from './icons';

interface HeaderProps {
    activeView: 'bodega' | 'descansos' | 'rutas' | 'procesos' | 'novedades';
    setActiveView: (view: 'bodega' | 'descansos' | 'rutas' | 'procesos' | 'novedades') => void;
    onReturn: () => void;
}

const Header: React.FC<HeaderProps> = ({ activeView, setActiveView, onReturn }) => {
  const navItemClasses = "flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors";
  const activeClasses = "bg-green-700 text-white";
  const inactiveClasses = "text-green-100 hover:bg-green-500 hover:text-white";

  return (
    <header className="bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <div className="flex items-center space-x-4">
            <button 
              onClick={onReturn}
              className="p-2 hover:bg-green-500 rounded-full transition-colors mr-2"
              title="Volver al Menú Principal"
            >
              <ArrowLeft className="h-6 w-6 text-white" />
            </button>
             <LayoutDashboardIcon className="h-8 w-8 text-white" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Plataforma de Logística
            </h1>
          </div>
          <nav className="flex items-center space-x-2 bg-green-600 p-1 rounded-lg">
            <button
                onClick={() => setActiveView('bodega')}
                className={`${navItemClasses} ${activeView === 'bodega' ? activeClasses : inactiveClasses}`}
                aria-current={activeView === 'bodega' ? 'page' : undefined}
            >
                <FileIcon className="h-5 w-5 mr-2"/>
                Analizador de Bodega
            </button>
             <button
                onClick={() => setActiveView('procesos')}
                className={`${navItemClasses} ${activeView === 'procesos' ? activeClasses : inactiveClasses}`}
                aria-current={activeView === 'procesos' ? 'page' : undefined}
            >
                <ClipboardPasteIcon className="h-5 w-5 mr-2"/>
                Procesos de Bodega
            </button>
            <button
                onClick={() => setActiveView('rutas')}
                className={`${navItemClasses} ${activeView === 'rutas' ? activeClasses : inactiveClasses}`}
                aria-current={activeView === 'rutas' ? 'page' : undefined}
            >
                <TruckIcon className="h-5 w-5 mr-2"/>
                Planificador de Rutas
            </button>
            <button
                onClick={() => setActiveView('descansos')}
                className={`${navItemClasses} ${activeView === 'descansos' ? activeClasses : inactiveClasses}`}
                aria-current={activeView === 'descansos' ? 'page' : undefined}
            >
                <UserCheckIcon className="h-5 w-5 mr-2"/>
                Reporte de Descansos
            </button>
            <button
                onClick={() => setActiveView('novedades')}
                className={`${navItemClasses} ${activeView === 'novedades' ? activeClasses : inactiveClasses}`}
                aria-current={activeView === 'novedades' ? 'page' : undefined}
            >
                <ClipboardSearchIcon className="h-5 w-5 mr-2"/>
                Novedades Transportadora
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
