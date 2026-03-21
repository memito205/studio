import React, { useState, useEffect, useCallback } from 'react';
import type { BoxCurveRule } from '../types';
import { PlusIcon, TrashIcon } from './icons';

interface CurveTemplate {
    id: string;
    name: string;
    sizes: { talla: string; cantidad: number }[];
}

interface CurveConfiguratorProps {
    references: string[];
    onCurvesChange: (curves: BoxCurveRule[]) => void;
    reset: boolean;
}

const CurveConfigurator: React.FC<CurveConfiguratorProps> = ({ references, onCurvesChange, reset }) => {
    const [templates, setTemplates] = useState<{ [id: string]: CurveTemplate }>({});
    const [assignments, setAssignments] = useState<{ [reference: string]: string }>({});
    const [nextId, setNextId] = useState(1);

    useEffect(() => {
        if (reset) {
            setTemplates({});
            setAssignments({});
            setNextId(1);
        }
    }, [reset]);

    useEffect(() => {
        const formattedCurves: BoxCurveRule[] = [];
        for (const reference in assignments) {
            const templateId = assignments[reference];
            if (templateId && templates[templateId]) {
                const template = templates[templateId];
                for (const sizeRule of template.sizes) {
                    const cantidadNum = Number(sizeRule.cantidad);
                    if (sizeRule.talla && cantidadNum > 0) {
                        formattedCurves.push({
                            REFERENCIA: reference,
                            TALLA: String(sizeRule.talla).trim(),
                            CANTIDAD_CURVA: cantidadNum,
                        });
                    }
                }
            }
        }
        onCurvesChange(formattedCurves);
    }, [templates, assignments, onCurvesChange]);
    
    // Reset assignments when references change
    useEffect(() => {
        setAssignments({});
    }, [references]);

    const handleAddTemplate = () => {
        const id = `template-${nextId}`;
        setTemplates(prev => ({
            ...prev,
            [id]: { id, name: `Plantilla ${nextId}`, sizes: [{ talla: '', cantidad: 1 }] }
        }));
        setNextId(prev => prev + 1);
    };

    const handleDeleteTemplate = (id: string) => {
        setTemplates(prev => {
            const newTemplates = { ...prev };
            delete newTemplates[id];
            return newTemplates;
        });
        setAssignments(prev => {
            const newAssignments = { ...prev };
            Object.keys(newAssignments).forEach(ref => {
                if (newAssignments[ref] === id) {
                    delete newAssignments[ref];
                }
            });
            return newAssignments;
        });
    };

    const handleUpdateTemplate = (id: string, updatedTemplate: Partial<CurveTemplate>) => {
        setTemplates(prev => ({
            ...prev,
            [id]: { ...prev[id], ...updatedTemplate }
        }));
    };
    
    const handleAddSize = (templateId: string) => {
        const newSizes = [...templates[templateId].sizes, { talla: '', cantidad: 1 }];
        handleUpdateTemplate(templateId, { sizes: newSizes });
    };

    const handleUpdateSize = (templateId: string, sizeIndex: number, updatedSize: { talla?: string, cantidad?: number }) => {
        const newSizes = [...templates[templateId].sizes];
        newSizes[sizeIndex] = { ...newSizes[sizeIndex], ...updatedSize };
        handleUpdateTemplate(templateId, { sizes: newSizes });
    };

    const handleDeleteSize = (templateId: string, sizeIndex: number) => {
        const newSizes = templates[templateId].sizes.filter((_, i) => i !== sizeIndex);
        handleUpdateTemplate(templateId, { sizes: newSizes });
    };

    const handleAssignmentChange = (reference: string, templateId: string) => {
        setAssignments(prev => ({ ...prev, [reference]: templateId }));
    };

    if (references.length === 0) {
        return null;
    }

    return (
        <div className="w-full mb-8 bg-white p-6 sm:p-8 rounded-2xl shadow-lg border border-gray-200 space-y-8">
            <div>
                <h3 className="text-xl font-bold text-gray-800 mb-1">3. Configurar Plantillas de Curva (Opcional)</h3>
                <p className="text-sm text-gray-600">Cree plantillas reutilizables y asígnelas a las referencias que comparten la misma curva de caja.</p>
            </div>

            {/* Step 1: Template Management */}
            <div className="space-y-4">
                 <h4 className="text-lg font-semibold text-gray-700">Paso 1: Crear y editar plantillas</h4>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {Object.values(templates).map(template => (
                        <div key={template.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                           <div className="flex justify-between items-center gap-2">
                                <input
                                    type="text"
                                    value={template.name}
                                    onChange={e => handleUpdateTemplate(template.id, { name: e.target.value })}
                                    className="text-md font-semibold text-primary border-b-2 border-transparent focus:border-ring bg-transparent focus:outline-none w-full"
                                    placeholder="Nombre de la Plantilla"
                                />
                                <button onClick={() => handleDeleteTemplate(template.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                                    <TrashIcon className="w-5 h-5"/>
                                </button>
                           </div>
                           <div className="space-y-2">
                                {template.sizes.map((size, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            placeholder="Talla"
                                            value={size.talla}
                                            onChange={e => handleUpdateSize(template.id, index, { talla: e.target.value })}
                                            className="w-full px-2 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-ring focus:border-ring"
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="Cant."
                                            value={size.cantidad}
                                            onChange={e => handleUpdateSize(template.id, index, { cantidad: parseInt(e.target.value, 10) || 0 })}
                                            className="w-24 px-2 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-ring focus:border-ring"
                                        />
                                        <button onClick={() => handleDeleteSize(template.id, index)} className="text-gray-400 hover:text-red-500 transition-colors">
                                            <TrashIcon className="w-4 h-4"/>
                                        </button>
                                    </div>
                                ))}
                           </div>
                            <button
                                onClick={() => handleAddSize(template.id)}
                                className="text-sm text-primary hover:opacity-80 font-medium flex items-center gap-1"
                            >
                                <PlusIcon className="w-4 h-4"/>
                                Añadir Talla
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    onClick={handleAddTemplate}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary/20 text-primary font-semibold rounded-lg hover:bg-primary/30 transition-colors text-sm"
                >
                    <PlusIcon className="w-5 h-5"/>
                    Crear Nueva Plantilla
                </button>
            </div>

            {/* Step 2: Assignment */}
            {Object.keys(templates).length > 0 && (
                <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-gray-700">Paso 2: Asignar plantillas a referencias</h4>
                    <div className="overflow-x-auto rounded-lg border max-h-[400px]">
                        <table className="min-w-full text-sm divide-y divide-gray-200">
                            <thead className="bg-gray-100 sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-600">Referencia</th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-600">Plantilla de Curva Asignada</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {references.map(ref => (
                                    <tr key={ref} className="hover:bg-gray-50">
                                        <td className="px-6 py-3 font-medium text-gray-900">{ref}</td>
                                        <td className="px-6 py-3">
                                            <select
                                                value={assignments[ref] || ''}
                                                onChange={e => handleAssignmentChange(ref, e.target.value)}
                                                className="w-full max-w-xs px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:ring-ring focus:border-ring"
                                            >
                                                <option value="">-- Sin Curva --</option>
                                                {Object.values(templates).map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CurveConfigurator;