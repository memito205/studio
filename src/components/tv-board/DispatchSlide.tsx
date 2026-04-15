"use client";

import React from 'react';
import { DispatchSessionInfo } from '@/types';
import { Truck, Package, CheckCircle2, LayoutGrid } from 'lucide-react';

interface DispatchSlideProps {
  shipments: DispatchSessionInfo[];
}

export const DispatchSlide: React.FC<DispatchSlideProps> = ({ shipments }) => {
  
  const activeShipments = shipments.filter(s => s.status === 'open').slice(0, 4);
  const closedShipmentsToday = shipments.filter(s => s.status === 'closed'); // Simplified for demo

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in slide-in-from-right-12 duration-1000 p-8">
      <div className="flex justify-between items-end mb-4">
        <h2 className="text-5xl font-black text-white uppercase tracking-[0.4em]">Operación de Despachos</h2>
        <div className="flex gap-4">
            <div className="px-6 py-2 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 font-bold text-xl uppercase tracking-widest">
                {shipments.length} Envíos Totales
            </div>
            <div className="px-6 py-2 bg-green-500/20 border border-green-500/30 rounded-full text-green-400 font-bold text-xl uppercase tracking-widest">
                {activeShipments.length} Activos
            </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 flex-1 min-h-0">
        {/* Active Shipments List */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
          <div className="flex items-center gap-4 mb-8">
            <Truck className="w-12 h-12 text-blue-400" />
            <h3 className="text-3xl font-bold text-slate-300 uppercase tracking-widest">Envíos en Curso</h3>
          </div>
          
          <div className="flex-1 space-y-6 overflow-hidden">
            {activeShipments.length > 0 ? activeShipments.map((s, idx) => (
                <div key={s.id || idx} className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 flex justify-between items-center group hover:bg-slate-700/40 transition-all duration-300">
                    <div className="flex items-center gap-6">
                        <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center font-black text-3xl text-blue-400 border border-blue-500/20">
                            {s.truckPlate.slice(0, 3)}
                        </div>
                        <div>
                            <p className="text-2xl font-black text-white uppercase">{s.truckPlate}</p>
                            <p className="text-lg text-slate-400 font-medium">{s.driverName}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-4xl font-black text-blue-400">{Object.keys(s.scannedLabels || {}).length}</p>
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Cajas</p>
                    </div>
                </div>
            )) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4 opacity-50">
                    <LayoutGrid className="w-20 h-20" />
                    <p className="text-2xl font-bold uppercase tracking-widest">No hay camiones en muelle</p>
                </div>
            )}
          </div>
        </div>

        {/* Dispatch Summary / Stats */}
        <div className="grid grid-rows-2 gap-8 h-full">
            <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
                <div className="flex items-center gap-4 mb-6">
                    <Package className="w-12 h-12 text-purple-400" />
                    <h3 className="text-3xl font-bold text-slate-300 uppercase tracking-widest">Cajas Despachadas</h3>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-9xl font-black text-white tabular-nums drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                        {shipments.reduce((acc, s) => acc + Object.keys(s.scannedLabels || {}).length, 0)}
                    </p>
                </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
                <div className="flex items-center gap-4 mb-6">
                    <CheckCircle2 className="w-12 h-12 text-green-400" />
                    <h3 className="text-3xl font-bold text-slate-300 uppercase tracking-widest">Envíos Completados</h3>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-9xl font-black text-white tabular-nums drop-shadow-[0_0_30px_rgba(34,197,94,0.1)]">
                        {closedShipmentsToday.length}
                    </p>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
