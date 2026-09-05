import React from 'react';

interface DashboardFiltersProps {
    years: string[];
    selectedYear: string;
    selectedMonth: string;
    onYearChange: (year: string) => void;
    onMonthChange: (month: string) => void;
}

const months = [
    { value: 'all', label: 'Todos los Meses' }, { value: '01', label: 'Enero' }, { value: '02', label: 'Febrero' },
    { value: '03', label: 'Marzo' }, { value: '04', label: 'Abril' }, { value: '05', label: 'Mayo' },
    { value: '06', label: 'Junio' }, { value: '07', label: 'Julio' }, { value: '08', label: 'Agosto' },
    { value: '09', label: 'Septiembre' }, { value: '10', label: 'Octubre' }, { value: '11', label: 'Noviembre' },
    { value: '12', label: 'Diciembre' }
];

const DashboardFilters: React.FC<DashboardFiltersProps> = ({
    years,
    selectedYear,
    selectedMonth,
    onYearChange,
    onMonthChange,
}) => {
    return (
        <div className="bg-white p-4 rounded-xl shadow-lg">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
                <div className="md:col-span-1">
                    <label htmlFor="year-filter" className="block text-sm font-medium text-slate-700">Año</label>
                    <select
                        id="year-filter"
                        value={selectedYear}
                        onChange={(e) => onYearChange(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-slate-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                        <option value="all">Todos los Años</option>
                        {years.map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                </div>
                <div className="md:col-span-1">
                    <label htmlFor="month-filter" className="block text-sm font-medium text-slate-700">Mes</label>
                    <select
                        id="month-filter"
                        value={selectedMonth}
                        onChange={(e) => onMonthChange(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-slate-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                        {months.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
                    </select>
                </div>
            </div>
        </div>
    );
};

export default DashboardFilters;