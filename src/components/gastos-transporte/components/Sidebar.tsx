
import React from 'react';
import { CarrierData, MainView } from '../types';

interface SidebarProps {
  carriers: CarrierData[];
  onAddNew: () => void;
  mainView: MainView;
  setMainView: (view: MainView) => void;
}

const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const ChartBarIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
  </svg>
);

const ScaleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

const CurrencyDollarIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" {...props}>
    <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v.077a1.5 1.5 0 000 2.846V10a1 1 0 102 0v-.077a1.5 1.5 0 000-2.846V7zm-2 5a1 1 0 100 2h2a1 1 0 100-2H9z" />
  </svg>
);

const TagIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
    <line x1="7" y1="7" x2="7.01" y2="7"></line>
  </svg>
);

const Sidebar: React.FC<SidebarProps> = ({ carriers, onAddNew, mainView, setMainView }) => {
  const navButtonStyle = "w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 flex items-center space-x-3";
  const activeStyle = "bg-blue-100 text-blue-700";
  const inactiveStyle = "text-slate-600 hover:bg-slate-100 hover:text-slate-900";

  return (
    <aside className="w-64 bg-white shadow-lg flex flex-col">
      <div className="p-4 border-b border-slate-200">
        <h2 className="text-xl font-bold text-blue-600">Menú Principal</h2>
      </div>

      <div className="p-4 space-y-2 border-b border-slate-200">
         <button onClick={() => setMainView('dashboard')} className={`${navButtonStyle} ${mainView === 'dashboard' ? activeStyle : inactiveStyle}`}>
            <ChartBarIcon />
            <span>General</span>
         </button>
          <button onClick={() => setMainView('income-expense')} className={`${navButtonStyle} ${mainView === 'income-expense' ? activeStyle : inactiveStyle}`}>
            <ScaleIcon />
            <span>Ingreso vs Gasto</span>
         </button>
         <button onClick={() => setMainView('profitability')} className={`${navButtonStyle} ${mainView === 'profitability' ? activeStyle : inactiveStyle}`}>
            <CurrencyDollarIcon />
            <span>Rentabilidad (Ingreso)</span>
         </button>
         <button onClick={() => setMainView('expense-profitability')} className={`${navButtonStyle} ${mainView === 'expense-profitability' ? activeStyle : inactiveStyle}`}>
            <CurrencyDollarIcon />
            <span>Rentabilidad (Gasto)</span>
         </button>
         <button onClick={() => setMainView('justifications')} className={`${navButtonStyle} ${mainView === 'justifications' ? activeStyle : inactiveStyle}`}>
            <TagIcon />
            <span>Justificaciones / Campañas</span>
         </button>
         <button onClick={() => setMainView('year-over-year')} className={`${navButtonStyle} ${mainView === 'year-over-year' ? activeStyle : inactiveStyle}`}>
            <ChartBarIcon />
            <span>Comparativo Anual</span>
         </button>
         <button onClick={() => setMainView('accrual')} className={`${navButtonStyle} ${mainView === 'accrual' ? activeStyle : inactiveStyle}`}>
            <ScaleIcon />
            <span>Devengado / Cruce Mes</span>
         </button>
      </div>

      <div className="p-4 border-b border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800">Transportadoras</h3>
      </div>
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {carriers.length > 0 ? (
          carriers.map(carrier => (
            <div key={carrier.id} className="flex items-center space-x-3 p-2 rounded-md">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: carrier.color }}></span>
              <span className="font-medium text-slate-700">{carrier.name}</span>
            </div>
          ))
        ) : (
          <div className="text-center text-slate-500 italic p-4">No hay datos.</div>
        )}
      </nav>
      <div className="p-4 mt-auto border-t border-slate-200">
        <button onClick={onAddNew} className="w-full flex items-center justify-center bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200">
          <PlusIcon className="mr-2"/>
          Añadir Datos
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
