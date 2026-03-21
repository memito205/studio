import React, { useState, useEffect } from 'react';
import { XIcon } from './icons';

interface MappingModalProps {
    unmappedWarehouses: string[];
    onSave: (mappings: { [warehouse: string]: string }) => void;
    onClose: () => void;
}

const MappingModal: React.FC<MappingModalProps> = ({ unmappedWarehouses, onSave, onClose }) => {
    const [mappings, setMappings] = useState<{ [warehouse: string]: string }>({});

    useEffect(() => {
        const initialMappings: { [key: string]: string } = {};
        unmappedWarehouses.forEach(wh => {
            initialMappings[wh] = '';
        });
        setMappings(initialMappings);
    }, [unmappedWarehouses]);

    const handleInputChange = (warehouse: string, co: string) => {
        setMappings(prev => ({ ...prev, [warehouse]: co.trim() }));
    };

    const handleSave = () => {
        const allFilled = Object.values(mappings).every(co => co.trim() !== '');
        if (!allFilled) {
            alert('Por favor, complete todos los códigos CO para continuar.');
            return;
        }
        onSave(mappings);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex justify-center items-center z-50 transition-opacity" aria-modal="true" role="dialog">
            <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 w-full max-w-md m-4 transform transition-all animate-fade-in-up">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Mapear Bodegas Faltantes</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors" aria-label="Cerrar">
                        <XIcon className="w-6 h-6" />
                    </button>
                </div>
                <p className="text-sm text-gray-600 mb-6">
                    Se encontraron bodegas sin un "Centro de Operación" (CO) asignado. Por favor, ingrese los códigos para continuar con la exportación.
                </p>
                <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
                    {unmappedWarehouses.map(wh => (
                        <div key={wh}>
                            <label htmlFor={`co-for-${wh}`} className="block text-sm font-semibold text-gray-700">
                                {wh}
                            </label>
                            <input
                                type="text"
                                id={`co-for-${wh}`}
                                value={mappings[wh] || ''}
                                onChange={(e) => handleInputChange(wh, e.target.value)}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-ring focus:border-ring sm:text-sm"
                                placeholder={`Código CO para ${wh}`}
                            />
                        </div>
                    ))}
                </div>
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        type="button"
                        className="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        type="button"
                        className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg shadow-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
                    >
                        Guardar y Exportar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MappingModal;
