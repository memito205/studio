import React from 'react';
import { MainView } from '../types';

interface HeaderProps {
  mainView: MainView;
  onReturn?: () => void;
}

const Header: React.FC<HeaderProps> = ({ mainView, onReturn }) => {
  const getTitle = () => {
    switch (mainView) {
      case 'comparative':
        return "Análisis Comparativo Anual";
      case 'income-expense':
        return "Análisis de Ingreso vs. Gasto";
      case 'profitability':
        return "Análisis de Rentabilidad (por Ingreso)";
      case 'expense-profitability':
        return "Análisis de Rentabilidad (por Gasto)";
      case 'justifications':
        return "Justificaciones / Campañas";
      case 'year-over-year':
        return "Comparativo Anual";
      case 'accrual':
        return "Devengado / Cruce Mes";
      case 'dashboard':
      default:
        return "Gastos de transporte";
    }
  };

  return (
    <header className="bg-white shadow-sm p-4 z-10 flex items-center justify-between gap-4">
      <h1 className="text-2xl font-bold text-slate-800 truncate">{getTitle()}</h1>
      {onReturn && (
        <button
          type="button"
          onClick={onReturn}
          className="flex-shrink-0 inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Volver a Tableros Bod Ppal
        </button>
      )}
    </header>
  );
};

export default Header;
