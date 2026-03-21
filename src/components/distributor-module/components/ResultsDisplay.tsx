import React from 'react';
import type { Allocation, StockItem, DistributionRule } from '../types';
import { SparklesIcon } from './icons';
import SummaryTable from './SummaryTable';
import DistributionPivotTable from './DistributionPivotTable';

interface ResultsDisplayProps {
  data: Allocation | null;
  aiSummary: string | null;
  stockData: StockItem[] | null;
  planData: DistributionRule[] | null;
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ data, aiSummary, stockData, planData }) => {
  if (!data) return null;

  const stores = Object.keys(data).sort();

  if (stores.length === 0) {
    return (
      <div className="mt-8 text-center text-gray-500">
        <p>No se generaron distribuciones. Verifique los archivos de entrada.</p>
      </div>
    );
  }

  return (
    <div className="mt-12 w-full">
      <h2 className="text-3xl font-bold text-gray-800 text-center mb-8">Resultados de la Distribución</h2>
      
      <SummaryTable allocations={data} stock={stockData} plan={planData} />

      <DistributionPivotTable allocations={data} />

      {aiSummary && (
        <div className="my-10 bg-primary/10 border-l-4 border-primary text-primary p-6 rounded-r-lg shadow-md">
          <div className="flex">
            <div className="py-1">
              <SparklesIcon className="w-6 h-6 text-primary mr-4"/>
            </div>
            <div>
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: aiSummary.replace(/\n/g, '<br />') }}></div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stores.map((bodega) => (
          <div key={bodega} className="bg-white rounded-lg shadow-lg overflow-hidden transform hover:scale-105 transition-transform duration-300">
            <div className="p-5">
              <h3 className="text-xl font-bold text-primary truncate">{bodega}</h3>
              <div className="mt-4 space-y-4">
                {Object.keys(data[bodega]).length > 0 ? Object.entries(data[bodega])
                  .sort((a,b) => a[0].localeCompare(b[0]))
                  .map(([referencia, details]) => (
                  <div key={referencia}>
                    <div className="flex justify-between items-baseline">
                        <h4 className="font-semibold text-gray-700">{referencia}</h4>
                        <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${details.allocated >= details.requested ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                           {details.allocated} / {details.requested}
                        </span>
                    </div>
                    {details.items.length > 0 ? (
                      <table className="mt-2 w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium text-gray-500">Talla</th>
                            <th className="px-2 py-1 text-right font-medium text-gray-500">Cantidad</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {details.items.map((item) => (
                            <tr key={item.talla}>
                              <td className="px-2 py-1 text-gray-600">{item.talla}</td>
                              <td className="px-2 py-1 text-right font-semibold text-gray-800">{item.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                        <p className="text-xs text-center text-gray-500 mt-2 py-2 bg-gray-50 rounded">Sin asignaciones para esta referencia.</p>
                    )}
                  </div>
                )) : <p className="text-sm text-gray-500">No hay referencias para esta bodega.</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResultsDisplay;