import React from 'react';
import { PackageSearch, Truck, AlertTriangle, CalendarPlus } from 'lucide-react';

interface OverviewSlideProps {
  metrics: {
    total: number;
    pending: number;
    dispatched: number;
    delayed: number;
    pedidosHoy: number;
  };
}

export const OverviewSlide: React.FC<OverviewSlideProps> = ({ metrics }) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-8">
      <h2 className="text-7xl font-extrabold text-slate-100 mb-16 tracking-tight">
        Resumen de la Operación
      </h2>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-screen-2xl px-12">
        {/* Entraron Hoy */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-12 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105">
          <div className="bg-blue-500/20 p-6 rounded-full mb-6">
            <CalendarPlus className="w-20 h-20 text-blue-400" />
          </div>
          <span className="text-3xl text-slate-400 font-bold uppercase tracking-widest mb-2">Ingresos del Día</span>
          <span className="text-8xl font-black text-blue-400">{metrics.pedidosHoy}</span>
        </div>

        {/* En Proceso */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-12 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105">
          <div className="bg-amber-500/20 p-6 rounded-full mb-6">
            <PackageSearch className="w-20 h-20 text-amber-400" />
          </div>
          <span className="text-3xl text-slate-400 font-bold uppercase tracking-widest mb-2">Pte Total</span>
          <span className="text-8xl font-black text-amber-400">{metrics.pending}</span>
        </div>

        {/* Atrasados */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-12 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105 relative overflow-hidden">
           <div className={`absolute inset-0 ${metrics.delayed > 0 ? 'bg-red-500/10 animate-pulse' : 'bg-slate-800/20'} z-0`}></div>
          <div className="bg-red-500/20 p-6 rounded-full mb-6 z-10">
            <AlertTriangle className={`w-20 h-20 ${metrics.delayed > 0 ? 'text-red-500' : 'text-slate-500'}`} />
          </div>
          <span className="text-3xl text-slate-400 font-bold uppercase tracking-widest mb-2 z-10">Más de 48H</span>
          <span className={`text-8xl font-black z-10 ${metrics.delayed > 0 ? 'text-red-500' : 'text-slate-500'}`}>{metrics.delayed}</span>
        </div>
        
        {/* Despachados */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-12 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105 relative overflow-hidden">
          <div className="absolute inset-0 bg-green-500/5 z-0"></div>
          <div className="bg-green-500/20 p-6 rounded-full mb-6 z-10">
            <Truck className="w-20 h-20 text-green-400" />
          </div>
          <span className="text-3xl text-slate-400 font-bold uppercase tracking-widest mb-2 z-10">Despachos Hoy</span>
          <span className="text-8xl font-black text-green-400 z-10">{metrics.dispatched}</span>
        </div>
      </div>
    </div>
  );
};
