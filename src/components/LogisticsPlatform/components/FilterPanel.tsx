
import React from 'react';

interface FilterPanelProps {
    availableWarehouses: string[];
    filters: {
        warehouse: string;
        startDate: string;
        endDate: string;
        documentNumber: string;
    };
    onWarehouseChange: (value: string) => void;
    onStartDateChange: (value: string) => void;
    onEndDateChange: (value: string) => void;
    onDocumentNumberChange: (value: string) => void;
    onClearFilters: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
    availableWarehouses,
    filters,
    onWarehouseChange,
    onStartDateChange,
    onEndDateChange,
    onDocumentNumberChange,
    onClearFilters
}) => {
    if (availableWarehouses.length === 0) {
        return null;
    }

    return (
        <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                {/* Filtro por Bodega */}
                <div>
                    <label htmlFor="warehouse-filter" className="block text-sm font-medium text-gray-700">
                        Bodega de Entrada
                    </label>
                    <select
                        id="warehouse-filter"
                        name="warehouse-filter"
                        value={filters.warehouse}
                        onChange={e => onWarehouseChange(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md shadow-sm"
                    >
                        <option value="all">Todas las Bodegas</option>
                        {availableWarehouses.map(wh => (
                            <option key={wh} value={wh}>{wh}</option>
                        ))}
                    </select>
                </div>

                {/* Filtro por Fecha de Inicio */}
                <div>
                    <label htmlFor="start-date-filter" className="block text-sm font-medium text-gray-700">
                        Fecha de Inicio
                    </label>
                    <input
                        type="date"
                        id="start-date-filter"
                        name="start-date-filter"
                        value={filters.startDate}
                        onChange={e => onStartDateChange(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-2 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md shadow-sm"
                    />
                </div>

                {/* Filtro por Fecha de Fin */}
                <div>
                    <label htmlFor="end-date-filter" className="block text-sm font-medium text-gray-700">
                        Fecha de Fin
                    </label>
                    <input
                        type="date"
                        id="end-date-filter"
                        name="end-date-filter"
                        value={filters.endDate}
                        onChange={e => onEndDateChange(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-2 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md shadow-sm"
                    />
                </div>

                 {/* Filtro por Nro. Documento */}
                 <div>
                    <label htmlFor="doc-number-filter" className="block text-sm font-medium text-gray-700">
                        Nro. Documento
                    </label>
                    <input
                        type="text"
                        id="doc-number-filter"
                        name="doc-number-filter"
                        placeholder="Buscar por Nro..."
                        value={filters.documentNumber}
                        onChange={e => onDocumentNumberChange(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md shadow-sm"
                    />
                </div>


                {/* Botón para Limpiar Filtros */}
                <div className="flex items-end">
                    <button
                        onClick={onClearFilters}
                        className="w-full justify-center inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                    >
                        Limpiar Filtros
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FilterPanel;
