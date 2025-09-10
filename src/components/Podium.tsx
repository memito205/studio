

"use client";

import React, { useState } from 'react';
import type { PackerProductivity } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trophy, Share2, Package, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface PodiumCardProps {
  packer: PackerProductivity;
  rank: 1 | 2 | 3;
}

const PodiumCard: React.FC<PodiumCardProps> = ({ packer, rank }) => {

  const rankStyles = {
    1: {
      card: "bg-amber-400/30 dark:bg-amber-500/30 border-amber-500/50 ring-2 ring-amber-500/30",
      text: "text-amber-600 dark:text-amber-300",
      trophy: "text-amber-500",
      height: "h-60",
      shadow: "shadow-amber-500/30",
      metricSize: "text-3xl",
      nameSize: "text-2xl",
    },
    2: {
      card: "bg-slate-300/30 dark:bg-slate-600/30 border-slate-400/50 ring-2 ring-slate-400/30",
      text: "text-slate-700 dark:text-slate-300",
      trophy: "text-slate-500 dark:text-slate-400",
      height: "h-52",
      shadow: "shadow-slate-400/20",
      metricSize: "text-2xl",
      nameSize: "text-xl",
    },
    3: {
      card: "bg-orange-400/20 dark:bg-orange-600/20 border-orange-500/50 ring-2 ring-orange-500/30",
      text: "text-orange-700 dark:text-orange-400",
      trophy: "text-orange-600 dark:text-orange-500",
      height: "h-48",
      shadow: "shadow-orange-400/20",
      metricSize: "text-2xl",
      nameSize: "text-xl",
    },
  };
  
  const styles = rankStyles[rank];

  return (
    <div className={cn("flex flex-col items-center w-full", styles.height)}>
      <Trophy className={cn("w-12 h-12", styles.trophy)} />
      <Card className={cn("relative w-full text-center p-4 pt-8 shadow-lg flex-1 flex flex-col", styles.card, styles.shadow)}>
        <CardHeader className="p-0">
          <CardTitle className={cn("truncate", styles.nameSize)}>{packer.packerName}</CardTitle>
          <CardDescription>Puesto #{rank}</CardDescription>
        </CardHeader>
        <CardContent className="p-0 mt-4 flex-grow flex flex-col justify-center space-y-2">
             <div className="flex justify-around items-baseline">
                <div>
                    <div className={cn("font-bold", styles.text, styles.metricSize)}>{packer.compliance.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">Cumplimiento</div>
                </div>
                <div>
                    <div className={cn("font-bold text-foreground", styles.metricSize)}>{packer.productivity.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground">Unid/hr</div>
                </div>
            </div>
            <div className="flex justify-around items-center text-xs text-muted-foreground pt-2 border-t border-border/50">
                 <div className="flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    <span>{packer.totalQuantity.toLocaleString()} unds.</span>
                </div>
                 <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{packer.hoursWorked.toFixed(2)} hrs</span>
                </div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
};

interface PodiumProps {
    data: PackerProductivity[];
}

export const Podium: React.FC<PodiumProps> = ({ data }) => {
    const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
    const { toast } = useToast();

    if (!data || data.length === 0) {
        return null;
    }
    
    const topThree = [...data]
        .sort((a, b) => {
            if (b.compliance !== a.compliance) {
                return b.compliance - a.compliance;
            }
            return b.productivity - a.productivity;
        })
        .slice(0, 3);
    
    if (topThree.length === 0) return null;

    const handleShare = () => {
        const summary = topThree.map((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            return `${medal} ${p.packerName}: Cumplimiento: ${p.compliance.toFixed(1)}%, Productividad: ${p.productivity.toFixed(1)} u/hr`;
        }).join('\n');
        
        const fullText = `🏆 Podio de Campeones del Día 🏆\n\n${summary}`;
        
        navigator.clipboard.writeText(fullText).then(() => {
            setShareStatus('copied');
            toast({
                title: "¡Podio Copiado!",
                description: "El resumen de los 3 mejores ha sido copiado.",
            });
            setTimeout(() => setShareStatus('idle'), 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
             toast({
                variant: "destructive",
                title: "Error al copiar",
                description: "No se pudo copiar el resumen del podio.",
            });
        });
    };

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                 <CardTitle className="text-2xl text-center sm:text-left">Podio de Campeones</CardTitle>
                 <Button 
                    onClick={handleShare}
                    variant="outline"
                 >
                    <Share2 className="mr-2 h-4 w-4"/>
                    {shareStatus === 'copied' ? '¡Copiado!' : 'Compartir Podio'}
                 </Button>
            </CardHeader>
           <CardContent className="flex flex-col md:flex-row justify-center items-end gap-4 md:gap-2 pt-6 min-h-[26rem]">
                {/* 2nd Place */}
                <div className="w-full md:w-1/4 order-2 md:order-1">
                    {topThree[1] && <PodiumCard packer={topThree[1]} rank={2} />}
                </div>

                {/* 1st Place */}
                 <div className="w-full md:w-1/3 order-1 md:order-2">
                    {topThree[0] && <PodiumCard packer={topThree[0]} rank={1} />}
                </div>

                {/* 3rd Place */}
                <div className="w-full md:w-1/4 order-3 md:order-3">
                    {topThree[2] && <PodiumCard packer={topThree[2]} rank={3} />}
                </div>
            </CardContent>
        </Card>
    );
};
