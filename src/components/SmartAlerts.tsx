
"use client";

import React from 'react';
import type { SmartAlert } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Info, TriangleAlert, Share2, CircleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SmartAlertsProps {
  alerts: SmartAlert[] | null | undefined;
}

const alertStyles: { [key in SmartAlert['severity']]: { icon: React.ReactNode; variant: 'default' | 'destructive'; className: string; } } = {
  info: {
    icon: <Info className="h-4 w-4" />,
    variant: 'default',
    className: 'border-blue-500/50 text-blue-800 dark:text-blue-300 [&>svg]:text-blue-500',
  },
  warning: {
    icon: <TriangleAlert className="h-4 w-4" />,
    variant: 'default',
    className: 'border-amber-500/50 text-amber-800 dark:text-amber-300 [&>svg]:text-amber-500',
  },
  critical: {
    icon: <CircleAlert className="h-4 w-4" />,
    variant: 'destructive',
    className: '',
  },
};

export const SmartAlerts: React.FC<SmartAlertsProps> = ({ alerts }) => {
  const { toast } = useToast();
  
  if (!alerts || alerts.length === 0) {
    return null;
  }

  const handleShare = (alertText: string) => {
    navigator.clipboard.writeText(`🚨 Alerta de Productividad: ${alertText}`).then(() => {
        toast({
          title: "¡Alerta Copiada!",
          description: "La alerta ha sido copiada a tu portapapeles.",
        })
    }).catch(err => {
        console.error('Failed to copy: ', err);
        toast({
          variant: "destructive",
          title: "Error al copiar",
          description: "No se pudo copiar la alerta.",
        })
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alertas Inteligentes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.map((alert) => {
            const style = alertStyles[alert.severity] || alertStyles.info;
            return (
                <Alert key={alert.id} variant={style.variant} className={style.className}>
                    {style.icon}
                    <div className="flex-grow ml-4 flex justify-between items-center">
                      <AlertDescription>
                          {alert.text}
                      </AlertDescription>
                      <Button
                          onClick={() => handleShare(alert.text)}
                          variant="ghost"
                          size="icon"
                          className="flex-shrink-0 h-8 w-8 text-muted-foreground"
                          title="Compartir alerta"
                      >
                          <Share2 className="w-4 h-4" />
                      </Button>
                    </div>
                </Alert>
            )
        })}
      </CardContent>
    </Card>
  );
};
