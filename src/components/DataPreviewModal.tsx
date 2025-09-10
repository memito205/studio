import React, { useState } from 'react';
import { RawTransaction, Transaction } from '../types';

interface DataPreviewModalProps {
  rawData: RawTransaction[];
  processedData: Transaction[];
  onConfirm: () => void;
  onCancel: () => void;
  fileName: string;
}

type View = 'raw' | 'processed';

export const DataPreviewModal: React.FC<DataPreviewModalProps> = ({ rawData, processedData, onConfirm, onCancel, fileName }) => {
  const [view, setView] = useState<View>('raw');

  if (!rawData || rawData.length === 0) return null;

  const rawHeaders = Object.keys(rawData[0] || {});
  const rawPreviewData = rawData.slice(0, 100);

  const processedHeaders = ['Fecha', 'Tipo', 'Valor', 'Marca', 'Genero', 'Grupo', 'Motivo Devolucion', 'PDV', 'Referencia'];
  const processedPreviewData = processedData.slice(0, 100);

  const TabButton: React.FC<{ currentView: View; viewName: View; text: string }> = ({ currentView, viewName, text }) => (
    <button
      onClick={() => setView(viewName)}
      className={`px-4 py-2 text-sm font-semibold rounded-t-lg ${
        currentView === viewName
          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" aria-modal="true" role="dialog">
      <div className="bg-slate-100 dark:bg-slate-800 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b dark:border-slate-700 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Previsualización de Datos</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Archivo: <span className="font-semibold">{fileName}</span>
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </header>

        <div className="px-4 border-b border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-900">
           <TabButton currentView={view} viewName="raw" text="Datos Crudos" />
           <TabButton currentView={view} viewName="processed" text="Datos Interpretados" />
        </div>
        
        <div className="p-4 overflow-auto bg-white dark:bg-slate-800 flex-grow">
          {view === 'raw' && (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                Mostrando las primeras {rawPreviewData.length} de {rawData.length} filas leídas del archivo.
              </p>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                  <tr>
                    {rawHeaders.map(header => <th key={header} className="p-2 font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{header}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {rawPreviewData.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                      {rawHeaders.map(header => <td key={header} className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{String(row[header as keyof RawTransaction] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view === 'processed' && (
             <>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                Mostrando las primeras {processedPreviewData.length} de {processedData.length} transacciones interpretadas que se usarán en el dashboard.
              </p>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                  <tr>
                    {processedHeaders.map(header => <th key={header} className="p-2 font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{header}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {processedPreviewData.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.date.toLocaleDateString('es-CO')}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${row.type === 'FVE' ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'}`}>
                                {row.type}
                            </span>
                        </td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.value.toLocaleString('es-CO')}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.brand}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.gender}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.group}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.returnReason}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.pdv}</td>
                        <td className="p-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{row.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <footer className="p-4 border-t dark:border-slate-700 flex justify-end gap-4 bg-slate-100 dark:bg-slate-800 rounded-b-lg">
          <button onClick={onCancel} className="px-4 py-2 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200 font-semibold hover:bg-slate-300 dark:hover:bg-slate-500">
            Cancelar
          </button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-md bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
            Procesar y Ver Dashboard
          </button>
        </footer>
      </div>
    </div>
  );
};