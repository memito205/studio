import React from 'react';

interface StatusFunnelSlideProps {
  statusCounts: Record<string, number>;
}

const statusColors: Record<string, string> = {
  'picking': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  'packing': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  'facturacion': 'bg-teal-500/20 text-teal-400 border-teal-500/50',
  'despachado': 'bg-green-500/20 text-green-400 border-green-500/50',
};

export const StatusFunnelSlide: React.FC<StatusFunnelSlideProps> = ({ statusCounts }) => {
  const sortedStatuses = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6); // Top 6 statuses to fit the TV screen

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-12">
      <h2 className="text-6xl font-extrabold text-slate-100 mb-16 tracking-tight">
        Cuellos de Botella / Estados
      </h2>
      
      <div className="w-full max-w-6xl grid gap-8">
        {sortedStatuses.length > 0 ? (
          sortedStatuses.map(([status, count], idx) => {
            const cleanStatusText = status.toUpperCase().replace('PENDIENTE EN', 'PEND.').replace('EN PROCESO DE ', '');
            
            // Try to match a color style, otherwise fallback
            let colorClasses = 'bg-slate-800 border-slate-700 text-slate-300';
            for (const key of Object.keys(statusColors)) {
                if (status.toLowerCase().includes(key)) {
                    colorClasses = statusColors[key];
                    break;
                }
            }

            return (
              <div 
                key={status} 
                className={`flex items-center justify-between p-8 rounded-2xl border ${colorClasses} transform transition-transform duration-500`}
                style={{ animationDelay: `${idx * 150}ms`, animationTimingFunction: 'ease-out', animationFillMode: 'both', animationName: 'slideInRight' }}
              >
                <span className="text-5xl font-bold truncate max-w-[70%]">{cleanStatusText}</span>
                <span className="text-6xl font-black bg-slate-950/40 px-8 py-2 rounded-xl">{count}</span>
              </div>
            )
          })
        ) : (
          <div className="w-full h-full flex items-center justify-center py-32 bg-slate-900/50 rounded-3xl border border-slate-700/50">
            <span className="text-5xl text-slate-500 font-medium">Operación 100% limpia</span>
          </div>
        )}
      </div>

       <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(50px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}} />
    </div>
  );
};
