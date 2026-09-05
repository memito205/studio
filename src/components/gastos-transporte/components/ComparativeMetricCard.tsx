import React from 'react';

interface ComparativeMetricCardProps {
  title: string;
  currentValue: number;
  previousValue: number;
  formatFn: (value: number) => string;
}

const ArrowUpIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clipRule="evenodd" />
    </svg>
);

const ArrowDownIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-3.707-9.293a1 1 0 00-1.414 1.414L9 12.586V9a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 12.586V9a1 1 0 10-2 0v3.586L7.293 8.707z" clipRule="evenodd" />
    </svg>
);

const ComparativeMetricCard: React.FC<ComparativeMetricCardProps> = ({ title, currentValue, previousValue, formatFn }) => {
    const diff = currentValue - previousValue;
    const isIncrease = diff > 0;
    const isDecrease = diff < 0;

    let changeColor = 'text-slate-500';
    if (isIncrease) changeColor = 'text-green-500';
    if (isDecrease) changeColor = 'text-red-500';
    
    const renderChange = () => {
        if (previousValue === 0) {
            if (currentValue > 0) {
                return (
                    <>
                        <span className="font-semibold">Nuevo</span>
                        <span className="ml-1">vs {formatFn(previousValue)}</span>
                    </>
                );
            }
            return <span>vs {formatFn(previousValue)}</span>;
        }

        const percentageChange = (diff / previousValue) * 100;
        return (
            <>
                {isIncrease && <ArrowUpIcon />}
                {isDecrease && <ArrowDownIcon />}
                <span>
                    {Math.abs(percentageChange).toFixed(1)}% vs {formatFn(previousValue)}
                </span>
            </>
        );
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <h4 className="text-sm font-medium text-slate-500">{title}</h4>
            <p className="text-3xl font-bold text-slate-800 mt-1">{formatFn(currentValue)}</p>
            {previousValue > 0 || currentValue > 0 ? (
                <div className={`flex items-center text-sm mt-1 ${changeColor}`}>
                    {renderChange()}
                </div>
            ) : (
                <div className="text-sm mt-1 text-slate-500">Sin datos previos</div>
            )}
        </div>
    );
};

export default ComparativeMetricCard;