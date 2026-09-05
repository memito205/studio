

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CarrierData, IncomeRecord } from '../types';
import { parseDateFlexible, formatCurrency } from '../utils/formatters';

declare var XLSX: any;

const cleanAndParseCurrency = (costString: string | number): number => {
    if (typeof costString === 'number') {
        return costString;
    }
    const s = String(costString || '0');
    
    let sign = 1;
    // Handle leading/trailing minus or accounting parentheses for negative numbers
    if (s.trim().startsWith('-') || s.trim().endsWith('-') || (s.trim().startsWith('(') && s.trim().endsWith(')'))) {
        sign = -1;
    }

    // Keep only numbers and separators
    let numStr = s.replace(/[^0-9,.]/g, '');

    const lastComma = numStr.lastIndexOf(',');
    const lastDot = numStr.lastIndexOf('.');

    // If both separators are present, the last one determines the decimal separator
    if (lastDot > -1 && lastComma > -1) {
        if (lastComma > lastDot) {
            // Comma is decimal: "1.234,56" -> "1234.56"
            numStr = numStr.replace(/\./g, '').replace(',', '.');
        } else {
            // Dot is decimal: "1,234.56" -> "1234.56"
            numStr = numStr.replace(/,/g, '');
        }
    }
    // If only commas are present
    else if (lastComma > -1) {
        const parts = numStr.split(',');
        // If the last part has 3 digits and there are other parts, it's likely a thousands separator.
        // e.g., "1,234" or "1,234,567"
        if (parts[parts.length - 1].length === 3 && parts.length > 1) {
             numStr = numStr.replace(/,/g, ''); 
        } else {
             // Otherwise, assume the last comma is a decimal separator.
             // e.g., "123,45" -> "123.45"
             numStr = numStr.replace(/,(?=[^,]*$)/, '.').replace(/,/g, '');
        }
    }
    // If only dots are present
    else if (lastDot > -1) {
         const parts = numStr.split('.');
         // If more than one dot, they are thousands separators: "1.234.567" -> "1234567"
         if (parts.length > 2) {
             numStr = numStr.replace(/\./g, '');
         }
         // If one dot and 3 digits after, it's ambiguous ("1.234"). Assume thousands separator.
         else if (parts.length === 2 && parts[1].length === 3) {
             numStr = numStr.replace('.', '');
         }
         // If one dot and not 3 digits after ("123.45"), it's a decimal. Do nothing.
    }
    
    const value = parseFloat(numStr);
    return (isNaN(value) ? 0 : value) * sign;
};


const parseIncomeFiles = async (files: FileList): Promise<{ headers: string[], records: { [key: string]: any }[] }> => {
    // ... (parser function remains the same, just keeping it here for context)
    const parseSheetData = (data: ArrayBuffer): { headers: string[], rows: any[][] } => {
        const workbook = XLSX.read(data, {type: 'array', cellDates: true});
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        
        if (sheetData.length === 0) return { headers: [], rows: [] };

        const headers = sheetData[0].map(header => String(header).trim());
        const rows = sheetData.slice(1);
        return { headers, rows };
    }

    const allHeaders = new Set<string>();
    const allFileRecords: { headers: string[], rows: any[][], fileName: string }[] = [];

    for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().match(/\.(csv|xlsx|xls)$/)) continue;
        
        try {
            const data = await file.arrayBuffer();
            const { headers, rows } = parseSheetData(data);
            if (headers.length === 0 || rows.length === 0) continue;

            headers.forEach(h => allHeaders.add(h));
            allFileRecords.push({ headers, rows, fileName: file.name });
        } catch (error) {
            console.error(`Error processing file ${file.name}:`, error);
            throw new Error(`Error al procesar el archivo "${file.name}".`);
        }
    }

    if (allFileRecords.length === 0) {
        throw new Error("No se encontraron archivos válidos con datos.");
    }

    const unionHeaders = Array.from(allHeaders);
    const unifiedRecords: { [key: string]: any }[] = [];

    allFileRecords.forEach(({ headers, rows }) => {
        rows.forEach(row => {
            const unifiedRecord: { [key: string]: any } = {};
            unionHeaders.forEach(h => unifiedRecord[h] = ''); // Initialize
            headers.forEach((header, index) => {
                if(unionHeaders.includes(header)) {
                    unifiedRecord[header] = row[index] || '';
                }
            });
            unifiedRecords.push(unifiedRecord);
        });
    });

    return { headers: unionHeaders, records: unifiedRecords };
};

interface IncomeMapping {
    fecha: string;
    monto: string;
    contable: string;
    co: string;
    facturaBase: string;
    concepto: string;
    ordenDeCompra: string;
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
}

