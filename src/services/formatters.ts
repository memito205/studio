// Format to currency with no decimal places
export const formatCurrency = (value: number): string => {
  return `$${Math.round(value).toLocaleString('es-CO')}`;
};

// Format to compact currency (e.g., $1.2M)
export const formatCompactCurrency = (value: number): string => {
    if (Math.abs(value) >= 1_000_000_000) {
        return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
    }
    if (Math.abs(value) >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (Math.abs(value) >= 1_000) {
        return `$${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return `$${value.toFixed(0)}`;
};

// Format to currency in millions (e.g., $1,234M)
export const formatMillionsCurrency = (value: number): string => {
  return `$${Math.round(value / 1_000_000).toLocaleString('es-CO')}M`;
};

// Format a number with thousands separators
export const formatNumber = (value: number): string => {
    return Math.round(value).toLocaleString('es-CO');
};

// Format to percentage with two decimal places
export const formatPercentage = (value: number): string => {
  return `${(value * 100).toFixed(2)}%`;
};

// Format percentage points with a sign
export const formatPercentagePoints = (value: number): string => {
  const points = value * 100;
  return `${points > 0 ? '+' : ''}${points.toFixed(2)} p.p.`;
};

// Format variation percentage with a sign
export const formatVariation = (value: number): string => {
    const percentage = value * 100;
    const colorClass = percentage >= 0 ? 'text-green-500' : 'text-red-500';
    return `<span class="${colorClass}">${percentage >= 0 ? '+' : ''}${percentage.toFixed(1)}%</span>`;
};