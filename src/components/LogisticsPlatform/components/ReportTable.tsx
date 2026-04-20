import React from 'react';
import { DownloadIcon } from './icons';
import { exportToExcel } from '../utils/helpers';

interface ReportTableProps {
  title: string;
  data: { [key: string]: React.ReactNode }[];
  headers: string[];
  exportData: { [key: string]: any }[];
  icon: React.ReactNode;
  summaryText?: string;
  secondaryAction?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  };
}

const ReportTable: React.FC<ReportTableProps> = ({ title, data, headers, exportData, icon, summaryText, secondaryAction }) => {
  const handleExport = () => {
    exportToExcel(exportData, title);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-8 flex flex-col">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
          <div className="flex items-center">
            {icon}
            <h2 className="text-xl font-bold text-gray-800">{title} ({data.length} registros)</h2>
          </div>
          {summaryText && (
            <span className="text-sm font-semibold text-gray-700 bg-gray-100 px-3 py-1 rounded-full border border-gray-200">
                {summaryText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
            {secondaryAction && (
                <button
                    onClick={secondaryAction.onClick}
                    className="inline-flex items-center px-3 py-1.5 border border-red-500 shadow-sm text-sm font-medium rounded-md text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={secondaryAction.label}
                    disabled={secondaryAction.disabled || data.length === 0}
                >
                    {secondaryAction.icon}
                    {secondaryAction.label}
                </button>
            )}
            <button
              onClick={handleExport}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              aria-label={`Exportar ${title} a Excel`}
              disabled={data.length === 0}
            >
              <DownloadIcon className="h-4 w-4 mr-2" />
              Exportar
            </button>
        </div>
      </div>
      
      <div className="overflow-x-auto flex-grow">
        <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                {headers.map((header) => (
                    <th
                    key={header}
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                    {header}
                    </th>
                ))}
                </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {data.length > 0 ? (
                  data.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-gray-50">
                        {headers.map((header) => (
                        <td key={`${rowIndex}-${header}`} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {row[header]}
                        </td>
                        ))}
                    </tr>
                  ))
                ) : (
                    <tr>
                        <td colSpan={headers.length || 1} className="px-6 py-4 text-center text-gray-500">
                            No se encontraron registros que coincidan con los filtros.
                        </td>
                    </tr>
                )}
            </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default ReportTable;