const MAPPING_FIELDS: { key: keyof Omit<IncomeMapping, 'dateFormat'>, label: string, keywords: string[] }[] = [
    { key: 'fecha', label: 'Fecha', keywords: ['fecha'] },
    { key: 'monto', label: 'Monto (Valor Subtotal)', keywords: ['valor', 'subtotal', 'monto', 'local'] },
    { key: 'contable', label: 'Nro Documento', keywords: ['factura', 'nro documento', 'documento'] },
    { key: 'co', label: 'C.O.', keywords: ['c.o.', 'co', 'centro'] },
    { key: 'ordenDeCompra', label: 'Orden de Compra (PED_ID)', keywords: ['orden de compra', 'orden', 'pedido', 'ped_id'] },
    { key: 'facturaBase', label: 'Factura Base Devolución', keywords: ['factura base', 'devolucion'] },
    { key: 'concepto', label: 'Concepto', keywords: ['concepto', 'descripcion', 'detalle'] },
];

const IncomeDetailsTable: React.FC<{ records: IncomeRecord[] }> = ({ records }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const RECORDS_PER_PAGE = 10;
    const totalPages = Math.ceil(records.length / RECORDS_PER_PAGE);
    const paginatedRecords = records.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);

    if (records.length === 0) return null;

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Detalle de Ingresos Reconciliados</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                     <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Fecha</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Nro Documento</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Concepto</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Monto</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {paginatedRecords.map((record, index) => (
                            <tr key={index} className="hover:bg-slate-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm">{record.fecha}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <div>
                                        <span>{record.co}-{record.contable}</span>
                                        {record.modificacionNC && <span className="block text-blue-600 italic text-xs">{record.modificacionNC}</span>}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm truncate max-w-sm">{record.concepto}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">{formatCurrency(record.monto)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
             {totalPages > 1 && (
                 <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
                    <span className="text-sm text-slate-600">Mostrando {paginatedRecords.length} de {records.length} registros</span>
                    <div className="flex items-center space-x-2">
                         <button onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1} className="px-3 py-1 border rounded-md text-sm disabled:opacity-50">Anterior</button>
                         <span>Página {currentPage} de {totalPages}</span>
                         <button onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages} className="px-3 py-1 border rounded-md text-sm disabled:opacity-50">Siguiente</button>
                    </div>
                </div>
            )}
        </div>
    );
};


interface IncomeVsExpenseDashboardProps {
  carriers: CarrierData[];
  incomeRecords: IncomeRecord[];
  setIncomeRecords: (records: IncomeRecord[]) => void;
}

