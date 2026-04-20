import React from 'react';

interface KPIProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}

const KPI: React.FC<KPIProps> = ({ title, value, icon }) => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 flex items-center">
      <div className="bg-green-100 rounded-full p-3 mr-4">
        <div className="h-6 w-6 text-green-600">
            {icon}
        </div>
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
};

export default KPI;
