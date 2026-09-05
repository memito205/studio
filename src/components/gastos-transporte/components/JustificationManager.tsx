
import React, { useState, useCallback } from 'react';
import { parseFiles } from '../services/csvParser';
import { JustificationRecord } from '../types';

interface JustificationManagerProps {
    justifications: JustificationRecord[];
    setJustifications: (recs: JustificationRecord[]) => void;
}

const JustificationManager: React.FC<JustificationManagerProps> = ({ justifications, setJustifications }) => {
    const [isParsing, setIsParsing] = useState(false);
    const [tempData, setTempData] = useState<{headers: string[], records: {[key:string]: string}[]} | null>(null);
    const [mapping, setMapping] = useState({ pedId: '', motivo: '' });
    const [error, setError] = useState<string | null>(null);

    const handleFileParse = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        setIsParsing(true);
        setError(null);
        try {
            const result = await parseFiles(files);
            setTempData(result);
            const pedIdMatch = result.headers.find(h => h.toLowerCase().includes('ped') || h.toLowerCase().includes('orden') || h.toLowerCase().includes('compra'));
            const motivoMatch = result.headers.find(h => h.toLowerCase().includes('motivo') || h.toLowerCase().includes('campaña') || h.toLowerCase().includes('justifica'));
            setMapping({ pedId: pedIdMatch || '', motivo: motivoMatch || '' });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsParsing(false);
        }
    };

    const confirmMapping = () => {
        if (!tempData || !mapping.pedId || !mapping.motivo) return;
        const newJustifications: JustificationRecord[] = tempData.records.map(r => ({
            pedId: String(r[mapping.pedId]).replace('DDD-', '').replace(/-/g, ''),
            motivo: String(r[mapping.motivo])
        })).filter(j => j.pedId && j.motivo);
        
        setJustifications([...justifications, ...newJustifications]);
        setTempData(null);
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-lg">
                <h2 className="text-2xl font-bold text-slate-800 mb-4">Gestión de Justificaciones (Campañas)</h2>
                <p className="text-slate-600 mb-6">Suba un archivo con las órdenes de compra que corresponden a campañas (ej: Flete Gratis) para marcarlas como gastos justificados.</p>
                
                <input type="file" id="justFile" accept=".csv,.xlsx,.xls" onChange={handleFileParse} className="hidden" />
                <label htmlFor="justFile" className="px-6 py-2 border rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer">
                    {isParsing ? 'Procesando...' : 'Cargar Justificaciones'}
                </label>

                {tempData && (
                    <div className="mt-6 p-4 border rounded-lg bg-slate-50 space-y-4">
                        <h3 className="font-bold">Mapear Columnas</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium">Orden de Compra (PED_ID)</label>
                                <select value={mapping.pedId} onChange={e => setMapping({...mapping, pedId: e.target.value})} className="w-full border rounded p-2">
                                    <option value="">Seleccione...</option>
                                    {tempData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Motivo / Campaña</label>
                                <select value={mapping.motivo} onChange={e => setMapping({...mapping, motivo: e.target.value})} className="w-full border rounded p-2">
                                    <option value="">Seleccione...</option>
                                    {tempData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                            </div>
                        </div>
                        <button onClick={confirmMapping} className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700">Confirmar</button>
                    </div>
                )}
                {error && <p className="mt-4 text-red-600">{error}</p>}
            </div>

            {justifications.length > 0 && (
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-bold mb-4">Listado de Justificaciones Cargadas ({justifications.length})</h3>
                    <div className="max-h-96 overflow-y-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead><tr><th className="px-4 py-2 text-left">PED_ID</th><th className="px-4 py-2 text-left">Motivo</th></tr></thead>
                            <tbody>
                                {justifications.map((j, i) => (
                                    <tr key={i} className="hover:bg-slate-50"><td className="px-4 py-2 text-sm">{j.pedId}</td><td className="px-4 py-2 text-sm">{j.motivo}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button onClick={() => setJustifications([])} className="mt-4 text-red-600 hover:underline text-sm">Limpiar todas</button>
                </div>
            )}
        </div>
    );
};

export default JustificationManager;
