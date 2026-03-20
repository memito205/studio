"use client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  subtitle?: string;
  color?: string; // Expects a Tailwind CSS class, e.g., 'text-green-500'
  percentage?: number;
  onClick?: () => void;
  isActive?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, subtitle, color, percentage, onClick, isActive }) => {
  return (
    <Card 
        onClick={onClick}
        className={cn(
            "transition-all duration-200",
            onClick && "cursor-pointer hover:bg-muted/50",
            isActive && "ring-2 ring-primary bg-primary/10"
        )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={cn("h-4 w-4 text-muted-foreground", color)}>
            {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold">{value}</div>
          {percentage !== undefined && (
            <span className="text-sm font-semibold text-muted-foreground">
                ({percentage.toFixed(1)}%)
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
};