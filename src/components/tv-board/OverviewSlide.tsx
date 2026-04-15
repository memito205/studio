import React from 'react';
import { PackageSearch, Truck, AlertTriangle } from 'lucide-react';

interface OverviewSlideProps {
  metrics: {
    total: number;
    pending: number;
    dispatched: number;
    delayed: number;
  };
}

export const OverviewSlide: React.FC<OverviewSlideProps> = ({ metrics }) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-12">
      <h2 className="text-7xl font-extrabold text-slate-100 mb-20 tracking-tight">
        Resumen de la Operación
      </h2>
      
      <div className="grid grid-cols-3 gap-16 w-full max-w-7xl">
        {/* En Proceso */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-16 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105">
          <div className="bg-amber-500/20 p-8 rounded-full mb-8">
            <PackageSearch className="w-24 h-24 text-amber-400" />
          </div>
          <span className="text-4xl text-slate-400 font-bold uppercase tracking-widest mb-4">En Proceso</span>
          <span className="text-9xl font-black text-amber-400">{metrics.pending}</span>
        </div>

        {/* Despachados */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-16 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105 relative overflow-hidden">
          <div className="absolute inset-0 bg-green-500/5 z-0"></div>
          <div className="bg-green-500/20 p-8 rounded-full mb-8 z-10">
            <Truck className="w-24 h-24 text-green-400" />
          </div>
          <span className="text-4xl text-slate-400 font-bold uppercase tracking-widest mb-4 z-10">Despachados</span>
          <span className="text-9xl font-black text-green-400 z-10">{metrics.dispatched}</span>
        </div>

        {/* Atrasados */}
        <div className="bg-slate-900/80 border border-slate-700 shadow-2xl rounded-3xl p-16 flex flex-col items-center justify-center text-center transform transition-transform duration-700 hover:scale-105 relative overflow-hidden">
           <div className={`absolute inset-0 ${metrics.delayed > 0 ? 'bg-red-500/10 animate-pulse' : 'bg-slate-800/20'} z-0`}></div>
          <div className="bg-red-500/20 p-8 rounded-full mb-8 z-10">
            <AlertTriangle className={`w-24 h-24 ${metrics.delayed > 0 ? 'text-red-500' : 'text-slate-500'}`} />
          </div>
          <span className="text-4xl text-slate-400 font-bold uppercase tracking-widest mb-4 z-10">Riesgo / Atraso</span>
          <span className={`text-9xl font-black z-10 ${metrics.delayed > 0 ? 'text-red-500' : 'text-slate-500'}`}>{metrics.delayed}</span>
        </div>
      </div>
    </div>
  );
};
