
import React, { useState, useMemo, useEffect } from 'react';
import { ColumnMapping } from '../types';

interface DataMappingStepProps {
  data: { carrierName: string, headers: string[], records: { [key: string]: string }[] };
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

const REQUIRED_FIELDS: { key: keyof Omit<ColumnMapping, 'dateFormat'>, label: string, keywords: string[] }[] = [
    { key: 'fecha', label: 'Fecha Factura', keywords: ['fecha'] },
    { key: 'destino', label: 'Destino (Cargar a)', keywords: ['destino', 'cargar a', 'destinatario'] },
    { key: 'costo', label: 'Costo (Valor Subtotal Local)', keywords: ['costo', 'valor', 'total', 'subtotal', 'local', 'valor subtotal local'] },
    { key: 'contable', label: 'Nro Documento (Factura)', keywords: ['factura', 'source.name', 'nro documento'] },
    { key: 'concepto', label: 'Concepto Contable', keywords: ['concepto', 'contable', 'descripcion', 'detalle', 'servicio'] },
    { key: 'guia', label: 'Nro Guía/Remesa', keywords: ['guia', 'guía', 'remesa', 'documento transporte'] },
];

const findBestMatch = (keywords: string[], headers: string[]): string => {
    for (const header of headers) {
        const lowerHeader = header.toLowerCase();
        if (keywords.some(kw => lowerHeader.includes(kw))) {
            return header;
        }
    }
    return '';
};

const DataMappingStep: React.FC<DataMappingStepProps> = ({ data, onConfirm, onCancel }) => {
  const { carrierName, headers, records } = data;
  
  const initialMapping = useMemo(() => {
      const mapping: Partial<ColumnMapping> = {};
      const usedHeaders: string[] = [];
      const tempMapping: { [key: string]: string } = {};

      REQUIRED_FIELDS.forEach(field => {
          const availableHeaders = headers.filter(h => !usedHeaders.includes(h));
          const match = findBestMatch(field.keywords, availableHeaders);
          if (match) {
            tempMapping[field.key] = match;
            usedHeaders.push(match);
          }
      });
      
      REQUIRED_FIELDS.forEach(field => {
        mapping[field.key] = tempMapping[field.key] || '';
      });
      
      mapping.dateFormat = 'DD/MM/YYYY';

      return mapping as ColumnMapping;
  }, [headers]);

  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  const handleMappingChange = (field: keyof Omit<ColumnMapping, 'dateFormat'>, value: string) => {
    setMapping(prev => ({ ...prev, [field]: value }));
  };
  
  const handleDateFormatChange = (value: ColumnMapping['dateFormat']) => {
    setMapping(prev => ({ ...prev, dateFormat: value }));
  };

  const isMappingComplete = useMemo(() => {
    return REQUIRED_FIELDS.every(field => mapping[field.key]);
  }, [mapping]);

  const previewRecords = records.slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto bg-white p-8 rounded-xl shadow-lg animate-fade-in">
      <h2 className="text-2xl font-bold mb-2 text-slate-800">Mapear Columnas para {carrierName}</h2>
      <p className="text-slate-600 mb-6">
        Se encontraron <span className="font-bold text-blue-600">{records.length}</span> registros. 
        Por favor, asigne las columnas de su archivo a los campos requeridos por el dashboard.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6 border border-slate-200 rounded-lg mb-6">
          {REQUIRED_FIELDS.map(field => (
              <div key={field.key}>
                  <label htmlFor={field.key} className="block text-sm font-bold text-slate-700 mb-1">
                      {field.label}
                  </label>
                  <select
                      id={field.key}
                      value={mapping[field.key]}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                      <option value="">-- Seleccione una columna --</option>
                      {headers.map(header => (
                          <option key={header} value={header}>{header}</option>
                      ))}
                  </select>
              </div>
          ))}
          <div>
              <label htmlFor="dateFormat" className="block text-sm font-bold text-slate-700 mb-1">
                  Formato de Fecha
              </label>
              <select
                  id="dateFormat"
                  value={mapping.dateFormat}
                  onChange={(e) => handleDateFormatChange(e.target.value as ColumnMapping['dateFormat'])}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD (Recomendado)</option>
              </select>
          </div>
      </div>

      <h3 className="text-lg font-bold text-slate-800 mb-4">Vista Previa de los Datos</h3>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {headers.map(header => (
                 <th key={header} className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {previewRecords.map((record, index) => (
              <tr key={index} className="hover:bg-slate-50">
                {headers.map(header => (
                    <td key={header} className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{record[header]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end space-x-4 mt-8">
        <button
          onClick={onCancel}
          className="px-6 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
        >
          Cancelar
        </button>
        <button
          onClick={() => onConfirm(mapping)}
          disabled={!isMappingComplete}
          className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
        >
          Confirmar e Importar
        </button>
      </div>
    </div>
  );
};

export default DataMappingStep;