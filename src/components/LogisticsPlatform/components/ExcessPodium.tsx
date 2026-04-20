import React from 'react';
import type { EmployeePerformance } from '../types';
import { AwardIcon, AlertTriangleIcon } from './icons';

const PodiumStep: React.FC<{ employee: EmployeePerformance; rank: 1 | 2 | 3 }> = ({ employee, rank }) => {
    const styles = {
        1: { bgColor: 'bg-amber-400', textColor: 'text-amber-800', height: 'h-40', medalColor: '#FFD700' },
        2: { bgColor: 'bg-slate-300', textColor: 'text-slate-700', height: 'h-32', medalColor: '#C0C0C0' },
        3: { bgColor: 'bg-orange-400', textColor: 'text-orange-800', height: 'h-24', medalColor: '#CD7F32' },
    };

    const rankStyle = styles[rank];

    return (
        <div className={`flex flex-col items-center justify-end w-1/3`}>
            <p className="font-bold text-lg text-gray-700 truncate max-w-full px-2">{employee.employeeName}</p>
            <AwardIcon className="h-10 w-10 my-2" style={{ color: rankStyle.medalColor }}/>
            <div className={`w-full rounded-t-lg flex flex-col items-center justify-center p-4 text-center ${rankStyle.bgColor} ${rankStyle.height} transition-all duration-300`}>
                <span className={`text-4xl font-bold ${rankStyle.textColor}`}>{employee.totalExceededDays}</span>
                <span className={`text-sm font-semibold ${rankStyle.textColor}`}>días con exceso</span>
            </div>
        </div>
    );
};


const ExcessPodium: React.FC<{ employees: EmployeePerformance[] }> = ({ employees }) => {
    const topEmployees = employees
        .filter(e => e.totalExceededDays > 0)
        .sort((a, b) => b.totalExceededDays - a.totalExceededDays)
        .slice(0, 3);

    if (topEmployees.length === 0) {
        return null;
    }
    
    // Reorder for visual podium effect: 2nd, 1st, 3rd
    const podiumOrder = topEmployees.length > 1 
        ? [topEmployees[1], topEmployees[0], topEmployees[2]].filter(Boolean) 
        : topEmployees;

    const ranks: { [key: string]: 1 | 2 | 3 } = {};
    if (topEmployees[0]) ranks[topEmployees[0].employeeName] = 1;
    if (topEmployees[1]) ranks[topEmployees[1].employeeName] = 2;
    if (topEmployees[2]) ranks[topEmployees[2].employeeName] = 3;

    return (
        <div className="bg-white rounded-lg shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-800 flex items-center mb-6">
                <AlertTriangleIcon className="h-6 w-6 mr-3 text-red-500" />
                Podio: Empleados con Más Excesos de Tiempo
            </h3>
            <div className="flex items-end justify-center gap-2 min-h-[220px]">
                {podiumOrder.map((emp) => (
                    emp && <PodiumStep key={emp.employeeName} employee={emp} rank={ranks[emp.employeeName]} />
                ))}
            </div>
        </div>
    );
};

export default ExcessPodium;