const IncomeVsExpenseDashboard: React.FC<IncomeVsExpenseDashboardProps> = ({ carriers, incomeRecords, setIncomeRecords }) => {
    const [isParsing, setIsParsing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
    const [incomeMapping, setIncomeMapping] = useState<IncomeMapping | null>(null);
    const [tempIncomeData, setTempIncomeData] = useState<{headers: string[], records: {[key:string]:any}[]} | null>(null);


    const handleFileParse = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setIsParsing(true);
        setError(null);
        try {
            const { headers, records } = await parseIncomeFiles(files);
            if (records.length === 0) throw new Error("Los archivos no contienen datos válidos.");
            setTempIncomeData({ headers, records });

            const autoMapping: any = {};
            MAPPING_FIELDS.forEach(field => {
                const match = headers.find(h => field.keywords.some(kw => h.toLowerCase().includes(kw)));
                autoMapping[field.key] = match || '';
            });
            autoMapping.dateFormat = 'DD/MM/YYYY';
            setIncomeMapping(autoMapping as IncomeMapping);

        } catch (err: any) {
            setError(err.message || 'Error al procesar los archivos.');
        } finally {
            setIsParsing(false);
        }
    };
    
    const handleConfirmMapping = () => {
        if (!tempIncomeData || !incomeMapping) return;

        type TempRecord = IncomeRecord & { [key: string]: any };
        
        const tempRecords: TempRecord[] = tempIncomeData.records.map(raw => ({
            fecha: raw[incomeMapping.fecha],
            monto: raw[incomeMapping.monto],
            contable: raw[incomeMapping.contable],
            co: raw[incomeMapping.co],
            concepto: raw[incomeMapping.concepto],
            ordenDeCompra: raw[incomeMapping.ordenDeCompra],
            facturaBase: raw[incomeMapping.facturaBase]
        }));

        const recordMap = new Map<string, TempRecord>();
        const creditNoteRecords: TempRecord[] = [];

        tempRecords.forEach(rec => {
            if (!rec.co || !rec.contable) return;
            const uniqueId = `${String(rec.co).trim()}-${String(rec.contable).trim()}`;
            recordMap.set(uniqueId, rec);
            if (String(rec.contable).trim().startsWith('NCE-')) {
                creditNoteRecords.push(rec);
            }
        });

        creditNoteRecords.forEach(ncRec => {
            if (!ncRec.co || !ncRec.facturaBase) return;
            const targetInvoiceId = `${String(ncRec.co).trim()}-${String(ncRec.facturaBase).trim()}`;
            const originalInvoiceRec = recordMap.get(targetInvoiceId);

            if (originalInvoiceRec) {
                const originalCost = cleanAndParseCurrency(originalInvoiceRec.monto);
                const ncCost = cleanAndParseCurrency(ncRec.monto);
                
                originalInvoiceRec.monto = originalCost + ncCost;
                originalInvoiceRec.modificacionNC = `(NC ${String(ncRec.co).trim()}-${String(ncRec.contable).trim()} aplicada)`;
                
                const ncUniqueId = `${String(ncRec.co).trim()}-${String(ncRec.contable).trim()}`;
                recordMap.delete(ncUniqueId);
            }
        });

        const finalRecords: IncomeRecord[] = Array.from(recordMap.values()).map((rec): IncomeRecord | null => {
            try {
                return {
                    ...rec,
                    fecha: parseDateFlexible(rec.fecha, incomeMapping.dateFormat),
                    monto: cleanAndParseCurrency(rec.monto),
                };
            } catch (e) { return null; }
        }).filter((rec): rec is IncomeRecord => rec !== null && /^\d{4}-\d{2}-\d{2}$/.test(rec.fecha));
        
        setIncomeRecords(finalRecords);
        setTempIncomeData(null);
        setIncomeMapping(null);
    };

    // FIX: Refactored `allYears` calculation to use `forEach` and a `Set`.
    // This provides more stable type inference in TypeScript, resolving multiple downstream errors.
    const allYears = useMemo(() => {
        const years = new Set<string>();
        carriers.forEach(c => c.data.forEach(d => {
            if (d.fecha) years.add(d.fecha.substring(0, 4));
        }));
        incomeRecords.forEach(r => {
            if (r.fecha) years.add(r.fecha.substring(0, 4));
        });
        return Array.from(years).sort((a, b) => b.localeCompare(a));
    }, [carriers, incomeRecords]);
    
    useEffect(() => {
        if (allYears.length > 0 && !allYears.includes(selectedYear)) {
            setSelectedYear(allYears[0]);
        }
    }, [allYears, selectedYear]);

    const filteredExpenseRecords = useMemo(() => {
        return carriers.flatMap(c => c.data).filter(r => r.fecha.startsWith(selectedYear) && r.concepto === 'TRANSPORTE ECOMMERCE');
    }, [carriers, selectedYear]);

    const filteredIncomeRecords = useMemo(() => {
        return incomeRecords.filter(r => r.fecha.startsWith(selectedYear));
    }, [incomeRecords, selectedYear]);

    const monthlyData = useMemo(() => {
        const dataMap = new Map<string, { income: number, expense: number }>();
        for (let i = 1; i <= 12; i++) {
            dataMap.set(i.toString().padStart(2, '0'), { income: 0, expense: 0 });
        }

        filteredIncomeRecords.forEach(r => {
            const month = r.fecha.substring(5, 7);
            const entry = dataMap.get(month);
            if (entry) entry.income += r.monto;
        });

        filteredExpenseRecords.forEach(r => {
            const month = r.fecha.substring(5, 7);
            const entry = dataMap.get(month);
            if (entry) entry.expense += r.costo;
        });

        return Array.from(dataMap.entries()).map(([monthKey, values]) => ({
            name: new Date(2000, parseInt(monthKey, 10) - 1, 1).toLocaleString('es-CO', { month: 'short' }),
            ...values
        }));

    }, [filteredIncomeRecords, filteredExpenseRecords]);

    const totalIncome = useMemo(() => filteredIncomeRecords.reduce((acc, r) => acc + r.monto, 0), [filteredIncomeRecords]);
    const totalExpense = useMemo(() => filteredExpenseRecords.reduce((acc, r) => acc + r.costo, 0), [filteredExpenseRecords]);
    const netTotal = useMemo(() => totalIncome - totalExpense, [totalIncome, totalExpense]);

    const handleCancelMapping = () => {
        setTempIncomeData(null);
        setIncomeMapping(null);
    }

    if (tempIncomeData && incomeMapping) {
        return (
            <div className="max-w-7xl mx-auto bg-white p-8 rounded-xl shadow-lg animate-fade-in">
                <h2 className="text-2xl font-bold mb-2 text-slate-800">Mapear Columnas de Ingresos</h2>
                <p className="text-slate-600 mb-6">Por favor, asigne las columnas de su archivo a los campos requeridos.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6 border border-slate-200 rounded-lg mb-6">
                    {MAPPING_FIELDS.map(field => (
                        <div key={field.key}>
                            <label htmlFor={field.key} className="block text-sm font-bold text-slate-700 mb-1">{field.label}</label>
                            <select
                                id={field.key}
                                value={incomeMapping[field.key] || ''}
                                onChange={(e) => setIncomeMapping(prev => prev ? ({ ...prev, [field.key]: e.target.value }) : null)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            >
                                <option value="">-- Seleccione --</option>
                                {tempIncomeData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                    ))}
                     <div>
                        <label htmlFor="incomeDateFormat" className="block text-sm font-bold text-slate-700 mb-1">Formato de Fecha</label>
                        <select
                            id="incomeDateFormat"
                            value={incomeMapping.dateFormat || 'DD/MM/YYYY'}
                            onChange={(e) => setIncomeMapping(prev => prev ? ({ ...prev, dateFormat: e.target.value as IncomeMapping['dateFormat'] }) : null)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md"
                        >
                            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                            <option value="YYYY-MM-DD">YYYY-MM-DD (Recomendado)</option>
                        </select>
                    </div>
                </div>
                <div className="flex justify-end space-x-4 mt-8">
                    <button onClick={handleCancelMapping} className="px-6 py-2 border rounded-md">Cancelar</button>
                    <button onClick={handleConfirmMapping} className="px-6 py-2 border rounded-md text-white bg-green-600">Confirmar e Importar</button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
             <div className="bg-white p-6 rounded-xl shadow-lg">
                <h2 className="text-xl font-bold text-slate-800 mb-4">Cargar y Reconciliar Datos de Ingresos</h2>
                <p className="text-slate-600 mb-4">
                    Cargue sus archivos de ingresos (Excel/CSV). El sistema intentará reconciliar las notas de crédito con sus facturas base.
                </p>
                <input
                    type="file"
                    id="incomeFiles"
                    // @ts-ignore
                    webkitdirectory="" 
                    directory=""
                    onChange={handleFileParse}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    disabled={isParsing}
                />
                {isParsing && <p className="mt-2 text-blue-600">Procesando archivos...</p>}
                {error && <div className="mt-4 bg-red-100 border-red-400 text-red-700 px-4 py-3 rounded-md">{error}</div>}
                {incomeRecords.length > 0 && !isParsing && (
                    <p className="mt-4 text-green-700 font-semibold">
                        {incomeRecords.length} registros de ingresos cargados y reconciliados exitosamente.
                    </p>
                )}
            </div>

            { (carriers.length > 0 || incomeRecords.length > 0) &&
                <>
                    <div className="bg-white p-4 rounded-xl shadow-lg">
                        <div className="w-full sm:w-1-2 md:w-1/4">
                            <label htmlFor="year-select-income" className="block text-sm font-medium text-slate-700">Seleccionar Año</label>
                            <select
                                id="year-select-income"
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(e.target.value)}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-slate-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            >
                                {allYears.map(year => <option key={year} value={year}>{year}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                         <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h4 className="text-sm font-medium text-slate-500">Ingresos Totales ({selectedYear})</h4>
                            <p className="text-3xl font-bold text-green-600 mt-1">{formatCurrency(totalIncome)}</p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h4 className="text-sm font-medium text-slate-500">Gastos de Transporte ({selectedYear})</h4>
                            <p className="text-3xl font-bold text-red-600 mt-1">{formatCurrency(totalExpense)}</p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h4 className="text-sm font-medium text-slate-500">Neto ({selectedYear})</h4>
                            <p className={`text-3xl font-bold mt-1 ${netTotal >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{formatCurrency(netTotal)}</p>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
                        <h3 className="text-xl font-bold text-slate-800 mb-4">Ingreso vs. Gasto Mensual ({selectedYear})</h3>
                        <ResponsiveContainer width="100%" height="90%">
                            <BarChart data={monthlyData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis tickFormatter={(val) => formatCurrency(val, true)} />
                                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                <Legend />
                                <Bar dataKey="income" name="Ingreso" fill="#10b981" />
                                <Bar dataKey="expense" name="Gasto" fill="#ef4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <IncomeDetailsTable records={filteredIncomeRecords} />
                </>
            }
        </div>
    );
};

export default IncomeVsExpenseDashboard;